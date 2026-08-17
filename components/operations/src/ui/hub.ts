import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { CatalogTask } from "../../../ledger/src/catalog.js";
import type { ActiveTaskProjection } from "../session-state.js";
import { clampLines } from "./bounded-lines.js";
import { type DetailViewState, renderDetailView, scrollDetail } from "./detail-view.js";
import type { Theme } from "./format.js";
import { filterLedgerTasks, type LedgerViewModel, renderLedgerView, selectedLedgerTask } from "./ledger-view.js";

export type HubView = "ledger";

export interface HubActions {
	selectTask(taskPath: string): void;
	clearTask(): void;
}

export interface HubModel {
	view: HubView;
	ledger: LedgerViewModel;
	detail?: DetailViewState;
}

export function createHubModel(active: ActiveTaskProjection, tasks: CatalogTask[] = []): HubModel {
	return {
		view: "ledger",
		ledger: { tasks, query: "", selectedId: tasks[0]?.taskId, active, searchFocused: false },
	};
}

export function renderHub(model: HubModel, theme: Theme, width: number, height = 18): string[] {
	const header = ` ${theme.fg("accent", theme.bold("ledger"))}`;
	if (model.detail) {
		return clampLines([header, ...renderDetailView(model.detail, theme, width, height - 1)], width, height);
	}
	return clampLines([header, ...renderLedgerView(model.ledger, theme, width, height - 1)], width, height);
}

export function handleHubInput(
	model: HubModel,
	data: string,
	actions: HubActions,
	keybindings?: { matches(data: string, id: string): boolean },
): { model: HubModel; close?: boolean } {
	const named =
		data === "right" ||
		data === "left" ||
		data === "tab" ||
		data === "escape" ||
		data === "up" ||
		data === "down" ||
		data === "enter"
			? data
			: undefined;
	const matches = (id: string, fallback: () => boolean) => {
		if (keybindings) return keybindings.matches(data, id);
		if (named === "escape" && id === "tui.select.cancel") return true;
		if (named === "enter" && id === "tui.select.confirm") return true;
		if (named === "up" && id === "tui.select.up") return true;
		if (named === "down" && id === "tui.select.down") return true;
		if (named === "tab" && id === "tui.input.tab") return true;
		return fallback();
	};
	if (model.detail) {
		if (matches("tui.select.cancel", () => matchesKey(data, Key.escape))) {
			return { model: { ...model, detail: undefined } };
		}
		if (matches("tui.select.up", () => matchesKey(data, Key.up))) {
			return { model: { ...model, detail: scrollDetail(model.detail, -1, 16) } };
		}
		if (matches("tui.select.down", () => matchesKey(data, Key.down))) {
			return { model: { ...model, detail: scrollDetail(model.detail, 1, 16) } };
		}
		return { model };
	}
	if (model.ledger.searchFocused) {
		if (matches("tui.select.cancel", () => matchesKey(data, Key.escape))) {
			return { model: { ...model, ledger: { ...model.ledger, searchFocused: false, query: "" } } };
		}
		if (data === "\x7f" || data === "\b") {
			return { model: { ...model, ledger: { ...model.ledger, query: model.ledger.query.slice(0, -1) } } };
		}
		if (data.length === 1 && data >= " ") {
			return { model: { ...model, ledger: { ...model.ledger, query: model.ledger.query + data } } };
		}
	}
	if (matches("tui.select.cancel", () => matchesKey(data, Key.escape))) return { model, close: true };
	if (data === "/") {
		return { model: { ...model, ledger: { ...model.ledger, searchFocused: true } } };
	}
	return handleLedgerKeys(model, data, actions, matches);
}

function handleLedgerKeys(
	model: HubModel,
	data: string,
	actions: HubActions,
	matches: (id: string, fallback: () => boolean) => boolean,
): { model: HubModel; close?: boolean } {
	const visible = filterLedgerTasks(model.ledger.tasks, model.ledger.query);
	const selected = selectedLedgerTask(model.ledger);
	if (matches("tui.select.down", () => matchesKey(data, Key.down)) && selected) {
		const index = Math.min(visible.length - 1, visible.findIndex((task) => task.taskId === selected.taskId) + 1);
		return { model: { ...model, ledger: { ...model.ledger, selectedId: visible[index]?.taskId } } };
	}
	if (matches("tui.select.up", () => matchesKey(data, Key.up)) && selected) {
		const index = Math.max(0, visible.findIndex((task) => task.taskId === selected.taskId) - 1);
		return { model: { ...model, ledger: { ...model.ledger, selectedId: visible[index]?.taskId } } };
	}
	if (!selected) return { model };
	if (matches("tui.select.confirm", () => matchesKey(data, Key.enter))) {
		return {
			model: {
				...model,
				detail: {
					lines: [
						selected.taskPath,
						selected.title,
						`status ${selected.status}`,
						`WI ${selected.workItems.complete}/${selected.workItems.total}`,
						`digest ${selected.digest.slice(0, 12)}`,
					],
					offset: 0,
					confirmingStop: false,
					canStop: false,
					stopBlockedReason: "Task inspect is read-only",
				},
			},
		};
	}
	if (data === "s") {
		actions.selectTask(selected.taskPath);
		return { model };
	}
	if (data === "c") {
		actions.clearTask();
		return { model };
	}
	return { model };
}
