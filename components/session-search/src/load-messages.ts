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
	let messageIndex = 0;
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const isMessage = entry.type === "message" && entry.message;
		const index = isMessage ? messageIndex++ : undefined;
		if (allowedEntryIds && !allowedEntryIds.has(entry.id)) continue;
		if (entryFilter && (index === undefined || !entryFilter(index))) continue;
		let message: Message;
		let display: RenderedEntry;
		if (isMessage) {
			message = entry.message;
			display = renderMessage(message, index!, full);
		} else {
			const note = entry.type === "custom" ? notebookText(entry) : undefined;
			const kind = note ? "notebook" : entry.type;
			const body =
				note ??
				(entry.type === "custom_message"
					? entry.content
					: ["compaction", "branch_summary"].includes(entry.type)
						? entry.summary
						: undefined);
			if (body === undefined) continue;
			message = { role: "user", content: body, timestamp: Date.parse(entry.timestamp) || 0 };
			const text = renderMessage(message, 0, true).summary;
			display = { role: kind, sourceKind: kind, summary: full ? text : clip(text, 300) };
		}
		rendered.push({
			...display,
			entryId: entry.id,
			timestamp: entry.timestamp,
			sourceKind: display.sourceKind ?? "message",
			customType: entry.customType,
			parentId: entry.parentId,
			lineage: activeEntryIds ? (activeEntryIds.has(entry.id) ? "active" : "off-lineage") : undefined,
		});
		rawMessages.push(message);
	}
	return { rendered, rawMessages };
};
