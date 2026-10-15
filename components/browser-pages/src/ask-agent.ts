import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { closePendingCalls, liveSession, startFork } from "../../shared/src/forked-continuation.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FRAME = `You are an ephemeral read-only fork of the agent that opened a review page for the user. The user is reviewing your work in that page and asks about the passage below. Answer the question directly and briefly, grounded in this conversation, the files, and the repository. You can use read, grep, find, and ls; every other tool is blocked. Say plainly when you are not sure.
Your answer appears next to that passage in the page. It is not a message in the main conversation and it changes no files. The review call is still waiting for the user's verdict.`;

/** What a question is about: where it is, the text itself, and optional context such as the chapter. */
export interface Passage {
	where: string;
	excerpt: string;
	context?: string;
}

/**
 * Answers a reviewer's question from a read-only fork of the live conversation, the way `clarify` does: the
 * fork shares the session's request prefix, the pending review call gets a placeholder result, and only the
 * answer leaves the fork. Its usage is recorded in the session as "Review question".
 */
export async function askAgent(ctx: ExtensionContext, passage: Passage, question: string, signal: AbortSignal) {
	const session = liveSession(ctx);
	if (!session) throw new Error("The live session is not available, so the agent cannot answer.");
	const messages = structuredClone(session.sessionManager.buildSessionProjection().messages);
	closePendingCalls(messages, "The review page is still open; the user has not submitted a verdict yet.");
	const fork = startFork(session, {
		messages,
		append: {
			role: "custom",
			customType: "review-question",
			content: `${FRAME}\n\nPassage: ${passage.where}${passage.context ? ` (${passage.context})` : ""}\n\n\`\`\`\n${passage.excerpt}\n\`\`\`\n\nQuestion: ${question}`,
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
