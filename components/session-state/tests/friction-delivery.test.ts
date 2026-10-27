import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { recordLink } from "../src/links.js";
import { statePaths } from "../src/paths.js";
import { lineReader } from "../src/protocol.js";
import { Runtime } from "../src/runtime.js";
import { migrate } from "../src/schema.js";
import { fakeBridge, query, sendCommand, standInProcess, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const paths = statePaths();
let runtime: Runtime | undefined;
const children: ChildProcess[] = [];
afterEach(async () => {
	runtime?.stop();
	runtime = undefined;
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill();
			await once(child, "exit");
		}
	}
	vi.restoreAllMocks();
	rmSync(state.agentDir, { recursive: true, force: true });
});

function seed(cycle: boolean, rejectOutbox = false) {
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(paths.db);
	migrate(db);
	for (const [id, parent, role, manages] of [
		["root", null, null, 0],
		["manager", "root", "coordinator", 1],
		["a", "manager", "implementation-engineer", 0],
		["b", "manager", "implementation-engineer", 0],
	] as const)
		db.prepare(`insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to, role, manages)
			values (?, 'root', '/not-read', 'idle', 1, 'fixture', 0, ?, ?, ?)`).run(id, parent, role, manages);
	for (const id of ["a", "b"]) {
		db.prepare(`insert into work_tasks (id, bundle, project, organization, ephemeral, thread)
			values (?, ?, '/not-read', 'root', 0, ?)`).run(id, `/not-read/${id}`, `task:${id}`);
		db.prepare("insert into assignments (person, task_id, assigned_by, assigned_at) values (?, ?, 'root', 0)").run(
			id,
			id,
		);
	}
	recordLink(
		db,
		"cycle-a",
		"root",
		{ from: { kind: "task", id: "a" }, to: { kind: "task", id: "b" }, relation: "blocks" },
		10,
	);
	if (cycle)
		recordLink(
			db,
			"cycle-b",
			"root",
			{ from: { kind: "task", id: "b" }, to: { kind: "task", id: "a" }, relation: "blocks" },
			10,
		);
	if (rejectOutbox)
		db.exec(`create trigger reject_friction before insert on commands
			when new.kind = 'mail' and json_extract(new.command, '$.from') = 'harness'
			begin select raise(abort, 'fixture outbox failure'); end`);
	db.close();
}

async function start() {
	runtime = new Runtime(paths);
	expect(await runtime.start()).toBe(true);
}
const count = (table: string, where = "1") =>
	query<{ count: number }>(paths.db, `select count(*) as count from ${table} where ${where}`)[0].count;
const raised = () => count("events", "type = 'friction_raised'");

test("runtime commits one notice with its outbox, delivers it and rearms across restart and resolution", async () => {
	seed(true);
	await start();
	expect(raised()).toBe(1);
	expect(count("thread_messages")).toBe(1);
	expect(query(paths.db, "select session_id, stage from commands where kind = 'mail'")).toEqual([
		{ session_id: "manager", stage: "accepted" },
	]);
	const stand = standInProcess();
	children.push(stand.child);
	const bridge = await fakeBridge(paths.socket, "manager", stand.pid, stand.startedAt);
	const mail: { commandId: string; body: string }[] = [];
	bridge.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line);
			if (message.type === "command" && message.command?.kind === "mail")
				mail.push({ commandId: message.commandId, body: message.command.body });
		}),
	);
	await vi.waitFor(() => expect(mail).toHaveLength(1), { timeout: 5000 });
	expect(mail[0].body).toContain("link:cycle-");
	bridge.send({ type: "command_progress", commandId: mail[0].commandId, stage: "applied" });
	await vi.waitFor(() => expect(count("commands", "kind = 'mail' and stage = 'applied'")).toBe(1));
	bridge.socket.destroy();
	runtime!.stop();
	await start();
	expect(raised()).toBe(1);
	expect(count("thread_messages")).toBe(1);
	const resolved = await sendCommand(paths.socket, "root", {
		kind: "link_resolve",
		id: "cycle-b",
		resolution: "answered",
	});
	expect(resolved.at(-1)?.stage).toBe("applied");
	await vi.waitFor(() => expect(count("events", "type = 'friction_cleared'")).toBe(1), { timeout: 5000 });
	expect(count("thread_messages")).toBe(1);
	const returned = await sendCommand(paths.socket, "root", {
		kind: "link_record",
		from: { kind: "task", id: "b" },
		to: { kind: "task", id: "a" },
		relation: "blocks",
	});
	expect(returned.at(-1)?.stage).toBe("applied");
	await vi.waitFor(() => expect(raised()).toBe(2), { timeout: 5000 });
	expect(count("thread_messages")).toBe(2);
	expect(count("commands", "kind = 'mail'")).toBe(2);
}, 20000);

test("failed observation publication leaves producing work committed and retries after restart", async () => {
	seed(false, true);
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	await start();
	const result = await sendCommand(paths.socket, "root", {
		kind: "link_record",
		from: { kind: "task", id: "b" },
		to: { kind: "task", id: "a" },
		relation: "blocks",
	});
	expect(result.at(-1)?.stage).toBe("applied");
	await vi.waitFor(() => expect(errors).toHaveBeenCalledWith("Friction publication failed: fixture outbox failure"), {
		timeout: 5000,
	});
	expect(count("links")).toBe(2);
	expect(raised()).toBe(0);
	expect(count("thread_messages")).toBe(0);
	expect(count("commands", "kind = 'mail'")).toBe(0);
	runtime!.stop();
	const db = new DatabaseSync(paths.db);
	db.exec("drop trigger reject_friction");
	db.close();
	await start();
	expect(raised()).toBe(1);
	expect(count("thread_messages")).toBe(1);
	expect(count("commands", "kind = 'mail'")).toBe(1);
}, 15000);
