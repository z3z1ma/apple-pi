import type { ReviewOperation, ReviewState } from "../../../components/code-review/src/operations.js";
import type {
	ReviewAnalytics,
	ReviewAttempt,
	ReviewQueue,
	ReviewSource,
	ReviewSummary,
} from "../../../components/code-review/src/results.js";
import type { ReviewRequest } from "../../../components/code-review/src/types.js";

export type ReviewManagement = Extract<
	ReviewOperation,
	{ action: "cancel" | "resume" | "priority" | "reassign" | "extend" | "finding" | "comment" }
>;
export type ReviewAttemptRow = Pick<
	ReviewAttempt,
	| "id"
	| "pass"
	| "kind"
	| "reviewer"
	| "role"
	| "state"
	| "model"
	| "thinking"
	| "reason"
	| "reuseBlockedBy"
	| "createdAt"
	| "finishedAt"
> & {
	usage: unknown;
	hasOutput: boolean;
	selected: boolean;
};

export interface ReviewsApi {
	states(
		request: Record<string, never>,
	): Promise<{ id: string; state: ReviewState; requester: string; owner: string }[]>;
	queue(options: {
		cwd?: string;
		people?: string[];
		state?: ReviewState;
		limit: number;
		offset?: number;
		hideAddressed?: boolean;
		around?: string;
	}): Promise<ReviewQueue>;
	analytics(request: { cwd?: string; people?: string[] }): Promise<ReviewAnalytics>;
	read(request: {
		review: string;
		part:
			| "summary"
			| "target"
			| "configuration"
			| "plan"
			| "findings"
			| "coverage"
			| "attempts"
			| "decisions"
			| "thread"
			| "log";
		limit: number;
		offset?: number;
	}): Promise<unknown>;
	source(request: {
		review: string;
		path?: string;
		side: "before" | "after";
		limit: number;
		offset?: number;
	}): Promise<ReviewSource>;
	freshness(request: { review: string }): Promise<{
		requestedTarget: string;
		checkout: string;
		policy: string;
		checkedAt: number;
		errors: string[];
		note: string;
	}>;
	preview(request: ReviewRequest): Promise<{ digest: string; changedPaths: number; lines: string[] }>;
	enqueue(request: {
		attempt: string;
		request: ReviewRequest;
		expectedDigest: string;
		owner: string;
		parent?: string;
	}): Promise<ReviewSummary>;
	manage(request: { attempt: string; operation: ReviewManagement }): Promise<ReviewSummary>;
	signOff(request: { review: string }): Promise<{ url: string }>;
}
