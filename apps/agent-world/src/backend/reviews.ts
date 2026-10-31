import { DatabaseSync } from "node:sqlite";
import { openCapturedSignOff } from "../../../../components/browser-pages/src/captured-review.js";
import { checkShape } from "../../../../components/code-review/src/contracts.js";
import {
	type ReviewOperation,
	ReviewOperationSchema,
	ReviewRequestSchema,
} from "../../../../components/code-review/src/operations.js";
import { previewLines } from "../../../../components/code-review/src/presentation.js";
import { previewReview } from "../../../../components/code-review/src/preview.js";
import {
	readReviewFreshness,
	readReviewPart,
	readReviewSource,
	reviewQueue,
	reviewSummary,
} from "../../../../components/session-state/src/review-read.js";
import type { ReviewsApi } from "../reviews.js";
import { OPERATOR } from "../world.js";
import type { Commands } from "./commands.js";

/** On-demand operator views; every mutation still belongs to the runtime. */
export function openReviews(path: string, commands: Commands) {
	function store<T>(read: (db: DatabaseSync) => T): T {
		const db = new DatabaseSync(path, { readOnly: true });
		try {
			if (!db.prepare("select 1 from pragma_table_info('review_jobs') where name = 'additional_work'").get())
				throw new Error("The review store is unavailable. Update the session-state runtime before using reviews.");
			return read(db);
		} finally {
			db.close();
		}
	}
	async function mutate(attempt: string, operation: ReviewOperation) {
		if (typeof attempt !== "string" || !attempt.trim()) throw new Error("A stable review attempt ID is required");
		store(() => true);
		const commandId = `review-ui:operator:${attempt}`;
		const receipt = await commands.send(OPERATOR, { kind: "review", version: 1, operation }, { commandId });
		if (!receipt.ok) throw new Error(receipt.reason);
		return store((db) => reviewSummary(db, OPERATOR, commandId));
	}
	const pages = new Set<() => void>();
	const api: ReviewsApi = {
		async queue(options) {
			return store((db) => reviewQueue(db, OPERATOR, options));
		},
		async read(request) {
			return store((db) => readReviewPart(db, OPERATOR, request.review, request));
		},
		source(request) {
			return readReviewSource(OPERATOR, request.review, request, undefined, store);
		},
		freshness(request) {
			return readReviewFreshness(OPERATOR, request.review, undefined, store);
		},
		async preview(request) {
			store(() => true);
			const preview = await previewReview(checkShape(ReviewRequestSchema, request));
			return { digest: preview.digest, changedPaths: preview.changes.length, lines: previewLines(preview) };
		},
		async enqueue(input) {
			const operation = checkShape(ReviewOperationSchema, {
				action: "enqueue",
				request: input.request,
				expectedDigest: input.expectedDigest,
				owner: input.owner,
				...(input.parent ? { parent: input.parent } : {}),
			});
			return mutate(input.attempt, operation);
		},
		async manage(input) {
			const operation = checkShape(ReviewOperationSchema, input.operation);
			if (!["cancel", "resume", "priority", "reassign", "extend", "finding"].includes(operation.action))
				throw new Error("Use the capture preview to enqueue, or the browser to sign off");
			return mutate(input.attempt, operation);
		},
		async signOff(request) {
			const page = await openCapturedSignOff(OPERATOR, request.review, undefined, {
				store,
				commit: async (commandId, operation) => {
					const receipt = await commands.send(OPERATOR, { kind: "review", version: 1, operation }, { commandId });
					if (!receipt.ok) throw new Error(receipt.reason);
				},
			});
			pages.add(page.close);
			void page.result
				.finally(() => {
					page.close();
					pages.delete(page.close);
				})
				.catch(() => {});
			return { url: page.url };
		},
	};
	return {
		api,
		close() {
			for (const close of pages) close();
			pages.clear();
		},
	};
}
