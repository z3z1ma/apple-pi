import type { FindingValidation, PlannedPass, ReviewPlan, ReviewReport } from "./contracts.js";
import type { FindingDecision, ReviewApproval, ReviewDecision } from "./decisions.js";
import type { ReviewJob, ReviewState } from "./operations.js";
import type { ReviewTarget } from "./types.js";

export interface ReviewSummary {
	id: string;
	owner: string;
	ownerName: string;
	summary: string | null;
	state: ReviewState;
	phase: Pick<ReviewAttempt, "kind" | "state" | "pass"> | null;
	priority: number;
	revision: number;
	cwd: string;
	target: ReviewTarget;
	digest: string | null;
	intent: "captured" | "not-assessed";
	chunks: number | null;
	passes: { completed: number; required: number } | null;
	coverage: {
		completedQuestions: number;
		requiredQuestions: number;
		unassignedRegions: number;
		additionalRequests: number;
	} | null;
	findings: { reported: number; confirmed: number; unresolved: number };
	approval: { record: ReviewApproval; matchesAssessment: boolean } | null;
	reason: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ReviewQueue {
	total: number;
	states: Partial<Record<ReviewState, number>>;
	page: { offset: number; nextOffset: number | null; rows: ReviewSummary[] } | null;
}

export interface ReviewAttempt {
	id: string;
	review: string;
	generation: number;
	planRevision: number;
	pass: string;
	kind: "planner" | "focused" | "integration" | "validation";
	person: string;
	role: string;
	state: "starting" | "running" | "cleaning" | "completed" | "failed" | "cancelled" | "interrupted";
	model: string | null;
	thinking: string | null;
	sessionFile: string | null;
	input: { task: string; contextFile: string; outputSchema: unknown };
	policy: unknown;
	reuseBlockedBy: string | null;
	result: unknown;
	output: ReviewPlan | ReviewReport | FindingValidation | null;
	reason: string | null;
	createdAt: number;
	finishedAt: number | null;
}

export interface ReviewAssessment {
	job: ReviewJob;
	passes: { pass: PlannedPass; attempt: ReviewAttempt | null; report: ReviewReport | null }[];
	validation: { attempt: ReviewAttempt; report: FindingValidation } | null;
	decisions: ReviewDecision[];
	findings: {
		id: string;
		attempt: string;
		pass: string;
		finding: ReviewReport["findings"][number];
		validation: FindingValidation["findings"][number] | null;
		decision: FindingDecision | null;
	}[];
}
