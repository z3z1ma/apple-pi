import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const settings = JSON.parse(readFileSync(0, "utf8"));
const cwd = mkdtempSync(join(tmpdir(), "pi-rpc-smoke-"));
const sessions = join(cwd, "sessions");
const pi = spawn("pi", ["--mode", "rpc", "--session-dir", sessions], { cwd, stdio: ["pipe", "pipe", "ignore"] });
const report = { reply: "", customMessages: [], notices: [], usage: [], timedOut: false };
let buffer = "";
const finish = () => {
	clearTimeout(timer);
	pi.kill("SIGTERM");
	setTimeout(() => {
		for (const file of (existsSync(sessions) ? readdirSync(sessions) : []).filter((name) => name.endsWith(".jsonl"))) {
			for (const line of readFileSync(join(sessions, file), "utf8").trim().split("\n")) {
				const entry = JSON.parse(line);
				const usage =
					entry.type === "usage"
						? entry.usage
						: entry.type === "message" && entry.message.role === "assistant"
							? entry.message.usage
							: undefined;
				if (entry.type === "message" && entry.message.role === "assistant")
					report.reply =
						entry.message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n") || report.reply;
				if (usage)
					report.usage.push({
						kind: entry.type === "usage" ? entry.kind : "assistant",
						input: usage.input,
						cacheRead: usage.cacheRead,
						output: usage.output,
					});
			}
		}
		rmSync(cwd, { recursive: true, force: true });
		console.log(JSON.stringify(report, null, 1));
	}, 500);
};
const timer = setTimeout(() => {
	report.timedOut = true;
	finish();
}, settings.timeoutMs);
pi.stdout.on("data", (chunk) => {
	buffer += chunk;
	for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method))
			pi.stdin.write(JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true }) + "\n");
		if (event.type === "extension_ui_request" && event.method === "notify") report.notices.push(event.message);
		if (event.type === "message_end" && event.message?.role === "custom") {
			report.customMessages.push({ customType: event.message.customType, content: event.message.content });
			if (event.message.customType === settings.waitFor) finish();
		}
		if (event.type === "agent_end" && !settings.waitFor) finish();
	}
});
pi.stdin.write(JSON.stringify({ type: "prompt", message: settings.prompt }) + "\n");
