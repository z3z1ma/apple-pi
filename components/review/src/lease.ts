import {
	acquireExclusiveLease,
	activeExclusiveLease,
	type ExclusiveLeaseOwner,
} from "../../shared/src/exclusive-lease.js";

export type ReviewLeaseOwner = ExclusiveLeaseOwner;

export function activeReviewLease(projectRoot: string): ReviewLeaseOwner | undefined {
	return activeExclusiveLease("reviews", projectRoot);
}

export function acquireReviewLease(projectRootInput: string, runId: string): () => void {
	return acquireExclusiveLease("reviews", projectRootInput, runId, {
		unreadable: (path) => `Review resource lease is unreadable: ${path}`,
		owned: (owner) => `Review run ${owner.runId} in process ${owner.pid} already owns this project`,
		failed: "Could not acquire the review project lease",
	});
}
