import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { closePendingCalls, liveSession, startFork } from "../../shared/src/forked-continuation.js";
import type { CodeReviewPage } from "./page-data.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FRAME = `You are an ephemeral read-only fork of the agent that opened a code review page for the user. The user is reviewing your change in that page and asks about the lines below. Answer the question directly and briefly, grounded in this conversation, the code, and the repository. You can use read, grep, find, and ls; every other tool is blocked. Say plainly when you are not sure.
Your answer appears next to those lines in the page. It is not a message in the main conversation and it changes no code. The review_code call is still waiting for the user's verdict.`;

export interface Question {
	hunk: string;
	start: number;
	end: number;
	question: string;
}

/** A question about lines the page actually shows, or undefined. */
export function parseQuestion(body: unknown, page: CodeReviewPage): Question | undefined {
	if (typeof body !== "object" || body === null) return undefined;
	const { hunk, start, end, question } = body as Record<string, unknown>;
	if (typeof hunk !== "string" || typeof question !== "string" || !question.trim()) return undefined;
	const lines = page.hunks[hunk]?.lines;
	if (!lines || !Number.isInteger(start) || !Number.isInteger(end)) return undefined;
	if ((start as number) < 0 || (end as number) < (start as number) || (end as number) >= Math.max(1, lines.length))
		return undefined;
	return { hunk, start: start as number, end: end as number, question: question.trim() };
}

function excerpt(page: CodeReviewPage, q: Question): { where: string; code: string } {
	const hunk = page.hunks[q.hunk];
	const lines = hunk.lines.slice(q.start, q.end + 1);
	const numbers = lines.map((l) => l.n).filter((n): n is number => n !== undefined);
	const where = numbers.length
		? `${hunk.file}:${numbers[0]}${numbers.length > 1 ? `-${numbers[numbers.length - 1]}` : ""}`
		: `${hunk.file}:old ${lines[0]?.o ?? "?"}`;
	const code = lines.map((l) => `${l.t}${l.s.map((seg) => seg.t).join("")}`).join("\n");
	return { where, code };
}

/**
 * Answers a reviewer's question from a read-only fork of the live conversation, the way `clarify` does: the
 * fork shares the session's request prefix, the pending `review_code` call gets a placeholder result, and only
 * the answer leaves the fork. Its usage is recorded in the session as "Review question".
 */
export async function askAgent(ctx: ExtensionContext, page: CodeReviewPage, q: Question, signal: AbortSignal) {
	const session = liveSession(ctx);
	if (!session) throw new Error("The live session is not available, so the agent cannot answer.");
	const messages = structuredClone(session.sessionManager.buildSessionProjection().messages);
	closePendingCalls(messages, "The review page is still open; the user has not submitted a verdict yet.");
	const { where, code } = excerpt(page, q);
	const chapter = page.chapters.find((c) => c.changes.some((change) => change.id === q.hunk));
	const fork = startFork(session, {
		messages,
		append: {
			role: "custom",
			customType: "review-question",
			content: `${FRAME}\n\nLines: ${where}${chapter ? ` (chapter "${chapter.title}")` : ""}\n\n\`\`\`\n${code}\n\`\`\`\n\nQuestion: ${q.question}`,
			display: false,
			timestamp: Date.now(),
		},
		label: "Review question",
		blockedTools: new Set(
			session.agent.state.tools.filter((tool) => !READ_ONLY_TOOLS.has(tool.name)).map((tool) => tool.name),
		),
	});
	const abort = () => fork.abort();
	signal.addEventListener("abort", abort, { once: true });
	try {
		const result = await fork.result;
		signal.throwIfAborted();
		const last = result.messages.at(-1);
		if (last?.role !== "assistant" || last.stopReason === "aborted" || last.stopReason === "error")
			throw new Error(`The agent could not answer: ${(last?.role === "assistant" && last.errorMessage) || "no reply"}`);
		const answer = last.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n")
			.trim();
		if (!answer) throw new Error("The agent could not answer: no reply");
		return answer;
	} finally {
		signal.removeEventListener("abort", abort);
	}
}
