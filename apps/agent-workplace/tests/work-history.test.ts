import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import { taskReader } from "../src/backend/facts.js";
import type { SessionRow } from "../src/backend/projection.js";
import { openWorkplace, workplaceReader } from "../src/backend/workplace.js";
import type { WorldSnapshot } from "../src/world.js";

let dir: string;
let db: DatabaseSync;
let read: ReturnType<typeof workplaceReader>;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aw-work-history-"));
	db = new DatabaseSync(join(dir, "state.db"));
	migrate(db);
	read = workplaceReader(taskReader());
});
afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

function task(id: string, organization: string, status = "in-progress", closed: number | null = null) {
	const bundle = join(dir, id);
	mkdirSync(bundle);
	writeFileSync(
		join(bundle, "task.md"),
		`# ${id} title\n\nStatus: ${status}\n\nPrivate goal body for explicit reads only.\n`,
	);
	db.prepare(`insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at, archived_at, close_status)
		values (?, ?, ?, ?, 1, ?, 100, ?, ?)`).run(
		id,
		bundle,
		dir,
		organization,
		`task:${id}`,
		closed,
		closed === null ? null : status,
	);
	return bundle;
}
function assignment(taskId: string, person: string, assigned: number, ended: number | null, reason: string | null) {
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at, ended_at, end_reason, outcome) values (?, ?, 'operator', ?, ?, ?, ?)",
	).run(person, taskId, assigned, ended, reason, ended === null ? null : "Private outcome prose");
}
function member(id: string, reportsTo: string | null): SessionRow {
	return {
		id,
		name: id,
		cwd: dir,
		reportsTo,
		repository: null,
		manages: reportsTo === null,
		title: null,
		retiredAt: null,
		retiredReason: null,
		awake: true,
		firstStartedAt: 1,
	};
}

test("history keeps recorded team ownership and actual assignment endings while the active board stays live-only", () => {
	task("finished", "old-head", "done", 500);
	task("live", "new-head");
	assignment("finished", "moved-person", 120, 400, "finished");
	assignment("finished", "helper", 130, 200, "unassigned");
	assignment("finished", "helper", 220, 300, "finished");
	assignment("finished", "temporary", 140, 190, "discarded");
	assignment("finished", "legacy", 150, 180, null);
	assignment("live", "moved-person", 510, null, null);
	db.prepare("insert into work_focus (person, task_id) values ('moved-person', 'live')").run();
	const sessions = [member("old-head", "new-head"), member("new-head", null), member("moved-person", "new-head")];
	const result = read(db, sessions, true);
	expect(result.tasks.map((item) => item.id)).toEqual(["live"]);
	const finished = result.workHistory!.find((item) => item.id === "finished")!;
	expect(finished).toMatchObject({
		title: "finished title",
		status: "done",
		headquarters: "old-head",
		openedAt: 100,
		closedAt: 500,
		updatedAt: 500,
	});
	expect(finished.participants).toEqual([
		{ person: "moved-person", assignedAt: 120, endedAt: 400, outcome: "finished", focused: false },
		{ person: "helper", assignedAt: 130, endedAt: 200, outcome: "unassigned", focused: false },
		{ person: "helper", assignedAt: 220, endedAt: 300, outcome: "finished", focused: false },
		{ person: "temporary", assignedAt: 140, endedAt: 190, outcome: "discarded", focused: false },
		{ person: "legacy", assignedAt: 150, endedAt: 180, outcome: "unknown", focused: false },
	]);
	expect(result.workHistory!.find((item) => item.id === "live")).toMatchObject({
		headquarters: "new-head",
		updatedAt: 510,
		participants: [{ person: "moved-person", assignedAt: 510, endedAt: null, outcome: "held", focused: true }],
	});
	expect(JSON.stringify(result)).not.toContain("Private");
});

test("historical goals are read only through known IDs or bundles and cannot be reassigned from the live board", async () => {
	const bundle = task("closed", "head", "done", 300);
	assignment("closed", "writer", 110, 250, "finished");
	const world: WorldSnapshot = { connected: true, headquarters: [], characters: [], workplace: read(db, [], true) };
	const send = vi.fn();
	const actions = openWorkplace(join(dir, "state.db"), { send, close() {} }, () => world);
	expect(await actions.readTask("closed")).toMatchObject({
		ok: true,
		text: expect.stringContaining("Private goal body"),
	});
	expect(await actions.readTask(bundle)).toMatchObject({ ok: true });
	expect(await actions.readTask(join(dir, "state.db"))).toMatchObject({ ok: false });
	expect(await actions.assignTask("writer", "closed")).toMatchObject({ ok: false });
	expect(send).not.toHaveBeenCalled();
});

test("missing historical bundles stay discoverable and runtime closure status wins over an edited goal file", () => {
	const bundle = task("closed", "head", "cancelled", 300);
	writeFileSync(join(bundle, "task.md"), "# Renamed task\nStatus: in-progress\n");
	const first = read(db, [], true).workHistory![0]!;
	expect(first).toMatchObject({ title: "Renamed task", status: "cancelled", participants: [] });
	rmSync(bundle, { recursive: true });
	const missing = read(db, [], true).workHistory![0]!;
	expect(missing).toMatchObject({ id: "closed", title: "closed", status: "cancelled", goalMissing: true });
});

test("history shares task metadata caching and contains no unregistered backlog guesses", () => {
	const bundle = task("known", "head");
	const first = read(db, [], true);
	writeFileSync(join(bundle, "task.md"), "# Changed title\nStatus: ready\n");
	expect(read(db, [], false).workHistory).toEqual(first.workHistory);
	expect(read(db, [], true).workHistory![0]).toMatchObject({ title: "Changed title", status: "ready" });
	const backlog = join(dir, ".ledger", "202610290001-unregistered");
	mkdirSync(backlog, { recursive: true });
	writeFileSync(join(backlog, "task.md"), "# Unregistered\nStatus: ready\n");
	const result = read(db, [member("head", null)], true);
	expect(result.tasks.some((item) => item.title === "Unregistered")).toBe(true);
	expect(result.workHistory!.map((item) => item.id)).toEqual(["known"]);
});
