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
}

export interface ReviewPreview {
	projectRoot: string;
	source: ReviewSource;
	resolvedBase?: string;
	resolvedHead?: string;
	inputHash: string;
	reviewable: ReviewItem[];
	waived: { item: ReviewItem; reason: string }[];
}

export interface ReviewGroup {
	id: string;
	title: string;
	objective: string;
	itemIds: string[];
	contextPaths: string[];
	tier: ReviewModelTier;
	rationale: string;
}

export interface ReviewWorkGraph {
	summary: string;
	groups: ReviewGroup[];
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

export interface ProposedReviewFinding {
	severity: ReviewSeverity;
	category: ReviewCategory;
	summary: string;
	impact: string;
	evidence: string;
	path: string;
	anchor: string;
	side: ReviewAnchorSide;
	suggestion?: string;
}

export interface ReviewFinding extends ProposedReviewFinding {
	id: string;
	groupId: string;
	startLine?: number;
	endLine?: number;
	anchorProvenance: ReviewAnchorProvenance;
	anchorMatchCount: number;
	validation: {
		status: ReviewValidationStatus;
		reason: string;
		evidence: string;
	};
}

export interface PlannerOutput {
	summary: string;
	groups: Array<{
		id: string;
		title: string;
		objective: string;
		itemIds: string[];
		contextPaths: string[];
		tier: ReviewModelTier;
		rationale: string;
	}>;
}

export interface ReviewerOutput {
	summary: string;
	reviewedItemIds: string[];
	findings: ProposedReviewFinding[];
	residualRisk: string[];
}

export interface VerifierOutput {
	decisions: Array<{
		findingId: string;
		status: ReviewValidationStatus;
		reason: string;
		evidence: string;
	}>;
	residualRisk: string[];
}

export type ReviewTerminalState = "complete" | "partial" | "failed" | "skipped" | "stopped" | "workspace_conflict" | "error";
export type ReviewRunState = "planning" | "reviewing" | "verifying" | ReviewTerminalState;

export interface ReviewBudgets {
	maxTokens: number;
	timeoutSeconds: number;
	maxConcurrency: number;
	plannerMaxTurns: number;
	reviewerMaxTurns: number;
	verifierMaxTurns: number;
	maxGroups: number;
	maxPromptBytes: number;
}

export interface ReviewModelRouting {
	plannerMode: string;
	fastMode: string;
	strongMode: string;
}

export interface ReviewAgentReceipt {
	stage: "planner" | "reviewer" | "verifier";
	groupId?: string;
	tier: ReviewModelTier;
	mode: string;
	skillHash: string;
	provider?: string;
	model?: string;
	agentId: string;
	sessionFile?: string;
	status: AgentRecord["status"];
	usage: { input: number; output: number; cacheWrite: number };
	compactions: number;
}

export interface ReviewCoverageFailure {
	itemId: string;
	path: string;
	classification: "planner" | "provider" | "timeout" | "budget" | "invalid_output" | "compacted" | "cancelled" | "unknown";
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
	residualRisk: string[];
	totalTokens: number;
	budgets: ReviewBudgets;
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
	groupId?: string;
	outcome: string;
	details?: unknown;
	run: ReviewRun;
}

export interface StartReviewOptions {
	/** Agent-selected Git working tree. Relative paths resolve from the caller cwd. */
	root?: string;
	profile?: ReviewProfile;
	background?: string;
	authorityPacket?: string;
	budgets?: Partial<ReviewBudgets>;
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
