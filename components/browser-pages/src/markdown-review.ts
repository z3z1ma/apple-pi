import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { marked } from "marked";
import { type Static, Type } from "typebox";

import { highlightLines } from "./highlight.js";
import {
	type MarkdownAnnotation,
	type MarkdownBlock,
	type MarkdownLabel,
	type MarkdownResult,
	type MarkdownReviewPage,
	PAGE_DATA_MARKER,
	type TextSpan,
} from "./page-data.js";
import { readTemplate } from "./saved-page.js";

const run = promisify(execFile);

export const SIGN_OFF_DOCUMENT_TOOL_NAME = "sign_off_document";

export const ReviewMarkdownParamsSchema = Type.Object({
	cwd: Type.Optional(
		Type.String({
			description:
				"Target working directory (repository or worktree for git pages). Absolute or relative to the session working directory; defaults to the session working directory.",
		}),
	),
	path: Type.String({ description: "The Markdown file to review, relative to the working directory" }),
	note: Type.Optional(
		Type.String({ description: "One sentence shown above the document: what you need from the reviewer" }),
	),
});

export type ReviewMarkdownParams = Static<typeof ReviewMarkdownParamsSchema>;

export async function repositoryRoot(dir: string): Promise<string | undefined> {
	try {
		return (await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir })).stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** Splits the file into top-level blocks with source lines; code fences come highlighted. */
export async function blocksOf(source: string): Promise<MarkdownBlock[]> {
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
	cwd = resolve(cwd, params.cwd ?? ".");
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

const MERMAID = fileURLToPath(new URL("../dist/mermaid.min.js", import.meta.url));

/** A page app, with Mermaid inlined only when its documents have a diagram: Mermaid is most of a page's weight. */
export async function withDiagrams(template: string, blocks: MarkdownBlock[]): Promise<string> {
	if (!blocks.some((b) => b.mermaid)) return template;
	// A classic script runs before the app's module script and sets `globalThis.mermaid`.
	const mermaid = (await readFile(MERMAID, "utf8")).replace(/<\/script/gi, "<\\/script");
	return template.replace(PAGE_DATA_MARKER, () => `<script>${mermaid}</script>${PAGE_DATA_MARKER}`);
}

export async function markdownTemplate(page: MarkdownReviewPage): Promise<string> {
	return withDiagrams(await readTemplate("markdown-review"), page.blocks);
}

// ---------------------------------------------------------------------------- what the page sends back

const TYPES = new Set(["comment", "delete", "suggest", "label", "ask"]);
const LABELS = new Set(["good", "clarify"]);
const VERDICTS = new Set(["approve", "approve_notes", "changes", "dismissed"]);
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
export const optionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
export const isVerdict = (v: unknown): v is MarkdownResult["verdict"] => VERDICTS.has(v as string);
const hasBlockIn = (blocks: MarkdownBlock[]) => (id: string) => blocks.some((b) => b.id === id);

/** The spans of an annotation or question, each on a block `hasBlock` accepts, or undefined. */
export function parseSpans(value: unknown, hasBlock: (block: string) => boolean): TextSpan[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const spans: TextSpan[] = [];
	for (const span of value) {
		if (!isObject(span) || typeof span.block !== "string" || !hasBlock(span.block)) return undefined;
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
	const spans = parseSpans(body.spans, hasBlockIn(page.blocks));
	if (!spans || !optionalString(body.quote)) return undefined;
	return { spans, quote: body.quote?.trim() || undefined, question: body.question.trim() };
}

/** One annotation the page sent, on blocks `hasBlock` accepts, or undefined when anything in it is malformed. */
export function parseAnnotation(a: unknown, hasBlock: (block: string) => boolean): MarkdownAnnotation | undefined {
	if (!isObject(a) || !TYPES.has(a.type as string)) return undefined;
	const spans = parseSpans(a.spans, hasBlock);
	if (!spans || !optionalString(a.quote) || !optionalString(a.text) || !optionalString(a.answer)) return undefined;
	if (a.type === "suggest" && typeof a.replacement !== "string") return undefined;
	if (a.type === "label" && !LABELS.has(a.label as string)) return undefined;
	return {
		type: a.type as MarkdownAnnotation["type"],
		spans,
		quote: a.quote?.trim() || undefined,
		text: a.text?.trim() || undefined,
		replacement: a.type === "suggest" ? (a.replacement as string) : undefined,
		label: a.type === "label" ? (a.label as MarkdownLabel) : undefined,
		answer: a.type === "ask" ? a.answer : undefined,
	};
}

/** Validates the page's submission against the page it was served. Anything malformed is rejected whole. */
export function parseMarkdownResult(body: unknown, page: MarkdownReviewPage): MarkdownResult | undefined {
	if (!isObject(body) || !isVerdict(body.verdict) || !optionalString(body.overall)) return undefined;
	if (!Array.isArray(body.annotations) || !Array.isArray(body.edits)) return undefined;
	const annotations: MarkdownAnnotation[] = [];
	for (const a of body.annotations) {
		const annotation = parseAnnotation(a, hasBlockIn(page.blocks));
		if (!annotation) return undefined;
		annotations.push(annotation);
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
export function linesOf(path: string, blocks: MarkdownBlock[], spans: TextSpan[]): string {
	const touched = blocks.filter((b) => spans.some((s) => s.block === b.id));
	const from = Math.min(...touched.map((b) => b.line));
	const to = Math.max(...touched.map((b) => b.endLine));
	return `${path}:${from}${to > from ? `-${to}` : ""}`;
}

/** The passage a question is about, for the read-only fork's prompt. */
export function markdownPassage(path: string, blocks: MarkdownBlock[], spans: TextSpan[], quote: string | undefined) {
	const whole = blocks.filter((b) => spans.some((s) => s.block === b.id)).map((b) => b.raw);
	return { where: linesOf(path, blocks, spans), excerpt: quote ?? whole.join("\n\n") };
}

const VERDICT_TEXT: Record<MarkdownResult["verdict"], string> = {
	approve: "approved the document",
	approve_notes: "approved the document with notes: apply the annotations",
	changes: "requested changes: revise the document, then ask for review again",
	dismissed: "closed the review without a verdict",
};
const LABEL_TEXT: Record<MarkdownLabel, string> = { good: "👍 looks good", clarify: "❓ clarify this" };
const quoted = (text: string | undefined) => (text ? ` “${text.replace(/\s*\n\s*/g, " / ")}”` : "");

/** One annotation for the model, where `where` is its `path:lines`. */
export function annotationLines(a: MarkdownAnnotation, where: string): string[] {
	const whole = a.spans.every((s) => s.start === undefined);
	if (a.type === "comment")
		return [`- comment · ${where}${whole ? " (whole block)" : quoted(a.quote)}: ${a.text ?? ""}`];
	if (a.type === "delete") return [`- delete · ${where}${quoted(a.quote)}`];
	if (a.type === "suggest")
		return [`- replace · ${where}${quoted(a.quote)} with “${a.replacement}”${a.text ? ` (${a.text})` : ""}`];
	if (a.type === "label") return [`- ${LABEL_TEXT[a.label ?? "good"]} · ${where}${quoted(a.quote)}`];
	const answer = a.answer ? a.answer.split("\n").map((line) => `  > ${line}`) : [];
	return [`- asked · ${where}${quoted(a.quote)}: ${a.text ?? ""}`, ...answer];
}

/** A rewritten block for the model, as before and after. */
export function rewriteLines(where: string, before: string, after: string): string[] {
	return [
		`- ${where}`,
		"  before:",
		...before.split("\n").map((l) => `  | ${l}`),
		"  after:",
		...after.split("\n").map((l) => `  | ${l}`),
	];
}

export const REWRITES_HEADING =
	"Blocks the reviewer rewrote in the page (the file is unchanged; apply these or say why not):";

export function formatMarkdownResult(page: MarkdownReviewPage, result: MarkdownResult, savedPath?: string): string {
	const out = [`The reviewer ${VERDICT_TEXT[result.verdict]} (${page.path}).`];
	if (result.overall) out.push("", `Overall: ${result.overall}`);
	if (result.annotations.length > 0) {
		out.push("", `Annotations (${result.annotations.length}), each with the passage it marks:`);
		for (const a of result.annotations) out.push(...annotationLines(a, linesOf(page.path, page.blocks, a.spans)));
	}
	if (result.edits.length > 0) {
		out.push("", REWRITES_HEADING);
		for (const edit of result.edits) {
			const block = page.blocks.find((b) => b.id === edit.block)!;
			out.push(...rewriteLines(linesOf(page.path, page.blocks, [{ block: block.id }]), block.raw, edit.after));
		}
	}
	if (savedPath) out.push("", `Saved page: ${savedPath}`);
	return out.join("\n");
}
