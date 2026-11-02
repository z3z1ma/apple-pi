import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fakeBridge, query, sendCommand, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const log = join(state.agentDir, "launch.json");

beforeAll(async () => {
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	// A stand-in pi: it says hello and records every command it receives.
	writeFileSync(
		join(bin, "pi"),
		`#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
appendFileSync(process.env.ON_CALL_LOG, JSON.stringify(args) + "\\n");
const socket = createConnection(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.sock");
const send = (message) => socket.write(JSON.stringify(message) + "\\n");
socket.on("connect", () => send({ type: "hello", session: { id: flag("--session-id"), kind: "root", cwd: process.cwd() },
	process: { pid: process.pid, startedAt: Math.floor(Date.now() - process.uptime() * 1000) }, run: "idle", facts: {} }));
let buffer = "";
socket.on("data", (chunk) => {
	buffer += chunk.toString();
	for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
		const message = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		if (message.type !== "command") continue;
		appendFileSync(process.env.ON_CALL_LOG + ".commands", JSON.stringify(message.command) + "\\n");
		if (message.command.kind === "mail") send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
		if (message.command.kind === "close") socket.end(JSON.stringify({ type: "shutdown", reason: "quit" }) + "\\n");
	}
});
socket.on("close", () => process.exit(0));
`,
	);
	chmodSync(join(bin, "pi"), 0o755);
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("ON_CALL_LOG", log);
	await startRuntime(state.socketPath);
});
afterAll(() => stopRuntime(state));

async function personAtHome(id: string, onCall: boolean) {
	const stand = standInProcess();
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { cwd: state.agentDir, name: id },
		facts: { onCall },
	});
	await vi.waitFor(() =>
		expect(query(state.dbPath, "select on_call from sessions where id = ?", id)).toEqual([{ on_call: Number(onCall) }]),
	);
	link.send({ type: "shutdown", reason: "quit" });
	link.socket.end();
	await vi.waitFor(() =>
		expect(
			query(state.dbPath, "select 1 from incarnations where session_id = ? and ended_at is not null", id),
		).toHaveLength(1),
	);
	stand.child.kill();
}

test("mail to an on-call person at home wakes it once and the mail reaches it", async () => {
	await personAtHome("desk", true);
	const first = sendCommand(state.socketPath, "desk", {
		kind: "mail",
		from: "operator",
		body: "Ship the release.",
		sentAt: new Date().toISOString(),
	});
	const second = sendCommand(state.socketPath, "desk", {
		kind: "mail",
		from: "operator",
		body: "And the notes.",
		sentAt: new Date().toISOString(),
	});
	await Promise.all([first, second]);
	await vi.waitFor(
		() => {
			const commands = existsSync(`${log}.commands`) ? readFileSync(`${log}.commands`, "utf8") : "";
			expect(commands).toContain("Ship the release.");
			expect(commands).toContain("And the notes.");
		},
		{ timeout: 10000 },
	);
	const launches = readFileSync(log, "utf8").trim().split("\n");
	expect(launches).toHaveLength(1);
	expect(JSON.parse(launches[0]!)).toEqual(expect.arrayContaining(["--session-id", "desk"]));
});

test("mail to a person at home who is not on call waits without waking it", async () => {
	await personAtHome("sleeper", false);
	await sendCommand(state.socketPath, "sleeper", {
		kind: "mail",
		from: "operator",
		body: "Later.",
		sentAt: new Date().toISOString(),
	});
	await new Promise((resolve) => setTimeout(resolve, 300));
	expect(readFileSync(log, "utf8")).not.toContain('"sleeper"');
	expect(query(state.dbPath, "select stage from commands where session_id = ? and kind = 'mail'", "sleeper")).toEqual([
		{ stage: "accepted" },
	]);
});
