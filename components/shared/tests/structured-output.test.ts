import { expect, test } from "vitest";
import { normalizeOutputSchema, PI_EXEC_RETURN_TOOL, resolveStructuredOutput } from "../src/structured-output.js";

test("an object return schema is normalized without accepting scalar schemas", () => {
	expect(normalizeOutputSchema({ properties: { id: { type: "number" } }, required: ["id"] })).toEqual({
		type: "object",
		properties: { id: { type: "number" } },
		required: ["id"],
		additionalProperties: false,
	});
	expect(() => normalizeOutputSchema({ type: "string" })).toThrow(/must describe an object/);
});

test("a return value must match the schema without coercion, omission or an arbitrary length cutoff", () => {
	const schema = normalizeOutputSchema({ properties: { id: { type: "number" } }, required: ["id"] });
	expect(resolveStructuredOutput(schema, { id: 7 })).toEqual({ value: { id: 7 } });
	expect(resolveStructuredOutput(schema, undefined).error).toContain(PI_EXEC_RETURN_TOOL);
	expect(resolveStructuredOutput(schema, { id: "7" }).error).toMatch(/validation failed/);
	expect(resolveStructuredOutput(undefined, { id: 7 })).toEqual({});
	const largeSchema = normalizeOutputSchema({ properties: { text: { type: "string" } }, required: ["text"] });
	const value = { text: "x".repeat(75_000) };
	expect(resolveStructuredOutput(largeSchema, value)).toEqual({ value });
});
