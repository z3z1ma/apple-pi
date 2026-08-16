import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineTool, parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentConfig } from "../../subagents/src/types.js";
import type {
	PlannerOutput,
	ProposedReviewFinding,
	ReviewGroup,
	ReviewInput,
	ReviewItem,
	ReviewerOutput,
	ReviewValidationStatus,
	VerifierOutput,
} from "./types.js";

export type ReviewRole = "planner" | "reviewer" | "verifier";

const ROLE_FILES: Record<ReviewRole, string> = {
	planner: "../../../skills/review-planner/SKILL.md",
	reviewer: "../../../skills/reviewer/SKILL.md",
	verifier: "../../../skills/review-verifier/SKILL.md",
};

const ROLE_NAMES: Record<ReviewRole, string> = {
	planner: "review-planner",
	reviewer: "reviewer",
	verifier: "review-verifier",
};

export interface ReviewRoleProfile {
	config: AgentConfig;
	skillHash: string;
}

function skillSource(role: ReviewRole): { body: string; hash: string } {
	const path = fileURLToPath(new URL(ROLE_FILES[role], import.meta.url));
	const raw = readFileSync(path, "utf8");
	const { body } = parseFrontmatter(raw);
	return { body: body.trim(), hash: createHash("sha256").update(raw).digest("hex") };
}

export function reviewRoleProfile(role: ReviewRole): ReviewRoleProfile {
	const skill = skillSource(role);
	return {
		skillHash: skill.hash,
		config: {
			name: ROLE_NAMES[role],
			displayName: `Review ${role[0].toUpperCase()}${role.slice(1)}`,
			description: `Fresh read-only ${role} for a sealed review run`,
			builtinToolNames: ["read", "grep", "find", "ls"],
			extensions: false,
			skills: false,
			persistSession: true,
			systemPrompt: skill.body,
			promptMode: "replace",
			enabled: true,
		},
	};
}

function sourceDescription(input: ReviewInput): string {
	switch (input.source.mode) {
		case "workspace":
			return `workspace at ${input.resolvedHead ?? "unborn HEAD"}`;
		case "range":
			return `merge-base ${input.resolvedBase} to ${input.resolvedHead}`;
		case "commit":
			return `commit ${input.resolvedHead} against ${input.resolvedBase}`;
	}
}

function authorityBlocks(background?: string, authorityPacket?: string): string[] {
	return [
		...(background?.trim() ? ["<review-background>", background.trim(), "</review-background>", ""] : []),
		...(authorityPacket?.trim() ? ["<authority-packet>", authorityPacket.trim(), "</authority-packet>", ""] : []),
	];
}

function itemManifest(items: ReviewItem[]): string {
	return items
		.map((entry) =>
			[
				`- id: ${entry.id}`,
				`  path: ${entry.path}`,
				...(entry.oldPath ? [`  oldPath: ${entry.oldPath}`] : []),
				`  status: ${entry.status}`,
				`  changedLines: +${entry.insertions}/-${entry.deletions}`,
				`  diffBytes: ${Buffer.byteLength(entry.diff)}`,
			].join("\n"),
		)
		.join("\n");
}

function diffPacket(items: ReviewItem[], maxBytes?: number): string {
	const parts: string[] = [];
	let used = 0;
	for (const entry of items) {
		const heading = `### ${entry.id} — ${entry.path}\n`;
		let diff = entry.diff;
		if (maxBytes !== undefined) {
			const remaining = Math.max(0, maxBytes - used - Buffer.byteLength(heading));
			if (Buffer.byteLength(diff) > remaining) {
				diff = Buffer.from(diff).subarray(0, remaining).toString("utf8") + "\n[planner excerpt ended]";
			}
		}
		const part = `${heading}\n\`\`\`diff\n${diff.trimEnd()}\n\`\`\``;
		parts.push(part);
		used += Buffer.byteLength(part);
		if (maxBytes !== undefined && used >= maxBytes) break;
	}
	return parts.join("\n\n");
}

export function plannerPrompt(
	input: ReviewInput,
	items: ReviewItem[],
	options: {
		background?: string;
		authorityPacket?: string;
		reviewRoot: string;
		maxGroups: number;
		maxGroupPromptBytes: number;
		excerptBytes: number;
	},
): string {
	return [
		"<sealed-review-input>",
		`Repository identity: ${input.projectRoot}`,
		`Read-only review tree for repository tools: ${options.reviewRoot}`,
		`Source: ${sourceDescription(input)}`,
		`Input SHA-256: ${input.inputHash}`,
		`Maximum groups: ${options.maxGroups}`,
		`Maximum rendered prompt per review group: ${options.maxGroupPromptBytes} bytes; use each item's diffBytes to keep groups within this bound.`,
		"Every item below must appear exactly once.",
		"",
		itemManifest(items),
		"</sealed-review-input>",
		"",
		...authorityBlocks(options.background, options.authorityPacket),
		"<diff-excerpts>",
		diffPacket(items, options.excerptBytes),
		"</diff-excerpts>",
	].join("\n");
}

export function reviewerPrompt(
	input: ReviewInput,
	group: ReviewGroup,
	focusItems: ReviewItem[],
	allItems: ReviewItem[],
	options: { background?: string; authorityPacket?: string; reviewRoot: string },
): string {
	return [
		"<review-assignment>",
		`Group: ${group.id} — ${group.title}`,
		`Objective: ${group.objective}`,
		`Rationale: ${group.rationale}`,
		`Read-only review tree for repository tools: ${options.reviewRoot}`,
		`Source: ${sourceDescription(input)}`,
		`Sealed input SHA-256: ${input.inputHash}`,
		"Assigned focus item IDs:",
		...group.itemIds.map((id) => `- ${id}`),
		"Suggested evidence context paths:",
		...(group.contextPaths.length
			? group.contextPaths.map((path) => `- ${path}`)
			: ["- None supplied; trace dependencies as evidence requires."]),
		"</review-assignment>",
		"",
		...authorityBlocks(options.background, options.authorityPacket),
		"<all-changed-items>",
		itemManifest(allItems),
		"</all-changed-items>",
		"",
		"<focus-diffs>",
		diffPacket(focusItems),
		"</focus-diffs>",
	].join("\n");
}

export function verifierPrompt(
	input: ReviewInput,
	group: ReviewGroup,
	focusItems: ReviewItem[],
	findings: Array<ProposedReviewFinding & { id: string }>,
	options: { background?: string; authorityPacket?: string; reviewRoot: string },
): string {
	return [
		"<verification-assignment>",
		`Group: ${group.id} — ${group.title}`,
		`Objective: ${group.objective}`,
		`Read-only review tree for repository tools: ${options.reviewRoot}`,
		`Sealed input SHA-256: ${input.inputHash}`,
		"</verification-assignment>",
		"",
		...authorityBlocks(options.background, options.authorityPacket),
		"<focus-diffs>",
		diffPacket(focusItems),
		"</focus-diffs>",
		"",
		"<candidate-findings>",
		JSON.stringify(findings, null, 2),
		"</candidate-findings>",
	].join("\n");
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
	return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((entry, index) => string(entry, `${label}[${index}]`));
}

function optionalStringArray(value: unknown, label: string): string[] {
	return value === undefined ? [] : stringArray(value, label);
}

function optionalArray(value: unknown, label: string): unknown[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T))
		throw new Error(`${label} must be one of ${allowed.join(", ")}`);
	return value as T;
}

export function parsePlannerOutput(value: unknown): PlannerOutput {
	const output = record(value, "planner result");
	if (!Array.isArray(output.groups)) throw new Error("groups must be an array");
	return {
		summary: string(output.summary, "summary"),
		groups: output.groups.map((raw, index) => {
			const group = record(raw, `groups[${index}]`);
			return {
				id: string(group.id, `groups[${index}].id`),
				title: string(group.title, `groups[${index}].title`),
				objective: string(group.objective, `groups[${index}].objective`),
				itemIds: stringArray(group.itemIds, `groups[${index}].itemIds`),
				contextPaths: optionalStringArray(group.contextPaths, `groups[${index}].contextPaths`),
				tier: oneOf(group.tier, ["fast", "strong"] as const, `groups[${index}].tier`),
				rationale: string(group.rationale, `groups[${index}].rationale`),
			};
		}),
	};
}

export function parseReviewerOutput(value: unknown): ReviewerOutput {
	const output = record(value, "reviewer result");
	return {
		summary: string(output.summary, "summary"),
		reviewedItemIds: stringArray(output.reviewedItemIds, "reviewedItemIds"),
		findings: optionalArray(output.findings, "findings").map((raw, index) => {
			const finding = record(raw, `findings[${index}]`);
			return {
				severity: oneOf(
					finding.severity,
					["critical", "significant", "minor", "nit"] as const,
					`findings[${index}].severity`,
				),
				category: oneOf(
					finding.category,
					["bug", "security", "performance", "maintainability", "test", "documentation", "other"] as const,
					`findings[${index}].category`,
				),
				summary: string(finding.summary, `findings[${index}].summary`),
				impact: string(finding.impact, `findings[${index}].impact`),
				evidence: string(finding.evidence, `findings[${index}].evidence`),
				path: string(finding.path, `findings[${index}].path`),
				anchor: string(finding.anchor, `findings[${index}].anchor`),
				side: oneOf(finding.side, ["new", "old"] as const, `findings[${index}].side`),
				...(typeof finding.suggestion === "string" &&
					finding.suggestion.trim() && { suggestion: finding.suggestion.trim() }),
			};
		}),
		residualRisk: optionalStringArray(output.residualRisk, "residualRisk"),
	};
}

export function parseVerifierOutput(value: unknown): VerifierOutput {
	const output = record(value, "verifier result");
	if (!Array.isArray(output.decisions)) throw new Error("decisions must be an array");
	return {
		decisions: output.decisions.map((raw, index) => {
			const decision = record(raw, `decisions[${index}]`);
			return {
				findingId: string(decision.findingId, `decisions[${index}].findingId`),
				status: oneOf<ReviewValidationStatus>(
					decision.status,
					["confirmed", "rejected", "retained_unresolved"] as const,
					`decisions[${index}].status`,
				),
				reason: string(decision.reason, `decisions[${index}].reason`),
				evidence: string(decision.evidence, `decisions[${index}].evidence`),
			};
		}),
		residualRisk: optionalStringArray(output.residualRisk, "residualRisk"),
	};
}

export interface ReviewResultCapture {
	tool: ToolDefinition;
	calls(): number;
	value(): unknown;
}

function resultTool(
	name: string,
	label: string,
	description: string,
	parameters: ToolDefinition["parameters"],
): ReviewResultCapture {
	let callCount = 0;
	let submitted: unknown;
	return {
		tool: defineTool({
			name,
			label,
			description,
			promptSnippet: `Submit the final ${label.toLowerCase()} through this terminating tool.`,
			promptGuidelines: ["Call this tool exactly once with the complete final result. Do not return prose JSON."],
			parameters,
			executionMode: "sequential",
			async execute(_toolCallId, params) {
				callCount++;
				submitted = params;
				return { content: [{ type: "text", text: `${label} submitted.` }], details: params, terminate: true };
			},
		}),
		calls: () => callCount,
		value: () => submitted,
	};
}

export function createReviewResultTool(role: ReviewRole): ReviewResultCapture {
	if (role === "planner")
		return resultTool(
			"submit_review_plan",
			"Review plan",
			"Submit the complete semantic review plan.",
			Type.Object({
				summary: Type.String(),
				groups: Type.Array(
					Type.Object({
						id: Type.String(),
						title: Type.String(),
						objective: Type.String(),
						itemIds: Type.Array(Type.String()),
						contextPaths: Type.Optional(Type.Array(Type.String())),
						tier: Type.Union([Type.Literal("fast"), Type.Literal("strong")]),
						rationale: Type.String(),
					}),
				),
			}),
		);
	if (role === "reviewer")
		return resultTool(
			"submit_review_findings",
			"Review findings",
			"Submit complete findings and coverage.",
			Type.Object({
				summary: Type.String(),
				reviewedItemIds: Type.Array(Type.String()),
				findings: Type.Optional(
					Type.Array(
						Type.Object({
							severity: Type.Union([
								Type.Literal("critical"),
								Type.Literal("significant"),
								Type.Literal("minor"),
								Type.Literal("nit"),
							]),
							category: Type.Union([
								Type.Literal("bug"),
								Type.Literal("security"),
								Type.Literal("performance"),
								Type.Literal("maintainability"),
								Type.Literal("test"),
								Type.Literal("documentation"),
								Type.Literal("other"),
							]),
							summary: Type.String(),
							impact: Type.String(),
							evidence: Type.String(),
							path: Type.String(),
							anchor: Type.String(),
							side: Type.Union([Type.Literal("new"), Type.Literal("old")]),
							suggestion: Type.Optional(Type.String()),
						}),
					),
				),
				residualRisk: Type.Optional(Type.Array(Type.String())),
			}),
		);
	return resultTool(
		"submit_review_verdict",
		"Review verdict",
		"Submit the complete independent verification verdict.",
		Type.Object({
			decisions: Type.Array(
				Type.Object({
					findingId: Type.String(),
					status: Type.Union([
						Type.Literal("confirmed"),
						Type.Literal("rejected"),
						Type.Literal("retained_unresolved"),
					]),
					reason: Type.String(),
					evidence: Type.String(),
				}),
			),
			residualRisk: Type.Optional(Type.Array(Type.String())),
		}),
	);
}
