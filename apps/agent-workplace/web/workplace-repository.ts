import { useSyncExternalStore } from "react";

const storageKey = "workplace-git-root";
const listeners = new Set<() => void>();
let current = read();

function read(): string {
	try {
		return localStorage.getItem(storageKey) ?? "";
	} catch {
		return "";
	}
}

export function chooseRepository(value: string | ((previous: string) => string)): void {
	const next = typeof value === "function" ? value(current) : value;
	if (next === current) return;
	current = next;
	try {
		localStorage.setItem(storageKey, next);
	} catch {}
	for (const listener of listeners) listener();
}

export function useRepository(): string {
	const root = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
	);
	return root;
}
