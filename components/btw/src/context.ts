const BTW_PARENT_CONTEXT_MAX_CHARS = 12_000;
const BTW_CONTEXT_OPEN = "<btw-parent-context>";
const BTW_CONTEXT_CLOSE = "</btw-parent-context>";
const BTW_QUESTION_OPEN = "<btw-question>";
const BTW_QUESTION_CLOSE = "</btw-question>";
const BTW_INJECTION_MARKER = "[BTW side conversation]";

type BtwBranchEntry = {
	id?: string;
	type: string;
	message?: { role?: string; content?: unknown };
	summary?: string;
};

export interface BtwParentSnapshot {
	context: string;
	cursor?: string;
}

export interface BtwExchange {
	question: string;
	answer: string;
}

export function extractText(content: unknown[]): string {
	return content
		.filter((part): part is { type: "text"; text: string } =>
			Boolean(
				part &&
					typeof part === "object" &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string",
			),
		)
		.map((part) => part.text)
		.join("\n");
}

function renderParentBlock(entry: BtwBranchEntry): string | undefined {
	if (entry.type === "message" && entry.message?.role === "user") {
		const text =
			typeof entry.message.content === "string"
				? entry.message.content
				: extractText(Array.isArray(entry.message.content) ? entry.message.content : []);
		if (text.trim().startsWith(BTW_INJECTION_MARKER)) return undefined;
		if (text.trim()) return `[Parent user]\n${text.trim()}`;
	}
	if (entry.type === "message" && entry.message?.role === "assistant") {
		const text = extractText(Array.isArray(entry.message.content) ? entry.message.content : []);
		if (text.trim()) return `[Parent assistant]\n${text.trim()}`;
	}
	if (entry.type === "compaction" && entry.summary?.trim()) return `[Parent summary]\n${entry.summary.trim()}`;
	return undefined;
}

/** Append only the parent entries added since the last overlay visit. */
export function buildBtwParentSnapshot(branch: BtwBranchEntry[], afterEntryId?: string): BtwParentSnapshot {
	const cursor = branch.at(-1)?.id;
	const previousIndex = afterEntryId ? branch.findIndex((entry) => entry.id === afterEntryId) : -1;
	const entries = afterEntryId && previousIndex >= 0 ? branch.slice(previousIndex + 1) : branch;
	const blocks: string[] = [];
	let remaining = BTW_PARENT_CONTEXT_MAX_CHARS;
	for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
		const entry = entries[index];
		const block = renderParentBlock(entry);
		if (!block) continue;
		const separatorCost = blocks.length > 0 ? 2 : 0;
		if (remaining <= separatorCost) break;
		remaining -= separatorCost;
		const kept = block.length <= remaining ? block : `…${block.slice(block.length - remaining + 1)}`;
		blocks.unshift(kept);
		remaining -= kept.length;
		if (entry.type === "compaction") break;
	}
	return { context: blocks.join("\n\n"), cursor };
}

export function buildBtwPrompt(parentContext: string, question: string): string {
	const context = parentContext.trim() ? `${BTW_CONTEXT_OPEN}\n${parentContext}\n${BTW_CONTEXT_CLOSE}\n\n` : "";
	return `${context}${BTW_QUESTION_OPEN}\n${question.trim()}\n${BTW_QUESTION_CLOSE}`;
}

export function formatBtwUserMessage(message: string): string | undefined {
	const questionStart = message.lastIndexOf(BTW_QUESTION_OPEN);
	if (questionStart < 0) return message.trim() || undefined;
	const contentStart = questionStart + BTW_QUESTION_OPEN.length;
	const questionEnd = message.indexOf(BTW_QUESTION_CLOSE, contentStart);
	const question = message.slice(contentStart, questionEnd < 0 ? undefined : questionEnd).trim();
	return question || undefined;
}

export function getLatestBtwExchange(
	messages: Array<{ role?: string; content?: unknown; stopReason?: string }>,
): BtwExchange | undefined {
	for (let assistantIndex = messages.length - 1; assistantIndex >= 0; assistantIndex--) {
		const assistant = messages[assistantIndex];
		if (assistant.role !== "assistant" || assistant.stopReason === "pending") continue;
		const answer = extractText(Array.isArray(assistant.content) ? assistant.content : []).trim();
		if (!answer) continue;
		for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex--) {
			const user = messages[userIndex];
			if (user.role !== "user") continue;
			const raw =
				typeof user.content === "string" ? user.content : extractText(Array.isArray(user.content) ? user.content : []);
			const question = formatBtwUserMessage(raw);
			if (question) return { question, answer };
		}
	}
	return undefined;
}

export function buildBtwInjection(exchange: BtwExchange): string {
	return `${BTW_INJECTION_MARKER}\nQuestion: ${exchange.question}\n\nAnswer:\n${exchange.answer}\n\nUse this answer as context for the current task.`;
}
