/**
 * todo-widget.ts — Width-safe persistent widget showing todo list above the editor.
 *
 * Visual hierarchy:
 *   ● Header: N todos (X done, Y active, Z open)
 *   ✔ Completed todos (strikethrough + dim)
 *   ◼ Active todos (manual active)
 *   ✳ Active managed executing todos (spinner + activeForm/title + agent tag + elapsed/token stats)
 *   ◻ Pending / Open todos (with optional blocked by indicator)
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { TodosConfig, TodoView } from "../types.js";

export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
	strikethrough?(text: string): string;
};

export type UICtx = {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| undefined
			| ((
					tui: any,
					theme: Theme,
			  ) => {
					render(width?: number): string[];
					invalidate(): void;
					dispose?(): void;
			  }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
};

export const SPINNER = ["✳", "✴", "✵", "✶", "✷", "✸", "✹", "✺", "✻", "✼", "✽"];
export const DEFAULT_MAX_VISIBLE = 10;
export const WIDGET_KEY = "todos";

export interface TodoMetrics {
	startedAt: number;
	inputTokens: number;
	outputTokens: number;
	turnCount: number;
	toolCount: number;
	activity?: string;
}

export function formatDuration(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	if (totalSec < 60) return `${totalSec}s`;
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
	const hr = Math.floor(min / 60);
	const remMin = min % 60;
	return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function truncateBottom<T>(items: T[], limit: number): T[] {
	return items.slice(0, limit);
}

export function sortTodos(todos: readonly TodoView[], order: TodosConfig["sortOrder"] = "id"): TodoView[] {
	const list = [...todos];
	if (order === "active") {
		const rank = (t: TodoView) => (t.status === "active" ? 0 : t.status === "open" ? 1 : 2);
		return list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
	}
	if (order === "recent") {
		return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id);
	}
	return list.sort((a, b) => a.id - b.id);
}

export class TodoWidget {
	private uiCtx: UICtx | undefined;
	private widgetFrame = 0;
	private widgetInterval: ReturnType<typeof setInterval> | undefined;
	private activeRunIds = new Set<number>();
	private metrics = new Map<number, TodoMetrics>();
	private tui: any | undefined;
	private widgetRegistered = false;

	constructor(
		private getTodos: () => TodoView[],
		private config: TodosConfig = {},
	) {}

	setGetTodos(getTodos: () => TodoView[]): void {
		this.getTodos = getTodos;
	}

	setConfig(config: TodosConfig): void {
		this.config = config;
		this.update();
	}

	setUICtx(ctx: UICtx | undefined): void {
		this.uiCtx = ctx;
	}

	setActiveRun(todoId: number, active = true): void {
		if (active) {
			this.activeRunIds.add(todoId);
			if (!this.metrics.has(todoId)) {
				this.metrics.set(todoId, {
					startedAt: Date.now(),
					inputTokens: 0,
					outputTokens: 0,
					turnCount: 0,
					toolCount: 0,
				});
			}
			this.ensureTimer();
		} else {
			this.activeRunIds.delete(todoId);
			this.metrics.delete(todoId);
		}
		this.update();
	}

	updateActivity(todoId: number, activity: { turnCount: number; toolCount: number; label: string }): void {
		this.setActiveRun(todoId);
		const metrics = this.metrics.get(todoId);
		if (!metrics) return;
		metrics.turnCount = activity.turnCount;
		metrics.toolCount = activity.toolCount;
		metrics.activity = activity.label;
		this.update();
	}

	addTokenUsage(inputTokens: number, outputTokens: number, todoId?: number): void {
		if (todoId !== undefined) {
			const m = this.metrics.get(todoId);
			if (m) {
				m.inputTokens += inputTokens;
				m.outputTokens += outputTokens;
			}
			return;
		}
		for (const id of this.activeRunIds) {
			const m = this.metrics.get(id);
			if (m) {
				m.inputTokens += inputTokens;
				m.outputTokens += outputTokens;
			}
		}
	}

	ensureTimer(): void {
		if (!this.widgetInterval) {
			this.widgetInterval = setInterval(() => {
				this.widgetFrame++;
				if (this.tui) {
					this.tui.requestRender();
				}
			}, 150);
		}
	}

	renderWidget(tui: any, theme: Theme, customWidth?: number): string[] {
		try {
			return this.buildWidgetLines(tui, theme, customWidth);
		} catch {
			return [];
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one renderer owns the ordered, width-bounded presentation for every to-do state.
	buildWidgetLines(tui: any, theme: Theme, customWidth?: number): string[] {
		const allTodos = this.getTodos();
		const w = Math.max(1, customWidth ?? tui?.terminal?.columns ?? 80);
		const truncate = (line: string) => truncateToWidth(line, w);

		if (allTodos.length === 0) return [];

		const sorted = sortTodos(allTodos, this.config.sortOrder);
		const completed = sorted.filter((t) => t.status === "completed");
		const active = sorted.filter((t) => t.status === "active");
		const open = sorted.filter((t) => t.status === "open");

		const parts: string[] = [];
		if (completed.length > 0) parts.push(`${completed.length} done`);
		if (active.length > 0) parts.push(`${active.length} active`);
		if (open.length > 0) parts.push(`${open.length} open`);
		const statusText = `${allTodos.length} ${allTodos.length === 1 ? "todo" : "todos"} (${parts.join(", ")})`;

		const spinnerChar = SPINNER[this.widgetFrame % SPINNER.length];
		const lines: string[] = [truncate(`${theme.fg("accent", "●")} ${theme.fg("accent", statusText)}`)];

		const collapseCompleted = this.config.collapseCompleted ?? false;
		const listed = collapseCompleted ? sorted.filter((t) => t.status !== "completed") : sorted;
		const limit = this.config.maxVisible ?? DEFAULT_MAX_VISIBLE;
		const visible = truncateBottom(listed, limit);
		const hiddenCount = listed.length - visible.length;

		for (const todo of visible) {
			const isManagedActive = (this.activeRunIds.has(todo.id) || !!todo.execution) && todo.status === "active";

			let icon: string;
			if (isManagedActive) {
				icon = theme.fg("accent", spinnerChar);
			} else if (todo.status === "completed") {
				icon = theme.fg("success", "✔");
			} else if (todo.status === "active") {
				icon = theme.fg("accent", "◼");
			} else {
				icon = "◻";
			}

			let suffix = "";
			if (todo.status === "open" && todo.blockedBy.length > 0) {
				const openBlockers = todo.blockedBy.filter((bid) => {
					const blocker = allTodos.find((item) => item.id === bid);
					return blocker && blocker.status !== "completed";
				});
				if (openBlockers.length > 0) {
					suffix = theme.fg("dim", ` › blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}`);
				}
			}

			let text: string;
			if (isManagedActive) {
				const form = todo.activeForm || todo.title;
				const metrics = this.metrics.get(todo.id);
				const agentTag = todo.agentType ? ` (${todo.agentType})` : "";
				const m = metrics;
				const startedAt = m?.startedAt ?? (todo.execution ? Date.parse(todo.execution.claimedAt) : Date.now());
				const elapsed = formatDuration(Date.now() - startedAt);
				const details: string[] = [];
				const tokens = [
					m?.inputTokens ? `↑ ${formatTokens(m.inputTokens)}` : "",
					m?.outputTokens ? `↓ ${formatTokens(m.outputTokens)}` : "",
				]
					.filter(Boolean)
					.join(" ");
				if (tokens) details.push(tokens);
				if (m?.turnCount) details.push(`${m.turnCount}t`);
				if (m?.toolCount) details.push(`${m.toolCount} tools`);
				const stats = ` ${theme.fg("dim", `(${[elapsed, ...details].join(" · ")})`)}`;
				const activity = m?.activity ? ` ${theme.fg("dim", `· ${m.activity}`)}` : "";
				text = `  ${icon} ${theme.fg("dim", `#${todo.id}`)} ${theme.fg("accent", `${form}${agentTag}…`)}${stats}${activity}`;
			} else if (todo.status === "completed") {
				const strike = theme.strikethrough
					? theme.strikethrough(`#${todo.id} ${todo.title}`)
					: `#${todo.id} ${todo.title}`;
				text = `  ${icon} ${theme.fg("dim", strike)}`;
			} else {
				const agentTag = todo.status === "active" && todo.agentType ? theme.fg("dim", ` (${todo.agentType})`) : "";
				text = `  ${icon} ${theme.fg("dim", `#${todo.id}`)} ${todo.title}${agentTag}`;
			}

			lines.push(truncate(text + suffix));
		}

		if (hiddenCount > 0) {
			lines.push(truncate(theme.fg("dim", `    … and ${hiddenCount} more`)));
		}

		if (collapseCompleted && completed.length > 0) {
			lines.push(truncate(`  ${theme.fg("success", "✔")} ${theme.fg("dim", `${completed.length} completed`)}`));
		}

		return lines;
	}

	update(): void {
		if (!this.uiCtx) return;
		const todos = this.getTodos();

		if (todos.length === 0) {
			if (this.widgetRegistered) {
				this.uiCtx.setWidget(WIDGET_KEY, undefined);
				this.widgetRegistered = false;
			}
			if (this.widgetInterval) {
				clearInterval(this.widgetInterval);
				this.widgetInterval = undefined;
			}
			return;
		}

		// Prune stale active IDs
		for (const id of this.activeRunIds) {
			const t = todos.find((item) => item.id === id);
			if (t?.status !== "active") {
				this.activeRunIds.delete(id);
				this.metrics.delete(id);
			}
		}

		const hasActiveSpinner = todos.some((t) => (this.activeRunIds.has(t.id) || !!t.execution) && t.status === "active");
		if (hasActiveSpinner) {
			this.ensureTimer();
		} else if (!hasActiveSpinner && this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}

		if (!this.widgetRegistered) {
			this.uiCtx.setWidget(
				WIDGET_KEY,
				(tui, theme) => {
					this.tui = tui;
					return {
						render: (w) => this.renderWidget(tui, theme, w),
						invalidate: () => {},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
		} else if (this.tui) {
			this.tui.requestRender();
		}
	}

	dispose(): void {
		if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}
		if (this.uiCtx) {
			this.uiCtx.setWidget(WIDGET_KEY, undefined);
		}
		this.widgetRegistered = false;
		this.tui = undefined;
	}
}
