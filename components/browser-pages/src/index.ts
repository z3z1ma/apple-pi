import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { liveSession, trackLiveSessions } from "../../shared/src/forked-continuation.js";
import { askAgent, type Passage } from "./ask-agent.js";
import {
	buildCodeReviewPage,
	formatReviewResult,
	parseQuestion,
	parseReviewResult,
	questionPassage,
	REVIEW_CODE_TOOL_NAME,
	ReviewCodeParamsSchema,
	type ReviewCodeParams,
} from "./code-review.js";
import {
	buildMarkdownPage,
	formatMarkdownResult,
	markdownPassage,
	parseMarkdownQuestion,
	parseMarkdownResult,
	REVIEW_MARKDOWN_TOOL_NAME,
	ReviewMarkdownParamsSchema,
	type ReviewMarkdownParams,
} from "./markdown-review.js";
import type { PageData } from "./page-data.js";
import { openPageSession } from "./page-server.js";
import { embedPage, readTemplate, savePage } from "./saved-page.js";

function openInBrowser(url: string): void {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
	execFile(command, [url], () => {});
}

const text = (value: string) => [{ type: "text" as const, text: value }];
const NO_USER = "No user is attached to this run, so no review page was opened.";

interface PageRun<P extends PageData, R extends { verdict: string }> {
	page: P;
	root: string;
	parse: (body: unknown) => R | undefined;
	/** The passage and question a page asks about, or undefined for a malformed question. */
	question: (body: unknown) => { passage: Passage; question: string } | undefined;
	format: (result: R, saved: string) => string;
}

export default function browserPages(pi: ExtensionAPI): void {
	const sessions = new Set<() => void>();
	trackLiveSessions();

	/** Serves one page until the reviewer submits, saves it with the result, and returns the text for the model. */
	async function review<P extends PageData, R extends { verdict: string }>(
		run: PageRun<P, R>,
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		onUpdate: ((update: { content: ReturnType<typeof text>; details: undefined }) => void) | undefined,
	) {
		const { page } = run;
		const template = await readTemplate(page.kind);
		page.session.ask = !!liveSession(ctx);
		const session = await openPageSession(embedPage(template, page), page.session.token, run.parse, {
			signal,
			ask: async (body, stop) => {
				const asked = run.question(body);
				return asked && askAgent(ctx, asked.passage, asked.question, stop);
			},
		});
		sessions.add(session.close);
		onUpdate?.({ content: text(`Waiting for the review at ${session.url}`), details: undefined });
		openInBrowser(session.url);
		try {
			const result = await session.result;
			const saved = await savePage(
				embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }),
				run.root,
				page.title,
			);
			return { content: text(run.format(result, saved)), details: { verdict: result.verdict, saved } };
		} finally {
			session.close();
			sessions.delete(session.close);
		}
	}

	pi.registerTool({
		name: REVIEW_CODE_TOOL_NAME,
		label: "Review code",
		description:
			'Open a code review page in the user\'s browser and wait for their verdict. You supply the structure: chapters in the order you reasoned, a brief for each, the diff pieces by file and line range, notes on lines, and real judgment calls. The page shows the real diff from git, so you cannot hide or invent code: any hunk you do not place appears under "Not in the story". Returns the verdict, line-anchored comments, decision answers, and which hunks were seen.',
		promptSnippet: "Open a structured code review of your change in the user's browser and get line-anchored feedback",
		promptGuidelines: [
			"Use review_code when the user asks to review your work or when a finished change deserves their review before you continue. It blocks until they submit, so call it at a natural stopping point.",
			"Tell the change as a story: core chapters first, consequences next, tests and docs last. Give every change a one-sentence summary and set attention to where a mistake would hurt.",
			"When one change repeats across many places, list them under one change with `places`; the page shows one example and flags any place that is more than a rename.",
			"Use notes for what the code cannot show. Add decisions only for real judgment calls the user may want to override.",
		],
		parameters: ReviewCodeParamsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI) return { content: text(NO_USER), details: undefined };
			const { page, root } = await buildCodeReviewPage(
				params as ReviewCodeParams,
				ctx.cwd,
				randomBytes(24).toString("hex"),
			);
			return review(
				{
					page,
					root,
					parse: (body) => parseReviewResult(body, page),
					question: (body) => {
						const q = parseQuestion(body, page);
						return q && { passage: questionPassage(page, q), question: q.question };
					},
					format: (result, saved) => formatReviewResult(page, result, saved),
				},
				ctx,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: REVIEW_MARKDOWN_TOOL_NAME,
		label: "Review Markdown",
		description:
			"Open a Markdown file in the user's browser for review and wait for their verdict. The page renders the document (outline, code, tables, Mermaid diagrams); the user annotates passages by selecting them: comments, deletions, suggested rewrites, labels, questions, and rewritten blocks. Returns the verdict and each annotation with its source lines and quoted text. The file is never changed by the page.",
		promptSnippet: "Open a Markdown document in the user's browser for passage-level review and sign-off",
		promptGuidelines: [
			"Use review_markdown when a document you wrote or revised, such as a spec, plan, or README, needs the user's sign-off or feedback before you continue. It blocks until they submit.",
			"Pass `note` only when one sentence of context helps, such as what changed since their last review or what you need decided.",
			"Apply the returned annotations to the file yourself; suggested rewrites and rewritten blocks are feedback, not edits already made.",
		],
		parameters: ReviewMarkdownParamsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI) return { content: text(NO_USER), details: undefined };
			const { page, root } = await buildMarkdownPage(
				params as ReviewMarkdownParams,
				ctx.cwd,
				randomBytes(24).toString("hex"),
			);
			return review(
				{
					page,
					root,
					parse: (body) => parseMarkdownResult(body, page),
					question: (body) => {
						const q = parseMarkdownQuestion(body, page);
						return q && { passage: markdownPassage(page, q.spans, q.quote), question: q.question };
					},
					format: (result, saved) => formatMarkdownResult(page, result, saved),
				},
				ctx,
				signal,
				onUpdate,
			);
		},
	});

	pi.on("session_shutdown", () => {
		for (const close of sessions) close();
		sessions.clear();
	});
}
