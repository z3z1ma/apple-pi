/**
 * /pair — persistent read-only supervision of the main agent's work.
 * Pair is the sole persistent watcher and can submit typed hypotheses to a
 * host-controlled, non-recursive Advisor consultation.
 *
 * Delivery model. Every advise() call enters one shared queue; only primary turn
 * boundaries or pair-review completion flush it. Nothing is a hard interrupt:
 * upstream pi's extension surface delivers via `steer` (the message folds in at
 * the agent's next-step boundary; `triggerTurn` additionally wakes an idle agent). We never call
 * `abort()`. So:
 *
 *   nit      → tagged as raised about an earlier step. If observed while an
 *              assistant turn is running, delivery waits for turn_end because
 *              Pi would not insert its steer before then anyway: non-terminal
 *              turns flush it before the next step, while terminal turns route
 *              it through final-review reconfirmation. Thus obsolete lagging
 *              nits are dropped and survivors delivered after a final answer
 *              carry the self-contained-restatement directive. Deferral can
 *              place intervening user/extension steers before the advisory;
 *              correctness of terminal classification takes precedence over
 *              preserving callback-time queue order.
 *              The terminal best-effort path ships only concerns/blockers (an
 *              unconfirmed nit is what holding was meant to keep away).
 *   concern  → ALWAYS held, never steered on first emission.
 *   blocker  → ALWAYS held, never steered on first emission.
 *
 * Why always-hold for high severity: the pair reviews turn N asynchronously
 * (seconds), so by the time any advice could land the primary has almost always
 * done follow-up work — the advice is stale. Instead we hold it and let the next
 * review reconfirm it (held notes ride a reconfirm preamble; the pair re-
 * raises survivors, stays silent on the resolved ones).
 *
 * Catch-up block: while a high-severity note is held — or whenever a turn is
 * about to idle — we stall the primary's next step (by awaiting in the `turn_end`
 * hook, which the agent loop awaits) so the pair can catch up. The wait backs
 * off 15s→30s→60s… capped at 120s, is Escape-abortable, and is reflected in the
 * persistent footer state (formatPairFooterText: "Pair (reviewing)" vs
 * "Pair") rather than a one-shot notify — a toast for a wait that hasn't
 * resolved yet is the ambiguity this footer state exists to remove. Once the
 * pair settles, surviving held notes are steered in against the now-unraced
 * state. This is a deliberate throttle (omp's syncBacklog idea).
 *
 * An optional PAIR.md in a trusted cwd is appended to the pair's system
 * prompt (pair-only guidance: review priorities, project traps).
 *
 * While enabled, `before_agent_start` appends a short protocol to the primary
 * agent's system prompt so it knows how to treat nit/concern/blocker notes,
 * including repeats. That text is for the agent being reviewed, not the pair.
 */

import { Agent, type AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { renderNotebookView } from "../../notebook/src/commands/view.js";
import { registerCompactionTrigger } from "../../notebook/src/hooks/compaction-trigger.js";
import { registerNotebookContextPacket } from "../../notebook/src/hooks/context-packet.js";
import {
	commitPairNotebookUpdate,
	type PairNotebookBatch,
	type PairNotebookUpdate,
	preparePairNotebookBatch,
	UpdateNotebookTool,
} from "../../notebook/src/notebook-maintenance.js";
import { Runtime as NotebookRuntime } from "../../notebook/src/runtime.js";
import {
	type Entry,
	entryIndexForId,
	foldLedger,
	isSourceEntry,
	latestCoverageMarkerId,
	NOTEBOOK_OBSERVATIONS_RECORDED,
	rawTokensSinceObservationCoverage,
} from "../../notebook/src/session-ledger/index.js";
import { registerRecallTool as registerNotebookSourceTool } from "../../notebook/src/tools/notebook-source.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { recordSidecarUsage, usageFieldsFromUnknown, withSidecarUsageContext } from "../../shared/src/sidecar-usage.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { getManagedSubagentService } from "../../subagents/src/service.js";
import { EscalateTool, PairEscalationController, RepeatedFailureDetector } from "./escalation.js";
import { bindPrimaryRecallTools, type PrimarySessionManager } from "./recall.js";
import { buildPairSeed, formatSourceAddressedTrajectory, type SettledAdvice } from "./seed.js";
import { createPairSession } from "./session.js";

// ===========================================================================
// Pair core — persistent second model that watches the main agent.
//
// Port of oh-my-pi's pair onto upstream pi's public extension surface. The
// pair is a long-lived `Agent` with its own model, read-only tools
// (read/grep/find, primary-bound revisit_note/search_session), and private
// advise/escalate/update_notebook capabilities. It is fed the primary transcript one
// turn-delta at a time and may inject concise advice back. It is NOT an
// executor: it cannot edit, run commands, or change session state.
// ===========================================================================

export type { PairNote, PairSeverity } from "./types.js";

import type { PrimaryTurnState } from "../../shared/src/types.js";
import type { PairEscalationState, PairNote, PairSeverity } from "./types.js";

export type { PrimaryTurnState } from "../../shared/src/types.js";

const ADVISORY_TYPE = "advisory";

type PreparedBoundaryFinding = {
	note: PairNote;
	commit(delivered: boolean): void;
};

/** Commit direct Pair and prepared Advisor findings through one outbound batch. */
export function deliverBoundaryBatch(args: {
	direct: PairNote[];
	advisor?: PreparedBoundaryFinding;
	send(notes: PairNote[]): void;
	onDirectDelivered(note: PairNote): void;
	onDirectFailed(note: PairNote): void;
}): boolean {
	const notes = [...args.direct, ...(args.advisor ? [args.advisor.note] : [])];
	if (notes.length === 0) return false;
	try {
		args.send(notes);
		for (const note of args.direct) args.onDirectDelivered(note);
		args.advisor?.commit(true);
		return true;
	} catch (error) {
		for (const note of args.direct) args.onDirectFailed(note);
		args.advisor?.commit(false);
		throw error;
	}
}

// ---- advise tool (agent-core tool; lives only on the pair agent) ----

const adviseSchema = Type.Object({
	note: Type.String({
		description: "One concrete piece of advice for the agent you are watching. Terse, specific, actionable.",
	}),
	severity: Type.Optional(
		Type.Union([Type.Literal("nit"), Type.Literal("concern"), Type.Literal("blocker")], {
			description: "How strongly to weigh this. Omit for a plain nit.",
		}),
	),
});

const SEVERITY_RANK: Record<PairSeverity, number> = { nit: 1, concern: 2, blocker: 3 };
const rankOf = (s: PairSeverity | undefined): number => SEVERITY_RANK[s ?? "nit"];
const dedupeKey = (note: string): string => note.trim().replace(/\s+/g, " ");
/** High severity (concern/blocker) is always held + reconfirmed; nits deliver now. */
export const isHighSeverity = (s: PairSeverity | undefined): boolean => s === "concern" || s === "blocker";

/** Catch-up block backoff: base, 2×, 4×… capped. consecutive=0 → base (15s default). */
export function nextBackoffMs(consecutive: number, baseMs = 15_000, capMs = 120_000): number {
	return Math.min(capMs, baseMs * 2 ** Math.max(0, consecutive));
}

/**
 * A turn is terminal (the agent is about to go idle) when its assistant message
 * issued no tool calls — the agent-loop's inner loop exits unless something is
 * steered in. We block-until-settled on terminal turns so a blocker the pair
 * raises about the final turn is caught before control returns to the user.
 *
 * Approximation: a turn WITH tool calls can still end the run if a tool returns
 * `terminate` or a stop hook fires; we'd classify that non-terminal. The cost is
 * only a *delay*, not a loss — a held note still rides the next turn's catch-up
 * block; the sole gap is a brand-new blocker raised about such a turn (nothing
 * previously held), which then lands on the next user turn instead of before idle.
 */
export function isTerminalTurn(message: { content?: ReadonlyArray<{ type: string }> } | undefined): boolean {
	return !(message?.content ?? []).some((c) => c.type === "toolCall");
}

/** Drain after this many still-pending deltas, even if every one is low-signal. */
export const PAIR_DRAIN_BACKLOG = 8;
/** Deferral timer from the first still-pending low-signal delta. */
export const PAIR_DEFER_MS = 15_000;

const BASH_APPEND_WATCHED = Symbol("pair.bashAppendWatched");

/** Observe persisted `!bash` pages. Pi records them via appendMessage, not message_end. */
export function bindBashAppendHook(
	sessionManager: { appendMessage?: (message: unknown) => unknown },
	onBash: (message: {
		role?: string;
		command?: string;
		output?: string;
		exitCode?: number;
		excludeFromContext?: boolean;
	}) => void,
): () => void {
	const append = sessionManager.appendMessage;
	if (typeof append !== "function") return () => {};
	const tracked = sessionManager as { appendMessage?: (message: unknown) => unknown } & {
		[BASH_APPEND_WATCHED]?: boolean;
	};
	if (tracked[BASH_APPEND_WATCHED]) return () => {};
	const original = append.bind(sessionManager);
	tracked.appendMessage = (message: unknown) => {
		const result = original(message);
		const bash = message as {
			role?: string;
			command?: string;
			output?: string;
			exitCode?: number;
			excludeFromContext?: boolean;
		};
		if (bash?.role === "bashExecution" && !bash.excludeFromContext) onBash(bash);
		return result;
	};
	tracked[BASH_APPEND_WATCHED] = true;
	return () => {
		tracked.appendMessage = original;
		delete tracked[BASH_APPEND_WATCHED];
	};
}

/**
 * A turn is low-signal when it has no user text, no error, no mutation, and no
 * command execution. Judge the raw event, not the formatted delta. High-severity
 * holds are a drain trigger, not part of this classification.
 */
export function isLowSignalTurn(opts: {
	hasUserText?: boolean;
	toolResults?: ReadonlyArray<{
		toolName?: string;
		isError?: boolean;
		details?: { diff?: unknown; exitCode?: unknown; exit_code?: unknown };
	}>;
}): boolean {
	if (opts.hasUserText) return false;
	for (const result of opts.toolResults ?? []) {
		if (result.isError) return false;
		const name = (result.toolName ?? "").toLowerCase();
		if (name === "edit" || name === "write" || name === "bash") return false;
		const diff = result.details?.diff;
		if (typeof diff === "string" && diff.trim()) return false;
		const code = result.details?.exitCode ?? result.details?.exit_code;
		if (typeof code === "number") return false;
	}
	return true;
}

/** Structural slice of PairRuntime the catch-up block needs (so it's testable). */
export interface TurnBlockRuntime {
	readonly hasHighPriority: boolean;
	startDrain(): void;
	takeAllAdvice(): PairNote[];
	requeueAdvice(note: string, severity?: PairSeverity): void;
	waitUntilSettled(timeoutMs: number, signal?: AbortSignal): Promise<"settled" | "timeout" | "aborted" | "failed">;
}

/**
 * The catch-up block, run once per primary `turn_end` (after the delta is pushed).
 * Returns the next `consecutiveBlocks` count for the caller to carry.
 *
 * - Non-terminal turn with nothing held → no block (streak resets to 0).
 * - Otherwise block, racing pair-settled vs a timeout vs the abort signal:
 *     - terminal → timeout = cap (block until the pair finishes the last turn).
 *     - mid-run  → timeout = backoff(consecutiveBlocks); on timeout, keep the held
 *                  notes and lengthen the next wait (return consecutiveBlocks+1).
 * - On settle: steer in whatever survived reconfirmation (may be empty), reset streak.
 * - On timeout / failed reconfirm (pair errored out): non-terminal keeps the
 *   queued advice and lengthens the next wait; terminal delivers concerns/blockers
 *   best-effort (it's the last chance before control returns to the user, and
 *   the stakes justify an unconfirmed delivery) but requeues NITS without marking
 *   them reconfirmed. A successful late review can then prune or confirm them;
 *   after failure, the next primary boundary applies normal nit policy.
 * - On abort (user hit Escape): bail, keep held notes + streak.
 */
export async function runTurnBlock(opts: {
	terminal: boolean;
	runtime: TurnBlockRuntime;
	consecutiveBlocks: number;
	baseMs?: number;
	capMs?: number;
	signal?: AbortSignal;
	notify: (msg: string) => void;
	deliverHeld: (notes: PairNote[], opts?: { terminal?: boolean }) => void;
}): Promise<number> {
	const { terminal, runtime } = opts;
	const baseMs = opts.baseMs ?? 15_000;
	const capMs = opts.capMs ?? 120_000;
	if (!terminal && !runtime.hasHighPriority) return 0;
	runtime.startDrain();

	const timeoutMs = terminal ? capMs : nextBackoffMs(opts.consecutiveBlocks, baseMs, capMs);
	// No "catching up"/"waiting up to Ns" notify here: a toast for an in-progress,
	// not-yet-resolved wait is exactly the symptom this task fixed. The footer's
	// reviewing/idle state (see formatPairFooterText) is the persistent, self-
	// resolving signal for "is it still working" now. `notify` below stays for the
	// timeout/failure branch, which reports a concrete, already-decided outcome.
	const result = await runtime.waitUntilSettled(timeoutMs, opts.signal);
	if (result === "aborted") return opts.consecutiveBlocks; // user bailed; keep held + streak
	if (result === "settled") {
		// Only a successful reconfirmation settles; the pair has pruned recanted
		// entries, so the shared queue is the confirmed survivor set.
		const held = runtime.takeAllAdvice();
		if (held.length) opts.deliverHeld(held, { terminal });
		return 0;
	}
	// timeout OR failed (pair errored 3x and dropped the reconfirm). Either way
	// the held notes are NOT confirmed.
	if (terminal) {
		// Best-effort only for concerns/blockers. Requeue nits WITHOUT marking a
		// reconfirmation; a late successful review may still prune them.
		const held = runtime.takeAllAdvice();
		const high = held.filter((n) => isHighSeverity(n.severity));
		for (const n of held) if (!isHighSeverity(n.severity)) runtime.requeueAdvice(n.note, n.severity);
		if (high.length) {
			opts.deliverHeld(high, { terminal: true });
			opts.notify("pair didn't reconfirm in time; delivering held advice anyway");
		}
		return 0;
	}
	return opts.consecutiveBlocks + 1; // mid-run: keep held unconfirmed, lengthen next wait
}

/** Parse the hidden `/pair test <nit|concern|blocker> <note>` test hook args. */
export function parsePairTestArgs(args: string): { severity: PairSeverity; note: string } | null {
	const m = args.trim().match(/^test\s+(nit|concern|blocker)\s+([\s\S]+)$/i);
	if (!m) return null;
	return { severity: m[1].toLowerCase() as PairSeverity, note: m[2].trim() };
}

/**
 * The advise tool. Dedupes by normalized note text + severity rank: a repeat at
 * the same-or-lower severity is dropped, a real escalation (nit→concern→blocker)
 * passes through. Dedup is recorded only when the note is actually *delivered*
 * (`onAdvice` returns true). Queued or dropped advice returns false and stays
 * unrecorded until its actual boundary delivery.
 */
export class AdviseTool {
	readonly name = "share_note";
	readonly label = "Advise";
	readonly description =
		"Share one concise, actionable note with your pair programming partner when you see something that could materially improve or protect the work. Say what you noticed and what they should check. Most turns need no note. Never use this for status, acknowledgement, praise, summaries, or to say that everything looks good or an earlier issue is resolved.";
	readonly parameters = adviseSchema as any;
	#delivered = new Map<string, number>();

	// onAdvice returns true if delivered, false if queued or dropped.
	constructor(private readonly onAdvice: (note: string, severity?: PairSeverity) => boolean) {}

	resetDelivered(): void {
		this.#delivered.clear();
	}

	/**
	 * Record a note as delivered so a later same-or-lower-severity repeat is
	 * deduped. Called by the catch-up block when it steers a held note in (held
	 * notes go through `onAdvice`→false, which intentionally does NOT record, so
	 * the actual delivery point must).
	 */
	markDelivered(note: string, severity?: PairSeverity): void {
		this.#delivered.set(dedupeKey(note), rankOf(severity));
	}

	async execute(_id: string, args: { note: string; severity?: PairSeverity }): Promise<AgentToolResult<unknown>> {
		const key = dedupeKey(args.note);
		const rank = rankOf(args.severity);
		const prev = this.#delivered.get(key) ?? 0;
		if (rank <= prev) {
			return {
				content: [{ type: "text", text: "You already shared an equivalent note." }],
				details: { ...args, dropped: true },
			};
		}
		const delivered = this.onAdvice(args.note, args.severity);
		if (!delivered) {
			// Not recorded: it is queued for a boundary or dropped as stale.
			return {
				content: [{ type: "text", text: "Your note will be shared at the next safe moment if it still applies." }],
				details: { ...args, held: true },
			};
		}
		this.#delivered.set(key, rank);
		return { content: [{ type: "text", text: "Your note was shared." }], details: { ...args } };
	}
}

// ---- advisory rendering for the primary transcript ----

import {
	buildReviewMessages,
	formatAdvisoryContent,
	formatReconfirmPreamble,
	formatTurnDelta,
	formatUserBash,
} from "./formatting.js";

export {
	EscalateTool,
	MIN_TURNS_BETWEEN_ADVISOR,
	PairEscalationController,
	RepeatedFailureDetector,
} from "./escalation.js";
export {
	buildReviewMessages,
	formatActiveSessionContext,
	formatAdvisoryContent,
	formatReconfirmPreamble,
	formatTurnDelta,
	formatUserBash,
} from "./formatting.js";
export {
	buildParentNotebookPacket,
	insertParentNotebookAfterCompaction,
	registerPairParentNotebookPacket,
} from "./parent-notebook.js";
export { bindPrimaryRecallTools } from "./recall.js";
export {
	buildPairSeed,
	collectRecentUserRequests,
	formatPairSeed,
	formatRecentTrajectory,
	PAIR_RESEED_ENTRY_ID,
	RECENT_TRAJECTORY_TURNS,
} from "./seed.js";
export { PAIR_SESSION_TOOLS, pairCompactResult } from "./session.js";

// ---- build the persistent pair Agent ----

function buildPairAgent(opts: {
	cwd: string;
	model: Model<any>;
	thinkingLevel: string;
	systemPrompt: string;
	modelRegistry: any;
	adviseTool: AdviseTool;
	escalateTool: EscalateTool;
	notebookTool?: UpdateNotebookTool;
	primarySessionManager: PrimarySessionManager;
}): Agent {
	const readOnly = createReadOnlyTools(opts.cwd);
	const thinkingLevel = opts.model.reasoning ? (opts.thinkingLevel as any) : ("off" as any);
	return new Agent({
		initialState: {
			systemPrompt: opts.systemPrompt,
			model: opts.model,
			thinkingLevel,
			tools: [
				opts.adviseTool,
				opts.escalateTool,
				...(opts.notebookTool ? [opts.notebookTool] : []),
				...readOnly,
				...bindPrimaryRecallTools(opts.primarySessionManager),
			] as any,
		},
		convertToLlm,
		// Pi installs its provider-aware default stream function before loading
		// extensions. Agent's runtime intentionally accepts undefined here even
		// though the standalone AgentOptions type requires an explicit function.
		streamFn: undefined as any,
		getApiKey: (provider: string) => opts.modelRegistry.getApiKeyForProvider(provider),
	});
}

// ---- PairRuntime — drives the pair agent off primary turn deltas ----

/**
 * Feeds the persistent pair conversation one delta per primary turn.
 * Identity change uses `reset()`. Overflow uses the pair session compact hook.
 */
type PendingDelta = { text: string; lowSignal: boolean; notebookBatch?: PairNotebookBatch };

export class PairRuntime {
	#pending: PendingDelta[] = [];
	#primedContext: string | undefined;
	#deferTimer: ReturnType<typeof setTimeout> | undefined;
	#forceDrain = false;
	deferMs = PAIR_DEFER_MS;
	#rolling: SettledAdvice[] = [];
	#needsSeed = true;
	// The ONE pending-advice queue. Nits, concerns, and blockers all enter here;
	// boundary policy decides which severities can leave and when.
	#advice: PairNote[] = [];
	// Keys re-raised during the in-flight review; drives the post-review prune.
	#reraised: Set<string> | undefined;
	// Outcome of the most recently completed drain batch: "ok" (successful review)
	// or "failed" (errored 3x and dropped). Lets waitUntilSettled distinguish a
	// genuine settle from a give-up, so queued advice isn't delivered as confirmed.
	#lastOutcome: "ok" | "failed" | undefined;
	// Epoch of the in-flight review; advice callbacks are honored only while it still
	// matches #epoch. A reset/dispose bumps #epoch, orphaning a stale review whose
	// late advise() calls would otherwise leak into the moved-on session.
	#reviewEpoch = -1;
	#settleWaiters: Array<{ settle: () => void; cancel: () => void }> = [];
	#busy = false;
	#backlog = 0;
	#failures = 0;
	#epoch = 0;
	#agentResetPending = false;
	// Lifetime input/output/cost from pair turns already discarded by compact.
	// The agent's message list only holds the CURRENT context, so without folding
	// these in, /pair status would undercount after compact. A full reset()
	// (identity change) zeroes them — that is a fresh accounting.
	#cumInput = 0;
	#cumOutput = 0;
	#cumCost = 0;
	#reviewCount = 0;
	// Production turn_end binds this so #drain can emit after the hook returns.
	// Tests that construct PairRuntime directly leave it unset and write nothing.
	#usageSession?: { sessionId?: string };
	disposed = false;

	constructor(
		private readonly agent: Agent,
		private readonly adviseTool: AdviseTool,
		private readonly retryDelayMs = 1000,
		private readonly onDebug?: (...a: unknown[]) => void,
		private readonly onSettled?: (outcome: "ok" | "failed") => void,
		private readonly session?: { prompt(text: string): Promise<void>; dispose?: () => void },
		private readonly seed?: () => string,
		private readonly notebookTool?: UpdateNotebookTool,
		private readonly onNotebookUpdate?: (update: PairNotebookUpdate) => void,
	) {}

	/** Enable durable per-prompt usage records for this runtime. */
	setUsageSession(sessionId?: string): void {
		this.#usageSession = { sessionId };
	}

	#reviewText(messages: UserMessage[], prefix?: string): string {
		const chunks = messages.flatMap((message) =>
			Array.isArray(message.content)
				? message.content.filter((part) => part.type === "text").map((part) => part.text ?? "")
				: [],
		);
		return [prefix, ...chunks].filter((chunk) => chunk?.trim()).join("\n\n");
	}

	#foldDiscardedUsage(prior: readonly { role?: string; usage?: AssistantMessage["usage"] }[]): void {
		if (prior.every((message) => this.agent.state.messages.includes(message as never))) return;
		for (const message of prior) {
			if (message.role !== "assistant" || !message.usage) continue;
			this.#cumInput += message.usage.input ?? 0;
			this.#cumOutput += message.usage.output ?? 0;
			this.#cumCost += message.usage.cost?.total ?? 0;
		}
	}

	async #promptAndRecord(messages: UserMessage[], trigger: string): Promise<void> {
		this.#reviewCount++;
		const prior = this.agent.state.messages.slice();
		const before = prior.length;
		const started = Date.now();
		const model = this.agent.state.model as { provider?: string; id?: string } | undefined;
		let seed: string | undefined;
		if (this.#needsSeed) seed = this.seed?.();
		try {
			if (this.session) await this.session.prompt(this.#reviewText(messages, seed));
			else {
				const prefixed =
					seed?.trim() && messages[0]
						? [
								{
									role: "user" as const,
									content: [{ type: "text" as const, text: seed }],
									timestamp: Date.now(),
								},
								...messages,
							]
						: messages;
				await this.agent.prompt(prefixed as never);
			}
			this.#needsSeed = false;
		} finally {
			this.#foldDiscardedUsage(prior);
			this.#recordPromptUsage(before, Date.now() - started, trigger, model);
		}
	}

	#recordPromptUsage(
		before: number,
		durationMs: number,
		trigger: string,
		model: { provider?: string; id?: string } | undefined,
	): void {
		if (!this.#usageSession) return;
		withSidecarUsageContext({ sessionId: this.#usageSession.sessionId }, () => {
			const created = this.agent.state.messages.slice(before);
			let recorded = 0;
			for (const message of created) {
				if (message.role !== "assistant") continue;
				const assistant = message as AssistantMessage;
				recordSidecarUsage({
					agent: "pair",
					trigger,
					status: String(assistant.stopReason ?? "ok"),
					provider: model?.provider,
					model: model?.id,
					durationMs,
					...usageFieldsFromUnknown(assistant.usage),
				});
				recorded++;
			}
			if (recorded === 0) {
				recordSidecarUsage({
					agent: "pair",
					trigger,
					status: "error",
					provider: model?.provider,
					model: model?.id,
					durationMs,
				});
			}
		});
	}

	get backlog(): number {
		return this.#backlog;
	}

	get reviewCount(): number {
		return this.#reviewCount;
	}

	/** True when no batch is in flight and nothing is queued. */
	get idle(): boolean {
		return !this.#busy && this.#pending.length === 0;
	}

	/** True while a review prompt is in flight. Deferred pending is not reviewing. */
	get reviewing(): boolean {
		return this.#busy;
	}

	/** Caught up for wait purposes: idle, or intentionally deferred. */
	get #caughtUp(): boolean {
		return !this.#busy && !this.#shouldDrain();
	}

	/** Whether the shared queue contains anything worth blocking a mid-run turn for. */
	get hasHighPriority(): boolean {
		return this.#advice.some((n) => isHighSeverity(n.severity));
	}

	#upsertAdvice(note: string, severity?: PairSeverity): void {
		if (this.disposed) return;
		const key = dedupeKey(note);
		const existing = this.#advice.find((n) => dedupeKey(n.note) === key);
		if (!existing) this.#advice.push({ note, severity });
		else if (rankOf(severity) > rankOf(existing.severity)) existing.severity = severity;
	}

	/** Pair observation: upsert and count as a genuine reconfirmation. */
	enqueueAdvice(note: string, severity?: PairSeverity): void {
		if (this.disposed) return;
		this.#reraised?.add(dedupeKey(note));
		this.#upsertAdvice(note, severity);
	}

	/** Boundary bookkeeping: put advice back without faking a reconfirmation. */
	requeueAdvice(note: string, severity?: PairSeverity): void {
		this.#upsertAdvice(note, severity);
	}

	/** Drain nits only; concerns/blockers remain queued for reconfirmation. */
	takeNits(): PairNote[] {
		const nits = this.#advice.filter((n) => !isHighSeverity(n.severity));
		this.#advice = this.#advice.filter((n) => isHighSeverity(n.severity));
		this.#rememberSettled(nits, "delivered");
		return nits;
	}

	/** Drain every queued survivor after successful boundary reconciliation. */
	takeAllAdvice(): PairNote[] {
		const notes = this.#advice.splice(0);
		this.#rememberSettled(notes, "delivered");
		return notes;
	}

	get rollingAdvice(): readonly SettledAdvice[] {
		return this.#rolling;
	}

	#rememberSettled(notes: readonly PairNote[], disposition: SettledAdvice["disposition"]): void {
		for (const note of notes) this.#rolling.push({ ...note, disposition });
		if (this.#rolling.length > 8) this.#rolling.splice(0, this.#rolling.length - 8);
	}

	/** Whether advice from the in-flight review is still valid (not orphaned by a
	 *  reset/dispose). The delivery layer consults this to drop late stale callbacks. */
	get acceptingAdvice(): boolean {
		return !this.disposed && this.#reviewEpoch === this.#epoch;
	}

	/**
	 * Resolve once the pair has caught up (`idle`), or `timeoutMs` elapses, or
	 * `signal` aborts. Drives the per-turn catch-up block. Resolves "settled"
	 * immediately if already idle/disposed.
	 */
	waitUntilSettled(timeoutMs: number, signal?: AbortSignal): Promise<"settled" | "timeout" | "aborted" | "failed"> {
		if (this.disposed) return Promise.resolve("aborted");
		if (this.#caughtUp) return Promise.resolve(this.#lastOutcome === "failed" ? "failed" : "settled");
		return new Promise((resolve) => {
			let done = false;
			let waiter: { settle: () => void; cancel: () => void };
			let timer: ReturnType<typeof setTimeout>;
			const finish = (r: "settled" | "timeout" | "aborted" | "failed") => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				const i = this.#settleWaiters.indexOf(waiter);
				if (i >= 0) this.#settleWaiters.splice(i, 1);
				signal?.removeEventListener("abort", onAbort);
				resolve(r);
			};
			const onAbort = () => finish("aborted");
			waiter = {
				// Fired when the drain reaches a catch-up boundary (reviewed or deferred).
				settle: () => {
					if (this.disposed) finish("aborted");
					else if (this.#caughtUp) finish(this.#lastOutcome === "failed" ? "failed" : "settled");
				},
				// Fired by reset()/dispose(): resolve immediately rather than waiting for
				// the in-flight prompt to unwind (which could take up to the timeout).
				cancel: () => finish("aborted"),
			};
			timer = setTimeout(() => finish("timeout"), timeoutMs);
			this.#settleWaiters.push(waiter);
			if (signal) {
				if (signal.aborted) finish("aborted");
				else signal.addEventListener("abort", onAbort);
			}
		});
	}

	#notifySettled(): void {
		for (const w of [...this.#settleWaiters]) w.settle();
	}

	/** Resolve all pending waiters as "aborted" (used by reset/dispose). */
	#cancelWaiters(): void {
		for (const w of [...this.#settleWaiters]) w.cancel();
	}

	get usage(): { input: number; output: number; cost: number; contextTokens: number; contextPercent: number | null } {
		let input = this.#cumInput;
		let output = this.#cumOutput;
		let cost = this.#cumCost;
		let contextTokens = 0;
		for (const m of this.agent.state.messages) {
			if (m.role === "assistant" && (m as AssistantMessage).usage) {
				const u = (m as AssistantMessage).usage;
				input += u.input ?? 0;
				output += u.output ?? 0;
				cost += u.cost?.total ?? 0;
				// Latest request's input + cache reads ≈ current pair context size.
				contextTokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			}
		}
		const window = (this.agent.state.model as { contextWindow?: number } | undefined)?.contextWindow;
		const contextPercent = window ? Math.round((contextTokens / window) * 100) : null;
		return { input, output, cost, contextTokens, contextPercent };
	}

	/** Queue a rendered primary-turn delta. Drain starts only when required. */
	push(deltaText: string, opts?: { lowSignal?: boolean; terminal?: boolean; notebookBatch?: PairNotebookBatch }): void {
		if (this.disposed || !deltaText.trim()) return;
		this.#pending.push({
			text: deltaText,
			lowSignal: opts?.lowSignal === true,
			...(opts?.notebookBatch ? { notebookBatch: opts.notebookBatch } : {}),
		});
		this.#backlog++;
		if (opts?.terminal) this.#forceDrain = true;
		this.#scheduleDrain();
	}

	/** Force-start drain when catch-up must wait on pending work. */
	startDrain(): void {
		if (this.disposed || !this.#pending.length) return;
		this.#forceDrain = true;
		this.#scheduleDrain();
	}

	#shouldDrain(): boolean {
		if (!this.#pending.length) return false;
		if (this.#forceDrain) return true;
		if (this.hasHighPriority) return true;
		if (this.#pending.some((item) => !item.lowSignal)) return true;
		return this.#pending.length > PAIR_DRAIN_BACKLOG;
	}

	#scheduleDrain(): void {
		if (this.disposed || this.#busy) return;
		if (this.#shouldDrain()) {
			this.#clearDeferTimer();
			void this.#drain();
			return;
		}
		this.#armDeferTimer();
	}

	#armDeferTimer(): void {
		if (this.#deferTimer || !this.#pending.length) return;
		this.#deferTimer = setTimeout(() => {
			this.#deferTimer = undefined;
			if (this.disposed || this.#busy || !this.#pending.length) return;
			this.#forceDrain = true;
			void this.#drain();
		}, this.deferMs);
	}

	#clearDeferTimer(): void {
		if (!this.#deferTimer) return;
		clearTimeout(this.#deferTimer);
		this.#deferTimer = undefined;
	}

	/** Re-prime after a history rewrite (compaction / session switch / fork). */
	reprime(contextText: string): void {
		this.reset();
		this.#primedContext = contextText.trim() || undefined;
	}

	#resetAgentWhenIdle(): void {
		try {
			this.agent.reset();
			this.#agentResetPending = false;
		} catch {
			// Agent.reset() rejects while its aborted prompt is still unwinding. The
			// drain owns that prompt and retries this reset before processing new work.
			this.#agentResetPending = true;
		}
	}

	reset(): void {
		this.#epoch++;
		this.#pending = [];
		this.#forceDrain = false;
		this.#clearDeferTimer();
		this.#primedContext = undefined;
		this.#advice = [];
		this.#rolling = [];
		this.#needsSeed = true;
		this.#reraised = undefined;
		this.#lastOutcome = undefined;
		this.#backlog = 0;
		this.#failures = 0;
		this.#cumInput = this.#cumOutput = this.#cumCost = 0;
		this.#reviewCount = 0;
		this.adviseTool.resetDelivered();
		try {
			this.agent.abort();
		} catch {}
		this.#resetAgentWhenIdle();
		this.#cancelWaiters();
	}

	dispose(): void {
		this.disposed = true;
		this.#epoch++;
		this.#pending = [];
		this.#forceDrain = false;
		this.#clearDeferTimer();
		this.#primedContext = undefined;
		this.#advice = [];
		this.#rolling = [];
		this.#reraised = undefined;
		this.#lastOutcome = undefined;
		this.#backlog = 0;
		try {
			this.agent.abort();
		} catch {}
		try {
			this.session?.dispose?.();
		} catch {}
		this.#cancelWaiters();
	}

	async #reviewBatch(batch: PendingDelta[]): Promise<"ok" | "failed" | "stale"> {
		const notebookBatch = [...batch].reverse().find((item) => item.notebookBatch)?.notebookBatch;
		const texts = batch.map((item) => item.text);
		if (notebookBatch?.prompt) texts.push(notebookBatch.prompt);
		this.notebookTool?.begin(notebookBatch);
		const epoch = this.#epoch;
		// Re-offer the shared advice queue without removing it. On success, entries
		// not re-raised are resolved and pruned. Snapshot by value so a discarded
		// overflow attempt can restore prior severities without resurrecting entries
		// concurrently drained at a primary turn boundary.
		const offered = this.#advice.map((n) => ({ ...n }));
		const offeredKeys = new Set(offered.map((n) => dedupeKey(n.note)));
		const preamble = formatReconfirmPreamble(offered);
		const primedContext = this.#primedContext;
		this.#reraised = new Set();
		this.#reviewEpoch = epoch;
		const messages = buildReviewMessages(preamble, texts, primedContext);
		const promptChars = messages.reduce(
			(n, m) =>
				n +
				(Array.isArray(m.content)
					? m.content.reduce(
							(k: number, b: { type: string; text?: string }) => k + (b.type === "text" ? (b.text?.length ?? 0) : 0),
							0,
						)
					: 0),
			0,
		);
		try {
			this.onDebug?.("prompting pair agent, delta chars=", promptChars, "held=", offered.length);
			const trigger = this.#failures > 0 ? "turn_end_retry" : "turn_end";
			await this.#promptAndRecord(messages, trigger);
			if (this.#epoch !== epoch) {
				this.notebookTool?.clear();
				this.#reraised = undefined;
				if (this.#agentResetPending) this.#resetAgentWhenIdle();
				return "stale";
			}
			const last = this.agent.state.messages[this.agent.state.messages.length - 1] as AssistantMessage;
			if (last?.stopReason === "error" || last?.stopReason === "aborted" || last?.stopReason === "length") {
				if (last.stopReason === "length") {
					const before = new Map(offered.map((n) => [dedupeKey(n.note), n]));
					this.#advice = this.#advice.flatMap((current) => {
						const prior = before.get(dedupeKey(current.note));
						return prior ? [{ ...current, severity: prior.severity }] : [];
					});
					this.#reraised = new Set();
				}
				this.notebookTool?.clear();
				this.onDebug?.("pair review incomplete, stop=", last?.stopReason, "err=", last?.errorMessage ?? "-");
				this.#reraised = undefined;
				return "failed";
			}
			const dropped: PairNote[] = [];
			for (const key of offeredKeys) {
				if (this.#reraised?.has(key)) continue;
				const i = this.#advice.findIndex((n) => dedupeKey(n.note) === key);
				if (i < 0) continue;
				dropped.push(this.#advice[i]!);
				this.#advice.splice(i, 1);
			}
			this.#rememberSettled(dropped, "dropped");
			const notebookUpdate = this.notebookTool?.takeStaged();
			if (notebookUpdate) {
				try {
					this.onNotebookUpdate?.(notebookUpdate);
				} catch (error) {
					this.onDebug?.("pair notebook commit callback threw", String(error));
				}
			}
			if (this.#primedContext === primedContext) this.#primedContext = undefined;
			this.#lastOutcome = "ok";
			this.#failures = 0;
			this.#reraised = undefined;
			this.onDebug?.("pair turn done, stop=", last?.stopReason);
			return "ok";
		} catch (e) {
			this.notebookTool?.clear();
			this.#reraised = undefined;
			this.onDebug?.("pair prompt threw", String(e));
			// A reset/dispose aborts the in-flight prompt; drop the stale batch.
			// Held notes were never removed, so nothing to restore there.
			return this.#epoch !== epoch ? "stale" : "failed";
		}
	}

	async #drain(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		this.#clearDeferTimer();
		let reviewed = false;
		try {
			while (!this.disposed && this.#pending.length) {
				if (!this.#shouldDrain()) break;
				this.#forceDrain = false;
				if (this.#agentResetPending) this.#resetAgentWhenIdle();
				if (this.#agentResetPending) {
					this.onDebug?.("pair private context still busy after history rewrite; dropping queued review");
					this.#pending = [];
					this.#backlog = 0;
					this.#lastOutcome = "failed";
					break;
				}
				const batch = this.#pending.splice(0);
				const turns = batch.length;
				reviewed = true;
				// Rough gauge of how many turns are still unreviewed (status display only).
				this.#backlog = Math.max(0, this.#backlog - turns);
				const result = await this.#reviewBatch(batch);
				if (result === "stale" || result === "ok") continue;
				this.#failures++;
				if (this.#failures >= 3) {
					// Gave up reconfirming this batch. Mark failed so waitUntilSettled
					// reports it (don't deliver held notes as if confirmed).
					this.#failures = 0;
					this.#lastOutcome = "failed";
				} else {
					this.#pending.unshift(...batch);
					this.#backlog += turns;
					this.#forceDrain = true;
					await new Promise((r) => setTimeout(r, this.retryDelayMs));
				}
			}
		} finally {
			this.#busy = false;
			const restart = !this.disposed && this.#shouldDrain();
			if (!restart && this.#pending.length) this.#armDeferTimer();
			if (!restart && this.#caughtUp) this.#notifySettled();
			if (reviewed) {
				try {
					this.onSettled?.(this.#lastOutcome === "failed" ? "failed" : "ok");
				} catch (e) {
					this.onDebug?.("pair onSettled callback threw", String(e));
				}
			}
			if (restart) void this.#drain();
		}
	}
}

// ===========================================================================
// Extension wiring
// ===========================================================================

// Footer status key. Statuses are ordered alphabetically by key; "q-pair"
// sorts after "permissions"/"provider-system-prompt" but before "sub-bar", so
// Pair shows as a middle segment. Change this to reposition it (e.g.
// "a-pair" for leftmost).
const STATUS_KEY = "q-pair";

/**
 * Footer label + cost for the given reviewing state. `reviewing` distinguishes
 * a live review in flight from idle so a glance at the footer always answers
 * "is it still working" — the persistent, self-resolving signal that replaces
 * the old one-shot "catching up" toast (which never resolved on a silent settle).
 */
export function formatPairFooterText(
	reviewing: boolean,
	costUsd: number,
	advisorState: PairEscalationState = "idle",
	advisorCostUsd = 0,
): string {
	const state =
		advisorState === "advisor_running"
			? "Pair → Advisor"
			: advisorState === "escalation_pending"
				? "Pair (Advisor queued)"
				: advisorState === "delivery_pending"
					? "Pair (Advisor ready)"
					: reviewing
						? "Pair (reviewing)"
						: "Pair";
	const total = costUsd + advisorCostUsd;
	return `${state}: $${total.toFixed(2)}`;
}
const DEBUG = !!process.env.PAIR_DEBUG;
const dbg = (...a: unknown[]) => {
	if (DEBUG) console.error("[pair]", ...a);
};
const BLOCK_BASE_MS = 15_000;
const BLOCK_CAP_MS = 120_000;

// Set by the handoff extension (pi-amplike) via the same Symbol.for key while a
// handoff is in flight — from the moment it becomes pending until the new
// session's prompt has been dispatched. During that window the primary session
// is being torn down / replaced and its deferred handoff prompt is racing to be
// sent, so the pair must not inject messages or (worse) trigger an
// autonomous turn: doing so either crashes the handoff ("Agent is already
// processing") or leaks a stray advisory into the brand-new session.
const HANDOFF_IN_PROGRESS_KEY = Symbol.for("pi-amplike-handoff-in-progress");
function handoffInProgress(): boolean {
	return !!(globalThis as any)[HANDOFF_IN_PROGRESS_KEY];
}

function userMessageText(message: { content?: unknown } | undefined): string {
	const content = message?.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part && typeof part === "object" && "type" in part && part.type === "text" ? String(part.text ?? "") : "",
		)
		.filter(Boolean)
		.join("\n")
		.trim();
}

function sessionIdFromCtx(ctx: unknown): string | undefined {
	try {
		const sessionManager = (
			ctx as {
				sessionManager?: {
					getSessionId?: () => string | undefined;
					getSessionFile?: () => string | undefined;
				};
			}
		).sessionManager;
		return sessionManager?.getSessionId?.() ?? sessionManager?.getSessionFile?.();
	} catch {
		return undefined;
	}
}

// Emitted by the handoff extension after its tool path replaces the session
// transcript via the low-level sessionManager.newSession() (which emits no
// session_start). Must match HANDOFF_SESSION_REPLACED_CHANNEL in handoff.ts.
const HANDOFF_SESSION_REPLACED_CHANNEL = "pi-amplike:handoff-session-replaced";

import { appendPrimaryPairPrompt, loadEnabled, loadSystemPrompt, PAIR_MODEL_PROFILE, saveEnabled } from "./config.js";

export {
	appendPrimaryPairPrompt,
	loadSystemPrompt,
	PAIR_MODEL_PROFILE,
	PRIMARY_PAIR_PROTOCOL,
} from "./config.js";

// Wraps an advisory card's body in a severity-colored left rule (one line prefix
// per rendered row), matching the bordered-card convention read from richer
// third-party pair UIs during UX research. Pure layout: no state of its own.
class AdvisoryBorder implements Component {
	constructor(
		private readonly child: Component,
		private readonly bar: string,
	) {}

	invalidate(): void {
		this.child.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		return this.child.render(inner).map((line) => truncateToWidth(`${this.bar} ${line}`, width));
	}
}

export default function (pi: ExtensionAPI) {
	const rootNotebook = inChildSessionContext() ? undefined : new NotebookRuntime();
	const notebookTool = rootNotebook ? new UpdateNotebookTool() : undefined;
	if (rootNotebook) {
		registerCompactionTrigger(pi, rootNotebook);
		registerNotebookContextPacket(pi, rootNotebook);
		registerNotebookSourceTool(pi);
	}

	let enabled = loadEnabled();

	// Lazily-built pair state, rebuilt when cwd/model changes or session resets.
	let runtime: PairRuntime | undefined;
	let activeModelLabel: string | undefined;
	let modelProfileError: string | undefined;
	let lastNotifiedProfileError: string | undefined;
	let builtForCwd: string | undefined;
	let builtForTrusted: boolean | undefined;
	let runtimeBuild: { key: string; epoch: number; promise: Promise<PairRuntime | undefined> } | undefined;
	let constructionEpoch = 0;
	let pendingUserTexts: string[] = [];
	let unwatchBash: (() => void) | undefined;
	let escalationController: PairEscalationController | undefined;
	let primaryTurnSequence = 0;
	let activePairContextWindow: number | undefined;
	let projectedThroughSourceId: string | undefined;
	const directFindings = { nit: 0, concern: 0, blocker: 0 };
	const repeatedFailures = new RepeatedFailureDetector();

	// The advise tool bound to the live runtime (held so the catch-up block can
	// mark held notes delivered at the actual delivery point).
	let adviseTool: AdviseTool | undefined;

	// Consecutive mid-run catch-up blocks, for the backoff (reset when the pair
	// settles or a turn doesn't need to block).
	let consecutiveBlocks = 0;

	// Set when the user aborts (Escape) around a catch-up block: while true, late
	// pair advice is delivered WITHOUT triggerTurn so it can't auto-resume the run
	// the user just stopped. Cleared when the user drives the next turn.
	let autoResumeSuppressed = false;

	// A terminal advisory closes the supervision episode. The resulting correction
	// run belongs to the main agent and is not reviewed again until the user speaks.
	let awaitingUserAfterAdvisory = false;

	// One source of truth for which primary boundary a queue flush belongs to.
	let turnState: PrimaryTurnState = "ended-nonterminal";
	let stagedBoundaryNotes: PairNote[] = [];
	let boundaryFlush: Promise<void> | undefined;

	// Most recent ctx seen from any hook that carries one. `updateStatus` needs this
	// so the runtime's async `onSettled` callback — which fires whenever a review
	// completes, not just at turn_end — can refresh the footer without waiting for
	// the next primary-turn event. That is the actual fix for the reported UX gap:
	// the old transient "catching up" notify had no matching "done" signal, so a
	// silent settle was indistinguishable from a stuck pair. A persistent,
	// self-resolving footer state removes the need for a terminal message at all.
	let latestCtx: ExtensionContext | undefined;

	// ---- statusbar: per-session pair cost + live reviewing/idle state ----
	// Reflects the live pair lifetime cost (rt.usage.cost) and whether a review
	// is currently in flight (`Pair (reviewing): $N` vs `Pair: $N`) in the
	// footer status bar. Cleared when the pair is off or torn down.
	//
	// Footer ordering: pi sorts extension statuses alphabetically BY KEY and joins
	// them with a single space (no separators of its own). So the key controls
	// position and we draw our own `│` divider in the text. STATUS_KEY sorts after
	// "permissions"/"provider-system-prompt" but before "sub-bar", placing Pair as
	// a middle segment rather than the leftmost.
	//
	// LEADING bar only (no trailing): whatever follows draws its own separator
	// (e.g. pi-sub-bar with statusLeadingDivider:true starts with `│`), so a trailing
	// bar here would double up (`│ Pair │ │ …`).
	function updateStatus(ctx: unknown): void {
		latestCtx = ctx as ExtensionContext;
		const ui = (
			ctx as {
				ui?: {
					setStatus?: (k: string, t: string | undefined) => void;
					theme?: { fg: (c: string, s: string) => string };
				};
			}
		).ui;
		if (!ui?.setStatus) return;
		if (!enabled || !runtime) {
			ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const bar = ui.theme ? ui.theme.fg("dim", "│") : "│";
		ui.setStatus(
			STATUS_KEY,
			`${bar} ${formatPairFooterText(
				runtime.reviewing,
				runtime.usage.cost,
				escalationController?.state ?? "idle",
				escalationController?.stats.cost ?? 0,
			)}`,
		);
	}

	// ---- advice delivery into the primary session ----
	function sendNotes(notes: readonly PairNote[], opts: { stale?: boolean; finalAnswer?: boolean }): void {
		if (!notes.length) return;
		const delivered = notes.map((note) => ({ ...note, source: note.source ?? "pair" }) satisfies PairNote);
		for (const note of delivered) {
			if (note.source === "pair") directFindings[note.severity ?? "nit"]++;
		}
		const triggerTurn = !autoResumeSuppressed;
		if (opts.finalAnswer && triggerTurn) awaitingUserAfterAdvisory = true;
		const content = formatAdvisoryContent(delivered, opts);
		pi.sendMessage(
			{ customType: ADVISORY_TYPE, content, display: true, details: { notes: delivered } },
			{ deliverAs: "steer", triggerTurn },
		);
	}

	// The only immediate boundary flush: non-terminal turns drain queued nits in one
	// steer. Concerns/blockers stay in the shared queue for review reconfirmation.
	function stageNits(rt: PairRuntime | undefined): void {
		if (!rt || handoffInProgress()) return;
		stagedBoundaryNotes.push(...rt.takeNits());
	}

	// Pair callbacks only enqueue. Delivery policy lives at primary boundaries,
	// where terminality and reconfirmation state are actually known.
	function deliverAdvice(note: string, severity?: PairSeverity, sourceRuntime?: PairRuntime): boolean {
		if (awaitingUserAfterAdvisory) return false;
		// Stand down entirely while a handoff is being performed (see comment on
		// HANDOFF_IN_PROGRESS_KEY).
		if (handoffInProgress()) {
			dbg("handoff in progress, dropping advice", severity, JSON.stringify(note).slice(0, 80));
			// False means "not delivered", so AdviseTool does not poison the fresh
			// session's dedup map with a dropped callback.
			return false;
		}
		// Drop late callbacks the session has moved past: pair turned off, or a
		// reset/dispose orphaned the in-flight review (its epoch no longer matches).
		const targetRuntime = sourceRuntime ?? runtime;
		if (!enabled || (sourceRuntime && sourceRuntime !== runtime) || (targetRuntime && !targetRuntime.acceptingAdvice)) {
			dbg("dropping stale/disabled advice", severity, JSON.stringify(note).slice(0, 80));
			// Especially after reset/replacement, never let an old callback enqueue into
			// the fresh runtime or poison its cleared dedup map.
			return false;
		}

		if (targetRuntime) {
			targetRuntime.enqueueAdvice(note, severity);
			dbg("queued advice", severity, JSON.stringify(note).slice(0, 120));
			return false; // AdviseTool records only at the real boundary delivery.
		}

		// Hidden no-model test hook only: production pair callbacks always have the
		// runtime that created their AdviseTool. Keep idle command testing convenient.
		if (!isHighSeverity(severity) && turnState !== "running") {
			sendNotes([{ note, severity, source: "pair" }], {
				stale: true,
				finalAnswer: turnState === "ended-terminal",
			});
			return true;
		}
		return false;
	}

	// ---- steer held survivors into the primary (called by the catch-up block) ----
	function stageHeld(notes: PairNote[], opts?: { terminal?: boolean }): void {
		if (handoffInProgress() || !notes.length) return;
		const terminal = turnState === "ended-terminal";
		if (opts && opts.terminal !== undefined && opts.terminal !== terminal)
			dbg("stageHeld: opts.terminal diverged from turnState", opts.terminal, turnState);
		stagedBoundaryNotes.push(...notes);
	}

	// Reviews can finish after a primary turn_end timeout. Reuse the same boundary
	// policy instead of creating a late-callback delivery path. This synchronous
	// callback drains before a runTurnBlock waiter resumes; the latter then sees empty.
	function flushSettledAdvice(outcome: "ok" | "failed"): void {
		if (outcome !== "ok" || turnState === "running") return;
		void flushBoundaryFindings();
	}

	function flushBoundaryFindings(): Promise<void> {
		if (boundaryFlush) return boundaryFlush;
		const generation = constructionEpoch;
		const controller = escalationController;
		const activeRuntime = runtime;
		const activeAdviseTool = adviseTool;
		const flush = (async () => {
			if (turnState === "running" || awaitingUserAfterAdvisory || handoffInProgress()) return;
			const prepared = await controller?.prepareDelivery();
			if (generation !== constructionEpoch || controller !== escalationController || activeRuntime !== runtime) return;
			if ((turnState as PrimaryTurnState) === "running" || awaitingUserAfterAdvisory || handoffInProgress()) return;
			if (activeRuntime) {
				stagedBoundaryNotes.push(
					...(turnState === "ended-terminal" ? activeRuntime.takeAllAdvice() : activeRuntime.takeNits()),
				);
			}
			const direct = stagedBoundaryNotes.splice(0);
			try {
				deliverBoundaryBatch({
					direct,
					advisor: prepared,
					send: (notes) =>
						sendNotes(notes, {
							finalAnswer: turnState === "ended-terminal",
							stale: notes.every((note) => !isHighSeverity(note.severity)),
						}),
					onDirectDelivered: (note) => activeAdviseTool?.markDelivered(note.note, note.severity),
					onDirectFailed: (note) => activeRuntime?.requeueAdvice(note.note, note.severity),
				});
			} finally {
				if (latestCtx) updateStatus(latestCtx);
			}
		})();
		const tracked = flush.finally(() => {
			if (boundaryFlush === tracked) boundaryFlush = undefined;
		});
		boundaryFlush = tracked;
		return tracked;
	}

	function ensureEscalationController(): PairEscalationController {
		if (escalationController) return escalationController;
		escalationController = new PairEscalationController({
			pi,
			getContext: () => latestCtx,
			getService: () => getManagedSubagentService(pi.events, { processFallback: false }),
			onDeliveryReady: () => {
				if (turnState !== "running") void flushBoundaryFindings();
			},
			onOutcome: (outcome) => {
				try {
					pi.appendEntry("pair.escalation.outcome", outcome);
				} catch {}
			},
			onStateChange: () => {
				if (latestCtx) updateStatus(latestCtx);
			},
		});
		return escalationController;
	}

	function teardown(): void {
		constructionEpoch++;
		escalationController?.cancel();
		escalationController = undefined;
		unwatchBash?.();
		unwatchBash = undefined;
		runtime?.dispose();
		runtime = undefined;
		adviseTool = undefined;
		activeModelLabel = undefined;
		activePairContextWindow = undefined;
		builtForCwd = undefined;
		builtForTrusted = undefined;
		pendingUserTexts = [];
		consecutiveBlocks = 0;
		autoResumeSuppressed = false;
		awaitingUserAfterAdvisory = false;
		stagedBoundaryNotes = [];
		boundaryFlush = undefined;
		turnState = "ended-nonterminal";
		primaryTurnSequence = 0;
		directFindings.nit = directFindings.concern = directFindings.blocker = 0;
		repeatedFailures.reset();
	}

	function primaryEntries(): readonly unknown[] {
		try {
			return (
				(
					latestCtx as { sessionManager?: { getBranch?: () => unknown[] } } | undefined
				)?.sessionManager?.getBranch?.() ?? []
			);
		} catch {
			return [];
		}
	}

	function pairSourceEntries(entries: Entry[]): Entry[] {
		return entries.filter((entry) => isSourceEntry(entry) && entry.type !== "custom_message");
	}

	function resetProjectedSourceCursor(entries: Entry[]): void {
		projectedThroughSourceId = pairSourceEntries(entries).at(-1)?.id;
	}

	function takeNewSourceEntryIds(entries: Entry[]): string[] {
		const start = entryIndexForId(entries, projectedThroughSourceId);
		const fresh = pairSourceEntries(entries.slice(start + 1));
		const latest = fresh.at(-1)?.id;
		if (latest) projectedThroughSourceId = latest;
		return fresh.map((entry) => entry.id);
	}

	function sourceAddressDelta(delta: string, sourceEntryIds: readonly string[]): string {
		if (!delta.trim() || sourceEntryIds.length === 0) return delta;
		const labels = sourceEntryIds.map((id) => `[Source entry id: ${id}]`).join("\n");
		return `${labels}\n${delta}`;
	}

	function prepareNotebookBatch(ctx: ExtensionContext): PairNotebookBatch | undefined {
		if (!rootNotebook || !notebookTool || !enabled) return undefined;
		const config = rootNotebook.ensureConfig(ctx.cwd, ctx.isProjectTrusted());
		if (config.passive) return undefined;
		const getBranch = (ctx.sessionManager as { getBranch?: () => unknown }).getBranch;
		if (typeof getBranch !== "function") return undefined;
		const entries = getBranch.call(ctx.sessionManager) as Entry[];
		const sourceTokens = rawTokensSinceObservationCoverage(entries);
		const sessionIdentity = sessionIdFromCtx(ctx);
		const coverageId = latestCoverageMarkerId(entries, NOTEBOOK_OBSERVATIONS_RECORDED);
		const backoff = rootNotebook.notebookEmptyBackoff;
		let fullMaintenanceDue = sourceTokens >= config.notebookAfterTokens;
		if (backoff) {
			const sameSpan = backoff.sessionIdentity === sessionIdentity && backoff.coverageId === coverageId;
			if (sameSpan && sourceTokens < backoff.tokensAtEmpty + config.notebookAfterTokens) {
				fullMaintenanceDue = false;
			} else {
				rootNotebook.notebookEmptyBackoff = undefined;
			}
		}
		return preparePairNotebookBatch({
			entries,
			config,
			contextWindow: activePairContextWindow,
			fullMaintenanceDue,
			sourceTokens,
			sessionIdentity,
		});
	}

	function commitNotebookUpdate(update: PairNotebookUpdate): void {
		if (!rootNotebook || !latestCtx) return;
		if (update.sessionIdentity && update.sessionIdentity !== sessionIdFromCtx(latestCtx)) return;
		const entries = latestCtx.sessionManager.getBranch() as Entry[];
		if (!commitPairNotebookUpdate(pi, rootNotebook, entries, update)) return;
		if (update.observations.length > 0) {
			rootNotebook.notebookEmptyBackoff = undefined;
		} else if (update.fullMaintenanceDue) {
			rootNotebook.notebookEmptyBackoff = {
				sessionIdentity: update.sessionIdentity,
				coverageId: update.priorCoverageId,
				tokensAtEmpty: update.sourceTokens,
			};
		}
	}

	function watchPrimaryBash(ctx: { sessionManager?: object }): void {
		if (unwatchBash || !ctx.sessionManager) return;
		unwatchBash = bindBashAppendHook(
			ctx.sessionManager as { appendMessage?: (message: unknown) => unknown },
			(message) => {
				if (!enabled || process.env.PAIR_NO_REVIEW) return;
				const delta = formatUserBash(message);
				if (!delta) return;
				void ensureRuntime(ctx as Parameters<typeof ensureRuntime>[0]).then((rt) => {
					if (!rt) return;
					rt.setUsageSession(sessionIdFromCtx(latestCtx ?? ctx));
					rt.push(delta, { lowSignal: false });
				});
			},
		);
	}

	// ---- build the pair agent lazily (needs ctx for model/registry/cwd) ----
	async function buildRuntime(
		ctx: {
			cwd: string;
			modelRegistry: any;
			hasUI?: boolean;
			ui?: { notify(message: string, level: "warning"): void };
			isProjectTrusted?(): boolean;
			sessionManager: PrimarySessionManager;
		},
		notifyProfileError = true,
	): Promise<PairRuntime | undefined> {
		const projectTrusted = ctx.isProjectTrusted?.() ?? false;
		if (runtime && builtForCwd === ctx.cwd && builtForTrusted === projectTrusted) return runtime;
		if (runtime) teardown();
		const epoch = constructionEpoch;
		let model: any;
		let thinkingLevel: any;
		const profile = PAIR_MODEL_PROFILE;
		try {
			const resolved = resolveModelProfile(profile, ctx.modelRegistry);
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved.model);
			if (!auth.ok) {
				throw new Error(
					`model profile ${JSON.stringify(profile)} cannot authenticate ${resolved.model.provider}/${resolved.model.id}: ${auth.error ?? "authentication unavailable"}`,
				);
			}
			model = resolved.model;
			thinkingLevel = resolved.thinking;
			activePairContextWindow = typeof model.contextWindow === "number" ? model.contextWindow : undefined;
			modelProfileError = undefined;
			lastNotifiedProfileError = undefined;
		} catch (error) {
			modelProfileError = error instanceof Error ? error.message : String(error);
			if (notifyProfileError && ctx.hasUI && ctx.ui && lastNotifiedProfileError !== modelProfileError) {
				lastNotifiedProfileError = modelProfileError;
				ctx.ui.notify(`Pair unavailable: ${modelProfileError}`, "warning");
			}
			return undefined;
		}

		let builtRuntime!: PairRuntime;
		const builtAdviseTool = new AdviseTool((note, severity) => deliverAdvice(note, severity, builtRuntime));
		const builtEscalateTool = new EscalateTool((request) => {
			if (runtime !== builtRuntime || !builtRuntime.acceptingAdvice) return "unavailable";
			return ensureEscalationController().submit("pair", request, primaryTurnSequence);
		});
		const systemPrompt = loadSystemPrompt(ctx.cwd, projectTrusted);
		const unresolvedNotebook = () => {
			if (!latestCtx) return "";
			const batch = prepareNotebookBatch(latestCtx);
			if (!batch) return "";
			return formatSourceAddressedTrajectory(primaryEntries(), batch.allowedSourceEntryIds);
		};
		const seedSource = {
			entries: primaryEntries,
			rollingAdvice: () => builtRuntime?.rollingAdvice ?? [],
			unresolvedNotebook,
		};
		let session: Awaited<ReturnType<typeof createPairSession>> | undefined;
		try {
			session = await createPairSession({
				cwd: ctx.cwd,
				model,
				thinkingLevel,
				systemPrompt,
				adviseTool: builtAdviseTool as never,
				escalateTool: builtEscalateTool as never,
				...(notebookTool ? { notebookTool: notebookTool as never } : {}),
				seedSource,
				primarySessionManager: ctx.sessionManager,
				modelRuntime: (ctx.modelRegistry as { runtime?: unknown }).runtime,
			});
		} catch (error) {
			dbg("pair session unavailable", String(error));
		}
		if (constructionEpoch !== epoch) {
			try {
				session?.dispose();
			} catch {}
			return undefined;
		}
		const agent =
			session?.agent ??
			buildPairAgent({
				cwd: ctx.cwd,
				model,
				thinkingLevel,
				systemPrompt,
				modelRegistry: ctx.modelRegistry,
				adviseTool: builtAdviseTool,
				escalateTool: builtEscalateTool,
				...(notebookTool ? { notebookTool } : {}),
				primarySessionManager: ctx.sessionManager,
			});
		const onSettled = (outcome: "ok" | "failed") => {
			if (runtime !== builtRuntime) return;
			flushSettledAdvice(outcome);
			if (latestCtx) updateStatus(latestCtx);
		};
		builtRuntime = new PairRuntime(
			agent,
			builtAdviseTool,
			1000,
			dbg,
			onSettled,
			session,
			() =>
				buildPairSeed({
					entries: primaryEntries(),
					rollingAdvice: builtRuntime.rollingAdvice,
					unresolvedNotebook: unresolvedNotebook(),
				}),
			notebookTool,
			commitNotebookUpdate,
		);
		if (constructionEpoch !== epoch) {
			builtRuntime.dispose();
			return undefined;
		}
		adviseTool = builtAdviseTool;
		runtime = builtRuntime;
		activeModelLabel = `${model.provider}/${model.id}`;
		builtForCwd = ctx.cwd;
		builtForTrusted = projectTrusted;
		watchPrimaryBash(ctx);
		dbg("built pair runtime, model=", activeModelLabel);
		return runtime;
	}

	/** Serialize construction: concurrent hooks must share one private session. */
	async function ensureRuntime(
		ctx: Parameters<typeof buildRuntime>[0],
		notifyProfileError = true,
	): Promise<PairRuntime | undefined> {
		const projectTrusted = ctx.isProjectTrusted?.() ?? false;
		const key = `${ctx.cwd}\u0000${projectTrusted}`;
		if (runtime && builtForCwd === ctx.cwd && builtForTrusted === projectTrusted) return runtime;
		if (runtimeBuild) {
			if (runtimeBuild.epoch === constructionEpoch && runtimeBuild.key === key) return runtimeBuild.promise;
			// Teardown invalidates publication, but the next generation still waits
			// for the stale session construction to settle and dispose.
			await runtimeBuild.promise;
			return ensureRuntime(ctx, notifyProfileError);
		}
		const promise = buildRuntime(ctx, notifyProfileError);
		runtimeBuild = { key, epoch: constructionEpoch, promise };
		try {
			return await promise;
		} finally {
			if (runtimeBuild?.promise === promise) runtimeBuild = undefined;
		}
	}

	// ---- event wiring ----

	// User preflight happens before Pi starts streaming, so mark the turn running
	// here as well as at turn_start. This closes the only real pre-turn window without
	// consulting isIdle() or maintaining a second terminal flag. Also append the
	// primary-agent protocol so weaker models actually handle steered pair notes.
	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		autoResumeSuppressed = false;
		turnState = "running";
		return { systemPrompt: appendPrimaryPairPrompt(event.systemPrompt ?? "") };
	});

	pi.on("message_end", (event) => {
		if (!enabled) return;
		if (event.message?.role !== "user") return;
		awaitingUserAfterAdvisory = false;
		const text = userMessageText(event.message);
		if (!text || text.startsWith("/")) return;
		pendingUserTexts.push(text);
	});

	// `!bash` is recorded by SessionManager.appendMessage, not message_end.
	// Install the bash append hook synchronously so executeBash is not stalled on pair setup.
	pi.on("user_bash", (event, ctx) => {
		if (!enabled) return;
		if (event.excludeFromContext) return;
		if (process.env.PAIR_NO_REVIEW) return;
		watchPrimaryBash(ctx);
	});

	// Fires for every assistant turn, including advisory-triggered runs and same-run
	// continuations. Every real turn_start is paired with turn_end (also on failure).
	pi.on("turn_start", () => {
		if (!enabled) return;
		turnState = "running";
	});

	// One delta per primary turn (assistant message + its tool results). After
	// pushing, run the catch-up block: this hook is awaited by the agent loop, so
	// awaiting here stalls the primary's next step until the pair catches up.
	pi.on("turn_end", async (event, ctx) => {
		// Terminality is real session state even while supervision is disabled; the
		// hidden deterministic test hook relies on the same safe-boundary semantics.
		const terminal = isTerminalTurn(event.message as any);
		turnState = terminal ? "ended-terminal" : "ended-nonterminal";
		if (!enabled) return;
		latestCtx = ctx;
		if (awaitingUserAfterAdvisory) {
			pendingUserTexts = [];
			updateStatus(ctx);
			return;
		}
		primaryTurnSequence++;
		escalationController?.advanceTurn(primaryTurnSequence);

		// This is the authoritative boundary: Pi has finalized the assistant message,
		// and any steer observed during `running` will be inserted immediately after it.
		// Set state before any await so concurrent pair callbacks see the result.

		// Test seam: skip live model review. The hidden command delivers directly when
		// no runtime exists, so no queue work is needed here.
		if (process.env.PAIR_NO_REVIEW) return;

		const rt = await ensureRuntime(ctx as any);
		dbg("turn_end", "state=", turnState, "enabled=", enabled, "runtime=", !!rt, "model=", activeModelLabel);
		if (!rt) return;

		// At a non-terminal boundary, queued nits preserve their low-latency behavior.
		// At a terminal boundary they remain in the SAME queue and ride the final
		// review's reconfirmation preamble alongside concerns/blockers.
		if (!terminal) stageNits(rt);

		rt.setUsageSession(sessionIdFromCtx(ctx));
		const userPrompt = pendingUserTexts.join("\n\n");
		pendingUserTexts = [];
		const toolResults = event.toolResults as ToolResultMessage[];
		const repeatedFailure = repeatedFailures.observe(event.message as never, toolResults, primaryTurnSequence);
		if (repeatedFailure) {
			ensureEscalationController().submit("gate", repeatedFailure, primaryTurnSequence, {
				repeatedFailure: true,
				testFailure: /\b(test|check|lint|typecheck)\b/i.test(repeatedFailure.claim),
			});
		}
		const entries = ctx.sessionManager.getBranch() as Entry[];
		const sourceEntryIds = takeNewSourceEntryIds(entries);
		const delta = sourceAddressDelta(
			formatTurnDelta({
				userPrompt: userPrompt || undefined,
				assistant: event.message as AssistantMessage,
				toolResults,
			}),
			sourceEntryIds,
		);
		const notebookBatch = prepareNotebookBatch(ctx);
		rt.push(delta, {
			lowSignal: isLowSignalTurn({ hasUserText: Boolean(userPrompt), toolResults }),
			terminal,
			...(notebookBatch ? { notebookBatch } : {}),
		});

		// Don't block during a handoff teardown (we'd stall the replacement).
		if (handoffInProgress()) return;
		updateStatus(ctx);
		consecutiveBlocks = await runTurnBlock({
			terminal,
			runtime: rt,
			consecutiveBlocks,
			baseMs: BLOCK_BASE_MS,
			capMs: BLOCK_CAP_MS,
			signal: (ctx as any).signal,
			notify: (m) => {
				try {
					(ctx as any).ui?.notify?.(m, "info");
				} catch {}
			},
			deliverHeld: stageHeld,
		});
		// If the user aborted (Escape) around the block, suppress auto-resume so a late
		// pair callback from the still-running review can't restart the stopped run.
		if ((ctx as any).signal?.aborted) autoResumeSuppressed = true;
		await flushBoundaryFindings();
		// Refresh the footer cost after the Pair and any settled consultation caught up.
		updateStatus(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		updateStatus(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		teardown();
		const entries = (ctx.sessionManager as { getBranch?: () => Entry[] }).getBranch?.();
		if (entries) resetProjectedSourceCursor(entries);
		updateStatus(ctx);
	});
	pi.on("session_start", (_event, ctx) => {
		teardown();
		const entries = (ctx.sessionManager as { getBranch?: () => Entry[] }).getBranch?.();
		if (entries) resetProjectedSourceCursor(entries);
		updateStatus(ctx);
	});

	pi.events.on(HANDOFF_SESSION_REPLACED_CHANNEL, () => {
		teardown();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		teardown();
		rootNotebook?.dispose();
		(ctx as { ui?: { setStatus?: (k: string, t: string | undefined) => void } }).ui?.setStatus?.(STATUS_KEY, undefined);
	});

	// ---- advisory card rendering ----
	// Bordered card (severity-colored left rule, bold "Pair <SEVERITY>" heading,
	// body in the default readable `text` color) replacing the single dim inline
	// line, matching the visual clarity of richer third-party pair UIs surveyed
	// during UX research. `text` (not `muted`/`dim`) for the body follows the same
	// contrast rationale as the conversation-viewer fix: dim is nearly invisible in
	// the dark theme and this is content the user is meant to read.
	pi.registerMessageRenderer<{ notes: PairNote[] }>(ADVISORY_TYPE, (message, _options, theme) => {
		const notes = message.details?.notes;
		if (!notes?.length) return undefined;
		const container = new Container();
		for (const [index, n] of notes.entries()) {
			if (index > 0) container.addChild(new Spacer(1));
			const color = n.severity === "blocker" ? "error" : n.severity === "concern" ? "warning" : "accent";
			const tag = (n.severity ?? "nit").toUpperCase();
			const role = n.source === "advisor" ? "Advisor" : "Pair";
			const card = new Container();
			card.addChild(new Text(`${theme.fg(color, theme.bold(role))} ${theme.fg(color, tag)}`, 0, 0));
			card.addChild(new Spacer(1));
			card.addChild(new Text(theme.fg("text", n.note), 0, 0));
			container.addChild(new AdvisoryBorder(card, theme.fg(color, "│")));
		}
		return container;
	});

	// ---- /pair command ----
	pi.registerCommand("pair", {
		description: "Control the Pair Programmer. Usage: /pair [on|off|status|notebook [full]]",
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one command dispatcher owns Pair activation, status, notebook view, and the private test hook.
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "notebook" || arg === "notebook full") {
				if (!rootNotebook) {
					ctx.ui.notify("Pair notebook is available only in the root session.", "warning");
					return;
				}
				const entries = ctx.sessionManager.getBranch() as Entry[];
				ctx.ui.notify(renderNotebookView(entries, arg === "notebook full" ? "full" : "visible"), "info");
				return;
			}

			if (arg === "status" || arg === "") {
				if (!enabled) {
					ctx.ui.notify(
						`Pair Programmer disabled — notebook maintenance paused; profile ${PAIR_MODEL_PROFILE}`,
						"info",
					);
					updateStatus(ctx);
					return;
				}
				const rt = await ensureRuntime(ctx as any, false);
				if (!rt) {
					ctx.ui.notify(
						`Pair enabled but unavailable — profile ${PAIR_MODEL_PROFILE}: ${modelProfileError ?? "unknown profile error"}`,
						"warning",
					);
					return;
				}
				updateStatus(ctx);
				const u = rt.usage;
				const ctxStr =
					u.contextPercent !== null ? `${u.contextPercent}% (${u.contextTokens} tok)` : `${u.contextTokens} tok`;
				const advisor = escalationController;
				const entries = ctx.sessionManager.getBranch() as Entry[];
				const notebook = foldLedger(entries);
				const notebookProgress = rootNotebook ? rawTokensSinceObservationCoverage(entries) : 0;
				ctx.ui.notify(
					`Pair Programmer enabled — profile ${PAIR_MODEL_PROFILE}, model ${activeModelLabel}, state ${rt.reviewing ? "reviewing" : "idle"}, backlog ${rt.backlog}, reviews ${rt.reviewCount}, findings ${directFindings.nit}n/${directFindings.concern}c/${directFindings.blocker}b, tokens ${u.input}in/${u.output}out, cost $${u.cost.toFixed(4)}, ctx ${ctxStr}\n` +
						`Notebook — ${notebook.activeObservations.length} active observations, ${notebook.currentReflections.length} current reflections, ~${notebookProgress.toLocaleString()} uncovered source tokens\n` +
						`Advisor — state ${advisor?.state ?? "idle"}, active ${advisor?.activeId ?? "none"}, queued ${advisor?.pendingCount ?? 0}, consultations ${advisor?.stats.consultations ?? 0}, dispositions ${advisor?.stats.confirm ?? 0} confirm/${advisor?.stats.refute ?? 0} refute/${advisor?.stats.refine ?? 0} refine/${advisor?.stats.uncertain ?? 0} uncertain, tokens ${advisor?.stats.input ?? 0}in/${advisor?.stats.output ?? 0}out, cost $${(advisor?.stats.cost ?? 0).toFixed(4)}`,
					"info",
				);
				return;
			}

			if (arg === "on") {
				enabled = true;
				saveEnabled(true);
				const rt = await ensureRuntime(ctx as any, false);
				updateStatus(ctx);
				ctx.ui.notify(
					rt
						? `Pair Programmer on — ${activeModelLabel}`
						: `Pair Programmer on, but unavailable: ${modelProfileError ?? "unknown profile error"}`,
					rt ? "info" : "warning",
				);
				return;
			}
			if (arg === "off") {
				enabled = false;
				saveEnabled(false);
				teardown();
				updateStatus(ctx);
				ctx.ui.notify("Pair Programmer off — notebook maintenance paused", "info");
				return;
			}

			// Hidden test hook. An idle nit delivers directly so it remains useful even
			// before the runtime's first review; running/high-severity cases use the queue.
			if (arg.startsWith("test")) {
				const parsed = parsePairTestArgs(args);
				if (!parsed) {
					ctx.ui.notify("usage: /pair test <nit|concern|blocker> <note>", "warning");
					return;
				}
				deliverAdvice(parsed.note, parsed.severity);
				return;
			}

			ctx.ui.notify("usage: /pair [on|off|status|notebook [full]]", "warning");
		},
	});
}
