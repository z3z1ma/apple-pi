import type { ReviewPreview } from "./preview.js";
import type {
	ReviewAnalytics,
	ReviewAssessment,
	ReviewAttemptLog,
	ReviewQueue,
	ReviewSource,
	ReviewSummary,
	ReviewThreadMessage,
} from "./results.js";
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

export function refLabel(review: Pick<ReviewSummary, "target" | "label">): string {
	const { target, label } = review;
	if (target.kind === "branch") return target.head;
	if (target.kind === "range") return `${target.base}..${target.head}`;
	return label.branch ?? (target.kind === "commit" ? target.commit : "detached");
}

export function changeLabel(review: Pick<ReviewSummary, "target" | "label">): string {
	const { target, label } = review;
	const files = label.files === null ? "" : ` (${label.files} ${label.files === 1 ? "file" : "files"})`;
	if (target.kind === "working-tree") return `uncommitted changes${files}`;
	if (target.kind === "staged") return `staged changes${files}`;
	if (!label.subject) return "";
	const more = label.commits && label.commits > 1 ? ` (+${label.commits - 1} more)` : "";
	return `${label.head?.slice(0, 7) ?? ""} ${label.subject}${more}`.trim();
}

export function elapsedLabel(review: Pick<ReviewSummary, "createdAt" | "settledAt">, now = Date.now()): string {
	const seconds = Math.max(0, Math.round(((review.settledAt ?? now) - review.createdAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function dollarsLabel(dollars: number | null): string {
	if (dollars === null) return "--";
	return dollars > 0 && dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`;
}

const compact = (value: number) =>
	value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value);

export function tokensLabel(cost: ReviewSummary["cost"]): string {
	return `in ${compact(cost.tokens.input)} \u00b7 out ${compact(cost.tokens.output)} \u00b7 cached ${compact(cost.tokens.cacheRead)}`;
}

export function resultLabel(review: ReviewSummary): string {
	if (["queued", "capturing"].includes(review.state)) return "waiting";
	if (review.state === "running")
		return review.findings.confirmed ? `${review.findings.confirmed} so far` : "reviewing";
	if (review.state === "no-changes") return "no changes";
	const { confirmed, responded } = review.findings;
	if (!confirmed) return review.state === "completed" ? "none confirmed" : "--";
	if (!responded) return `${confirmed} confirmed`;
	if (responded === confirmed) return `${confirmed} answered`;
	return `${confirmed - responded} of ${confirmed} open`;
}

export function whenLabel(at: number, now = Date.now()): string {
	const minutes = Math.round((now - at) / 60000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function queueStrip(queue: Pick<ReviewQueue, "states" | "passes">): string {
	const states = queue.states;
	const done = (states.completed ?? 0) + (states.incomplete ?? 0) + (states["no-changes"] ?? 0);
	return [
		`${states.queued ?? 0} queued`,
		`${(states.running ?? 0) + (states.capturing ?? 0)} running`,
		`${done} done`,
		`${(states.failed ?? 0) + (states.interrupted ?? 0)} failed`,
		`passes ${queue.passes.running}/${queue.passes.limit}`,
	].join("  \u00b7  ");
}

export function threadLines(messages: ReviewThreadMessage[]): string[] {
	if (!messages.length) return ["No mail on this review yet. Milestones and comments appear here."];
	return messages.flatMap((message) => [
		`${message.senderName} \u00b7 ${new Date(message.at).toLocaleString()}`,
		...message.body.split("\n"),
		"",
	]);
}

export function logLines(logs: ReviewAttemptLog[]): string[] {
	if (!logs.length) return ["No reviewer has started yet."];
	return logs.flatMap((log) => [
		`${log.pass} (${log.kind}) \u00b7 ${log.state}${log.model ? ` \u00b7 ${log.model}` : ""}`,
		...(log.entries.length
			? log.entries.map(
					(entry) => `  ${{ text: "say", tool: "run", result: "got", error: "err" }[entry.kind]} ${entry.text}`,
				)
			: ["  No transcript yet."]),
		"",
	]);
}

export function perLabel(dollars: number | null, count: number): string {
	return dollars === null || !count ? "--" : dollarsLabel(dollars / count);
}

export function unreportedLabel(attempts: number, reported: number): string {
	return attempts > reported ? ` (${attempts - reported} without cost)` : "";
}

export function analyticsLines(data: ReviewAnalytics): string[] {
	const per = perLabel;
	const lowerBound = data.unreported ? `at least ` : "";
	return [
		"Assessment",
		`Reviews: ${data.reviews} (${data.settled} settled)`,
		`Total cost: ${lowerBound}${dollarsLabel(data.dollars)}, ${per(data.dollars, data.reviews)} per review${data.unreported ? ` (${data.unreported} attempts without cost)` : ""}`,
		`Confirmed findings: ${data.confirmed}, ${per(data.dollars, data.confirmed)} each`,
		`Median review time: ${data.medianMinutes === null ? "--" : `${data.medianMinutes.toFixed(1)} min`}`,
		"",
		"By model",
		...data.byModel.map(
			(row) =>
				`${row.model}: ${row.attempts} attempts${unreportedLabel(row.attempts, row.reported)}, ${dollarsLabel(row.dollars)} (${per(row.dollars, row.reported)} each), ${row.confirmed} confirmed (${per(row.dollars, row.confirmed)} each)${
					Object.keys(row.severities).length
						? `, ${Object.entries(row.severities)
								.map(([severity, n]) => `${n} ${severity}`)
								.join(" ")}`
						: ""
				}`,
		),
		"",
		"By phase",
		...data.byPhase.map(
			(row) =>
				`${row.kind}: ${row.attempts} attempts${unreportedLabel(row.attempts, row.reported)}, ${dollarsLabel(row.dollars)} (${per(row.dollars, row.reported)} each), ${row.attempts ? (row.minutes / row.attempts).toFixed(1) : "--"} min each`,
		),
		"",
		"Recent reviews",
		...data.recent.map(
			(row) =>
				`${new Date(row.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}  ${row.label.repository}  ${dollarsLabel(row.dollars)}  ${row.minutes === null ? row.state : `${row.minutes.toFixed(0)} min`}  ${row.confirmed} confirmed`,
		),
		"",
		"Recorded primary-turn usage, not provider invoices. Findings count toward the model of the pass that reported them.",
	];
}

export function sourceLines(source: ReviewSource): string[] {
	if (source.kind === "files")
		return [
			`${source.side}: ${source.total} captured ${source.total === 1 ? "file" : "files"}.`,
			"Use a > Choose captured source to open a path.",
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
		`Review configuration: ${preview.configuration?.hash ?? "not recorded"}`,
		...(preview.configuration?.catalogIssues
			? [`Limit: ${preview.configuration.catalogIssues} role-catalog issues; configured references may be partial`]
			: []),
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
		`Change: ${review.label.repository} / ${refLabel(review)} ${changeLabel(review)}`.trimEnd(),
		`Execution: ${review.state}${review.phase ? ` - ${review.phase.pass}` : ""}`,
		`Elapsed: ${elapsedLabel(review)}${review.settledAt === null ? " so far" : ""}`,
		`Coverage: ${review.passes ? `${review.passes.completed}/${review.passes.required} passes` : "not planned"}`,
		`Findings: ${review.findings.confirmed} confirmed / ${review.findings.unresolved} unresolved / ${review.findings.responded} answered`,
		`Primary-turn cost: ${costLabel(review.cost)}`,
		`Tokens: ${tokensLabel(review.cost)}`,
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
					...(review.coverage.unassignedRegions ? [`Unassigned regions: ${review.coverage.unassignedRegions}`] : []),
					`Regions reviewed only by integration: ${review.coverage.integrationOnlyRegions}`,
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
		`Status: ${entry.validation?.disposition ?? "pending"}${entry.validation?.duplicateOf ? ` of ${entry.validation.duplicateOf}` : ""}`,
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
		"Status reason",
		entry.validation?.reason ?? "Not settled yet.",
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
