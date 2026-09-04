import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type PairWorkPhase =
	| "exploration"
	| "mutation"
	| "execution"
	| "verification"
	| "delegation"
	| "recovery"
	| "response";

export type PairReviewBaseReason =
	| "orientation"
	| "phase_mutation"
	| "phase_verification"
	| "phase_transition"
	| "delegated_result"
	| "failure"
	| "frontier_reconfirm"
	| "terminal"
	| "starvation_tokens"
	| "starvation_time";

export type PairReviewReason = PairReviewBaseReason | `retry:${PairReviewBaseReason}`;

export type PairAttentionLevel = "close" | "routine" | "relaxed";
export type PairWakeCondition = "phase_transition" | "mutation" | "verification" | "delegated_result";

export type PairAttentionLease = {
	readonly attention: PairAttentionLevel;
	readonly wakeOn: readonly PairWakeCondition[];
};

export type PairReviewPermit = {
	readonly reviewId: string;
	readonly reason: PairReviewReason;
	readonly attention: PairAttentionLevel;
	readonly batchItems: number;
	readonly batchTokens: number;
	readonly activeWaitMs: number;
	readonly throughSequence: number;
};

export type PairAssistantView = {
	readonly errorMessage?: string;
	readonly stopReason?: string;
	readonly aborted?: boolean;
	readonly content?: readonly { readonly type?: string; readonly name?: string; readonly arguments?: unknown }[];
};

export type PairToolCallView = {
	readonly name?: string;
	readonly arguments?: unknown;
	readonly details?: unknown;
};

export type PairToolResultView = {
	readonly toolName?: string;
	readonly isError?: boolean;
	readonly exitCode?: unknown;
	readonly details?: unknown;
	readonly content?: unknown;
};

export type PairReviewObservation = {
	readonly sequence: number;
	readonly renderedTokens: number;
	readonly terminal?: boolean;
	readonly assistant?: PairAssistantView;
	readonly toolCalls?: readonly PairToolCallView[];
	readonly toolResults?: readonly PairToolResultView[];
};

export type PairReviewSettlement = {
	readonly outcome: "ok" | "failed";
	readonly reviewedThrough?: number;
	readonly newIntervention?: boolean;
	readonly consultantRequested?: boolean;
	readonly lease?: PairAttentionLease;
	readonly silent?: boolean;
	readonly terminalCovered?: boolean;
};

export type PairReviewSchedulerSnapshot = {
	readonly attention: PairAttentionLevel;
	readonly phase: PairWorkPhase | undefined;
	readonly committedPhase: PairWorkPhase | undefined;
	readonly wakeOn: readonly PairWakeCondition[];
	readonly pendingItems: number;
	readonly pendingTokens: number;
	readonly pendingThroughSequence: number | undefined;
	readonly due: boolean;
	readonly inFlight: boolean;
	readonly runActive: boolean;
	readonly orientationArmed: boolean;
	readonly reconfirmArmed: boolean;
	readonly retryBlocked: boolean;
	readonly permit: PairReviewPermit | undefined;
	readonly accumulatedActiveMs: number;
};

export type PairWorkClassification = {
	readonly failure: boolean;
	readonly delegatedResult: boolean;
	readonly verification: boolean;
	readonly mutation: boolean;
	readonly phase: PairWorkPhase;
};

export type PairReviewSchedulerDeps = {
	now: () => number;
	setTimer: (callback: () => void, delayMs: number) => unknown;
	clearTimer: (handle: unknown) => void;
	onDue: (permit: PairReviewPermit) => void;
};

export const SET_PAIR_ATTENTION_TOOL_NAME = "set_pair_attention";

export const DEFAULT_PAIR_WAKE_ON: readonly PairWakeCondition[] = Object.freeze([
	"mutation",
	"verification",
	"delegated_result",
	"phase_transition",
]);

export const PAIR_ATTENTION_FALLBACKS: Readonly<
	Record<PairAttentionLevel, { readonly activeMs: number; readonly tokens: number }>
> = Object.freeze({
	close: Object.freeze({ activeMs: 5 * 60_000, tokens: 8_000 }),
	routine: Object.freeze({ activeMs: 7.5 * 60_000, tokens: 12_000 }),
	relaxed: Object.freeze({ activeMs: 10 * 60_000, tokens: 16_000 }),
});

const ATTENTION_WIDEN: Readonly<Record<PairAttentionLevel, PairAttentionLevel>> = {
	close: "routine",
	routine: "relaxed",
	relaxed: "relaxed",
};

const REASON_PRIORITY: readonly PairReviewBaseReason[] = [
	"failure",
	"frontier_reconfirm",
	"terminal",
	"orientation",
	"delegated_result",
	"phase_verification",
	"phase_mutation",
	"phase_transition",
	"starvation_tokens",
	"starvation_time",
];

const MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"]);
const EXPLORATION_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"search_session",
	"revisit_note",
	"wiki",
	"wiki_lint",
	"wiki_references",
]);
const VERIFICATION_TOOLS = new Set(["test", "lint", "typecheck", "check", "build"]);
const DELEGATION_TOOLS = new Set(["agent", "steer_subagent", "stop_subagent"]);
const DELEGATED_RESULT_TOOLS = new Set(["get_subagent_result"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "npx"]);
const VERIFICATION_BINS = new Set([
	"test",
	"lint",
	"typecheck",
	"tsc",
	"vitest",
	"jest",
	"mocha",
	"pytest",
	"eslint",
	"ruff",
	"mypy",
	"pyright",
	"build",
]);
const VERIFICATION_SEGMENTS = new Set(["test", "tests", "lint", "typecheck", "check", "build", "ci", "verify", "tsc"]);
const EXPLORATION_BINS = new Set(["ls", "grep", "find", "rg"]);
const FAILURE_STOPS = new Set(["error", "aborted", "length"]);
const WAKE_CONDITIONS = new Set<PairWakeCondition>([
	"phase_transition",
	"mutation",
	"verification",
	"delegated_result",
]);
const ATTENTION_LEVELS = new Set<PairAttentionLevel>(["close", "routine", "relaxed"]);

type PendingItem = {
	readonly observation: PairReviewObservation;
	readonly classification: PairWorkClassification;
	readonly directionVersion: number;
};

function frozenWakeOn(values: readonly PairWakeCondition[]): readonly PairWakeCondition[] {
	return Object.freeze([...values]);
}

function toolName(value: string | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function numericExitCode(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resultExitCode(result: PairToolResultView): number | undefined {
	const direct = numericExitCode(result.exitCode);
	if (direct !== undefined) return direct;
	if (!isRecord(result.details)) return undefined;
	return numericExitCode(result.details.exitCode ?? result.details.exit_code);
}

function nonemptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function looksLikeUnifiedDiff(value: unknown): boolean {
	const text = nonemptyString(value);
	if (!text) return false;
	return text.startsWith("diff ") || text.startsWith("@@") || text.includes("\n@@") || text.includes("\n+++ ");
}

function detailsHaveDiff(details: unknown): boolean {
	if (looksLikeUnifiedDiff(details)) return true;
	if (!isRecord(details)) return false;
	return [details.diff, details.unifiedDiff, details.unified_diff, details.patch].some(looksLikeUnifiedDiff);
}

function collectToolCalls(input: {
	assistant?: PairAssistantView;
	toolCalls?: readonly PairToolCallView[];
}): PairToolCallView[] {
	const calls = [...(input.toolCalls ?? [])];
	for (const part of input.assistant?.content ?? []) {
		if (part?.type === "toolCall" || part?.type === "toolUse") {
			calls.push({ name: part.name, arguments: part.arguments });
		}
	}
	return calls;
}

function commandOf(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!isRecord(value)) return undefined;
	return nonemptyString(value.command) ?? nonemptyString(value.cmd);
}

function basename(token: string): string {
	const trimmed = token.replace(/^['"]|['"]$/g, "");
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).toLowerCase();
}

function commandTokens(command: string): string[] {
	const tokens: string[] = [];
	for (const raw of command.trim().split(/\s+/)) {
		const token = raw.replace(/^['"]|['"]$/g, "");
		if (!token || (token.includes("=") && !token.startsWith("-"))) continue;
		tokens.push(token);
	}
	return tokens;
}

function scriptIsVerification(script: string | undefined): boolean {
	if (!script) return false;
	return script
		.toLowerCase()
		.split(/[:_-]/)
		.some((segment) => VERIFICATION_SEGMENTS.has(segment));
}

export function commandLooksLikeVerification(command: string): boolean {
	return command.split(/&&|;|\|\|/).some((segment) => {
		const tokens = commandTokens(segment);
		if (tokens.length === 0) return false;
		const bin = basename(tokens[0] ?? "");
		if (PACKAGE_MANAGERS.has(bin)) {
			if (bin === "npm" && tokens[1] === "pack" && tokens.includes("--dry-run")) return true;
			const rest = tokens.slice(1).filter((token) => token !== "run" && token !== "exec" && !token.startsWith("-"));
			return scriptIsVerification(rest[0]);
		}
		if (VERIFICATION_BINS.has(bin)) return true;
		if (bin === "git") return tokens[1] === "diff" && tokens.includes("--check");
		if (bin === "cargo") return ["test", "build", "clippy", "check"].includes(basename(tokens[1] ?? ""));
		if (bin === "go") return ["test", "build", "vet"].includes(basename(tokens[1] ?? ""));
		if (bin === "swift" || bin === "dotnet") return ["test", "build"].includes(basename(tokens[1] ?? ""));
		if (bin === "make") return scriptIsVerification(tokens[1]);
		if ((bin === "python" || bin === "python3") && tokens[1] === "-m") return scriptIsVerification(tokens[2]);
		return false;
	});
}

function commandLooksLikeExploration(command: string): boolean {
	const bin = basename(commandTokens(command)[0] ?? "");
	return EXPLORATION_BINS.has(bin);
}

function toolCommand(call: PairToolCallView, results: readonly PairToolResultView[]): string | undefined {
	return commandOf(call.arguments) ?? results.map((result) => commandOf(result.details)).find(Boolean);
}

function delegatedStatus(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const status = value.status ?? value.state;
	return typeof status === "string" ? status.toLowerCase() : undefined;
}

function isCompletedDelegatedResult(result: PairToolResultView): boolean {
	const status = delegatedStatus(result.details);
	return status === undefined || !["queued", "running", "background"].includes(status);
}

function classifiedPhase(flags: {
	failure: boolean;
	verification: boolean;
	mutation: boolean;
	delegation: boolean;
	execution: boolean;
	exploration: boolean;
}): PairWorkPhase {
	if (flags.failure) return "recovery";
	if (flags.verification) return "verification";
	if (flags.mutation) return "mutation";
	if (flags.delegation) return "delegation";
	if (flags.execution) return "execution";
	if (flags.exploration) return "exploration";
	return "response";
}

export function classifyPairWork(input: {
	assistant?: PairAssistantView;
	toolCalls?: readonly PairToolCallView[];
	toolResults?: readonly PairToolResultView[];
}): PairWorkClassification {
	const results = input.toolResults ?? [];
	const calls = collectToolCalls(input);
	const stop = input.assistant?.stopReason?.toLowerCase();
	const failure =
		input.assistant?.aborted === true ||
		(stop !== undefined && FAILURE_STOPS.has(stop)) ||
		results.some((result) => result.isError === true || (resultExitCode(result) ?? 0) !== 0);

	let delegatedResult = false;
	let verification = false;
	let mutation = false;
	let delegation = false;
	let execution = false;
	let exploration = false;

	const consider = (name: string, call: PairToolCallView | undefined, result: PairToolResultView | undefined) => {
		if (DELEGATED_RESULT_TOOLS.has(name)) {
			delegation = true;
			if (result && isCompletedDelegatedResult(result)) delegatedResult = true;
		} else if (DELEGATION_TOOLS.has(name)) {
			delegation = true;
			if (name === "agent" && result && delegatedStatus(result.details) === "completed") delegatedResult = true;
		} else if (MUTATION_TOOLS.has(name) || detailsHaveDiff(call?.details) || detailsHaveDiff(result?.details)) {
			mutation = true;
		} else if (VERIFICATION_TOOLS.has(name)) verification = true;
		else if (EXPLORATION_TOOLS.has(name) || name.startsWith("wiki_")) exploration = true;
		else if (name === "bash" || name === "bash_execution") {
			const command = call ? toolCommand(call, results) : commandOf(result?.details);
			if (!command) return;
			if (commandLooksLikeVerification(command)) verification = true;
			else if (commandLooksLikeExploration(command)) exploration = true;
			else execution = true;
		} else if (name === "pi_exec" || name === "pi_exec_program") execution = true;
		else if (name) execution = true;
	};

	for (const call of calls) consider(toolName(call.name), call, undefined);
	for (const result of results) consider(toolName(result.toolName), undefined, result);
	if (
		calls.some((call) => detailsHaveDiff(call.details)) ||
		results.some((result) => detailsHaveDiff(result.details))
	) {
		mutation = true;
	}

	return {
		failure,
		delegatedResult,
		verification,
		mutation,
		phase: classifiedPhase({
			failure,
			verification,
			mutation,
			delegation,
			execution,
			exploration,
		}),
	};
}

export function nextPairWorkPhase(
	previous: PairWorkPhase | undefined,
	classified: PairWorkClassification,
): PairWorkPhase | undefined {
	const stickyCandidate =
		classified.phase === "recovery" || !classified.delegatedResult || classified.verification || classified.mutation
			? classified.phase
			: "response";
	if (stickyCandidate === "response") return previous;
	if (previous !== undefined && stickyCandidate === "exploration") return previous;
	if (
		(previous === "mutation" || previous === "verification" || previous === "delegation" || previous === "recovery") &&
		stickyCandidate === "execution"
	) {
		return previous;
	}
	return stickyCandidate;
}

function reasonPriority(reason: PairReviewBaseReason): number {
	const index = REASON_PRIORITY.indexOf(reason);
	return index === -1 ? REASON_PRIORITY.length : index;
}

function pickReason(reasons: readonly PairReviewBaseReason[]): PairReviewBaseReason | undefined {
	let best: PairReviewBaseReason | undefined;
	for (const reason of reasons) {
		if (!best || reasonPriority(reason) < reasonPriority(best)) best = reason;
	}
	return best;
}

function copyPermit(permit: PairReviewPermit): PairReviewPermit {
	return Object.freeze({ ...permit });
}

function normalizeLease(lease: PairAttentionLease | undefined): PairAttentionLease | undefined {
	if (!lease || !ATTENTION_LEVELS.has(lease.attention)) return undefined;
	const wakeOn = [...new Set(lease.wakeOn.filter((item): item is PairWakeCondition => WAKE_CONDITIONS.has(item)))];
	if (wakeOn.length !== lease.wakeOn.length) return undefined;
	return { attention: lease.attention, wakeOn: frozenWakeOn(wakeOn) };
}

function renderedTokensOf(observation: PairReviewObservation): number {
	return Number.isFinite(observation.renderedTokens) ? Math.max(0, Math.floor(observation.renderedTokens)) : 0;
}

export class PairReviewScheduler {
	#now: () => number;
	#setTimer: (callback: () => void, delayMs: number) => unknown;
	#clearTimer: (handle: unknown) => void;
	#onDue: (permit: PairReviewPermit) => void;
	#attention: PairAttentionLevel = "close";
	#wakeOn: readonly PairWakeCondition[] = DEFAULT_PAIR_WAKE_ON;
	#committedPhase: PairWorkPhase | undefined;
	#pending: PendingItem[] = [];
	#duePermit: PairReviewPermit | undefined;
	#inFlight: PairReviewPermit | undefined;
	#runActive = false;
	#directionVersion = 0;
	#inFlightDirectionVersion = 0;
	#attentionVersion = 0;
	#inFlightAttentionVersion = 0;
	#orientationArmed = true;
	#reconfirmArmed = false;
	#retryBlocked = false;
	#retryReason: PairReviewBaseReason | undefined;
	#reviewSeq = 0;
	#timer: unknown;
	#pendingActiveMs = 0;
	#pendingActiveMark: number | undefined;
	#disposed = false;
	#notifiedDue = false;

	constructor(deps: PairReviewSchedulerDeps) {
		this.#now = deps.now;
		this.#setTimer = deps.setTimer;
		this.#clearTimer = deps.clearTimer;
		this.#onDue = deps.onDue;
	}

	noteUserDirection(): void {
		if (this.#disposed) return;
		this.#directionVersion++;
		this.#attentionVersion++;
		this.#attention = "close";
		this.#wakeOn = DEFAULT_PAIR_WAKE_ON;
		this.#committedPhase = undefined;
		this.#orientationArmed = true;
		this.#reconfirmArmed = false;
		this.#retryBlocked = false;
		if (!this.#inFlight) {
			this.#duePermit = undefined;
			this.#notifiedDue = false;
		}
		this.#syncDue();
	}

	setRunActive(active: boolean): void {
		if (this.#disposed || this.#runActive === active) return;
		this.#flushActive();
		this.#runActive = active;
		if (active) this.#armActive();
		else this.#pendingActiveMark = undefined;
		this.#syncDue();
	}

	observe(observation: PairReviewObservation): void {
		if (this.#disposed) return;
		const priorPhase = this.#pendingPhase();
		const classification = classifyPairWork(observation);
		this.#pending.push({
			observation,
			classification,
			directionVersion: this.#directionVersion,
		});
		const nextPhase = this.#pendingPhase();
		if (
			classification.failure ||
			classification.delegatedResult ||
			classification.mutation ||
			classification.verification ||
			(priorPhase !== undefined && nextPhase !== priorPhase)
		) {
			this.#attentionVersion++;
			this.#attention = "close";
		}
		this.#retryBlocked = false;
		this.#armActive();
		this.#syncDue();
	}

	takePermit(): PairReviewPermit | undefined {
		if (this.#disposed || this.#inFlight || !this.#duePermit) return undefined;
		this.#flushActive();
		const permit = copyPermit({
			...this.#duePermit,
			activeWaitMs: this.#pendingActiveMs,
			...this.#batchMetrics(),
			reason: this.#duePermit.reason,
			attention: this.#attention,
		});
		this.#inFlight = permit;
		this.#inFlightDirectionVersion = this.#directionVersion;
		this.#inFlightAttentionVersion = this.#attentionVersion;
		this.#duePermit = undefined;
		this.#notifiedDue = false;
		this.#pendingActiveMark = undefined;
		this.#clearTimerHandle();
		return permit;
	}

	cancelPermit(permit: PairReviewPermit): void {
		if (this.#disposed || this.#inFlight?.reviewId !== permit.reviewId) return;
		this.#duePermit = this.#inFlight;
		this.#inFlight = undefined;
		this.#notifiedDue = true;
		this.#armActive();
	}

	complete(settlement: PairReviewSettlement): void {
		if (this.#disposed || !this.#inFlight) return;
		const reviewed = this.#inFlight;
		this.#inFlight = undefined;
		if (settlement.outcome !== "ok") {
			const newerEvidence = this.#pending.some((item) => item.observation.sequence > reviewed.throughSequence);
			this.#retryBlocked = !newerEvidence;
			this.#retryReason = unwrapReason(reviewed.reason);
			this.#notifiedDue = false;
			this.#duePermit = undefined;
			this.#pendingActiveMs = 0;
			this.#pendingActiveMark = undefined;
			this.#armActive();
			this.#syncDue();
			return;
		}
		this.#commitSuccess(reviewed, settlement);
	}

	reset(): void {
		if (this.#disposed) return;
		this.#clearTimerHandle();
		this.#attention = "close";
		this.#wakeOn = DEFAULT_PAIR_WAKE_ON;
		this.#committedPhase = undefined;
		this.#pending = [];
		this.#duePermit = undefined;
		this.#inFlight = undefined;
		this.#runActive = false;
		this.#directionVersion = 0;
		this.#inFlightDirectionVersion = 0;
		this.#attentionVersion = 0;
		this.#inFlightAttentionVersion = 0;
		this.#orientationArmed = true;
		this.#reconfirmArmed = false;
		this.#retryBlocked = false;
		this.#retryReason = undefined;
		this.#pendingActiveMs = 0;
		this.#pendingActiveMark = undefined;
		this.#notifiedDue = false;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.reset();
		this.#disposed = true;
	}

	snapshot(): PairReviewSchedulerSnapshot {
		this.#flushActive();
		const permit = this.#inFlight ?? this.#duePermit;
		return Object.freeze({
			attention: this.#attention,
			phase: this.#pendingPhase(),
			committedPhase: this.#committedPhase,
			wakeOn: frozenWakeOn(this.#wakeOn),
			pendingItems: this.#pending.length,
			pendingTokens: this.#pending.reduce((sum, item) => sum + renderedTokensOf(item.observation), 0),
			pendingThroughSequence: this.#pending.at(-1)?.observation.sequence,
			due: this.#duePermit !== undefined,
			inFlight: this.#inFlight !== undefined,
			runActive: this.#runActive,
			orientationArmed: this.#orientationArmed,
			reconfirmArmed: this.#reconfirmArmed,
			retryBlocked: this.#retryBlocked,
			permit: permit ? copyPermit(permit) : undefined,
			accumulatedActiveMs: this.#pendingActiveMs,
		});
	}

	#commitSuccess(reviewed: PairReviewPermit, settlement: PairReviewSettlement): void {
		const reviewedThrough = settlement.reviewedThrough ?? reviewed.throughSequence;
		const firstUncovered = this.#pending.findIndex((item) => item.observation.sequence > reviewedThrough);
		const splitAt = firstUncovered === -1 ? this.#pending.length : firstUncovered;
		const covered = this.#pending.slice(0, splitAt);
		this.#pending = this.#pending.slice(splitAt);
		const currentDirection = covered.filter((item) => item.directionVersion === this.#directionVersion);
		if (currentDirection.length > 0) {
			this.#committedPhase = foldPhase(this.#committedPhase, currentDirection);
			this.#orientationArmed = false;
		}
		this.#retryBlocked = false;
		this.#retryReason = undefined;
		this.#pendingActiveMs = 0;
		this.#pendingActiveMark = undefined;
		this.#applySettlementAttention(settlement);
		const armReconfirm = Boolean(settlement.newIntervention) && !settlement.terminalCovered;
		this.#reconfirmArmed = armReconfirm;
		if (armReconfirm && this.#pending.length > 0) {
			this.#syncDue();
			return;
		}
		this.#armActive();
		this.#syncDue();
	}

	#applySettlementAttention(settlement: PairReviewSettlement): void {
		const lease = normalizeLease(settlement.lease);
		const resetClose = Boolean(settlement.newIntervention || settlement.consultantRequested);
		const directionChanged = this.#inFlightDirectionVersion !== this.#directionVersion;
		const newerAttentionReset = this.#inFlightAttentionVersion !== this.#attentionVersion;
		if (lease && !directionChanged) {
			this.#wakeOn = lease.wakeOn;
			this.#attention = resetClose || newerAttentionReset ? "close" : lease.attention;
			return;
		}
		if (resetClose) {
			this.#attention = "close";
			if (!directionChanged) this.#wakeOn = DEFAULT_PAIR_WAKE_ON;
			return;
		}
		if (settlement.silent && !directionChanged && !newerAttentionReset) {
			this.#attention = ATTENTION_WIDEN[this.#attention];
		}
	}

	#pendingPhase(): PairWorkPhase | undefined {
		return foldPhase(
			this.#committedPhase,
			this.#pending.filter((item) => item.directionVersion === this.#directionVersion),
		);
	}

	#batchMetrics(): { batchItems: number; batchTokens: number; throughSequence: number } {
		return {
			batchItems: this.#pending.length,
			batchTokens: this.#pending.reduce((sum, item) => sum + renderedTokensOf(item.observation), 0),
			throughSequence: this.#pending.reduce((max, item) => Math.max(max, item.observation.sequence), 0),
		};
	}

	#evaluateReason(): PairReviewBaseReason | undefined {
		if (this.#pending.length === 0) return undefined;
		const reasons: PairReviewBaseReason[] = [];
		const wakes = new Set(this.#wakeOn);
		if (this.#pending.some((item) => item.classification.failure)) reasons.push("failure");
		if (this.#reconfirmArmed) reasons.push("frontier_reconfirm");
		if (this.#pending.some((item) => item.observation.terminal)) reasons.push("terminal");
		if (this.#orientationArmed && this.#pending.some((item) => item.directionVersion === this.#directionVersion)) {
			reasons.push("orientation");
		}
		if (this.#pending.some((item) => item.classification.delegatedResult) && wakes.has("delegated_result")) {
			reasons.push("delegated_result");
		}
		const nextPhase = this.#pendingPhase();
		const changed = nextPhase !== undefined && nextPhase !== this.#committedPhase;
		// mutation/verification wakes are enter-phase checkpoints, not per-edit reviews.
		if (changed && nextPhase === "verification" && wakes.has("verification")) reasons.push("phase_verification");
		if (changed && nextPhase === "mutation" && wakes.has("mutation")) reasons.push("phase_mutation");
		if (
			changed &&
			nextPhase !== "recovery" &&
			nextPhase !== "verification" &&
			nextPhase !== "mutation" &&
			this.#committedPhase !== undefined &&
			wakes.has("phase_transition")
		) {
			reasons.push("phase_transition");
		}
		this.#flushActive();
		const fallback = PAIR_ATTENTION_FALLBACKS[this.#attention];
		const tokens = this.#pending.reduce((sum, item) => sum + renderedTokensOf(item.observation), 0);
		if (tokens >= fallback.tokens) reasons.push("starvation_tokens");
		if (this.#pendingActiveMs >= fallback.activeMs) reasons.push("starvation_time");
		return pickReason(reasons);
	}

	#syncDue(): void {
		if (this.#disposed || this.#inFlight) {
			this.#clearTimerHandle();
			return;
		}
		if (this.#retryBlocked) {
			this.#duePermit = undefined;
			this.#notifiedDue = false;
			this.#syncTimer();
			return;
		}
		const reason = this.#evaluateReason();
		if (!reason) {
			this.#duePermit = undefined;
			this.#notifiedDue = false;
			this.#syncTimer();
			return;
		}
		const metrics = this.#batchMetrics();
		this.#flushActive();
		const permit: PairReviewPermit = Object.freeze({
			reviewId: this.#duePermit?.reviewId ?? `rev-${++this.#reviewSeq}`,
			reason: this.#retryReason ? (`retry:${this.#retryReason}` as const) : reason,
			attention: this.#attention,
			batchItems: metrics.batchItems,
			batchTokens: metrics.batchTokens,
			activeWaitMs: this.#pendingActiveMs,
			throughSequence: metrics.throughSequence,
		});
		this.#duePermit = permit;
		this.#clearTimerHandle();
		if (!this.#notifiedDue) {
			this.#notifiedDue = true;
			this.#onDue(copyPermit(permit));
		}
	}

	#syncTimer(): void {
		this.#clearTimerHandle();
		if (this.#disposed || this.#inFlight || !this.#runActive || this.#pending.length === 0) return;
		this.#flushActive();
		const remaining = PAIR_ATTENTION_FALLBACKS[this.#attention].activeMs - this.#pendingActiveMs;
		if (remaining <= 0) return;
		this.#timer = this.#setTimer(() => {
			this.#timer = undefined;
			this.#flushActive();
			if (this.#retryBlocked) {
				this.#retryBlocked = false;
			}
			this.#syncDue();
		}, remaining);
	}

	#flushActive(): void {
		if (this.#pendingActiveMark === undefined) return;
		this.#pendingActiveMs += Math.max(0, this.#now() - this.#pendingActiveMark);
		this.#pendingActiveMark = this.#runActive && this.#pending.length > 0 && !this.#inFlight ? this.#now() : undefined;
	}

	#armActive(): void {
		if (!this.#runActive || this.#pending.length === 0 || this.#inFlight) return;
		if (this.#pendingActiveMark === undefined) this.#pendingActiveMark = this.#now();
	}

	#clearTimerHandle(): void {
		if (this.#timer === undefined) return;
		this.#clearTimer(this.#timer);
		this.#timer = undefined;
	}
}

function unwrapReason(reason: PairReviewReason): PairReviewBaseReason {
	return (reason.startsWith("retry:") ? reason.slice("retry:".length) : reason) as PairReviewBaseReason;
}

function foldPhase(start: PairWorkPhase | undefined, items: readonly PendingItem[]): PairWorkPhase | undefined {
	let phase = start;
	for (const item of items) phase = nextPairWorkPhase(phase, item.classification);
	return phase;
}

export function createPairReviewScheduler(deps: PairReviewSchedulerDeps): PairReviewScheduler {
	return new PairReviewScheduler(deps);
}

const attentionLeaseSchema = Type.Object(
	{
		attention: Type.Union([Type.Literal("close"), Type.Literal("routine"), Type.Literal("relaxed")]),
		wake_on: Type.Array(
			Type.Union([
				Type.Literal("phase_transition"),
				Type.Literal("mutation"),
				Type.Literal("verification"),
				Type.Literal("delegated_result"),
			]),
		),
	},
	{ additionalProperties: false },
);

export type SetPairAttentionDetails = { readonly staged: boolean };

export function createSetPairAttentionTool(hooks: {
	stage: (lease: PairAttentionLease) => boolean;
}): ToolDefinition<typeof attentionLeaseSchema, SetPairAttentionDetails> {
	return defineTool({
		name: SET_PAIR_ATTENTION_TOOL_NAME,
		label: "Set pair attention",
		description:
			"Optional final action that stages the next useful checkpoint for this pairing session. Use only when the next valuable review is not the default. The host still wakes on orientation, failures, terminal evidence, starved unseen work, and armed reconfirmation.",
		promptSnippet: "set_pair_attention({ attention, wake_on }) stages the next review checkpoint; it is optional.",
		promptGuidelines: [
			"Call set_pair_attention only as a final action when the next useful checkpoint should change.",
			"Leave attention unchanged when the default checkpoints still match the work.",
			"The host keeps mandatory wakes; a lease cannot sleep through failures, terminal evidence, or starved unseen work.",
		],
		parameters: attentionLeaseSchema,
		async execute(_toolCallId, params): Promise<AgentToolResult<SetPairAttentionDetails>> {
			const lease: PairAttentionLease = {
				attention: params.attention,
				wakeOn: frozenWakeOn(params.wake_on),
			};
			const staged = hooks.stage(lease);
			return {
				content: [
					{ type: "text", text: staged ? "Attention lease staged." : "No active review; attention was not changed." },
				],
				details: { staged },
				terminate: true,
			};
		},
	});
}
