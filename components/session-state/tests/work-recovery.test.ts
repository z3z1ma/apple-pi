import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../src/schema.js";
import { query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const project = join(state.agentDir, "project");
beforeAll(async () => {
	mkdirSync(state.stateDir, { recursive: true });
	mkdirSync(project);
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('person', 'root', ?, 'idle', 1, 'fixture', 0)",
	).run(project);
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('manager', 'root', ?, 'idle', 1, 'fixture', 0)",
	).run(project);
	db.exec("update sessions set reports_to = 'manager' where id = 'person'");
	db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values ('recover', 'person', 'work', ?, 'accepted', 1, 1)",
	).run(JSON.stringify({ kind: "work", action: "take", goal: "An accepted goal survives a restart.", cwd: project }));
	db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values ('interrupted', 'person', 'work', ?, 'delivered', 1, 1)",
	).run(JSON.stringify({ kind: "work", action: "take", goal: "Inspect the partial file changes.", cwd: project }));
	mkdirSync(join(state.stateDir, "tasks", "work-interrupted"), { recursive: true });
	writeFileSync(join(state.stateDir, "tasks", "work-interrupted", "task.md"), "# Original goal retained\n");
	db.exec(
		"create trigger refuse_work_mail before insert on commands when new.command_id in ('broken:post:manager', 'promote-fails:post:manager', 'finish-fails:post:manager') begin select raise(abort, 'outbox unavailable'); end",
	);
	const source = join(state.stateDir, "tasks", "moved-task");
	const destination = join(state.stateDir, "tasks", "history", "moved-task");
	for (const bundle of [source, destination]) {
		mkdirSync(bundle, { recursive: true });
		writeFileSync(join(bundle, "task.md"), "# Completed task\nOutcome saved.\n");
	}
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, archived_at) values ('moved-task', ?, ?, 'person', 1, 'task:moved-task', 1)",
	).run(destination, project);
	db.prepare(
		"insert into work_changes (command_id, task_id, person, action, previous_bundle) values ('moved', 'moved-task', 'person', 'finish', ?)",
	).run(source);
	db.close();
	await startRuntime(state.socketPath);
});
afterAll(() => stopRuntime(state));

test("startup finishes source cleanup after a committed archive without touching its saved outcome", () => {
	expect(existsSync(join(state.stateDir, "tasks", "moved-task"))).toBe(false);
	expect(readFileSync(join(state.stateDir, "tasks", "history", "moved-task", "task.md"), "utf8")).toContain(
		"Outcome saved.",
	);
	expect(query(state.dbPath, "select previous_bundle from work_changes where command_id = 'moved'")).toEqual([
		{ previous_bundle: null },
	]);
});

test("interrupted file changes without a committed assignment fail visibly and preserve the files for inspection", () => {
	expect(query(state.dbPath, "select stage, reason from commands where command_id = 'interrupted'")).toEqual([
		{ stage: "failed", reason: expect.stringContaining("Inspect task.md and the ledger index") },
	]);
	expect(query(state.dbPath, "select * from assignments where task_id = 'work-interrupted'")).toEqual([]);
	expect(readFileSync(join(state.stateDir, "tasks", "work-interrupted", "task.md"), "utf8")).toBe(
		"# Original goal retained\n",
	);
});

test("an accepted task change recovers once with its assignment, goal and outgoing notification", async () => {
	expect(query(state.dbPath, "select stage from commands where command_id = 'recover'")).toEqual([
		{ stage: "applied" },
	]);
	expect(query(state.dbPath, "select task_id from assignments where person = 'person'")).toEqual([
		{ task_id: "work-recover" },
	]);
	expect(readFileSync(join(state.stateDir, "tasks/work-recover/task.md"), "utf8")).toContain(
		"An accepted goal survives",
	);
	expect(query(state.dbPath, "select stage from commands where command_id = 'recover:post:manager'")).toEqual([
		{ stage: "accepted" },
	]);
	const repeat = await sendCommand(
		state.socketPath,
		"person",
		{ kind: "work", action: "take", goal: "Duplicate ignored", cwd: project },
		{ commandId: "recover" },
	);
	expect(repeat.at(-1)?.stage).toBe("applied");
	expect(query(state.dbPath, "select count(*) as count from assignments where task_id = 'work-recover'")).toEqual([
		{ count: 1 },
	]);
	expect(
		query(state.dbPath, "select count(*) as count from thread_messages where thread_id = 'task:work-recover'"),
	).toEqual([{ count: 1 }]);
});

test("a failed notification rolls back a new assignment, its task and its goal files", async () => {
	const receipts = await sendCommand(
		state.socketPath,
		"person",
		{ kind: "work", action: "take", goal: "Must not silently take work", cwd: project },
		{ commandId: "broken" },
	);
	expect(receipts.at(-1)).toMatchObject({ stage: "failed", reason: "outbox unavailable" });
	expect(query(state.dbPath, "select * from work_tasks where id = 'work-broken'")).toEqual([]);
	expect(existsSync(join(state.stateDir, "tasks/work-broken"))).toBe(false);
	expect(query(state.dbPath, "select task_id from work_focus where person = 'person'")).toEqual([
		{ task_id: "work-recover" },
	]);
});

test("failed promotion restores the ledger index and leaves the original goal, assignment and focus intact", async () => {
	const receipts = await sendCommand(
		state.socketPath,
		"person",
		{ kind: "work", action: "promote", task: "work-recover", cwd: project },
		{ commandId: "promote-fails" },
	);
	expect(receipts.at(-1)).toMatchObject({ stage: "failed", reason: "outbox unavailable" });
	expect(readdirSync(join(project, ".ledger"))).toEqual([]);
	expect(existsSync(join(state.stateDir, "tasks/work-recover/task.md"))).toBe(true);
	expect(query(state.dbPath, "select ephemeral from work_tasks where id = 'work-recover'")).toEqual([{ ephemeral: 1 }]);
});

test("failed completion restores the outcome and keeps the assignment open", async () => {
	const file = join(state.stateDir, "tasks/work-recover/task.md");
	const before = readFileSync(file, "utf8");
	const receipts = await sendCommand(
		state.socketPath,
		"person",
		{ kind: "work", action: "finish", outcome: "Not committed", cwd: project },
		{ commandId: "finish-fails" },
	);
	expect(receipts.at(-1)).toMatchObject({ stage: "failed", reason: "outbox unavailable" });
	expect(readFileSync(file, "utf8")).toBe(before);
	expect(query(state.dbPath, "select ended_at from assignments where task_id = 'work-recover'")).toEqual([
		{ ended_at: null },
	]);
	expect(existsSync(join(state.stateDir, "tasks/history/work-recover"))).toBe(false);
});
