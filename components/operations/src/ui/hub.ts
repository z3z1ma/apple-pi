import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { CatalogTask } from "../../../ralph/src/catalog.js";
import type { ActiveTaskProjection } from "../session-state.js";
import { clampLines } from "./bounded-lines.js";
import { type DetailViewState, renderDetailView, scrollDetail } from "./detail-view.js";
import type { Theme } from "./format.js";
import { filterLedgerTasks, type LedgerViewModel, renderLedgerView, selectedLedgerTask } from "./ledger-view.js";
import type { RalphViewRow } from "./ralph-view.js";
import { renderRalphDetail, renderRalphView } from "./ralph-view.js";
import type { ReviewViewRow } from "./review-view.js";
import { renderReviewDetail, renderReviewView } from "./review-view.js";

export type HubView = "ledger" | "ralph" | "review";

export interface HubActions {
	selectTask(taskPath: string): void;
	clearTask(): void;
	startRalph(taskPath: string): void;
	runRalph(taskPath: string): void;
	stopRalph(projectRoot: string, runId: string): Promise<void> | void;
	stopReview(projectRoot: string, runId: string): Promise<void> | void;
}

export interface HubModel {
	view: HubView;
	ledger: LedgerViewModel;
	ralph: RalphViewRow[];
	reviews: ReviewViewRow[];
	selectedRalphId?: string;
	selectedReviewId?: string;
	detail?: DetailViewState;
}

export function createHubModel(active: ActiveTaskProjection, tasks: CatalogTask[] = []): HubModel {
	return {
		view: "ledger",
		ledger: { tasks, query: "", selectedId: tasks[0]?.taskId, active, searchFocused: false },
		ralph: [],
		reviews: [],
	};
}

export function renderHub(model: HubModel, theme: Theme, width: number, height = 18): string[] {
	const tabs = (["ledger", "ralph", "review"] as const)
		.map((view) => (view === model.view ? theme.fg("accent", theme.bold(view)) : theme.fg("dim", view)))
		.join("  ");
	const header = ` ${tabs}`;
	if (model.detail) {
		return clampLines([header, ...renderDetailView(model.detail, theme, width, height - 1)], width, height);
	}
	const body =
		model.view === "ledger"
			? renderLedgerView(model.ledger, theme, width, height - 1)
			: model.view === "ralph"
				? renderRalphView(model.ralph, model.selectedRalphId, theme, width, height - 1)
				: renderReviewView(model.reviews, model.selectedReviewId, theme, width, height - 1);
	return clampLines([header, ...body], width, height);
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
			if (model.detail.confirmingStop)
				return { model: { ...model, detail: { ...model.detail, confirmingStop: false } } };
			return { model: { ...model, detail: undefined } };
		}
		if (matches("tui.select.up", () => matchesKey(data, Key.up))) {
			return { model: { ...model, detail: scrollDetail(model.detail, -1, 16) } };
		}
		if (matches("tui.select.down", () => matchesKey(data, Key.down))) {
			return { model: { ...model, detail: scrollDetail(model.detail, 1, 16) } };
		}
		if (data === "s" || data === "S") {
			if (!model.detail.canStop) return { model };
			if (!model.detail.confirmingStop)
				return { model: { ...model, detail: { ...model.detail, confirmingStop: true } } };
			void confirmStop(model, actions);
			return { model: { ...model, detail: { ...model.detail, confirmingStop: false } } };
		}
		return { model };
	}
	if (model.view === "ledger" && model.ledger.searchFocused) {
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
	if (matches("tui.input.tab", () => matchesKey(data, Key.tab)) || matchesKey(data, Key.right) || named === "right") {
		return { model: { ...model, view: nextView(model.view, 1) } };
	}
	if (matchesKey(data, Key.left) || named === "left" || matchesKey(data, Key.shift("tab"))) {
		return { model: { ...model, view: nextView(model.view, -1) } };
	}
	if (data === "/" && model.view === "ledger") {
		return { model: { ...model, ledger: { ...model.ledger, searchFocused: true } } };
	}
	if (model.view === "ledger") return handleLedgerKeys(model, data, actions, matches);
	if (model.view === "ralph") return handleRalphKeys(model, data, matches);
	return handleReviewKeys(model, data, matches);
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
	if (data === "r") {
		actions.startRalph(selected.taskPath);
		return { model };
	}
	if (data === "R") {
		actions.runRalph(selected.taskPath);
		return { model };
	}
	return { model };
}

function handleRalphKeys(
	model: HubModel,
	data: string,
	matches: (id: string, fallback: () => boolean) => boolean,
): { model: HubModel } {
	if (matches("tui.select.down", () => matchesKey(data, Key.down))) {
		return {
			model: {
				...model,
				selectedRalphId: moveId(
					model.ralph.map((row) => row.runId),
					model.selectedRalphId,
					1,
				),
			},
		};
	}
	if (matches("tui.select.up", () => matchesKey(data, Key.up))) {
		return {
			model: {
				...model,
				selectedRalphId: moveId(
					model.ralph.map((row) => row.runId),
					model.selectedRalphId,
					-1,
				),
			},
		};
	}
	const row = model.ralph.find((entry) => entry.runId === model.selectedRalphId) ?? model.ralph[0];
	if (row && matches("tui.select.confirm", () => matchesKey(data, Key.enter))) {
		const lines = row.live
			? ["Ralph detail"].concat(Object.entries(row.live).map(([key, value]) => `${key} ${String(value).slice(0, 80)}`))
			: [`${row.runId}`];
		return {
			model: {
				...model,
				selectedRalphId: row.runId,
				detail: {
					lines: row.live ? renderRalphDetail(row.live, { fg: (_c, text) => text, bold: (text) => text }, 120) : lines,
					offset: 0,
					confirmingStop: false,
					canStop: row.ownership.kind === "owned",
					stopBlockedReason:
						row.ownership.kind === "foreign" ? `Owned by process ${row.ownership.pid}` : "Not a live owned run",
				},
			},
		};
	}
	return { model };
}

function handleReviewKeys(
	model: HubModel,
	data: string,
	matches: (id: string, fallback: () => boolean) => boolean,
): { model: HubModel } {
	if (matches("tui.select.down", () => matchesKey(data, Key.down))) {
		return {
			model: {
				...model,
				selectedReviewId: moveId(
					model.reviews.map((row) => row.runId),
					model.selectedReviewId,
					1,
				),
			},
		};
	}
	if (matches("tui.select.up", () => matchesKey(data, Key.up))) {
		return {
			model: {
				...model,
				selectedReviewId: moveId(
					model.reviews.map((row) => row.runId),
					model.selectedReviewId,
					-1,
				),
			},
		};
	}
	const row = model.reviews.find((entry) => entry.runId === model.selectedReviewId) ?? model.reviews[0];
	if (row && matches("tui.select.confirm", () => matchesKey(data, Key.enter))) {
		return {
			model: {
				...model,
				selectedReviewId: row.runId,
				detail: {
					lines: row.live
						? renderReviewDetail(row.live, { fg: (_c, text) => text, bold: (text) => text }, 120)
						: [row.runId, row.ownership.kind],
					offset: 0,
					confirmingStop: false,
					canStop: row.ownership.kind === "owned",
					stopBlockedReason:
						row.ownership.kind === "nested"
							? "Stop the owning Ralph run"
							: row.ownership.kind === "foreign"
								? `Owned by process ${row.ownership.pid}`
								: "Not a live owned run",
				},
			},
		};
	}
	return { model };
}

function confirmStop(model: HubModel, actions: HubActions): void {
	if (model.view === "ralph") {
		const row = model.ralph.find((entry) => entry.runId === model.selectedRalphId);
		if (row?.ownership.kind === "owned") void actions.stopRalph(row.workspaceRoot, row.runId);
		return;
	}
	if (model.view === "review") {
		const row = model.reviews.find((entry) => entry.runId === model.selectedReviewId);
		if (row?.ownership.kind === "owned" && row.live) void actions.stopReview(row.live.projectRoot, row.runId);
	}
}

function nextView(view: HubView, delta: number): HubView {
	const order: HubView[] = ["ledger", "ralph", "review"];
	const index = order.indexOf(view);
	return order[(index + delta + order.length) % order.length]!;
}

function moveId(ids: string[], current: string | undefined, delta: number): string | undefined {
	if (ids.length === 0) return current;
	const index = Math.max(0, ids.indexOf(current ?? ids[0]!));
	return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}
