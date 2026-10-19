// Renaming an awake agent (ticket 12): the small form opened from a character's right-click menu in the world or its
// side-panel row, and what it sends (the runtime's `rename`, with its receipt). `main.tsx` connects the backend API and
// the view store. Each change replaces the state object, as useSyncExternalStore needs.
import type { AgentWorldApi, Character } from "../../../src/world.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";
import type { Progress } from "./place-panels.js";

export interface RenameState {
	/** The character being renamed, as it was when the form opened. */
	open?: Pick<Character, "id" | "name">;
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
	api?: Pick<AgentWorldApi, "rename">;
	view?: ViewStore;
}

let state: RenameState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<RenameState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

/** A name as it is sent: one line, single spaces. */
export const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

export const renaming = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: Pick<AgentWorldApi, "rename">, view: ViewStore) {
		update({ api, view });
	},
	open(character: Pick<Character, "id" | "name">) {
		onePanel.opening("rename");
		update({ open: { id: character.id, name: character.name }, opening: state.opening + 1 });
	},
	close() {
		if (state.open) update({ open: undefined });
	},
	/**
	 * Send `rename` for the character; resolves with what the form shows, and says it in the chatbox. A blank name is
	 * refused here and nothing is sent.
	 */
	async send(character: Pick<Character, "id" | "name">, given: string): Promise<Progress> {
		const name = cleanName(given);
		if (!name) return { state: "failed", text: "Give it a name." };
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent World is not connected." };
		try {
			const receipt = await api.rename(character.id, name);
			if (!receipt.ok) {
				view?.notify(receipt.reason);
				return { state: "failed", text: receipt.reason };
			}
			const text =
				receipt.stage === "applied"
					? `${character.name} is now called ${name}.`
					: (receipt.note ?? "Sent; it has not taken the name yet.");
			view?.notify(receipt.stage === "applied" ? text : `${character.name}: ${text}`);
			return { state: "done", text };
		} catch (error) {
			return { state: "failed", text: String((error as Error)?.message ?? error) };
		}
	},
};

onePanel.closes("rename", () => renaming.close());
