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

/** Pi core tools callable from programs. */
export const CORE_TOOL_NAMES = Object.keys(CORE_TOOL_FACTORIES) as CoreToolName[];

/** Core tools that report failure to the program as `{ ok: false, output }` instead of raising. */
export const ENVELOPE_TOOL_NAMES: ReadonlySet<string> = new Set<CoreToolName>(["bash", "edit", "write"]);

export function isCoreToolName(name: string): name is CoreToolName {
	return Object.hasOwn(CORE_TOOL_FACTORIES, name);
}

const builtDefinitions = new Map<string, Partial<Record<CoreToolName, ToolDefinition<any, any>>>>();

/** Pi's own definition of a core tool, for signatures and for calls Pi cannot run because the tool is inactive. */
export function coreToolDefinition(name: CoreToolName, cwd: string): ToolDefinition<any, any> {
	let built = builtDefinitions.get(cwd);
	if (!built) {
		built = {};
		builtDefinitions.set(cwd, built);
	}
	built[name] ??= CORE_TOOL_FACTORIES[name](cwd);
	return built[name];
}
