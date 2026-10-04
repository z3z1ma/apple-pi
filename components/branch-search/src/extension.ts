import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession, ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import {
	liveSession,
	registerPassiveMessageRenderer,
	trackLiveSessions,
} from "../../shared/src/forked-continuation.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { type BranchSearchConfig, readBranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import { FailureCounter, shellOutcome } from "./failure-signature.js";
import {
	BRANCH_SEARCH_MESSAGE_TYPE,
	ProfileRequestError,
	type ReviewRequest,
	runBranchSearch,
	type SearchProgress,
	type SearchResult,
} from "./orchestrator.js";
import { readRecords, type SearchMode } from "./record.js";
import { formatTuning, parseGrid, tune } from "./replay.js";
import { gitCommonDir } from "./workspace.js";

const STATUS_KEY = "branch-search";
const QUEUED = "branch search queued";
/**
 * Root tools that change the workspace, or start or steer a writer that does not pass through this
 * hook (a subagent, a scheduled or monitored command); blocked while the search applies its winner
 * (spec 6.9). Writers already running when the hold starts are not stopped.
 */
const WORKSPACE_TOOLS = new Set(["write", "edit", "bash", "pi_exec", "agent", "steer_subagent", "schedule", "monitor"]);
const APPLYING = "Branch search is applying its winner to the workspace. Retry this call in a moment.";
const TOOL_NAME = "search_branches";
const ALONE = `Call ${TOOL_NAME} on its own, as the only tool call in its message, so the search can fork the conversation at this call.`;
const IN_FORK = `${TOOL_NAME} is not available inside a forked continuation.`;

/** The one search of this root session: queued until the root run settles, then running. */
interface ActiveSearch {
	readonly controller: AbortController;
	readonly config: BranchSearchConfig;
	readonly goal: string | undefined;
	/** `passive` when repeated failures of `seedGate` started it (spec 5.3); it then reports like `human`. */
	readonly mode: SearchMode;
	readonly seedGate?: string;
	queued: boolean;
	/** The failure signatures this search spent when it started; its report details carry them. */
	consumed: string[];
	search?: { id: string; progress: () => SearchProgress };
	/** Set when the session it belongs to went away: no report and no UI calls on a stale context. */
	silent: boolean;
	/**
	 * Set when a reload cuts the search off: the session stays, so the report still joins it and
	 * carries the signatures the search spent into the reloaded session.
	 */
	reportWhenSilent?: boolean;
	/** Settles when the search has ended and cleaned up. */
	done?: Promise<void>;
}

function statusText(active: ActiveSearch | undefined): string {
	if (!active) return "No branch search is running.";
	if (!active.search)
		return active.queued
			? "A branch search is queued; it starts when the current run settles."
			: "A branch search is starting.";
	const { id, phase, branches, elapsedMs } = active.search.progress();
	return [
		`Branch search ${id}`,
		`phase: ${phase}`,
		`branches: ${branches.running} running, ${branches.stopped} stopped, ${branches.survived} survived, ${branches.dead} dead`,
		`elapsed: ${Math.round(elapsedMs / 1000)}s`,
	].join("\n");
}

/** The configuration, or the text that says why it cannot be used. */
function loadConfig(
	ctx: ExtensionContext,
): { ok: true; config: BranchSearchConfig } | { ok: false; text: string; level: "error" | "warning" } {
	let raw: unknown;
	try {
		raw = readBranchSearchConfig(ctx.cwd, ctx.isProjectTrusted());
	} catch (error) {
		return { ok: false, text: error instanceof Error ? error.message : String(error), level: "error" };
	}
	const validated = validateBranchSearchConfig(raw);
	return validated.ok ? validated : { ...validated, level: "warning" };
}

/**
 * `/branch-search replay <grid.json>` (spec 18.1): replay every grid configuration on this repository's
 * search records and return the tuning table. It reads the configuration, the grid, and the records,
 * and changes nothing; the operator sets the values.
 */
async function replayGrid(ctx: ExtensionContext, path: string): Promise<{ text: string; level: "info" | "warning" }> {
	if (path === "") return { text: "Usage: /branch-search replay <grid.json>", level: "warning" };
	const validated = loadConfig(ctx);
	if (!validated.ok) return { text: validated.text, level: "warning" };
	const gridPath = resolve(ctx.cwd, path);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(gridPath, "utf8"));
	} catch (error) {
		return {
			text: `Cannot read replay grid ${gridPath}: ${error instanceof Error ? error.message : String(error)}`,
			level: "warning",
		};
	}
	const current = validated.config;
	const grid = parseGrid(raw, { branches: current.branches, generations: current.generations });
	if (!grid.ok)
		return {
			text: `Replay grid ${gridPath} is invalid:\n${grid.problems.map((p) => `  ${p}`).join("\n")}`,
			level: "warning",
		};
	let records: ReturnType<typeof readRecords>;
	try {
		records = readRecords(join(await gitCommonDir(ctx.cwd), "apple-pi", "branch-search"));
	} catch (error) {
		return {
			text: `Cannot read branch search records: ${error instanceof Error ? error.message : String(error)}`,
			level: "warning",
		};
	}
	const tuning = tune(records.records, grid.configurations);
	return { text: formatTuning(tuning, grid.configurations[0]?.shape ?? current, records.unreadable), level: "info" };
}

/** True when `toolCallId` is the only tool call of the message the conversation ends with. */
function callsAlone(messages: AgentMessage[], toolCallId: string): boolean {
	const last = messages.at(-1);
	if (last?.role !== "assistant") return false;
	const calls = last.content.filter((block) => block.type === "toolCall");
	return calls.length === 1 && calls[0]?.id === toolCallId;
}

/** The fork prompt as the result of the pending `search_branches` call, so the fork point ends with that call. */
function answerCall(toolCallId: string): (prompt: string) => AgentMessage {
	return (prompt) => ({
		role: "toolResult",
		toolCallId,
		toolName: TOOL_NAME,
		content: [{ type: "text", text: prompt }],
		isError: false,
		timestamp: Date.now(),
	});
}

/** The `details` of a search's report message or `search_branches` result. */
interface ReportDetails {
	outcome: SearchResult["outcome"];
	recordPath: SearchResult["recordPath"];
	/** Failure signatures the search spent when it started (spec 5.3); read back at session start. */
	consumedSignatures: string[];
}

function reportDetails(entry: ActiveSearch, result: SearchResult): ReportDetails {
	return { outcome: result.outcome, recordPath: result.recordPath, consumedSignatures: entry.consumed };
}

/** The signatures spent by the searches whose reports `entries` hold, on every branch of the session. */
function consumedIn(entries: readonly SessionEntry[]): Set<string> {
	const consumed = new Set<string>();
	for (const entry of entries) {
		let details: unknown;
		if (entry.type === "custom_message" && entry.customType === BRANCH_SEARCH_MESSAGE_TYPE) details = entry.details;
		else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === TOOL_NAME)
			details = entry.message.details;
		const signatures = (details as { consumedSignatures?: unknown } | undefined)?.consumedSignatures;
		if (!Array.isArray(signatures)) continue;
		for (const signature of signatures) if (typeof signature === "string") consumed.add(signature);
	}
	return consumed;
}

/**
 * One request on a user-global model profile, without the conversation or tools: the scorer review and
 * the fidelity tags (spec 10.5, 10.6). The evaluation harness sends its tags through it too.
 */
export function profileRequest(
	registry: Pick<ExtensionContext["modelRegistry"], "find" | "streamSimple">,
): ReviewRequest {
	return async (profile, prompt, signal) => {
		const { model, thinking } = resolveModelProfile(profile, registry);
		const reply = await registry
			.streamSimple(
				model,
				{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
				{ signal, ...(thinking === "off" ? {} : { reasoning: thinking }) },
			)
			.result();
		// A failed reply may still have been billed; its usage travels with the error.
		if (reply.stopReason === "error" || reply.stopReason === "aborted")
			throw new ProfileRequestError(reply.errorMessage ?? reply.stopReason, reply.usage);
		const text = reply.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n")
			.trim();
		return { text, usage: reply.usage };
	};
}

/**
 * `/branch-search [goal]`, `status`, and `cancel` (spec 5.1), and the `search_branches` tool (spec
 * 5.2). One search per root session; a search asked for while the root run streams starts at the
 * next `agent_settled`. The command's report joins the conversation as one passive message; the
 * tool's report is its result (spec 6.10). Session switch, tree navigation, and shutdown cancel the
 * search, which still cleans up (spec 6.11).
 */
export default function registerBranchSearch(pi: ExtensionAPI): void {
	trackLiveSessions();
	registerPassiveMessageRenderer(pi, BRANCH_SEARCH_MESSAGE_TYPE);
	let active: ActiveSearch | undefined;
	const settleWaiters = new Set<() => void>();
	/** Holds on the root session; while any is held, root tools that change the workspace are blocked. */
	let holds = 0;

	/**
	 * The hold starts in the same synchronous step that sees the session idle (at once, or in the
	 * `agent_settled` handler), so no root tool call can slip in between the check and the hold.
	 * A search inside a tool call holds at once: the root run is blocked on that call.
	 */
	const holdRoot = (ctx: ExtensionContext, waitForSettle: boolean) => () =>
		new Promise<() => void>((resolve) => {
			const grant = () => {
				holds++;
				let released = false;
				resolve(() => {
					if (released) return;
					released = true;
					holds--;
				});
			};
			if (!waitForSettle || ctx.isIdle()) grant();
			else settleWaiters.add(grant);
		});

	pi.on("tool_call", (event) => {
		if (holds > 0 && !inForkedContinuation() && WORKSPACE_TOOLS.has(event.toolName))
			return { block: true, reason: APPLYING };
		return undefined;
	});

	const deliver = (entry: ActiveSearch, result: SearchResult) => {
		if (entry.silent && !entry.reportWhenSilent) return;
		pi.sendMessage(
			{
				customType: BRANCH_SEARCH_MESSAGE_TYPE,
				content: result.report,
				display: true,
				details: reportDetails(entry, result),
			},
			{ triggerTurn: false },
		);
	};

	/** What every search shares, whatever started it. */
	const common = (entry: ActiveSearch, ctx: ExtensionContext, session: AgentSession) => ({
		session,
		cwd: ctx.cwd,
		config: entry.config,
		goal: entry.goal,
		seedGate: entry.seedGate,
		review: profileRequest(ctx.modelRegistry),
		onStart: (search: ActiveSearch["search"]) => {
			entry.search = search;
		},
		signal: entry.controller.signal,
	});

	const begin = (entry: ActiveSearch, ctx: ExtensionContext) => {
		entry.queued = false;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		const session = liveSession(ctx);
		if (!session) {
			active = undefined;
			ctx.ui.notify("Branch search skipped: the live session is not available.", "warning");
			return;
		}
		consume(entry);
		entry.done = runBranchSearch({
			...common(entry, ctx, session),
			mode: entry.mode,
			exclusive: holdRoot(ctx, true),
			onStatus: (text) => {
				if (!entry.silent) ctx.ui.setStatus(STATUS_KEY, text);
			},
		})
			.then(
				(result) => deliver(entry, result),
				(error: unknown) => {
					if (!entry.silent)
						ctx.ui.notify(`Branch search failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				},
			)
			.finally(() => {
				if (active === entry) active = undefined;
			});
	};

	/** Cancel the search and wait until its worktrees, refs, and record are final. */
	const cancelForSession = async (event: { type: string; reason?: string }, ctx: ExtensionContext) => {
		const entry = active;
		if (!entry) return;
		entry.silent = true;
		// The old instance stays live until this handler returns, so the report can still be sent.
		entry.reportWhenSilent = event.type === "session_shutdown" && event.reason === "reload";
		entry.controller.abort();
		if (entry.queued) active = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		await entry.done;
	};
	pi.on("session_start", cancelForSession);
	pi.on("session_tree", cancelForSession);
	pi.on("session_shutdown", cancelForSession);

	/**
	 * The root session's failure detector (spec 5.3): only the root run's own shell results count;
	 * forks run their tools through these hooks too, inside their fork scope. Every search that starts
	 * in the root session spends each signature then at its threshold, so none of them starts a
	 * passive search later in the session.
	 */
	let failures = new FailureCounter();
	let consumed = new Set<string>();
	const consume = (entry: ActiveSearch) => {
		entry.consumed = failures.reached(entry.config.passive.repeatThreshold).map(({ signature }) => signature);
		for (const signature of entry.consumed) consumed.add(signature);
	};
	/**
	 * Rebuilt from the session at every start, so a reload or resume keeps both, and a new session
	 * starts empty: the counts from the root tool results on the current branch (fork results never
	 * enter the session), the spent signatures from the details of the session's search reports.
	 */
	pi.on("session_start", (_event, ctx) => {
		failures = new FailureCounter();
		consumed = consumedIn(ctx.sessionManager.getEntries());
		const calls = new Map<string, unknown>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role === "assistant") {
				for (const block of message.content) if (block.type === "toolCall") calls.set(block.id, block.arguments);
			} else if (message.role === "toolResult") {
				const outcome = shellOutcome(message.toolName, calls.get(message.toolCallId), message, message.isError);
				if (outcome) failures.record(outcome);
			}
		}
	});
	pi.on("tool_result", (event) => {
		if (inForkedContinuation()) return undefined;
		const outcome = shellOutcome(event.toolName, event.input, event, event.isError);
		if (outcome) failures.record(outcome);
		return undefined;
	});

	/** At a root settle with no search active: start a passive search for the first signature due. */
	const startPassive = (ctx: ExtensionContext) => {
		// Every threshold is at least 2, so nothing can be due before a signature repeats.
		if (failures.reached(2).length === 0) return;
		const validated = loadConfig(ctx);
		if (!validated.ok || !validated.config.passive.enabled) return;
		const due = failures
			.reached(validated.config.passive.repeatThreshold)
			.find(({ signature }) => !consumed.has(signature));
		if (!due) return;
		const entry: ActiveSearch = {
			controller: new AbortController(),
			config: validated.config,
			goal: undefined,
			mode: "passive",
			seedGate: due.command,
			queued: true,
			consumed: [],
			silent: false,
		};
		active = entry;
		ctx.ui.notify(`Branch search started: \`${due.command}\` failed ${due.count} times.`, "info");
		begin(entry, ctx);
	};

	pi.on("agent_settled", (_event, ctx) => {
		for (const resolve of settleWaiters) resolve();
		settleWaiters.clear();
		if (active?.queued) begin(active, ctx);
		else if (!active) startPassive(ctx);
	});

	pi.registerCommand("branch-search", {
		description:
			"Try several approaches in isolated worktrees and keep the one that passes hidden checks: /branch-search [goal] | status | cancel | replay <grid.json>",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (input === "replay" || input.startsWith("replay ")) {
				const replayed = await replayGrid(ctx, input.slice("replay".length).trim());
				ctx.ui.notify(replayed.text, replayed.level);
				return;
			}
			if (input === "status") {
				ctx.ui.notify(statusText(active), "info");
				return;
			}
			if (input === "cancel") {
				if (!active) {
					ctx.ui.notify("No branch search is running.", "info");
					return;
				}
				active.controller.abort();
				if (active.queued) {
					active = undefined;
					ctx.ui.setStatus(STATUS_KEY, undefined);
					ctx.ui.notify("Branch search cancelled before it started.", "info");
				}
				return;
			}
			if (active) {
				ctx.ui.notify(
					active.search ? `Branch search ${active.search.id} is already running.` : statusText(active),
					"warning",
				);
				return;
			}
			const validated = loadConfig(ctx);
			if (!validated.ok) {
				ctx.ui.notify(validated.text, validated.level);
				return;
			}
			const entry: ActiveSearch = {
				controller: new AbortController(),
				config: validated.config,
				goal: input === "" ? undefined : input,
				mode: "human",
				queued: true,
				consumed: [],
				silent: false,
			};
			active = entry;
			if (ctx.isIdle()) {
				begin(entry, ctx);
				return;
			}
			ctx.ui.setStatus(STATUS_KEY, QUEUED);
			ctx.ui.notify(QUEUED, "info");
		},
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Search Branches",
		description:
			"Explore several independent implementation approaches in parallel and keep the one that passes objective acceptance checks. " +
			"Use this when two or more approaches are plausible, when you are uncertain which direction is correct, or after an approach has failed. " +
			"The harness writes hidden acceptance checks, runs each approach in an isolated worktree, applies the winning change to the workspace, and returns the outcome. " +
			"State the goal as the observable result that must hold when the work is done.",
		promptSnippet:
			"Try several implementation approaches in parallel isolated worktrees and keep the one that passes hidden acceptance checks",
		promptGuidelines: [
			`Use ${TOOL_NAME} when two or more implementation approaches are plausible and you cannot tell which is right, or after an approach has failed. Call it alone in its message with the goal as an observable result; it blocks until the search ends, applies the winner when the workspace is unchanged, and returns the report.`,
		],
		parameters: Type.Object({
			goal: Type.String({ description: "The observable result that must hold when the work is done." }),
		}),
		executionMode: "sequential",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (inForkedContinuation()) throw new Error(IN_FORK);
			if (active)
				throw new Error(active.search ? `Branch search ${active.search.id} is already running.` : statusText(active));
			const session = liveSession(ctx);
			if (!session) throw new Error("Branch search is not available: the live session is not available.");
			if (!callsAlone(session.sessionManager.buildSessionProjection().messages, toolCallId)) throw new Error(ALONE);
			const validated = loadConfig(ctx);
			if (!validated.ok) throw new Error(validated.text);
			const entry: ActiveSearch = {
				controller: new AbortController(),
				config: validated.config,
				goal: params.goal,
				mode: "agent",
				queued: false,
				consumed: [],
				silent: false,
			};
			active = entry;
			consume(entry);
			const cancel = () => entry.controller.abort();
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
			const run = runBranchSearch({
				...common(entry, ctx, session),
				mode: "agent",
				forkPointPrompt: answerCall(toolCallId),
				exclusive: holdRoot(ctx, false),
				onStatus: (text) => {
					if (text !== undefined) onUpdate?.({ content: [{ type: "text", text }], details: undefined });
				},
			});
			entry.done = run.then(
				() => undefined,
				() => undefined,
			);
			try {
				const result = await run;
				return { content: [{ type: "text", text: result.report }], details: reportDetails(entry, result) };
			} finally {
				signal?.removeEventListener("abort", cancel);
				if (active === entry) active = undefined;
			}
		},
	});
}
