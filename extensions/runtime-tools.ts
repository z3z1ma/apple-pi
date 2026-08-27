import { ExtensionRunner, type RegisteredTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { inChildSessionContext } from "../components/subagents/src/child-context.js";
import { SUBAGENT_TOOL_NAMES } from "../components/subagents/src/nested-tools.js";

interface ToolCaptureHub {
	children: WeakSet<ExtensionRunner>;
	latest: RegisteredTool[];
}

const CAPTURE_HUB = Symbol.for("apple-pi.registered-tool-capture.v1");
const EXCLUDED_TOOL_NAMES = new Set(["pi_exec", "pi_exec_program", ...Object.values(SUBAGENT_TOOL_NAMES)]);

/**
 * Observe Pi's public registered-tool assembly point. Pi exposes custom-tool
 * schemas through ExtensionAPI but no nested invocation method; retaining the
 * definitions here is the narrow bridge needed by pi_exec.
 */
export const installRegisteredToolCapture = (): void => {
	const prototype = ExtensionRunner.prototype as ExtensionRunner & Record<PropertyKey, unknown>;
	if (prototype[CAPTURE_HUB]) return;
	const original = prototype.getAllRegisteredTools;
	if (typeof original !== "function") {
		throw new Error("pi_exec could not observe ExtensionRunner.getAllRegisteredTools");
	}
	const hub: ToolCaptureHub = { children: new WeakSet(), latest: [] };
	Object.defineProperty(prototype, CAPTURE_HUB, {
		value: hub,
		configurable: false,
		enumerable: false,
		writable: false,
	});
	prototype.getAllRegisteredTools = function getApplePiRegisteredTools(): RegisteredTool[] {
		const tools = original.call(this);
		if (inChildSessionContext()) hub.children.add(this);
		// Marking is permanent because late child registrations may occur after the
		// AsyncLocalStorage scope that constructed the AgentSession has returned.
		if (hub.children.has(this)) return tools;

		// Advisor and other auxiliary sessions may assemble their own catalogs
		// outside apple-pi's child-session marker. Only the root runner that owns
		// pi_exec may publish the catalog. A root /reload still refreshes it because
		// the replacement runner registers pi_exec too.
		if (tools.some((tool) => tool.definition.name === "pi_exec")) hub.latest = tools;
		return tools;
	};
};

const hub = (): ToolCaptureHub | undefined =>
	(ExtensionRunner.prototype as ExtensionRunner & Record<PropertyKey, unknown>)[CAPTURE_HUB] as
		| ToolCaptureHub
		| undefined;

export interface CapturedTool {
	name: string;
	description: string;
	parameters: unknown;
	definition: ToolDefinition<any, any, any>;
}

export const capturedTools = (): CapturedTool[] => {
	const byName = new Map<string, CapturedTool>();
	for (const registered of hub()?.latest ?? []) {
		const definition = registered.definition;
		if (EXCLUDED_TOOL_NAMES.has(definition.name) || byName.has(definition.name)) continue;
		byName.set(definition.name, {
			name: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			definition,
		});
	}
	return [...byName.values()];
};

export const capturedTool = (name: string): CapturedTool | undefined =>
	capturedTools().find((tool) => tool.name === name);
