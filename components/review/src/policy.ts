import type { Model } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ReviewBudgets, ReviewProfile, ReviewRoleEnvelope, ReviewSource } from "./types.js";

/** Package-owned ceilings. Ordinary callers never configure these values. */
export const REVIEW_PACKAGE_MAXIMA: Readonly<ReviewBudgets> = {
	maxTokens: 1_000_000,
	timeoutSeconds: 7_200,
	maxConcurrency: 8,
	plannerMaxTurns: 24,
	reviewerMaxTurns: 48,
	verifierMaxTurns: 32,
	maxGroups: 32,
	maxPromptBytes: 512 * 1024,
};

const PROFILE_BUDGETS: Record<ReviewProfile, ReviewBudgets> = {
	fast: {
		maxTokens: 300_000,
		timeoutSeconds: 1_800,
		maxConcurrency: 4,
		plannerMaxTurns: 8,
		reviewerMaxTurns: 16,
		verifierMaxTurns: 10,
		maxGroups: 12,
		maxPromptBytes: 256 * 1024,
	},
	balanced: {
		maxTokens: 600_000,
		timeoutSeconds: 3_600,
		maxConcurrency: 4,
		plannerMaxTurns: 12,
		reviewerMaxTurns: 25,
		verifierMaxTurns: 15,
		maxGroups: 24,
		maxPromptBytes: 384 * 1024,
	},
	thorough: {
		maxTokens: 1_000_000,
		timeoutSeconds: 7_200,
		maxConcurrency: 2,
		plannerMaxTurns: 20,
		reviewerMaxTurns: 40,
		verifierMaxTurns: 24,
		maxGroups: 32,
		maxPromptBytes: 512 * 1024,
	},
};

export interface SealedReviewShape {
	selectedItems: number;
	diffBytes: number;
	binaryWaivers: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function whole(value: number | undefined, fallback: number, maximum: number): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 1 || value > maximum)
		throw new Error(`Internal review constraint must be an integer between 1 and ${maximum}`);
	return value;
}

/**
 * Shape can safely affect how much parallel semantic work is useful. It never
 * decides prompt or role capacity: that requires the fully rendered stage.
 */
export function deriveReviewBudgets(
	profile: ReviewProfile,
	shape: SealedReviewShape,
	constraints: Partial<Pick<ReviewBudgets, "maxTokens" | "timeoutSeconds">> = {},
): ReviewBudgets {
	const base = PROFILE_BUDGETS[profile];
	const density = Math.max(1, Math.ceil(shape.diffBytes / (48 * 1024)));
	const maxGroups = clamp(Math.max(1, Math.min(shape.selectedItems, density * 4)), 1, base.maxGroups);
	const maxConcurrency = clamp(Math.min(base.maxConcurrency, maxGroups), 1, REVIEW_PACKAGE_MAXIMA.maxConcurrency);
	return {
		...base,
		maxTokens: whole(constraints.maxTokens, base.maxTokens, REVIEW_PACKAGE_MAXIMA.maxTokens),
		timeoutSeconds: whole(constraints.timeoutSeconds, base.timeoutSeconds, REVIEW_PACKAGE_MAXIMA.timeoutSeconds),
		maxGroups,
		maxConcurrency,
	};
}

function modelNumber(value: number | undefined, fallback: number): number {
	return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function outputReserve(
	stage: ReviewRoleEnvelope["stage"],
	profile: ReviewProfile,
	modelMaxOutputTokens: number,
): number {
	const base = stage === "reviewer" ? (profile === "thorough" ? 12_000 : 8_000) : 4_000;
	return Math.max(1_024, Math.min(base, modelMaxOutputTokens));
}

/** Approximation is deliberately conservative; the provider remains authoritative for actual usage. */
export function estimatePromptTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text) / 3.5);
}

/** The auditable, non-executable part of a controller-supplied tool contract. */
export function serializedResultToolSignature(tool: ToolDefinition): string {
	return JSON.stringify({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		promptSnippet: tool.promptSnippet,
		promptGuidelines: tool.promptGuidelines,
		executionMode: tool.executionMode,
		parameters: tool.parameters,
	});
}

export function deriveRoleEnvelope(input: {
	stage: ReviewRoleEnvelope["stage"];
	groupId?: string;
	mode: string;
	model: Model<any>;
	profile: ReviewProfile;
	budgets: ReviewBudgets;
	prompt: string;
	systemPrompt: string;
	resultTool: ToolDefinition;
	builtinToolNames?: readonly string[];
	elapsedSeconds: number;
	/** Settled plus live usage; controls the role's actual run-wide ceiling. */
	totalTokens: number;
	/** Prior launch reservations; used only to decide whether another role fits. */
	reservedTokens?: number;
}): ReviewRoleEnvelope {
	const contextWindow = modelNumber(input.model.contextWindow, 200_000);
	const modelMaxOutputTokens = modelNumber(input.model.maxTokens, 16_384);
	const toolSignature = serializedResultToolSignature(input.resultTool);
	// Pi serializes the selected core-tool schemas provider-side. The public core
	// API has no schema accessor at controller time, so reserve a conservative
	// 4 KiB envelope for each fixed read-only schema rather than undercount it.
	const builtinToolBytes = (input.builtinToolNames?.length ?? 0) * 4_096;
	const rendered = `${input.systemPrompt}\n\n${input.prompt}\n\n${toolSignature}${" ".repeat(builtinToolBytes)}`;
	const promptBytes = Buffer.byteLength(rendered);
	const resultToolBytes = Buffer.byteLength(toolSignature);
	const estimatedInputTokens = estimatePromptTokens(rendered);
	const reservedOutputTokens = outputReserve(input.stage, input.profile, modelMaxOutputTokens);
	const contextSafe = contextWindow - estimatedInputTokens - reservedOutputTokens;
	if (promptBytes > input.budgets.maxPromptBytes) {
		throw new Error(
			`${input.stage} rendered prompt is ${promptBytes} bytes; policy maximum is ${input.budgets.maxPromptBytes}`,
		);
	}
	if (contextSafe < 1) {
		throw new Error(
			`${input.stage} rendered prompt needs ${estimatedInputTokens} input tokens plus ${reservedOutputTokens} reserved output tokens, exceeding model context window ${contextWindow}`,
		);
	}
	const remainingTokens = input.budgets.maxTokens - input.totalTokens;
	// Context capacity is per request. A fresh role normally needs at least an
	// evidence/tool round and a terminating submission, each of which can carry
	// the prompt again. Do not reuse a one-request context calculation as a
	// lifetime usage ceiling.
	const expectedRequests = input.stage === "reviewer" ? 3 : 2;
	const reservationTokens = expectedRequests * (estimatedInputTokens + reservedOutputTokens);
	if (remainingTokens - (input.reservedTokens ?? 0) < reservationTokens) {
		throw new Error(`${input.stage} has insufficient aggregate policy capacity after rendered prompt measurement`);
	}
	const remainingSeconds = input.budgets.timeoutSeconds - input.elapsedSeconds;
	if (remainingSeconds < 1) throw new Error(`${input.stage} cannot start because the elapsed-time policy is exhausted`);
	const maxTurns =
		input.stage === "planner"
			? input.budgets.plannerMaxTurns
			: input.stage === "reviewer"
				? input.budgets.reviewerMaxTurns
				: input.budgets.verifierMaxTurns;
	return {
		stage: input.stage,
		...(input.groupId && { groupId: input.groupId }),
		mode: input.mode,
		model: `${input.model.provider}/${input.model.id}`,
		contextWindow,
		modelMaxOutputTokens,
		promptBytes,
		resultToolBytes,
		builtinToolBytes,
		estimatedInputTokens,
		reservedOutputTokens,
		expectedRequests,
		reservationTokens,
		// A reservation admits concurrent work; it is not a guessed per-role
		// lifetime cap. Live usage remains subject to the run-wide ceiling.
		maxTokens: remainingTokens,
		maxTurns,
		timeoutSeconds: Math.max(1, Math.floor(remainingSeconds)),
	};
}

export function reviewShapeFrom(
	source: ReviewSource,
	items: Array<{ diff: string; binary: boolean }>,
	binaryWaivers: number,
): SealedReviewShape {
	void source;
	return {
		selectedItems: items.length,
		diffBytes: items.reduce((total, item) => total + Buffer.byteLength(item.diff), 0),
		binaryWaivers,
	};
}
