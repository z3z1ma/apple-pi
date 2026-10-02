import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createExecBashToolDefinition } from "../components/tasks/src/bash-tool.js";
import { EVIDENCE_FUNCTION_NAMES, evidencePythonStubs } from "./runtime-evidence.js";
import { capturedTool, capturedTools } from "./runtime-tools.js";

const CORE_TOOL_FACTORIES = {
	read: createReadToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
	bash: createExecBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
} as const;

export const CORE_GUEST_TOOL_NAMES = Object.keys(CORE_TOOL_FACTORIES) as Array<keyof typeof CORE_TOOL_FACTORIES>;

type Schema = {
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	anyOf?: Schema[];
	oneOf?: Schema[];
	const?: unknown;
	enum?: unknown[];
	patternProperties?: Record<string, Schema>;
	additionalProperties?: boolean | Schema;
};

function pythonLiteral(value: unknown): string {
	if (value === null) return "None";
	if (typeof value === "boolean") return value ? "True" : "False";
	return JSON.stringify(value) ?? "None";
}

function pythonType(schema: Schema, name: string, declarations: string[]): string {
	if (schema.const !== undefined) return `Literal[${pythonLiteral(schema.const)}]`;
	if (schema.enum?.length) return `Literal[${schema.enum.map(pythonLiteral).join(", ")}]`;
	const alternatives = schema.anyOf ?? schema.oneOf;
	if (alternatives?.length)
		return alternatives.map((item, index) => pythonType(item, `${name}Option${index}`, declarations)).join(" | ");
	if (schema.items) return `list[${pythonType(schema.items, `${name}Item`, declarations)}]`;
	if (schema.properties) {
		if (Object.keys(schema.properties).length === 0 && schema.additionalProperties !== false) return "dict[str, Any]";
		const required = new Set(schema.required ?? []);
		const fields = Object.entries(schema.properties).map(([key, value]) => {
			const type = pythonType(value, `${name}${key[0]!.toUpperCase()}${key.slice(1)}`, declarations);
			return `    ${key}: ${required.has(key) ? type : `NotRequired[${type}]`}`;
		});
		const typeName = `${name[0]!.toUpperCase()}${name.slice(1)}`;
		declarations.push(`class ${typeName}(TypedDict):\n${fields.length ? fields.join("\n") : "    pass"}`);
		return typeName;
	}
	if (schema.patternProperties) return "dict[str, Any]";
	const type = Array.isArray(schema.type) ? schema.type : [schema.type];
	return type
		.map(
			(part) =>
				({
					string: "str",
					integer: "int",
					number: "float",
					boolean: "bool",
					null: "None",
					array: "list[Any]",
					object: "dict[str, Any]",
				})[part ?? ""] ?? "Any",
		)
		.join(" | ");
}

function toolSignature(name: string, schema: Schema, output: string, declarations: string[]): string {
	const required = new Set(schema.required ?? []);
	const fields = Object.entries(schema.properties ?? {}).map(
		([key, value]) =>
			`${key}: ${pythonType(value, `${name}${key[0]!.toUpperCase()}${key.slice(1)}`, declarations)}${required.has(key) ? "" : " = ..."}`,
	);
	return `async def ${name}(${fields.length ? `*, ${fields.join(", ")}` : ""}) -> ${output}: ...`;
}

export function coreToolDefinitions(cwd = "."): Record<string, ToolDefinition<any, any>> {
	return Object.fromEntries(
		CORE_GUEST_TOOL_NAMES.map((name) => [
			name,
			name === "bash"
				? CORE_TOOL_FACTORIES[name](cwd)
				: (capturedTool(name)?.definition ?? CORE_TOOL_FACTORIES[name](cwd)),
		]),
	) as Record<string, ToolDefinition<any, any>>;
}

/** The same schema-derived signatures are supplied to ty and shown to the model. */
export function corePythonStubs(cwd = "."): string {
	const definitions = coreToolDefinitions(cwd);
	const declarations: string[] = [];
	const signatures: string[] = [];
	for (const name of CORE_GUEST_TOOL_NAMES) {
		const output = ["bash", "edit", "write"].includes(name) ? "dict[str, Any]" : "str";
		signatures.push(toolSignature(name, definitions[name]!.parameters as Schema, output, declarations));
	}
	return [
		"from typing import Any, Literal, NotRequired, TypedDict",
		"inputs: dict[str, str]",
		...declarations,
		...signatures,
	].join("\n");
}

export function coreGuestSignatures(cwd = "."): string[] {
	return corePythonStubs(cwd)
		.split("\n")
		.filter((line) => line.startsWith("async def "));
}

export function extensionPythonTools(): ReturnType<typeof capturedTools> {
	return capturedTools().filter(
		(tool) =>
			!CORE_GUEST_TOOL_NAMES.includes(tool.name as (typeof CORE_GUEST_TOOL_NAMES)[number]) &&
			!EVIDENCE_FUNCTION_NAMES.includes(tool.name as (typeof EVIDENCE_FUNCTION_NAMES)[number]) &&
			/^[A-Za-z_]\w*$/.test(tool.name),
	);
}

export function guestPythonStubs(cwd = "."): string {
	const declarations: string[] = [];
	const extensions = extensionPythonTools().map((tool) =>
		toolSignature(tool.name, tool.parameters as Schema, "dict[str, Any]", declarations),
	);
	return [
		corePythonStubs(cwd),
		...declarations,
		...extensions,
		"def schema(shape: Any) -> dict[str, Any]: ...",
		"async def agent_run(*, task: str, type: str = ..., name: str = ..., profile: str = ..., tools: list[str] = ..., pair: bool = ..., system_prompt: str = ..., context: Any = ..., output_schema: dict[str, Any] = ...) -> dict[str, Any]: ...",
		"async def agent(*, task: str, type: str = ..., name: str = ..., profile: str = ..., tools: list[str] = ..., pair: bool = ..., system_prompt: str = ..., context: Any = ..., output_schema: dict[str, Any] = ...) -> Any: ...",
		"async def tools_list() -> list[dict[str, Any]]: ...",
		"async def tools_search(query: str) -> list[dict[str, Any]]: ...",
		"async def tools_describe(name: str) -> dict[str, Any] | None: ...",
		"async def tools_call(name: str, args: dict[str, Any] = ...) -> dict[str, Any]: ...",
		"async def skills_list() -> list[dict[str, str]]: ...",
		"async def skills_body(name: str) -> str: ...",
		"async def fetch(url: str, *, method: str = ..., headers: dict[str, str] = ..., body: str | bytes = ...) -> dict[str, Any]: ...",
		evidencePythonStubs(),
	].join("\n");
}

export const PI_EXEC_PROMPT_SNIPPET =
	"pi_exec: compose tools and model workers in Python; compute over results before returning evidence";

export const PI_EXEC_DESCRIPTION =
	"Run type-checked Python in bounded Monty to compose tools, model workers, and HTTP requests, and compute over their results. Return a JSON-compatible trailing expression; printed output is also captured. See code for live signatures and runtime constraints.";

export const PI_EXEC_PROMPT_GUIDELINES = [
	"Use pi_exec to compose tool calls or compute over their results. Use direct tools for a single operation that needs neither.",
	"Keep intermediate results inside the program. Return the smallest result that preserves the evidence needed for the next decision: aggregate counts, select relevant excerpts, or report exceptions instead of dumping raw output.",
	"Run independent calls concurrently with asyncio.gather; await dependent steps in order.",
	"Check tool and worker outcomes before using their results. Surface failures and missing evidence explicitly.",
];

export function piExecGuestApiContract(): string {
	return [
		"Python 3.14 subset (Monty). Snippets accept top-level await and return the trailing expression. All code is type-checked before execution.",
		"Import asyncio and use asyncio.gather(*awaitables) for independent fan-out; no create_task or third-party imports.",
		"Host functions are async; pass keyword arguments. schema(shape) is pure local Python. The declarations below are the exact type-checking stubs:",
		guestPythonStubs(),
		"Captured extension tools use their declared Python names and keyword signatures; tools_search/tools_call support dynamic discovery. fetch handles HTTP; skills_list/skills_body expose model-invocable skills.",
		"git_change/git_patch and repo_change_neighborhood collect scoped evidence; context_* fits worker context; dev_find_relevant_tests/dev_run_relevant_tests locate and run focused checks.",
		'agent_run returns a status record (including errors); agent returns text or the output_schema value and raises on failure. Context is bound as a file, not included in the task. Use schema({"id": "int"}) for strict object schemas.',
		"Inputs is a dict of caller-supplied strings. Python globals persist across calls on the current Pi session branch; reset is a tool parameter that starts fresh. Print is captured. Return only JSON-compatible values; display and limits are tool parameters, not globals.",
	].join("\n");
}

export function piExecToolDescription(): string {
	return PI_EXEC_DESCRIPTION;
}

export const PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION =
	"Tool-call metadata for the live card and activity widget. Not a program global; pass display outside code.";

/** Attach a read-time description so wrap's copied `parameters` object stays live. */
export function attachLiveDescription<T extends object>(schema: T, read: () => string): T {
	Object.defineProperty(schema, "description", {
		configurable: true,
		enumerable: true,
		get: read,
	});
	return schema;
}
