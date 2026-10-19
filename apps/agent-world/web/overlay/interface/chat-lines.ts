// Chatbox lines from outside the interface itself: what the operator did in a function place (a delegation sent), and
// every outside write the backend's gate sent as him (the gate announces each; the record's latest are read once at
// start). The interface merges them with the runtime's feed and its own lines. Each change replaces the list, as
// useSyncExternalStore needs.
import type { IntegrationsApi, OutsideWriteEntry } from "../../../src/integrations.js";
import type { ChatKind, ChatLine } from "./chatbox.js";

/** Lines kept; older ones drop off the top, as the chatbox's own do. */
const KEPT = 100;
/** Outside writes read back from the local record when the world opens. */
const RECORD_SHOWN = 20;

let lines: ChatLine[] = [];
let count = 0;
const listeners = new Set<() => void>();
const seenWrites = new Set<string>();

const writeKey = (entry: OutsideWriteEntry) => `${entry.at}:${entry.kind}:${entry.line}`;

export const chatLines = {
	get: () => lines,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	/** Add a line to the chatbox, as `kind` (a delegation is a command). */
	add(text: string, kind: ChatKind = "game", at = Date.now()) {
		const line: ChatLine = { key: `place:${++count}`, at, kind, character: null, name: null, text };
		lines = [...lines, line].sort((a, b) => a.at - b.at).slice(-KEPT);
		for (const listener of listeners) listener();
	},
	/** An outside write the gate sent (or failed to send), once each. */
	write(entry: OutsideWriteEntry) {
		const key = writeKey(entry);
		if (seenWrites.has(key)) return;
		seenWrites.add(key);
		chatLines.add(entry.line, "commands", entry.at);
	},
	/** Show the record's latest writes, then each new one as the gate sends it. */
	connect(api: Partial<Pick<IntegrationsApi, "outsideWrites" | "onOutsideWrite">>) {
		api.onOutsideWrite?.((entry) => chatLines.write(entry));
		void api
			.outsideWrites?.()
			.then((entries) => {
				for (const entry of entries.slice(-RECORD_SHOWN)) chatLines.write(entry);
			})
			.catch(() => {});
	},
};
