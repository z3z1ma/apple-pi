import { readFileSync } from "node:fs";

const task = process.argv.at(-1);
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const usage = {
	input: 2,
	output: 3,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 5,
	cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
};
// Controlled mode: a JSON task such as {"gate":"http://…/alpha","tool":"read","args":{"path":"a.txt"}}
// starts one child tool, waits for the gate response, and reports it failed when the body starts with "error:".
const controlled = task?.startsWith("{") ? JSON.parse(task) : undefined;
if (controlled) {
	// holdTerm models a worker that keeps running briefly after cancellation and then reports late events.
	if (controlled.holdTerm) process.on("SIGTERM", () => {});
	const tools = (controlled.tools ?? [controlled]).map((tool, index) => ({ ...tool, id: `${tool.tool}-${index + 1}` }));
	send({ type: "message_start", message: { role: "assistant" } });
	send({
		type: "message_end",
		message: {
			role: "assistant",
			stopReason: "toolUse",
			usage,
			content: tools.map((tool) => ({ type: "toolCall", id: tool.id, name: tool.tool, arguments: tool.args ?? {} })),
		},
	});
	const results = await Promise.all(
		tools.map(async (tool) => {
			send({ type: "tool_execution_start", toolCallId: tool.id, toolName: tool.tool, args: tool.args ?? {} });
			const body = await (await fetch(tool.gate)).text();
			const isError = body.startsWith("error:");
			const content = [{ type: "text", text: body }];
			send({ type: "tool_execution_end", toolCallId: tool.id, toolName: tool.tool, isError, result: { content } });
			return { toolCallId: tool.id, isError, content, body };
		}),
	);
	for (const result of results) send({ type: "message_end", message: { role: "toolResult", ...result } });
	const body = results.map((result) => result.body).join(" · ");
	if (process.env.PI_EXEC_OUTPUT_SCHEMA) {
		const contextPath = process.argv.find((arg) => arg.startsWith("@"));
		const context = contextPath ? JSON.parse(readFileSync(contextPath.slice(1), "utf8")) : {};
		const value = { id: context.id };
		send({
			type: "message_end",
			message: {
				role: "assistant",
				stopReason: "toolUse",
				usage,
				content: [{ type: "toolCall", id: "return-1", name: "pi_exec_return", arguments: value }],
			},
		});
		send({ type: "tool_execution_start", toolCallId: "return-1", toolName: "pi_exec_return", args: value });
		send({ type: "tool_execution_end", toolCallId: "return-1", toolName: "pi_exec_return", isError: false });
		const accepted = [{ type: "text", text: "accepted" }];
		send({ type: "message_end", message: { role: "toolResult", toolCallId: "return-1", content: accepted } });
	}
	send({ type: "message_start", message: { role: "assistant" } });
	send({
		type: "message_end",
		message: { role: "assistant", stopReason: "stop", usage, content: [{ type: "text", text: `done:${body}` }] },
	});
} else if (task === "bad") {
	process.stderr.write("worker failed\n");
	process.exitCode = 1;
} else {
	const contextPath = process.argv.find((arg) => arg.startsWith("@"));
	const context = contextPath ? JSON.parse(readFileSync(contextPath.slice(1), "utf8")) : undefined;
	const id = context?.id ?? task;
	if (task === "edits") {
		const patch = "--- README.md\n+++ README.md\n@@ -1 +1,2 @@\n-old\n+new\n+more\n";
		send({ type: "tool_execution_start", toolCallId: "e1", toolName: "edit", args: { path: "README.md" } });
		send({
			type: "tool_execution_end",
			toolCallId: "e1",
			toolName: "edit",
			isError: false,
			result: { details: { patch } },
		});
		send({
			type: "tool_execution_start",
			toolCallId: "w1",
			toolName: "write",
			args: { path: "not-a-file.txt", content: "a\n" },
		});
		send({ type: "tool_execution_end", toolCallId: "w1", toolName: "write", isError: true, result: {} });
	}
	if (process.env.PI_EXEC_OUTPUT_SCHEMA) {
		send({
			type: "message_end",
			message: {
				role: "assistant",
				stopReason: "toolUse",
				usage,
				content: [{ type: "toolCall", id: `return-${task}`, name: "pi_exec_return", arguments: { id } }],
			},
		});
		send({ type: "tool_execution_start", toolName: "pi_exec_return", args: { id } });
		send({ type: "tool_execution_end", toolName: "pi_exec_return", isError: false });
		send({
			type: "message_end",
			message: { role: "toolResult", toolCallId: `return-${task}`, content: [{ type: "text", text: "accepted" }] },
		});
	}
	send({
		type: "message_end",
		message: { role: "assistant", stopReason: "stop", usage, content: [{ type: "text", text: `text:${task}` }] },
	});
}
