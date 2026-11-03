import { readFileSync } from "node:fs";
import type { Message } from "@earendil-works/pi-ai";
import { clip } from "./content.js";
import { type RenderedEntry, renderMessage } from "./render-entries.js";

interface LoadedMessages {
	rendered: RenderedEntry[];
	rawMessages: Message[];
}

const notebookText = (entry: any): string | undefined => {
	if (
		!["notebook.observations.recorded", "notebook.reflections.recorded", "notebook.maintenance"].includes(
			entry.customType,
		)
	)
		return undefined;
	const notes = [...(entry.data?.observations ?? []), ...(entry.data?.reflections ?? [])];
	const text = notes
		.filter((note: any) => typeof note.content === "string")
		.map((note: any) => {
			const sources = (note.sourceEntryIds ?? []).map((id: string) => `entry:${id}`).join(", ");
			return `note:${note.id} ${note.content}\nSources: ${sources || "see revisit_note"}\nUse revisit_note ${note.id} for original provenance (recorded learning, not verified support).`;
		})
		.join("\n\n");
	return text || undefined;
};

export const sourceContext = (
	entry: any,
	message: Message,
	question: any,
	records: Map<string, any>,
	allowedEntryIds?: Set<string>,
): NonNullable<RenderedEntry["context"]> => {
	const context: NonNullable<RenderedEntry["context"]> = [];
	if (question && (!allowedEntryIds || allowedEntryIds.has(question.id)))
		context.push({
			address: `entry:${question.id}`,
			role: "preceding input",
			summary: clip(
				renderMessage(question.message ?? { role: "user", content: question.content }, 0, true).summary,
				300,
			),
		});
	const visited = new Set<string>();
	let ancestor = message.role === "toolResult" ? records.get(entry.parentId) : undefined;
	while (ancestor && !visited.has(ancestor.id)) {
		visited.add(ancestor.id);
		if (ancestor.id === question?.id) break;
		if (message.role === "toolResult" && Array.isArray(ancestor.message?.content)) {
			const call = ancestor.message.content.find(
				(part: any) => part.type === "toolCall" && part.id === message.toolCallId,
			);
			if (call && (!allowedEntryIds || allowedEntryIds.has(ancestor.id))) {
				context.push({
					address: `entry:${ancestor.id}`,
					role: "attempted call",
					summary: `${call.name} call:${call.id}`,
				});
				break;
			}
		}
		ancestor = records.get(ancestor.parentId);
	}
	for (const [role, id] of [
		["first kept source", entry.firstKeptEntryId],
		["branch source", entry.fromId],
	]) {
		if (id) context.push({ address: `entry:${id}`, role, summary: "summary reference, not complete source coverage" });
	}
	return context;
};

export const renderSource = (
	entry: any,
	index: number | undefined,
	full: boolean,
): { message: Message; display: RenderedEntry } | undefined => {
	if (index !== undefined) return { message: entry.message, display: renderMessage(entry.message, index, full) };
	const note = entry.type === "custom" ? notebookText(entry) : undefined;
	const kind = note ? "notebook" : entry.type;
	const body =
		note ??
		(entry.type === "custom_message"
			? entry.content
			: ["compaction", "branch_summary"].includes(entry.type)
				? entry.summary
				: undefined);
	if (body === undefined) return undefined;
	const message: Message = { role: "user", content: body, timestamp: Date.parse(entry.timestamp) || 0 };
	const text = renderMessage(message, 0, true).summary;
	return { message, display: { role: kind, sourceKind: kind, summary: full ? text : clip(text, 300) } };
};

export const loadAllMessages = (
	sessionFile: string,
	full: boolean,
	allowedEntryIds?: Set<string>,
	/** Optional filter by global message index; added source kinds have no message ordinal. */
	entryFilter?: (globalIndex: number) => boolean,
	activeEntryIds?: Set<string>,
): LoadedMessages => {
	const content = readFileSync(sessionFile, "utf-8");
	const rendered: RenderedEntry[] = [];
	const rawMessages: Message[] = [];
	const records = new Map<string, any>();
	const questions = new Map<string, any>();
	let previousQuestion: RenderedEntry | undefined;
	let messageIndex = 0;
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		records.set(entry.id, entry);
		const question = questions.get(entry.parentId);
		questions.set(entry.id, entry.message?.role === "user" || entry.type === "custom_message" ? entry : question);
		const isMessage = entry.type === "message" && entry.message;
		const index = isMessage ? messageIndex++ : undefined;
		if (allowedEntryIds && !allowedEntryIds.has(entry.id)) continue;
		if (entryFilter && (index === undefined || !entryFilter(index))) continue;
		const source = renderSource(entry, index, full);
		if (!source) continue;
		const { message, display } = source;
		const context = sourceContext(entry, message, question, records, allowedEntryIds);
		if (entry.parentId === undefined && previousQuestion && display.role !== "user")
			context.push({
				address: `entry:${previousQuestion.entryId}`,
				role: "preceding input",
				summary: clip(previousQuestion.summary, 300),
			});
		rendered.push({
			...display,
			...(context.length > 0 ? { context } : {}),
			entryId: entry.id,
			timestamp: entry.timestamp,
			sourceKind: display.sourceKind ?? "message",
			customType: entry.customType,
			parentId: entry.parentId,
			lineage: activeEntryIds ? (activeEntryIds.has(entry.id) ? "active" : "off-lineage") : undefined,
		});
		rawMessages.push(message);
		if (display.role === "user" || display.role === "custom_message") previousQuestion = rendered.at(-1);
	}
	return { rendered, rawMessages };
};
