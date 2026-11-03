import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { migrate } from "../src/schema.js";
import {
	fakeBridge,
	query,
	runtimePid,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "./helpers.js";
import { rewindRecentSchema } from "./historical-schema.js";

const state = tempStateDir();
const log = join(state.agentDir, "launch.json");

beforeAll(async () => {
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
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
	const commands = readFileSync(`${log}.commands`, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(commands).toContainEqual(
		expect.objectContaining({ kind: "steer", text: expect.stringContaining("mail arrived") }),
	);
	const launches = readFileSync(log, "utf8").trim().split("\n");
	expect(launches).toHaveLength(1);
	expect(JSON.parse(launches[0]!)).toEqual(expect.arrayContaining(["--session-id", "desk"]));
});

test("a schedule mails its target on time, repeats, survives as a thread, and stops when cancelled", async () => {
	await personAtHome("night-desk", true);
	const created = await sendCommand(
		state.socketPath,
		"night-desk",
		{ kind: "schedule", to: "night-desk", body: "Sweep the board.", firstAt: Date.now(), everyMs: 60_000 },
		{ commandId: "sweep" },
	);
	expect(created.at(-1)).toEqual({ stage: "applied" });
	await vi.waitFor(
		() => {
			expect(readFileSync(`${log}.commands`, "utf8")).toContain("Sweep the board.");
		},
		{ timeout: 10000 },
	);
	const [row] = query<{ next_at: number; last_fired_at: number }>(
		state.dbPath,
		"select next_at, last_fired_at from schedules where id = 'sweep'",
	);
	expect(row!.next_at - row!.last_fired_at).toBeGreaterThan(50_000);
	expect(query(state.dbPath, "select subject from threads where id = 'schedule:sweep'")).toEqual([
		{ subject: "Scheduled by night-desk" },
	]);
	const stopped = await sendCommand(state.socketPath, "operator", { kind: "unschedule", id: "sweep" });
	expect(stopped.at(-1)).toEqual({ stage: "applied" });
	expect(query(state.dbPath, "select cancelled_at is not null as done from schedules where id = 'sweep'")).toEqual([
		{ done: 1 },
	]);
});

test("a channel's listener is pushed every post with the charter it applies", { timeout: 20_000 }, async () => {
	await personAtHome("triage", true);
	const db = new DatabaseSync(state.dbPath);
	try {
		db.prepare(
			"insert into threads (id, kind, channel_type, subject, created_by, created_at) values ('topic:bugs', 'channel', 'topic', 'bugs', 'operator', 1)",
		).run();
		db.prepare(
			"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at, invited) values ('topic:bugs', 'operator', 'pull', 0, 1, 1)",
		).run();
	} finally {
		db.close();
	}
	const set = await sendCommand(state.socketPath, "operator", {
		kind: "channel_charter",
		thread: "topic:bugs",
		listener: "triage",
		charter: "Reproduce reported failures silently; post only confirmed fixes.",
	});
	expect(set.at(-1)).toEqual({ stage: "applied" });
	const refused = await sendCommand(state.socketPath, "sleeper-2", {
		kind: "channel_charter",
		thread: "topic:bugs",
		listener: null,
		charter: null,
	});
	expect(refused.at(-1)?.stage).toBe("failed");
	const posted = await sendCommand(state.socketPath, "operator", {
		kind: "thread_post",
		thread: "topic:bugs",
		body: "Checkout returns 500 after login.",
	});
	expect(posted.at(-1)?.stage).toBe("applied");
	await vi.waitFor(
		() => {
			const commands = readFileSync(`${log}.commands`, "utf8");
			expect(commands).toContain("Checkout returns 500 after login.");
			expect(commands).toContain("Channel charter (you listen here): Reproduce reported failures silently");
		},
		{ timeout: 10000 },
	);
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

test("after a restart, a channel listener whose mail still waits is woken; other waiting mail still waits", {
	timeout: 30_000,
}, async () => {
	await personAtHome("listener-late", false);
	const pid = runtimePid(state.pidPath)!;
	process.kill(pid, "SIGTERM");
	await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5000 });
	const db = new DatabaseSync(state.dbPath);
	try {
		db.exec(
			"insert into threads (id, kind, channel_type, subject, created_by, created_at, listener) values ('topic:late', 'channel', 'topic', 'late', 'operator', 1, 'listener-late')",
		);
		db.prepare(
			`insert into commands (command_id, session_id, generation, bound_generation, kind, command, stage, created_at, updated_at)
			values ('late-mail', 'listener-late', null, null, 'mail', ?, 'accepted', 1, 1)`,
		).run(
			JSON.stringify({
				kind: "mail",
				from: "operator",
				body: "Waiting since before the restart.",
				sentAt: new Date().toISOString(),
				thread: "topic:late",
			}),
		);
	} finally {
		db.close();
	}
	await startRuntime(state.socketPath);
	await vi.waitFor(
		() => expect(readFileSync(`${log}.commands`, "utf8")).toContain("Waiting since before the restart."),
		{
			timeout: 15000,
		},
	);
	expect(readFileSync(log, "utf8")).not.toContain('"sleeper"');
});

test("the departure-subject migration renames only departure threads", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	db.exec(`insert into events (at, source, session_id, generation, type, data) values (1, 'runtime', 'gone', null, 'person_departed', '{"name":"Gone Person"}');
		insert into threads (id, kind, subject, created_by, created_at) values ('departure:x', 'mail', 'Departure: gone', 'harness', 1), ('t-other', 'mail', 'Departure: gone', 'operator', 1);`);
	rewindRecentSchema(db, 43);
	migrate(db);
	expect(db.prepare("select id, subject from threads order by id").all()).toEqual([
		{ id: "departure:x", subject: "Departure: Gone Person" },
		{ id: "t-other", subject: "Departure: gone" },
	]);
	db.close();
});
