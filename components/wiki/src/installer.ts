import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	type ExtensionAPI,
	formatSize,
	type TruncationResult,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	getWikiReferences,
	lintWiki,
	type WikiFinding,
	type WikiLintResult,
	type WikiReferencesResult,
} from "./graph.js";
import { appendWikiSystemPrompt } from "./system-prompt.js";

export const WIKI_LINT_TOOL_NAME = "wiki_lint";
export const WIKI_REFERENCES_TOOL_NAME = "wiki_references";
export const WIKI_TOOL_NAMES = [WIKI_LINT_TOOL_NAME, WIKI_REFERENCES_TOOL_NAME] as const;

interface WikiToolDetails {
	status: "passed" | "findings" | "references";
	pageCount?: number;
	linkCount?: number;
	findingCount?: number;
	nodeCount?: number;
	edgeCount?: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

function formatFinding(finding: WikiFinding): string {
	switch (finding.kind) {
		case "duplicate-slug":
			return `- duplicate slug ${JSON.stringify(finding.slug)}: ${finding.paths?.join(", ") ?? "unknown pages"}`;
		case "ambiguous-link":
			return `- ${finding.path}:${finding.line}:${finding.column} ambiguous ${finding.raw}: ${finding.paths?.join(", ") ?? "unknown pages"}`;
		case "unresolved-link":
			return `- ${finding.path}:${finding.line}:${finding.column} unresolved ${finding.raw}`;
		case "missing-heading":
			return `- ${finding.path}:${finding.line}:${finding.column} missing heading ${JSON.stringify(finding.fragment ?? "")} in ${finding.paths?.[0] ?? finding.target}`;
		case "unsafe-path":
			return `- unsafe path ${finding.path}: symlinks are not followed`;
	}
}

function formatLint(result: WikiLintResult): string {
	const summary = `${result.pageCount} Markdown page${result.pageCount === 1 ? "" : "s"}, ${result.linkCount} Obsidian page link${result.linkCount === 1 ? "" : "s"}`;
	if (result.ok) return `Wiki lint passed: ${summary}.`;
	return [
		`Wiki lint found ${result.findings.length} issue${result.findings.length === 1 ? "" : "s"}: ${summary}.`,
		...result.findings.map(formatFinding),
	].join("\n");
}

function formatReferences(result: WikiReferencesResult): string {
	const lines = [
		`Wiki references for ${result.target.path} (${result.direction}, depth ${result.depth}):`,
		`Nodes (${result.nodes.length}):`,
		...result.nodes.map((node) => `- distance ${node.distance}: ${node.path} (slug ${JSON.stringify(node.slug)})`),
		`Edges (${result.edges.length}):`,
	];
	if (result.edges.length === 0) lines.push("- none");
	else {
		lines.push(...result.edges.map((edge) => `- ${edge.from}:${edge.line}:${edge.column} ${edge.raw} -> ${edge.to}`));
	}
	return lines.join("\n");
}

async function boundedOutput(
	fullOutput: string,
	fileName: string,
): Promise<{ text: string; truncation?: TruncationResult; fullOutputPath?: string }> {
	const truncation = truncateHead(fullOutput, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (!truncation.truncated) return { text: fullOutput };

	const directory = await mkdtemp(join(tmpdir(), "apple-pi-wiki-"));
	const fullOutputPath = join(directory, fileName);
	await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, fullOutput, "utf8"));
	const text = `${truncation.content}\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
	return { text, truncation, fullOutputPath };
}

function createWikiLintTool() {
	return defineTool({
		name: WIKI_LINT_TOOL_NAME,
		label: "Lint wiki",
		description: `Read-only validation of the project .wiki Obsidian page graph. Reports duplicate case-insensitive filename-stem slugs, unresolved or ambiguous page links, missing headings, and unsafe symlinks with source evidence. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full output is saved to a temp file when truncated.`,
		promptSnippet: "Lint the project .wiki Obsidian page graph without changing files",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			const result = await lintWiki(ctx.cwd);
			signal?.throwIfAborted();
			const output = await boundedOutput(formatLint(result), "wiki-lint.txt");
			const details: WikiToolDetails = {
				status: result.ok ? "passed" : "findings",
				pageCount: result.pageCount,
				linkCount: result.linkCount,
				findingCount: result.findings.length,
				truncation: output.truncation,
				fullOutputPath: output.fullOutputPath,
			};
			return { content: [{ type: "text" as const, text: output.text }], details };
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("Lint wiki")), 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Linting wiki..."), 0, 0);
			const details = result.details as WikiToolDetails | undefined;
			if (!details) return new Text(theme.fg("dim", "No wiki lint result"), 0, 0);
			const count = details.findingCount ?? 0;
			const text =
				count === 0
					? theme.fg("success", "Wiki links valid")
					: theme.fg("warning", `${count} wiki issue${count === 1 ? "" : "s"}`);
			return new Text(details.truncation?.truncated ? `${text} ${theme.fg("warning", "(truncated)")}` : text, 0, 0);
		},
	});
}

function createWikiReferencesTool() {
	return defineTool({
		name: WIKI_REFERENCES_TOOL_NAME,
		label: "Wiki references",
		description: `Resolve a project .wiki Markdown page by case-insensitive filename-stem slug or .wiki-relative path, then return its directed inbound, outbound, or bidirectional page-link neighborhood to depth 1 or 2. Read-only. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full output is saved to a temp file when truncated.`,
		promptSnippet: "Retrieve inbound, outbound, or nearby references for a project wiki page",
		parameters: Type.Object({
			target: Type.String({
				description: "Page slug or Markdown path relative to .wiki (a .wiki/... path is also accepted).",
			}),
			direction: Type.Optional(
				StringEnum(["inbound", "outbound", "both"] as const, {
					description: "Graph direction to traverse. Defaults to both.",
				}),
			),
			depth: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 2, description: "Traversal degree, 1 or 2. Defaults to 1." }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			const depth = params.depth ?? 1;
			if (depth !== 1 && depth !== 2) throw new Error("wiki_references depth must be 1 or 2");
			const result = await getWikiReferences(ctx.cwd, params.target, params.direction ?? "both", depth);
			signal?.throwIfAborted();
			const output = await boundedOutput(formatReferences(result), "wiki-references.txt");
			const details: WikiToolDetails = {
				status: "references",
				nodeCount: result.nodes.length,
				edgeCount: result.edges.length,
				truncation: output.truncation,
				fullOutputPath: output.fullOutputPath,
			};
			return { content: [{ type: "text" as const, text: output.text }], details };
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Wiki references "))}${theme.fg("accent", args.target)}`,
				0,
				0,
			);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Reading wiki graph..."), 0, 0);
			const details = result.details as WikiToolDetails | undefined;
			if (!details) return new Text(theme.fg("dim", "No wiki reference result"), 0, 0);
			const text = theme.fg(
				"success",
				`${details.nodeCount ?? 0} page${details.nodeCount === 1 ? "" : "s"}, ${details.edgeCount ?? 0} link${details.edgeCount === 1 ? "" : "s"}`,
			);
			return new Text(details.truncation?.truncated ? `${text} ${theme.fg("warning", "(truncated)")}` : text, 0, 0);
		},
	});
}

export function installWiki(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => ({ systemPrompt: appendWikiSystemPrompt(event.systemPrompt ?? "") }));
	pi.registerTool(createWikiLintTool());
	pi.registerTool(createWikiReferencesTool());
}

export default installWiki;
