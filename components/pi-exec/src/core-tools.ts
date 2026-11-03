import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createExecBashToolDefinition } from "../../tasks/src/bash-tool.js";

const CORE_TOOL_FACTORIES = {
	read: createReadToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
	bash: createExecBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
} as const;

export type CoreToolName = keyof typeof CORE_TOOL_FACTORIES;

export const CORE_TOOL_NAMES = Object.keys(CORE_TOOL_FACTORIES) as CoreToolName[];

export const ENVELOPE_TOOL_NAMES: ReadonlySet<string> = new Set<CoreToolName>(["bash", "edit", "write"]);

export function isCoreToolName(name: string): name is CoreToolName {
	return Object.hasOwn(CORE_TOOL_FACTORIES, name);
}

const builtDefinitions = new Map<string, Partial<Record<CoreToolName, ToolDefinition<any, any>>>>();

export function coreToolDefinition(name: CoreToolName, cwd: string): ToolDefinition<any, any> {
	let built = builtDefinitions.get(cwd);
	if (!built) {
		built = {};
		builtDefinitions.set(cwd, built);
	}
	built[name] ??= CORE_TOOL_FACTORIES[name](cwd);
	return built[name];
}
