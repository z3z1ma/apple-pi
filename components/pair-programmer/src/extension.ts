/**
 * /pair — persistent read-only supervision of the main agent's work.
 * The pair programmer is the sole persistent watcher and can submit typed hypotheses to a
 * host-controlled, non-recursive consultant consultation.
 *
 * Delivery model. Every advise() call enters one shared output queue. The pair programmer's
 * review and primary execution remain independent. At an assistant-turn boundary,
 * ready advice is sent through `steer`, which places it before the main agent's next
 * step without aborting the response in flight. Terminal advice can trigger a
 * correction run after settlement. An advisory-triggered correction run is still
 * consumed while recursive terminal output stays suppressed.
 *
 * Why every finding is held once: the pair reviews turn N asynchronously, so by
 * the time advice could land the primary has usually done follow-up work. The
 * next successful frontier review must reconfirm it before nonterminal delivery
 * (held notes ride a reconfirmation preamble; silence withdraws them). Findings
 * first raised by the review covering the terminal turn are current and can land
 * without another otherwise-impossible review.
 *
 * The pair programmer's review is fully asynchronous: each completed primary turn appends an
 * immutable spool delta, no primary turn waits for pair programmer work, and the reader
 * advances its committed frontier only after a successful transactional review.
 * The persistent footer reports review activity without a blocking toast.
 *
 * An optional PAIR.md in a trusted cwd is appended to the pair's system
 * prompt (pair-only guidance: review priorities, project traps).
 *
 * While enabled, `before_agent_start` appends a short protocol to the primary
 * agent's system prompt so it knows how to treat nit/concern/blocker notes,
 * including repeats. That text is for the agent being reviewed, not the pair.
 */

import type { Agent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
import {
	formatPairAcknowledgmentReminder,
	identifyMaterialPairNotes,
	PAIR_ACK_REMINDER_TYPE,
	PAIR_FINDING_ACKNOWLEDGED,
	PAIR_FINDING_UNACKNOWLEDGED,
	PairAcknowledgmentTracker,
	type PairFindingAcknowledgment,
	pairFindingId,
} from "./acknowledgments.js";
import {
	EscalateTool,
	type EscalationAcceptance,
	PairEscalationController,
	RepeatedFailureDetector,
} from "./escalation.js";
import type { PrimarySessionManager } from "./recall.js";
import { buildPairSeed, formatSourceAddressedTrajectory, type SettledAdvice } from "./seed.js";
import { createPairSession } from "./session.js";

// ===========================================================================
// Pair programmer core — persistent second model that watches the main agent.
//
// Port of oh-my-pi's pair onto upstream pi's public extension surface. The
// pair is a long-lived `Agent` with its own model, read-only tools
// (read/grep/find, primary-bound revisit_note/search_session), and private
// advise/escalate/update_notebook capabilities. It is fed the primary transcript one
// turn-delta at a time and may inject concise advice back. It is NOT an
// executor: it cannot edit, run commands, or change session state.
// ===========================================================================

export type { PairFindingAcknowledgment, PairFindingDisposition, PendingPairFinding } from "./acknowledgments.js";
export {
	formatPairAcknowledgmentReminder,
	identifyMaterialPairNotes,
	PairAcknowledgmentTracker,
	pairFindingId,
} from "./acknowledgments.js";
export type { PairNote, PairSeverity } from "./types.js";

import type { PairEscalation, PairEscalationState, PairNote, PairSeverity, PrimaryTurnState } from "./types.js";

const ADVISORY_TYPE = "advisory";

type PreparedBoundaryFinding = {
	note: PairNote;
	dedupeKeys?: readonly string[];
	commit(delivered: boolean, retainIdentity?: boolean): void;
};

const findingIdentity = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Commit direct pair programmer and prepared consultant findings through one outbound batch. */
export function deliverBoundaryBatch(args: {
	direct: PairNote[];
	advisor?: PreparedBoundaryFinding;
	knownKeys?: ReadonlySet<string>;
	send(notes: PairNote[]): void;
	onDirectDelivered(note: PairNote): void;
	onDirectFailed(note: PairNote): void;
}): boolean {
	const directKeys = new Set(args.direct.map((note) => findingIdentity(note.note)));
	const advisorDuplicate = args.advisor?.dedupeKeys?.some(
		(key) => directKeys.has(findingIdentity(key)) || args.knownKeys?.has(findingIdentity(key)),
	);
	const notes = [...args.direct, ...(args.advisor && !advisorDuplicate ? [args.advisor.note] : [])];
	if (notes.length === 0) {
		if (advisorDuplicate) args.advisor?.commit(false, true);
		return false;
	}
	try {
		args.send(notes);
		for (const note of args.direct) args.onDirectDelivered(note);
		if (advisorDuplicate) args.advisor?.commit(false, true);
		else args.advisor?.commit(true);
		return true;
	} catch (error) {
		for (const note of args.direct) args.onDirectFailed(note);
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
	finding_id: Type.Optional(
		Type.String({
			description:
				"The host-provided id of an earlier nit, concern, or blocker that still applies. Use only an id shown in the reconfirmation list.",
			pattern: "^pair-[a-f0-9]{12}$",
		}),
	),
});

const pairAcknowledgmentSchema = Type.Object({
	findings: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1 }),
			disposition: Type.Union([Type.Literal("address"), Type.Literal("decline"), Type.Literal("defer")]),
			reason: Type.String({ minLength: 1, maxLength: 500 }),
		}),
		{ minItems: 1 },
	),
});

const SEVERITY_RANK: Record<PairSeverity, number> = { nit: 1, concern: 2, blocker: 3 };
const rankOf = (s: PairSeverity | undefined): number => SEVERITY_RANK[s ?? "nit"];
const dedupeKey = (note: string): string => note.trim().replace(/\s+/g, " ");
const pairNoteKey = (note: Pick<PairNote, "id" | "note">): string => note.id ?? dedupeKey(note.note);
/** Concerns and blockers retain priority metadata, but all severities share delivery policy. */
export const isHighSeverity = (s: PairSeverity | undefined): boolean => s === "concern" || s === "blocker";

/** A turn without tool calls is the agent loop's terminal response candidate. */
export function isTerminalTurn(message: { content?: ReadonlyArray<{ type?: string }> } | undefined): boolean {
	return !(message?.content ?? []).some((part) => part.type === "toolCall");
}

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
		"Share one concise, actionable finding with your pair programming partner when you see something that could materially improve or protect the work. Consolidate symptoms that share one root cause, but keep distinct material issues separate. Do not manage implementation, narrate status, acknowledge progress, praise, summarize, or say that everything looks good or an earlier issue is resolved. Use ask_consultant instead of also sharing the same issue when it needs deep independent judgment.";
	readonly parameters = adviseSchema as any;
	#delivered = new Map<string, number>();

	// onAdvice returns true if delivered, false if queued or dropped.
	constructor(
		private readonly onAdvice: (note: string, severity?: PairSeverity, findingId?: string) => boolean,
		private readonly canonicalizeFindingId?: (note: string, findingId?: string) => string | undefined,
	) {}

	resetDelivered(): void {
		this.#delivered.clear();
	}

	/**
	 * Record a note as delivered so a later same-or-lower-severity repeat is
	 * deduped. Called by boundary delivery when it steers a held note in (held
	 * notes go through `onAdvice`→false, which intentionally does NOT record, so
	 * the actual delivery point must).
	 */
	markDelivered(note: string, severity?: PairSeverity, findingId?: string): void {
		const rank = rankOf(severity);
		this.#delivered.set(dedupeKey(note), rank);
		if (findingId) this.#delivered.set(findingId, rank);
	}

	async execute(
		_id: string,
		args: { note: string; severity?: PairSeverity; finding_id?: string },
	): Promise<AgentToolResult<unknown>> {
		const findingId = this.canonicalizeFindingId
			? this.canonicalizeFindingId(args.note, args.finding_id)
			: args.finding_id;
		const canonicalArgs = { ...args, finding_id: findingId };
		const key = findingId ?? dedupeKey(args.note);
		const rank = rankOf(args.severity);
		const prev = Math.max(this.#delivered.get(key) ?? 0, this.#delivered.get(dedupeKey(args.note)) ?? 0);
		if (rank <= prev) {
			return {
				content: [{ type: "text", text: "You already shared an equivalent note." }],
				details: { ...canonicalArgs, dropped: true },
			};
		}
		const delivered = this.onAdvice(args.note, args.severity, findingId);
		if (!delivered) {
			// Not recorded: it is queued for a boundary or dropped as stale.
			return {
				content: [{ type: "text", text: "Your note will be shared at the next safe moment if it still applies." }],
				details: { ...canonicalArgs, held: true },
			};
		}
		this.#delivered.set(key, rank);
		this.#delivered.set(dedupeKey(args.note), rank);
		return { content: [{ type: "text", text: "Your note was shared." }], details: canonicalArgs };
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
	MIN_TURNS_BETWEEN_CONSULTANT,
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

// ---- PairRuntime — drives the pair agent off primary turn deltas ----

/**
 * Feeds the persistent pair conversation one delta per primary turn.
 * Identity change uses `reset()`. Overflow uses the pair session compact hook.
 */
type PendingDelta = Readonly<{
	sequence: number;
	text: string;
	boundary?: number;
	notebookBatch?: PairNotebookBatch;
}>;
type AttemptEffects = { advice: PairNote[]; escalations: PairEscalation[] };

/** Ordered input ownership shared across pair programmer runtime construction and replacement. */
export class PairSpool {
	#pending: PendingDelta[] = [];
	#claimedCount = 0;
	#writerFrontier = 0;
	#committedFrontier = 0;
	#committedBoundary = 0;

	append(text: string, opts?: { boundary?: number; notebookBatch?: PairNotebookBatch }): number | undefined {
		if (!text.trim()) return undefined;
		const sequence = ++this.#writerFrontier;
		this.#pending.push(
			Object.freeze({
				sequence,
				text,
				...(opts?.boundary === undefined ? {} : { boundary: opts.boundary }),
				...(opts?.notebookBatch ? { notebookBatch: opts.notebookBatch } : {}),
			}),
		);
		return sequence;
	}

	claim(): readonly PendingDelta[] {
		if (this.#claimedCount === 0) this.#claimedCount = this.#pending.length;
		return this.#pending.slice(0, this.#claimedCount);
	}

	commit(claim: readonly PendingDelta[]): void {
		if (!claim.length) return;
		for (let index = 0; index < claim.length; index++) {
			if (this.#pending[index]?.sequence !== claim[index]?.sequence) {
				throw new Error("pair programmer spool commit does not match its contiguous pending prefix");
			}
		}
		this.#pending.splice(0, claim.length);
		this.#claimedCount = 0;
		this.#committedFrontier = claim.at(-1)!.sequence;
		for (const item of claim) {
			if (item.boundary !== undefined) this.#committedBoundary = item.boundary;
		}
	}

	reset(): void {
		this.#pending = [];
		this.#claimedCount = 0;
		this.#writerFrontier = 0;
		this.#committedFrontier = 0;
		this.#committedBoundary = 0;
	}

	get backlog(): number {
		return this.#writerFrontier - this.#committedFrontier;
	}

	get committedBoundary(): number {
		return this.#committedBoundary;
	}

	get hasPending(): boolean {
		return this.#pending.length > 0;
	}
}

export class PairRuntime {
	#primedContext: string | undefined;
	#rolling: SettledAdvice[] = [];
	#needsSeed = true;
	// Newly observed findings wait here until a newer successful frontier review.
	#advice: PairNote[] = [];
	// Reconfirmed findings wait separately for the next safe delivery boundary.
	#readyAdvice: PairNote[] = [];
	// Keys re-raised during the in-flight review; drives the post-review prune.
	#reraised: Set<string> | undefined;
	#offeredFindingIds: Set<string> | undefined;
	// Outcome of the most recently completed drain batch. Lets deterministic
	// settlement observers distinguish a genuine settle from a failed review.
	#lastOutcome: "ok" | "failed" | undefined;
	// Epoch of the in-flight review; advice callbacks are honored only while it still
	// matches #epoch. A reset/dispose bumps #epoch, orphaning a stale review whose
	// late advise() calls would otherwise leak into the moved-on session.
	#reviewEpoch = -1;
	#attemptEffects: AttemptEffects | undefined;
	#settleWaiters: Array<{ settle: () => void; cancel: () => void }> = [];
	#busy = false;
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
		_retryDelayMs = 1000,
		private readonly onDebug?: (...a: unknown[]) => void,
		private readonly onSettled?: (outcome: "ok" | "failed", reviewedThrough: number) => void,
		private readonly session?: {
			prompt(text: string): Promise<void>;
			abort?: () => Promise<void> | void;
			dispose?: () => void;
		},
		private readonly seed?: () => string,
		private readonly notebookTool?: UpdateNotebookTool,
		private readonly onNotebookUpdate?: (update: PairNotebookUpdate) => void,
		private readonly onEscalation?: (request: PairEscalation) => EscalationAcceptance,
		private readonly spool = new PairSpool(),
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
		const prompt = this.session
			? this.session.prompt(this.#reviewText(messages, seed))
			: this.agent.prompt(
					(seed?.trim() && messages[0]
						? [
								{
									role: "user" as const,
									content: [{ type: "text" as const, text: seed }],
									timestamp: Date.now(),
								},
								...messages,
							]
						: messages) as never,
				);
		try {
			await prompt;
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
		return this.spool.backlog;
	}

	get reviewCount(): number {
		return this.#reviewCount;
	}

	get reviewedThrough(): number {
		return this.spool.committedBoundary;
	}

	/** True when no batch is in flight and nothing is queued. */
	get idle(): boolean {
		return !this.#busy && !this.spool.hasPending;
	}

	/** True while a review prompt is in flight. Deferred pending is not reviewing. */
	get reviewing(): boolean {
		return this.#busy;
	}

	/** Caught up only once every claimed input chunk has committed. */
	get #caughtUp(): boolean {
		return !this.#busy && !this.spool.hasPending;
	}

	/** Whether pending or ready findings include material priority. */
	get hasHighPriority(): boolean {
		return [...this.#advice, ...this.#readyAdvice].some((n) => isHighSeverity(n.severity));
	}

	#upsertAdviceIn(
		target: PairNote[],
		note: string,
		severity?: PairSeverity,
		findingId?: string,
		assignFindingId = false,
	): void {
		if (this.disposed) return;
		const key = dedupeKey(note);
		const existing = target.find((item) => (findingId ? item.id === findingId : dedupeKey(item.note) === key));
		if (!existing) {
			const id = findingId ?? (assignFindingId ? pairFindingId() : undefined);
			target.push({ note, severity, ...(id ? { id } : {}) });
			return;
		}
		if (findingId && existing.id === findingId) existing.note = note;
		if (!existing.id && (findingId || assignFindingId)) {
			existing.id = findingId ?? pairFindingId();
		}
		if (rankOf(severity) > rankOf(existing.severity)) existing.severity = severity;
	}

	#upsertAdvice(note: string, severity?: PairSeverity, findingId?: string): void {
		this.#upsertAdviceIn(this.#advice, note, severity, findingId, true);
	}

	#upsertReadyAdvice(note: string, severity?: PairSeverity, findingId?: string): void {
		this.#upsertAdviceIn(this.#readyAdvice, note, severity, findingId, true);
	}

	/** Accept only identities currently owned by the host's pending or ready queues. */
	canonicalFindingId(findingId?: string): string | undefined {
		if (!findingId) return undefined;
		return [...this.#advice, ...this.#readyAdvice].some((note) => note.id === findingId) ? findingId : undefined;
	}

	/** Stage pair programmer advice inside the active review; out-of-review callers seed the live queue. */
	enqueueAdvice(note: string, severity?: PairSeverity, findingId?: string): void {
		if (this.disposed) return;
		if (this.#attemptEffects && this.#reviewEpoch === this.#epoch) {
			const offeredId = findingId && this.#offeredFindingIds?.has(findingId) ? findingId : undefined;
			const inferredId = [...this.#advice, ...this.#readyAdvice].find(
				(item) => dedupeKey(item.note) === dedupeKey(note),
			)?.id;
			this.#upsertAdviceIn(this.#attemptEffects.advice, note, severity, offeredId ?? findingId ?? inferredId, true);
			return;
		}
		this.#upsertAdvice(note, severity, findingId);
	}

	/** Stage a consultant request so failed or stale pair programmer attempts cannot launch work. */
	stageEscalation(request: PairEscalation): EscalationAcceptance {
		const attempt = this.#attemptEffects;
		if (!attempt || !this.acceptingAdvice) return "unavailable";
		const key = JSON.stringify([
			dedupeKey(request.topic || request.claim),
			request.evidence.map((item) => [item.kind, dedupeKey(item.ref), item.path ? dedupeKey(item.path) : ""]),
		]);
		const duplicate = attempt.escalations.some(
			(item) =>
				JSON.stringify([
					dedupeKey(item.topic || item.claim),
					item.evidence.map((evidence) => [
						evidence.kind,
						dedupeKey(evidence.ref),
						evidence.path ? dedupeKey(evidence.path) : "",
					]),
				]) === key,
		);
		if (duplicate) return "suppressed";
		attempt.escalations.push(request);
		return "accepted";
	}

	/** Delivery retry bookkeeping: keep an already-confirmed finding ready. */
	requeueReadyAdvice(note: string, severity?: PairSeverity, findingId?: string): void {
		this.#upsertReadyAdvice(note, severity, findingId);
	}

	/** Drain findings reconfirmed by a newer successful frontier review. */
	takeConfirmedAdvice(): PairNote[] {
		return this.#readyAdvice.splice(0);
	}

	/** Terminal review makes both reconfirmed and newly observed findings current. */
	takeAllAdvice(): PairNote[] {
		return [...this.#readyAdvice.splice(0), ...this.#advice.splice(0)];
	}

	/** Record delivery only after the primary session accepted the outbound message. */
	markAdviceDelivered(notes: readonly PairNote[]): void {
		this.#rememberSettled(notes, "delivered");
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
		return !this.disposed && this.#attemptEffects !== undefined && this.#reviewEpoch === this.#epoch;
	}

	/**
	 * Resolve once the pair has caught up (`idle`), or `timeoutMs` elapses, or
	 * `signal` aborts. Used by deterministic runtime tests and diagnostics; primary
	 * turns never await it. Resolves "settled" immediately if already idle/disposed.
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
				// Fired when the drain reaches a settlement boundary (reviewed or deferred).
				settle: () => {
					if (this.disposed) finish("aborted");
					else if (this.#lastOutcome === "failed") finish("failed");
					else if (this.#caughtUp) finish("settled");
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

	/** Append an immutable input chunk. An idle reader immediately claims it. */
	push(deltaText: string, opts?: { boundary?: number; notebookBatch?: PairNotebookBatch }): void {
		if (this.disposed || this.spool.append(deltaText, opts) === undefined) return;
		this.wake();
	}

	/** Wake the reader after the extension appends or preserves work in its spool. */
	wake(): void {
		if (!this.disposed && !this.#busy && this.spool.hasPending) void this.#drain();
	}

	/** Compatibility alias for deterministic callers. */
	startDrain(): void {
		this.wake();
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
		this.spool.reset();
		this.#primedContext = undefined;
		this.#advice = [];
		this.#readyAdvice = [];
		this.#rolling = [];
		this.#needsSeed = true;
		this.#reraised = undefined;
		this.#offeredFindingIds = undefined;
		this.#attemptEffects = undefined;
		this.#reviewEpoch = -1;
		this.#lastOutcome = undefined;
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
		this.#primedContext = undefined;
		this.#advice = [];
		this.#readyAdvice = [];
		this.#rolling = [];
		this.#reraised = undefined;
		this.#offeredFindingIds = undefined;
		this.#attemptEffects = undefined;
		this.#reviewEpoch = -1;
		this.#lastOutcome = undefined;
		try {
			this.agent.abort();
		} catch {}
		try {
			this.session?.dispose?.();
		} catch {}
		this.#cancelWaiters();
	}

	async #reviewBatch(batch: readonly PendingDelta[]): Promise<"ok" | "failed" | "stale"> {
		const notebookBatch = [...batch].reverse().find((item) => item.notebookBatch)?.notebookBatch;
		const texts = batch.map((item) => item.text);
		if (notebookBatch?.prompt) texts.push(notebookBatch.prompt);
		this.notebookTool?.begin(notebookBatch);
		const epoch = this.#epoch;
		const attempt: AttemptEffects = { advice: [], escalations: [] };
		this.#attemptEffects = attempt;
		// Re-offer the shared advice queue without removing it. Attempt-created
		// effects remain private until the response completes successfully.
		const offered = this.#advice.map((note) => ({ ...note }));
		const offeredByKey = new Map(offered.map((note) => [pairNoteKey(note), note]));
		const offeredKeys = new Set(offeredByKey.keys());
		const readyByKey = new Map(this.#readyAdvice.map((note) => [pairNoteKey(note), { ...note }]));
		const offeredFindingIds = new Set(offered.flatMap((note) => (note.id ? [note.id] : [])));
		this.#offeredFindingIds = offeredFindingIds;
		const preamble = formatReconfirmPreamble(offered);
		const primedContext = this.#primedContext;
		this.#reraised = new Set();
		this.#reviewEpoch = epoch;
		const finishAttempt = () => {
			if (this.#attemptEffects === attempt) this.#attemptEffects = undefined;
			if (this.#offeredFindingIds === offeredFindingIds) this.#offeredFindingIds = undefined;
			if (this.#reviewEpoch === epoch) this.#reviewEpoch = -1;
		};
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
			await this.#promptAndRecord(messages, "turn_end");
			if (this.#epoch !== epoch) {
				this.notebookTool?.clear();
				finishAttempt();
				this.#reraised = undefined;
				if (this.#agentResetPending) this.#resetAgentWhenIdle();
				return "stale";
			}
			const last = this.agent.state.messages[this.agent.state.messages.length - 1] as AssistantMessage;
			if (last?.stopReason === "error" || last?.stopReason === "aborted" || last?.stopReason === "length") {
				this.notebookTool?.clear();
				finishAttempt();
				this.onDebug?.("pair review incomplete, stop=", last?.stopReason, "err=", last?.errorMessage ?? "-");
				this.#reraised = undefined;
				return "failed";
			}
			const notebookUpdate = this.notebookTool?.takeStaged();
			if (notebookUpdate) this.onNotebookUpdate?.(notebookUpdate);
			const delegated = new Set<string>();
			for (const request of attempt.escalations) {
				let acceptance: EscalationAcceptance = "unavailable";
				try {
					acceptance = this.onEscalation?.(request) ?? "unavailable";
				} catch (error) {
					this.onDebug?.("pair escalation commit callback threw", String(error));
				}
				if (acceptance !== "unavailable") delegated.add(dedupeKey(request.topic || request.claim));
			}
			for (const note of attempt.advice) {
				const key = pairNoteKey(note);
				if (delegated.has(dedupeKey(note.note))) continue;
				if (offeredKeys.has(key)) {
					this.#reraised?.add(key);
					const offeredNote = offeredByKey.get(key);
					if (offeredNote) this.#upsertReadyAdvice(offeredNote.note, offeredNote.severity, offeredNote.id);
					this.#upsertReadyAdvice(note.note, note.severity, note.id);
				} else if (readyByKey.has(key)) {
					const currentReady = this.#readyAdvice.find((item) => pairNoteKey(item) === key);
					const snapshotReady = readyByKey.get(key);
					if (currentReady || (snapshotReady && rankOf(note.severity) > rankOf(snapshotReady.severity))) {
						this.#upsertReadyAdvice(note.note, note.severity, note.id);
					}
				} else {
					this.#upsertAdvice(note.note, note.severity, note.id);
				}
			}
			const dropped: PairNote[] = [];
			for (const key of offeredKeys) {
				const i = this.#advice.findIndex((note) => pairNoteKey(note) === key);
				if (i < 0) continue;
				const [offeredNote] = this.#advice.splice(i, 1);
				if (!this.#reraised?.has(key) && offeredNote) dropped.push(offeredNote);
			}
			this.#rememberSettled(dropped, "dropped");
			if (this.#primedContext === primedContext) this.#primedContext = undefined;
			finishAttempt();
			this.#lastOutcome = "ok";
			this.#reraised = undefined;
			this.onDebug?.("pair turn done, stop=", last?.stopReason);
			return "ok";
		} catch (e) {
			this.notebookTool?.clear();
			finishAttempt();
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
		let reviewed = false;
		try {
			while (!this.disposed && this.spool.hasPending) {
				if (this.#agentResetPending) this.#resetAgentWhenIdle();
				if (this.#agentResetPending) {
					this.#lastOutcome = "failed";
					break;
				}
				// Claim a contiguous prefix without removing it. It remains the exact
				// retry unit until its transactional response commits.
				const batch = this.spool.claim();
				reviewed = true;
				const result = await this.#reviewBatch(batch);
				if (result !== "ok") {
					if (result === "failed") this.#lastOutcome = "failed";
					break;
				}
				this.spool.commit(batch);
			}
		} finally {
			this.#busy = false;
			if (this.#caughtUp || this.#lastOutcome === "failed") this.#notifySettled();
			if (reviewed) {
				try {
					this.onSettled?.(this.#lastOutcome === "failed" ? "failed" : "ok", this.spool.committedBoundary);
				} catch (e) {
					this.onDebug?.("pair onSettled callback threw", String(e));
				}
			}
		}
	}
}

// ===========================================================================
// Extension wiring
// ===========================================================================

// Footer status key. Statuses are ordered alphabetically by key; "q-pair"
// sorts after "permissions"/"provider-system-prompt" but before "sub-bar", so
// The pair programmer shows as a middle segment. Change this to reposition it (e.g.
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
		advisorState === "consultant_running"
			? "Pair programmer → Consultant"
			: advisorState === "escalation_pending"
				? "Pair programmer (consultant queued)"
				: advisorState === "delivery_pending"
					? "Pair programmer (consultant ready)"
					: reviewing
						? "Pair programmer (reviewing)"
						: "Pair programmer";
	const total = costUsd + advisorCostUsd;
	return `${state}: $${total.toFixed(2)}`;
}
const DEBUG = !!process.env.PAIR_DEBUG;
const dbg = (...a: unknown[]) => {
	if (DEBUG) console.error("[pair]", ...a);
};
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
	const acknowledgments = new PairAcknowledgmentTracker();

	// The advise tool bound to the live runtime so boundary delivery can mark held
	// notes delivered at the actual send point.
	let adviseTool: AdviseTool | undefined;

	// Set when the user aborts (Escape): while true, late pair programmer advice is delivered
	// WITHOUT triggerTurn so it cannot auto-resume the run the user just stopped.
	// Cleared when the user drives the next turn.
	let autoResumeSuppressed = false;

	// A terminal advisory closes the supervision episode. The resulting correction
	// run belongs to the main agent and is not reviewed again until the user speaks.
	let awaitingUserAfterAdvisory = false;

	// Assistant-turn state identifies the safe boundary where a steer can enter an
	// active run before its next step.
	let turnState: PrimaryTurnState = "ended-nonterminal";
	const inputSpool = new PairSpool();
	let stagedBoundaryNotes: PairNote[] = [];
	let advisorFlush: Promise<void> | undefined;
	const deliveredFindingKeys = new Set<string>();

	// Most recent ctx seen from any hook that carries one. `updateStatus` needs this
	// so the runtime's async `onSettled` callback — which fires whenever a review
	// completes, not just at turn_end — can refresh the footer without waiting for
	// the next primary-turn event. That is the actual fix for the reported UX gap:
	// the old transient "catching up" notify had no matching "done" signal, so a
	// silent settle was indistinguishable from a stuck pair. A persistent,
	// self-resolving footer state removes the need for a terminal message at all.
	let latestCtx: ExtensionContext | undefined;

	pi.registerTool({
		name: "acknowledge_pair_findings",
		label: "Acknowledge pair programmer findings",
		description:
			"Record that you considered one or more delivered pair programmer concerns or blockers. Use address when acting on a finding, decline when evidence shows it does not apply, or defer when it is valid but outside the authorized work. Give a concise reason. This records consideration only; it does not claim the work is fixed or validated.",
		promptSnippet:
			"Acknowledge delivered pair programmer concerns and blockers with a typed disposition and concise reason",
		promptGuidelines: [
			"Call acknowledge_pair_findings for each delivered pair programmer concern or blocker after checking it against current code and user intent.",
			"Use address when acting on it, decline with evidence when it does not apply, or defer with a reason when it is valid but outside the current authorized work.",
			"An acknowledgment records consideration only; it does not prove implementation or validation.",
		],
		parameters: pairAcknowledgmentSchema,
		async execute(_toolCallId, params) {
			const findings = (params as { findings: PairFindingAcknowledgment[] }).findings.map((finding) => ({
				...finding,
				id: finding.id.trim(),
				reason: finding.reason.trim(),
			}));
			const errors = acknowledgments.validate(findings);
			if (errors.length) {
				return {
					content: [{ type: "text" as const, text: `Acknowledgment rejected: ${errors.join("; ")}.` }],
					details: { accepted: [], errors },
				};
			}
			const accepted: string[] = [];
			const failed: string[] = [];
			for (const finding of findings) {
				const pending = acknowledgments.get(finding.id);
				if (!pending) continue;
				try {
					pi.appendEntry(PAIR_FINDING_ACKNOWLEDGED, {
						...pending,
						disposition: finding.disposition,
						reason: finding.reason,
					});
					acknowledgments.resolve(finding.id);
					accepted.push(finding.id);
				} catch (error) {
					failed.push(`${finding.id}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (latestCtx) updateStatus(latestCtx);
			return {
				content: [
					{
						type: "text" as const,
						text: failed.length
							? `Recorded ${accepted.length} acknowledgment${accepted.length === 1 ? "" : "s"}; ${failed.length} could not be persisted.`
							: `Recorded ${accepted.length} pair programmer finding acknowledgment${accepted.length === 1 ? "" : "s"}.`,
					},
				],
				details: { accepted, errors: failed },
			};
		},
	});

	// ---- statusbar: per-session pair cost + live reviewing/idle state ----
	// Reflects the live pair lifetime cost (rt.usage.cost) and whether a review
	// is currently in flight (`pair programmer (reviewing): $N` vs `pair programmer: $N`) in the
	// footer status bar. Cleared when the pair is off or torn down.
	//
	// Footer ordering: pi sorts extension statuses alphabetically BY KEY and joins
	// them with a single space (no separators of its own). So the key controls
	// position and we draw our own `│` divider in the text. STATUS_KEY sorts after
	// "permissions"/"provider-system-prompt" but before "sub-bar", placing the pair programmer as
	// a middle segment rather than the leftmost.
	//
	// LEADING bar only (no trailing): whatever follows draws its own separator
	// (e.g. pi-sub-bar with statusLeadingDivider:true starts with `│`), so a trailing
	// bar here would double up (`│ pair programmer │ │ …`).
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
		const delivered = identifyMaterialPairNotes(
			notes.map((note) => ({ ...note, source: note.source ?? "pair" }) satisfies PairNote),
		);
		const triggerTurn = !autoResumeSuppressed;
		const content = formatAdvisoryContent(delivered, opts);
		pi.sendMessage(
			{ customType: ADVISORY_TYPE, content, display: true, details: { notes: delivered } },
			{ deliverAs: "steer", triggerTurn },
		);
		acknowledgments.recordDelivered(delivered);
		for (const note of delivered) {
			if (note.source === "pair") directFindings[note.severity ?? "nit"]++;
		}
		if (opts.finalAnswer && triggerTurn) awaitingUserAfterAdvisory = true;
	}

	function restoreAcknowledgments(entries: readonly unknown[]): void {
		acknowledgments.reset();
		for (const entry of entries) {
			if (!entry || typeof entry !== "object") continue;
			const record = entry as {
				type?: string;
				customType?: string;
				data?: { id?: unknown };
				details?: { notes?: unknown; findings?: unknown };
			};
			if (
				record.type === "custom_message" &&
				record.customType === ADVISORY_TYPE &&
				Array.isArray(record.details?.notes)
			) {
				acknowledgments.recordDelivered(record.details.notes as PairNote[]);
			} else if (
				record.type === "custom_message" &&
				record.customType === PAIR_ACK_REMINDER_TYPE &&
				Array.isArray(record.details?.findings)
			) {
				acknowledgments.markReminded(
					record.details.findings
						.map((finding) => (finding && typeof finding === "object" ? (finding as { id?: unknown }).id : undefined))
						.filter((id): id is string => typeof id === "string"),
				);
			} else if (
				record.type === "custom" &&
				(record.customType === PAIR_FINDING_ACKNOWLEDGED || record.customType === PAIR_FINDING_UNACKNOWLEDGED) &&
				typeof record.data?.id === "string"
			) {
				acknowledgments.resolve(record.data.id);
			}
		}
	}

	function handleTerminalAcknowledgments(): void {
		const { remind, close } = acknowledgments.terminalActions();
		for (const finding of close) {
			try {
				pi.appendEntry(PAIR_FINDING_UNACKNOWLEDGED, { ...finding, status: "unacknowledged" });
				acknowledgments.resolve(finding.id);
			} catch (error) {
				dbg("pair programmer unacknowledged telemetry failed", finding.id, String(error));
			}
		}
		if (remind.length) {
			const triggerTurn = !autoResumeSuppressed;
			try {
				pi.sendMessage(
					{
						customType: PAIR_ACK_REMINDER_TYPE,
						content: formatPairAcknowledgmentReminder(remind),
						display: true,
						details: { findings: remind },
					},
					{ deliverAs: "steer", triggerTurn },
				);
				acknowledgments.markReminded(remind.map((finding) => finding.id));
				if (triggerTurn) awaitingUserAfterAdvisory = true;
			} catch (error) {
				dbg("pair programmer acknowledgment reminder failed", String(error));
			}
		}
		if ((close.length || remind.length) && latestCtx) updateStatus(latestCtx);
	}

	// Pair programmer callbacks only enqueue. Delivery policy lives at primary boundaries,
	// where terminality and reconfirmation state are actually known.
	function deliverAdvice(
		note: string,
		severity?: PairSeverity,
		sourceRuntime?: PairRuntime,
		findingId?: string,
	): boolean {
		if (!enabled) return false;
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
		// The hidden command test hook is the only caller without a source runtime.
		// It injects a synthetic ready finding so every severity exercises the same
		// boundary-delivery path without pretending a model review occurred.
		if (!sourceRuntime) {
			const staged = { note, severity, source: "pair" as const, id: findingId ?? pairFindingId() };
			if (turnState === "running") {
				stagedBoundaryNotes.push(staged);
				return false;
			}
			sendNotes([staged], {
				stale: true,
				finalAnswer: turnState === "ended-terminal",
			});
			return true;
		}
		if ((sourceRuntime && sourceRuntime !== runtime) || (targetRuntime && !targetRuntime.acceptingAdvice)) {
			dbg("dropping stale/disabled advice", severity, JSON.stringify(note).slice(0, 80));
			// Especially after reset/replacement, never let an old callback enqueue into
			// the fresh runtime or poison its cleared dedup map.
			return false;
		}

		if (targetRuntime) {
			targetRuntime.enqueueAdvice(note, severity, findingId);
			dbg("queued advice", severity, JSON.stringify(note).slice(0, 120));
			return false; // AdviseTool records only at the real boundary delivery.
		}

		return false;
	}

	// Reviews finish asynchronously after primary turn_end. A nonterminal boundary
	// releases only findings reconfirmed by a newer successful frontier review.
	// Terminal delivery waits for final-turn coverage, where both reconfirmed and
	// newly observed findings are current.
	function flushSettledAdvice(outcome: "ok" | "failed", reviewedThrough: number, sourceRuntime: PairRuntime): void {
		if (outcome !== "ok" || sourceRuntime !== runtime || turnState === "running") return;
		if (turnState === "ended-terminal" && reviewedThrough < primaryTurnSequence) return;
		flushBoundaryFindings();
	}

	function deliveryBlocked(): boolean {
		return turnState === "running" || awaitingUserAfterAdvisory || handoffInProgress();
	}

	function flushDirectFindings(): void {
		if (deliveryBlocked()) return;
		const activeRuntime = runtime;
		const activeAdviseTool = adviseTool;
		if (activeRuntime) {
			stagedBoundaryNotes.push(
				...(turnState === "ended-terminal" ? activeRuntime.takeAllAdvice() : activeRuntime.takeConfirmedAdvice()),
			);
		}
		const direct = stagedBoundaryNotes.splice(0);
		if (!direct.length) return;
		try {
			deliverBoundaryBatch({
				direct,
				send: (notes) =>
					sendNotes(notes, {
						finalAnswer: turnState === "ended-terminal",
						stale: turnState !== "ended-terminal",
					}),
				onDirectDelivered: (note) => {
					activeAdviseTool?.markDelivered(note.note, note.severity, note.id);
					activeRuntime?.markAdviceDelivered([note]);
					deliveredFindingKeys.add(findingIdentity(note.note));
				},
				onDirectFailed: (note) => activeRuntime?.requeueReadyAdvice(note.note, note.severity, note.id),
			});
		} catch (error) {
			dbg("direct pair programmer delivery failed", String(error));
		} finally {
			if (latestCtx) updateStatus(latestCtx);
		}
	}

	function flushConsultantFinding(): Promise<void> {
		if (advisorFlush) return advisorFlush;
		const generation = constructionEpoch;
		const controller = escalationController;
		if (!controller) return Promise.resolve();
		const flush = (async () => {
			if (deliveryBlocked()) return;
			const prepared = await controller.prepareDelivery();
			if (!prepared || generation !== constructionEpoch || controller !== escalationController) return;
			if (deliveryBlocked()) return;
			try {
				const delivered = deliverBoundaryBatch({
					direct: [],
					advisor: prepared,
					knownKeys: deliveredFindingKeys,
					send: (notes) =>
						sendNotes(notes, {
							finalAnswer: turnState === "ended-terminal",
							stale: false,
						}),
					onDirectDelivered: () => {},
					onDirectFailed: () => {},
				});
				if (delivered) {
					deliveredFindingKeys.add(findingIdentity(prepared.note.note));
					for (const key of prepared.dedupeKeys ?? []) deliveredFindingKeys.add(findingIdentity(key));
				}
			} catch (error) {
				dbg("consultant delivery failed", String(error));
			} finally {
				if (latestCtx) updateStatus(latestCtx);
			}
		})();
		const tracked = flush.finally(() => {
			if (advisorFlush === tracked) advisorFlush = undefined;
		});
		advisorFlush = tracked;
		return tracked;
	}

	function flushBoundaryFindings(): void {
		if (deliveryBlocked()) return;
		flushDirectFindings();
		void flushConsultantFinding();
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
		inputSpool.reset();
		autoResumeSuppressed = false;
		awaitingUserAfterAdvisory = false;
		stagedBoundaryNotes = [];
		advisorFlush = undefined;
		deliveredFindingKeys.clear();
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
		if (!rootNotebook || !enabled) return undefined;
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
		if (!rootNotebook || !latestCtx) throw new Error("pair programmer notebook context is unavailable");
		if (update.sessionIdentity && update.sessionIdentity !== sessionIdFromCtx(latestCtx)) {
			throw new Error("pair programmer notebook update belongs to a replaced session");
		}
		const entries = latestCtx.sessionManager.getBranch() as Entry[];
		if (!commitPairNotebookUpdate(pi, rootNotebook, entries, update)) {
			throw new Error("pair programmer notebook update was rejected");
		}
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
				appendSpool(delta);
				pumpSpool(ctx as Parameters<typeof ensureRuntime>[0]);
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
				ctx.ui.notify(`Pair programmer unavailable: ${modelProfileError}`, "warning");
			}
			return undefined;
		}

		let builtRuntime!: PairRuntime;
		const builtAdviseTool = new AdviseTool(
			(note, severity, findingId) => deliverAdvice(note, severity, builtRuntime, findingId),
			(_note, findingId) => builtRuntime.canonicalFindingId(findingId),
		);
		const builtEscalateTool = new EscalateTool((request) => {
			if (runtime !== builtRuntime || !builtRuntime.acceptingAdvice) return "unavailable";
			return builtRuntime.stageEscalation(request);
		});
		const builtNotebookTool = rootNotebook ? new UpdateNotebookTool() : undefined;
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
				projectTrusted,
				model,
				thinkingLevel,
				systemPrompt,
				adviseTool: builtAdviseTool as never,
				escalateTool: builtEscalateTool as never,
				...(builtNotebookTool ? { notebookTool: builtNotebookTool as never } : {}),
				seedSource,
				primarySessionManager: ctx.sessionManager,
				modelRuntime: (ctx.modelRegistry as { runtime?: unknown }).runtime,
			});
		} catch (error) {
			modelProfileError = `private session construction failed: ${error instanceof Error ? error.message : String(error)}`;
			dbg("pair session unavailable", modelProfileError);
			if (notifyProfileError && ctx.hasUI && ctx.ui && lastNotifiedProfileError !== modelProfileError) {
				lastNotifiedProfileError = modelProfileError;
				ctx.ui.notify(`Pair programmer unavailable: ${modelProfileError}`, "warning");
			}
			return undefined;
		}
		if (constructionEpoch !== epoch) {
			try {
				session.dispose();
			} catch {}
			return undefined;
		}
		const agent = session.agent;
		const onSettled = (outcome: "ok" | "failed", reviewedThrough: number) => {
			if (runtime !== builtRuntime) return;
			flushSettledAdvice(outcome, reviewedThrough, builtRuntime);
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
			builtNotebookTool,
			commitNotebookUpdate,
			(request) => {
				if (runtime !== builtRuntime) return "unavailable";
				return ensureEscalationController().submit("pair", request, primaryTurnSequence);
			},
			inputSpool,
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
		if (runtime && !runtime.disposed && builtForCwd === ctx.cwd && builtForTrusted === projectTrusted) return runtime;
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

	/** Extension-owned spool: construction failures leave immutable input here. */
	function appendSpool(text: string, boundary = primaryTurnSequence, notebookBatch?: PairNotebookBatch): void {
		inputSpool.append(text, { boundary, ...(notebookBatch ? { notebookBatch } : {}) });
	}

	function pumpSpool(ctx: Parameters<typeof ensureRuntime>[0]): void {
		if (!inputSpool.hasPending || !enabled || process.env.PAIR_NO_REVIEW) return;
		void ensureRuntime(ctx)
			.then((rt) => {
				if (!rt || !enabled || rt !== runtime) return;
				rt.setUsageSession(sessionIdFromCtx(ctx));
				rt.wake();
				updateStatus(ctx);
			})
			.catch((error) => dbg("pair spool pump failed", String(error)));
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
	pi.on("agent_start", () => {
		if (!enabled) return;
		turnState = "running";
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!enabled) return;
		latestCtx = ctx;
		turnState = "ended-terminal";
		handleTerminalAcknowledgments();
		if (!runtime || runtime.reviewedThrough >= primaryTurnSequence) flushBoundaryFindings();
		else void flushConsultantFinding();
		if (inputSpool.hasPending) pumpSpool(ctx as Parameters<typeof ensureRuntime>[0]);
		updateStatus(ctx);
	});

	pi.on("turn_start", () => {
		if (!enabled) return;
		turnState = "running";
	});

	// One source-addressed delta per primary turn. The completed assistant turn is
	// also the safe scheduling boundary where ready advice can steer the active run.
	// Pair review itself remains asynchronous and never delays this hook.
	pi.on("turn_end", (event, ctx) => {
		if (!enabled) return;
		const terminal = isTerminalTurn(event.message as AssistantMessage);
		turnState = terminal ? "ended-terminal" : "ended-nonterminal";
		latestCtx = ctx;
		acknowledgments.advanceTurn();
		primaryTurnSequence++;
		const boundarySequence = primaryTurnSequence;
		escalationController?.advanceTurn(boundarySequence);

		const generation = constructionEpoch;
		const signal = (ctx as { signal?: AbortSignal }).signal;
		const suppressAutoResume = () => {
			if (generation === constructionEpoch && boundarySequence === primaryTurnSequence) {
				autoResumeSuppressed = true;
			}
		};
		if (signal?.aborted) suppressAutoResume();
		else signal?.addEventListener("abort", suppressAutoResume, { once: true });

		if (!terminal) flushBoundaryFindings();
		if (process.env.PAIR_NO_REVIEW) return;
		const userPrompt = pendingUserTexts.join("\n\n");
		pendingUserTexts = [];
		const toolResults = event.toolResults as ToolResultMessage[];
		const repeatedFailure = repeatedFailures.observe(event.message as never, toolResults, boundarySequence);
		if (repeatedFailure) {
			ensureEscalationController().submit("gate", repeatedFailure, boundarySequence, {
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

		appendSpool(delta, boundarySequence, notebookBatch);
		void pumpSpool(ctx as Parameters<typeof ensureRuntime>[0]);
		updateStatus(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		updateStatus(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		teardown();
		const entries = (ctx.sessionManager as { getBranch?: () => Entry[] }).getBranch?.();
		if (entries) {
			resetProjectedSourceCursor(entries);
			restoreAcknowledgments(entries);
		}
		updateStatus(ctx);
	});
	pi.on("session_start", (_event, ctx) => {
		teardown();
		const entries = (ctx.sessionManager as { getBranch?: () => Entry[] }).getBranch?.();
		if (entries) {
			resetProjectedSourceCursor(entries);
			restoreAcknowledgments(entries);
		}
		updateStatus(ctx);
		if (enabled && !process.env.PAIR_NO_REVIEW) {
			void ensureRuntime(ctx as Parameters<typeof ensureRuntime>[0], false)
				.then(() => updateStatus(ctx))
				.catch((error) => dbg("pair warmup failed", String(error)));
		}
	});

	pi.events.on(HANDOFF_SESSION_REPLACED_CHANNEL, () => {
		teardown();
		const entries = (latestCtx?.sessionManager as { getBranch?: () => Entry[] } | undefined)?.getBranch?.();
		if (entries) {
			resetProjectedSourceCursor(entries);
			restoreAcknowledgments(entries);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		teardown();
		acknowledgments.reset();
		rootNotebook?.dispose();
		(ctx as { ui?: { setStatus?: (k: string, t: string | undefined) => void } }).ui?.setStatus?.(STATUS_KEY, undefined);
	});

	// ---- advisory card rendering ----
	// Bordered card (severity-colored left rule, bold "pair programmer <SEVERITY>" heading,
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
			const role = n.source === "consultant" || n.source === "advisor" ? "consultant" : "pair programmer";
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
		description: "Control the pair programmer. Usage: /pair [on|off|status|notebook [full]]",
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one command dispatcher owns pair programmer activation, status, notebook view, and the private test hook.
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "notebook" || arg === "notebook full") {
				if (!rootNotebook) {
					ctx.ui.notify("Pair programmer notebook is available only in the root session.", "warning");
					return;
				}
				const entries = ctx.sessionManager.getBranch() as Entry[];
				ctx.ui.notify(renderNotebookView(entries, arg === "notebook full" ? "full" : "visible"), "info");
				return;
			}

			if (arg === "status" || arg === "") {
				if (!enabled) {
					ctx.ui.notify(
						`Pair programmer disabled — notebook maintenance paused; profile ${PAIR_MODEL_PROFILE}`,
						"info",
					);
					updateStatus(ctx);
					return;
				}
				const rt = await ensureRuntime(ctx as any, false);
				if (!rt) {
					ctx.ui.notify(
						`Pair programmer enabled but unavailable — profile ${PAIR_MODEL_PROFILE}: ${modelProfileError ?? "unknown profile error"}`,
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
					`Pair programmer enabled — profile ${PAIR_MODEL_PROFILE}, model ${activeModelLabel}, state ${rt.reviewing ? "reviewing" : "idle"}, backlog ${rt.backlog}, reviews ${rt.reviewCount}, findings ${directFindings.nit}n/${directFindings.concern}c/${directFindings.blocker}b, acknowledgments ${acknowledgments.pendingCount} pending, tokens ${u.input}in/${u.output}out, cost $${u.cost.toFixed(4)}, ctx ${ctxStr}\n` +
						`Notebook — ${notebook.activeObservations.length} active observations, ${notebook.currentReflections.length} current reflections, ~${notebookProgress.toLocaleString()} uncovered source tokens\n` +
						`Consultant — state ${advisor?.state ?? "idle"}, active ${advisor?.activeId ?? "none"}, queued ${advisor?.pendingCount ?? 0}, consultations ${advisor?.stats.consultations ?? 0}, dispositions ${advisor?.stats.confirm ?? 0} confirm/${advisor?.stats.refute ?? 0} refute/${advisor?.stats.refine ?? 0} refine/${advisor?.stats.uncertain ?? 0} uncertain, tokens ${advisor?.stats.input ?? 0}in/${advisor?.stats.output ?? 0}out, cost $${(advisor?.stats.cost ?? 0).toFixed(4)}`,
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
						? `Pair programmer on — ${activeModelLabel}`
						: `Pair programmer on, but unavailable: ${modelProfileError ?? "unknown profile error"}`,
					rt ? "info" : "warning",
				);
				return;
			}
			if (arg === "off") {
				enabled = false;
				saveEnabled(false);
				teardown();
				updateStatus(ctx);
				ctx.ui.notify("Pair programmer off — notebook maintenance paused", "info");
				return;
			}

			// Hidden test hook. Inject a synthetic ready finding so delivery can be
			// exercised without running the pair model's confirmation cycle.
			if (arg.startsWith("test")) {
				const parsed = parsePairTestArgs(args);
				if (!parsed) {
					ctx.ui.notify("Usage: /pair test <nit|concern|blocker> <note>", "warning");
					return;
				}
				deliverAdvice(parsed.note, parsed.severity);
				return;
			}

			ctx.ui.notify("Usage: /pair [on|off|status|notebook [full]]", "warning");
		},
	});
}
