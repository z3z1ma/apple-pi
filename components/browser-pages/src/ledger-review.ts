import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { type Static, Type } from "typebox";

import { highlightLines } from "./highlight.js";
import {
	annotationLines,
	blocksOf,
	isObject,
	isVerdict,
	linesOf,
	markdownPassage,
	optionalString,
	parseAnnotation,
	parseSpans,
	REWRITES_HEADING,
	repositoryRoot,
	rewriteLines,
	withDiagrams,
} from "./markdown-review.js";
import type { LedgerAnnotation, LedgerResult, LedgerReviewPage, TextSpan } from "./page-data.js";
import { readTemplate } from "./saved-page.js";
import { parseTickets, ticketNumber } from "./tickets.js";

export const REVIEW_LEDGER_TASK_TOOL_NAME = "review_ledger_task";

export const ReviewLedgerTaskParamsSchema = Type.Object({
	cwd: Type.Optional(
		Type.String({
			description:
				"Target working directory (repository or worktree for git pages). Absolute or relative to the session working directory; defaults to the session working directory.",
		}),
	),
	task: Type.String({
		description: "The ledger task to review: its id, `.ledger/<id>`, or any path inside the bundle",
	}),
	note: Type.Optional(
		Type.String({ description: "One sentence shown above the task: what you need from the reviewer" }),
	),
});

export type ReviewLedgerTaskParams = Static<typeof ReviewLedgerTaskParamsSchema>;

/** The bundle directory `task` names: the directory directly under `.ledger/` or `.ledger/history/` that holds it. */
async function bundleDir(task: string, cwd: string, root: string): Promise<string> {
	let ledger: string;
	try {
		ledger = await realpath(join(root, ".ledger"));
	} catch {
		throw new Error(`There is no .ledger directory in ${root}.`);
	}
	const history = join(ledger, "history");
	for (const candidate of [isAbsolute(task) ? task : resolve(cwd, task), join(ledger, task), join(history, task)]) {
		let path: string;
		try {
			path = await realpath(candidate);
		} catch {
			continue;
		}
		for (let dir = path; dir !== dirname(dir); dir = dirname(dir)) {
			const parent = dirname(dir);
			const bundle = (parent === ledger && dir !== history) || parent === history;
			if (bundle && (await stat(dir)).isDirectory()) return dir;
		}
	}
	throw new Error(`No ledger task "${task}" in ${ledger}.`);
}

async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...(await filesUnder(dir, path)));
		else if (entry.isFile()) out.push(path);
	}
	return out;
}

/** Reading order: the task, its spec or plan, other documents, tickets, the retrospective, then everything in folders. */
function rank(path: string): number {
	if (path === "task.md") return 0;
	if (path === "spec.md" || path === "plan.md") return 1;
	if (path === "retrospective.md") return 4;
	if (ticketNumber(path) !== undefined) return 3;
	return path.includes("/") ? 5 : 2;
}
const byReadingOrder = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true });

export async function buildLedgerPage(
	params: ReviewLedgerTaskParams,
	cwd: string,
	token: string,
): Promise<{ page: LedgerReviewPage; root: string; dir: string }> {
	cwd = resolve(cwd, params.cwd ?? ".");
	const root = (await repositoryRoot(cwd)) ?? (await realpath(cwd));
	const dir = await bundleDir(params.task, cwd, root);
	const paths = (await filesUnder(dir)).sort(byReadingOrder);
	const sources = await Promise.all(
		paths
			.filter((p) => p.endsWith(".md"))
			.map(async (path) => ({ path, source: await readFile(join(dir, path), "utf8") })),
	);
	const task = sources.find((f) => f.path === "task.md")?.source ?? "";
	const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(task)?.[1].trim();
	return {
		page: {
			kind: "ledger-review",
			title: /^#\s+(.+)$/m.exec(task)?.[1].trim() ?? basename(dir),
			path: relative(root, dir),
			status: field("Status"),
			created: field("Created"),
			updated: field("Updated"),
			note: params.note?.trim() || undefined,
			createdAt: new Date().toISOString(),
			documents: await Promise.all(sources.map(async (f) => ({ path: f.path, blocks: await blocksOf(f.source) }))),
			evidence: await Promise.all(
				paths
					.filter((p) => !p.endsWith(".md"))
					.map(async (path) => ({ path, bytes: (await stat(join(dir, path))).size })),
			),
			tickets: parseTickets(sources),
			session: { token, live: true, ask: false },
		},
		root,
		dir,
	};
}

export async function ledgerTemplate(page: LedgerReviewPage): Promise<string> {
	return withDiagrams(
		await readTemplate("ledger-review"),
		page.documents.flatMap((d) => d.blocks),
	);
}

/**
 * The lines of an evidence file the page lists, highlighted. They stay on the page, so the saved copy shows every
 * file the reviewer opened. Paths come only from the page's own list, so the page cannot read outside the bundle.
 */
export async function serveEvidence(page: LedgerReviewPage, dir: string, path: string) {
	const file = page.evidence.find((e) => e.path === path);
	if (!file) return undefined;
	if (!file.lines && !file.binary) {
		const buffer = await readFile(join(dir, path));
		if (buffer.includes(0)) file.binary = true;
		else file.lines = await highlightLines(buffer.toString("utf8").replace(/\r?\n$/, ""), path);
	}
	return { lines: file.lines, binary: file.binary };
}

// ---------------------------------------------------------------------------- what the page sends back

/** Accepts the blocks of `file`: a document's Markdown blocks, or `l<N>` lines of an evidence file already served. */
function blocksIn(page: LedgerReviewPage, file: unknown): ((block: string) => boolean) | undefined {
	const doc = page.documents.find((d) => d.path === file);
	if (doc) return (id) => doc.blocks.some((b) => b.id === id);
	const lines = page.evidence.find((e) => e.path === file)?.lines;
	if (!lines) return undefined;
	return (id) => {
		const n = Number(/^l(\d+)$/.exec(id)?.[1]);
		return n >= 1 && n <= lines.length;
	};
}

/** A question about a passage in one of the page's files, or undefined. */
export function parseLedgerQuestion(body: unknown, page: LedgerReviewPage) {
	if (!isObject(body) || typeof body.question !== "string" || !body.question.trim()) return undefined;
	const hasBlock = blocksIn(page, body.file);
	const spans = hasBlock && parseSpans(body.spans, hasBlock);
	if (!spans || !optionalString(body.quote)) return undefined;
	return { file: body.file as string, spans, quote: body.quote?.trim() || undefined, question: body.question.trim() };
}

/** Validates the page's submission against the page it was served. Anything malformed is rejected whole. */
export function parseLedgerResult(body: unknown, page: LedgerReviewPage): LedgerResult | undefined {
	if (!isObject(body) || !isVerdict(body.verdict) || !optionalString(body.overall)) return undefined;
	if (!Array.isArray(body.annotations) || !Array.isArray(body.edits) || !Array.isArray(body.opened)) return undefined;
	const annotations: LedgerAnnotation[] = [];
	for (const a of body.annotations) {
		const hasBlock = isObject(a) ? blocksIn(page, a.file) : undefined;
		const annotation = hasBlock && parseAnnotation(a, hasBlock);
		if (!annotation) return undefined;
		annotations.push({ ...annotation, file: (a as { file: string }).file });
	}
	const edits: LedgerResult["edits"] = [];
	for (const e of body.edits) {
		const doc = isObject(e) ? page.documents.find((d) => d.path === e.file) : undefined;
		if (!doc || typeof e.after !== "string" || !doc.blocks.some((b) => b.id === e.block)) return undefined;
		edits.push({ file: doc.path, block: e.block as string, after: e.after });
	}
	const known = new Set([...page.documents.map((d) => d.path), ...page.evidence.map((e) => e.path)]);
	if (!body.opened.every((p) => typeof p === "string" && known.has(p))) return undefined;
	return {
		verdict: body.verdict,
		overall: body.overall?.trim() || undefined,
		annotations,
		edits,
		opened: [...new Set(body.opened as string[])],
		submittedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------- text for the model

/** `path:lines` of a passage, with the path as the repository names it. */
function where(page: LedgerReviewPage, file: string, spans: TextSpan[]): string {
	const path = `${page.path}/${file}`;
	const doc = page.documents.find((d) => d.path === file);
	if (doc) return linesOf(path, doc.blocks, spans);
	const lines = spans.map((s) => Number(s.block.slice(1)));
	const from = Math.min(...lines);
	const to = Math.max(...lines);
	return `${path}:${from}${to > from ? `-${to}` : ""}`;
}

/** The passage a question is about, for the read-only fork's prompt. */
export function ledgerPassage(page: LedgerReviewPage, file: string, spans: TextSpan[], quote: string | undefined) {
	const doc = page.documents.find((d) => d.path === file);
	if (doc) return markdownPassage(`${page.path}/${file}`, doc.blocks, spans, quote);
	const lines = page.evidence.find((e) => e.path === file)?.lines ?? [];
	const text = spans.map((s) => lines[Number(s.block.slice(1)) - 1]?.map((seg) => seg.t).join("") ?? "");
	return { where: where(page, file, spans), excerpt: quote ?? text.join("\n") };
}

const VERDICT_TEXT: Record<LedgerResult["verdict"], string> = {
	approve: "approved the task",
	approve_notes: "approved the task with notes: apply the annotations",
	changes: "requested changes: revise the bundle, then ask for review again",
	dismissed: "closed the review without a verdict",
};

export function formatLedgerResult(page: LedgerReviewPage, result: LedgerResult, savedPath?: string): string {
	const out = [`The reviewer ${VERDICT_TEXT[result.verdict]} (${page.path}).`];
	if (result.overall) out.push("", `Overall: ${result.overall}`);
	if (result.annotations.length > 0) {
		out.push("", `Annotations (${result.annotations.length}), each with the passage it marks:`);
		for (const a of result.annotations) out.push(...annotationLines(a, where(page, a.file, a.spans)));
	}
	if (result.edits.length > 0) {
		out.push("", REWRITES_HEADING);
		for (const edit of result.edits) {
			const block = page.documents.find((d) => d.path === edit.file)!.blocks.find((b) => b.id === edit.block)!;
			out.push(...rewriteLines(where(page, edit.file, [{ block: block.id }]), block.raw, edit.after));
		}
	}
	const unopened = page.documents.filter((d) => !result.opened.includes(d.path)).map((d) => d.path);
	if (unopened.length > 0 && result.verdict !== "dismissed")
		out.push("", `The reviewer did not open: ${unopened.join(", ")}.`);
	if (savedPath) out.push("", `Saved page: ${savedPath}`);
	return out.join("\n");
}
