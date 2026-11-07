import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
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

const state = tempStateDir();
const repo = join(state.agentDir, "repo");
const HOUR = 3_600_000;
let stand: ReturnType<typeof standInProcess>;

function ledgerTask(name: string, status: string, title: string): string {
	const bundle = join(repo, ".ledger", name);
	mkdirSync(bundle, { recursive: true });
	writeFileSync(join(bundle, "task.md"), `Status: ${status}\n\n# ${title}\n`);
	return bundle;
}

async function person(id: string, facts: Record<string, unknown> = {}) {
	await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, { session: { cwd: repo, name: id }, facts });
	await vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1));
}

async function people() {
	await person("boss");
	await person("desk", { reportsTo: "boss", role: "coordinator" });
	await person("ada", { reportsTo: "boss" });
	await vi.waitFor(() =>
		expect(query(state.dbPath, "select count(*) as n from sessions where reports_to = 'boss'")).toEqual([{ n: 2 }]),
	);
}

async function command(sender: string, body: Parameters<typeof sendCommand>[2]) {
	const receipts = await sendCommand(state.socketPath, sender, body);
	expect(receipts.at(-1), JSON.stringify(receipts)).toEqual({ stage: "applied" });
}

function shift(file: string, by: number) {
	const at = statSync(file).mtimeMs - by;
	utimesSync(file, at / 1000, at / 1000);
}

function age(hours: number) {
	const by = hours * HOUR;
	const db = new DatabaseSync(state.dbPath);
	try {
		for (const sql of [
			"update thread_messages set at = at - ?1",
			"update assignments set assigned_at = assigned_at - ?1, ended_at = ended_at - ?1",
			"update focus_spans set started_at = started_at - ?1, ended_at = ended_at - ?1",
			"update work_tasks set opened_at = opened_at - ?1",
			"update task_notices set at = at - ?1",
			"update task_snoozes set at = at - ?1",
		])
			db.prepare(sql).run(by);
		for (const { bundle } of db.prepare("select bundle from work_tasks").all() as { bundle: string }[])
			shift(join(bundle, "task.md"), by);
	} finally {
		db.close();
	}
	for (const name of ["202611070001-ready-thing", "202611070002-parked-idea"])
		shift(join(repo, ".ledger", name, "task.md"), by);
}

function digests(): string[] {
	return query<{ body: string }>(
		state.dbPath,
		"select body from thread_messages where thread_id = 'stuck:boss:desk' order by seq",
	).map((row) => row.body);
}

async function halt() {
	process.kill(runtimePid(state.pidPath)!, "SIGTERM");
	await vi.waitFor(() => expect(existsSync(state.socketPath)).toBe(false), { timeout: 10000 });
}

async function restart() {
	await halt();
	await startRuntime(state.socketPath);
	await people();
}

beforeAll(async () => {
	mkdirSync(join(repo, ".git"), { recursive: true });
	ledgerTask("202611070001-ready-thing", "ready", "Ready thing");
	ledgerTask("202611070002-parked-idea", "planning", "Parked idea");
	stand = standInProcess();
	await startRuntime(state.socketPath);
	await people();
});
afterAll(async () => {
	stand.child.kill();
	await stopRuntime(state);
});

test("stuck tasks reach the organization's coordinator once per quiet period, and a snooze holds until the task changes", async () => {
	await command("boss", {
		kind: "work",
		action: "assign",
		cwd: repo,
		person: "ada",
		goal: "Ship the parser.",
		title: "Parser",
	});
	await command("boss", {
		kind: "work",
		action: "assign",
		cwd: repo,
		person: "ada",
		goal: "Write the docs.",
		title: "Docs",
	});
	const tasks = query<{ id: string; bundle: string }>(state.dbPath, "select id, bundle from work_tasks order by rowid");
	const [parser, docs] = tasks.map((task) => task.id);
	await command("boss", { kind: "work", action: "unassign", cwd: repo, person: "ada", task: docs! });

	await restart();
	expect(digests()).toEqual([]);

	await halt();
	age(5);
	await startRuntime(state.socketPath);
	await vi.waitFor(() => expect(digests()).toHaveLength(1), { timeout: 10000 });
	const [first] = digests();
	expect(first).toMatch(/held, no update for 5h: Parser/);
	expect(first).toMatch(/Held by ada/);
	expect(first).toMatch(/unassigned, no update for 5h: Docs/);
	expect(first).toMatch(/unassigned, no update for 5h: Ready thing/);
	expect(first).not.toContain("Parked idea");
	await people();

	await restart();
	expect(digests()).toHaveLength(1);

	await command("desk", { kind: "snooze", task: parser!, until: Date.now() + 24 * HOUR });
	await halt();
	age(5);
	await startRuntime(state.socketPath);
	await vi.waitFor(() => expect(digests()).toHaveLength(2), { timeout: 10000 });
	expect(digests()[1]).not.toContain("Parser");
	expect(digests()[1]).toContain("Docs");
	await people();

	await command("ada", { kind: "thread_post", thread: `task:${parser}`, body: "Blocked on the grammar." });
	await halt();
	age(5);
	await startRuntime(state.socketPath);
	await vi.waitFor(() => expect(digests()).toHaveLength(3), { timeout: 10000 });
	expect(digests()[2]).toContain("Parser");
	await people();
}, 120000);

test("a task check-in carries the task's holders and stops once the task closes", async () => {
	await command("boss", {
		kind: "work",
		action: "assign",
		cwd: repo,
		person: "ada",
		goal: "Tune the cache.",
		title: "Cache",
	});
	const [{ id: task }] = query<{ id: string }>(
		state.dbPath,
		"select id from work_tasks where bundle like '%' order by rowid desc limit 1",
	) as [{ id: string }];
	const created = await sendCommand(
		state.socketPath,
		"boss",
		{ kind: "schedule", to: "boss", body: "How is the cache going?", firstAt: Date.now(), everyMs: 60_000, task },
		{ commandId: "cache-check" },
	);
	expect(created.at(-1)).toEqual({ stage: "applied" });
	await vi.waitFor(
		() =>
			expect(
				query(state.dbPath, "select body from thread_messages where thread_id = 'schedule:cache-check'"),
			).toHaveLength(1),
		{ timeout: 10000 },
	);
	const [{ body }] = query<{ body: string }>(
		state.dbPath,
		"select body from thread_messages where thread_id = 'schedule:cache-check'",
	) as [{ body: string }];
	expect(body).toContain("How is the cache going?");
	expect(body).toMatch(/Cache \[.*\]/);
	expect(body).toMatch(/Held by ada/);
	expect(query(state.dbPath, "select subject from threads where id = 'schedule:cache-check'")).toEqual([
		{ subject: "Check-in: Cache" },
	]);

	await command("operator", { kind: "work", action: "close", cwd: repo, task, status: "done" });
	const db = new DatabaseSync(state.dbPath);
	try {
		db.prepare("update schedules set next_at = ? where id = 'cache-check'").run(Date.now());
	} finally {
		db.close();
	}
	await vi.waitFor(
		() =>
			expect(
				query(state.dbPath, "select cancelled_at is not null as stopped from schedules where id = 'cache-check'"),
			).toEqual([{ stopped: 1 }]),
		{ timeout: 10000 },
	);
	expect(query(state.dbPath, "select 1 from thread_messages where thread_id = 'schedule:cache-check'")).toHaveLength(1);
	const refused = await sendCommand(state.socketPath, "boss", {
		kind: "schedule",
		to: "boss",
		body: "Again?",
		firstAt: Date.now(),
		task,
	});
	expect(refused.at(-1)?.stage).toBe("failed");
}, 60000);
