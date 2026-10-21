// Retiring a person: the small form opened from a character's actions, in the theme's words (leaving the guild,
// resigning, graduating), and what it sends (the runtime's `retire` with a reason; the person leaves the organization
// and sleeps at the inn marked so). `main.tsx` connects the backend API and the view store. Each change replaces the
// state object, as useSyncExternalStore needs.
import type { AgentWorldApi, Character } from "../../../src/world.js";
import { say } from "../../theme.js";
import { themeStore } from "../../theme-store.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";
import type { Progress } from "./place-panels.js";

export interface RetireState {
	open?: Pick<Character, "id" | "name">;
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
	api?: Pick<AgentWorldApi, "retire">;
	view?: ViewStore;
}

let state: RetireState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<RetireState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

export const retiring = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: Pick<AgentWorldApi, "retire">, view: ViewStore) {
		update({ api, view });
	},
	open(character: Pick<Character, "id" | "name">) {
		onePanel.opening("retire");
		update({ open: { id: character.id, name: character.name }, opening: state.opening + 1 });
	},
	close() {
		if (state.open) update({ open: undefined });
	},
	/** Send `retire` for the person; resolves with what the form shows, and says it in the chatbox. */
	async send(character: Pick<Character, "id" | "name">, given: string): Promise<Progress> {
		const reason = given.trim();
		if (!reason) return { state: "failed", text: "Say why it leaves." };
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent World is not connected." };
		try {
			const receipt = await api.retire(character.id, reason);
			if (!receipt.ok) {
				view?.notify(receipt.reason);
				return { state: "failed", text: receipt.reason };
			}
			const text =
				receipt.stage === "applied"
					? say(themeStore.get(), "retire-done", { name: character.name })
					: (receipt.note ?? "Sent; it has not left yet.");
			view?.notify(receipt.stage === "applied" ? text : `${character.name}: ${text}`);
			return { state: "done", text };
		} catch (error) {
			return { state: "failed", text: String((error as Error)?.message ?? error) };
		}
	},
};

onePanel.closes("retire", () => retiring.close());
