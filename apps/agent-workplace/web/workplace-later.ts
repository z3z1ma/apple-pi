import { useSyncExternalStore } from "react";
import type { QuotedMessage } from "./overlay/conversation/quote.js";
import type { SwitchTarget } from "./workplace-switcher.js";

function storedList<T extends { key: string }>(name: string) {
	const changed = `${name}-changed`;
	let cache: T[] | undefined;
	const list = (): T[] => {
		if (!cache) {
			try {
				cache = JSON.parse(localStorage.getItem(name) ?? "[]") as T[];
			} catch {
				cache = [];
			}
		}
		return cache;
	};
	const write = (next: T[]) => {
		cache = next;
		localStorage.setItem(name, JSON.stringify(next));
		window.dispatchEvent(new Event(changed));
	};
	const subscribe = (listener: () => void) => {
		const onStorage = (event: StorageEvent) => {
			if (event.key !== name) return;
			cache = undefined;
			listener();
		};
		window.addEventListener(changed, listener);
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener(changed, listener);
			window.removeEventListener("storage", onStorage);
		};
	};
	return {
		list,
		has: (key: string) => list().some((item) => item.key === key),
		add: (item: T) => {
			if (!list().some((existing) => existing.key === item.key)) write([item, ...list()]);
		},
		remove: (key: string) => write(list().filter((item) => item.key !== key)),
		use: () => useSyncExternalStore(subscribe, list),
	};
}

export interface SavedMessage extends QuotedMessage {
	key: string;
	origin: SwitchTarget;
	savedAt: number;
}

export const savedKey = (origin: SwitchTarget, message: QuotedMessage) =>
	`${origin.kind}:${"id" in origin ? origin.id : origin.view}:${message.at}:${message.author}`;

const saved = storedList<SavedMessage>("workplace-later");
export const later = {
	...saved,
	save: (origin: SwitchTarget, message: QuotedMessage) =>
		saved.add({ ...message, key: savedKey(origin, message), origin, savedAt: Date.now() }),
};
export const useLater = saved.use;

export interface PinnedThread {
	key: string;
	title: string;
}
export const pinnedThreads = storedList<PinnedThread>("workplace-pinned-threads");

export const muted = storedList<{ key: string }>("workplace-muted");
