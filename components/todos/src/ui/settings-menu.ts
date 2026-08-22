/**
 * settings-menu.ts — Data-only settings menu for approved config keys in /todos.
 *
 * Uses SettingsList from @earendil-works/pi-tui for keyboard navigation and value cycling.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import type { TodosConfig } from "../types.js";

export type SettingsUI = {
	notify?(message: string, type?: "info" | "warning" | "error"): void;
	custom<T>(
		factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => any,
		options?: { overlay?: boolean; overlayOptions?: any },
	): Promise<T>;
};

export function saveProjectTodosConfig(overrides: TodosConfig, cwd: string, trusted: boolean): void {
	if (!trusted) throw new Error("Todo project settings require a trusted project");
	const path = join(cwd, ".pi", "todos.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
}

function updateOverride(
	overrides: TodosConfig,
	effective: TodosConfig,
	globalDefaults: Required<TodosConfig>,
	key: keyof TodosConfig,
): void {
	const value = effective[key];
	if (value === globalDefaults[key]) delete overrides[key];
	else (overrides as Record<string, unknown>)[key] = value;
}

function safeSettingsListTheme() {
	try {
		return getSettingsListTheme();
	} catch {
		return {
			selectedPrefix: (text: string) => text,
			selectedText: (text: string) => text,
			description: (text: string) => text,
			scrollInfo: (text: string) => text,
			noMatch: (text: string) => text,
		} as any;
	}
}

export async function openSettingsMenu(
	ui: SettingsUI,
	cfg: Required<TodosConfig>,
	projectOverrides: TodosConfig,
	globalDefaults: Required<TodosConfig>,
	cwd: string,
	trusted: boolean,
	onBack: () => Promise<void>,
	onError: (error: unknown) => void,
): Promise<void> {
	if (!trusted) throw new Error("Todo settings require a trusted project");
	await ui.custom((_tui, theme, _kb, done) => {
		const items: SettingItem[] = [
			{
				id: "storage",
				label: "Todo storage",
				description:
					"session: persisted per session branch, survives resume and branching. " +
					"project: shared across sessions in .pi/todos/shared.json (requires trusted project). " +
					"Takes effect on next session start.",
				currentValue: cfg.storage ?? "session",
				values: ["session", "project"],
			},
			{
				id: "autoCascade",
				label: "Auto-cascade agent todos",
				description:
					"When ON: pending agent-backed todos start automatically once their dependencies complete. " +
					"When OFF: launch execution manually via manager or tool.",
				currentValue: cfg.autoCascade ? "on" : "off",
				values: ["on", "off"],
			},
			{
				id: "autoClearCompleted",
				label: "Auto-clear completed todos",
				description:
					"never: completed todos stay visible until manually cleared. " +
					"on_list_complete: cleared automatically after all todos are done. " +
					"on_todo_complete: each todo cleared shortly after it completes. " +
					"Never mutates shared project lists.",
				currentValue: cfg.autoClearCompleted ?? "never",
				values: ["never", "on_list_complete", "on_todo_complete"],
			},
			{
				id: "reminders",
				label: "Model reminders",
				description: "Inject transient system reminder into model context when todo tools have not been used recently.",
				currentValue: (cfg.reminders ?? true) ? "on" : "off",
				values: ["on", "off"],
			},
			{
				id: "sortOrder",
				label: "Widget sort order",
				description:
					"id: ordered by monotonic ID. " +
					"active: groups active → open → completed. " +
					"recent: most recently updated first.",
				currentValue: cfg.sortOrder ?? "id",
				values: ["id", "active", "recent"],
			},
			{
				id: "collapseCompleted",
				label: "Collapse completed todos in widget",
				description:
					"When ON, completed todos are collapsed into a single summary line. When OFF, they are listed individually.",
				currentValue: cfg.collapseCompleted ? "on" : "off",
				values: ["on", "off"],
			},
			{
				id: "maxVisible",
				label: "Max visible todos in widget",
				description: "Maximum number of visible todo lines shown in the widget before overflow collapse.",
				currentValue: String(cfg.maxVisible ?? 10),
				values: ["5", "10", "15", "20", "30", "50"],
			},
		];

		const list = new SettingsList(
			items,
			10,
			safeSettingsListTheme(),
			(id, newValue) => {
				if (id === "storage") {
					cfg.storage = newValue as "session" | "project";
				} else if (id === "autoCascade") {
					cfg.autoCascade = newValue === "on";
				} else if (id === "autoClearCompleted") {
					cfg.autoClearCompleted = newValue as Required<TodosConfig>["autoClearCompleted"];
				} else if (id === "reminders") {
					cfg.reminders = newValue === "on";
				} else if (id === "sortOrder") {
					cfg.sortOrder = newValue as Required<TodosConfig>["sortOrder"];
				} else if (id === "collapseCompleted") {
					cfg.collapseCompleted = newValue === "on";
				} else if (id === "maxVisible") {
					cfg.maxVisible = Number(newValue);
				}
				updateOverride(projectOverrides, cfg, globalDefaults, id as keyof TodosConfig);
				try {
					saveProjectTodosConfig(projectOverrides, cwd, trusted);
				} catch (error) {
					onError(error);
				}
			},
			() => done(undefined),
		);

		class SettingsPanel extends Container {
			handleInput(data: string) {
				list.handleInput(data);
			}
		}

		const root = new SettingsPanel();
		root.addChild(new Text(theme.bold(theme.fg("accent", "⚙  Todo Settings")), 0, 0));
		root.addChild(new Spacer(1));
		root.addChild(list);

		return root;
	});

	return onBack();
}
