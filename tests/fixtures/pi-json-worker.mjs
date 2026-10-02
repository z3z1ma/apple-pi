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
if (task === "bad") {
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
