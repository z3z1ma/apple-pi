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

/** A prompt for a read-only fork: what to answer, what a still-running tool call should read, and the usage label. */
export interface ForkPrompt {
	prompt: string;
	pending: string;
	label: string;
	root: string;
}

/**
 * Answers from a read-only fork of the live conversation, the way `clarify` does: the fork shares the session's
 * request prefix, a still-running tool call gets a placeholder result, and only the answer leaves the fork. Its
 * usage is recorded in the session under `label`.
 */
export async function askFork(
	ctx: ExtensionContext,
	{ prompt, pending, label, root }: ForkPrompt,
	signal: AbortSignal,
) {
	const session = liveSession(ctx);
	if (!session) throw new Error("The live session is not available, so the agent cannot answer.");
	const messages = structuredClone(session.sessionManager.buildSessionProjection().messages);
	closePendingCalls(messages, pending);
	const content = `${prompt}\n\nPage source directory: ${JSON.stringify(root)}. Resolve the page's file paths against this directory. Use absolute paths for read, grep, find, and ls; the fork's working directory remains the parent session's and may name a different repository.`;
	const fork = startFork(session, {
		messages,
		append: { role: "custom", customType: "page-question", content, display: false, timestamp: Date.now() },
		label,
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

/** Answers a reviewer's question about a passage of the page they are reviewing. */
export function askAgent(ctx: ExtensionContext, passage: Passage, question: string, signal: AbortSignal, root: string) {
	const where = `${passage.where}${passage.context ? ` (${passage.context})` : ""}`;
	return askFork(
		ctx,
		{
			prompt: `${FRAME}\n\nPassage: ${where}\n\n\`\`\`\n${passage.excerpt}\n\`\`\`\n\nQuestion: ${question}`,
			pending: "The review page is still open; the user has not submitted a verdict yet.",
			label: "Review question",
			root,
		},
		signal,
	);
}
