import { defineTool } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";

export const PI_EXEC_RETURN_TOOL = "pi_exec_return";

export function normalizeOutputSchema(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("output_schema must be a JSON Schema object");
	const schema = structuredClone(value) as Record<string, unknown>;
	const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
	if (!types.includes("object") && schema.properties === undefined)
		throw new Error("output_schema must describe an object");
	if (!types.includes("object")) schema.type = "object";
	if (schema.additionalProperties === undefined) schema.additionalProperties = false;
	return schema;
}

export function resolveStructuredOutput(
	schema: Record<string, unknown> | undefined,
	returnedValue: unknown,
): { value?: unknown; error?: string } {
	if (!schema) return {};
	if (returnedValue === undefined)
		return { error: `output_schema was not satisfied: ${PI_EXEC_RETURN_TOOL} was not called successfully` };
	if (!returnedValue || typeof returnedValue !== "object" || Array.isArray(returnedValue))
		return { error: "output_schema validation failed: return arguments must be an object" };
	try {
		const value = structuredClone(returnedValue);
		if (!Value.Check(schema as never, value)) {
			const issues = [...Value.Errors(schema as never, value)]
				.slice(0, 3)
				.map((issue) => `${issue.instancePath || "/"}: ${issue.message}`)
				.join("; ");
			return { error: `output_schema validation failed: ${issues || "value does not match schema"}` };
		}
		JSON.stringify(value);
		return { value };
	} catch (error) {
		return { error: `output_schema validation failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function structuredReturnTool(parameters: Record<string, unknown>) {
	return defineTool({
		name: PI_EXEC_RETURN_TOOL,
		label: "Return",
		executionMode: "sequential",
		description:
			"Submit the final structured result. Use this as your last action; the program receives this value, not mail or assistant text.",
		promptSnippet: "Return the final structured result and end the turn",
		promptGuidelines: [`Finish by calling ${PI_EXEC_RETURN_TOOL} with arguments that match its parameter schema.`],
		parameters: parameters as never,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		async execute(_id, params) {
			return { content: [{ type: "text", text: "Result returned." }], details: params, terminate: true };
		},
	});
}
