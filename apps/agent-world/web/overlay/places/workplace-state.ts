import type { AgentWorldApi, WorkplaceTask } from "../../../src/world.js";
import { say } from "../../theme.js";
import { themeStore } from "../../theme-store.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";
import type { Progress } from "./place-panels.js";

export interface WorkplacePanel {
	kind: "tasks" | "team" | "meetings";
	headquarters: string;
	team?: string;
}

interface WorkplaceState {
	panel?: WorkplacePanel;
	task?: string;
	opening: number;
	carrying?: WorkplaceTask;
	progress?: Progress;
	api?: Pick<AgentWorldApi, "assignTask">;
	view?: ViewStore;
}

let state: WorkplaceState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<WorkplaceState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

export const workplacePanels = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: Pick<AgentWorldApi, "assignTask">, view: ViewStore) {
		update({ api, view });
	},
	open(panel: WorkplacePanel, task?: string) {
		onePanel.opening("workplace");
		update({ panel, task, opening: state.opening + 1 });
	},
	close() {
		if (state.panel) update({ panel: undefined, task: undefined });
	},
	/** Carrying is an intention in this window; giving asks the runtime to change ownership. */
	carry(task: WorkplaceTask) {
		if (state.progress?.state === "sending") return;
		update({ carrying: task, progress: undefined, panel: undefined, task: undefined });
	},
	drop() {
		if (state.progress?.state !== "sending") update({ carrying: undefined, progress: undefined });
	},
	async give(person: { id: string; name: string }) {
		const { api, view, carrying } = state;
		if (!api || !carrying || state.progress?.state === "sending") return;
		update({ progress: { state: "sending", text: say(themeStore.get(), "task-giving", { name: person.name }) } });
		try {
			const receipt = await api.assignTask(person.id, carrying.id);
			if (!receipt.ok) {
				update({ progress: { state: "failed", text: receipt.reason } });
				view?.notify(receipt.reason);
				return;
			}
			const text = say(themeStore.get(), "task-given", { name: person.name, title: carrying.title });
			update({ carrying: undefined, progress: { state: "done", text } });
			view?.notify(text);
		} catch (error) {
			const text = String((error as Error)?.message ?? error);
			update({ progress: { state: "failed", text } });
			view?.notify(text);
		}
	},
};

onePanel.closes("workplace", () => workplacePanels.close());
