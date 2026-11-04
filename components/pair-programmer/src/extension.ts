import type { Agent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, TruncatedText } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { renderNotebookView } from "../../notebook/src/commands/view.js";
import { registerNotebookCompactionPacket } from "../../notebook/src/hooks/compaction-packet.js";
import { registerLearningCycle } from "../../notebook/src/hooks/learning-cycle.js";
import { registerOpenLearnings, showOpenLearnings } from "../../notebook/src/hooks/open-learnings.js";
import { registerProjectLearnings } from "../../notebook/src/hooks/project-learnings.js";
import {
	type PairNotebookBatch,
	type PairNotebookUpdate,
	commitNotebookUpdate as persistNotebookUpdate,
	preparePairNotebookBatch,
	registerMainNotebookTool,
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
import { renderInline } from "../../shared/src/compact-custom-message.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { recordSidecarUsage, usageFieldsFromUnknown, withSidecarUsageContext } from "../../shared/src/sidecar-usage.js";
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
import type { PrimarySessionManager } from "./recall.js";
import {
	createExpandReceiptTool,
	createPairReceiptIssuer,
	type PairReceiptIssuer,
	PairReceiptStore,
} from "./receipt-expansion.js";
import {
	createPairReviewScheduler,
	createSetPairAttentionTool,
	type PairAttentionLease,
	type PairReviewPermit,
	type PairReviewSettlement,
} from "./review-scheduler.js";
import { createSecondOpinionTools, type SecondOpinionRequest, sendSecondOpinion } from "./second-opinion.js";
import { buildPairSeed, formatSourceAddressedTrajectory, type SettledAdvice } from "./seed.js";
import { createPairSession } from "./session.js";

export type { PairFindingAcknowledgment, PairFindingDisposition, PendingPairFinding } from "./acknowledgments.js";
export {
	formatPairAcknowledgmentReminder,
	identifyMaterialPairNotes,
	PairAcknowledgmentTracker,
	pairFindingId,
} from "./acknowledgments.js";
export type { PairNote, PairNoteKind, PairSeverity } from "./types.js";
export { isPairQuestion } from "./types.js";

import type { PairNote, PairNoteKind, PairSeverity, PrimaryTurnState } from "./types.js";
import { isPairQuestion } from "./types.js";

const ADVISORY_TYPE = "advisory";

const adviseSchema = Type.Object({
	note: Type.String({
		description:
			"One concrete finding, or one precise probing question or view request, for the agent you are watching. Terse, specific, actionable.",
	}),
	kind: Type.Optional(
		Type.Union([Type.Literal("finding"), Type.Literal("question")], {
			description:
				"finding (default) is a concrete issue. question is one precise probing question or view request when missing evidence could materially change judgment. Pass this explicitly; do not infer it from punctuation.",
		}),
	),
	severity: Type.Optional(
		Type.Union([Type.Literal("nit"), Type.Literal("concern"), Type.Literal("blocker")], {
			description:
				"The lowest fitting weight. blocker: the current path will produce a wrong or harmful result. concern: a material risk not yet addressed. Omit for a nit. Must be omitted for questions.",
		}),
	),
	finding_id: Type.Optional(
		Type.String({
			description:
				"The host-provided id of an earlier finding or question that still applies. Use only an id shown in the reconfirmation list.",
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
const pairNoteKind = (note: Pick<PairNote, "kind"> | undefined): PairNoteKind =>
	isPairQuestion(note) ? "question" : "finding";
const pairNoteKey = (note: Pick<PairNote, "id" | "note" | "kind">): string =>
	`${pairNoteKind(note)}:${note.id ?? dedupeKey(note.note)}`;

export const isHighSeverity = (s: PairSeverity | undefined): boolean => s === "concern" || s === "blocker";

export function isTerminalTurn(message: { content?: ReadonlyArray<{ type?: string }> } | undefined): boolean {
	return !(message?.content ?? []).some((part) => part.type === "toolCall");
}

const BASH_APPEND_WATCHED = Symbol("pair.bashAppendWatched");

export function bindBashAppendHook(
	sessionManager: { appendMessage?: (message: unknown) => unknown },
	onBash: (
		message: {
			role?: string;
			command?: string;
			output?: string;
			exitCode?: number;
			excludeFromContext?: boolean;
		},
		sourceEntryId?: string,
	) => void,
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
		if (bash?.role === "bashExecution" && !bash.excludeFromContext) {
			onBash(bash, typeof result === "string" ? result : undefined);
		}
		return result;
	};
	tracked[BASH_APPEND_WATCHED] = true;
	return () => {
		tracked.appendMessage = original;
		delete tracked[BASH_APPEND_WATCHED];
	};
}

export function parsePairTestArgs(args: string): { severity: PairSeverity; note: string } | null {
	const m = args.trim().match(/^test\s+(nit|concern|blocker)\s+([\s\S]+)$/i);
	if (!m) return null;
	return { severity: m[1].toLowerCase() as PairSeverity, note: m[2].trim() };
}

export class AdviseTool {
	readonly name = "share_note";
	readonly label = "Advise";
	readonly description =
		'Share one useful intervention with your pair programming partner. The default kind is a concrete finding. Use kind="question" for one precise probe or view request only when missing evidence could materially change your judgment; questions omit severity. Use ask_for_second_opinion when consequential uncertainty needs independent investigation by a colleague.';
	readonly parameters = adviseSchema as any;
	#delivered = new Map<string, number>();
	#deliveredQuestions = new Set<string>();

	constructor(
		private readonly onAdvice: (
			note: string,
			severity?: PairSeverity,
			findingId?: string,
			kind?: PairNoteKind,
		) => boolean,
		private readonly canonicalizeFindingId?: (
			note: string,
			findingId?: string,
			kind?: PairNoteKind,
		) => string | undefined,
	) {}

	resetDelivered(): void {
		this.#delivered.clear();
		this.#deliveredQuestions.clear();
	}

	markDelivered(note: string, severity?: PairSeverity, findingId?: string, kind?: PairNoteKind): void {
		if (kind === "question") {
			this.#deliveredQuestions.add(dedupeKey(note));
			if (findingId) this.#deliveredQuestions.add(findingId);
			return;
		}
		const rank = rankOf(severity);
		this.#delivered.set(dedupeKey(note), rank);
		if (findingId) this.#delivered.set(findingId, rank);
	}

	async execute(
		_id: string,
		args: { note: string; severity?: PairSeverity; finding_id?: string; kind?: PairNoteKind },
	): Promise<AgentToolResult<unknown>> {
		const kind = args.kind === "question" ? "question" : undefined;
		const severity = kind === "question" ? undefined : args.severity;
		const findingId = this.canonicalizeFindingId
			? this.canonicalizeFindingId(args.note, args.finding_id, kind)
			: args.finding_id;
		const canonicalArgs = { ...args, finding_id: findingId, ...(kind ? { kind } : {}), severity };
		const key = findingId ?? dedupeKey(args.note);
		if (kind === "question") {
			if (this.#deliveredQuestions.has(key) || this.#deliveredQuestions.has(dedupeKey(args.note))) {
				return {
					content: [{ type: "text", text: "You already shared an equivalent note." }],
					details: { ...canonicalArgs, dropped: true },
				};
			}
		} else {
			const rank = rankOf(severity);
			const prev = Math.max(this.#delivered.get(key) ?? 0, this.#delivered.get(dedupeKey(args.note)) ?? 0);
			if (rank <= prev) {
				return {
					content: [{ type: "text", text: "You already shared an equivalent note." }],
					details: { ...canonicalArgs, dropped: true },
				};
			}
		}
		const delivered = this.onAdvice(args.note, severity, findingId, kind);
		if (!delivered) {
			return {
				content: [{ type: "text", text: "Your note will be shared at the next safe moment if it still applies." }],
				details: { ...canonicalArgs, held: true },
			};
		}
		this.markDelivered(args.note, severity, findingId, kind);
		return { content: [{ type: "text", text: "Your note was shared." }], details: canonicalArgs };
	}
}

import {
	buildReviewMessages,
	formatAdvisoryContent,
	formatReconfirmPreamble,
	formatTurnDelta,
	formatUserBash,
	mailFromEntry,
} from "./formatting.js";

export {
	buildReviewMessages,
	formatActiveSessionContext,
	formatAdvisoryContent,
	formatReconfirmPreamble,
	formatTurnDelta,
	formatUserBash,
} from "./formatting.js";
export { bindPairRecallTools } from "./recall.js";
export {
	createExpandReceiptTool,
	createPairReceiptIssuer,
	PairReceiptStore,
} from "./receipt-expansion.js";
export {
	buildPairSeed,
	collectRecentUserRequests,
	formatPairSeed,
	formatRecentTrajectory,
	RECENT_TRAJECTORY_TURNS,
} from "./seed.js";
export { PAIR_SESSION_TOOLS } from "./session.js";

type PendingDelta = Readonly<{
	sequence: number;
	text: string;
	boundary?: number;
	terminal?: boolean;
	notebookBatch?: PairNotebookBatch;
}>;
type AttemptEffects = {
	advice: PairNote[];
	secondOpinions: SecondOpinionRequest[];
	attentionLease?: PairAttentionLease;
};
type PairRuntimeSettlement = PairReviewSettlement & {
	permit: PairReviewPermit;
	reviewedThroughSequence: number;
};
type PairReviewAttemptOutcome = {
	outcome: "ok" | "failed" | "stale";
	newIntervention: boolean;
	secondOpinionRequested: boolean;
	lease?: PairAttentionLease;
	silent: boolean;
};

export class PairSpool {
	#pending: PendingDelta[] = [];
	#claimedCount = 0;
	#writerFrontier = 0;
	#committedFrontier = 0;
	#committedBoundary = 0;

	append(
		text: string,
		opts?: { boundary?: number; terminal?: boolean; notebookBatch?: PairNotebookBatch },
	): number | undefined {
		if (!text.trim()) return undefined;
		const sequence = ++this.#writerFrontier;
		this.#pending.push(
			Object.freeze({
				sequence,
				text,
				...(opts?.boundary === undefined ? {} : { boundary: opts.boundary }),
				...(opts?.terminal === undefined ? {} : { terminal: opts.terminal }),
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

	#advice: PairNote[] = [];

	#readyAdvice: PairNote[] = [];

	#reraised: Set<string> | undefined;
	#offeredFindingIds: Set<string> | undefined;

	#lastOutcome: "ok" | "failed" | undefined;

	#reviewEpoch = -1;
	#attemptEffects: AttemptEffects | undefined;
	#settleWaiters: Array<{ settle: () => void; cancel: () => void }> = [];
	#busy = false;
	#activePermit: PairReviewPermit | undefined;
	#legacyReviewSequence = 0;
	#epoch = 0;
	#agentResetPending = false;

	#cumInput = 0;
	#cumOutput = 0;
	#cumCost = 0;
	#reviewCount = 0;

	#usageSession?: { sessionId?: string };
	disposed = false;

	constructor(
		private readonly agent: Agent,
		private readonly adviseTool: AdviseTool,
		_retryDelayMs = 1000,
		private readonly onDebug?: (...a: unknown[]) => void,
		private readonly onSettled?: (
			outcome: "ok" | "failed",
			reviewedThrough: number,
			settlement: PairRuntimeSettlement,
		) => void,
		private readonly session?: {
			prompt(text: string): Promise<void>;
			abort?: () => Promise<void> | void;
			dispose?: () => void;
		},
		private readonly seed?: () => string,
		private readonly notebookTool?: UpdateNotebookTool,
		private readonly onNotebookUpdate?: (update: PairNotebookUpdate) => void,
		private readonly onSecondOpinion?: (request: SecondOpinionRequest) => void,
		private readonly spool = new PairSpool(),
		private readonly onPresented?: (text: string) => void,
	) {}

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

	async #promptAndRecord(messages: UserMessage[], permit: PairReviewPermit): Promise<void> {
		this.#reviewCount++;
		const prior = this.agent.state.messages.slice();
		const before = prior.length;
		const started = Date.now();
		const model = this.agent.state.model as { provider?: string; id?: string } | undefined;
		let seed: string | undefined;
		if (this.#needsSeed) seed = this.seed?.();
		const promptText = this.#reviewText(messages, seed);
		this.onPresented?.(promptText);
		const prompt = this.session
			? this.session.prompt(promptText)
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
			this.#recordPromptUsage(before, Date.now() - started, permit, model);
		}
	}

	#recordPromptUsage(
		before: number,
		durationMs: number,
		permit: PairReviewPermit,
		model: { provider?: string; id?: string } | undefined,
	): void {
		if (!this.#usageSession) return;
		withSidecarUsageContext({ sessionId: this.#usageSession.sessionId }, () => {
			const created = this.agent.state.messages.slice(before);
			const pacing = {
				reviewId: permit.reviewId,
				batchItems: permit.batchItems,
				batchTokens: permit.batchTokens,
				activeWaitMs: permit.activeWaitMs,
				attention: permit.attention,
			};
			let recorded = 0;
			for (const message of created) {
				if (message.role !== "assistant") continue;
				const assistant = message as AssistantMessage;
				recordSidecarUsage({
					agent: "pair",
					trigger: permit.reason,
					status: String(assistant.stopReason ?? "ok"),
					provider: model?.provider,
					model: model?.id,
					durationMs,
					...pacing,
					...usageFieldsFromUnknown(assistant.usage),
				});
				recorded++;
			}
			if (recorded === 0) {
				recordSidecarUsage({
					agent: "pair",
					trigger: permit.reason,
					status: "error",
					provider: model?.provider,
					model: model?.id,
					durationMs,
					...pacing,
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

	get idle(): boolean {
		return !this.#busy && !this.spool.hasPending;
	}

	get reviewing(): boolean {
		return this.#busy;
	}

	get hasHighPriority(): boolean {
		return [...this.#advice, ...this.#readyAdvice].some((n) => isHighSeverity(n.severity));
	}

	#upsertAdviceIn(
		target: PairNote[],
		note: string,
		severity?: PairSeverity,
		findingId?: string,
		assignFindingId = false,
		kind?: PairNoteKind,
	): void {
		if (this.disposed) return;
		const key = dedupeKey(note);
		const expectedKind = pairNoteKind({ kind });
		const existing = target.find((item) => {
			if (pairNoteKind(item) !== expectedKind) return false;
			return findingId ? item.id === findingId : dedupeKey(item.note) === key;
		});
		if (!existing) {
			const id = findingId ?? (assignFindingId ? pairFindingId() : undefined);
			target.push({
				note,
				...(expectedKind === "question" ? { kind: "question" as const } : { severity }),
				...(id ? { id } : {}),
			});
			return;
		}
		if (findingId && existing.id === findingId) existing.note = note;
		if (!existing.id && (findingId || assignFindingId)) {
			existing.id = findingId ?? pairFindingId();
		}
		if (expectedKind === "question") {
			existing.kind = "question";
			delete existing.severity;
			return;
		}
		if (rankOf(severity) > rankOf(existing.severity)) existing.severity = severity;
	}

	#upsertAdvice(note: string, severity?: PairSeverity, findingId?: string, kind?: PairNoteKind): void {
		this.#upsertAdviceIn(this.#advice, note, severity, findingId, true, kind);
	}

	#upsertReadyAdvice(note: string, severity?: PairSeverity, findingId?: string, kind?: PairNoteKind): void {
		this.#upsertAdviceIn(this.#readyAdvice, note, severity, findingId, true, kind);
	}

	canonicalFindingId(findingId?: string, kind?: PairNoteKind): string | undefined {
		if (!findingId) return undefined;
		const expectedKind = pairNoteKind({ kind });
		return [...this.#advice, ...this.#readyAdvice].some(
			(note) => note.id === findingId && pairNoteKind(note) === expectedKind,
		)
			? findingId
			: undefined;
	}

	enqueueAdvice(note: string, severity?: PairSeverity, findingId?: string, kind?: PairNoteKind): void {
		if (this.disposed) return;
		if (this.#attemptEffects && this.#reviewEpoch === this.#epoch) {
			const offeredId = findingId && this.#offeredFindingIds?.has(findingId) ? findingId : undefined;
			const inferredId = [...this.#advice, ...this.#readyAdvice].find(
				(item) => pairNoteKind(item) === pairNoteKind({ kind }) && dedupeKey(item.note) === dedupeKey(note),
			)?.id;
			this.#upsertAdviceIn(
				this.#attemptEffects.advice,
				note,
				severity,
				offeredId ?? findingId ?? inferredId,
				true,
				kind,
			);
			return;
		}
		this.#upsertAdvice(note, severity, findingId, kind);
	}

	stageSecondOpinion(request: SecondOpinionRequest): boolean {
		if (!this.#attemptEffects || !this.acceptingAdvice) return false;
		this.#attemptEffects.secondOpinions.push(request);
		return true;
	}

	stageAttention(lease: PairAttentionLease): boolean {
		const attempt = this.#attemptEffects;
		if (!attempt || !this.acceptingAdvice) return false;
		attempt.attentionLease = {
			attention: lease.attention,
			wakeOn: [...lease.wakeOn],
		};
		return true;
	}

	requeueReadyAdvice(note: string, severity?: PairSeverity, findingId?: string, kind?: PairNoteKind): void {
		this.#upsertReadyAdvice(note, severity, findingId, kind);
	}

	takeConfirmedAdvice(): PairNote[] {
		return this.#readyAdvice.splice(0);
	}

	takeAllAdvice(): PairNote[] {
		return [...this.#readyAdvice.splice(0), ...this.#advice.splice(0)];
	}

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

	get acceptingAdvice(): boolean {
		return !this.disposed && this.#attemptEffects !== undefined && this.#reviewEpoch === this.#epoch;
	}

	waitUntilSettled(timeoutMs: number, signal?: AbortSignal): Promise<"settled" | "timeout" | "aborted" | "failed"> {
		if (this.disposed) return Promise.resolve("aborted");
		if (!this.#busy) return Promise.resolve(this.#lastOutcome === "failed" ? "failed" : "settled");
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
				settle: () => {
					if (this.disposed) finish("aborted");
					else if (this.#lastOutcome === "failed") finish("failed");
					else if (!this.#busy) finish("settled");
				},

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

				contextTokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			}
		}
		const window = (this.agent.state.model as { contextWindow?: number } | undefined)?.contextWindow;
		const contextPercent = window ? Math.round((contextTokens / window) * 100) : null;
		return { input, output, cost, contextTokens, contextPercent };
	}

	push(deltaText: string, opts?: { boundary?: number; terminal?: boolean; notebookBatch?: PairNotebookBatch }): void {
		if (this.disposed || this.spool.append(deltaText, opts) === undefined) return;
		this.wake();
	}

	startReview(permit: PairReviewPermit): boolean {
		if (this.disposed || this.#busy || !this.spool.hasPending) return false;
		this.#activePermit = permit;
		void this.#drain();
		return true;
	}

	wake(): void {
		if (this.disposed || !this.spool.hasPending) return;
		if (this.#busy) return;
		const batch = this.spool.claim();
		this.startReview({
			reviewId: `legacy-${++this.#legacyReviewSequence}`,
			reason: "orientation",
			attention: "close",
			batchItems: batch.length,
			batchTokens: Math.ceil(batch.reduce((sum, item) => sum + item.text.length, 0) / 4),
			activeWaitMs: 0,
			throughSequence: batch.at(-1)?.sequence ?? 0,
		});
	}

	startDrain(): void {
		this.wake();
	}

	reprime(contextText: string): void {
		this.reset();
		this.#primedContext = contextText.trim() || undefined;
	}

	#resetAgentWhenIdle(): void {
		try {
			this.agent.reset();
			this.#agentResetPending = false;
		} catch {
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
		this.#activePermit = undefined;
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
		this.#activePermit = undefined;
		this.#lastOutcome = undefined;
		try {
			this.agent.abort();
		} catch {}
		try {
			this.session?.dispose?.();
		} catch {}
		this.#cancelWaiters();
	}

	async #reviewBatch(batch: readonly PendingDelta[], permit: PairReviewPermit): Promise<PairReviewAttemptOutcome> {
		const notebookBatch = [...batch].reverse().find((item) => item.notebookBatch)?.notebookBatch;
		const checkpoint = `<review-checkpoint reason="${permit.reason}" updates="${batch.length}">Review the complete accumulated batch.</review-checkpoint>`;
		const texts = [checkpoint, ...batch.map((item) => item.text)];
		if (notebookBatch?.prompt) texts.push(notebookBatch.prompt);
		this.notebookTool?.begin(notebookBatch);
		const epoch = this.#epoch;
		const attempt: AttemptEffects = { advice: [], secondOpinions: [] };
		this.#attemptEffects = attempt;

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
			await this.#promptAndRecord(messages, permit);
			if (this.#epoch !== epoch) {
				this.notebookTool?.clear();
				finishAttempt();
				this.#reraised = undefined;
				if (this.#agentResetPending) this.#resetAgentWhenIdle();
				return {
					outcome: "stale",
					newIntervention: false,
					secondOpinionRequested: false,
					silent: false,
				};
			}
			const last = this.agent.state.messages[this.agent.state.messages.length - 1] as AssistantMessage;
			if (last?.stopReason === "error" || last?.stopReason === "aborted" || last?.stopReason === "length") {
				this.notebookTool?.clear();
				finishAttempt();
				this.onDebug?.("pair review incomplete, stop=", last?.stopReason, "err=", last?.errorMessage ?? "-");
				this.#reraised = undefined;
				return {
					outcome: "failed",
					newIntervention: false,
					secondOpinionRequested: false,
					silent: false,
				};
			}
			const notebookUpdate = this.notebookTool?.takeStaged();
			if (notebookUpdate) this.onNotebookUpdate?.(notebookUpdate);
			for (const request of attempt.secondOpinions) this.onSecondOpinion?.(request);
			let newIntervention = false;
			for (const note of attempt.advice) {
				const key = pairNoteKey(note);
				if (offeredKeys.has(key)) {
					this.#reraised?.add(key);
					const offeredNote = offeredByKey.get(key);
					if (offeredNote)
						this.#upsertReadyAdvice(offeredNote.note, offeredNote.severity, offeredNote.id, offeredNote.kind);
					this.#upsertReadyAdvice(note.note, note.severity, note.id, note.kind);
				} else if (readyByKey.has(key)) {
					const currentReady = this.#readyAdvice.find((item) => pairNoteKey(item) === key);
					const snapshotReady = readyByKey.get(key);
					if (
						currentReady ||
						(snapshotReady && (isPairQuestion(note) || rankOf(note.severity) > rankOf(snapshotReady.severity)))
					) {
						this.#upsertReadyAdvice(note.note, note.severity, note.id, note.kind);
					}
				} else {
					this.#upsertAdvice(note.note, note.severity, note.id, note.kind);
					newIntervention = true;
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
			return {
				outcome: "ok",
				newIntervention,
				secondOpinionRequested: attempt.secondOpinions.length > 0,
				...(attempt.attentionLease ? { lease: attempt.attentionLease } : {}),
				silent: attempt.advice.length === 0 && attempt.secondOpinions.length === 0,
			};
		} catch (e) {
			this.notebookTool?.clear();
			finishAttempt();
			this.#reraised = undefined;
			this.onDebug?.("pair prompt threw", String(e));

			return {
				outcome: this.#epoch !== epoch ? "stale" : "failed",
				newIntervention: false,
				secondOpinionRequested: false,
				silent: false,
			};
		}
	}

	async #drain(): Promise<void> {
		const requestedPermit = this.#activePermit;
		if (this.#busy || !requestedPermit) return;
		this.#busy = true;
		let settlement: PairRuntimeSettlement | undefined;
		try {
			if (this.#agentResetPending) this.#resetAgentWhenIdle();
			if (this.#agentResetPending) {
				this.#lastOutcome = "failed";
				settlement = {
					outcome: "failed",
					permit: requestedPermit,
					reviewedThroughSequence: 0,
					newIntervention: false,
					secondOpinionRequested: false,
					silent: false,
				};
				return;
			}

			const batch = this.spool.claim();
			const effectivePermit: PairReviewPermit = {
				...requestedPermit,
				batchItems: batch.length,
				batchTokens: batch.reduce((sum, item) => sum + Math.ceil(item.text.length / 4), 0),
				throughSequence: batch.at(-1)?.sequence ?? requestedPermit.throughSequence,
			};
			const attempt = await this.#reviewBatch(batch, effectivePermit);
			if (attempt.outcome === "stale") return;
			if (attempt.outcome === "ok") {
				this.spool.commit(batch);
				this.#lastOutcome = "ok";
			} else {
				this.#lastOutcome = "failed";
			}
			const reviewedThroughSequence = attempt.outcome === "ok" ? effectivePermit.throughSequence : 0;
			settlement = {
				outcome: attempt.outcome,
				permit: effectivePermit,
				reviewedThroughSequence,
				...(attempt.outcome === "ok" ? { reviewedThrough: reviewedThroughSequence } : {}),
				newIntervention: attempt.newIntervention,
				secondOpinionRequested: attempt.secondOpinionRequested,
				...(attempt.lease ? { lease: attempt.lease } : {}),
				silent: attempt.silent,
				terminalCovered: attempt.outcome === "ok" && batch.some((item) => item.terminal),
			};
		} finally {
			this.#busy = false;
			this.#activePermit = undefined;
			if (settlement) {
				try {
					this.onSettled?.(settlement.outcome, this.spool.committedBoundary, settlement);
				} catch (e) {
					this.onDebug?.("pair onSettled callback threw", String(e));
				}
			}
			const legacyPermit = requestedPermit.reviewId.startsWith("legacy-");
			const wakeAgain = settlement?.outcome === "ok" && legacyPermit && this.spool.hasPending && !this.disposed;
			if (wakeAgain) this.wake();
			this.#notifySettled();
		}
	}
}

const STATUS_KEY = "q-pair";

export function formatPairFooterText(reviewing: boolean, costUsd: number): string {
	return `Pair programmer${reviewing ? " (reviewing)" : ""}: $${costUsd.toFixed(2)}`;
}
const DEBUG = !!process.env.PAIR_DEBUG;
const dbg = (...a: unknown[]) => {
	if (DEBUG) console.error("[pair]", ...a);
};

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

export function livePairUserMessages(
	entries: readonly { id?: string; message?: unknown }[],
): Array<{ content: unknown; sourceEntryId: string; kind?: "mail" }> {
	return entries.flatMap((entry) => {
		if (!entry.id) return [];
		const mail = mailFromEntry(entry);
		if (mail !== undefined) return [{ content: mail, sourceEntryId: entry.id, kind: "mail" as const }];
		if (!entry.message || typeof entry.message !== "object") return [];
		const message = entry.message as { role?: string; content?: unknown };
		if (message.role !== "user") return [];
		const text = userMessageText(message);
		if (text.startsWith("/")) return [];
		return [{ content: message.content, sourceEntryId: entry.id }];
	});
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

const HANDOFF_SESSION_REPLACED_CHANNEL = "pi-amplike:handoff-session-replaced";

import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import {
	loadEnabled,
	loadSystemPrompt,
	PAIR_MODEL_PROFILE,
	PRIMARY_PAIR_PROTOCOL,
	PRIMARY_PAIR_PROTOCOL_TAG,
	saveEnabled,
} from "./config.js";

export { loadSystemPrompt, PAIR_MODEL_PROFILE, PRIMARY_PAIR_PROTOCOL, PRIMARY_PAIR_PROTOCOL_TAG } from "./config.js";

export default function (pi: ExtensionAPI) {
	const rootNotebook = new NotebookRuntime();
	registerNotebookCompactionPacket(pi);
	registerNotebookSourceTool(pi);
	registerMainNotebookTool(pi, rootNotebook);
	registerLearningCycle(pi);
	registerOpenLearnings(pi);
	registerProjectLearnings(pi);

	let enabled = loadEnabled();

	let runtime: PairRuntime | undefined;
	let activeModelLabel: string | undefined;
	let modelProfileError: string | undefined;
	let lastNotifiedProfileError: string | undefined;
	let builtForCwd: string | undefined;
	let builtForTrusted: boolean | undefined;
	let runtimeBuild: { key: string; epoch: number; promise: Promise<PairRuntime | undefined> } | undefined;
	let constructionEpoch = 0;
	let unwatchBash: (() => void) | undefined;
	const opinionSends = new Set<AbortController>();
	let primaryTurnSequence = 0;
	let lastReviewReason: string | undefined;
	let activePairContextWindow: number | undefined;
	let projectedThroughSourceId: string | undefined;
	let receiptStore: PairReceiptStore | undefined;
	const directFindings = { nit: 0, concern: 0, blocker: 0 };
	const acknowledgments = new PairAcknowledgmentTracker();

	let adviseTool: AdviseTool | undefined;

	let autoResumeSuppressed = false;

	let awaitingUserAfterAdvisory = false;

	let turnState: PrimaryTurnState = "ended-nonterminal";
	const inputSpool = new PairSpool();
	let stagedBoundaryNotes: PairNote[] = [];

	let latestCtx: ExtensionContext | undefined;
	const reviewScheduler = createPairReviewScheduler({
		now: Date.now,
		setTimer: (callback, delayMs) => {
			const timer = setTimeout(callback, delayMs);
			timer.unref?.();
			return timer;
		},
		clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
		onDue: () => {
			if (latestCtx) pumpSpool(latestCtx as Parameters<typeof ensureRuntime>[0]);
		},
	});

	pi.registerTool({
		name: "acknowledge_pair_findings",
		label: "Acknowledge pair programmer findings",
		description:
			"Record that you considered one or more delivered pair programmer concerns or blockers. Use address when acting on a finding, decline when evidence shows it does not apply, or defer when it is valid but outside the authorized work. Give a concise reason. This records consideration only; it does not claim the work is fixed or validated.",
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
		ui.setStatus(STATUS_KEY, `${bar} ${formatPairFooterText(runtime.reviewing, runtime.usage.cost)}`);
	}

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
			if (note.source === "pair" && !isPairQuestion(note)) directFindings[note.severity ?? "nit"]++;
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

	function deliverAdvice(
		note: string,
		severity?: PairSeverity,
		sourceRuntime?: PairRuntime,
		findingId?: string,
		kind?: PairNoteKind,
	): boolean {
		if (!enabled) return false;

		if (handoffInProgress()) {
			dbg("handoff in progress, dropping advice", severity, JSON.stringify(note).slice(0, 80));

			return false;
		}

		const targetRuntime = sourceRuntime ?? runtime;

		if (!sourceRuntime) {
			const staged: PairNote = {
				note,
				source: "pair",
				id: findingId ?? pairFindingId(),
				...(kind === "question" ? { kind: "question" as const } : { severity }),
			};
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

			return false;
		}

		if (targetRuntime) {
			targetRuntime.enqueueAdvice(note, severity, findingId, kind);
			dbg("queued advice", severity, JSON.stringify(note).slice(0, 120));
			return false;
		}

		return false;
	}

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
			sendNotes(direct, { finalAnswer: turnState === "ended-terminal", stale: turnState !== "ended-terminal" });
			for (const note of direct) {
				activeAdviseTool?.markDelivered(note.note, note.severity, note.id, note.kind);
				activeRuntime?.markAdviceDelivered([note]);
			}
		} catch (error) {
			for (const note of direct) activeRuntime?.requeueReadyAdvice(note.note, note.severity, note.id, note.kind);
			dbg("direct pair programmer delivery failed", String(error));
		} finally {
			if (latestCtx) updateStatus(latestCtx);
		}
	}

	function flushBoundaryFindings(): void {
		if (!deliveryBlocked()) flushDirectFindings();
	}

	function teardown(): void {
		constructionEpoch++;
		reviewScheduler.reset();
		for (const send of opinionSends) send.abort();
		opinionSends.clear();
		unwatchBash?.();
		unwatchBash = undefined;
		runtime?.dispose();
		runtime = undefined;
		receiptStore?.revoke();
		receiptStore = undefined;
		adviseTool = undefined;
		activeModelLabel = undefined;
		activePairContextWindow = undefined;
		builtForCwd = undefined;
		builtForTrusted = undefined;
		inputSpool.reset();
		autoResumeSuppressed = false;
		awaitingUserAfterAdvisory = false;
		stagedBoundaryNotes = [];
		turnState = "ended-nonterminal";
		primaryTurnSequence = 0;
		lastReviewReason = undefined;
		directFindings.nit = directFindings.concern = directFindings.blocker = 0;
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
		return entries.filter(
			(entry) => isSourceEntry(entry) && (entry.type !== "custom_message" || mailFromEntry(entry) !== undefined),
		);
	}

	function ensureReceiptStore(sessionManager: PrimarySessionManager): PairReceiptStore {
		if (receiptStore) return receiptStore;
		receiptStore = new PairReceiptStore({
			isActiveSourceEntry: (sourceEntryId) =>
				pairSourceEntries(sessionManager.getBranch() as Entry[]).some((entry) => entry.id === sourceEntryId),
		});
		return receiptStore;
	}

	function receiptIssuer(
		sessionManager: PrimarySessionManager,
		entries: readonly unknown[] = sessionManager.getBranch(),
	): PairReceiptIssuer {
		return createPairReceiptIssuer(ensureReceiptStore(sessionManager), entries as Entry[]);
	}

	function resetProjectedSourceCursor(entries: Entry[]): void {
		projectedThroughSourceId = pairSourceEntries(entries).at(-1)?.id;
	}

	function takeNewSourceEntries(entries: Entry[]): Entry[] {
		const start = entryIndexForId(entries, projectedThroughSourceId);
		const fresh = pairSourceEntries(entries.slice(start + 1));
		const latest = fresh.at(-1)?.id;
		if (latest) projectedThroughSourceId = latest;
		return fresh;
	}

	function sourceAddressDelta(delta: string, sourceEntryIds: readonly string[]): string {
		if (!delta.trim() || sourceEntryIds.length === 0) return delta;
		const labels = sourceEntryIds.map((id) => `[Source entry id: ${id}]`).join("\n");
		return `${labels}\n${delta}`;
	}

	function prepareNotebookBatch(ctx: ExtensionContext): PairNotebookBatch | undefined {
		if (!enabled) return undefined;
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
		if (!latestCtx) throw new Error("pair programmer notebook context is unavailable");
		if (update.sessionIdentity && update.sessionIdentity !== sessionIdFromCtx(latestCtx)) {
			throw new Error("pair programmer notebook update belongs to a replaced session");
		}
		const entries = latestCtx.sessionManager.getBranch() as Entry[];
		if (!persistNotebookUpdate(pi, rootNotebook, entries, update)) {
			throw new Error("pair programmer notebook update was rejected");
		}
		showOpenLearnings(latestCtx);
		if (update.reflections.length > 0) {
			rootNotebook.notebookEmptyBackoff = undefined;
		} else if (update.fullMaintenanceDue) {
			rootNotebook.notebookEmptyBackoff = {
				sessionIdentity: update.sessionIdentity,
				coverageId: update.priorCoverageId,
				tokensAtEmpty: update.sourceTokens,
			};
		}
	}

	function watchPrimaryBash(ctx: { sessionManager?: PrimarySessionManager }): void {
		if (unwatchBash || !ctx.sessionManager) return;
		const sessionManager = ctx.sessionManager;
		unwatchBash = bindBashAppendHook(
			sessionManager as { appendMessage?: (message: unknown) => unknown },
			(message, sourceEntryId) => {
				if (!enabled || process.env.PAIR_NO_REVIEW) return;
				const delta = formatUserBash(message, {
					issueReceipt: receiptIssuer(sessionManager),
					sourceEntryId,
				});
				if (!delta) return;
				reviewScheduler.noteUserDirection();
				const sequence = appendSpool(delta);
				if (sequence === undefined) return;
				reviewScheduler.observe({
					sequence,
					renderedTokens: Math.ceil(delta.length / 4),
					toolCalls: [{ name: "bash", arguments: { command: message.command } }],
					toolResults: [
						{
							toolName: "bash",
							exitCode: message.exitCode,
							isError: typeof message.exitCode === "number" && message.exitCode !== 0,
						},
					],
				});
				pumpSpool(ctx as Parameters<typeof ensureRuntime>[0]);
			},
		);
	}

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
			(note, severity, findingId, kind) => deliverAdvice(note, severity, builtRuntime, findingId, kind),
			(_note, findingId, kind) => builtRuntime.canonicalFindingId(findingId, kind),
		);
		const self = sessionIdFromCtx(ctx) ?? "";
		const organizationTools = createSecondOpinionTools(
			self,
			(request) => runtime === builtRuntime && builtRuntime.stageSecondOpinion(request),
		);
		const builtNotebookTool = new UpdateNotebookTool();
		const builtReceiptStore = ensureReceiptStore(ctx.sessionManager);
		const builtReceiptTool = createExpandReceiptTool(builtReceiptStore);
		const builtAttentionTool = createSetPairAttentionTool({
			stage: (lease) => builtRuntime?.stageAttention(lease) ?? false,
		});
		const systemPrompt = loadSystemPrompt(ctx.cwd, projectTrusted);
		const unresolvedNotebook = () => {
			if (!latestCtx) return "";
			const batch = prepareNotebookBatch(latestCtx);
			if (!batch) return "";
			const entries = primaryEntries();
			return formatSourceAddressedTrajectory(
				entries,
				batch.allowedSourceEntryIds,
				receiptIssuer(ctx.sessionManager, entries),
			);
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
				secondOpinionTool: organizationTools.ask,
				directoryTool: organizationTools.directory,
				receiptTool: builtReceiptTool as never,
				attentionTool: builtAttentionTool as never,
				notebookTool: builtNotebookTool as never,
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
		const onSettled = (outcome: "ok" | "failed", reviewedThrough: number, settlement: PairRuntimeSettlement) => {
			if (runtime !== builtRuntime) return;
			lastReviewReason = settlement.permit.reason;
			reviewScheduler.complete({
				outcome,
				...(settlement.reviewedThroughSequence > 0 ? { reviewedThrough: settlement.reviewedThroughSequence } : {}),
				newIntervention: settlement.newIntervention,
				secondOpinionRequested: settlement.secondOpinionRequested,
				...(settlement.lease ? { lease: settlement.lease } : {}),
				silent: settlement.silent,
				terminalCovered: settlement.terminalCovered,
			});
			flushSettledAdvice(outcome, reviewedThrough, builtRuntime);
			if (latestCtx) {
				pumpSpool(latestCtx as Parameters<typeof ensureRuntime>[0]);
				updateStatus(latestCtx);
			}
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
					issueReceipt: receiptIssuer(ctx.sessionManager),
				}),
			builtNotebookTool,
			commitNotebookUpdate,
			(request) => {
				if (!enabled || runtime !== builtRuntime || handoffInProgress()) return;
				const controller = new AbortController();
				opinionSends.add(controller);
				const report = (content: string) => {
					if (controller.signal.aborted || runtime !== builtRuntime) return;
					return session?.sendCustomMessage(
						{ customType: "pair.second-opinion-delivery", content, display: false },
						{ triggerTurn: false },
					);
				};
				void sendSecondOpinion(self, request, controller.signal)
					.then(report, (error: unknown) => {
						if (controller.signal.aborted || runtime !== builtRuntime) return;
						const message = `Second-opinion request failed (thread ${request.thread}): ${error instanceof Error ? error.message : String(error)}`;
						latestCtx?.ui.notify(message, "warning");
						return report(message);
					})
					.catch((error) => dbg("second-opinion delivery status could not be recorded", String(error)))
					.finally(() => opinionSends.delete(controller));
			},
			inputSpool,
			(text) => builtReceiptStore.activatePresented(text),
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

	async function ensureRuntime(
		ctx: Parameters<typeof buildRuntime>[0],
		notifyProfileError = true,
	): Promise<PairRuntime | undefined> {
		const projectTrusted = ctx.isProjectTrusted?.() ?? false;
		const key = `${ctx.cwd}\u0000${projectTrusted}`;
		if (runtime && !runtime.disposed && builtForCwd === ctx.cwd && builtForTrusted === projectTrusted) return runtime;
		if (runtimeBuild) {
			if (runtimeBuild.epoch === constructionEpoch && runtimeBuild.key === key) return runtimeBuild.promise;

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

	function appendSpool(
		text: string,
		boundary = primaryTurnSequence,
		notebookBatch?: PairNotebookBatch,
		terminal = false,
	): number | undefined {
		return inputSpool.append(text, {
			boundary,
			terminal,
			...(notebookBatch ? { notebookBatch } : {}),
		});
	}

	function pumpSpool(ctx: Parameters<typeof ensureRuntime>[0]): void {
		if (!inputSpool.hasPending || !reviewScheduler.snapshot().due || !enabled || process.env.PAIR_NO_REVIEW) {
			return;
		}
		void ensureRuntime(ctx)
			.then((rt) => {
				if (!rt || !enabled || rt !== runtime || rt.reviewing) return;
				const permit = reviewScheduler.takePermit();
				if (!permit) return;
				rt.setUsageSession(sessionIdFromCtx(ctx));
				if (!rt.startReview(permit)) reviewScheduler.cancelPermit(permit);
				updateStatus(ctx);
			})
			.catch((error) => dbg("pair spool pump failed", String(error)));
	}

	pi.on("before_agent_start", (event) => {
		const active = pi.getActiveTools();
		const acknowledging = active.includes("acknowledge_pair_findings");
		if (enabled && !acknowledging) pi.setActiveTools([...active, "acknowledge_pair_findings"]);
		if (!enabled && acknowledging) pi.setActiveTools(active.filter((name) => name !== "acknowledge_pair_findings"));
		if (!enabled) return;
		autoResumeSuppressed = false;
		turnState = "running";
		reviewScheduler.setRunActive(true);
		setSystemPromptSection(event.systemPromptOptions, PRIMARY_PAIR_PROTOCOL_TAG, PRIMARY_PAIR_PROTOCOL);
	});

	pi.on("message_end", (event) => {
		if (!enabled) return;
		if (event.message?.role !== "user") return;
		awaitingUserAfterAdvisory = false;
		if (!userMessageText(event.message).startsWith("/")) reviewScheduler.noteUserDirection();
	});

	pi.on("user_bash", (event, ctx) => {
		if (!enabled) return;
		if (event.excludeFromContext) return;
		if (process.env.PAIR_NO_REVIEW) return;
		watchPrimaryBash(ctx);
	});

	pi.on("agent_start", () => {
		if (!enabled) return;
		turnState = "running";
		reviewScheduler.setRunActive(true);
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!enabled) return;
		latestCtx = ctx;
		turnState = "ended-terminal";
		reviewScheduler.setRunActive(false);
		handleTerminalAcknowledgments();
		if (!runtime || runtime.reviewedThrough >= primaryTurnSequence) flushBoundaryFindings();
		if (inputSpool.hasPending) pumpSpool(ctx as Parameters<typeof ensureRuntime>[0]);
		updateStatus(ctx);
	});

	pi.on("turn_start", () => {
		if (!enabled) return;
		turnState = "running";
	});

	pi.on("turn_end", (event, ctx) => {
		if (!enabled) return;
		const terminal = isTerminalTurn(event.message as AssistantMessage);
		turnState = terminal ? "ended-terminal" : "ended-nonterminal";
		latestCtx = ctx;
		acknowledgments.advanceTurn();
		primaryTurnSequence++;
		const boundarySequence = primaryTurnSequence;

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
		const toolResults = event.toolResults as ToolResultMessage[];
		const entries = ctx.sessionManager.getBranch() as Entry[];
		const fresh = takeNewSourceEntries(entries);
		const sourceEntryIds = fresh.map((entry) => entry.id);
		const delta = sourceAddressDelta(
			formatTurnDelta({
				userMessages: livePairUserMessages(fresh),
				assistant: event.message as AssistantMessage,
				toolResults,
				issueReceipt: receiptIssuer(ctx.sessionManager, entries),
			}),
			sourceEntryIds,
		);
		const notebookBatch = prepareNotebookBatch(ctx);

		const sequence = appendSpool(delta, boundarySequence, notebookBatch, terminal);
		if (sequence !== undefined) {
			reviewScheduler.observe({
				sequence,
				renderedTokens: Math.ceil(delta.length / 4),
				terminal,
				assistant: event.message as never,
				toolResults: toolResults as never,
			});
			pumpSpool(ctx as Parameters<typeof ensureRuntime>[0]);
		}
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
		reviewScheduler.dispose();
		acknowledgments.reset();
		rootNotebook.dispose();
		(ctx as { ui?: { setStatus?: (k: string, t: string | undefined) => void } }).ui?.setStatus?.(STATUS_KEY, undefined);
	});

	renderInline(ADVISORY_TYPE);
	pi.registerMessageRenderer<{ notes: PairNote[] }>(ADVISORY_TYPE, (message, _options, theme) => {
		const notes = message.details?.notes;
		if (!notes?.length) return undefined;
		const container = new Container();
		for (const n of notes) {
			const color =
				isPairQuestion(n) || n.severity === "concern" ? "accent" : n.severity === "blocker" ? "error" : "muted";
			const tag = isPairQuestion(n) ? "QUESTION" : (n.severity ?? "nit").toUpperCase();
			const source = n.source === "consultant" || n.source === "advisor" ? " (consultant)" : "";
			const heading = `${theme.fg(color, "●")} ${theme.fg(color, tag)}${theme.fg("muted", source)}`;
			const summary = n.note.replace(/\s+/g, " ").trim();
			container.addChild(new TruncatedText(`${heading} ${theme.fg("text", summary)}`, 0, 0));
		}
		return container;
	});

	pi.registerCommand("pair", {
		description: "Control the pair programmer. Usage: /pair [on|off|status|notebook [full]]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "notebook" || arg === "notebook full") {
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
				const pacing = reviewScheduler.snapshot();
				const pacingState = rt.reviewing ? "reviewing" : pacing.pendingItems > 0 ? "watching" : "idle";
				const entries = ctx.sessionManager.getBranch() as Entry[];
				const notebook = foldLedger(entries);
				const notebookProgress = rawTokensSinceObservationCoverage(entries);
				ctx.ui.notify(
					`Pair programmer enabled — profile ${PAIR_MODEL_PROFILE}, model ${activeModelLabel}, state ${pacingState}, backlog ${rt.backlog}, reviews ${rt.reviewCount}, attention ${pacing.attention}, wake ${pacing.wakeOn.join("/") || "mandatory-only"}, unseen ~${pacing.pendingTokens} tok, last ${lastReviewReason ?? "none"}, findings ${directFindings.nit}n/${directFindings.concern}c/${directFindings.blocker}b, acknowledgments ${acknowledgments.pendingCount} pending, tokens ${u.input}in/${u.output}out, cost $${u.cost.toFixed(4)}, ctx ${ctxStr}\n` +
						`Notebook — ${notebook.currentReflections.length} working conclusions, ~${notebookProgress.toLocaleString()} uncovered source tokens`,
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
