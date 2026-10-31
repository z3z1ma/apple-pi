import type { ReviewPreview } from "./preview.js";
import type { ReviewAssessment, ReviewSource, ReviewSummary } from "./results.js";
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

export function sourceLines(source: ReviewSource): string[] {
	if (source.kind === "files")
		return [
			`${source.side}: ${source.total} captured ${source.total === 1 ? "file" : "files"}.`,
			"Use v > source to open a path.",
			"",
			...(source.page?.rows.map((file) => JSON.stringify(file.path)) ?? []),
		];
	return [
		`${source.side}: ${JSON.stringify(source.file.path)}`,
		source.page?.rows.length
			? `Source lines: ${source.page.offset + 1}-${source.page.offset + source.page.rows.length} / ${source.total}`
			: `Source lines: ${source.total ?? "not text"}`,
		source.representation,
		"Retained Git; live checkout is not checked.",
		"",
		...(source.page?.rows.map((line, index) => `${source.page!.offset + index + 1} | ${line}`) ?? []),
		"",
		`Blob: ${source.file.blob}`,
		`Bytes: ${source.bytes ?? "pointer only"}`,
	];
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

export function costLabel(cost: ReviewSummary["cost"]): string {
	if (!cost.totalAttempts) return "no attempts";
	const dollars = cost.reportedDollars;
	const amount = dollars === null ? "unavailable" : dollars > 0 && dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`;
	return `${amount} (${cost.reportedAttempts}/${cost.totalAttempts} reported)`;
}

export function summaryLines(review: ReviewSummary): string[] {
	return [
		"Assessment",
		`Execution: ${review.state}${review.phase ? ` - ${review.phase.pass}` : ""}`,
		`Coverage: ${review.passes ? `${review.passes.completed}/${review.passes.required} passes` : "not planned"}`,
		`Findings: ${review.findings.confirmed} confirmed / ${review.findings.unresolved} unresolved`,
		`Primary-turn cost: ${costLabel(review.cost)}`,
		`Target: ${targetLabel(review.target)}`,
		`Owner: ${review.ownerName}`,
		`Priority: ${review.priority}`,
		`Intent: ${review.intent}`,
		`Approval: ${approvalLabel(review)}`,
		"Live target freshness: not checked",
		`Assessment revision: ${review.revision}`,
		...(review.coverage
			? [
					`Questions: ${review.coverage.completedQuestions}/${review.coverage.requiredQuestions}`,
					`Unassigned regions: ${review.coverage.unassignedRegions}`,
					`Additional requests: ${review.coverage.additionalRequests}`,
				]
			: []),
		...(review.reason ? ["", review.reason] : []),
		"",
		"Completion is not approval or a correctness certificate.",
		"Cost includes all recorded attempts; unobserved internal activity is excluded.",
		"",
		"Review plan",
		...(review.summary ? [review.summary] : ["Not recorded"]),
		"",
		"Captured target",
		`Directory: ${review.cwd}`,
		`Review: ${review.id}`,
		`Owner identity: ${review.owner}`,
		`Digest: ${review.digest ?? "not admitted"}`,
	];
}

export function findingLines(entry: ReviewAssessment["findings"][number]): string[] {
	const finding = entry.finding;
	return [
		`[${finding.severity}] ${finding.title}`,
		`${finding.path}:${finding.line} (${finding.side})`,
		`Validation: ${entry.validation?.disposition ?? "not yet validated"}`,
		`Owner response: ${entry.decision?.data.disposition ?? "none"}`,
		`Reported certainty: ${finding.certainty}`,
		"",
		"Trigger",
		finding.trigger,
		"",
		"Impact",
		finding.impact,
		"",
		"Invariant",
		finding.invariant,
		"",
		"Cause",
		finding.cause,
		"",
		"Proposed correction",
		finding.correction,
		"",
		"Evidence",
		...evidenceLines(finding.evidence),
		"",
		"Counterevidence",
		finding.counterevidence,
		"",
		"Validation evidence",
		...evidenceLines(entry.validation),
		"",
		"Owner response evidence",
		...evidenceLines(entry.decision),
		"",
		`Finding: ${entry.id}`,
		`Pass: ${entry.pass}`,
		`Attempt: ${entry.attempt}`,
		"",
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
