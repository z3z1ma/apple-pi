import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExecutorOutput, JudgeOutput, ReviewerOutput } from "./types.js";

export class TaskMutationError extends Error {
	constructor(message: string, readonly code: string) {
		super(message);
		this.name = "TaskMutationError";
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
}

function updateHeader(content: string, name: string, value: string): string {
	const pattern = new RegExp(`^${name}:.*$`, "m");
	if (!pattern.test(content)) throw new TaskMutationError(`Task is missing ${name} header`, "missing_header");
	return content.replace(pattern, `${name}: ${value}`);
}

function sectionBounds(content: string, heading: string): { bodyStart: number; bodyEnd: number } {
	const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
	const match = pattern.exec(content);
	if (!match || match.index === undefined) throw new TaskMutationError(`Task is missing ## ${heading}`, "missing_section");
	const bodyStart = match.index + match[0].length;
	const next = /^##\s+.+$/gm;
	next.lastIndex = bodyStart;
	const nextMatch = next.exec(content);
	return { bodyStart, bodyEnd: nextMatch?.index ?? content.length };
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

async function mutateTask(path: string, expectedDigest: string, mutate: (content: string) => string): Promise<{ content: string; digest: string }> {
	return withFileMutationQueue(path, async () => {
		const current = readFileSync(path, "utf8");
		if (sha256(current) !== expectedDigest) throw new TaskMutationError("Task changed concurrently", "task_compare_and_swap");
		let next = mutate(current);
		next = updateHeader(next, "Updated", new Date().toISOString().slice(0, 10));
		if (next === current) return { content: current, digest: expectedDigest };
		writeFileSync(path, next, "utf8");
		return { content: next, digest: sha256(next) };
	});
}

export function activateTask(path: string, expectedDigest: string): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) => updateHeader(content, "Status", "active"));
}

export function recordExecutorOutcome(path: string, expectedDigest: string, runId: string, iteration: number, outcome: ExecutorOutput): Promise<{ content: string; digest: string }> {
	const date = new Date().toISOString().slice(0, 10);
	return mutateTask(path, expectedDigest, (content) => {
		let next = content;
		const journal = outcome.journal.length > 0 ? outcome.journal : [outcome.summary];
		for (const item of journal) next = appendSection(next, "Journal", `- ${date}: Ralph run \`${runId}\`, iteration ${iteration}: ${oneLine(item)}`);
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
			next = replaceSection(next, "Blockers", outcome.blockers.length ? outcome.blockers.map((blocker) => `- ${oneLine(blocker)}`).join("\n") : `- ${oneLine(outcome.summary)}`);
		}
		return next;
	});
}

export function appendRunJournal(path: string, expectedDigest: string, runId: string, iteration: number, message: string): Promise<{ content: string; digest: string }> {
	const date = new Date().toISOString().slice(0, 10);
	return mutateTask(path, expectedDigest, (content) => appendSection(content, "Journal", `- ${date}: Ralph run \`${runId}\`, iteration ${iteration}: ${oneLine(message)}`));
}

export function appendIndependentReview(path: string, expectedDigest: string, runId: string, iteration: number, review: ReviewerOutput): Promise<{ content: string; digest: string }> {
	const findings = review.findings.length
		? review.findings.map((finding) => `  - **${finding.severity}**${finding.path ? ` \`${oneLine(finding.path)}\`` : ""}: ${oneLine(finding.summary)} Evidence: ${oneLine(finding.evidence)}`).join("\n")
		: "  - None.";
	const risks = review.residualRisk.length ? review.residualRisk.map((risk) => `  - ${oneLine(risk)}`).join("\n") : "  - None recorded.";
	const markdown = [
		`### Ralph independent review — run ${runId}, iteration ${iteration}`,
		`Verdict: **${review.verdict}**`,
		`Summary: ${oneLine(review.summary)}`,
		"Findings:", findings,
		"Residual risk:", risks,
	].join("\n");
	return mutateTask(path, expectedDigest, (content) => appendSection(content, "Review", markdown));
}

export function appendJudgment(path: string, expectedDigest: string, runId: string, iteration: number, judgment: JudgeOutput): Promise<{ content: string; digest: string }> {
	const criteria = judgment.acceptanceCriteria.map((criterion) => `  - ${criterion.id}: **${criterion.status}** — ${oneLine(criterion.evidence)}`).join("\n");
	const markdown = [
		`### Ralph judgment — run ${runId}, iteration ${iteration}`,
		`Decision: **${judgment.decision}**`,
		`Reason: ${oneLine(judgment.reason)}`,
		"Acceptance:", criteria || "  - No criterion assessment returned.",
		...(judgment.nextObjective ? [`Next objective: ${oneLine(judgment.nextObjective)}`] : []),
	].join("\n");
	return mutateTask(path, expectedDigest, (content) => appendSection(content, "Review", markdown));
}

export function blockTask(path: string, expectedDigest: string, reason: string): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) => replaceSection(updateHeader(content, "Status", "blocked"), "Blockers", `- ${oneLine(reason)}`));
}

export function closeTask(path: string, expectedDigest: string): Promise<{ content: string; digest: string }> {
	return mutateTask(path, expectedDigest, (content) => updateHeader(content, "Status", "done"));
}
