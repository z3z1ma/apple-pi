import type { FindingValidation, PlannedPass, ReviewPlan, ReviewReport } from "./contracts.js";
import type { FindingDecision, ReviewApproval, ReviewDecision } from "./decisions.js";
import type { ReviewJob, ReviewState } from "./operations.js";
import type { ReviewTarget, SourceEntry } from "./types.js";

export type ReviewSource = {
	review: string;
	revision: number;
	artifact: string;
	side: "before" | "after";
	tree: string;
	note: string;
} & (
	| {
			kind: "files";
			total: number;
			page: { offset: number; nextOffset: number | null; rows: Pick<SourceEntry, "path" | "mode" | "blob">[] } | null;
	  }
	| {
			kind: "file";
			file: SourceEntry;
			bytes: number | null;
			representation: string;
			total: number | null;
			page: { offset: number; nextOffset: number | null; rows: string[] } | null;
	  }
);

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
		/** Regions a legacy plan declared as gaps; current plans never leave regions unassigned. */
		unassignedRegions: number;
		/** Regions outside every focused scope, reviewed only by the whole-change integration pass. */
		integrationOnlyRegions: number;
		additionalRequests: number;
	} | null;
	/** What was reviewed, as a person names it; label fields are null on captures made before labels. */
	label: {
		repository: string;
		branch: string | null;
		head: string | null;
		subject: string | null;
		commits: number | null;
		files: number | null;
	};
	findings: {
		reported: number;
		confirmed: number;
		unresolved: number;
		/** Confirmed findings with an owner response. */
		responded: number;
	};
	/** Settled with nothing left to act on: completed, no-changes or cancelled, every confirmed finding answered. */
	addressed: boolean;
	cost: {
		reportedDollars: number | null;
		reportedAttempts: number;
		totalAttempts: number;
		tokens: { input: number; output: number; cacheRead: number };
	};
	/** When the last attempt of a settled review finished; null while work remains. */
	settledAt: number | null;
	approval: { record: ReviewApproval; matchesAssessment: boolean } | null;
	reason: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ReviewQueue {
	total: number;
	states: Partial<Record<ReviewState, number>>;
	/** Reviewer passes running now across the queue, against the concurrency bound. */
	passes: { running: number; limit: number };
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

export interface ReviewThreadMessage {
	seq: number;
	sender: string;
	senderName: string;
	body: string;
	at: number;
}

export interface ReviewLogEntry {
	at: number | null;
	kind: "text" | "tool" | "result" | "error";
	text: string;
}

export interface ReviewAttemptLog {
	attempt: string;
	pass: string;
	kind: ReviewAttempt["kind"];
	state: ReviewAttempt["state"];
	model: string | null;
	entries: ReviewLogEntry[];
}

export interface ReviewAnalytics {
	reviews: number;
	settled: number;
	dollars: number;
	confirmed: number;
	/** Review wall time from admission to the last attempt, over settled reviews. */
	medianMinutes: number | null;
	byModel: {
		model: string;
		attempts: number;
		dollars: number;
		minutes: number;
		confirmed: number;
		severities: Record<string, number>;
	}[];
	byPhase: { kind: ReviewAttempt["kind"]; attempts: number; dollars: number; minutes: number }[];
	recent: {
		id: string;
		label: ReviewSummary["label"];
		state: ReviewState;
		createdAt: number;
		minutes: number | null;
		dollars: number | null;
		confirmed: number;
	}[];
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
