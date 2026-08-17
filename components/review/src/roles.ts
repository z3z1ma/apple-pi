import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineTool, parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentConfig } from "../../subagents/src/types.js";
import type {
	OpenReviewCall,
	ReviewFocus,
	ReviewInput,
	ReviewItem,
	ReviewMetaReview,
	ReviewNote,
	ReviewPartition,
	ReviewReport,
	ReviewValidationStatus,
	VerifierOutput,
} from "./types.js";
import { reviewItemAliases } from "./work-graph.js";

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

function itemAlias(item: ReviewItem, aliases: Map<string, string>): string {
	return aliases.get(item.id) ?? item.path;
}

function itemManifest(items: ReviewItem[]): string {
	const aliases = reviewItemAliases(items);
	return items
		.map((entry) =>
			[
				`- id: ${itemAlias(entry, aliases)}`,
				`  path: ${entry.path}`,
				...(entry.oldPath ? [`  oldPath: ${entry.oldPath}`] : []),
				`  status: ${entry.status}`,
				`  changedLines: +${entry.insertions}/-${entry.deletions}`,
				`  diffBytes: ${Buffer.byteLength(entry.diff)}`,
			].join("\n"),
		)
		.join("\n");
}

function diffPacket(items: ReviewItem[], aliases = reviewItemAliases(items)): string {
	return items
		.map((entry) => `### ${itemAlias(entry, aliases)} — ${entry.path}\n\n\`\`\`diff\n${entry.diff.trimEnd()}\n\`\`\``)
		.join("\n\n");
}

/** Controller-owned excerpt size. Short enough that planning cannot substitute for review. */
export const PLANNER_EXCERPT_BYTES = 8 * 1024;

function utf8Prefix(value: string, maxBytes: number): { text: string; truncated: boolean } {
	if (maxBytes <= 0) return { text: "", truncated: value.length > 0 };
	let text = "";
	let bytes = 0;
	for (const codePoint of value) {
		const codePointBytes = Buffer.byteLength(codePoint);
		if (bytes + codePointBytes > maxBytes) return { text, truncated: true };
		text += codePoint;
		bytes += codePointBytes;
	}
	return { text, truncated: false };
}

function fairDiffExcerpts(items: ReviewItem[], maxBytes: number): string {
	const aliases = reviewItemAliases(items);
	const perItemBytes = Math.max(0, Math.floor(maxBytes / Math.max(1, items.length)));
	return items
		.map((entry) => {
			const heading = `### ${itemAlias(entry, aliases)} — ${entry.path} (${entry.status}; ${Buffer.byteLength(entry.diff)} sealed diff bytes)\n`;
			const available = Math.max(0, perItemBytes - Buffer.byteLength(heading));
			const { text, truncated } = utf8Prefix(entry.diff, available);
			return `${heading}\n\`\`\`diff\n${text.trimEnd()}${truncated ? "\n[excerpt truncated; do not reconstruct the rest]" : ""}\n\`\`\``;
		})
		.join("\n\n");
}

export function plannerPrompt(
	input: ReviewInput,
	items: ReviewItem[],
	options: {
		background?: string;
		authorityPacket?: string;
		reviewRoot: string;
		cycle: number;
		maxCycles: number;
		maxFocuses: number;
		uncoveredAliases?: string[];
		priorFocuses?: Array<{ cycle: number; title: string; question: string; files: string[] }>;
		priorFindings?: string;
		metaReview?: ReviewMetaReview;
		excerptBytes?: number;
	},
): string {
	const excerptBytes = options.excerptBytes ?? PLANNER_EXCERPT_BYTES;
	const later = options.cycle > 1;
	return [
		"<sealed-review-input>",
		`Repository identity: ${input.projectRoot}`,
		`Read-only review tree for repository tools: ${options.reviewRoot}`,
		`Source: ${sourceDescription(input)}`,
		`Input SHA-256: ${input.inputHash}`,
		`Cycle: ${options.cycle} of ${options.maxCycles}`,
		`Maximum focuses this cycle: ${options.maxFocuses}`,
		later
			? "This is a later cycle. Do not repeat a previous investigation of the same files. Cover residuals, second-order issues, compound risks, and any selected files that still have no partition."
			: "Cut the selected change into cohesive partitions. Each open_review call is one partition: the files plus the investigation questions for those files. Call open_review once per partition. You may call it several times. This is not the review.",
		"Do not investigate defects, report findings, or treat planning as a pre-review. Use repository read/grep/find/ls when a relationship is unclear.",
		"Use the item IDs shown in the manifest exactly. Those IDs are repository paths, with a status suffix only when two selected items share a path. Do not invent, rewrite, or hash item IDs.",
		later
			? "Prefer files named in residuals or still uncovered. Skip files that already had a thorough look unless a residual names a new question."
			: "Every selected item should appear in at least one open_review before you stop. Incomplete excerpts are expected; open reviews from what you have.",
		".ledger/ is shaping history. Reviewers may read it for context. Do not open_review it. It is not a coverage subject.",
		"",
		itemManifest(items),
		"</sealed-review-input>",
		"",
		...authorityBlocks(options.background, options.authorityPacket),
		"<diff-excerpts>",
		fairDiffExcerpts(items, excerptBytes),
		"</diff-excerpts>",
		...(options.uncoveredAliases?.length
			? ["", "<still-uncovered>", ...options.uncoveredAliases.map((alias) => `- ${alias}`), "</still-uncovered>"]
			: []),
		...(options.priorFocuses?.length
			? [
					"",
					"<prior-focuses>",
					...options.priorFocuses.map(
						(focus) => `- c${focus.cycle}: ${focus.title} — ${focus.question} [${focus.files.join(", ")}]`,
					),
					"</prior-focuses>",
				]
			: []),
		...(options.priorFindings ? ["", "<prior-findings>", options.priorFindings, "</prior-findings>"] : []),
		...(options.metaReview
			? [
					"",
					"<prior-meta-review>",
					options.metaReview.sentiment,
					...options.metaReview.compoundRisks.map((risk) => `compound: ${risk}`),
					...options.metaReview.residuals.map((risk) => `residual: ${risk}`),
					...options.metaReview.coverageGaps.map((gap) => `gap: ${gap}`),
					"</prior-meta-review>",
				]
			: []),
	].join("\n");
}

export function reviewerPrompt(
	input: ReviewInput,
	partition: ReviewPartition,
	focus: ReviewFocus,
	focusItems: ReviewItem[],
	allItems: ReviewItem[],
	options: { background?: string; authorityPacket?: string; reviewRoot: string },
): string {
	const aliases = reviewItemAliases(allItems);
	return [
		"<review-assignment>",
		`Partition: ${partition.id} — ${partition.title}`,
		`Focus: ${focus.id} — ${focus.title}`,
		`Investigation question: ${focus.question}`,
		"Required checks:",
		...focus.checks.map((check) => `- ${check}`),
		`Read-only review tree for repository tools: ${options.reviewRoot}`,
		`Source: ${sourceDescription(input)}`,
		`Sealed input SHA-256: ${input.inputHash}`,
		"Assigned files:",
		...focus.itemIds.map((id) => `- ${aliases.get(id) ?? id}`),
		"Report each finding or note through the report tool. You may call it several times. Stop when the focus is done. Do not submit a closing JSON blob.",
		"A finding path must be one of the assigned files listed above. Give startLine and endLine on the current file (side=old only for deleted code). Do not paste those lines back as evidence; the controller attaches them. Notes are one or two sentences.",
		"You may read .ledger/ for task or decision context. It is not a review subject unless it is assigned to this focus.",
		"</review-assignment>",
		"",
		...authorityBlocks(options.background, options.authorityPacket),
		"<all-changed-items>",
		itemManifest(allItems),
		"</all-changed-items>",
		"",
		"<focus-diffs>",
		diffPacket(focusItems, aliases),
		"</focus-diffs>",
	].join("\n");
}

export function verifierPrompt(
	input: ReviewInput,
	cycle: number,
	focuses: ReviewFocus[],
	findings: Array<{
		id: string;
		focusId: string;
		path: string;
		summary: string;
		impact: string;
		evidence: string;
		startLine?: number;
		endLine?: number;
		provenance?: string;
		clusterId?: string;
		hunk?: string;
	}>,
	notes: ReviewNote[],
	clusters: Array<{
		id: string;
		path: string;
		side?: string;
		startLine?: number;
		endLine?: number;
		findingIds: string[];
	}>,
	options: { background?: string; authorityPacket?: string; reviewRoot: string },
): string {
	return [
		"<verification-assignment>",
		`Cycle: ${cycle}`,
		`Read-only review tree for repository tools: ${options.reviewRoot}`,
		`Sealed input SHA-256: ${input.inputHash}`,
		"Decide each finding. The hunk is the claimed lines pulled from the file or sealed diff. Screen the claim against that text. Do not hunt the tree unless you need a counterexample.",
		"Clusters are precomputed. Speak to compound risk on those groups. Do not merge distinct findings that share a path or line.",
		"Write one meta-review: overall sentiment, compound risks, residuals, and anything that was not reviewed enough.",
		"Reject only with concrete counterevidence. If the finding is wrong but a careful reader could believe it because the code or docs omit the real rule, set invitedByAmbiguity true. Those become clarity residuals for later cycles.",
		"</verification-assignment>",
		"",
		...authorityBlocks(options.background, options.authorityPacket),
		"<cycle-focuses>",
		...focuses.map((focus) => `- ${focus.id}: ${focus.title} — ${focus.question}`),
		"</cycle-focuses>",
		"",
		"<finding-clusters>",
		JSON.stringify(clusters, null, 2),
		"</finding-clusters>",
		"",
		"<candidate-findings>",
		JSON.stringify(findings, null, 2),
		"</candidate-findings>",
		"",
		"<reviewer-notes>",
		JSON.stringify(
			notes.map((note) => ({ focusId: note.focusId, summary: note.summary, evidence: note.evidence })),
			null,
			2,
		),
		"</reviewer-notes>",
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

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T))
		throw new Error(`${label} must be one of ${allowed.join(", ")}`);
	return value as T;
}

export function parseOpenReviewCall(value: unknown): OpenReviewCall {
	const output = record(value, "open_review");
	if (!Array.isArray(output.focuses)) throw new Error("focuses must be an array");
	return {
		...(optionalString(output.title) && { title: optionalString(output.title) }),
		files: stringArray(output.files, "files"),
		focuses: output.focuses.map((raw, index) => {
			const focus = record(raw, `focuses[${index}]`);
			return {
				title: string(focus.title, `focuses[${index}].title`),
				question: string(focus.question, `focuses[${index}].question`),
				checks: stringArray(focus.checks, `focuses[${index}].checks`),
			};
		}),
	};
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
	return value;
}

function assignedPathSchema(paths: readonly string[]) {
	const unique = [...new Set(paths.filter(Boolean))].sort();
	if (unique.length === 0) return Type.Optional(Type.String());
	if (unique.length === 1) return Type.Optional(Type.Literal(unique[0]));
	return Type.Optional(Type.Union(unique.map((path) => Type.Literal(path))));
}

export function parseReviewReport(value: unknown): ReviewReport {
	const output = record(value, "report");
	const kind = oneOf(output.kind, ["finding", "note"] as const, "kind");
	const report: ReviewReport = {
		kind,
		what: string(output.what, "what"),
		...(optionalString(output.evidence) && { evidence: optionalString(output.evidence) }),
		...(optionalString(output.why) && { why: optionalString(output.why) }),
		...(optionalString(output.path) && { path: optionalString(output.path) }),
		...(optionalString(output.suggestion) && { suggestion: optionalString(output.suggestion) }),
	};
	if (typeof output.startLine === "number" && Number.isInteger(output.startLine)) report.startLine = output.startLine;
	if (typeof output.endLine === "number" && Number.isInteger(output.endLine)) report.endLine = output.endLine;
	if (output.side !== undefined) report.side = oneOf(output.side, ["new", "old"] as const, "side");
	if (output.severity !== undefined)
		report.severity = oneOf(output.severity, ["critical", "significant", "minor", "nit"] as const, "severity");
	if (kind === "finding") {
		if (!report.path) throw new Error("finding path is required");
		if (!report.severity) throw new Error("finding severity is required");
	}
	return report;
}

export function parseVerifierOutput(value: unknown): VerifierOutput {
	const output = record(value, "meta review");
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
				...(optionalBoolean(decision.invitedByAmbiguity, `decisions[${index}].invitedByAmbiguity`) && {
					invitedByAmbiguity: true,
				}),
			};
		}),
		sentiment: string(output.sentiment, "sentiment"),
		compoundRisks: optionalStringArray(output.compoundRisks, "compoundRisks"),
		residuals: optionalStringArray(output.residuals, "residuals"),
		coverageGaps: optionalStringArray(output.coverageGaps, "coverageGaps"),
	};
}

export interface ReviewToolCapture<T> {
	tool: ToolDefinition;
	calls(): number;
	values(): T[];
}

export function createOpenReviewTool(): ReviewToolCapture<OpenReviewCall> {
	const values: OpenReviewCall[] = [];
	return {
		tool: defineTool({
			name: "open_review",
			label: "Open review",
			description: "Open one partition: a group of selected files plus the investigation focuses for those files.",
			promptSnippet:
				"Call once per partition. You may call it several times. Stop when every selected file that needs a look has a partition.",
			promptGuidelines: [
				"Each call starts one parallel review partition after you exit.",
				"files must copy manifest IDs exactly.",
				"focuses must be concrete questions, not generic categories.",
			],
			parameters: Type.Object({
				title: Type.Optional(Type.String()),
				files: Type.Array(Type.String()),
				focuses: Type.Array(
					Type.Object({
						title: Type.String(),
						question: Type.String(),
						checks: Type.Array(Type.String()),
					}),
				),
			}),
			executionMode: "sequential",
			async execute(_toolCallId, params) {
				const call = parseOpenReviewCall(params);
				values.push(call);
				return {
					content: [
						{
							type: "text",
							text: `Opened review of ${call.files.length} file(s) with ${call.focuses.length} focus(es). Call again for another partition, or stop when planning is done.`,
						},
					],
					details: call,
				};
			},
		}),
		calls: () => values.length,
		values: () => values,
	};
}

export function createReportTool(assignedPaths: readonly string[] = []): ReviewToolCapture<ReviewReport> {
	const values: ReviewReport[] = [];
	const uniquePaths = [...new Set(assignedPaths.filter(Boolean))].sort();
	const pathList = uniquePaths.length ? uniquePaths.join(", ") : "an assigned focus file";
	return {
		tool: defineTool({
			name: "report",
			label: "Report",
			description: `Report one finding or note for the assigned focus. Finding path must be one of: ${pathList}. Give startLine/endLine; do not paste those lines as evidence.`,
			promptSnippet: "Call once per finding or note. Use kind=note for residuals or 'looked, nothing here'.",
			promptGuidelines: [
				`Findings need severity, path (one of: ${pathList}), a short what and why, and startLine/endLine.`,
				"Do not invent line numbers. Omit them if you are not sure. Do not paste the cited lines as evidence.",
				"Notes are one or two sentences. Do not restate the diff.",
				"You may call this several times. Stop when the focus is done.",
			],
			parameters: Type.Object({
				kind: Type.Union([Type.Literal("finding"), Type.Literal("note")]),
				severity: Type.Optional(
					Type.Union([
						Type.Literal("critical"),
						Type.Literal("significant"),
						Type.Literal("minor"),
						Type.Literal("nit"),
					]),
				),
				path: assignedPathSchema(uniquePaths),
				startLine: Type.Optional(Type.Integer()),
				endLine: Type.Optional(Type.Integer()),
				side: Type.Optional(Type.Union([Type.Literal("new"), Type.Literal("old")])),
				what: Type.String(),
				why: Type.Optional(Type.String()),
				evidence: Type.Optional(Type.String()),
				suggestion: Type.Optional(Type.String()),
			}),
			executionMode: "sequential",
			async execute(_toolCallId, params) {
				const report = parseReviewReport(params);
				values.push(report);
				return { content: [{ type: "text", text: `${report.kind} recorded.` }], details: report };
			},
		}),
		calls: () => values.length,
		values: () => values,
	};
}

export function createMetaReviewTool(): ReviewToolCapture<VerifierOutput> {
	const values: VerifierOutput[] = [];
	return {
		tool: defineTool({
			name: "submit_meta_review",
			label: "Meta review",
			description: "Submit finding decisions and the cycle meta-review.",
			promptSnippet:
				"Call exactly once with decisions for every finding plus sentiment, compound risks, residuals, and coverage gaps.",
			promptGuidelines: [
				"Call this tool exactly once. Do not return prose JSON.",
				"Set invitedByAmbiguity on a reject when the code or docs invited the misread.",
			],
			parameters: Type.Object({
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
						invitedByAmbiguity: Type.Optional(Type.Boolean()),
					}),
				),
				sentiment: Type.String(),
				compoundRisks: Type.Optional(Type.Array(Type.String())),
				residuals: Type.Optional(Type.Array(Type.String())),
				coverageGaps: Type.Optional(Type.Array(Type.String())),
			}),
			executionMode: "sequential",
			async execute(_toolCallId, params) {
				const parsed = parseVerifierOutput(params);
				values.push(parsed);
				return { content: [{ type: "text", text: "Meta review submitted." }], details: parsed, terminate: true };
			},
		}),
		calls: () => values.length,
		values: () => values,
	};
}
