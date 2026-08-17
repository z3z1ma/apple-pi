import type { AgentRecord } from "../../subagents/src/types.js";

export type ReviewSource =
	| { mode: "workspace" }
	| { mode: "range"; from: string; to: string }
	| { mode: "commit"; commit: string };

export type ReviewProfile = "fast" | "balanced" | "thorough";
export type ReviewModelTier = "fast" | "strong";
export type ReviewItemStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";

export interface ReviewItem {
	id: string;
	path: string;
	oldPath?: string;
	status: ReviewItemStatus;
	diff: string;
	insertions: number;
	deletions: number;
	fingerprint: string;
	binary: boolean;
}

export type ReviewCoverageItem = Omit<ReviewItem, "diff">;

export interface ReviewInput {
	projectRoot: string;
	source: ReviewSource;
	resolvedBase?: string;
	resolvedHead?: string;
	items: ReviewItem[];
	inputHash: string;
	/** Normalized repository-relative files, folders, or globs that limited the seal. */
	paths?: string[];
}

export interface ReviewPreview {
	projectRoot: string;
	source: ReviewSource;
	resolvedBase?: string;
	resolvedHead?: string;
	inputHash: string;
	reviewable: ReviewItem[];
	waived: { item: ReviewItem; reason: string }[];
	paths?: string[];
}

export interface ReviewPartition {
	id: string;
	cycle: number;
	title: string;
	itemIds: string[];
}

export interface ReviewFocus {
	id: string;
	partitionId: string;
	cycle: number;
	title: string;
	question: string;
	checks: string[];
	itemIds: string[];
}

export interface ReviewMetaReview {
	cycle: number;
	sentiment: string;
	compoundRisks: string[];
	residuals: string[];
	coverageGaps: string[];
}

export interface ReviewCycleRecord {
	index: number;
	partitions: ReviewPartition[];
	focuses: ReviewFocus[];
	metaReview?: ReviewMetaReview;
}

export interface ReviewWorkGraph {
	cycles: ReviewCycleRecord[];
	graphHash: string;
}

export type ReviewSeverity = "critical" | "significant" | "minor" | "nit";
export type ReviewCategory =
	| "bug"
	| "security"
	| "performance"
	| "maintainability"
	| "test"
	| "documentation"
	| "other";
export type ReviewAnchorSide = "new" | "old";
export type ReviewAnchorProvenance = "exact_hunk" | "exact_file" | "ambiguous" | "unresolved";
export type ReviewValidationStatus = "confirmed" | "rejected" | "retained_unresolved";

export interface OpenReviewCall {
	title?: string;
	files: string[];
	focuses: Array<{
		title: string;
		question: string;
		checks: string[];
	}>;
}

export interface ReviewReport {
	kind: "finding" | "note";
	severity?: ReviewSeverity;
	path?: string;
	startLine?: number;
	endLine?: number;
	side?: ReviewAnchorSide;
	what: string;
	why?: string;
	evidence?: string;
	suggestion?: string;
}

export interface ReviewFinding {
	id: string;
	cycle: number;
	partitionId: string;
	focusId: string;
	severity: ReviewSeverity;
	category: ReviewCategory;
	summary: string;
	impact: string;
	evidence: string;
	path: string;
	anchor: string;
	side: ReviewAnchorSide;
	suggestion?: string;
	startLine?: number;
	endLine?: number;
	anchorProvenance: ReviewAnchorProvenance;
	anchorMatchCount: number;
	validation: {
		status: ReviewValidationStatus;
		reason: string;
		evidence: string;
		invitedByAmbiguity?: boolean;
	};
}

export interface ReviewNote {
	id: string;
	cycle: number;
	partitionId: string;
	focusId: string;
	summary: string;
	evidence: string;
}

export interface VerifierOutput {
	decisions: Array<{
		findingId: string;
		status: ReviewValidationStatus;
		reason: string;
		evidence: string;
		invitedByAmbiguity?: boolean;
	}>;
	sentiment: string;
	compoundRisks: string[];
	residuals: string[];
	coverageGaps: string[];
}

export type ReviewTerminalState =
	| "complete"
	| "partial"
	| "failed"
	| "skipped"
	| "stopped"
	| "workspace_conflict"
	| "error";
export type ReviewRunState = "planning" | "reviewing" | "verifying" | ReviewTerminalState;

/**
 * Recorded review-shape bounds. Focus, cycle, and concurrency still schedule work.
 * Timeout is receipt metadata and is not a runtime abort.
 */
export interface ReviewBudgets {
	timeoutSeconds: number;
	maxConcurrency: number;
	maxFocuses: number;
	maxCycles: number;
}

export type ReviewTerminalCause =
	| "operator_stop"
	| "external_cancellation"
	| "elapsed_time_ceiling"
	| "aggregate_token_ceiling"
	| "role_turn_ceiling"
	| "compaction"
	| "provider_error"
	| "invalid_output"
	| "authority_denial"
	| "workspace_conflict"
	| "policy_input"
	| "internal_error";

export interface ReviewRoleEnvelope {
	stage: "planner" | "reviewer" | "verifier";
	partitionId?: string;
	focusId?: string;
	cycle?: number;
	mode: string;
	model: string;
	contextWindow: number;
	modelMaxOutputTokens: number;
	promptBytes: number;
	resultToolBytes: number;
	customToolBytes: number;
	builtinToolBytes: number;
	estimatedInputTokens: number;
	reservedOutputTokens: number;
	timeoutSeconds: number;
}

/** Additive, receipt-persisted policy selected by a semantic profile and sealed input. */
export interface ReviewResolvedPolicy {
	version: 1;
	profile: ReviewProfile;
	selectedItems: number;
	diffBytes: number;
	binaryWaivers: number;
	budgets: ReviewBudgets;
	envelopes: ReviewRoleEnvelope[];
}

export interface ReviewModelRouting {
	plannerMode: string;
	fastMode: string;
	strongMode: string;
}

export interface ReviewAgentReceipt {
	stage: "planner" | "reviewer" | "verifier";
	partitionId?: string;
	focusId?: string;
	cycle?: number;
	tier: ReviewModelTier;
	mode: string;
	skillHash: string;
	provider?: string;
	model?: string;
	agentId: string;
	sessionFile?: string;
	status: AgentRecord["status"];
	terminationCause?: AgentRecord["terminationCause"];
	usage: { input: number; output: number; cacheWrite: number };
	compactions: number;
}

export interface ReviewCoverageFailure {
	itemId: string;
	path: string;
	classification:
		| "planner"
		| "provider"
		| "timeout"
		| "budget"
		| "invalid_output"
		| "compacted"
		| "cancelled"
		| "authority"
		| "policy_input"
		| "workspace"
		| "unknown";
	reason: string;
}

export interface ReviewRun {
	schemaVersion: 1;
	runId: string;
	projectRoot: string;
	source: ReviewSource;
	profile: ReviewProfile;
	state: ReviewRunState;
	startedAt: string;
	updatedAt: string;
	inputHash: string;
	resolvedBase?: string;
	resolvedHead?: string;
	selected: ReviewCoverageItem[];
	waived: { itemId: string; path: string; reason: string }[];
	completedItemIds: string[];
	failures: ReviewCoverageFailure[];
	workGraph?: ReviewWorkGraph;
	findings: ReviewFinding[];
	rawFindings?: ReviewFinding[];
	notes?: ReviewNote[];
	metaReviews?: ReviewMetaReview[];
	residualRisk: string[];
	totalTokens: number;
	budgets: ReviewBudgets;
	policy?: ReviewResolvedPolicy;
	terminalCause?: ReviewTerminalCause;
	routing: ReviewModelRouting;
	agents: ReviewAgentReceipt[];
	lastOutcome?: string;
}

export interface ReviewReceiptEvent {
	schemaVersion: 1;
	sequence: number;
	timestamp: string;
	runId: string;
	state: ReviewRunState;
	stage?: "input" | "planner" | "reviewer" | "verifier" | "finalize";
	partitionId?: string;
	focusId?: string;
	cycle?: number;
	outcome: string;
	details?: unknown;
	run: ReviewRun;
}

export interface StartReviewOptions {
	/** Agent-selected Git working tree. Relative paths resolve from the caller cwd. */
	root?: string;
	/** Repository-relative files, folders, or globs that limit the sealed change. Omitted or empty reviews the whole change. */
	paths?: string[];
	profile?: ReviewProfile;
	background?: string;
	authorityPacket?: string;
	/** Receipt-only recorded timeout; not applied as a runtime abort. */
	constraints?: Partial<Pick<ReviewBudgets, "timeoutSeconds">>;

	routing?: Partial<ReviewModelRouting>;
}

export interface ReviewRunSummary {
	runId: string;
	state: ReviewRunState;
	profile: ReviewProfile;
	source: ReviewSource;
	selected: number;
	completed: number;
	failed: number;
	findings: number;
	totalTokens: number;
	updatedAt: string;
	receiptPath: string;
}
