// The theme the world wears now. Phaser's scenes, the interface, and the panels all read it here, so switching theme
// changes it in one place; React components redraw through `useTheme`.
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

/** The theme worn now, for React components. */
export function useTheme(): Theme | undefined {
	return useSyncExternalStore(themeStore.subscribe, themeStore.get);
}

/** The theme worn now, for code that runs only after the world has opened in one. */
export function worn(): Theme {
	if (!current) throw new Error("The world has no theme yet.");
	return current;
}
