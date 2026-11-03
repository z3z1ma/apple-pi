import { useSyncExternalStore } from "react";
import type { Theme } from "./theme.js";

let current: Theme | undefined;
const listeners = new Set<() => void>();

export const themeStore = {
	get: (): Theme | undefined => current,
	set(theme: Theme) {
		current = theme;
		for (const listener of listeners) listener();
	},
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export function useTheme(): Theme | undefined {
	return useSyncExternalStore(themeStore.subscribe, themeStore.get);
}

export function worn(): Theme {
	if (!current) throw new Error("The world has no theme yet.");
	return current;
}
