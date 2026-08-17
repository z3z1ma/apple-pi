import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";
import {
	BUILTIN_TOOL_NAMES,
	buildAgentRegistry,
	getAgentConfigIn,
	getAvailableTypesIn,
	resolveEnabledTypeIn,
} from "../components/subagents/src/agent-types.js";
import { loadCustomAgents } from "../components/subagents/src/custom-agents.js";
import { resolveAgentModel } from "../components/subagents/src/model-routing.js";
import type { AgentConfig } from "../components/subagents/src/types.js";

import { PI_EXEC_OUTPUT_SCHEMA_ENV, PI_EXEC_RETURN_TOOL } from "./runtime-worker-return.js";

export { PI_EXEC_OUTPUT_SCHEMA_ENV, PI_EXEC_RETURN_TOOL } from "./runtime-worker-return.js";

export const WORKER_GUIDANCE =
	"You are a worker inside a pi_exec program. Complete the assigned task with only the tools provided, then return concise findings or results with concrete evidence. Do not ask follow-up questions.";

export const CONTEXT_GUIDANCE =
	"An attached JSON file is a bound argument from the parent program. Treat it as the data for this task; do not ask the parent to resend it.";

export const OUTPUT_SCHEMA_GUIDANCE = `You must finish by calling ${PI_EXEC_RETURN_TOOL} with arguments that match its parameter schema. That call is this worker's return value. Do not put the result in assistant text.`;

export const WORKER_RETURN_EXTENSION_PATH = fileURLToPath(new URL("./runtime-worker-return.ts", import.meta.url));

export interface AgentRequest {
	task: string;
	/** Built-in or Markdown agent type. Omit for a generic read-only worker. */
	type?: string;
	name?: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	systemPrompt?: string;
	context?: unknown;
	outputSchema?: Record<string, unknown>;
}

export interface ExecWorkerResolution {
	tools: string[];
	model?: string;
	thinking?: string;
	systemPrompt?: string;
	type?: string;
}

export interface ExecWorkerResolveOptions {
	cwd: string;
	parentModel?: string;
	parentThinking?: string;
	projectTrusted?: boolean;
	registry?: {
		find(provider: string, modelId: string): { provider: string; id: string } | undefined;
		getAvailable?(): Array<{ provider: string; id: string }>;
	};
	parentModelObject?: { provider: string; id: string };
}

export function parseAgentRequest(rawArgs: Record<string, unknown>): AgentRequest {
	if (typeof rawArgs.task !== "string" || rawArgs.task.trim() === "") {
		throw new Error("agents.run requires a non-empty task string");
	}
	if (
		rawArgs.tools !== undefined &&
		(!Array.isArray(rawArgs.tools) || rawArgs.tools.some((tool) => typeof tool !== "string"))
	) {
		throw new Error("agents.run tools must be an array of Pi core tool names");
	}
	const name = typeof rawArgs.name === "string" ? rawArgs.name.trim() : "";
	const type = typeof rawArgs.type === "string" ? rawArgs.type.trim() : "";
	const request: AgentRequest = {
		task: rawArgs.task,
		...(type ? { type } : {}),
		...(name ? { name } : {}),
		...(typeof rawArgs.model === "string" ? { model: rawArgs.model } : {}),
		...(typeof rawArgs.thinking === "string" ? { thinking: rawArgs.thinking } : {}),
		...(Array.isArray(rawArgs.tools) ? { tools: rawArgs.tools as string[] } : {}),
		...(typeof rawArgs.systemPrompt === "string" ? { systemPrompt: rawArgs.systemPrompt } : {}),
	};
	if ("context" in rawArgs) request.context = rawArgs.context;
	if ("outputSchema" in rawArgs) request.outputSchema = normalizeOutputSchema(rawArgs.outputSchema);
	return request;
}

const READ_ONLY_WORKER_TOOLS = ["read", "grep", "find", "ls"];

export function resolveExecAgentConfig(cwd: string, type: string): AgentConfig {
	const registry = buildAgentRegistry(loadCustomAgents(cwd));
	const key = resolveEnabledTypeIn(registry, type);
	const config = key ? getAgentConfigIn(registry, key) : undefined;
	if (!config) {
		const available = getAvailableTypesIn(registry).join(", ") || "(none)";
		throw new Error(`Unknown or disabled agent type: "${type}". Available: ${available}.`);
	}
	return config;
}

function defaultToolsFor(config: AgentConfig): string[] {
	return config.builtinToolNames ?? [...BUILTIN_TOOL_NAMES];
}

function typedSystemPrompt(config: AgentConfig, additional?: string): string {
	const role = `Agent type: ${config.name}\n\n${config.systemPrompt}`;
	return additional?.trim() ? `${role}\n\nAdditional program guidance:\n${additional}` : role;
}

/**
 * Resolve tools, model, thinking, and role prompt for an agents.run worker.
 * Omitting type keeps the generic read-only worker. A catalog type supplies
 * that agent's defaults; explicit tools/model/thinking override those defaults.
 * systemPrompt appends and does not replace the type role.
 */
export async function resolveExecWorker(
	request: AgentRequest,
	options: ExecWorkerResolveOptions,
): Promise<ExecWorkerResolution> {
	if (!request.type) {
		return {
			tools: request.tools ?? [...READ_ONLY_WORKER_TOOLS],
			...(request.model ? { model: request.model } : options.parentModel ? { model: options.parentModel } : {}),
			...(request.thinking
				? { thinking: request.thinking }
				: options.parentThinking
					? { thinking: options.parentThinking }
					: {}),
			...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
		};
	}

	const config = resolveExecAgentConfig(options.cwd, request.type);
	const tools = request.tools ?? defaultToolsFor(config);
	let model = request.model;
	let thinking = request.thinking ?? config.thinking;

	if (!request.model && options.registry) {
		const resolved = await resolveAgentModel({
			cwd: options.cwd,
			projectTrusted: options.projectTrusted === true,
			registry: options.registry as Parameters<typeof resolveAgentModel>[0]["registry"],
			parentModel: options.parentModelObject as never,
			config,
			type: config.name,
		});
		if (resolved.model) model = `${resolved.model.provider}/${resolved.model.id}`;
		if (!request.thinking && resolved.thinkingLevel) thinking = resolved.thinkingLevel;
	} else if (!request.model && config.model) {
		model = config.model;
	}

	if (!model && options.parentModel) model = options.parentModel;
	if (!thinking && options.parentThinking) thinking = options.parentThinking;

	return {
		type: config.name,
		tools,
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		systemPrompt: typedSystemPrompt(config, request.systemPrompt),
	};
}

export function serializeAgentContext(context: unknown): string {
	let json: string;
	try {
		json = JSON.stringify(context, (_key, nested) => (typeof nested === "bigint" ? String(nested) : nested));
	} catch (error) {
		throw new Error(
			`agents.run context must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (json === undefined) {
		throw new Error("agents.run context must be JSON-serializable");
	}
	return json;
}

export function normalizeOutputSchema(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("agents.run outputSchema must be a JSON Schema object");
	}
	const schema = JSON.parse(serializeAgentContext(value)) as Record<string, unknown>;
	const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
	if (!types.includes("object") && schema.properties === undefined) {
		throw new Error("agents.run outputSchema must describe an object");
	}
	if (!types.includes("object")) schema.type = "object";
	if (schema.additionalProperties === undefined) schema.additionalProperties = false;
	return schema;
}

export function resolveStructuredOutput(
	schema: Record<string, unknown> | undefined,
	returnedValue: unknown,
): { value?: unknown; error?: string } {
	if (!schema) return {};
	if (returnedValue === undefined) {
		return { error: `agents.run outputSchema was not satisfied: ${PI_EXEC_RETURN_TOOL} was not called` };
	}
	if (!returnedValue || typeof returnedValue !== "object" || Array.isArray(returnedValue)) {
		return { error: "agents.run outputSchema validation failed: return arguments must be an object" };
	}
	const value = structuredClone(returnedValue);
	Value.Convert(schema as never, value);
	if (!Value.Check(schema as never, value)) {
		const issues = [...Value.Errors(schema as never, value)]
			.slice(0, 3)
			.map((issue) => `${issue.instancePath || "/"}: ${issue.message}`)
			.join("; ");
		return { error: `agents.run outputSchema validation failed: ${issues || "value does not match schema"}` };
	}
	try {
		JSON.stringify(value);
	} catch (error) {
		return {
			error: `agents.run outputSchema result is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return { value };
}

function summarizeBound(value: unknown): { bound: true; chars?: number } {
	try {
		const json = JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? String(nested) : nested));
		if (json === undefined) return { bound: true };
		return { bound: true, chars: json.length };
	} catch {
		return { bound: true };
	}
}

/** Trace/widget args. Never includes bound payloads. */
export function agentOperationArgs(rawArgs: Record<string, unknown>): Record<string, unknown> {
	const name = typeof rawArgs.name === "string" ? rawArgs.name.trim() : "";
	const type = typeof rawArgs.type === "string" ? rawArgs.type.trim() : "";
	return {
		...(typeof rawArgs.task === "string" ? { task: rawArgs.task } : {}),
		...(type ? { type } : {}),
		...(name ? { name } : {}),
		...(typeof rawArgs.model === "string" ? { model: rawArgs.model } : {}),
		...(typeof rawArgs.thinking === "string" ? { thinking: rawArgs.thinking } : {}),
		...(Array.isArray(rawArgs.tools) ? { tools: rawArgs.tools } : {}),
		...(typeof rawArgs.systemPrompt === "string" ? { systemPrompt: rawArgs.systemPrompt } : {}),
		...("context" in rawArgs ? { context: summarizeBound(rawArgs.context) } : {}),
		...("outputSchema" in rawArgs ? { outputSchema: summarizeBound(rawArgs.outputSchema) } : {}),
	};
}

function materializeBoundJson(value: unknown, fileName: string): { path: string; cleanup: () => void } {
	const json = serializeAgentContext(value);
	const dir = mkdtempSync(join(tmpdir(), "pi-exec-ctx-"));
	const path = join(dir, fileName);
	try {
		writeFileSync(path, json, { encoding: "utf8", mode: 0o600 });
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	let cleaned = false;
	return {
		path,
		cleanup() {
			if (cleaned) return;
			cleaned = true;
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

export function materializeAgentContext(context: unknown): { path: string; cleanup: () => void } {
	return materializeBoundJson(context, "context.json");
}

export function buildAgentCliArgs(
	request: AgentRequest,
	options: {
		tools: readonly string[];
		model?: string;
		thinking?: string;
		contextPath?: string;
		extensionPath?: string;
	},
): string[] {
	const guidance = [
		WORKER_GUIDANCE,
		options.contextPath ? CONTEXT_GUIDANCE : "",
		request.outputSchema ? OUTPUT_SCHEMA_GUIDANCE : "",
		request.systemPrompt ? `Additional program guidance:\n${request.systemPrompt}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	const args = [
		"--mode",
		"json",
		"--print",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--tools",
		options.tools.join(","),
		"--append-system-prompt",
		guidance,
	];
	if (options.extensionPath) args.push("--extension", options.extensionPath);
	if (request.name) args.push("--name", request.name);
	if (options.model) args.push("--model", options.model);
	if (options.thinking) args.push("--thinking", options.thinking);
	if (options.contextPath) args.push(`@${options.contextPath}`);
	args.push(request.task);
	return args;
}

export function prepareAgentSpawn(
	request: AgentRequest,
	options: { tools: readonly string[]; model?: string; thinking?: string },
): { args: string[]; cleanup: () => void; env?: Record<string, string> } {
	const cleanups: Array<() => void> = [];
	try {
		const context = request.context !== undefined ? materializeBoundJson(request.context, "context.json") : undefined;
		if (context) cleanups.push(context.cleanup);
		const schema =
			request.outputSchema !== undefined ? materializeBoundJson(request.outputSchema, "output-schema.json") : undefined;
		if (schema) cleanups.push(schema.cleanup);
		const tools = request.outputSchema
			? [...options.tools.filter((tool) => tool !== PI_EXEC_RETURN_TOOL), PI_EXEC_RETURN_TOOL]
			: options.tools;
		return {
			args: buildAgentCliArgs(request, {
				tools,
				...(options.model ? { model: options.model } : {}),
				...(options.thinking ? { thinking: options.thinking } : {}),
				...(context ? { contextPath: context.path } : {}),
				...(schema ? { extensionPath: WORKER_RETURN_EXTENSION_PATH } : {}),
			}),
			cleanup() {
				for (const next of cleanups) next();
			},
			...(schema ? { env: { [PI_EXEC_OUTPUT_SCHEMA_ENV]: schema.path } } : {}),
		};
	} catch (error) {
		for (const next of cleanups) next();
		throw error;
	}
}
