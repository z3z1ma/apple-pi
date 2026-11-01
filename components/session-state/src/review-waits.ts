/**
 * Reviews this Pi process is waiting on, or has waited out. Their milestone mail still reaches the transcript (the
 * delivery record) but as a short pointer, because the wait result already carries the review's outcome.
 */
const waiting = new Map<string, number>();
const returned = new Map<string, number>();

export function startReviewWait(review: string): () => void {
	waiting.set(review, (waiting.get(review) ?? 0) + 1);
	return () => {
		const left = (waiting.get(review) ?? 1) - 1;
		if (left) waiting.set(review, left);
		else waiting.delete(review);
	};
}

export function reviewWaitReturned(review: string, generation: number): void {
	returned.set(review, Math.max(returned.get(review) ?? 0, generation));
}

const MILESTONES = new Set(["plan", "findings", "outcome"]);

/** Milestone message IDs are `review:<review>:<generation>:<milestone>`; comments from people are never covered. */
export function coveredByReviewWait(messageId: string | undefined): boolean {
	const [prefix, review, generation, milestone] = messageId?.split(":") ?? [];
	if (prefix !== "review" || !review || !MILESTONES.has(milestone ?? "")) return false;
	return waiting.has(review) || (returned.get(review) ?? -1) >= Number(generation);
}
