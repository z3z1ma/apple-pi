// Which conversation is open, and what the panel needs from outside React: the backend's conversation API and the
// theme (for portraits and place names). `main.tsx` connects them and opens the panel when the world or the side panel
// asks to talk to a character. Each change replaces the state object, as useSyncExternalStore needs.
import type { AgentWorldApi, Character } from "../../../src/world.js";
import type { Theme } from "../../theme.js";

export type ConversationApi = Pick<AgentWorldApi, "conversation" | "markSeen">;

export interface PanelState {
	/** The character talked to, as it was when the panel opened; the panel follows its live facts from the store. */
	character?: Character;
	/** Counts each opening, so talking to the same character again starts afresh. */
	opening: number;
	api?: ConversationApi;
	theme?: Theme;
}

let state: PanelState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<PanelState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

export const conversationPanel = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: ConversationApi, theme: Theme) {
		update({ api, theme });
	},
	open(character: Character) {
		update({ character, opening: state.opening + 1 });
	},
	close() {
		if (state.character) update({ character: undefined });
	},
};
