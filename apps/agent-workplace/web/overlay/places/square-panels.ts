import type { SlackChannel } from "../../../src/integrations.js";
import { onePanel } from "../one-panel.js";

export type ChannelRef = Pick<SlackChannel, "id" | "name" | "kind"> & Partial<Pick<SlackChannel, "unread" | "more">>;

export interface MessageRef {
	ts: string;
	threadTs?: string;
}

export interface SquarePanelsState {
	panel?: { kind: "crier" } | { kind: "channel"; channel: ChannelRef; look?: string; focus?: MessageRef };

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

	openCrier() {
		onePanel.opening("square");
		update({ panel: { kind: "crier" }, opening: state.opening + 1 });
	},

	openChannel(channel: ChannelRef, look?: string, focus?: MessageRef) {
		onePanel.opening("square");
		update({ panel: { kind: "channel", channel, look, ...(focus ? { focus } : {}) }, opening: state.opening + 1 });
	},
	close() {
		if (state.panel) update({ panel: undefined });
	},
};
onePanel.closes("square", () => squarePanels.close());
