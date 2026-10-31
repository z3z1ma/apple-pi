import type { ReviewPreview } from "./preview.js";
import type { ReviewSummary } from "./results.js";
import type { ReviewTarget } from "./types.js";

export function targetLabel(target: ReviewTarget): string {
	switch (target.kind) {
		case "working-tree":
			return `working tree vs ${target.base}`;
		case "staged":
			return "staged changes";
		case "commit":
			return `commit ${target.commit}`;
		case "range":
			return `${target.base}..${target.head}`;
		case "branch":
			return `${target.head} since ${target.base}`;
	}
}

export function previewLines(preview: ReviewPreview): string[] {
	const mutable = ["working-tree", "staged"].includes(preview.request.target.kind);
	const omissions = new Map<string, number>();
	for (const entry of preview.omissions) omissions.set(entry.reason, (omissions.get(entry.reason) ?? 0) + 1);
	return [
		`Directory: ${JSON.stringify(preview.request.cwd)}`,
		`Git worktree: ${JSON.stringify(preview.repository)}`,
		`Common Git directory: ${JSON.stringify(preview.commonDirectory)}`,
		`Comparison: ${JSON.stringify(targetLabel(preview.request.target))}`,
		`Base commit: ${preview.baseCommit ?? "empty tree"}`,
		`${mutable ? "Checkout HEAD" : "Head commit"}: ${preview.headCommit ?? "none"}`,
		`Base tree: ${preview.baseTree}`,
		`Review tree: ${preview.headTree}`,
		`Digest: ${preview.digest}`,
		`Changed paths: ${preview.changes.length}; regions: ${preview.regions}`,
		`Scope: ${preview.request.paths?.length ? `${preview.request.paths.length} requested path prefixes` : "all changed paths"}`,
		`Requested lenses: ${JSON.stringify(preview.request.lenses ?? [])}`,
		preview.intent
			? `Approved intent: ${JSON.stringify(preview.intent.origin)} (hash ${preview.intent.hash})`
			: "Approved intent: not supplied; intent compliance stays unassessed",
		...Array.from(omissions, ([reason, count]) => `Limit (${count} paths): ${reason}`),
	];
}

export function approvalLabel(review: ReviewSummary): string {
	if (!review.approval) return "not signed off";
	if (!review.approval.matchesAssessment) return "earlier sign-off is stale";
	return review.approval.record.data.verdict;
}

export function reviewStatus(review: ReviewSummary): string {
	const coverage = review.passes ? `${review.passes.completed}/${review.passes.required} passes` : "coverage pending";
	return `${review.state}${review.phase ? `: ${review.phase.pass}` : ""} | ${coverage} | ${review.findings.confirmed} confirmed, ${review.findings.unresolved} unresolved`;
}

export function summaryLines(review: ReviewSummary): string[] {
	return [
		targetLabel(review.target),
		review.cwd,
		review.id,
		...(review.summary ? [review.summary] : []),
		"",
		reviewStatus(review),
		`Owner: ${review.ownerName} (${review.owner})`,
		`Priority: ${review.priority}`,
		`Intent: ${review.intent}`,
		`Approval: ${approvalLabel(review)}`,
		"Live target freshness: not checked",
		`Assessment revision: ${review.revision}`,
		`Captured digest: ${review.digest ?? "not admitted"}`,
		...(review.coverage
			? [
					`Questions: ${review.coverage.completedQuestions}/${review.coverage.requiredQuestions}`,
					`Unassigned regions: ${review.coverage.unassignedRegions}`,
					`Additional requests: ${review.coverage.additionalRequests}`,
				]
			: []),
		...(review.reason ? ["", review.reason] : []),
		"",
		"Completion, coverage, findings and approval are separate. A completed review is not a correctness certificate.",
	];
}

/** Progressive evidence keeps its field names, including uncertainty and provenance. */
export function evidenceLines(value: unknown, depth = 0): string[] {
	const indent = "  ".repeat(depth);
	if (value === null || value === undefined) return [`${indent}not recorded`];
	if (typeof value === "string") return value.split("\n").map((line) => `${indent}${line}`);
	if (Array.isArray(value))
		return value.length
			? value.flatMap((entry, index) => [`${indent}#${index + 1}`, ...evidenceLines(entry, depth + 1), ""])
			: [`${indent}none`];
	if (typeof value !== "object") return [`${indent}${String(value)}`];
	return Object.entries(value).flatMap(([key, item]) => {
		const label = key.replace(/([a-z])([A-Z])/g, "$1 $2");
		return typeof item === "object" && item !== null
			? [`${indent}${label}:`, ...evidenceLines(item, depth + 1)]
			: [`${indent}${label}: ${item === null ? "not recorded" : String(item)}`];
	});
}
