import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.INTERN_TEST_DIR;
const task = process.argv.at(-1);
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const context = process.argv.find((arg) => arg.startsWith("@"));
const record = {
	pid: process.pid,
	args: process.argv.slice(2),
	context: context?.slice(1),
	material: context ? JSON.parse(readFileSync(context.slice(1), "utf8")) : undefined,
};
let child;
// Like Pi print mode, SIGTERM cleans up tools detached into their own process groups before exiting.
process.on("SIGTERM", () => {
	if (child?.pid) process.kill(-child.pid, "SIGKILL");
	writeFileSync(join(dir, `${task}.stopped`), "stopped");
	process.exit(143);
});
if (task === "waiting") {
	child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
	record.child = child.pid;
}
writeFileSync(join(dir, `${task}.json`), JSON.stringify(record));
send({ type: "message_start", message: { role: "assistant" } });
send({ type: "tool_execution_start", toolCallId: "reading", toolName: "read", args: { path: "src/sample.ts" } });
const finish = () => {
	if (task === "failed") {
		process.stderr.write("source is unavailable");
		process.exit(1);
	}
	send({
		type: "message_end",
		message: {
			role: "assistant",
			stopReason: task === "truncated" ? "length" : "stop",
			content: [{ type: "text", text: `Report for ${task}` }],
			usage: {
				input: 2,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 5,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
	});
};
if (task.startsWith("parallel-")) {
	const other = task === "parallel-one" ? "parallel-two" : "parallel-one";
	const timer = setInterval(() => {
		if (existsSync(join(dir, `${other}.json`))) {
			clearInterval(timer);
			finish();
		}
	}, 10);
} else if (task === "waiting") setInterval(() => {}, 1000);
else finish();
