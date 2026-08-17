import type { Model } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ReviewBudgets, ReviewProfile, ReviewRoleEnvelope, ReviewSource } from "./types.js";

/** Package-owned ceilings. Ordinary callers never configure these values. */
export const REVIEW_PACKAGE_MAXIMA: Readonly<ReviewBudgets> = {
	timeoutSeconds: 7_200,
	maxConcurrency: 8,
	maxFocuses: 34,
	maxCycles: 3,
};

const PROFILE_BUDGETS: Record<ReviewProfile, ReviewBudgets> = {
	fast: {
		timeoutSeconds: 1_800,
		maxConcurrency: 6,
		maxFocuses: 14,
		maxCycles: 1,
	},
	balanced: {
		timeoutSeconds: 3_600,
		maxConcurrency: 6,
		maxFocuses: 26,
		maxCycles: 1,
	},
	thorough: {
		timeoutSeconds: 7_200,
		maxConcurrency: 6,
		maxFocuses: 34,
		maxCycles: 3,
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
 * Profile selects cycle count; shape only bounds focuses and concurrency.
 */
export function deriveReviewBudgets(
	profile: ReviewProfile,
	shape: SealedReviewShape,
	constraints: Partial<Pick<ReviewBudgets, "timeoutSeconds">> = {},
): ReviewBudgets {
	const base = PROFILE_BUDGETS[profile];
	const density = Math.max(1, Math.ceil(shape.diffBytes / (48 * 1024)));
	const maxFocuses = clamp(Math.max(3, Math.min(shape.selectedItems + 2, density * 4 + 2)), 1, base.maxFocuses);
	const maxConcurrency = clamp(Math.min(base.maxConcurrency, maxFocuses), 1, REVIEW_PACKAGE_MAXIMA.maxConcurrency);
	return {
		...base,
		timeoutSeconds: whole(constraints.timeoutSeconds, base.timeoutSeconds, REVIEW_PACKAGE_MAXIMA.timeoutSeconds),
		maxFocuses,
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
	const base = stage === "reviewer" ? (profile === "thorough" ? 6_000 : 4_000) : 3_000;
	return Math.max(1_024, Math.min(base, modelMaxOutputTokens));
}

/** Approximation is deliberately conservative; the provider remains authoritative for actual usage. */
export function estimatePromptTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text) / 3.5);
}

/** The auditable, non-executable part of a controller-supplied tool contract. */
export function serializedToolSignature(tool: ToolDefinition): string {
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
	partitionId?: string;
	focusId?: string;
	cycle?: number;
	mode: string;
	model: Model<any>;
	profile: ReviewProfile;
	budgets: ReviewBudgets;
	prompt: string;
	systemPrompt: string;
	resultTool: ToolDefinition;
	customTools: readonly ToolDefinition[];
	builtinToolNames?: readonly string[];
}): ReviewRoleEnvelope {
	const contextWindow = modelNumber(input.model.contextWindow, 200_000);
	const modelMaxOutputTokens = modelNumber(input.model.maxTokens, 16_384);
	const resultToolSignature = serializedToolSignature(input.resultTool);
	const customToolSignature = (input.customTools ?? [input.resultTool]).map(serializedToolSignature).join("\n");
	const builtinToolBytes = (input.builtinToolNames?.length ?? 0) * 4_096;
	const rendered = `${input.systemPrompt}\n\n${input.prompt}\n\n${customToolSignature}${" ".repeat(builtinToolBytes)}`;
	const promptBytes = Buffer.byteLength(rendered);
	const resultToolBytes = Buffer.byteLength(resultToolSignature);
	const customToolBytes = Buffer.byteLength(customToolSignature);
	const estimatedInputTokens = estimatePromptTokens(rendered);
	const reservedOutputTokens = outputReserve(input.stage, input.profile, modelMaxOutputTokens);
	const contextSafe = contextWindow - estimatedInputTokens - reservedOutputTokens;
	if (contextSafe < 1) {
		throw new Error(
			`${input.stage} rendered prompt needs ${estimatedInputTokens} input tokens plus ${reservedOutputTokens} reserved output tokens, exceeding model context window ${contextWindow}`,
		);
	}
	return {
		stage: input.stage,
		...(input.partitionId && { partitionId: input.partitionId }),
		...(input.focusId && { focusId: input.focusId }),
		...(input.cycle !== undefined && { cycle: input.cycle }),
		mode: input.mode,
		model: `${input.model.provider}/${input.model.id}`,
		contextWindow,
		modelMaxOutputTokens,
		promptBytes,
		resultToolBytes,
		customToolBytes,
		builtinToolBytes,
		estimatedInputTokens,
		reservedOutputTokens,
		timeoutSeconds: input.budgets.timeoutSeconds,
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
