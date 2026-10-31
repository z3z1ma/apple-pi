import type { ReviewOperation, ReviewState } from "../../../components/code-review/src/operations.js";
import type { ReviewQueue, ReviewSource, ReviewSummary } from "../../../components/code-review/src/results.js";
import type { ReviewRequest } from "../../../components/code-review/src/types.js";

export type ReviewManagement = Extract<
	ReviewOperation,
	{ action: "cancel" | "resume" | "priority" | "reassign" | "extend" | "finding" }
>;
export interface ReviewsApi {
	queue(options: { cwd?: string; state?: ReviewState; limit: number; offset?: number }): Promise<ReviewQueue>;
	read(request: {
		review: string;
		part: "summary" | "target" | "configuration" | "plan" | "findings" | "coverage" | "attempts" | "decisions";
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
