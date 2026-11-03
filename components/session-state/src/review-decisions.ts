import type { DatabaseSync } from "node:sqlite";
import type {
	FindingDecision,
	ReviewApproval,
	ReviewDecision,
	VerifiedQuestion,
} from "../../code-review/src/decisions.js";
import type { ReviewJob, ReviewOperation, ReviewState } from "../../code-review/src/operations.js";
import type { ReviewAssessment } from "../../code-review/src/results.js";
import { reviewAssessment } from "./review-read.js";
import { mayManage } from "./work.js";

type DecisionOperation = Extract<ReviewOperation, { action: "finding" | "approve" }>;
export function reviewSettled(state: ReviewState): boolean {
	return ["completed", "incomplete", "failed", "interrupted", "cancelled", "no-changes"].includes(state);
}

export function reviewLimits(assessment: ReviewAssessment): string[] {
	const { job, passes, validation, findings } = assessment;
	const limits: string[] = [];
	if (job.state !== "completed") limits.push(`Review execution is ${job.state}: ${job.reason ?? "not completed"}`);
	if (!job.artifact?.intent) limits.push("Approved intent was not supplied; intent compliance is unassessed.");
	if (!job.artifact?.configuration)
		limits.push(
			"Capture-time review instructions/configured references were not recorded; inspect retained attempt inputs.",
		);
	else if (job.artifact.configuration.catalogIssues)
		limits.push(
			`${job.artifact.configuration.catalogIssues} role-catalog issues; captured configured references may be partial.`,
		);
	if (job.artifact?.omissions.length)
		limits.push(
			`${job.artifact.omissions.length} captured source/scope omissions remain; inspect the target's omission list.`,
		);
	if (!job.plan) limits.push("There is no completed review plan.");
	if (job.plan?.gaps?.length) limits.push(`${job.plan.gaps.length} changed regions have no primary inspection owner.`);
	if (!validation) limits.push("Finding and coverage validation has not completed.");
	for (const { pass, report } of passes) {
		for (const question of pass.questions) {
			const coverage = report?.coverage.find((entry) => entry.question === question.id);
			const gap = validation?.report.coverageGaps.find(
				(entry) => entry.pass === pass.id && entry.question === question.id,
			);
			if (coverage?.state !== "completed" || gap)
				limits.push(`${pass.id}/${question.id}: ${gap?.reason ?? coverage?.reason ?? "not inspected"}`);
		}
		for (const request of report?.extraPasses ?? [])
			limits.push(`${pass.id} requests more work: ${request.question} (${request.doneWhen})`);
		for (const limit of report?.limitations ?? []) limits.push(`${pass.id}: ${limit}`);
	}
	for (const finding of findings) {
		const response = finding.decision?.data.disposition;
		if (response === "rejected") continue;
		if (
			(!response || response === "acknowledged") &&
			["rejected", "duplicate"].includes(finding.validation?.disposition ?? "")
		)
			continue;
		limits.push(
			`${finding.id}: ${finding.finding.title} (${finding.decision?.data.disposition ?? finding.validation?.disposition ?? "unvalidated"}). A later fix does not change this captured code.`,
		);
	}
	limits.push(...(validation?.report.limitations ?? []));
	return limits;
}

export function recordReviewDecision(
	db: DatabaseSync,
	commandId: string,
	actor: string,
	job: ReviewJob,
	operation: DecisionOperation,
): void {
	const assessment = reviewAssessment(db, actor, job.id);
	if (actor !== assessment.job.owner) mayManage(db, actor, assessment.job.owner);
	if (
		!reviewSettled(assessment.job.state) ||
		assessment.job.revision !== operation.revision ||
		assessment.job.artifact?.digest !== operation.digest ||
		assessment.job.owner !== job.owner
	)
		throw new Error("The review assessment changed; inspect it again before deciding");
	const base = {
		id: commandId,
		review: job.id,
		actor,
		digest: operation.digest,
		revision: operation.revision,
		createdAt: Date.now(),
	};
	let decision: ReviewDecision;
	if (operation.action === "finding") {
		if (!assessment.findings.some((finding) => finding.id === operation.finding))
			throw new Error("The finding is not part of this assessment");
		const response = operation.response;
		if (["rejected", "accepted-risk", "fixed"].includes(response.disposition) && !response.evidence.length)
			throw new Error("This finding decision requires supporting evidence");
		if (response.disposition === "accepted-risk" && !response.scope)
			throw new Error("Accepted risk requires an explicit scope");
		if (response.disposition !== "fixed" && response.verification)
			throw new Error("Only a fixed decision can cite fix verification");
		const verifiedAgainst =
			response.disposition === "fixed" ? verifiedQuestion(db, actor, job, response.verification) : null;
		decision = {
			...base,
			kind: "finding",
			finding: operation.finding,
			data: { ...response, verifiedAgainst },
		} satisfies FindingDecision;
		db.prepare("update review_jobs set revision = revision + 1, updated_at = ? where id = ?").run(
			base.createdAt,
			job.id,
		);
	} else {
		if (actor !== "operator") throw new Error("Only the operator can sign off on a captured review");
		const limits = reviewLimits(assessment);
		if (operation.verdict === "approved" && limits.length && !operation.acceptLimits)
			throw new Error("Approval requires explicit acknowledgment of the displayed review limits");
		db.prepare("update review_jobs set updated_at = ? where id = ?").run(base.createdAt, job.id);
		decision = {
			...base,
			kind: "approval",
			finding: null,
			data: { verdict: operation.verdict, note: operation.note, limits },
		} satisfies ReviewApproval;
	}
	db.prepare(
		"insert into review_decisions (id, review_id, digest, revision, actor, kind, finding, data, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
	).run(
		decision.id,
		decision.review,
		decision.digest,
		decision.revision,
		decision.actor,
		decision.kind,
		decision.finding,
		JSON.stringify(decision.data),
		decision.createdAt,
	);
}

function verifiedQuestion(
	db: DatabaseSync,
	actor: string,
	original: ReviewJob,
	reference: { review: string; pass: string; question: string } | undefined,
): VerifiedQuestion {
	if (!reference)
		throw new Error(
			"A fixed decision requires a new target's completed verification question; otherwise record fixed-claimed",
		);
	const verified = reviewAssessment(db, actor, reference.review);
	if (
		verified.job.id === original.id ||
		!verified.job.artifact ||
		verified.job.artifact.digest === original.artifact?.digest
	)
		throw new Error("Fix verification must name a new captured target");
	if (!reviewSettled(verified.job.state) || !verified.validation)
		throw new Error("Fix verification requires a settled, validated assessment");
	const inspected = verified.passes.find(({ pass }) => pass.id === reference.pass);
	const coverage = inspected?.report?.coverage.find((entry) => entry.question === reference.question);
	if (
		!inspected?.attempt ||
		inspected.attempt.reuseBlockedBy ||
		coverage?.state !== "completed" ||
		verified.validation.report.coverageGaps.some(
			(gap) => gap.pass === reference.pass && gap.question === reference.question,
		)
	)
		throw new Error("The verification question has no unchallenged completed evidence");
	return {
		...reference,
		review: verified.job.id,
		digest: verified.job.artifact.digest,
		revision: verified.job.revision,
		attempt: inspected.attempt.id,
		validator: verified.validation.attempt.id,
		evidence: coverage.evidence,
	};
}
