import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { acquireProjectLease, assertProjectLease } from "./lease.js";
import { parseTaskDocument, type WorkItem } from "./task-document.js";
import type { ExecutorOutput, JudgeOutput, ReviewerOutput } from "./types.js";

export class TaskMutationError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "TaskMutationError";
	}
}

export type WorkItemMutation =
	| { kind: "add"; id: string; description: string }
	| { kind: "reorder"; id: string; beforeId?: string }
	| { kind: "complete"; id: string }
	| { kind: "reopen"; id: string }
	| { kind: "cancel"; id: string; reason: string };

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function oneLine(value: string): string {
	return value
		.replace(/\s+/g, " ")
		.replace(/^#+\s*/, "")
		.trim();
}

function updateHeader(content: string, name: string, value: string): string {
	const pattern = new RegExp(`^${name}:.*$`, "m");
	if (!pattern.test(content)) throw new TaskMutationError(`Task is missing ${name} header`, "missing_header");
	return content.replace(pattern, `${name}: ${value}`);
}

function sectionBounds(content: string, heading: string): { bodyStart: number; bodyEnd: number; headingStart: number } {
	const bounds = parseTaskDocument(content).sectionRanges.get(heading.toLowerCase());
	if (!bounds) throw new TaskMutationError(`Task is missing ## ${heading}`, "missing_section");
	return bounds;
}

function appendSection(content: string, heading: string, markdown: string): string {
	const bounds = sectionBounds(content, heading);
	const body = content.slice(bounds.bodyStart, bounds.bodyEnd).trim();
	const replacement = `\n\n${body ? `${body}\n\n` : ""}${markdown.trim()}\n\n`;
	return content.slice(0, bounds.bodyStart) + replacement + content.slice(bounds.bodyEnd).replace(/^\s*/, "");
}

function replaceSection(content: string, heading: string, markdown: string): string {
	const bounds = sectionBounds(content, heading);
	const replacement = `\n\n${markdown.trim()}\n\n`;
	return content.slice(0, bounds.bodyStart) + replacement + content.slice(bounds.bodyEnd).replace(/^\s*/, "");
}

async function mutateTask(
	path: string,
	expectedDigest: string,
	mutate: (content: string) => string,
): Promise<{ content: string; digest: string }> {
	return withFileMutationQueue(path, async () => {
		const current = readFileSync(path, "utf8");
		if (sha256(current) !== expectedDigest)
			throw new TaskMutationError("Task changed concurrently", "task_compare_and_swap");
		let next = mutate(current);
		next = updateHeader(next, "Updated", new Date().toISOString().slice(0, 10));
		if (next === current) return { content: current, digest: expectedDigest };
		writeFileSync(path, next, "utf8");
		return { content: next, digest: sha256(next) };
	});
}

function substantive(value: string): boolean {
	const normalized = value.trim();
	return (
		normalized.length >= 12 &&
		!/^(?:none|n\/a|todo|pending|tbd|not yet|will be|do it)(?:\b|[.:])/i.test(normalized) &&
		!/^no\.?$/i.test(normalized)
	);
}

function renderWorkItems(items: WorkItem[]): string {
	return items
		.map((item) => {
			if (item.state === "open") return `- [ ] ${item.id}: ${item.description}`;
			if (item.state === "complete") return `- [x] ${item.id}: ${item.description}`;
			return `- [-] ${item.id}: ${item.description} — Cancelled: ${item.cancellationReason}`;
		})
		.join("\n");
}

function replaceWorkItems(content: string, items: WorkItem[]): string {
	if (/^##\s+Work Items\s*$/im.test(content)) return replaceSection(content, "Work Items", renderWorkItems(items));
	const reference = sectionBounds(content, "References");
	return `${content.slice(0, reference.headingStart)}## Work Items\n\n${renderWorkItems(items)}\n\n${content.slice(reference.headingStart)}`;
}

function mutateWorkItems(content: string, operation: WorkItemMutation): string {
	const document = parseTaskDocument(content);
	if (document.workItemIssues.length > 0)
		throw new TaskMutationError("Task has invalid Work Items", "invalid_work_items");
	const items = document.workItems.map((item) => ({ ...item }));
	const index = items.findIndex((item) => item.id === operation.id);
	if (operation.kind === "add") {
		if (!/^WI-\d{3}$/.test(operation.id) || !substantive(operation.description))
			throw new TaskMutationError(
				"New work item must have a canonical ID and substantive description",
				"invalid_work_item",
			);
		if (index !== -1) throw new TaskMutationError(`Work item already exists: ${operation.id}`, "duplicate_work_item");
		items.push({ id: operation.id, state: "open", description: operation.description.trim() });
	} else {
		if (index === -1) throw new TaskMutationError(`Unknown work item: ${operation.id}`, "unknown_work_item");
		const item = items[index];
		if (operation.kind === "reorder") {
			items.splice(index, 1);
			if (!operation.beforeId) items.push(item);
			else {
				const target = items.findIndex((candidate) => candidate.id === operation.beforeId);
				if (target === -1) throw new TaskMutationError(`Unknown work item: ${operation.beforeId}`, "unknown_work_item");
				items.splice(target, 0, item);
			}
		} else if (operation.kind === "complete") {
			if (item.state !== "open")
				throw new TaskMutationError(`Only open work items can complete: ${item.id}`, "invalid_work_item_transition");
			item.state = "complete";
		} else if (operation.kind === "reopen") {
			if (item.state !== "complete")
				throw new TaskMutationError(`Only complete work items can reopen: ${item.id}`, "invalid_work_item_transition");
			item.state = "open";
		} else {
			if (item.state !== "open" || !substantive(operation.reason))
				throw new TaskMutationError(
					`Only open work items can cancel with a substantive reason: ${item.id}`,
					"invalid_work_item_transition",
				);
			item.state = "cancelled";
			item.cancellationReason = operation.reason.trim();
		}
	}
	if (document.headers.status === "done" && items.some((item) => item.state === "open")) {
		throw new TaskMutationError("A done task cannot contain open work items", "done_task_open_work_item");
	}
	return replaceWorkItems(content, items);
}

export async function mutateTaskWorkItems(
	path: string,
	expectedDigest: string,
	operation: WorkItemMutation,
): Promise<{ content: string; digest: string }> {
	const release = acquireProjectLease(realpathSync(dirname(path)), `task-mutation-${randomUUID()}`);
	try {
		return await mutateTask(path, expectedDigest, (content) => mutateWorkItems(content, operation));
	} finally {
		release();
	}
}

/** Ralph proves the active run owns the task-bundle lease inside the queued write. */
export function completeTaskWorkItemsUnderLease(
	path: string,
	expectedDigest: string,
	runId: string,
	ids: string[],
): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) => {
		assertProjectLease(dirname(path), runId);
		return ids.reduce((next, id) => mutateWorkItems(next, { kind: "complete", id }), content);
	});
}

export function activateTask(path: string, expectedDigest: string): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) => updateHeader(content, "Status", "active"));
}

export function recordExecutorOutcome(
	path: string,
	expectedDigest: string,
	runId: string,
	iteration: number,
	outcome: ExecutorOutput,
): Promise<{ content: string; digest: string }> {
	const date = new Date().toISOString().slice(0, 10);
	return mutateTask(path, expectedDigest, (content) => {
		let next = content;
		const journal = outcome.journal.length > 0 ? outcome.journal : [outcome.summary];
		for (const item of journal)
			next = appendSection(
				next,
				"Journal",
				`- ${date}: Ralph run \`${runId}\`, iteration ${iteration}: ${oneLine(item)}`,
			);
		for (const criterion of outcome.acceptanceCriteria) {
			next = appendSection(next, "Evidence", `- ${criterion.id} [${criterion.status}]: ${oneLine(criterion.evidence)}`);
		}
		const retrospective = sectionBounds(next, "Retrospective");
		const currentRetrospective = next.slice(retrospective.bodyStart, retrospective.bodyEnd).trim();
		const retrospectiveEntry = `- Iteration ${iteration}: ${oneLine(outcome.retrospective)}`;
		next = /^(?:pending|todo|tbd|none|n\/a)\.?$/i.test(currentRetrospective)
			? replaceSection(next, "Retrospective", retrospectiveEntry)
			: appendSection(next, "Retrospective", retrospectiveEntry);
		for (const item of outcome.distillation) {
			const distillation = sectionBounds(next, "Distillation");
			const current = next.slice(distillation.bodyStart, distillation.bodyEnd).trim();
			next = /^(?:pending|todo|tbd|none|n\/a)\.?$/i.test(current)
				? replaceSection(next, "Distillation", `- Iteration ${iteration}: ${oneLine(item)}`)
				: appendSection(next, "Distillation", `- Iteration ${iteration}: ${oneLine(item)}`);
		}
		if (outcome.status === "blocked") {
			next = updateHeader(next, "Status", "blocked");
			next = replaceSection(
				next,
				"Blockers",
				outcome.blockers.length
					? outcome.blockers.map((blocker) => `- ${oneLine(blocker)}`).join("\n")
					: `- ${oneLine(outcome.summary)}`,
			);
		}
		return next;
	});
}

export function appendRunJournal(
	path: string,
	expectedDigest: string,
	runId: string,
	iteration: number,
	message: string,
): Promise<{ content: string; digest: string }> {
	const date = new Date().toISOString().slice(0, 10);
	return mutateTask(path, expectedDigest, (content) =>
		appendSection(content, "Journal", `- ${date}: Ralph run \`${runId}\`, iteration ${iteration}: ${oneLine(message)}`),
	);
}

export function appendIndependentReview(
	path: string,
	expectedDigest: string,
	runId: string,
	iteration: number,
	review: ReviewerOutput,
): Promise<{ content: string; digest: string }> {
	const findings = review.findings.length
		? review.findings
				.map(
					(finding) =>
						`  - **${finding.severity}**${finding.path ? ` \`${oneLine(finding.path)}\`` : ""}: ${oneLine(finding.summary)} Evidence: ${oneLine(finding.evidence)}`,
				)
				.join("\n")
		: "  - None.";
	const risks = review.residualRisk.length
		? review.residualRisk.map((risk) => `  - ${oneLine(risk)}`).join("\n")
		: "  - None recorded.";
	const markdown = [
		`### Ralph independent review — run ${runId}, iteration ${iteration}`,
		`Verdict: **${review.verdict}**`,
		`Summary: ${oneLine(review.summary)}`,
		"Findings:",
		findings,
		"Residual risk:",
		risks,
	].join("\n");
	return mutateTask(path, expectedDigest, (content) => appendSection(content, "Review", markdown));
}

export function appendJudgment(
	path: string,
	expectedDigest: string,
	runId: string,
	iteration: number,
	judgment: JudgeOutput,
): Promise<{ content: string; digest: string }> {
	const criteria = judgment.acceptanceCriteria
		.map((criterion) => `  - ${criterion.id}: **${criterion.status}** — ${oneLine(criterion.evidence)}`)
		.join("\n");
	const workItems = judgment.workItemJudgments
		.map((item) => `  - ${item.id}: **${item.decision}** — ${oneLine(item.reason)}`)
		.join("\n");
	const markdown = [
		`### Ralph judgment — run ${runId}, iteration ${iteration}`,
		`Decision: **${judgment.decision}**`,
		`Reason: ${oneLine(judgment.reason)}`,
		"Acceptance:",
		criteria || "  - No criterion assessment returned.",
		"Work items:",
		workItems || "  - No work-item proposals were assessed.",
		...(judgment.nextObjective ? [`Next objective: ${oneLine(judgment.nextObjective)}`] : []),
	].join("\n");
	return mutateTask(path, expectedDigest, (content) => appendSection(content, "Review", markdown));
}

export function blockTask(
	path: string,
	expectedDigest: string,
	reason: string,
): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) =>
		replaceSection(updateHeader(content, "Status", "blocked"), "Blockers", `- ${oneLine(reason)}`),
	);
}

export function closeTask(path: string, expectedDigest: string): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) => {
		const document = parseTaskDocument(content);
		if (document.workItemIssues.length > 0 || document.workItems.some((item) => item.state === "open")) {
			throw new TaskMutationError("A done task cannot contain invalid or open work items", "done_task_open_work_item");
		}
		return updateHeader(content, "Status", "done");
	});
}
