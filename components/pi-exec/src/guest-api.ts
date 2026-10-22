import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CORE_TOOL_NAMES, coreToolDefinition, ENVELOPE_TOOL_NAMES } from "./core-tools.js";
import { evidencePythonStubs } from "./evidence.js";
import { extensionPythonTools, HOST_FUNCTION_STUBS, HOST_PROMPT_STUBS } from "./guest-functions.js";
import { PEER_PYTHON_STUBS } from "./peer-python.js";

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

/**
 * Core tool signatures. Pi runs an active core tool other than bash, so its registered schema wins for type
 * checking; the model-facing text uses Pi's own definitions.
 */
export function corePythonStubs(cwd = ".", callable: readonly AgentTool[] = []): string {
	const declarations: string[] = [];
	const signatures: string[] = [];
	for (const name of CORE_TOOL_NAMES) {
		const output = ENVELOPE_TOOL_NAMES.has(name) ? "dict[str, Any]" : "str";
		const active = name !== "bash" ? callable.find((tool) => tool.name === name) : undefined;
		const parameters = (active ?? coreToolDefinition(name, cwd)).parameters as Schema;
		signatures.push(toolSignature(name, parameters, output, declarations));
	}
	return [
		"from typing import Any, Literal, NotRequired, TypedDict",
		"inputs: dict[str, str]",
		...declarations,
		...signatures,
	].join("\n");
}

const HOST_PYTHON_STUBS = ["def schema(shape: Any) -> dict[str, Any]: ...", ...HOST_FUNCTION_STUBS];

/** Complete type-checking stubs, including the signature of every callable extension tool. */
export function guestPythonStubs(cwd: string, callable: readonly AgentTool[]): string {
	const declarations: string[] = [];
	const extensions = extensionPythonTools(callable).map((tool) =>
		toolSignature(tool.name, tool.parameters as Schema, "dict[str, Any]", declarations),
	);
	return [
		corePythonStubs(cwd, callable),
		"peer_bindings: dict[str, str]",
		...declarations,
		...extensions,
		...HOST_PYTHON_STUBS,
		evidencePythonStubs(),
	].join("\n");
}

/** Model-facing stubs: full core and host signatures; extension tools are discovered on demand so this text stays stable. */
function guestPromptStubs(cwd = "."): string {
	return [
		corePythonStubs(cwd),
		"def schema(shape: Any) -> dict[str, Any]: ...",
		PEER_PYTHON_STUBS,
		...HOST_PROMPT_STUBS,
		evidencePythonStubs(),
		'Captured extension tools are async functions here too, with keyword arguments type-checked against their schemas. Find one with tools_list() or tools_search(query) and read its parameters with await tools_describe(name="...").',
	].join("\n");
}

export const PI_EXEC_PROMPT_SNIPPET =
	"Compose tools and peer turns in Python; compute over results before returning evidence";

export const PI_EXEC_DESCRIPTION =
	"Run type-checked Python in bounded Monty to compose tools, peer turns, and HTTP requests, and compute over their results. Return a JSON-compatible trailing expression; printed output is also captured. See code for live signatures and runtime constraints.";

export const PI_EXEC_PROMPT_GUIDELINES = [
	"Use pi_exec to compose tool calls or compute over their results. Use direct tools for a single operation that needs neither.",
	"Keep intermediate results inside the program. Return the smallest result that preserves the evidence needed for the next decision: aggregate counts, select relevant excerpts, or report exceptions instead of dumping raw output.",
	"Check tool and peer outcomes before using their results. Surface failures and missing evidence explicitly.",
	"Attach awake colleagues with pi_exec peers={name: session_id}; peers[name].run(task) waits for their own session to be idle. Their role owns their model and thinking. They stay alive after the program.",
	"Use agent(role=..., task=...) for a fresh temporary colleague, or p = await peer(role) for several turns with one. await p.close() releases it early; program completion, failure, or cancellation cleans every remaining temporary peer. Handles belong to one execution, even when Python globals persist.",
];

export function piExecGuestApiContract(): string {
	return [
		"Python 3.14 subset (Monty). Snippets accept top-level await and return the trailing expression. All code is type-checked before execution.",
		"Import asyncio and use asyncio.gather(*awaitables) for independent fan-out; await dependent steps in order. There is no create_task and no third-party import.",
		"Host functions are async; pass keyword arguments. schema(shape) is pure local Python. Type-checking stubs:",
		guestPromptStubs(),
		"tools_search/tools_call support dynamic discovery. fetch handles HTTP; skills_list/skills_body expose model-invocable skills.",
		"git_change/git_patch and repo_change_neighborhood collect scoped evidence; context_* fits peer context; dev_find_relevant_tests/dev_run_relevant_tests locate and run focused checks.",
		'agent_run returns a status record (including errors, and per-file edit/write changes); agent returns text or the output_schema value and raises on failure. Both create a fresh catalog-role peer, assign the goal, and discard the peer when the call ends. Context is bound as a file beside that goal, not copied into its text. Use schema({"id": "int"}) for strict object schemas.',
		'Inputs is a dict of caller-supplied strings. Python globals persist across calls on the current Pi session branch and keep their first type, so give each program\'s variables specific names; reset is a tool parameter that starts fresh. bash, edit, and write return {"ok": bool, "output": str}. Print is captured. Return only JSON-compatible values; display and limits are tool parameters, not globals.',
	].join("\n");
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
