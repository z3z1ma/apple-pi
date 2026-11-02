import { useSyncExternalStore } from "react";
import type { QuotedMessage } from "./overlay/conversation/quote.js";
import type { SwitchTarget } from "./workplace-switcher.js";

/** A message the operator saved to come back to, with where it was. Kept on this device. */
export interface SavedMessage extends QuotedMessage {
	key: string;
	origin: SwitchTarget;
	savedAt: number;
}

const STORE = "workplace-later";
const CHANGED = "workplace-later-changed";

let cache: SavedMessage[] | undefined;
function read(): SavedMessage[] {
	if (!cache) {
		try {
			cache = JSON.parse(localStorage.getItem(STORE) ?? "[]") as SavedMessage[];
		} catch {
			cache = [];
		}
	}
	return cache;
}
function write(next: SavedMessage[]) {
	cache = next;
	localStorage.setItem(STORE, JSON.stringify(next));
	window.dispatchEvent(new Event(CHANGED));
}

/** One identity per message and place, so saving twice keeps one entry. */
export const savedKey = (origin: SwitchTarget, message: QuotedMessage) =>
	`${origin.kind}:${"id" in origin ? origin.id : origin.view}:${message.at}:${message.author}`;

export const later = {
	list: read,
	has: (key: string) => read().some((item) => item.key === key),
	save(origin: SwitchTarget, message: QuotedMessage) {
		const key = savedKey(origin, message);
		if (!later.has(key)) write([{ ...message, key, origin, savedAt: Date.now() }, ...read()]);
	},
	remove: (key: string) => write(read().filter((item) => item.key !== key)),
};

function subscribe(listener: () => void) {
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORE) return;
		cache = undefined;
		listener();
	};
	window.addEventListener(CHANGED, listener);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGED, listener);
		window.removeEventListener("storage", onStorage);
	};
}

export function useLater(): SavedMessage[] {
	return useSyncExternalStore(subscribe, read);
}
