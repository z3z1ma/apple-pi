import { createHash } from "node:crypto";
import { extractText } from "./context.js";

interface AssistantMessageIdentity {
	content: unknown[];
	timestamp?: number;
	responseId?: string;
	provider?: string;
	model?: string;
}

/** Stable identity for an assistant message across session compaction and reindexing. */
export function assistantMessageMarker(message: AssistantMessageIdentity): string {
	const identity = [
		String(message.timestamp ?? ""),
		message.responseId ?? "",
		message.provider ?? "",
		message.model ?? "",
		extractText(message.content),
	].join("\0");
	return createHash("sha256").update(identity).digest("hex");
}
