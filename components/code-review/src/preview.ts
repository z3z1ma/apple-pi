import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureReview } from "./capture.js";
import { configurationSummary } from "./policy.js";
import type { ReviewRequest } from "./types.js";

/** Preview identity without retaining a second source store or starting model work. */
export async function previewReview(request: ReviewRequest, signal?: AbortSignal) {
	const directory = await mkdtemp(join(tmpdir(), "apple-pi-review-preview-"));
	try {
		const artifact = await captureReview(request, join(directory, "artifact"), signal);
		return {
			request: artifact.request,
			digest: artifact.digest,
			repository: artifact.repository,
			commonDirectory: artifact.commonDirectory,
			baseCommit: artifact.baseCommit,
			headCommit: artifact.headCommit,
			baseTree: artifact.baseTree,
			headTree: artifact.headTree,
			changes: artifact.changes,
			regions: artifact.regions.length,
			omissions: artifact.omissions,
			intent: artifact.intent ? { origin: artifact.intent.origin, hash: artifact.intent.hash } : null,
			configuration: configurationSummary(artifact.configuration),
			capturedAt: artifact.capturedAt,
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export type ReviewPreview = Awaited<ReturnType<typeof previewReview>>;
