import { randomBytes } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { liveSession, trackLiveSessions } from "../../shared/src/forked-continuation.js";
import { OPERATOR_PAGE_CHANNEL, type OpenOperatorPage } from "../../shared/src/operator-page-events.js";
import { askAgent, askFork, type Passage } from "./ask-agent.js";
import { buildCapturedReview, capturedChange, submitCapturedReview } from "./captured-review.js";
import {
	buildCodeReviewPage,
	codeReviewTemplate,
	formatReviewResult,
	parseQuestion,
	parseReviewResult,
	questionPassage,
	type ReviewCodeParams,
	ReviewCodeParamsSchema,
	SIGN_OFF_CODE_TOOL_NAME,
} from "./code-review.js";
import {
	buildExplainPage,
	EXPLAIN_CHANGE_TOOL_NAME,
	type ExplainChangeParams,
	ExplainChangeParamsSchema,
	explainTemplate,
	parseTutorTurn,
	readerNote,
	tutorPrompt,
} from "./explain-change.js";
import {
	buildLedgerPage,
	formatLedgerResult,
	ledgerPassage,
	ledgerTemplate,
	parseLedgerQuestion,
	parseLedgerResult,
	type ReviewLedgerTaskParams,
	ReviewLedgerTaskParamsSchema,
	SIGN_OFF_TASK_TOOL_NAME,
	serveEvidence,
} from "./ledger-review.js";
import { publishLivePage, workplaceFocused } from "./live-pages.js";
import {
	buildMarkdownPage,
	formatMarkdownResult,
	markdownPassage,
	markdownTemplate,
	parseMarkdownQuestion,
	parseMarkdownResult,
	type ReviewMarkdownParams,
	ReviewMarkdownParamsSchema,
	SIGN_OFF_DOCUMENT_TOOL_NAME,
} from "./markdown-review.js";
import { openInBrowser } from "./open-browser.js";
import type { PageData } from "./page-data.js";
import { openPageSession } from "./page-server.js";
import { embedPage, savePage } from "./saved-page.js";

const text = (value: string) => [{ type: "text" as const, text: value }];
const NO_USER = "No user is attached to this run, so no review page was opened.";
const IN_WORKPLACE = "Agent Workplace has focus, so the page waits in this session's DM there instead of the browser.";

function present(url: string): string | undefined {
	if (workplaceFocused()) return IN_WORKPLACE;
	openInBrowser(url);
	return undefined;
}

interface PageRun<P extends PageData, R extends { verdict: string }> {
	tool: string;
	toolCallId: string;
	page: P;
	template: string;
	root: string;
	parse: (body: unknown) => R | undefined | Promise<R | undefined>;
	question: (body: unknown) => { passage: Passage; question: string } | undefined;
	format: (result: R, saved: string) => string;
	file?: (path: string) => Promise<unknown | undefined>;
}

export default function browserPages(pi: ExtensionAPI): void {
	const sessions = new Set<() => void>();
	trackLiveSessions();

	async function review<P extends PageData, R extends { verdict: string }>(
		run: PageRun<P, R>,
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		onUpdate: ((update: { content: ReturnType<typeof text>; details: undefined }) => void) | undefined,
	) {
		const { page, template } = run;
		page.session.ask = !!liveSession(ctx);
		const session = await openPageSession(embedPage(template, page), page.session.token, run.parse, {
			signal,
			ask: async (body, stop) => {
				const asked = run.question(body);
				return asked && askAgent(ctx, asked.passage, asked.question, stop, run.root);
			},
			file: run.file,
			health: () => ({ ask: !!liveSession(ctx) }),
		});
		if (signal?.aborted) {
			session.close();
			throw signal.reason ?? new Error("The review was cancelled");
		}
		sessions.add(session.close);
		const unpublish = publishLivePage(ctx.sessionManager.getSessionId(), run.toolCallId, {
			tool: run.tool,
			url: session.url,
		});
		let answered: () => void = () => {};
		const where = present(session.url);
		onUpdate?.({
			content: text(`Waiting for the review at ${session.url}${where ? `\n${where}` : ""}`),
			details: undefined,
		});
		try {
			pi.events.emit(OPERATOR_PAGE_CHANNEL, {
				sessionId: ctx.sessionManager.getSessionId(),
				toolCallId: run.toolCallId,
				title: page.title,
				closed: new Promise<void>((resolve) => (answered = resolve)),
			} satisfies OpenOperatorPage);
			const result = await session.result;
			const saved = await savePage(
				embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }),
				run.root,
				page.title,
			);
			return { content: text(run.format(result, saved)), details: { verdict: result.verdict, saved } };
		} finally {
			answered();
			unpublish();
			session.close();
			sessions.delete(session.close);
		}
	}

	pi.registerTool({
		name: SIGN_OFF_CODE_TOOL_NAME,
		label: "Sign off code",
		description:
			'Open a code review page in the user\'s browser and wait for their verdict. You supply the structure: chapters in the order you reasoned, a brief for each, the diff pieces by file and line range, notes on lines, and real judgment calls. The page shows the real diff from git, so you cannot hide or invent code: any hunk you do not place appears under "Not in the story". With review, it renders that retained artifact and assessment; human submission binds its digest/revision and waits for the runtime to commit the verdict. Changed checkout/policy and review limits remain explicit. Returns the verdict, line-anchored comments, decision answers, and which hunks were seen.',
		promptSnippet: "Open a structured code review of your change in the user's browser and get line-anchored feedback",
		promptGuidelines: [
			"Use sign_off_code when the user asks to review your work or when a finished change deserves their review before you continue. It blocks until they submit, so call it at a natural stopping point.",
			"Pass `cwd` to review another repository or worktree directly from this root session. It may be absolute or relative to the session directory. File references are relative to the target repository root; browser tools run in the root session only.",
			"Pass `target` to choose the change exactly as `review_code` does; omit it for uncommitted work (tracked, staged and untracked) against HEAD. Pass `review` instead to sign off on a captured review's retained source and assessment.",
			"Tell the change as a story: core chapters first, consequences next, tests and docs last. Give every change a one-sentence summary and set attention to where a mistake would hurt.",
			"Put a picture where prose would make the reviewer build one in their head: a `mermaid` fence in a chapter brief for a flow, a sequence, or a state before and after, and a table for cases with their results.",
			"When one change repeats across many places, list them under one change with `places`; the page shows one example and flags any place that is more than a rename.",
			"Use notes for what the code cannot show. Add decisions only for real judgment calls the user may want to override.",
		],
		parameters: ReviewCodeParamsSchema,
		executionMode: "sequential",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI) return { content: text(NO_USER), details: undefined };
			const typed = params as ReviewCodeParams;
			const token = randomBytes(24).toString("hex");
			const { page, root } = typed.review
				? await buildCapturedReview(typed, ctx.sessionManager.getSessionId(), token, signal)
				: await buildCodeReviewPage(typed, ctx.cwd, token, undefined, signal);
			return review(
				{
					tool: SIGN_OFF_CODE_TOOL_NAME,
					toolCallId,
					page,
					template: await codeReviewTemplate(page),
					root,
					parse: (body) => (page.capture ? submitCapturedReview(body, page) : parseReviewResult(body, page)),
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
		name: SIGN_OFF_DOCUMENT_TOOL_NAME,
		label: "Sign off document",
		description:
			"Open a Markdown file in the user's browser for review and wait for their verdict. The page renders the document (outline, code, tables, Mermaid diagrams); the user annotates passages by selecting them: comments, deletions, suggested rewrites, labels, questions, and rewritten blocks. Returns the verdict and each annotation with its source lines and quoted text. The file is never changed by the page.",
		promptSnippet: "Open a Markdown document in the user's browser for passage-level review and sign-off",
		promptGuidelines: [
			"Use sign_off_document when a document you wrote or revised, such as a spec, plan, or README, needs the user's sign-off or feedback before you continue. It blocks until they submit.",
			"Pass `cwd` for a document in another directory; relative `path` is resolved there. An absolute `path` also works from any session directory. Open the page from this root session; browser tools are root-session only.",
			"Pass `note` only when one sentence of context helps, such as what changed since their last review or what you need decided.",
			"Apply the returned annotations to the file yourself; suggested rewrites and rewritten blocks are feedback, not edits already made.",
		],
		parameters: ReviewMarkdownParamsSchema,
		executionMode: "sequential",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI) return { content: text(NO_USER), details: undefined };
			const { page, root } = await buildMarkdownPage(
				params as ReviewMarkdownParams,
				ctx.cwd,
				randomBytes(24).toString("hex"),
			);
			return review(
				{
					tool: SIGN_OFF_DOCUMENT_TOOL_NAME,
					toolCallId,
					page,
					template: await markdownTemplate(page),
					root,
					parse: (body) => parseMarkdownResult(body, page),
					question: (body) => {
						const q = parseMarkdownQuestion(body, page);
						return q && { passage: markdownPassage(page.path, page.blocks, q.spans, q.quote), question: q.question };
					},
					format: (result, saved) => formatMarkdownResult(page, result, saved),
				},
				ctx,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: SIGN_OFF_TASK_TOOL_NAME,
		label: "Sign off task",
		description:
			"Open a ledger task bundle in the user's browser for review and wait for their verdict. The page shows the task's intent, the ticket graph built from each ticket's `Blocked by:` line with graph checks, and every document in the bundle rendered for annotation as in sign_off_document; other files open on demand. Returns the verdict and each annotation with its file, lines, and quoted text, rewritten blocks, and the documents the user did not open. The page never changes the files.",
		promptSnippet:
			"Open a ledger task bundle (task, spec, tickets, evidence) in the user's browser for review and sign-off",
		promptGuidelines: [
			"Use sign_off_task when a ledger task's plan, specification, or tickets need the user's sign-off before implementation, or its outcome needs review before closing. It blocks until they submit.",
			"Pass `cwd` to select another project's ledger directly from this root session. It may be absolute or relative to the session directory; browser tools run in the root session only.",
			"Pass the task id as `task`. Pass `note` only when one sentence helps, such as what changed since their last review or what you need decided.",
			"Apply the returned annotations to the bundle's files yourself; suggested rewrites and rewritten blocks are feedback, not edits already made.",
		],
		parameters: ReviewLedgerTaskParamsSchema,
		executionMode: "sequential",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI) return { content: text(NO_USER), details: undefined };
			const { page, root, dir } = await buildLedgerPage(
				params as ReviewLedgerTaskParams,
				ctx.cwd,
				randomBytes(24).toString("hex"),
			);
			return review(
				{
					tool: SIGN_OFF_TASK_TOOL_NAME,
					toolCallId,
					page,
					template: await ledgerTemplate(page),
					root,
					parse: (body) => parseLedgerResult(body, page),
					question: (body) => {
						const q = parseLedgerQuestion(body, page);
						return q && { passage: ledgerPassage(page, q.file, q.spans, q.quote), question: q.question };
					},
					format: (result, saved) => formatLedgerResult(page, result, saved),
					file: (path) => serveEvidence(page, dir, path),
				},
				ctx,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: EXPLAIN_CHANGE_TOOL_NAME,
		label: "Explain change",
		description:
			"Open an explanation of a code change in the user's browser, so they understand it well enough to build on it. You write it: a one-minute summary, background (with an optional primer for newcomers), the intuition before the details, a walkthrough of steps in a sensible order, and a five-question quiz. Cite code with `code path:FROM-TO` fences: the page shows the real lines from git with diff marks, and lists every changed file the walkthrough skips. Returns at once with the page's address and a saved copy to attach to a pull request or a page. While the session lives, the reader can talk the explanation through with you in a Socratic sidebar; a note on their quiz results and questions arrives with your next turn.",
		promptSnippet:
			"Open a rich explanation of a code change (background, intuition, walkthrough over real code, quiz) in the user's browser",
		promptGuidelines: [
			'Use explain_change when the user asks to understand a change, a commit, a branch, or a pull request, or when you finish a substantial change they need to build on. Pass `target` to choose the change exactly as `review_code` does: omit it for uncommitted work, use `{"kind":"commit","commit":"X"}` for one commit, `branch` for a pull-request view and `range` for exact endpoints. Pass `review` to explain a captured review\'s retained source.',
			"Pass `cwd` to explain another repository or worktree directly from this root session. It may be absolute or relative to the session directory. Code fences use paths relative to the target repository root; browser tools run in the root session only.",
			"Before you write, find why the change exists, not only what it does: read the surrounding code, the ledger task that governs it (intent, decisions, retrospective), its discussion if it happened in this session (`search_session`), the context files and docs for the rules it must keep, the wiki for its terms, and the tests for its behavior. Teach the reasons, the options it rejected, and the rules the next change must respect.",
			"Plan backward: choose the two or three ideas the reader must leave with, write the quiz to test them, then write the explanation that teaches them.",
			"Background teaches what was there before; put the deep context a newcomer needs in `primer`. Intuition states the goal and the idea with a concrete example and toy data before any code: use a `mermaid` fence for flows, and a `figure Caption` fence (self-contained HTML and script, sandboxed, no network) when playing with something builds intuition faster than reading.",
			"Order the steps the way the data flows or the way understanding builds, not by file. Each step is prose around `code path:FROM-TO` fences (empty body; line numbers of the file after the change, or before it for a file the change deletes), short enough to read in one go. Write in classic style: clear, concrete, with smooth transitions.",
			"Write exactly five quiz questions that a reader who skimmed fails and a reader who understood passes: one idea each, preferably a concrete case with toy data; three or four options whose wrong ones are plausible misconceptions of similar length, never jokes, trivia, or 'all of the above'; and a `why` that explains the right answer and names the step that teaches it.",
		],
		parameters: ExplainChangeParamsSchema,
		executionMode: "sequential",
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI)
				return { content: text("No user is attached to this run, so no explanation was opened."), details: undefined };
			const token = randomBytes(24).toString("hex");
			const { page, root, warnings } = await buildExplainPage(
				params as ExplainChangeParams,
				ctx.cwd,
				token,
				(review) => capturedChange(ctx.sessionManager.getSessionId(), review, signal),
				signal,
			);
			signal?.throwIfAborted();
			const template = await explainTemplate(page);
			signal?.throwIfAborted();
			const saved = await savePage(
				embedPage(template, { ...page, session: { token: "", live: false, ask: false } }),
				root,
				page.title,
			);
			page.session.ask = !!liveSession(ctx);
			let lastNote = "";
			const session = await openPageSession(embedPage(template, page), token, undefined, {
				ask: async (body, stop) => {
					const turn = parseTutorTurn(body, page);
					return (
						turn &&
						askFork(
							ctx,
							{
								prompt: tutorPrompt(page, turn),
								pending: "This call was still running when the reader asked the tutor.",
								label: "Explanation tutor",
								root,
							},
							stop,
						)
					);
				},
				health: () => ({ ask: !!liveSession(ctx) }),
				note: (body) => {
					const note = readerNote(body, page);
					if (!note || note === lastNote) return;
					lastNote = note;
					pi.sendMessage(
						{ customType: "explain-reader-note", content: note, display: true },
						{ deliverAs: "nextTurn" },
					);
				},
			});
			const unpublish = publishLivePage(ctx.sessionManager.getSessionId(), toolCallId, {
				tool: EXPLAIN_CHANGE_TOOL_NAME,
				url: session.url,
			});
			sessions.add(() => {
				unpublish();
				session.close();
			});
			const where = present(session.url);
			const lines = [
				`Opened the explanation of ${page.ref} at ${session.url}`,
				...(where ? [where] : []),
				`Saved a shareable copy (attach it to a pull request or a page): ${saved}`,
			];
			if (warnings.length) lines.push("", "Code references the page could not show:", ...warnings.map((w) => `- ${w}`));
			return { content: text(lines.join("\n")), details: { url: session.url, saved, warnings } };
		},
	});

	pi.on("session_shutdown", () => {
		for (const close of sessions) close();
		sessions.clear();
	});
}
