// The function places' own panels and what they send (tickets 15 and 16): the innkeeper's register of dormant agents,
// the rookery's mail, and ending a session. The world, the side panel, and the panels themselves all act through
// `placeActions`, so a wake or an ended session reads the same wherever it started. `main.tsx` connects the backend
// API, the theme, and the view store. Each change replaces the state object, as useSyncExternalStore needs.
import type { AgentWorldApi, Character, DormantAgent } from "../../../src/world.js";
import { conversations } from "../../game/actions.js";
import { sleeperCharacter } from "../../game/layout.js";
import type { Theme } from "../../theme.js";
import type { ViewStore } from "../../view-state.js";

export type PlacesApi = Pick<AgentWorldApi, "wake" | "endSession" | "sendMail">;

/** What became of something the operator asked for, shown where he asked: sending, done, or failed with why. */
export interface Progress {
	state: "sending" | "done" | "failed";
	text: string;
}

export interface PlacesState {
	panel?: "innkeeper" | "rookery";
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
	/** The rookery opens on a letter to write (from the Mail tab, or the sorting desk), to `letterTo` when chosen. */
	write?: boolean;
	letterTo?: string;
	/** A busy session the operator asked to end: he confirms before anything is sent. */
	confirmEnd?: { id: string; name: string; reason: string };
	/** Wakes asked for, by character id. */
	wakes: Record<string, Progress>;
	api?: PlacesApi;
	theme?: Theme;
	view?: ViewStore;
}

let state: PlacesState = { opening: 0, wakes: {} };
const listeners = new Set<() => void>();
const update = (change: Partial<PlacesState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};
const setWake = (id: string, progress: Progress) => update({ wakes: { ...state.wakes, [id]: progress } });
const failure = (error: unknown) => String((error as Error)?.message ?? error);

export const placePanels = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: PlacesApi, theme: Theme, view: ViewStore) {
		update({ api, theme, view });
	},
	open(panel: "innkeeper" | "rookery", options: { write?: boolean; letterTo?: string } = {}) {
		update({ panel, opening: state.opening + 1, write: options.write, letterTo: options.letterTo });
	},
	close() {
		if (state.panel) update({ panel: undefined, write: undefined, letterTo: undefined });
	},
	cancelEnd() {
		if (state.confirmEnd) update({ confirmEnd: undefined });
	},
};

export const placeActions = {
	/** Wake a dormant agent: its session opens in a new tmux window, and it walks out of the inn to its place. */
	async wake(agent: Pick<DormantAgent, "id" | "name">) {
		const { api, view } = state;
		if (!api || state.wakes[agent.id]?.state === "sending") return;
		setWake(agent.id, { state: "sending", text: `Waking ${agent.name}\u2026` });
		try {
			const receipt = await api.wake(agent.id);
			if (receipt.ok) {
				const text =
					receipt.stage === "applied"
						? "Awake in a new window beside your current one."
						: (receipt.note ?? "Its window is opening.");
				setWake(agent.id, { state: "done", text });
				view?.notify(receipt.stage === "applied" ? `${agent.name} is awake.` : `${agent.name}: ${text}`);
			} else {
				setWake(agent.id, { state: "failed", text: receipt.reason });
				view?.notify(receipt.reason);
			}
		} catch (error) {
			setWake(agent.id, { state: "failed", text: failure(error) });
		}
	},

	/** Read a dormant agent's last conversation in the conversation panel (it has no actions while asleep). */
	readConversation(agent: DormantAgent) {
		placePanels.close();
		conversations.open(sleeperCharacter(agent));
	},

	/**
	 * Mail a character as the operator. Resolves with what the letter form shows: delivered, waiting for a sleeper to
	 * wake, or why it failed.
	 */
	async sendMail(to: { id: string; name: string; asleep: boolean }, body: string): Promise<Progress> {
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent World is not connected." };
		try {
			const receipt = await api.sendMail(to.id, body);
			if (!receipt.ok) return { state: "failed", text: receipt.reason };
			if (receipt.stage === "applied") {
				view?.notify(`Your letter reached ${to.name}.`);
				return { state: "done", text: `Delivered to ${to.name}.` };
			}
			if (to.asleep || receipt.stage === "accepted")
				return { state: "done", text: to.asleep ? `It waits until ${to.name} wakes.` : (receipt.note ?? "Sent.") };
			return { state: "done", text: `Handed to ${to.name}; ${receipt.note ?? "it arrives shortly."}` };
		} catch (error) {
			return { state: "failed", text: failure(error) };
		}
	},

	/** End an awake session; a busy one waits for the operator to confirm (decision 13). */
	async endSession(character: Pick<Character, "id" | "name">, confirmed = false) {
		const { api, view } = state;
		if (!api) return;
		if (confirmed) update({ confirmEnd: undefined });
		try {
			const receipt = await api.endSession(character.id, confirmed);
			if (receipt.ok) view?.notify(`${character.name}'s session ended; it goes to the inn to sleep.`);
			else if (receipt.confirm)
				update({ confirmEnd: { id: character.id, name: character.name, reason: receipt.reason } });
			else view?.notify(receipt.reason);
		} catch (error) {
			view?.notify(failure(error));
		}
	},
};
