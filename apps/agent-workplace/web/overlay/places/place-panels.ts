import type { AgentWorkplaceApi, Character, DormantAgent } from "../../../src/world.js";
import { conversations } from "../../game/actions.js";
import { sleeperCharacter } from "../../game/layout.js";
import { say } from "../../theme.js";
import { themeStore } from "../../theme-store.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";

export type PlacesApi = Pick<AgentWorkplaceApi, "wake" | "endSession" | "sendMail">;

export interface Progress {
	state: "sending" | "done" | "failed";
	text: string;
}

export interface PlacesState {
	panel?: "innkeeper" | "rookery";

	opening: number;

	write?: boolean;
	letterTo?: string;

	confirmEnd?: { id: string; name: string; reason: string };

	wakes: Record<string, Progress>;
	api?: PlacesApi;
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
	connect(api: PlacesApi, view: ViewStore) {
		update({ api, view });
	},
	open(panel: "innkeeper" | "rookery", options: { write?: boolean; letterTo?: string } = {}) {
		onePanel.opening("places");
		update({ panel, opening: state.opening + 1, write: options.write, letterTo: options.letterTo });
	},
	close() {
		if (state.panel) update({ panel: undefined, write: undefined, letterTo: undefined });
	},
	cancelEnd() {
		if (state.confirmEnd) update({ confirmEnd: undefined });
	},
};

onePanel.closes("places", () => placePanels.close());

export const placeActions = {
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

	readConversation(agent: DormantAgent) {
		placePanels.close();
		conversations.open(sleeperCharacter(agent));
	},

	async sendMail(to: { id: string; name: string; asleep: boolean }, body: string): Promise<Progress> {
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent Workplace is not connected." };
		try {
			const receipt = await api.sendMail(to.id, body);
			if (!receipt.ok) return { state: "failed", text: receipt.reason };
			if (receipt.stage === "applied") {
				view?.notify(say(themeStore.get(), "letter-reached", { name: to.name }));
				return { state: "done", text: `Delivered to ${to.name}.` };
			}
			if (to.asleep || receipt.stage === "accepted")
				return { state: "done", text: to.asleep ? `It waits until ${to.name} wakes.` : (receipt.note ?? "Sent.") };
			return { state: "done", text: `Handed to ${to.name}; ${receipt.note ?? "it arrives shortly."}` };
		} catch (error) {
			return { state: "failed", text: failure(error) };
		}
	},

	async endSession(character: Pick<Character, "id" | "name">, confirmed = false) {
		const { api, view } = state;
		if (!api) return;
		if (confirmed) update({ confirmEnd: undefined });
		try {
			const receipt = await api.endSession(character.id, confirmed);
			if (receipt.ok) view?.notify(say(themeStore.get(), "session-ended", { name: character.name }));
			else if (receipt.confirm)
				update({ confirmEnd: { id: character.id, name: character.name, reason: receipt.reason } });
			else if (receipt.dissolve && window.parent.agentWorkplaceSendHome)
				window.parent.agentWorkplaceSendHome(character.id);
			else view?.notify(receipt.reason);
		} catch (error) {
			view?.notify(failure(error));
		}
	},
};
