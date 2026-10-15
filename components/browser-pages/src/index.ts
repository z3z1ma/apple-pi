import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	buildCodeReviewPage,
	formatReviewResult,
	parseReviewResult,
	REVIEW_CODE_TOOL_NAME,
	ReviewCodeParamsSchema,
	type ReviewCodeParams,
} from "./code-review.js";
import { liveSession, trackLiveSessions } from "../../shared/src/forked-continuation.js";
import { askAgent, parseQuestion } from "./ask-agent.js";
import { openPageSession } from "./page-server.js";
import { embedPage, readTemplate, savePage } from "./saved-page.js";

function openInBrowser(url: string): void {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
	execFile(command, [url], () => {});
}

const text = (value: string) => [{ type: "text" as const, text: value }];

export default function browserPages(pi: ExtensionAPI): void {
	const sessions = new Set<() => void>();
	trackLiveSessions();

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
			if (!ctx.hasUI)
				return { content: text("No user is attached to this run, so no review page was opened."), details: undefined };
			const token = randomBytes(24).toString("hex");
			const { page, root } = await buildCodeReviewPage(params as ReviewCodeParams, ctx.cwd, token);
			const template = await readTemplate();
			page.session.ask = !!liveSession(ctx);
			const session = await openPageSession(embedPage(template, page), token, (body) => parseReviewResult(body, page), {
				signal,
				ask: async (body, stop) => {
					const question = parseQuestion(body, page);
					return question && askAgent(ctx, page, question, stop);
				},
			});
			sessions.add(session.close);
			onUpdate?.({ content: text(`Waiting for the review at ${session.url}`), details: undefined });
			openInBrowser(session.url);
			try {
				const result = await session.result;
				const saved = await savePage(
					embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }),
					root,
					page.title,
				);
				return {
					content: text(formatReviewResult(page, result, saved)),
					details: { verdict: result.verdict, comments: result.comments.length, saved },
				};
			} finally {
				session.close();
				sessions.delete(session.close);
			}
		},
	});

	pi.on("session_shutdown", () => {
		for (const close of sessions) close();
		sessions.clear();
	});
}
