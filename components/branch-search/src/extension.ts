import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
/** Root tools that change the workspace; blocked while the search applies its winner (spec 6.9). */
const WORKSPACE_TOOLS = new Set(["write", "edit", "bash", "pi_exec"]);
const APPLYING = "Branch search is applying its winner to the workspace. Retry this call in a moment.";

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
 * `/branch-search [goal]`, `status`, and `cancel` (spec 5.1). One search per root session; a search
 * asked for while the root run streams starts at the next `agent_settled`. The report joins the
 * conversation as one passive message (spec 6.10). Session switch, tree navigation, and shutdown
 * cancel the search, which still cleans up (spec 6.11).
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
	 */
	const holdRoot = (ctx: ExtensionContext) => () =>
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
			if (ctx.isIdle()) grant();
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
			mode: "human",
			session,
			cwd: ctx.cwd,
			config: entry.config,
			goal: entry.goal,
			review: profileReview(ctx),
			exclusive: holdRoot(ctx),
			onStart: (search) => {
				entry.search = search;
			},
			onStatus: (text) => {
				if (!entry.silent) ctx.ui.setStatus(STATUS_KEY, text);
			},
			signal: entry.controller.signal,
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
			let raw: unknown;
			try {
				raw = readBranchSearchConfig(ctx.cwd, ctx.isProjectTrusted());
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			const validated = validateBranchSearchConfig(raw);
			if (!validated.ok) {
				ctx.ui.notify(validated.text, "warning");
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
}
