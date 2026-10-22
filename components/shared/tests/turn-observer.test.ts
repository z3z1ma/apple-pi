import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { expect, test } from "vitest";
import { resolveStructuredOutput } from "../src/structured-output.js";
import { createTurnObserver } from "../src/turn-observer.js";

const schema = {
	type: "object",
	properties: { value: { type: "integer" } },
	required: ["value"],
	additionalProperties: false,
};

test("a structured value that cannot cross JSON fails with a result error", () => {
	expect(resolveStructuredOutput({ type: "object", additionalProperties: true }, { value: 1n })).toMatchObject({
		error: expect.stringContaining("output_schema validation failed"),
	});
});

test("a successful retry returns the final answer rather than retaining the earlier provider error", () => {
	const run = createTurnObserver(process.cwd());
	run.observe({
		type: "message_end",
		message: fauxAssistantMessage("", { stopReason: "error", errorMessage: "temporary failure" }),
	});
	run.observe({ type: "message_end", message: fauxAssistantMessage("Recovered") });
	expect(run.finish()).toMatchObject({ status: "completed", text: "Recovered" });
});

test("structured returns use the successful tool result after hooks, not the model's original arguments", () => {
	const run = createTurnObserver(process.cwd());
	run.observe({
		type: "message_end",
		message: fauxAssistantMessage([fauxToolCall("pi_exec_return", { value: 1 }, { id: "r" })], {
			stopReason: "toolUse",
		}),
	});
	run.observe({
		type: "tool_execution_end",
		toolCallId: "r",
		toolName: "pi_exec_return",
		isError: false,
		result: { content: [{ type: "text", text: "Result returned" }], details: { value: 2 } },
	});
	expect(run.finish({ outputSchema: schema })).toMatchObject({ status: "completed", value: { value: 2 } });
});

test("a later failed return cannot reuse an earlier successful value", () => {
	const run = createTurnObserver(process.cwd());
	run.observe({
		type: "message_end",
		message: fauxAssistantMessage([fauxToolCall("pi_exec_return", { value: 1 }, { id: "r" })], {
			stopReason: "toolUse",
		}),
	});
	run.observe({
		type: "tool_execution_end",
		toolCallId: "r",
		toolName: "pi_exec_return",
		isError: false,
		result: { details: { value: 1 } },
	});
	run.observe({
		type: "tool_execution_end",
		toolCallId: "r2",
		toolName: "pi_exec_return",
		isError: true,
		result: { content: [{ type: "text", text: "invalid" }] },
	});
	expect(run.finish({ outputSchema: schema })).toMatchObject({
		status: "failed",
		error: expect.stringContaining("not called successfully"),
	});
});
