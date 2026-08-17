import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ReviewController } from "./controller.js";
import { reviewRepositoryRoot } from "./git.js";
import { activeReviewLease } from "./lease.js";
import { listReviewReceiptRows, type ReviewReceiptRow } from "./receipts.js";
import type { ReviewProgressSnapshot } from "./types.js";

const CHANNEL = "apple-pi:review-operations-service:request";
let installedService: ReviewOperationsService | undefined;

export type ReviewRunOwnership =
	| { kind: "owned" }
	| { kind: "foreign"; pid: number; ownerRunId: string }
	| { kind: "stale" };

export interface ReviewOperationsService {
	subscribeProgress(listener: (snapshot: ReviewProgressSnapshot) => void): () => void;
	liveSnapshots(): ReviewProgressSnapshot[];
	listReceipts(projectRoot: string): ReviewReceiptRow[];
	classifyOwnership(projectRoot: string, runId: string): ReviewRunOwnership;
	stop(projectRoot: string, runId: string): Promise<unknown>;
	stopAll(): Promise<void>;
}

export function installReviewOperationsService(service: ReviewOperationsService, events?: EventBus): () => void {
	installedService = service;
	const unsubscribe = events?.on(CHANNEL, (reply) => {
		if (typeof reply === "function") (reply as (value: ReviewOperationsService) => void)(service);
	});
	return () => {
		unsubscribe?.();
		if (installedService === service) installedService = undefined;
	};
}

export function getReviewOperationsService(events?: EventBus): ReviewOperationsService | undefined {
	let discovered: ReviewOperationsService | undefined;
	events?.emit(CHANNEL, (service: ReviewOperationsService) => {
		discovered ??= service;
	});
	return discovered ?? installedService;
}

export function reviewOperationsService(controller: ReviewController): ReviewOperationsService {
	return {
		subscribeProgress: (listener) => controller.subscribeProgress(listener),
		liveSnapshots: () => controller.liveProgress(),
		listReceipts: (projectRoot) => listReviewReceiptRows(reviewRepositoryRoot(projectRoot)),
		classifyOwnership: (projectRoot, runId) => controller.classifyOwnership(projectRoot, runId),
		stop: (projectRoot, runId) => controller.stop(projectRoot, runId),
		stopAll: () => controller.stopAll(),
	};
}

export function classifyReviewLease(projectRoot: string, runId: string, owned: boolean): ReviewRunOwnership {
	if (owned) return { kind: "owned" };
	const owner = activeReviewLease(projectRoot);
	if (owner && owner.runId === runId && owner.pid !== process.pid) {
		return { kind: "foreign", pid: owner.pid, ownerRunId: owner.runId };
	}
	return { kind: "stale" };
}
