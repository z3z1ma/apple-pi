/**
 * todo-manager.ts — Interactive focus-safe full action surface for /todos.
 *
 * Actions:
 *   - create: create a new todo
 *   - edit: edit title, description, activeForm, agentType, agentProfile
 *   - start: mark open todo as active
 *   - reopen: mark completed todo as open
 *   - complete: mark active/open todo as completed
 *   - blockers: edit dependency IDs
 *   - execute: trigger subagent execution for agent-backed todo
 *   - output: inspect output / result / last error
 *   - stop: stop active managed execution
 *   - recover: recover orphaned/stale execution claim in shared project mode
 *   - delete: delete a single todo
 *   - clear: clear completed or clear all todos
 *   - settings: open data-only settings menu
 *   - close: close manager
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	isKeyRelease,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { TodoView } from "../types.js";

export type TodoManagerAction =
	| { type: "close" }
	| { type: "create" }
	| { type: "edit"; id: number }
	| { type: "start"; id: number }
	| { type: "reopen"; id: number }
	| { type: "complete"; id: number }
	| { type: "blockers"; id: number }
	| { type: "execute"; id: number }
	| { type: "output"; id: number }
	| { type: "stop"; id: number }
	| { type: "recover"; id: number }
	| { type: "delete"; id: number }
	| { type: "clear_completed" }
	| { type: "clear_all" }
	| { type: "settings" };

export interface TodoManagerOptions {
	isProjectStorage?: boolean;
	canExecute?: boolean;
}

export class TodoManagerComponent implements Component {
	private selectedIndex = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly items: readonly TodoView[],
		selectedId: number | undefined,
		private readonly done: (action: TodoManagerAction) => void,
		private readonly options: TodoManagerOptions = {},
	) {
		if (this.items.length > 0) {
			if (selectedId !== undefined) {
				const foundIndex = this.items.findIndex((item) => item.id === selectedId);
				this.selectedIndex = foundIndex >= 0 ? foundIndex : 0;
			} else {
				this.selectedIndex = 0;
			}
		} else {
			this.selectedIndex = 0;
		}
	}

	get selectedTodo(): TodoView | undefined {
		return this.items[this.selectedIndex];
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;

		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) {
			this.done({ type: "close" });
			return;
		}

		if (matchesKey(data, "c")) {
			this.done({ type: "create" });
			return;
		}

		if (matchesKey(data, "s")) {
			this.done({ type: "settings" });
			return;
		}

		if (matchesKey(data, "shift+x") || data === "X") {
			this.done({ type: "clear_all" });
			return;
		}

		if (matchesKey(data, "x")) {
			this.done({ type: "clear_completed" });
			return;
		}

		if (this.items.length === 0) {
			return;
		}

		const currentItem = this.items[this.selectedIndex];
		if (!currentItem) return;

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			if (this.selectedIndex < this.items.length - 1) {
				this.selectedIndex++;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		if (matchesKey(data, "e")) {
			this.done({ type: "edit", id: currentItem.id });
			return;
		}

		if (matchesKey(data, "d")) {
			this.done({ type: "delete", id: currentItem.id });
			return;
		}

		if (matchesKey(data, "b")) {
			this.done({ type: "blockers", id: currentItem.id });
			return;
		}

		if (matchesKey(data, "o")) {
			this.done({ type: "output", id: currentItem.id });
			return;
		}

		if (matchesKey(data, "enter") || matchesKey(data, "space")) {
			if (currentItem.status === "open") {
				if (!currentItem.blocked) {
					this.done({ type: "start", id: currentItem.id });
				}
			} else if (currentItem.status === "active") {
				this.done({ type: "complete", id: currentItem.id });
			} else if (currentItem.status === "completed") {
				this.done({ type: "reopen", id: currentItem.id });
			}
			return;
		}

		if (matchesKey(data, "r")) {
			if (currentItem.status === "completed") {
				this.done({ type: "reopen", id: currentItem.id });
			} else if (currentItem.execution && this.options.isProjectStorage) {
				this.done({ type: "recover", id: currentItem.id });
			}
			return;
		}

		if (matchesKey(data, "x") || matchesKey(data, "v")) {
			if (currentItem.status !== "completed") {
				this.done({ type: "complete", id: currentItem.id });
				return;
			}
		}

		if (matchesKey(data, "t")) {
			if (currentItem.execution) {
				this.done({ type: "stop", id: currentItem.id });
			} else if (currentItem.agentType && currentItem.status === "open" && !currentItem.blocked) {
				this.done({ type: "execute", id: currentItem.id });
			}
			return;
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the manager renders one cohesive list, detail pane, and action legend.
	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		if (this.cachedLines && this.cachedWidth === renderWidth) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const safeLine = (line: string): string =>
			visibleWidth(line) > renderWidth ? truncateToWidth(line, renderWidth, "") : line;
		const add = (text: string) => {
			for (const line of wrapTextWithAnsi(text, renderWidth)) {
				lines.push(safeLine(line));
			}
		};
		const addPrefixed = (prefix: string, text: string) => {
			const prefixW = visibleWidth(prefix);
			if (prefixW >= renderWidth) {
				add(prefix + text);
				return;
			}
			const available = Math.max(1, renderWidth - prefixW);
			const wrapped = wrapTextWithAnsi(text, available);
			const continuation = " ".repeat(prefixW);
			for (let i = 0; i < wrapped.length; i++) {
				const line = (i === 0 ? prefix : continuation) + wrapped[i];
				lines.push(safeLine(line));
			}
		};

		lines.push(safeLine(this.theme.fg("accent", "─".repeat(renderWidth))));

		const completedCount = this.items.filter((t) => t.status === "completed").length;
		const activeCount = this.items.filter((t) => t.status === "active").length;
		const openCount = this.items.filter((t) => t.status === "open").length;
		const countText =
			this.items.length === 0
				? "empty"
				: `${this.items.length} ${this.items.length === 1 ? "todo" : "todos"} (${completedCount} done, ${activeCount} active, ${openCount} open)`;
		const storageTag = this.options.isProjectStorage ? ` [project:shared]` : ` [session]`;
		const headerTitle = ` ${this.theme.fg("accent", this.theme.bold("Todos"))} ${this.theme.fg("muted", countText)}${this.theme.fg("dim", storageTag)}`;
		add(headerTitle);
		lines.push(safeLine(this.theme.fg("borderMuted", "─".repeat(renderWidth))));

		if (this.items.length === 0) {
			lines.push("");
			addPrefixed("  ", this.theme.fg("muted", "No todos in current list."));
			addPrefixed("  ", this.theme.fg("dim", "Press 'c' to create a todo or use todo_create tool."));
			lines.push("");
		} else {
			lines.push("");
			for (let i = 0; i < this.items.length; i++) {
				const item = this.items[i];
				const isSelected = i === this.selectedIndex;
				const cursor = isSelected ? this.theme.fg("accent", "> ") : "  ";
				const idTag = `#${item.id} `;

				let icon: string;
				if (item.status === "completed") {
					icon = this.theme.fg("success", "✔ ");
				} else if (item.status === "active") {
					icon = this.theme.fg("accent", "◼ ");
				} else if (item.blocked) {
					icon = this.theme.fg("warning", "⊘ ");
				} else {
					icon = "◻ ";
				}

				let statusTag = "";
				if (item.status === "active") {
					statusTag = item.execution ? ` [executing]` : ` [active]`;
				} else if (item.blocked) {
					statusTag = ` [blocked by #${item.blockedBy.join(", #")}]`;
				}

				const titleText = `${item.title}${statusTag}`;

				if (isSelected) {
					const label = `${idTag}${titleText}`;
					addPrefixed(cursor, `${icon}${this.theme.fg("accent", this.theme.bold(label))}`);
				} else {
					let styledTitle: string;
					if (item.status === "completed") {
						const strike = this.theme.strikethrough ? this.theme.strikethrough(titleText) : titleText;
						styledTitle = this.theme.fg("dim", strike);
					} else {
						styledTitle = this.theme.fg("text", titleText);
					}
					addPrefixed(`${cursor}${icon}${this.theme.fg("muted", idTag)}`, styledTitle);
				}
			}

			const selected = this.items[this.selectedIndex];
			if (selected) {
				lines.push("");
				lines.push(safeLine(this.theme.fg("borderMuted", "─".repeat(renderWidth))));
				lines.push("");

				const statusStyle =
					selected.status === "completed"
						? this.theme.fg("success", "completed")
						: selected.status === "active"
							? this.theme.fg("accent", selected.execution ? "active (managed execution)" : "active")
							: selected.blocked
								? this.theme.fg("warning", "open (blocked)")
								: this.theme.fg("text", "open");

				const detailHeader = ` ${this.theme.fg("dim", "Selected:")} ${this.theme.fg("accent", this.theme.bold(`#${selected.id} ${selected.title}`))} [${statusStyle}]`;
				add(detailHeader);

				if (selected.description && selected.description.trim().length > 0) {
					lines.push("");
					const descPrefix = "   ";
					const descAvailable = Math.max(1, renderWidth - visibleWidth(descPrefix));
					const descLines = wrapTextWithAnsi(selected.description, descAvailable);
					for (const dLine of descLines) {
						lines.push(safeLine(descPrefix + this.theme.fg("muted", dLine)));
					}
				}

				const metaParts: string[] = [];
				if (selected.activeForm) metaParts.push(`activeForm: "${selected.activeForm}"`);
				if (selected.agentType) metaParts.push(`agent: ${selected.agentType}`);
				if (selected.agentProfile) metaParts.push(`profile: ${selected.agentProfile}`);
				if (selected.blockedBy.length > 0) metaParts.push(`blockedBy: #${selected.blockedBy.join(", #")}`);
				if (selected.blocks.length > 0) metaParts.push(`blocks: #${selected.blocks.join(", #")}`);

				if (metaParts.length > 0) {
					lines.push("");
					addPrefixed("   ", this.theme.fg("dim", metaParts.join(" · ")));
				}

				if (selected.execution) {
					lines.push("");
					const agent = selected.execution.agentId ? `agent: ${selected.execution.agentId}, ` : "";
					const execInfo = `Execution run: ${selected.execution.runId.slice(0, 8)}… (${agent}pid: ${selected.execution.ownerPid}, claimed: ${selected.execution.claimedAt})`;
					addPrefixed("   ", this.theme.fg("accent", execInfo));
				}

				if (selected.lastError) {
					lines.push("");
					addPrefixed("   ", this.theme.fg("error", `Error: ${selected.lastError}`));
				} else if (selected.result) {
					lines.push("");
					const resPreview = selected.result.length > 120 ? `${selected.result.slice(0, 117)}…` : selected.result;
					addPrefixed("   ", this.theme.fg("muted", `Result: ${resPreview}`));
				}
			}
			lines.push("");
		}

		lines.push(safeLine(this.theme.fg("borderMuted", "─".repeat(renderWidth))));

		const footerHelp =
			this.items.length === 0
				? " c Create  ·  s Settings  ·  Esc Close"
				: " Enter/Space Toggle  ·  c New  ·  e Edit  ·  b Blockers  ·  t Exec/Stop  ·  o Output  ·  d Del  ·  x/X Clear  ·  s Settings  ·  Esc Close";
		addPrefixed(" ", this.theme.fg("dim", footerHelp));
		lines.push(safeLine(this.theme.fg("accent", "─".repeat(renderWidth))));

		const result = lines.map((l) => safeLine(l));
		this.cachedWidth = renderWidth;
		this.cachedLines = result;
		return result;
	}
}

export type ManagerUI = {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: any, done: (result: T) => void) => Component,
		options?: { overlay?: boolean; overlayOptions?: any },
	): Promise<T>;
	input?(prompt: string, defaultValue?: string): Promise<string | undefined>;
	select?(title: string, choices: string[]): Promise<string | undefined>;
	notify?(message: string, type?: "info" | "warning" | "error"): void;
};

export async function openTodoManagerModal(
	ui: ManagerUI,
	getTodos: () => TodoView[],
	selectedId: number | undefined,
	options: TodoManagerOptions = {},
): Promise<TodoManagerAction> {
	return ui.custom<TodoManagerAction>((tui, theme, _kb, done) => {
		const items = getTodos();
		return new TodoManagerComponent(tui, theme, items, selectedId, done, options);
	});
}
