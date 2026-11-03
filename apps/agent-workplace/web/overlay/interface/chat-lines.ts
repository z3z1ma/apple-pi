import type { IntegrationsApi, OutsideWriteEntry } from "../../../src/integrations.js";
import type { ChatKind, ChatLine } from "./chatbox.js";

const KEPT = 100;

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

	add(text: string, kind: ChatKind = "game", at = Date.now()) {
		const line: ChatLine = { key: `place:${++count}`, at, kind, character: null, name: null, text };
		lines = [...lines, line].sort((a, b) => a.at - b.at).slice(-KEPT);
		for (const listener of listeners) listener();
	},

	write(entry: OutsideWriteEntry) {
		const key = writeKey(entry);
		if (seenWrites.has(key)) return;
		seenWrites.add(key);
		chatLines.add(entry.line, "commands", entry.at);
	},

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
