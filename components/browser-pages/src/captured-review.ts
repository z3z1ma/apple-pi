import { createHash, randomBytes } from "node:crypto";
import { verifyArtifact } from "../../code-review/src/capture.js";
import type { ReviewOperation } from "../../code-review/src/operations.js";
import { sendCommand } from "../../session-state/src/client.js";
import { reviewLimits, reviewSettled } from "../../session-state/src/review-decisions.js";
import {
	type ReviewStore,
	readReviewFreshness,
	reviewAssessment,
	withReviews,
} from "../../session-state/src/review-read.js";
import { buildCodeReviewPage, codeReviewTemplate, parseReviewResult, type ReviewCodeParams } from "./code-review.js";
import { parseUnifiedDiff, type RawFile } from "./git-diff.js";
import type { CodeReviewPage, ReviewResult } from "./page-data.js";
import { openPageSession } from "./page-server.js";
import { embedPage, savePage } from "./saved-page.js";

export async function buildCapturedReview(
	params: ReviewCodeParams,
	actor: string,
	token: string,
	signal?: AbortSignal,
	store: ReviewStore = withReviews,
) {
	const assessment = store((db) => reviewAssessment(db, actor, params.review!));
	const { job } = assessment;
	if (!job.artifact || !reviewSettled(job.state)) throw new Error("Sign-off requires a settled captured review");
	const artifact = job.artifact;
	await verifyArtifact(artifact, signal);
	const files: RawFile[] = [];
	for (const path of new Set(artifact.regions.map((region) => region.path))) {
		const regions = artifact.regions.filter((region) => region.path === path);
		const parsed = parseUnifiedDiff(regions.map((region) => region.patch).join(""));
		for (const file of parsed) {
			file.path = path;
			file.oldPath = undefined;
			files.push(file);
		}
	}
	const { page } = await buildCodeReviewPage({ ...params, cwd: undefined }, artifact.source, token, {
		root: artifact.source,
		baseCommit: artifact.baseRevision,
		head: artifact.headRevision,
		files,
	});
	page.capture = {
		review: job.id,
		digest: artifact.digest,
		revision: job.revision,
		planRevision: job.planRevision,
		limits: reviewLimits(assessment),
		freshness: await readReviewFreshness(actor, job.id, signal, store),
	};
	page.base = artifact.baseCommit ?? artifact.baseTree;
	page.head = artifact.headCommit ?? artifact.headTree;
	return { page, root: artifact.repository };
}

export type ApprovalCommit = (id: string, operation: Extract<ReviewOperation, { action: "approve" }>) => Promise<void>;

export async function openCapturedSignOff(
	actor: string,
	review: string,
	signal?: AbortSignal,
	access: { store?: ReviewStore; commit?: ApprovalCommit } = {},
) {
	const store = access.store ?? withReviews;
	const assessment = store((db) => reviewAssessment(db, actor, review));
	const { job } = assessment;
	if (!job.artifact) throw new Error("The review has no captured target");
	const params: ReviewCodeParams = {
		review: job.id,
		title: "Sign off on captured code",
		intent:
			"Judge this exact captured assessment. Completed review, unresolved findings, missing coverage and operator approval remain separate.",
		focus: {
			text: assessment.findings.length
				? assessment.findings
						.map(
							({ finding, validation, decision }) =>
								`### ${finding.title}\n\n${finding.path}:${finding.line} (${finding.side}); validation: ${validation?.disposition ?? "unvalidated"}; response: ${decision?.data.disposition ?? "none"}.\n\nTrigger: ${finding.trigger}\n\nImpact: ${finding.impact}\n\nEvidence: ${finding.evidence.join("; ")}`,
						)
						.join("\n\n")
				: "No allegations reported; this is not a correctness certificate.",
		},
		chapters: [
			{
				title: "Captured change",
				kind: "core",
				attention: "high",
				brief: job.plan?.summary ?? "There is no completed review plan.",
				changes: job.artifact.changes.map((change) => ({
					file: change.path,
					summary: change.status === "D" ? "Remove this captured file." : "Inspect this captured change.",
				})),
			},
		],
	};
	const { page, root } = await buildCapturedReview(params, actor, randomBytes(24).toString("hex"), signal, store);
	const template = await codeReviewTemplate(page);
	const session = await openPageSession(
		embedPage(template, page),
		page.session.token,
		(body) => submitCapturedReview(body, page, access.commit),
		{ signal },
	);
	const result = session.result.then(async (result) => ({
		result,
		saved: await savePage(
			embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }),
			root,
			page.title,
		),
	}));
	result.catch(() => {});
	return { url: session.url, result, close: session.close };
}

export function capturedSubmission(body: unknown, page: CodeReviewPage): ReviewResult | undefined {
	const result = parseReviewResult(body, page);
	const binding = page.capture;
	if (!result || !binding || typeof body !== "object" || body === null || !("capture" in body)) return undefined;
	const capture = body.capture;
	if (typeof capture !== "object" || capture === null) return undefined;
	const expected = {
		review: binding.review,
		digest: binding.digest,
		revision: binding.revision,
		planRevision: binding.planRevision,
	};
	for (const [key, value] of Object.entries(expected))
		if (!(key in capture) || (capture as Record<string, unknown>)[key] !== value) return undefined;
	if (!("acceptLimits" in capture) || typeof capture.acceptLimits !== "boolean") return undefined;
	if (result.verdict.startsWith("approve") && binding.limits.length && !capture.acceptLimits) return undefined;
	return { ...result, capture: { ...expected, acceptLimits: capture.acceptLimits } };
}

/** Human submission is committed by the sole writer before the page receives success. */
export async function submitCapturedReview(
	body: unknown,
	page: CodeReviewPage,
	commit: ApprovalCommit = commitApproval,
): Promise<ReviewResult | undefined> {
	const result = capturedSubmission(body, page);
	if (!result?.capture) return undefined;
	const operation = {
		action: "approve" as const,
		review: result.capture.review,
		digest: result.capture.digest,
		revision: result.capture.revision,
		verdict:
			result.verdict === "changes"
				? ("changes-requested" as const)
				: result.verdict === "dismissed"
					? ("withdrawn" as const)
					: ("approved" as const),
		note:
			result.comments.length || result.decisions.length || result.asked.length
				? JSON.stringify({
						summary: result.summary ?? "",
						comments: result.comments.map((comment) => ({
							...comment,
							file: page.hunks[comment.hunk]!.file,
							lines: page.hunks[comment.hunk]!.lines.slice(comment.start, comment.end + 1).map(({ o, n }) => ({
								before: o ?? null,
								after: n ?? null,
							})),
						})),
						decisions: result.decisions.map((answer) => ({
							...answer,
							question: page.decisions.find((decision) => decision.id === answer.id)?.question,
						})),
						asked: result.asked,
					})
				: (result.summary ?? ""),
		acceptLimits: result.capture.acceptLimits,
	};
	const request = createHash("sha256").update(JSON.stringify(operation)).digest("hex");
	await commit(`review-sign-off:${page.session.token}:${request}`, operation);
	return result;
}

async function commitApproval(
	commandId: string,
	operation: Extract<ReviewOperation, { action: "approve" }>,
): Promise<void> {
	const receipt = await sendCommand("operator", { kind: "review", version: 1, operation }, { commandId });
	if (receipt.stage !== "applied")
		throw new Error(receipt.reason ?? "Approval was not committed; inspect the review before retrying");
}
