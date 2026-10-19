// The town square's panels (tickets 27 and 28): the crier, who reaches any Slack channel, and a channel read in a
// panel, its threads expanding. The world (a townsperson, the crier), the Slack tab, and the crier's own list open
// them through here. Each change replaces the state object, as useSyncExternalStore needs.
import type { SlackChannel } from "../../../src/integrations.js";
import { placePanels } from "./place-panels.js";

/** The channel a panel reads: as listed (with its unread count), or found by the crier. */
export type ChannelRef = Pick<SlackChannel, "id" | "name" | "kind"> & Partial<Pick<SlackChannel, "unread" | "more">>;

export interface SquarePanelsState {
	panel?: { kind: "crier" } | { kind: "channel"; channel: ChannelRef; look?: string };
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
}

let state: SquarePanelsState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<SquarePanelsState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

export const squarePanels = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	/** The crier's list: search any channel, read or unread. */
	openCrier() {
		placePanels.close();
		update({ panel: { kind: "crier" }, opening: state.opening + 1 });
	},
	/** Read a channel; `look` is the townsperson who stands for it, whose portrait heads the panel. */
	openChannel(channel: ChannelRef, look?: string) {
		placePanels.close();
		update({ panel: { kind: "channel", channel, look }, opening: state.opening + 1 });
	},
	close() {
		if (state.panel) update({ panel: undefined });
	},
};
