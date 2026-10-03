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
import { capturedTool } from "./tool-capture.js";

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

/** Pi core tools callable from programs and grantable to agent workers. */
export const CORE_TOOL_NAMES = Object.keys(CORE_TOOL_FACTORIES) as CoreToolName[];

export const READ_ONLY_CORE_TOOL_NAMES: readonly CoreToolName[] = ["read", "grep", "find", "ls"];

/** Core tools that report failure to the program as `{ ok: false, output }` instead of raising. */
export const ENVELOPE_TOOL_NAMES: ReadonlySet<string> = new Set<CoreToolName>(["bash", "edit", "write"]);

export function isCoreToolName(name: string): name is CoreToolName {
	return Object.hasOwn(CORE_TOOL_FACTORIES, name);
}

const builtDefinitions = new Map<string, Partial<Record<CoreToolName, ToolDefinition<any, any>>>>();

/** Programs always use pi_exec's bash; other core tools prefer the registered definition so extension overrides apply. */
export function coreToolDefinition(name: CoreToolName, cwd: string): ToolDefinition<any, any> {
	if (name !== "bash") {
		const registered = capturedTool(name)?.definition;
		if (registered) return registered;
	}
	let built = builtDefinitions.get(cwd);
	if (!built) {
		built = {};
		builtDefinitions.set(cwd, built);
	}
	built[name] ??= CORE_TOOL_FACTORIES[name](cwd);
	return built[name];
}
