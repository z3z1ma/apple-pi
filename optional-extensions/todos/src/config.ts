import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { TodosConfig } from "./types.js";

export const DEFAULT_TODOS_CONFIG: Required<TodosConfig> = {
	storage: "session",
	autoCascade: false,
	autoClearCompleted: "on_list_complete",
	reminders: true,
	sortOrder: "id",
	collapseCompleted: false,
	maxVisible: 10,
};

export interface TodosConfigLayers {
	global: TodosConfig;
	project: TodosConfig;
	effective: Required<TodosConfig>;
}

export function sanitizeTodosConfig(value: unknown): TodosConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const input = value as Record<string, unknown>;
	const config: TodosConfig = {};
	if (input.storage === "session" || input.storage === "project") config.storage = input.storage;
	if (typeof input.autoCascade === "boolean") config.autoCascade = input.autoCascade;
	if (
		input.autoClearCompleted === "never" ||
		input.autoClearCompleted === "on_list_complete" ||
		input.autoClearCompleted === "on_todo_complete"
	)
		config.autoClearCompleted = input.autoClearCompleted;
	if (typeof input.reminders === "boolean") config.reminders = input.reminders;
	if (input.sortOrder === "id" || input.sortOrder === "active" || input.sortOrder === "recent")
		config.sortOrder = input.sortOrder;
	if (typeof input.collapseCompleted === "boolean") config.collapseCompleted = input.collapseCompleted;
	if (Number.isInteger(input.maxVisible) && Number(input.maxVisible) > 0 && Number(input.maxVisible) <= 100)
		config.maxVisible = Number(input.maxVisible);
	return config;
}

function load(path: string): TodosConfig {
	try {
		return sanitizeTodosConfig(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return {};
	}
}

export function loadTodosConfigLayers(cwd: string, trusted: boolean, agentDir = getAgentDir()): TodosConfigLayers {
	const global = load(join(agentDir, "todos.json"));
	const project = trusted ? load(join(cwd, ".pi", "todos.json")) : {};
	return { global, project, effective: { ...DEFAULT_TODOS_CONFIG, ...global, ...project } };
}

export function loadTodosConfig(cwd: string, trusted: boolean, agentDir = getAgentDir()): Required<TodosConfig> {
	return loadTodosConfigLayers(cwd, trusted, agentDir).effective;
}
