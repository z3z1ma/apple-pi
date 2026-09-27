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
import { capturedTool } from "./runtime-tools.js";

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
		const schema = definitions[name]!.parameters as Schema;
		const required = new Set(schema.required ?? []);
		const properties = Object.entries(schema.properties ?? {});
		const fields = properties.map(
			([key, value]) =>
				`${key}: ${pythonType(value, `${name}${key[0]!.toUpperCase()}${key.slice(1)}`, declarations)}${required.has(key) ? "" : " = ..."}`,
		);
		const args = fields.length ? `*, ${fields.join(", ")}` : "";
		const output = ["bash", "edit", "write"].includes(name) ? "dict[str, Any]" : "str";
		signatures.push(`async def ${name}(${args}) -> ${output}: ...`);
	}
	return [
		"from typing import Any, Literal, NotRequired, TypedDict",
		"inputs: dict[str, str]",
		"state: dict[str, Any]",
		...declarations,
		...signatures,
	].join("\n");
}

export function coreGuestSignatures(cwd = "."): string[] {
	return corePythonStubs(cwd)
		.split("\n")
		.filter((line) => line.startsWith("async def "));
}

export const PI_EXEC_PROMPT_SNIPPET =
	"pi_exec: run type-checked Python in Monty to compose core Pi tools with branching, asyncio.gather fan-out, and reduction";

export const PI_EXEC_DESCRIPTION =
	"Run a type-checked Python snippet in a bounded Monty subprocess. Use top-level await to call read, grep, find, ls, bash, edit, and write with keyword arguments matching their Pi tool schemas. asyncio.gather can fan out calls; the host queues them within the concurrency and call budgets. The trailing expression is the result. Print output is captured; inputs is a dictionary of caller-supplied strings. Only JSON-compatible results cross the boundary. The current guest exposes only core Pi tools.";

export const PI_EXEC_PROMPT_GUIDELINES = [
	"Use pi_exec when Python control flow reduces intermediate context or coordinates core Pi tool calls; use direct tools for straightforward sequential work.",
	"Write a Python snippet, not a JavaScript function. Use top-level await and a trailing expression for the result. Import asyncio for asyncio.gather fan-out.",
	"The complete signature contract in the code parameter is checked before any host call runs. Call core tools with keyword arguments, e.g. await read(path='README.md').",
	"Keep dependent search→read and edit→verify calls sequential; gather only independent calls. Host-side limits control fan-out.",
];

export function piExecGuestApiContract(): string {
	return [
		"Python 3.14 subset (Monty). Snippets accept top-level await and return the trailing expression. All code is type-checked before execution.",
		"Import asyncio and use asyncio.gather(*awaitables) for independent fan-out; no create_task or third-party imports.",
		"Host functions are async; pass keyword arguments. The declarations below are the exact type-checking stubs:",
		corePythonStubs(),
		"Inputs is a dict of caller-supplied strings; state is a mutable JSON dictionary that can be resumed by its returned ID. Print is captured. Return only JSON-compatible values; display and limits are tool parameters, not globals.",
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
