import { isXaiResponsesModel } from "./convert.js";
import type { XaiCompactionItem } from "./types.js";

export function payloadHasXaiCompaction(payload: unknown, compactionItem: XaiCompactionItem): boolean {
	if (payload === null || typeof payload !== "object") return false;
	const input = (payload as { input?: unknown }).input;
	if (!Array.isArray(input)) return false;
	return input.some(
		(item) =>
			typeof item === "object" &&
			item !== null &&
			(item as { type?: unknown }).type === "compaction" &&
			(item as { id?: unknown }).id === compactionItem.id,
	);
}

/**
 * Inject the newest xAI compaction item into an openai-responses payload.
 * Places it after a leading system/developer prompt when one exists.
 */
export function injectXaiCompaction(
	payload: unknown,
	model: { provider?: unknown; api?: unknown } | null | undefined,
	compactionItem: XaiCompactionItem | undefined,
): unknown {
	if (!isXaiResponsesModel(model) || !compactionItem || payload === null || typeof payload !== "object") {
		return undefined;
	}

	const record = payload as Record<string, unknown>;
	if (!Array.isArray(record.input) || payloadHasXaiCompaction(payload, compactionItem)) {
		return undefined;
	}

	const input = [...record.input] as Record<string, unknown>[];
	const compactionObject = {
		type: "compaction",
		id: compactionItem.id,
		encrypted_content: compactionItem.encrypted_content,
	};

	if (input.length > 0 && (input[0].role === "system" || input[0].role === "developer")) {
		input.splice(1, 0, compactionObject);
	} else {
		input.unshift(compactionObject);
	}

	return { ...record, input };
}
