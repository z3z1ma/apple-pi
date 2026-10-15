import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { marked } from "marked";
import { type Static, Type } from "typebox";

import { highlightLines } from "./highlight.js";
import type {
	MarkdownAnnotation,
	MarkdownBlock,
	MarkdownLabel,
	MarkdownResult,
	MarkdownReviewPage,
	TextSpan,
} from "./page-data.js";

const run = promisify(execFile);

export const REVIEW_MARKDOWN_TOOL_NAME = "review_markdown";

export const ReviewMarkdownParamsSchema = Type.Object({
	path: Type.String({ description: "The Markdown file to review, relative to the working directory" }),
	note: Type.Optional(
		Type.String({ description: "One sentence shown above the document: what you need from the reviewer" }),
	),
});

export type ReviewMarkdownParams = Static<typeof ReviewMarkdownParamsSchema>;

async function repositoryRoot(dir: string): Promise<string | undefined> {
	try {
		return (await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir })).stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** Splits the file into top-level blocks with source lines; code fences come highlighted. */
async function blocksOf(source: string): Promise<MarkdownBlock[]> {
	const blocks: MarkdownBlock[] = [];
	let line = 1;
	for (const token of marked.lexer(source)) {
		const start = line;
		line += (token.raw.match(/\n/g) ?? []).length;
		if (token.type === "space") continue;
		const raw = token.raw.replace(/\n+$/, "");
		const block: MarkdownBlock = {
			id: `b${blocks.length + 1}`,
			raw,
			line: start,
			endLine: start + (raw.match(/\n/g) ?? []).length,
		};
		if (token.type === "heading") block.heading = { depth: token.depth, text: token.text };
		if (token.type === "code") {
			const lang = (token.lang ?? "").trim().split(/\s/)[0].toLowerCase();
			if (lang === "mermaid") block.mermaid = true;
			else block.code = { lang, lines: await highlightLines(token.text, `fence.${lang || "txt"}`) };
		}
		blocks.push(block);
	}
	return blocks;
}

export async function buildMarkdownPage(
	params: ReviewMarkdownParams,
	cwd: string,
	token: string,
): Promise<{ page: MarkdownReviewPage; root: string }> {
	// Git reports the real path of the repository, so compare it with the real path of the file.
	const file = await realpath(isAbsolute(params.path) ? params.path : resolve(cwd, params.path));
	const source = await readFile(file, "utf8");
	const root = (await repositoryRoot(dirname(file))) ?? (await realpath(cwd));
	const inRoot = relative(root, file);
	const blocks = await blocksOf(source);
	return {
		page: {
			kind: "markdown-review",
			title: blocks.find((b) => b.heading?.depth === 1)?.heading?.text ?? basename(file),
			path: inRoot && !inRoot.startsWith("..") ? inRoot : file,
			note: params.note?.trim() || undefined,
			createdAt: new Date().toISOString(),
			blocks,
			session: { token, live: true, ask: false },
		},
		root,
	};
}

// ---------------------------------------------------------------------------- what the page sends back

const TYPES = new Set(["comment", "delete", "suggest", "label", "ask"]);
const LABELS = new Set(["good", "clarify"]);
const VERDICTS = new Set(["approve", "approve_notes", "changes", "dismissed"]);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const optionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

function parseSpans(value: unknown, page: MarkdownReviewPage): TextSpan[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const spans: TextSpan[] = [];
	for (const span of value) {
		if (!isObject(span) || !page.blocks.some((b) => b.id === span.block)) return undefined;
		const whole = span.start === undefined && span.end === undefined;
		const start = span.start as number;
		const end = span.end as number;
		// Offsets index the text the page rendered, which can be longer than the source (a table's rows and cells each
		// add a newline), so only their shape is checked. They place highlights in the page; the model gets lines and quotes.
		const range = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start;
		if (!whole && !range) return undefined;
		spans.push(whole ? { block: span.block as string } : { block: span.block as string, start, end });
	}
	return spans;
}

/** A question about a passage the page shows, or undefined. */
export function parseMarkdownQuestion(body: unknown, page: MarkdownReviewPage) {
	if (!isObject(body) || typeof body.question !== "string" || !body.question.trim()) return undefined;
	const spans = parseSpans(body.spans, page);
	if (!spans || !optionalString(body.quote)) return undefined;
	return { spans, quote: body.quote?.trim() || undefined, question: body.question.trim() };
}

/** Validates the page's submission against the page it was served. Anything malformed is rejected whole. */
export function parseMarkdownResult(body: unknown, page: MarkdownReviewPage): MarkdownResult | undefined {
	if (!isObject(body) || !VERDICTS.has(body.verdict as string) || !optionalString(body.overall)) return undefined;
	if (!Array.isArray(body.annotations) || !Array.isArray(body.edits)) return undefined;
	const annotations: MarkdownAnnotation[] = [];
	for (const a of body.annotations) {
		if (!isObject(a) || !TYPES.has(a.type as string)) return undefined;
		const spans = parseSpans(a.spans, page);
		if (!spans || !optionalString(a.quote) || !optionalString(a.text) || !optionalString(a.answer)) return undefined;
		if (a.type === "suggest" && typeof a.replacement !== "string") return undefined;
		if (a.type === "label" && !LABELS.has(a.label as string)) return undefined;
		annotations.push({
			type: a.type as MarkdownAnnotation["type"],
			spans,
			quote: a.quote?.trim() || undefined,
			text: a.text?.trim() || undefined,
			replacement: a.type === "suggest" ? (a.replacement as string) : undefined,
			label: a.type === "label" ? (a.label as MarkdownLabel) : undefined,
			answer: a.type === "ask" ? a.answer : undefined,
		});
	}
	const edits: MarkdownResult["edits"] = [];
	for (const e of body.edits) {
		if (!isObject(e) || typeof e.after !== "string" || !page.blocks.some((b) => b.id === e.block)) return undefined;
		edits.push({ block: e.block as string, after: e.after });
	}
	return {
		verdict: body.verdict as MarkdownResult["verdict"],
		overall: body.overall?.trim() || undefined,
		annotations,
		edits,
		submittedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------- text for the model

/** `path:30` or `path:30-34` for the blocks a set of spans touches. */
export function linesOf(page: MarkdownReviewPage, spans: TextSpan[]): string {
	const blocks = page.blocks.filter((b) => spans.some((s) => s.block === b.id));
	const from = Math.min(...blocks.map((b) => b.line));
	const to = Math.max(...blocks.map((b) => b.endLine));
	return `${page.path}:${from}${to > from ? `-${to}` : ""}`;
}

/** The passage a question is about, for the read-only fork's prompt. */
export function markdownPassage(page: MarkdownReviewPage, spans: TextSpan[], quote: string | undefined) {
	const whole = page.blocks.filter((b) => spans.some((s) => s.block === b.id)).map((b) => b.raw);
	return { where: linesOf(page, spans), excerpt: quote ?? whole.join("\n\n") };
}

const VERDICT_TEXT: Record<MarkdownResult["verdict"], string> = {
	approve: "approved the document",
	approve_notes: "approved the document with notes: apply the annotations",
	changes: "requested changes: revise the document, then ask for review again",
	dismissed: "closed the review without a verdict",
};
const LABEL_TEXT: Record<MarkdownLabel, string> = { good: "👍 looks good", clarify: "❓ clarify this" };
const quoted = (text: string | undefined) => (text ? ` “${text.replace(/\s*\n\s*/g, " / ")}”` : "");

export function formatMarkdownResult(page: MarkdownReviewPage, result: MarkdownResult, savedPath?: string): string {
	const out = [`The reviewer ${VERDICT_TEXT[result.verdict]} (${page.path}).`];
	if (result.overall) out.push("", `Overall: ${result.overall}`);
	if (result.annotations.length > 0) {
		out.push("", `Annotations (${result.annotations.length}), each with the passage it marks:`);
		for (const a of result.annotations) {
			const where = linesOf(page, a.spans);
			const whole = a.spans.every((s) => s.start === undefined);
			if (a.type === "comment")
				out.push(`- comment · ${where}${whole ? " (whole block)" : quoted(a.quote)}: ${a.text ?? ""}`);
			else if (a.type === "delete") out.push(`- delete · ${where}${quoted(a.quote)}`);
			else if (a.type === "suggest")
				out.push(`- replace · ${where}${quoted(a.quote)} with “${a.replacement}”${a.text ? ` (${a.text})` : ""}`);
			else if (a.type === "label") out.push(`- ${LABEL_TEXT[a.label ?? "good"]} · ${where}${quoted(a.quote)}`);
			else {
				out.push(`- asked · ${where}${quoted(a.quote)}: ${a.text ?? ""}`);
				if (a.answer) out.push(...a.answer.split("\n").map((line) => `  > ${line}`));
			}
		}
	}
	if (result.edits.length > 0) {
		out.push("", "Blocks the reviewer rewrote in the page (the file is unchanged; apply these or say why not):");
		for (const edit of result.edits) {
			const block = page.blocks.find((b) => b.id === edit.block)!;
			out.push(
				`- ${linesOf(page, [{ block: block.id }])}`,
				"  before:",
				...block.raw.split("\n").map((l) => `  | ${l}`),
				"  after:",
				...edit.after.split("\n").map((l) => `  | ${l}`),
			);
		}
	}
	if (savedPath) out.push("", `Saved page: ${savedPath}`);
	return out.join("\n");
}
