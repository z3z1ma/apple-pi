import { homedir } from "node:os";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadSearchRootGuardConfig } from "../../home-search-guard/src/config.js";
import { searchRootBlockReason } from "../../home-search-guard/src/index.js";
import { agentOperationArgs, runAgentWorker } from "./agent-workers.js";
import {
	CORE_TOOL_NAMES,
	type CoreToolName,
	coreToolDefinition,
	ENVELOPE_TOOL_NAMES,
	isCoreToolName,
} from "./core-tools.js";
import { EVIDENCE_FUNCTION_NAMES, runEvidenceFunction } from "./evidence.js";
import { executeFetch, fetchOperationArgs, traceFetchUrl } from "./fetch.js";
import { fromPythonValue, serializeJsonValue } from "./json.js";
import { bounded, resultText, traceValue } from "./results.js";
import { listSkills, readSkillBody } from "./skills.js";
import { capturedTool, capturedTools } from "./tool-capture.js";
import type { ExecutionOperation } from "./types.js";
import type { ExecActivityCall } from "./ui.js";

const MAX_GUEST_TOOL_RESULT_CHARS = 50_000;

export type Args = Record<string, unknown>;

/** What a host function may use while serving one call. */
export interface HostCallScope {
	ctx: ExtensionToolContext;
	signal: AbortSignal;
	operation: ExecutionOperation;
	/** Publish a change to the operation's trace or activity. */
	changed(): void;
	/** Publish a detached live snapshot of a model worker's child tools for inspection. */
	setChildren(children: ExecActivityCall[]): void;
	runTool(definition: ToolDefinition<any, any>, args: Args): Promise<any>;
	claimAgent(): number;
	addUsage(usage: Usage): void;
	extensionTools(): ReturnType<typeof capturedTools>;
}

type PythonCallable = (...actuals: any[]) => unknown;

/** A Python function bound to a host function: its type stub and how its Python arguments reach the host. */
interface PythonFunction {
	name: string;
	stub: string;
	/**
	 * `call` sends arguments to the host function. `interruption` returns the error to raise once the program
	 * has stopped, so a binding that converts failures to values still lets the interrupt through.
	 */
	bind(call: (args?: Args) => Promise<unknown>, interruption: () => Error | undefined): PythonCallable;
}

/** One host function the program can call, keyed by its trace ref. */
export interface HostFunction {
	/** Hand-written Python functions bound to this host function, in stub order. */
	python?: PythonFunction[];
	/** Trace and activity arguments; defaults to the raw arguments. Never include bound payloads. */
	traceArgs?(args: Args): Args;
	run(args: Args, scope: HostCallScope): unknown;
	/** Trace result; defaults to a bounded copy of the value. */
	traceResult?(value: unknown): unknown;
}

function portableValue(value: unknown): unknown {
	if (value === undefined) return undefined;
	const json = serializeJsonValue(value, "pi_exec host result");
	if (json.length <= MAX_GUEST_TOOL_RESULT_CHARS) return JSON.parse(json) as unknown;
	return { truncated: true, originalChars: json.length, preview: json.slice(0, MAX_GUEST_TOOL_RESULT_CHARS) };
}

/** TypeBox schemas carry runtime metadata; the program receives their JSON Schema projection. */
function portableSchema(value: unknown): unknown {
	const json = JSON.stringify(value);
	if (json === undefined) return undefined;
	return JSON.parse(json) as unknown;
}

const stringArg = (args: Args, key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");

function toolDescriptors(scope: HostCallScope, withParameters = false) {
	return scope.extensionTools().map((tool) => ({
		name: tool.name,
		description: tool.description,
		...(withParameters ? { parameters: portableSchema(tool.parameters) } : {}),
	}));
}

/** Python may pass a keyword argument positionally or as one dict. */
const named = (value: unknown, key: string) =>
	value && typeof value === "object" && !(value instanceof Map) ? (value as Args)[key] : value;

const AGENT_PARAMETERS =
	"task: str, type: str = ..., name: str = ..., profile: str = ..., tools: list[str] = ..., pair: bool = ..., system_prompt: str = ..., context: Any = ..., output_schema: dict[str, Any] = ...";

function agentRunBinding(
	call: (args?: Args) => Promise<unknown>,
	interruption: () => Error | undefined,
): (args?: Args) => Promise<Args> {
	return async (args = {}) => {
		const { system_prompt, output_schema, ...rest } = args;
		try {
			return (await call({
				...rest,
				...(system_prompt !== undefined ? { systemPrompt: system_prompt } : {}),
				...(output_schema !== undefined ? { outputSchema: output_schema } : {}),
			})) as Args;
		} catch (error) {
			const interrupt = interruption();
			if (interrupt) throw interrupt;
			return {
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
				text: "",
				toolCalls: 0,
			};
		}
	};
}

function fetchBinding(call: (args?: Args) => Promise<unknown>): PythonCallable {
	return async (input: string | Args, kwargs: Args = {}) => {
		const options = typeof input === "string" ? kwargs : input;
		const url = typeof input === "string" ? input : input.url;
		const { method, headers, body } = options;
		const pairs =
			headers === undefined ? undefined : Object.entries(fromPythonValue(headers, true) as Record<string, string>);
		const encodedBody =
			body === undefined ? undefined : Buffer.from(body instanceof Uint8Array ? body : String(body)).toString("base64");
		const response = (await call({
			url,
			...(method !== undefined ? { method } : {}),
			...(pairs !== undefined ? { headers: pairs } : {}),
			...(encodedBody !== undefined ? { body: encodedBody } : {}),
		})) as Args;
		const bytes = Buffer.from(String(response.body ?? ""), "base64");
		const headersMap = Object.fromEntries(response.headers as Array<[string, string]>);
		const contentType = String(headersMap["content-type"] ?? "");
		const text = /^text\/|json|xml|javascript/i.test(contentType);
		return {
			status: response.status,
			headers: headersMap,
			url: response.url,
			body: text ? bytes.toString("utf8") : bytes,
			...(text ? { text: bytes.toString("utf8") } : {}),
		};
	};
}

const HOST_FUNCTIONS: Record<string, HostFunction> = {
	"agent.run": {
		python: [
			{
				name: "agent_run",
				stub: `async def agent_run(*, ${AGENT_PARAMETERS}) -> dict[str, Any]: ...`,
				bind: agentRunBinding,
			},
			{
				name: "agent",
				stub: `async def agent(*, ${AGENT_PARAMETERS}) -> Any: ...`,
				bind: (call, interruption) => {
					const agentRun = agentRunBinding(call, interruption);
					return async (args: Args = {}) => {
						const result = await agentRun(args);
						if (result.status !== "completed") throw new Error(String(result.error ?? "Agent failed"));
						return result.value === undefined ? result.text : result.value;
					};
				},
			},
		],
		traceArgs: agentOperationArgs,
		async run(args, scope) {
			const result = await runAgentWorker(
				scope.claimAgent(),
				args,
				scope.ctx,
				scope.signal,
				(activity) => {
					scope.operation.activity = activity;
					scope.changed();
				},
				(children) => scope.setChildren(children),
			);
			if (result.usage) scope.addUsage(result.usage);
			scope.operation.children = result.operations;
			if (result.error) {
				scope.operation.outcome = "failed";
				scope.operation.error = result.error;
			}
			return result.record;
		},
	},
	"tools.list": {
		python: [
			{ name: "tools_list", stub: "async def tools_list() -> list[dict[str, Any]]: ...", bind: (call) => () => call() },
		],
		run: (_args, scope) => toolDescriptors(scope),
	},
	"tools.search": {
		python: [
			{
				name: "tools_search",
				stub: "async def tools_search(query: str) -> list[dict[str, Any]]: ...",
				bind: (call) => (query: unknown) => call({ query: named(query, "query") }),
			},
		],
		run: (args, scope) => {
			const query = stringArg(args, "query").toLowerCase();
			return toolDescriptors(scope).filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query));
		},
	},
	"tools.describe": {
		python: [
			{
				name: "tools_describe",
				stub: "async def tools_describe(name: str) -> dict[str, Any] | None: ...",
				bind: (call) => (name: unknown) => call({ name: named(name, "name") }),
			},
		],
		run: (args, scope) => toolDescriptors(scope, true).find((tool) => tool.name === stringArg(args, "name")),
	},
	"tools.call": {
		python: [
			{
				name: "tools_call",
				stub: "async def tools_call(name: str, args: dict[str, Any] = ...) -> dict[str, Any]: ...",
				bind:
					(call) =>
					(name: unknown, args: Args = {}) => {
						if (name && typeof name === "object" && !(name instanceof Map)) {
							const params = name as Args;
							return call({ name: params.name, args: params.args ?? {} });
						}
						return call({ name, args });
					},
			},
		],
		async run(args, scope) {
			scope.extensionTools();
			const name = stringArg(args, "name");
			const toolArgs =
				args.args && typeof args.args === "object" && !Array.isArray(args.args) ? (args.args as Args) : {};
			const tool = capturedTool(name);
			if (!tool) throw new Error(`Unknown extension tool: ${name || "(missing name)"}`);
			scope.operation.ref = `extensions.${name}`;
			scope.operation.args = toolArgs;
			scope.changed();
			const result = await scope.runTool(tool.definition, toolArgs);
			const content = portableValue(result.content);
			const details = portableValue(result.details);
			return {
				text: bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${scope.operation.ref} output`).value,
				...(content !== undefined ? { content } : {}),
				...(details !== undefined ? { details } : {}),
				...(result.usage ? { usage: result.usage } : {}),
			};
		},
	},
	"skills.list": {
		python: [
			{
				name: "skills_list",
				stub: "async def skills_list() -> list[dict[str, str]]: ...",
				bind: (call) => () => call(),
			},
		],
		run: (_args, scope) => listSkills({ cwd: scope.ctx.cwd }),
	},
	"skills.body": {
		python: [
			{
				name: "skills_body",
				stub: "async def skills_body(name: str) -> str: ...",
				bind: (call) => (name: unknown) => call({ name: named(name, "name") }),
			},
		],
		run: (args, scope) => readSkillBody(stringArg(args, "name"), { cwd: scope.ctx.cwd }),
	},
	fetch: {
		python: [
			{
				name: "fetch",
				stub: "async def fetch(url: str, *, method: str = ..., headers: dict[str, str] = ..., body: str | bytes = ...) -> dict[str, Any]: ...",
				bind: fetchBinding,
			},
		],
		traceArgs: fetchOperationArgs,
		run: (args, scope) => executeFetch(args, scope.signal),
		traceResult: (value) => {
			if (!value || typeof value !== "object") return traceValue(value);
			const response = value as Args;
			return { status: response.status, url: traceFetchUrl(response.url), bodyBytes: response.bodyBytes };
		},
	},
};

/**
 * Type stubs of the hand-written Python functions, in a stable order. The session hashes the full stub text to
 * identify Monty checkpoints, so any change to a stub's text or order makes every saved checkpoint incompatible.
 */
export const HOST_FUNCTION_STUBS: readonly string[] = Object.values(HOST_FUNCTIONS).flatMap((fn) =>
	(fn.python ?? []).map((python) => python.stub),
);

function evidenceFunction(name: string): HostFunction {
	const run: HostFunction["run"] = (args, scope) =>
		runEvidenceFunction(name, args, { cwd: scope.ctx.cwd, signal: scope.signal });
	if (!name.startsWith("context_")) return { run };
	return {
		run,
		traceArgs: (args) =>
			Object.fromEntries(
				Object.entries(args).map(([key, value]) => [key, key === "value" || key === "items" ? { bound: true } : value]),
			),
		traceResult: () => ({ bound: true }),
	};
}

function coreToolFunction(name: CoreToolName): HostFunction {
	const ref = `pi.${name}`;
	return {
		async run(args, scope) {
			try {
				const config = loadSearchRootGuardConfig(scope.ctx.cwd, scope.ctx.isProjectTrusted?.() ?? false);
				const blocked = searchRootBlockReason(name, args, scope.ctx.cwd, { home: homedir(), ...config });
				if (blocked) throw new Error(blocked);
				const result = await scope.runTool(coreToolDefinition(name, scope.ctx.cwd), args);
				const text = bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value;
				return ENVELOPE_TOOL_NAMES.has(name) ? { ok: true, output: text } : text;
			} catch (error) {
				if (!ENVELOPE_TOOL_NAMES.has(name) || scope.signal.aborted) throw error;
				const output = error instanceof Error ? error.message : String(error);
				scope.operation.outcome = "failed";
				scope.operation.error = output;
				return { ok: false, output: bounded(output, MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value };
			}
		},
	};
}

export function hostFunction(ref: string): HostFunction | undefined {
	if (Object.hasOwn(HOST_FUNCTIONS, ref)) return HOST_FUNCTIONS[ref];
	if (ref.startsWith("evidence.")) {
		const name = ref.slice("evidence.".length);
		if (EVIDENCE_FUNCTION_NAMES.includes(name as (typeof EVIDENCE_FUNCTION_NAMES)[number]))
			return evidenceFunction(name);
	}
	if (ref.startsWith("pi.")) {
		const name = ref.slice("pi.".length);
		if (isCoreToolName(name)) return coreToolFunction(name);
	}
	return undefined;
}

/** Captured extension tools callable as Python functions; core tools and evidence functions keep their own names. */
export function extensionPythonTools(): ReturnType<typeof capturedTools> {
	return capturedTools().filter(
		(tool) =>
			!CORE_TOOL_NAMES.includes(tool.name as CoreToolName) &&
			!EVIDENCE_FUNCTION_NAMES.includes(tool.name as (typeof EVIDENCE_FUNCTION_NAMES)[number]) &&
			/^[A-Za-z_]\w*$/.test(tool.name),
	);
}

/**
 * Every Python function a program can call. `invoke` sends a call to the host function with that ref; `interruption`
 * returns the error to raise once the program has stopped.
 */
export function guestFunctions(
	invoke: (ref: string, args?: Args) => Promise<unknown>,
	interruption: () => Error | undefined,
): Record<string, PythonCallable> {
	const keywordCall =
		(ref: string) =>
		(args: Args = {}) =>
			invoke(ref, args);
	return {
		...Object.fromEntries(
			Object.entries(HOST_FUNCTIONS).flatMap(([ref, fn]) =>
				(fn.python ?? []).map((python) => [python.name, python.bind((args) => invoke(ref, args), interruption)]),
			),
		),
		...Object.fromEntries(CORE_TOOL_NAMES.map((name) => [name, keywordCall(`pi.${name}`)])),
		...Object.fromEntries(EVIDENCE_FUNCTION_NAMES.map((name) => [name, keywordCall(`evidence.${name}`)])),
		...Object.fromEntries(
			extensionPythonTools().map((tool) => [
				tool.name,
				(args: Args = {}) => invoke("tools.call", { name: tool.name, args }),
			]),
		),
	};
}
