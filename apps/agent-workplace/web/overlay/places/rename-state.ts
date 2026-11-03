import type { AgentWorkplaceApi, Character } from "../../../src/world.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";
import type { Progress } from "./place-panels.js";

export interface RenameState {
	open?: Pick<Character, "id" | "name">;

	opening: number;
	api?: Pick<AgentWorkplaceApi, "rename">;
	view?: ViewStore;
}

let state: RenameState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<RenameState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

export const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

export const renaming = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: Pick<AgentWorkplaceApi, "rename">, view: ViewStore) {
		update({ api, view });
	},
	open(character: Pick<Character, "id" | "name">) {
		onePanel.opening("rename");
		update({ open: { id: character.id, name: character.name }, opening: state.opening + 1 });
	},
	close() {
		if (state.open) update({ open: undefined });
	},

	async send(character: Pick<Character, "id" | "name">, given: string): Promise<Progress> {
		const name = cleanName(given);
		if (!name) return { state: "failed", text: "Give it a name." };
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent Workplace is not connected." };
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
