import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { capturedTools } from "./runtime-tools.js";

const CORE_TOOL_FACTORIES = {
	read: createReadToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
	bash: createBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
} as const;

const CORE_TOOL_RESULTS = {
	read: "Promise<string>",
	grep: "Promise<string>",
	find: "Promise<string>",
	ls: "Promise<string>",
	bash: "Promise<{ ok: boolean, output: string }>",
	edit: "Promise<{ ok: boolean, output: string }>",
	write: "Promise<{ ok: boolean, output: string }>",
} as const;

export const CORE_GUEST_TOOL_NAMES = Object.keys(CORE_TOOL_FACTORIES) as Array<keyof typeof CORE_TOOL_FACTORIES>;

/** V8/Node `vm` ECMAScript globals. Host-provided APIs are documented separately. */
export const ECMASCRIPT_GUEST_GLOBALS = [
	"AggregateError",
	"Array",
	"ArrayBuffer",
	"AsyncDisposableStack",
	"Atomics",
	"BigInt",
	"BigInt64Array",
	"BigUint64Array",
	"Boolean",
	"DataView",
	"Date",
	"DisposableStack",
	"Error",
	"EvalError",
	"FinalizationRegistry",
	"Float16Array",
	"Float32Array",
	"Float64Array",
	"Function",
	"Infinity",
	"Int16Array",
	"Int32Array",
	"Int8Array",
	"Intl",
	"Iterator",
	"JSON",
	"Map",
	"Math",
	"NaN",
	"Number",
	"Object",
	"Promise",
	"Proxy",
	"RangeError",
	"ReferenceError",
	"Reflect",
	"RegExp",
	"Set",
	"SharedArrayBuffer",
	"String",
	"SuppressedError",
	"Symbol",
	"SyntaxError",
	"TypeError",
	"URIError",
	"Uint16Array",
	"Uint32Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"WeakMap",
	"WeakRef",
	"WeakSet",
	"WebAssembly",
	"decodeURI",
	"decodeURIComponent",
	"encodeURI",
	"encodeURIComponent",
	"escape",
	"eval",
	"globalThis",
	"isFinite",
	"isNaN",
	"parseFloat",
	"parseInt",
	"undefined",
	"unescape",
] as const;

interface JsonSchemaLike {
	type?: string | string[];
	required?: readonly string[];
	properties?: Record<string, JsonSchemaLike>;
	items?: JsonSchemaLike | JsonSchemaLike[];
	anyOf?: JsonSchemaLike[];
	oneOf?: JsonSchemaLike[];
	enum?: unknown[];
	const?: unknown;
	patternProperties?: Record<string, JsonSchemaLike>;
}

function asSchema(value: unknown): JsonSchemaLike | undefined {
	return value && typeof value === "object" ? (value as JsonSchemaLike) : undefined;
}

function formatLiteral(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
	try {
		return JSON.stringify(value) ?? "unknown";
	} catch {
		return "unknown";
	}
}

function uniqueJoin(parts: readonly string[]): string {
	return [...new Set(parts.filter(Boolean))].join("|");
}

function formatPrimitive(type: string): string {
	if (type === "integer") return "number";
	if (type === "array") return "unknown[]";
	return type;
}

function parenthesizeUnion(type: string): string {
	return type.includes("|") && !type.startsWith("{") && !type.startsWith("[") && !type.startsWith("(")
		? `(${type})`
		: type;
}

function formatArrayType(schema: JsonSchemaLike): string {
	if (Array.isArray(schema.items)) return `[${schema.items.map(formatSchemaType).join(", ")}]`;
	const item = formatSchemaType(schema.items);
	if (item.startsWith("{") && item.endsWith("}")) return `[${item}]`;
	return `${parenthesizeUnion(item)}[]`;
}

function formatRecordType(schema: JsonSchemaLike): string {
	const values = Object.values(schema.patternProperties ?? {}).map(formatSchemaType);
	return `{ [key: string]: ${uniqueJoin(values) || "unknown"} }`;
}

/** Format a JSON/TypeBox schema as a TypeScript-like type. */
export function formatSchemaType(schema: unknown): string {
	const value = asSchema(schema);
	if (!value) return "unknown";
	if (value.const !== undefined) return formatLiteral(value.const);
	if (Array.isArray(value.enum) && value.enum.length > 0) return uniqueJoin(value.enum.map(formatLiteral));
	const alternatives = value.anyOf ?? value.oneOf;
	if (Array.isArray(alternatives) && alternatives.length > 0) return uniqueJoin(alternatives.map(formatSchemaType));
	if (Array.isArray(value.items)) return formatArrayType(value);
	const types = Array.isArray(value.type) ? value.type : value.type ? [value.type] : [];
	if (types.includes("array") || value.items) return formatArrayType(value);
	if (value.properties) return formatObjectSignature(value);
	if (value.patternProperties) return formatRecordType(value);
	if (types.length > 1) return uniqueJoin(types.map(formatPrimitive));
	if (types.length === 1) return formatPrimitive(types[0]!);
	return "unknown";
}

/** Format a JSON/TypeBox object schema as one `{ field?: type }` argument. */
export function formatObjectSignature(schema: unknown): string {
	const object = asSchema(schema);
	if (!object) return "{}";
	if (!object.properties) {
		if (object.patternProperties) return formatRecordType(object);
		return "{}";
	}
	const required = new Set(object.required ?? []);
	const fields = Object.entries(object.properties).map(([name, property]) => {
		const optional = required.has(name) ? "" : "?";
		return `${name}${optional}: ${formatSchemaType(property)}`;
	});
	return `{ ${fields.join(", ")} }`;
}

export function coreToolDefinitions(cwd = "."): Record<string, ToolDefinition<any, any>> {
	return Object.fromEntries(CORE_GUEST_TOOL_NAMES.map((name) => [name, CORE_TOOL_FACTORIES[name](cwd)])) as Record<
		string,
		ToolDefinition<any, any>
	>;
}

/** Live `pi.read({ path: string })` signatures derived from the parent-tool schemas. */
export function coreGuestSignatures(cwd = "."): string[] {
	const definitions = coreToolDefinitions(cwd);
	return CORE_GUEST_TOOL_NAMES.map((name) => {
		const args = formatObjectSignature(definitions[name]?.parameters);
		return `pi.${name}(${args}) → ${CORE_TOOL_RESULTS[name]}`;
	});
}

export function extensionGuestSignatures(): string[] {
	return capturedTools().map(
		(tool) => `extensions.${tool.name}(${formatObjectSignature(tool.parameters)}) → Promise<ToolResult>`,
	);
}

export const GUEST_HELPER_SIGNATURES: string[] = [
	"inputs: Readonly<Record<string, string>>  // from the inputs tool parameter; missing keys are undefined",
	"display is not a program global; reading or assigning it throws. Pass display: { name?: string, description?: string } on the pi_exec tool call.",
	"limits is a pi_exec tool parameter, not a program global. Pass limits: { agentBudget?, callBudget?, concurrency?, timeoutSeconds? } to scale the envelope up to package maxima.",
	"Await every host call. Host arguments and the program return value must be JSON-serializable.",
	"tools.list() → Promise<Array<{ name: string, description: string }>>  // captured session extension tools only, not pi.*",
	"tools.search(query: string) → Promise<Array<{ name: string, description: string }>>  // case-insensitive substring on name+description",
	"tools.describe(name: string) → Promise<{ name: string, description: string, parameters } | undefined>",
	"tools.call(name: string, args?: object) → Promise<ToolResult>",
	"tools.call({ name: string, args?: object }) → Promise<ToolResult>",
	"skills.list() → Promise<Array<{ name: string, description: string }>>",
	"skills.body({ name: string }) → Promise<string>  // SKILL.md body, frontmatter stripped; throws if missing",
	"extensions.<name>(args?: object) → Promise<ToolResult>",
	"ToolResult = { text: string, content, details, usage? }",
	'type AgentTool = "read"|"grep"|"find"|"ls"|"bash"|"edit"|"write"',
	'type AgentThinking = "off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"',
	"type AgentRequest = string | { task: string, type?: string, name?: string, model?: string, thinking?: AgentThinking, tools?: AgentTool[], systemPrompt?: string, context?: JSONValue, outputSchema?: object }",
	'type AgentRunResult = { status: "completed"|"failed", text: string, value?: JSONValue, error?: string, toolCalls: number, usage? }',
	'agent(request: AgentRequest) → Promise<string | JSONValue>  // returns outputSchema value when set; otherwise text; throws if status !== "completed"',
	"agents.run(request: AgentRequest) → Promise<AgentRunResult>",
	"type selects a built-in or Markdown agent (Explore, Plan, Research, Counsel, Implement, Design, general-purpose, …) and supplies that type's tools, prompt, and model/thinking as defaults; explicit tools/model/thinking override those defaults; systemPrompt appends and does not replace the type role",
	'omit type for a generic read-only worker; tools then default to ["read","grep","find","ls"]; tools must be chosen from AgentTool',
	"Review planner/reviewer/verifier stay custom systemPrompt workers — do not set type to those roles. Ralph increments use type general-purpose with instructions in the task",
	"agent(...) is a pi_exec worker for composition. extensions.Agent(...) is the interactive subagent tool for collaboration (background, steer, resume).",
	"Workers have no extensions or MCP. Call those in the program, then bind the compact result as context.",
	"context is JSON-cloned to a temp file and attached as @file (not stuffed into task/argv). Prefer agents.run for fan-out (does not throw).",
	"Pass file paths in context or task; the worker already has read. Do not dump file bodies into task.",
	"outputSchema is a JSON Schema object. The worker must call pi_exec_return; agents.run.value / agent() receive those arguments. Never JSON.parse assistant text.",
	"parallel(jobs: Array<() => Promise<T>|T>, concurrency?: number) → Promise<T[]>",
	"parallel(items: T[], mapper: (item: T, index: number) => Promise<R>|R, concurrency?: number) → Promise<R[]>",
	"pipeline(items: T[], ...stages: Array<(value: unknown, item: T, index: number) => unknown>) → Promise<unknown[]>",
	"setTimeout(callback: Function, ms?: number, ...args) → number  // delay clamped to [0, 1800000]",
	"clearTimeout(id: number) → void",
	"setInterval(callback: Function, ms?: number, ...args) → number  // delay clamped to [0, 1800000]",
	"clearInterval(id: number) → void",
	"sleep(ms: number) → Promise<void>",
	"queueMicrotask(callback: () => void) → void",
	"print(...values: unknown[]) → void  // logs capped at 20000 chars",
	"console.log(...values: unknown[]) → void",
	"console.info(...values: unknown[]) → void",
	"console.warn(...values: unknown[]) → void",
	"console.error(...values: unknown[]) → void",
	"type HeadersInit = Headers | Record<string, string> | Iterable<[string, string]>",
	"type BodyInit = string | URLSearchParams | ArrayBuffer | ArrayBufferView",
	'type RequestInit = { method?: string, headers?: HeadersInit, body?: BodyInit, redirect?: "follow"|"error"|"manual", signal?: AbortSignal }',
	"fetch(input: string | URL | Request, init?: RequestInit) → Promise<Response>  // request and response bodies capped at 10485760 bytes; URL must be absolute",
	"new URL(input: string, base?: string)",
	"URL.canParse(input: string, base?: string) → boolean",
	"URL.parse(input: string, base?: string) → URL | null",
	"url.href / origin / protocol / username / password / host / hostname / port / pathname / search / searchParams / hash",
	"url.toString() → string",
	"url.toJSON() → string",
	"new URLSearchParams(init?: string | URLSearchParams | Record<string, string> | Iterable<[string, string]>)",
	"params.size: number",
	"params.append(name: string, value: string) → void",
	"params.delete(name: string, value?: string) → void",
	"params.get(name: string) → string | null",
	"params.getAll(name: string) → string[]",
	"params.has(name: string, value?: string) → boolean",
	"params.set(name: string, value: string) → void",
	"params.sort() → void",
	"params.entries() → IterableIterator<[string, string]>",
	"params.keys() → IterableIterator<string>",
	"params.values() → IterableIterator<string>",
	"params.forEach(callback: (value: string, name: string, params: URLSearchParams) => void, thisArg?: unknown) → void",
	"params.toString() → string",
	"params[Symbol.iterator]() → IterableIterator<[string, string]>",
	"new Headers(init?: HeadersInit)",
	"headers.append(name: string, value: string) → void",
	"headers.delete(name: string) → void",
	"headers.get(name: string) → string | null",
	"headers.getSetCookie() → string[]",
	"headers.has(name: string) → boolean",
	"headers.set(name: string, value: string) → void",
	"headers.entries() → IterableIterator<[string, string]>",
	"headers.keys() → IterableIterator<string>",
	"headers.values() → IterableIterator<string>",
	"headers.forEach(callback: (value: string, name: string, headers: Headers) => void, thisArg?: unknown) → void",
	"headers[Symbol.iterator]() → IterableIterator<[string, string]>",
	"new Request(input: string | Request, init?: RequestInit)",
	"request.url: string; request.method: string; request.headers: Headers; request.redirect: string; request.signal: AbortSignal; request.bodyUsed: boolean",
	"request.clone() → Request",
	"request.arrayBuffer() → Promise<ArrayBuffer>",
	"request.bytes() → Promise<Uint8Array>",
	"request.text() → Promise<string>",
	"request.json() → Promise<unknown>",
	"new Response(body?: BodyInit | null, init?: { status?: number, statusText?: string, headers?: HeadersInit, url?: string, redirected?: boolean, type?: string })",
	"response.status: number; response.statusText: string; response.headers: Headers; response.url: string; response.redirected: boolean; response.type: string; response.ok: boolean; response.bodyUsed: boolean",
	"response.clone() → Response",
	"response.arrayBuffer() → Promise<ArrayBuffer>",
	"response.bytes() → Promise<Uint8Array>",
	"response.text() → Promise<string>",
	"response.json() → Promise<unknown>",
	"Response.error() → Response",
	"Response.json(value: unknown, init?: object) → Response",
	"Response.redirect(url: string, status?: 301|302|303|307|308) → Response",
	"new AbortController()",
	"controller.signal: AbortSignal",
	"controller.abort(reason?: unknown) → void",
	"signal.aborted: boolean; signal.reason: unknown; signal.onabort: ((event) => void) | null",
	'signal.addEventListener(type: "abort", listener: ((event) => void) | { handleEvent(event): void }, options?: { once?: boolean }) → void',
	'signal.removeEventListener(type: "abort", listener) → void',
	"signal.throwIfAborted() → void",
	"AbortSignal.abort(reason?: unknown) → AbortSignal",
	"AbortSignal.timeout(ms: number) → AbortSignal",
	"AbortSignal.any(signals: Iterable<AbortSignal>) → AbortSignal",
	"new TextEncoder()",
	'encoder.encoding: "utf-8"',
	"encoder.encode(value?: string) → Uint8Array",
	"encoder.encodeInto(value: string, destination: Uint8Array) → { read: number, written: number }",
	"new TextDecoder(label?: string, options?: { fatal?: boolean, ignoreBOM?: boolean })",
	"decoder.encoding: string; decoder.fatal: boolean; decoder.ignoreBOM: boolean",
	"decoder.decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }) → string",
	"atob(value: string) → string",
	"btoa(value: string) → string",
	"structuredClone<T>(value: T) → T  // transfer lists throw; functions and symbols are not cloneable",
	"new DOMException(message?: string, name?: string)",
	`ECMAScript globals: ${ECMASCRIPT_GUEST_GLOBALS.join(", ")}. eval and Function exist but code generation from strings is disabled. WebAssembly exists but compile/instantiate is disabled.`,
	"Not provided: process, require, Buffer, crypto, FormData, Blob, File, ReadableStream, setImmediate, and other Node host APIs.",
];

export const PI_EXEC_PROMPT_SNIPPET =
	"pi_exec: compose core Pi tools, fetch, and subagents with branching, fan-out, pipelines, and reduction";

export const PI_EXEC_DESCRIPTION =
	"Execute a bounded JavaScript async-function body that composes Pi's read, grep, find, ls, bash, edit, and write tools, HTTP fetch, session skills, and programmable Pi workers. Supports familiar web APIs, ordinary branching, loops, reduction, Promise.all, parallel(items, mapper, concurrency), pipeline(items, ...stages), timers, skills.list / skills.body({ name }), agent(task | { task, type?, name?, model?, thinking?, tools?, systemPrompt?, context?, outputSchema? }) for text or a typed outputSchema value, and agents.run(same) → { status, text, value?, error?, usage?, toolCalls }. Bind JSON-serializable results as agent context instead of interpolating them into the task string. Intermediate results stay inside the worker; return only the compact value needed in main context. Core guest calls take one object matching the parent tool, never a positional string. display is a tool parameter, not a program global. The code parameter lists every guest signature, including session extension tools such as the MCP gateway.";

export const PI_EXEC_PROMPT_GUIDELINES = [
	"Use pi_exec when programmatic composition materially reduces intermediate context or coordinates already-justified parallel work. Use direct tools for straightforward sequential inspection, regardless of the exact number of calls.",
	"The code parameter is a JavaScript async-function body. Core calls are pi.read/grep/find/ls/bash/edit/write and each takes one object matching that parent tool, never a positional string: pi.read({ path }), pi.grep({ pattern }), pi.bash({ command }). fetch, skills.list, skills.body({ name }), agent/agents.run, parallel/pipeline, and every captured extension tool including the MCP gateway are listed on the code parameter before you write the program. Agent options may include task, type, name, model, thinking, tools, systemPrompt, context, and outputSchema. type selects a catalog agent and supplies that type's tools, prompt, and model/thinking as defaults; explicit tools/model/thinking override those defaults; systemPrompt appends and does not replace the type role. Omit type for a generic read-only worker. Review roles stay custom systemPrompt workers, not catalog types. Ralph increments use type general-purpose. Call MCP and extension tools in the program, then bind compact results as agent context. Use agents.run for fan-out so one failed worker does not abort the program. Load the pi-exec skill for gather-then-bind examples. The Agent tool is for collaboration (background, steer, resume); agents.run is for in-program graphs.",
	"Use Promise.all or parallel(items, mapper, concurrency) for independent work and pipeline(items, ...stages) for staged transforms. Keep dependent search→read and edit→verify calls sequential; never perform concurrent edits to the same file.",
	"display is a pi_exec tool parameter beside code and inputs, not a program global. Pass display: { name, description } on the tool call for multi-step programs so the live tool card and activity widget communicate intent.",
	"limits is a pi_exec tool parameter. Pass limits: { agentBudget, callBudget, concurrency, timeoutSeconds } when a workflow needs more workers or host calls than the shape-derived default. Package maxima still apply.",
];

/** Live guest catalog. Built on read so late-registered extension tools appear. */
export function piExecGuestApiContract(): string {
	const extensions = extensionGuestSignatures();
	return [
		"pi.* and extensions.* take one object argument matching the parent tool, never a positional string. tools.search and tools.describe take a positional string.",
		...coreGuestSignatures(),
		...GUEST_HELPER_SIGNATURES,
		"Session extension tools (extensions.<name>(args) or tools.call(name, args)); each returns Promise<ToolResult>:",
		...(extensions.length > 0 ? extensions : ["(none captured in this session yet)"]),
		"Do not assign display inside the program; pass the display tool parameter instead.",
	].join("\n");
}

export function piExecToolDescription(): string {
	return `${PI_EXEC_DESCRIPTION}\n\n${piExecGuestApiContract()}`;
}

export const PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION =
	"Tool-call metadata for the live card and activity widget. Not a program global; do not assign display inside code.";

/** Attach a read-time description so wrap's copied `parameters` object stays live. */
export function attachLiveDescription<T extends object>(schema: T, read: () => string): T {
	Object.defineProperty(schema, "description", {
		configurable: true,
		enumerable: true,
		get: read,
	});
	return schema;
}
