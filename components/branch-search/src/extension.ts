import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import {
	liveSession,
	registerPassiveMessageRenderer,
	trackLiveSessions,
} from "../../shared/src/forked-continuation.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { type BranchSearchConfig, readBranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import {
	BRANCH_SEARCH_MESSAGE_TYPE,
	type ReviewRequest,
	runBranchSearch,
	type SearchProgress,
	type SearchResult,
} from "./orchestrator.js";

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
	queued: boolean;
	search?: { id: string; progress: () => SearchProgress };
	/** Set when the session it belongs to went away: no report and no UI calls on a stale context. */
	silent: boolean;
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

/** One request on a user-global model profile, without the conversation or tools (spec 10.5). */
function profileReview(ctx: ExtensionContext): ReviewRequest {
	return async (profile, prompt, signal) => {
		const { model, thinking } = resolveModelProfile(profile, ctx.modelRegistry);
		const reply = await ctx.modelRegistry
			.streamSimple(
				model,
				{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
				{ signal, ...(thinking === "off" ? {} : { reasoning: thinking }) },
			)
			.result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted")
			throw new Error(reply.errorMessage ?? reply.stopReason);
		return reply.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n")
			.trim();
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
		if (entry.silent) return;
		pi.sendMessage(
			{
				customType: BRANCH_SEARCH_MESSAGE_TYPE,
				content: result.report,
				display: true,
				details: { outcome: result.outcome, recordPath: result.recordPath },
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
		review: profileReview(ctx),
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
		entry.done = runBranchSearch({
			...common(entry, ctx, session),
			mode: "human",
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
	const cancelForSession = async (_event: unknown, ctx: ExtensionContext) => {
		const entry = active;
		if (!entry) return;
		entry.silent = true;
		entry.controller.abort();
		if (entry.queued) active = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		await entry.done;
	};
	pi.on("session_start", cancelForSession);
	pi.on("session_tree", cancelForSession);
	pi.on("session_shutdown", cancelForSession);

	pi.on("agent_settled", (_event, ctx) => {
		for (const resolve of settleWaiters) resolve();
		settleWaiters.clear();
		if (active?.queued) begin(active, ctx);
	});

	pi.registerCommand("branch-search", {
		description:
			"Try several approaches in isolated worktrees and keep the one that passes hidden checks: /branch-search [goal] | status | cancel",
		handler: async (args, ctx) => {
			const input = args.trim();
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
				queued: true,
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
				queued: false,
				silent: false,
			};
			active = entry;
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
				return {
					content: [{ type: "text", text: result.report }],
					details: { outcome: result.outcome, recordPath: result.recordPath },
				};
			} finally {
				signal?.removeEventListener("abort", cancel);
				if (active === entry) active = undefined;
			}
		},
	});
}
