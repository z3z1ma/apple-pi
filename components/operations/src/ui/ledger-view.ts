import { fuzzyFilter } from "@earendil-works/pi-tui";
import { type CatalogTask, catalogSearchText } from "../../../ledger/src/catalog.js";
import type { ActiveTaskProjection } from "../session-state.js";
import { clampLine } from "./bounded-lines.js";
import { oneLine, type Theme } from "./format.js";

export interface LedgerViewModel {
	tasks: CatalogTask[];
	query: string;
	selectedId?: string;
	active: ActiveTaskProjection;
	searchFocused: boolean;
}

export function filterLedgerTasks(tasks: CatalogTask[], query: string): CatalogTask[] {
	const trimmed = query.trim();
	if (!trimmed) return tasks;
	return fuzzyFilter(tasks, trimmed, catalogSearchText);
}

export function selectedLedgerTask(model: LedgerViewModel): CatalogTask | undefined {
	const visible = filterLedgerTasks(model.tasks, model.query);
	return visible.find((task) => task.taskId === model.selectedId) ?? visible[0];
}

export function renderLedgerView(model: LedgerViewModel, theme: Theme, width: number, height = 16): string[] {
	const visible = filterLedgerTasks(model.tasks, model.query);
	const selected = selectedLedgerTask(model);
	const query = model.searchFocused ? `${model.query}█` : model.query || "type to filter";
	const lines = [
		clampLine(`${theme.fg("accent", "Ledger")}  ${theme.fg("dim", `${visible.length}/${model.tasks.length}`)}`, width),
		clampLine(`${theme.fg(model.searchFocused ? "accent" : "dim", "/")} ${theme.fg("muted", query)}`, width),
	];
	if (model.active.pointer) {
		const stale = model.active.stale ? theme.fg("warning", ` stale:${model.active.stale}`) : "";
		lines.push(clampLine(`${theme.fg("dim", "active")} ${model.active.pointer.taskPath}${stale}`, width));
	}
	if (visible.length === 0) {
		lines.push(clampLine(theme.fg("warning", "No matching indexed tasks"), width));
	}
	const budget = Math.max(3, height - lines.length - 2);
	for (const task of visible.slice(0, budget)) {
		const marker = task.taskId === selected?.taskId ? theme.fg("accent", "●") : theme.fg("dim", "○");
		const active = model.active.pointer?.taskPath === task.taskPath ? theme.fg("accent", " active") : "";
		lines.push(
			clampLine(
				`${marker} ${theme.fg("muted", task.status)} ${oneLine(task.title, 42)} ${theme.fg("dim", `WI ${task.workItems.complete}/${task.workItems.total}`)}${active}`,
				width,
			),
		);
	}
	lines.push(
		clampLine(theme.fg("dim", "Enter inspect · s select · c clear · r start · R run · / search · Esc back"), width),
	);
	return lines;
}
