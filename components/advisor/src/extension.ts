/**
 * /advisor — a persistent second model that reviews the main agent's work each
 * turn and injects concise advice inline. Port of oh-my-pi's advisor onto
 * upstream pi's extension API.
 *
 * Enable with `/advisor on` (persisted). The advisor model defaults to
 * openrouter/z-ai/glm-5.2 (override via an "advisor" entry in modes.json).
 *
 * Delivery model. Every advise() call enters one shared queue; only primary turn
 * boundaries or advisor-review completion flush it. Nothing is a hard interrupt:
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
 * Why always-hold for high severity: the advisor reviews turn N asynchronously
 * (seconds), so by the time any advice could land the primary has almost always
 * done follow-up work — the advice is stale. Instead we hold it and let the next
 * review reconfirm it (held notes ride a reconfirm preamble; the advisor re-
 * raises survivors, stays silent on the resolved ones).
 *
 * Catch-up block: while a high-severity note is held — or whenever a turn is
 * about to idle — we stall the primary's next step (by awaiting in the `turn_end`
 * hook, which the agent loop awaits) so the advisor can catch up. The wait backs
 * off 15s→30s→60s… capped at 120s, is Escape-abortable, and is reflected in the
 * persistent footer state (formatAdvisorFooterText: "Advisor (reviewing)" vs
 * "Advisor") rather than a one-shot notify — a toast for a wait that hasn't
 * resolved yet is the ambiguity this footer state exists to remove. Once the
 * advisor settles, surviving held notes are steered in against the now-unraced
 * state. This is a deliberate throttle (omp's syncBacklog idea).
 *
 * An optional WATCHDOG.md in a trusted cwd is appended to the advisor's system
 * prompt (advisor-only guidance: review priorities, project traps).
 *
 * While enabled, `before_agent_start` appends a short protocol to the primary
 * agent's system prompt so it knows how to treat nit/concern/blocker notes,
 * including repeats. That text is for the agent being reviewed, not the advisor.
 */

import { Agent, type AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { convertToLlm, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { resolveModelAndThinking } from "../../shared/src/mode-utils.js";
import { recordSidecarUsage, usageFieldsFromUnknown, withSidecarUsageContext } from "../../shared/src/sidecar-usage.js";

// ===========================================================================
// Advisor core — persistent second model that watches the main agent.
//
// Port of oh-my-pi's advisor onto upstream pi's public extension surface. The
// advisor is a long-lived `Agent` with its own model + read-only tools
// (read/grep/find) and one `advise` tool. It is fed the primary transcript one
// turn-delta at a time and may inject concise advice back. It is NOT an
// executor: it cannot edit, run commands, or change session state.
// ===========================================================================

export type { AdvisorNote, AdvisorSeverity } from "./types.js";

import type { PrimaryTurnState } from "../../shared/src/types.js";
import type { AdvisorNote, AdvisorSeverity } from "./types.js";

export type { PrimaryTurnState } from "../../shared/src/types.js";

const ADVISORY_TYPE = "advisory";

// ---- advise tool (agent-core tool; lives only on the advisor agent) ----

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

const SEVERITY_RANK: Record<AdvisorSeverity, number> = { nit: 1, concern: 2, blocker: 3 };
const rankOf = (s: AdvisorSeverity | undefined): number => SEVERITY_RANK[s ?? "nit"];
const dedupeKey = (note: string): string => note.trim().replace(/\s+/g, " ");
/** High severity (concern/blocker) is always held + reconfirmed; nits deliver now. */
export const isHighSeverity = (s: AdvisorSeverity | undefined): boolean => s === "concern" || s === "blocker";

/** Catch-up block backoff: base, 2×, 4×… capped. consecutive=0 → base (15s default). */
export function nextBackoffMs(consecutive: number, baseMs = 15_000, capMs = 120_000): number {
	return Math.min(capMs, baseMs * 2 ** Math.max(0, consecutive));
}

/**
 * A turn is terminal (the agent is about to go idle) when its assistant message
 * issued no tool calls — the agent-loop's inner loop exits unless something is
 * steered in. We block-until-settled on terminal turns so a blocker the advisor
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

/** Structural slice of AdvisorRuntime the catch-up block needs (so it's testable). */
export interface TurnBlockRuntime {
	readonly hasHighPriority: boolean;
	takeAllAdvice(): AdvisorNote[];
	requeueAdvice(note: string, severity?: AdvisorSeverity): void;
	waitUntilSettled(timeoutMs: number, signal?: AbortSignal): Promise<"settled" | "timeout" | "aborted" | "failed">;
}

/**
 * The catch-up block, run once per primary `turn_end` (after the delta is pushed).
 * Returns the next `consecutiveBlocks` count for the caller to carry.
 *
 * - Non-terminal turn with nothing held → no block (streak resets to 0).
 * - Otherwise block, racing advisor-settled vs a timeout vs the abort signal:
 *     - terminal → timeout = cap (block until the advisor finishes the last turn).
 *     - mid-run  → timeout = backoff(consecutiveBlocks); on timeout, keep the held
 *                  notes and lengthen the next wait (return consecutiveBlocks+1).
 * - On settle: steer in whatever survived reconfirmation (may be empty), reset streak.
 * - On timeout / failed reconfirm (advisor errored out): non-terminal keeps the
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
	deliverHeld: (notes: AdvisorNote[], opts?: { terminal?: boolean }) => void;
}): Promise<number> {
	const { terminal, runtime } = opts;
	const baseMs = opts.baseMs ?? 15_000;
	const capMs = opts.capMs ?? 120_000;
	if (!terminal && !runtime.hasHighPriority) return 0;

	const timeoutMs = terminal ? capMs : nextBackoffMs(opts.consecutiveBlocks, baseMs, capMs);
	// No "catching up"/"waiting up to Ns" notify here: a toast for an in-progress,
	// not-yet-resolved wait is exactly the symptom this task fixed. The footer's
	// reviewing/idle state (see formatAdvisorFooterText) is the persistent, self-
	// resolving signal for "is it still working" now. `notify` below stays for the
	// timeout/failure branch, which reports a concrete, already-decided outcome.
	const result = await runtime.waitUntilSettled(timeoutMs, opts.signal);
	if (result === "aborted") return opts.consecutiveBlocks; // user bailed; keep held + streak
	if (result === "settled") {
		// Only a successful reconfirmation settles; the advisor has pruned recanted
		// entries, so the shared queue is the confirmed survivor set.
		const held = runtime.takeAllAdvice();
		if (held.length) opts.deliverHeld(held, { terminal });
		return 0;
	}
	// timeout OR failed (advisor errored 3x and dropped the reconfirm). Either way
	// the held notes are NOT confirmed.
	if (terminal) {
		// Best-effort only for concerns/blockers. Requeue nits WITHOUT marking a
		// reconfirmation; a late successful review may still prune them.
		const held = runtime.takeAllAdvice();
		const high = held.filter((n) => isHighSeverity(n.severity));
		for (const n of held) if (!isHighSeverity(n.severity)) runtime.requeueAdvice(n.note, n.severity);
		if (high.length) {
			opts.deliverHeld(high, { terminal: true });
			opts.notify("advisor didn't reconfirm in time; delivering held advice anyway");
		}
		return 0;
	}
	return opts.consecutiveBlocks + 1; // mid-run: keep held unconfirmed, lengthen next wait
}

/** Parse the hidden `/advisor test <nit|concern|blocker> <note>` test hook args. */
export function parseAdvisorTestArgs(args: string): { severity: AdvisorSeverity; note: string } | null {
	const m = args.trim().match(/^test\s+(nit|concern|blocker)\s+([\s\S]+)$/i);
	if (!m) return null;
	return { severity: m[1].toLowerCase() as AdvisorSeverity, note: m[2].trim() };
}

/**
 * The advise tool. Dedupes by normalized note text + severity rank: a repeat at
 * the same-or-lower severity is dropped, a real escalation (nit→concern→blocker)
 * passes through. Dedup is recorded only when the note is actually *delivered*
 * (`onAdvice` returns true). Queued or dropped advice returns false and stays
 * unrecorded until its actual boundary delivery.
 */
export class AdviseTool {
	readonly name = "advise";
	readonly label = "Advise";
	readonly description =
		"Send one concrete, ACTIONABLE piece of advice to the agent you are watching. Use sparingly; stay silent when nothing matters. Call it to head off likely-wrong or materially wasteful work. NEVER call it to report status, acknowledge, confirm, summarize, or signal that all is well / resolved / nothing-further-needed — in those cases emit nothing.";
	readonly parameters = adviseSchema as any;
	#delivered = new Map<string, number>();

	// onAdvice returns true if delivered, false if queued or dropped.
	constructor(private readonly onAdvice: (note: string, severity?: AdvisorSeverity) => boolean) {}

	resetDelivered(): void {
		this.#delivered.clear();
	}

	/**
	 * Record a note as delivered so a later same-or-lower-severity repeat is
	 * deduped. Called by the catch-up block when it steers a held note in (held
	 * notes go through `onAdvice`→false, which intentionally does NOT record, so
	 * the actual delivery point must).
	 */
	markDelivered(note: string, severity?: AdvisorSeverity): void {
		this.#delivered.set(dedupeKey(note), rankOf(severity));
	}

	async execute(_id: string, args: { note: string; severity?: AdvisorSeverity }): Promise<AgentToolResult<unknown>> {
		const key = dedupeKey(args.note);
		const rank = rankOf(args.severity);
		const prev = this.#delivered.get(key) ?? 0;
		if (rank <= prev) {
			return { content: [{ type: "text", text: "Duplicate advice ignored." }], details: { ...args, dropped: true } };
		}
		const delivered = this.onAdvice(args.note, args.severity);
		if (!delivered) {
			// Not recorded: it is queued for a boundary or dropped as stale.
			return {
				content: [{ type: "text", text: "Queued for boundary delivery (or dropped as stale)." }],
				details: { ...args, held: true },
			};
		}
		this.#delivered.set(key, rank);
		return { content: [{ type: "text", text: "Recorded." }], details: { ...args } };
	}
}

// ---- advisory rendering for the primary transcript ----

import {
	buildReviewMessages,
	formatActiveSessionContext,
	formatAdvisoryContent,
	formatReconfirmPreamble,
	formatTurnDelta,
} from "./formatting.js";

export {
	buildReviewMessages,
	formatActiveSessionContext,
	formatAdvisoryContent,
	formatReconfirmPreamble,
	formatTurnDelta,
} from "./formatting.js";

// ---- build the persistent advisor Agent ----

function buildAdvisorAgent(opts: {
	cwd: string;
	model: Model<any>;
	thinkingLevel: string;
	systemPrompt: string;
	modelRegistry: any;
	adviseTool: AdviseTool;
}): Agent {
	const readOnly = createReadOnlyTools(opts.cwd);
	const thinkingLevel = opts.model.reasoning ? (opts.thinkingLevel as any) : ("off" as any);
	return new Agent({
		initialState: {
			systemPrompt: opts.systemPrompt,
			model: opts.model,
			thinkingLevel,
			tools: [opts.adviseTool, ...readOnly] as any,
		},
		convertToLlm,
		// Pi installs its provider-aware default stream function before loading
		// extensions. Agent's runtime intentionally accepts undefined here even
		// though the standalone AgentOptions type requires an explicit function.
		streamFn: undefined as any,
		getApiKey: (provider: string) => opts.modelRegistry.getApiKeyForProvider(provider),
	});
}

// ---- AdvisorRuntime — drives the advisor agent off primary turn deltas ----

/**
 * Feeds the persistent advisor agent one delta per primary turn, serialized so
 * the agent is never prompted while already streaming. On context overflow (or
 * any history rewrite) the caller invokes `reset()`, which clears the advisor's
 * own context so the next delta replays fresh.
 */
export class AdvisorRuntime {
	#pending: string[] = [];
	#primedContext: string | undefined;
	// The ONE pending-advice queue. Nits, concerns, and blockers all enter here;
	// boundary policy decides which severities can leave and when.
	#advice: AdvisorNote[] = [];
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
	// Lifetime input/output/cost from advisor turns already discarded by a
	// self-compaction (#softReset). The agent's message list only holds the CURRENT
	// (post-compaction) context, so without folding these in, /advisor status would
	// undercount lifetime tokens/cost after each self-compaction. A full reset()
	// (primary compaction / new session) zeroes them — that is a fresh accounting.
	#cumInput = 0;
	#cumOutput = 0;
	#cumCost = 0;
	// Production turn_end binds this so #drain can emit after the hook returns.
	// Tests that construct AdvisorRuntime directly leave it unset and write nothing.
	#usageSession?: { sessionId?: string };
	disposed = false;

	// Self-compact when the advisor's own context reaches this % of its window
	// (proactively, before the next review prompt). Below 100 so a fresh replay of
	// the next batch comfortably fits; the reactive stopReason=="length" path is the
	// backstop if a single batch crosses it anyway.
	private readonly compactAtPercent: number;

	constructor(
		private readonly agent: Agent,
		private readonly adviseTool: AdviseTool,
		private readonly retryDelayMs = 1000,
		private readonly onDebug?: (...a: unknown[]) => void,
		compactAtPercent = 80,
		private readonly onSettled?: (outcome: "ok" | "failed") => void,
	) {
		this.compactAtPercent = compactAtPercent;
	}

	/**
	 * Self-compaction: clear ONLY the advisor agent's own message history,
	 * preserving pending deltas/advice, backlog, failure count, and settle waiters.
	 * Safe because the agent transcript is a pure linear accumulation of independent
	 * turn deltas — no essential cross-turn state lives there (held
	 * notes ride the reconfirm preamble). Unlike reset(), this does NOT bump the
	 * epoch (the in-flight review is ours, not orphaned) nor drop queued/held work.
	 */
	#softReset(): void {
		// Preserve lifetime token/cost accounting before the about-to-be-cleared
		// messages are gone (see #cumInput/#cumOutput/#cumCost).
		for (const m of this.agent.state.messages) {
			if (m.role === "assistant" && (m as AssistantMessage).usage) {
				const u = (m as AssistantMessage).usage;
				this.#cumInput += u.input ?? 0;
				this.#cumOutput += u.output ?? 0;
				this.#cumCost += u.cost?.total ?? 0;
			}
		}
		try {
			this.agent.abort();
		} catch {}
		try {
			this.agent.reset();
		} catch {}
	}

	/** Enable durable per-prompt usage records for this runtime. */
	setUsageSession(sessionId?: string): void {
		this.#usageSession = { sessionId };
	}

	async #promptAndRecord(messages: unknown, trigger: string): Promise<void> {
		const before = this.agent.state.messages.length;
		const started = Date.now();
		const model = this.agent.state.model as { provider?: string; id?: string } | undefined;
		try {
			await this.agent.prompt(messages as never);
		} finally {
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
					agent: "advisor",
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
					agent: "advisor",
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

	/** True when no batch is in flight and nothing is queued: the advisor has
	 *  reviewed everything pushed so far ("settled"). */
	get idle(): boolean {
		return !this.#busy && this.#pending.length === 0;
	}

	/** Whether the shared queue contains anything worth blocking a mid-run turn for. */
	get hasHighPriority(): boolean {
		return this.#advice.some((n) => isHighSeverity(n.severity));
	}

	#upsertAdvice(note: string, severity?: AdvisorSeverity): void {
		if (this.disposed) return;
		const key = dedupeKey(note);
		const existing = this.#advice.find((n) => dedupeKey(n.note) === key);
		if (!existing) this.#advice.push({ note, severity });
		else if (rankOf(severity) > rankOf(existing.severity)) existing.severity = severity;
	}

	/** Advisor observation: upsert and count as a genuine reconfirmation. */
	enqueueAdvice(note: string, severity?: AdvisorSeverity): void {
		if (this.disposed) return;
		this.#reraised?.add(dedupeKey(note));
		this.#upsertAdvice(note, severity);
	}

	/** Boundary bookkeeping: put advice back without faking a reconfirmation. */
	requeueAdvice(note: string, severity?: AdvisorSeverity): void {
		this.#upsertAdvice(note, severity);
	}

	/** Drain nits only; concerns/blockers remain queued for reconfirmation. */
	takeNits(): AdvisorNote[] {
		const nits = this.#advice.filter((n) => !isHighSeverity(n.severity));
		this.#advice = this.#advice.filter((n) => isHighSeverity(n.severity));
		return nits;
	}

	/** Drain every queued survivor after successful boundary reconciliation. */
	takeAllAdvice(): AdvisorNote[] {
		return this.#advice.splice(0);
	}

	/** Whether advice from the in-flight review is still valid (not orphaned by a
	 *  reset/dispose). The delivery layer consults this to drop late stale callbacks. */
	get acceptingAdvice(): boolean {
		return !this.disposed && this.#reviewEpoch === this.#epoch;
	}

	/**
	 * Resolve once the advisor has caught up (`idle`), or `timeoutMs` elapses, or
	 * `signal` aborts. Drives the per-turn catch-up block. Resolves "settled"
	 * immediately if already idle/disposed.
	 */
	waitUntilSettled(timeoutMs: number, signal?: AbortSignal): Promise<"settled" | "timeout" | "aborted" | "failed"> {
		if (this.disposed) return Promise.resolve("aborted");
		if (this.idle) return Promise.resolve(this.#lastOutcome === "failed" ? "failed" : "settled");
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
				// Fired when the drain reaches idle (a review completed).
				settle: () => {
					if (this.disposed) finish("aborted");
					else if (this.idle) finish(this.#lastOutcome === "failed" ? "failed" : "settled");
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
				// Latest request's input + cache reads ≈ current advisor context size.
				contextTokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			}
		}
		const window = (this.agent.state.model as { contextWindow?: number } | undefined)?.contextWindow;
		const contextPercent = window ? Math.round((contextTokens / window) * 100) : null;
		return { input, output, cost, contextTokens, contextPercent };
	}

	/** Queue a rendered primary-turn delta (markdown string) for review. */
	push(deltaText: string): void {
		if (this.disposed || !deltaText.trim()) return;
		this.#pending.push(deltaText);
		this.#backlog++;
		void this.#drain();
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
		this.#primedContext = undefined;
		this.#advice = [];
		this.#reraised = undefined;
		this.#lastOutcome = undefined;
		this.#backlog = 0;
		this.#failures = 0;
		// Full reset = fresh accounting (unlike #softReset, which preserves these).
		this.#cumInput = this.#cumOutput = this.#cumCost = 0;
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
		this.#primedContext = undefined;
		this.#advice = [];
		this.#reraised = undefined;
		this.#lastOutcome = undefined;
		this.#backlog = 0;
		try {
			this.agent.abort();
		} catch {}
		this.#cancelWaiters();
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: queue reconciliation, retries, and self-compaction share one runtime state machine.
	async #drain(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		try {
			while (!this.disposed && this.#pending.length) {
				if (this.#agentResetPending) this.#resetAgentWhenIdle();
				if (this.#agentResetPending) {
					this.onDebug?.("advisor private context still busy after history rewrite; dropping queued review");
					this.#pending = [];
					this.#backlog = 0;
					this.#lastOutcome = "failed";
					break;
				}
				const batch = this.#pending.splice(0);
				const turns = batch.length;
				// Rough gauge of how many turns are still unreviewed (status display only).
				this.#backlog = Math.max(0, this.#backlog - turns);
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
				const messages = buildReviewMessages(preamble, batch, primedContext);
				const promptChars = messages.reduce(
					(n, m) =>
						n +
						(Array.isArray(m.content)
							? m.content.reduce(
									(k: number, b: { type: string; text?: string }) =>
										k + (b.type === "text" ? (b.text?.length ?? 0) : 0),
									0,
								)
							: 0),
					0,
				);
				// A review "fails" either by throwing OR — the common case — by resolving
				// with an assistant message whose stopReason is "error"/"aborted" (the agent
				// loop records provider failures that way instead of throwing). A failed
				// review must NOT prune queued advice (we'd drop it as if recanted).
				let failed = false;
				// PROACTIVE self-compaction: if our own context has crossed the budget,
				// clear the agent history now so this batch replays into a fresh context
				// (queued advice survives via the reconfirm preamble) instead of marching into
				// an overflow. Skipped when already fresh (nothing to reclaim).
				const pct = this.usage.contextPercent;
				if (pct !== null && pct >= this.compactAtPercent && this.agent.state.messages.length > 0) {
					this.onDebug?.("advisor self-compacting (proactive), ctx=", pct, "% >=", this.compactAtPercent, "%");
					this.#softReset();
				}
				let stale = false;
				try {
					// Inner loop: at most ONE reactive self-compaction retry. If the
					// advisor's own context overflows mid-review (stopReason "length"), clear
					// its history and replay THIS batch into a fresh context instead of
					// counting a failure and retrying 3x into the same wall. Loop-safe: a
					// fresh replay that STILL overflows means the single batch genuinely
					// doesn't fit, so it falls through to the failed handling below.
					let last: AssistantMessage | undefined;
					for (let attempt = 0; attempt < 2; attempt++) {
						this.onDebug?.("prompting advisor agent, delta chars=", promptChars, "held=", offered.length);
						const trigger = attempt > 0 ? "turn_end_replay" : this.#failures > 0 ? "turn_end_retry" : "turn_end";
						await this.#promptAndRecord(messages, trigger);
						if (this.#epoch !== epoch) {
							stale = true;
							break; // reset/dispose during the prompt; batch is stale
						}
						last = this.agent.state.messages[this.agent.state.messages.length - 1] as AssistantMessage;
						if (last?.stopReason === "length" && attempt === 0) {
							this.onDebug?.("advisor context overflow, self-compacting (reactive) and replaying batch fresh");
							this.#softReset();
							// Roll back attempt-only queue mutations by intersection. Concurrently
							// drained entries stay gone; surviving pre-attempt entries regain severity.
							const before = new Map(offered.map((n) => [dedupeKey(n.note), n]));
							this.#advice = this.#advice.flatMap((current) => {
								const prior = before.get(dedupeKey(current.note));
								return prior ? [{ ...current, severity: prior.severity }] : [];
							});
							this.#reraised = new Set();
							continue;
						}
						break;
					}
					if (stale) {
						this.#reraised = undefined;
						if (this.#agentResetPending) this.#resetAgentWhenIdle();
						continue;
					}
					if (last?.stopReason === "error" || last?.stopReason === "aborted" || last?.stopReason === "length") {
						// error/aborted = provider failure (recorded, not thrown); length =
						// truncated review (a fresh replay still didn't fit) — in all three the
						// advisor didn't finish, so don't prune queued advice on its accidental
						// "silence".
						this.onDebug?.("advisor review incomplete, stop=", last?.stopReason, "err=", last?.errorMessage ?? "-");
						failed = true;
					} else {
						// Success: prune offered queue entries the advisor stayed silent on.
						for (const key of offeredKeys) {
							if (!this.#reraised?.has(key)) {
								const i = this.#advice.findIndex((n) => dedupeKey(n.note) === key);
								if (i >= 0) this.#advice.splice(i, 1);
							}
						}
						if (this.#primedContext === primedContext) this.#primedContext = undefined;
						this.#lastOutcome = "ok";
						this.#failures = 0;
						this.onDebug?.("advisor turn done, stop=", last?.stopReason);
					}
					this.#reraised = undefined;
				} catch (e) {
					this.#reraised = undefined;
					this.onDebug?.("advisor prompt threw", String(e));
					// A reset/dispose aborts the in-flight prompt; drop the stale batch.
					// Held notes were never removed, so nothing to restore there.
					if (this.#epoch !== epoch) continue;
					failed = true;
				}
				if (failed) {
					this.#failures++;
					if (this.#failures >= 3) {
						// Gave up reconfirming this batch. Mark failed so waitUntilSettled
						// reports it (don't deliver held notes as if confirmed).
						this.#failures = 0;
						this.#lastOutcome = "failed";
					} else {
						this.#pending.unshift(...batch);
						this.#backlog += turns;
						await new Promise((r) => setTimeout(r, this.retryDelayMs));
					}
				}
			}
		} finally {
			this.#busy = false;
			if (this.idle) {
				this.#notifySettled();
				try {
					this.onSettled?.(this.#lastOutcome === "failed" ? "failed" : "ok");
				} catch (e) {
					this.onDebug?.("advisor onSettled callback threw", String(e));
				}
			}
		}
	}
}

// ===========================================================================
// Extension wiring
// ===========================================================================

// Footer status key. Statuses are ordered alphabetically by key; "q-advisor"
// sorts after "permissions"/"provider-system-prompt" but before "sub-bar", so
// Advisor shows as a middle segment. Change this to reposition it (e.g.
// "a-advisor" for leftmost).
const STATUS_KEY = "q-advisor";

/**
 * Footer label + cost for the given reviewing state. `reviewing` distinguishes
 * a live review in flight from idle so a glance at the footer always answers
 * "is it still working" — the persistent, self-resolving signal that replaces
 * the old one-shot "catching up" toast (which never resolved on a silent settle).
 */
export function formatAdvisorFooterText(reviewing: boolean, costUsd: number): string {
	return `${reviewing ? "Advisor (reviewing)" : "Advisor"}: $${costUsd.toFixed(2)}`;
}
const DEBUG = !!process.env.ADVISOR_DEBUG;
const dbg = (...a: unknown[]) => {
	if (DEBUG) console.error("[advisor]", ...a);
};
const BLOCK_BASE_MS = 15_000;
const BLOCK_CAP_MS = 120_000;

// Set by the handoff extension (pi-amplike) via the same Symbol.for key while a
// handoff is in flight — from the moment it becomes pending until the new
// session's prompt has been dispatched. During that window the primary session
// is being torn down / replaced and its deferred handoff prompt is racing to be
// sent, so the advisor must not inject messages or (worse) trigger an
// autonomous turn: doing so either crashes the handoff ("Agent is already
// processing") or leaks a stray advisory into the brand-new session.
const HANDOFF_IN_PROGRESS_KEY = Symbol.for("pi-amplike-handoff-in-progress");
function handoffInProgress(): boolean {
	return !!(globalThis as any)[HANDOFF_IN_PROGRESS_KEY];
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

import {
	appendPrimaryAdvisorPrompt,
	DEFAULT_ADVISOR_MODEL,
	DEFAULT_ADVISOR_PROVIDER,
	DEFAULT_THINKING,
	loadEnabled,
	loadSystemPrompt,
	saveEnabled,
} from "./config.js";

export { appendPrimaryAdvisorPrompt, loadSystemPrompt, PRIMARY_ADVISOR_PROTOCOL } from "./config.js";

// Wraps an advisory card's body in a severity-colored left rule (one line prefix
// per rendered row), matching the bordered-card convention read from richer
// third-party advisor UIs during UX research. Pure layout: no state of its own.
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
	let enabled = loadEnabled();

	// Lazily-built advisor state, rebuilt when cwd/model changes or session resets.
	let runtime: AdvisorRuntime | undefined;
	let activeModelLabel: string | undefined;
	let builtForCwd: string | undefined;
	let stagedReprime: string | undefined;
	let reprimeAfterHandoff = false;

	// Delta accumulation across the lifecycle.
	let pendingUserPrompt: string | undefined;

	// The advise tool bound to the live runtime (held so the catch-up block can
	// mark held notes delivered at the actual delivery point).
	let adviseTool: AdviseTool | undefined;

	// Consecutive mid-run catch-up blocks, for the backoff (reset when the advisor
	// settles or a turn doesn't need to block).
	let consecutiveBlocks = 0;

	// Set when the user aborts (Escape) around a catch-up block: while true, late
	// advisor advice is delivered WITHOUT triggerTurn so it can't auto-resume the run
	// the user just stopped. Cleared when the user drives the next turn.
	let autoResumeSuppressed = false;

	// One source of truth for which primary boundary a queue flush belongs to.
	let turnState: PrimaryTurnState = "ended-nonterminal";

	// Most recent ctx seen from any hook that carries one. `updateStatus` needs this
	// so the runtime's async `onSettled` callback — which fires whenever a review
	// completes, not just at turn_end — can refresh the footer without waiting for
	// the next primary-turn event. That is the actual fix for the reported UX gap:
	// the old transient "catching up" notify had no matching "done" signal, so a
	// silent settle was indistinguishable from a stuck advisor. A persistent,
	// self-resolving footer state removes the need for a terminal message at all.
	let latestCtx: unknown;

	// ---- statusbar: per-session advisor cost + live reviewing/idle state ----
	// Reflects the live advisor lifetime cost (rt.usage.cost) and whether a review
	// is currently in flight (`Advisor (reviewing): $N` vs `Advisor: $N`) in the
	// footer status bar. Cleared when the advisor is off or torn down.
	//
	// Footer ordering: pi sorts extension statuses alphabetically BY KEY and joins
	// them with a single space (no separators of its own). So the key controls
	// position and we draw our own `│` divider in the text. STATUS_KEY sorts after
	// "permissions"/"provider-system-prompt" but before "sub-bar", placing Advisor as
	// a middle segment rather than the leftmost.
	//
	// LEADING bar only (no trailing): whatever follows draws its own separator
	// (e.g. pi-sub-bar with statusLeadingDivider:true starts with `│`), so a trailing
	// bar here would double up (`│ Advisor │ │ …`).
	function updateStatus(ctx: unknown): void {
		latestCtx = ctx;
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
		ui.setStatus(STATUS_KEY, `${bar} ${formatAdvisorFooterText(!runtime.idle, runtime.usage.cost)}`);
	}

	// ---- advice delivery into the primary session ----
	function sendNit(note: string, severity: AdvisorSeverity | undefined, finalAnswer: boolean): void {
		const notes: AdvisorNote[] = [{ note, severity }];
		const content = formatAdvisoryContent(notes, { stale: true, finalAnswer });
		pi.sendMessage(
			{ customType: ADVISORY_TYPE, content, display: true, details: { notes } },
			{ deliverAs: "steer", triggerTurn: !autoResumeSuppressed },
		);
	}

	// The only immediate boundary flush: non-terminal turns drain queued nits.
	// Concerns/blockers stay in the same queue for review reconfirmation.
	function flushNits(rt: AdvisorRuntime | undefined): void {
		if (!rt || handoffInProgress()) return;
		for (const n of rt.takeNits()) {
			sendNit(n.note, n.severity, false);
			adviseTool?.markDelivered(n.note, n.severity);
		}
	}

	// Advisor callbacks only enqueue. Delivery policy lives at primary boundaries,
	// where terminality and reconfirmation state are actually known.
	function deliverAdvice(note: string, severity?: AdvisorSeverity, sourceRuntime?: AdvisorRuntime): boolean {
		// Stand down entirely while a handoff is being performed (see comment on
		// HANDOFF_IN_PROGRESS_KEY).
		if (handoffInProgress()) {
			dbg("handoff in progress, dropping advice", severity, JSON.stringify(note).slice(0, 80));
			// False means "not delivered", so AdviseTool does not poison the fresh
			// session's dedup map with a dropped callback.
			return false;
		}
		// Drop late callbacks the session has moved past: advisor turned off, or a
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

		// Hidden no-model test hook only: production advisor callbacks always have the
		// runtime that created their AdviseTool. Keep idle command testing convenient.
		if (!isHighSeverity(severity) && turnState !== "running") {
			sendNit(note, severity, turnState === "ended-terminal");
			return true;
		}
		return false;
	}

	// ---- steer held survivors into the primary (called by the catch-up block) ----
	function deliverHeld(notes: AdvisorNote[], opts?: { terminal?: boolean }): void {
		if (handoffInProgress() || !notes.length) return;
		// A held note restates iff it is delivered from a terminal turn's catch-up.
		// turnState was set synchronously at turn_end before the block began.
		const finalAnswer = turnState === "ended-terminal";
		if (opts && opts.terminal !== undefined && opts.terminal !== finalAnswer)
			dbg("deliverHeld: opts.terminal diverged from turnState", opts.terminal, turnState);
		for (const n of notes) {
			dbg("deliverHeld", n.severity, JSON.stringify(n.note).slice(0, 120));
			const content = formatAdvisoryContent([n], { finalAnswer, stale: !isHighSeverity(n.severity) });
			pi.sendMessage(
				{ customType: ADVISORY_TYPE, content, display: true, details: { notes: [n] } },
				{ deliverAs: "steer", triggerTurn: !autoResumeSuppressed },
			);
			// Record at the real delivery point (onAdvice→false never recorded it), so a
			// later same-or-lower-severity repeat is deduped.
			adviseTool?.markDelivered(n.note, n.severity);
		}
	}

	// Reviews can finish after a primary turn_end timeout. Reuse the same boundary
	// policy instead of creating a late-callback delivery path. This synchronous
	// callback drains before a runTurnBlock waiter resumes; the latter then sees empty.
	function flushSettledAdvice(outcome: "ok" | "failed"): void {
		if (outcome !== "ok" || !runtime || handoffInProgress()) return;
		if (turnState === "ended-terminal") {
			const notes = runtime.takeAllAdvice();
			if (notes.length) deliverHeld(notes, { terminal: true });
		} else if (turnState === "ended-nonterminal") {
			flushNits(runtime);
		}
	}

	function teardown(): void {
		runtime?.dispose();
		runtime = undefined;
		adviseTool = undefined;
		activeModelLabel = undefined;
		builtForCwd = undefined;
		stagedReprime = undefined;
		reprimeAfterHandoff = false;
		pendingUserPrompt = undefined;
		consecutiveBlocks = 0;
		autoResumeSuppressed = false;
		turnState = "ended-nonterminal";
	}

	function currentSessionContext(ctx: { sessionManager: { buildContextEntries(): SessionEntry[] } }): string {
		try {
			return formatActiveSessionContext(ctx.sessionManager.buildContextEntries());
		} catch (error) {
			dbg("could not build advisor re-prime context", String(error));
			return "";
		}
	}

	// Clear advisor-local state after the primary transcript changes, then stage
	// Pi's active (compaction-aware) context for the next real review. Priming is
	// passive: it never prompts the advisor or emits advice on its own.
	function resetAdvisorState(contextText = ""): void {
		const primed = contextText.trim() || undefined;
		if (runtime) {
			runtime.reprime(primed ?? "");
			stagedReprime = undefined;
		} else {
			stagedReprime = primed;
		}
		pendingUserPrompt = undefined;
		consecutiveBlocks = 0;
		autoResumeSuppressed = false;
		turnState = "ended-nonterminal";
	}

	function reprimeFromSession(ctx: { sessionManager: { buildContextEntries(): SessionEntry[] } }): void {
		resetAdvisorState(currentSessionContext(ctx));
	}

	// ---- build the advisor agent lazily (needs ctx for model/registry/cwd) ----
	async function ensureRuntime(ctx: {
		cwd: string;
		modelRegistry: any;
		model: any;
		isProjectTrusted(): boolean;
	}): Promise<AdvisorRuntime | undefined> {
		if (runtime && builtForCwd === ctx.cwd) return runtime;
		if (runtime && builtForCwd !== ctx.cwd) teardown();

		if (!ctx.model) return undefined;

		const projectTrusted = ctx.isProjectTrusted();
		// Resolve advisor model: a trusted project's modes.json first, then the
		// user-global mode, else the default.
		let model: any;
		let thinkingLevel = DEFAULT_THINKING;
		try {
			const resolved = await resolveModelAndThinking(
				ctx.cwd,
				ctx.modelRegistry,
				ctx.model,
				DEFAULT_THINKING,
				{ mode: "advisor" },
				projectTrusted,
			);
			// An explicitly configured advisor model is valid even when it happens to
			// be the same object as the primary model. Without one, use our hard default.
			model = resolved.explicitModel ? resolved.model : undefined;
			thinkingLevel = resolved.thinkingLevel || DEFAULT_THINKING;
		} catch {}
		if (!model) {
			model = ctx.modelRegistry.find(DEFAULT_ADVISOR_PROVIDER, DEFAULT_ADVISOR_MODEL);
		}
		if (!model) return undefined;

		let builtRuntime!: AdvisorRuntime;
		const builtAdviseTool = new AdviseTool((note, severity) => deliverAdvice(note, severity, builtRuntime));
		adviseTool = builtAdviseTool;
		const agent = buildAdvisorAgent({
			cwd: ctx.cwd,
			model,
			thinkingLevel,
			systemPrompt: loadSystemPrompt(ctx.cwd, projectTrusted),
			modelRegistry: ctx.modelRegistry,
			adviseTool: builtAdviseTool,
		});
		// ADVISOR_COMPACT_AT: % of the advisor's context window at which it self-
		// compacts (clamped 50..95; default 80).
		const compactAt = Math.min(95, Math.max(50, Number(process.env.ADVISOR_COMPACT_AT) || 80));
		builtRuntime = new AdvisorRuntime(agent, builtAdviseTool, 1000, dbg, compactAt, (outcome) => {
			// A disposed/replaced runtime may settle late; never let it flush the new one.
			if (runtime !== builtRuntime) return;
			flushSettledAdvice(outcome);
			// Refresh the footer the moment this settle happens, not just at the next
			// turn_end — a background review can finish while the primary keeps running.
			if (latestCtx) updateStatus(latestCtx);
		});
		runtime = builtRuntime;
		if (stagedReprime) builtRuntime.reprime(stagedReprime);
		stagedReprime = undefined;
		activeModelLabel = `${model.provider}/${model.id}`;
		builtForCwd = ctx.cwd;
		dbg("built advisor runtime, model=", activeModelLabel);
		return runtime;
	}

	// ---- event wiring ----

	// User preflight happens before Pi starts streaming, so mark the turn running
	// here as well as at turn_start. This closes the only real pre-turn window without
	// consulting isIdle() or maintaining a second terminal flag. Also append the
	// primary-agent protocol so weaker models actually handle steered advisories.
	pi.on("before_agent_start", (event, ctx) => {
		if (!enabled) return;
		if (reprimeAfterHandoff) {
			reprimeAfterHandoff = false;
			reprimeFromSession(ctx);
		}
		autoResumeSuppressed = false;
		turnState = "running";
		pendingUserPrompt = event.prompt;
		return { systemPrompt: appendPrimaryAdvisorPrompt(event.systemPrompt ?? "") };
	});

	// Fires for every assistant turn, including advisory-triggered runs and same-run
	// continuations. Every real turn_start is paired with turn_end (also on failure).
	pi.on("turn_start", () => {
		if (!enabled) return;
		turnState = "running";
	});

	// One delta per primary turn (assistant message + its tool results). After
	// pushing, run the catch-up block: this hook is awaited by the agent loop, so
	// awaiting here stalls the primary's next step until the advisor catches up.
	pi.on("turn_end", async (event, ctx) => {
		if (!enabled) return;

		// This is the authoritative boundary: Pi has finalized the assistant message,
		// and any steer observed during `running` will be inserted immediately after it.
		// Set state before any await so concurrent advisor callbacks see the result.
		const terminal = isTerminalTurn(event.message as any);
		turnState = terminal ? "ended-terminal" : "ended-nonterminal";

		// Test seam: skip live model review. The hidden command delivers directly when
		// no runtime exists, so no queue work is needed here.
		if (process.env.ADVISOR_NO_REVIEW) return;

		const rt = await ensureRuntime(ctx as any);
		dbg("turn_end", "state=", turnState, "enabled=", enabled, "runtime=", !!rt, "model=", activeModelLabel);
		if (!rt) return;

		// At a non-terminal boundary, queued nits preserve their low-latency behavior.
		// At a terminal boundary they remain in the SAME queue and ride the final
		// review's reconfirmation preamble alongside concerns/blockers.
		if (!terminal) flushNits(rt);

		const delta = formatTurnDelta({
			userPrompt: pendingUserPrompt,
			assistant: event.message as AssistantMessage,
			toolResults: event.toolResults as ToolResultMessage[],
		});
		pendingUserPrompt = undefined;
		rt.setUsageSession(sessionIdFromCtx(ctx));
		rt.push(delta);

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
			deliverHeld,
		});
		// If the user aborted (Escape) around the block, suppress auto-resume so a late
		// advisor callback from the still-running review can't restart the stopped run.
		if ((ctx as any).signal?.aborted) autoResumeSuppressed = true;
		// Refresh the footer cost after the advisor caught up (review cost is now in).
		updateStatus(ctx);
	});

	// Re-prime the advisor whenever Pi replaces the primary's active context.
	pi.on("session_compact", (_event, ctx) => {
		reprimeFromSession(ctx);
		updateStatus(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		reprimeFromSession(ctx);
		updateStatus(ctx);
	});
	pi.on("session_start", (_event, ctx) => {
		// This also covers startup/reload: a newly loaded extension has no private
		// advisor history yet, but the primary session may already have active context.
		reprimeFromSession(ctx);
		updateStatus(ctx);
	});

	// Tool-path handoff replaces the transcript without a session_start event and
	// does not provide a context here. Reset now; capture the new session from the
	// first before_agent_start callback, before its prompt is recorded.
	pi.events.on(HANDOFF_SESSION_REPLACED_CHANNEL, () => {
		resetAdvisorState();
		reprimeAfterHandoff = true;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		teardown();
		(ctx as { ui?: { setStatus?: (k: string, t: string | undefined) => void } }).ui?.setStatus?.(STATUS_KEY, undefined);
	});

	// ---- advisory card rendering ----
	// Bordered card (severity-colored left rule, bold "Advisor <SEVERITY>" heading,
	// body in the default readable `text` color) replacing the single dim inline
	// line, matching the visual clarity of richer third-party advisor UIs surveyed
	// during UX research. `text` (not `muted`/`dim`) for the body follows the same
	// contrast rationale as the conversation-viewer fix: dim is nearly invisible in
	// the dark theme and this is content the user is meant to read.
	pi.registerMessageRenderer<{ notes: AdvisorNote[] }>(ADVISORY_TYPE, (message, _options, theme) => {
		const notes = message.details?.notes;
		if (!notes?.length) return undefined;
		const container = new Container();
		for (const [index, n] of notes.entries()) {
			if (index > 0) container.addChild(new Spacer(1));
			const color = n.severity === "blocker" ? "error" : n.severity === "concern" ? "warning" : "accent";
			const tag = (n.severity ?? "nit").toUpperCase();
			const card = new Container();
			card.addChild(new Text(`${theme.fg(color, theme.bold("Advisor"))} ${theme.fg(color, tag)}`, 0, 0));
			card.addChild(new Spacer(1));
			card.addChild(new Text(theme.fg("text", n.note), 0, 0));
			container.addChild(new AdvisoryBorder(card, theme.fg(color, "│")));
		}
		return container;
	});

	// ---- /advisor command ----
	pi.registerCommand("advisor", {
		description: "Toggle/inspect the advisor (a second model that reviews each turn). Usage: /advisor [on|off|status]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "status" || arg === "") {
				const state = enabled ? "enabled" : "disabled";
				if (!enabled) {
					ctx.ui.notify(`advisor ${state}`, "info");
					updateStatus(ctx);
					return;
				}
				const rt = await ensureRuntime(ctx as any);
				if (!rt) {
					ctx.ui.notify(`advisor enabled but no advisor model is available`, "warning");
					return;
				}
				updateStatus(ctx);
				const u = rt.usage;
				const ctxStr =
					u.contextPercent !== null ? `${u.contextPercent}% (${u.contextTokens} tok)` : `${u.contextTokens} tok`;
				ctx.ui.notify(
					`advisor ${state} — model ${activeModelLabel}, backlog ${rt.backlog}, ` +
						`tokens ${u.input}in/${u.output}out, cost $${u.cost.toFixed(4)}, ctx ${ctxStr}`,
					"info",
				);
				return;
			}

			if (arg === "on") {
				enabled = true;
				saveEnabled(true);
				if (!runtime) stagedReprime = currentSessionContext(ctx);
				const rt = await ensureRuntime(ctx as any);
				updateStatus(ctx);
				ctx.ui.notify(
					rt ? `advisor on — ${activeModelLabel}` : `advisor on, but no advisor model available`,
					rt ? "info" : "warning",
				);
				return;
			}
			if (arg === "off") {
				enabled = false;
				saveEnabled(false);
				teardown();
				updateStatus(ctx);
				ctx.ui.notify("advisor off", "info");
				return;
			}

			// Hidden test hook. An idle nit delivers directly so it remains useful even
			// before the runtime's first review; running/high-severity cases use the queue.
			if (arg.startsWith("test")) {
				const parsed = parseAdvisorTestArgs(args);
				if (!parsed) {
					ctx.ui.notify("usage: /advisor test <nit|concern|blocker> <note>", "warning");
					return;
				}
				if (parsed.severity === "nit" && turnState !== "running")
					sendNit(parsed.note, parsed.severity, turnState === "ended-terminal");
				else deliverAdvice(parsed.note, parsed.severity);
				return;
			}

			ctx.ui.notify("usage: /advisor [on|off|status]", "warning");
		},
	});
}
