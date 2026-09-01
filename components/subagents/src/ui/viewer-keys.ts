/**
 * viewer-keys.ts — Scroll key matchers for the conversation viewer.
 *
 * Resolves `tui.select.*` through the user's keybindings when pi provides a
 * manager, falling back to the previous hardcoded keys otherwise. The viewer's
 * k/j and shift+arrow aliases always work alongside whatever is bound.
 */

import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

/** The keybinding ids the conversation viewers resolve. */
export type ViewerKeybinding =
	| "tui.select.up"
	| "tui.select.down"
	| "tui.select.pageUp"
	| "tui.select.pageDown"
	| "app.message.copy";

/** Structural subset of pi-tui's `KeybindingsManager` (which satisfies it). */
export interface ViewerKeybindings {
	matches(data: string, keybinding: ViewerKeybinding): boolean;
	getKeys?(keybinding: ViewerKeybinding): KeyId[];
}

export interface ViewerKeys {
	scrollUp(data: string): boolean;
	scrollDown(data: string): boolean;
	pageUp(data: string): boolean;
	pageDown(data: string): boolean;
	copyMessage(data: string): boolean;
	copyKey: KeyId | undefined;
}

export function createViewerKeys(keybindings?: ViewerKeybindings): ViewerKeys {
	const matches = (data: string, id: ViewerKeybinding, fallback: KeyId): boolean =>
		keybindings ? keybindings.matches(data, id) : matchesKey(data, fallback);
	return {
		scrollUp: (data) => matches(data, "tui.select.up", "up") || matchesKey(data, "k"),
		scrollDown: (data) => matches(data, "tui.select.down", "down") || matchesKey(data, "j"),
		pageUp: (data) => matches(data, "tui.select.pageUp", "pageUp") || matchesKey(data, "shift+up"),
		pageDown: (data) => matches(data, "tui.select.pageDown", "pageDown") || matchesKey(data, "shift+down"),
		copyMessage: (data) => matches(data, "app.message.copy", "ctrl+x"),
		copyKey: keybindings ? keybindings.getKeys?.("app.message.copy")[0] : "ctrl+x",
	};
}
