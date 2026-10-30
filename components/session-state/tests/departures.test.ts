import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import {
	type Departure,
	departedPeople,
	departureOf,
	removeDepartureFiles,
	removeDepartureRecords,
	saveHandoff,
} from "../src/departures.js";
import { membership, realizedFitness } from "../src/fitness.js";
import type { Command, Facts } from "../src/protocol.js";
import { Runtime } from "../src/runtime.js";
import { migrate } from "../src/schema.js";
import { messagesOf, nameOf, postToThread } from "../src/threads.js";

const HOUR = 3_600_000;
const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const db of databases.splice(0)) db.close();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
	const db = new DatabaseSync(":memory:");
	databases.push(db);
	migrate(db);
	const clock = vi.spyOn(Date, "now").mockReturnValue(0);
	for (const [id, manager] of [
		["root", null],
		["branch", "root"],
		["person", "root"],
	])
		db.prepare(`insert into sessions (id, kind, cwd, name, run_state, generation, reports_to, source, updated_at)
			values (?, 'root', '/tmp', ?, 'idle', 1, ?, 'test', 0)`).run(
			id!,
			id === "person" ? "Pat Worker" : id!,
			manager ?? null,
		);
	const runtime = Object.assign(Object.create(Runtime.prototype), { db }) as {
		applyFacts(person: string, generation: number, facts: Partial<Facts>, hello?: boolean): void;
		transfer(person: string, command: Extract<Command, { kind: "transfer" }>): string | undefined;
	};
	const depart = (manager: string | null, removeLiveRow = true) => {
		const departure: Departure = {
			commandId: "departure",
			reason: "Assignment complete.",
			name: "Pat Worker",
			role: "implementation-engineer",
			title: "Implementation Engineer",
			reportsTo: manager,
			handoffFile: "/state/handoffs/person.md",
			sessionFile: "/sessions/person.jsonl",
		};
		db.prepare(
			"insert into events (at, source, session_id, type, data) values (?, 'runtime', 'person', 'person_departed', ?)",
		).run(4 * HOUR, JSON.stringify(departure));
		if (removeLiveRow) db.prepare("delete from sessions where id = 'person'").run();
		return departure;
	};
	runtime.applyFacts("person", 1, { cost: 0 }, true);
	return { db, runtime, clock, depart };
}

test("the handoff file preserves exact prose in a private durable location", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-handoff-"));
	directories.push(directory);
	const prose = "Verified: the build passed.\nUncertain: the next rollout is not tested.\n";
	const file = saveHandoff(directory, "person", prose);
	expect(file).toBe(join(directory, "handoffs", "person.md"));
	expect(readFileSync(file, "utf8")).toBe(prose);
	expect(statSync(file).mode & 0o777).toBe(0o600);
	expect(statSync(join(directory, "handoffs")).mode & 0o777).toBe(0o700);
});

test("private record removal keeps shared evidence and redacts private payloads without erasing event history", () => {
	const { db, depart } = fixture();
	depart("root", false);
	postToThread(
		db,
		"person",
		"shared",
		{ thread: "mail", threadKind: "mail", subject: "Result", to: ["root"], body: "Shared result" },
		HOUR,
	);
	db.prepare(`insert into messages (session_id, entry_id, part, at, role, size, preview, source)
		values ('person', 'private', 'text', 0, 'assistant', 1, 'PRIVATE_PREVIEW', 'bridge')`).run();
	db.prepare("insert into work_focus (person, task_id) values ('person', 'shared-task')").run();
	db.prepare("insert into manager_changes (session_id, to_manager, by, at) values ('person', 'root', 'root', 0)").run();
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at, ended_at, outcome, end_reason) values ('person', 'shared-task', 'root', 0, 1, 'Shared outcome', 'finished')",
	).run();
	const event = db.prepare(
		"insert into events (at, source, session_id, type, data) values (0, 'test', 'person', ?, ?)",
	);
	for (const type of [
		"prompt_opened",
		"prompt_closed",
		"queue_changed",
		"config_changed",
		"self_changed",
		"soul_changed",
		"git_changed",
		"last_error_changed",
		"parent_session_file_changed",
		"previous_session_changed",
		"current_task_changed",
	])
		event.run(type, JSON.stringify({ from: "PRIVATE_OLD", to: "PRIVATE_NEW" }));
	event.run("tool_started", JSON.stringify({ id: "read-1", name: "read", arg: "PRIVATE_ARGUMENT" }));
	event.run("shared_future_fact", JSON.stringify({ reference: "Keep this new shared fact" }));
	const insert = db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, reason, created_at, updated_at) values (?, 'person', ?, ?, 'failed', ?, 0, 1)",
	);
	for (const kind of ["start", "steer", "run_turn", "mail", "retire"]) {
		const privateKind = kind !== "mail" && kind !== "retire";
		const command = privateKind
			? { kind, prompt: "PRIVATE_PROMPT", text: "PRIVATE_TEXT", task: "PRIVATE_TASK", role: "engineer" }
			: { kind, body: "Shared receipt", reason: "Assignment complete." };
		const reason = privateKind ? "PRIVATE_FAILURE" : "Keep shared diagnostics";
		insert.run(kind, kind, JSON.stringify(command), reason);
		event.run("command_accepted", JSON.stringify({ commandId: kind, command }));
		event.run("command_failed", JSON.stringify({ commandId: kind, reason }));
	}
	const count = db.prepare("select count(*) as n from events where session_id = 'person'").get();
	db.exec("begin");
	removeDepartureRecords(db, "person", 5 * HOUR);
	db.exec("commit");
	expect(db.prepare("select count(*) as n from events where session_id = 'person'").get()).toEqual(count);
	for (const [table, column] of [
		["sessions", "id"],
		["messages", "session_id"],
		["work_focus", "person"],
		["manager_changes", "session_id"],
	])
		expect(db.prepare(`select 1 from ${table} where ${column} = 'person'`).get()).toBeUndefined();
	expect(messagesOf(db, "mail").map((message) => message.body)).toEqual(["Shared result"]);
	expect(db.prepare("select outcome from assignments where person = 'person'").get()).toEqual({
		outcome: "Shared outcome",
	});
	expect(nameOf(db, "person")).toBe("Pat Worker");
	expect(departureOf(db, "person")?.sessionFile).toBeNull();
	expect(db.prepare("select data from events where type = 'shared_future_fact'").get()).toEqual({
		data: JSON.stringify({ reference: "Keep this new shared fact" }),
	});
	expect(JSON.stringify(db.prepare("select data from events where session_id = 'person'").all())).not.toContain(
		"PRIVATE_",
	);
	expect(
		JSON.stringify(db.prepare("select command, reason from commands where session_id = 'person'").all()),
	).not.toContain("PRIVATE_");
	expect(db.prepare("select reason from commands where command_id = 'mail'").get()).toEqual({
		reason: "Keep shared diagnostics",
	});
	expect(
		db
			.prepare(
				"select json_extract(data, '$.name') as name, json_extract(data, '$.arg') as arg from events where type = 'tool_started'",
			)
			.get(),
	).toEqual({ name: "read", arg: null });
});

test("removing an untransferred person's live row preserves earlier spend and historical attribution", () => {
	const { db, runtime, clock, depart } = fixture();
	clock.mockReturnValue(HOUR);
	runtime.applyFacts("person", 1, { cost: 5 });
	expect(realizedFitness(db, "root", 0, 3 * HOUR).compute).toBe(5);
	expect(
		db.prepare("select 1 from events where type = 'reports_to_changed' and session_id = 'person'").get(),
	).toBeUndefined();
	const departure = depart("root");
	expect(realizedFitness(db, "root", 0, 3 * HOUR).compute).toBe(5);
	expect(nameOf(db, "person")).toBe("Pat Worker");
	expect(departureOf(db, "person")).toEqual(departure);
	expect(departedPeople(db).get("person")).toEqual(departure);
	expect(membership(db, "root").memberAt("person", 5 * HOUR)).toBe(false);
});

test("independent departure keeps null reporting and historical spend after live removal", () => {
	const { db, runtime, clock, depart } = fixture();
	db.prepare("update sessions set reports_to = null where id = 'person'").run();
	clock.mockReturnValue(HOUR);
	runtime.applyFacts("person", 1, { cost: 5 });
	expect(realizedFitness(db, "person", 0, 3 * HOUR).compute).toBe(5);
	depart(null);
	const history = membership(db, "person");
	expect(history.managerAt("person", HOUR)).toBeNull();
	expect(history.memberAt("person", HOUR)).toBe(true);
	expect(history.memberAt("person", 5 * HOUR)).toBe(false);
	expect(realizedFitness(db, "person", 0, 3 * HOUR).compute).toBe(5);
	expect(departureOf(db, "person")?.reportsTo).toBeNull();
	expect(nameOf(db, "person")).toBe("Pat Worker");
});

test("a departed person's snapshot does not rewrite reporting before a recorded transfer", () => {
	const { db, runtime, clock, depart } = fixture();
	clock.mockReturnValue(HOUR);
	runtime.applyFacts("person", 1, { cost: 2 });
	clock.mockReturnValue(2 * HOUR);
	expect(runtime.transfer("person", { kind: "transfer", manager: "branch", by: "root" })).toBeUndefined();
	clock.mockReturnValue(3 * HOUR);
	runtime.applyFacts("person", 1, { cost: 5 });
	const before = realizedFitness(db, "root", 0, 4 * HOUR).compute;
	depart("branch");
	const history = membership(db, "branch");
	expect(realizedFitness(db, "root", 0, 4 * HOUR).compute).toBe(before);
	expect(before).toBe(5);
	expect(history.managerAt("person", HOUR)).toBe("root");
	expect(history.managerAt("person", 3 * HOUR)).toBe("branch");
	expect(history.memberAt("person", HOUR)).toBe(false);
	expect(history.memberAt("person", 3 * HOUR)).toBe(true);
});

test("shared mail retains its author and body after live identity removal", () => {
	const { db, depart } = fixture();
	expect(
		postToThread(
			db,
			"person",
			"message",
			{
				thread: "thread",
				threadKind: "mail",
				subject: "Result",
				to: ["root"],
				body: "Verified the build.",
			},
			HOUR,
		),
	).not.toBeTypeOf("string");
	depart("root");
	expect(messagesOf(db, "thread")).toEqual([
		expect.objectContaining({ from: "person", fromName: "Pat Worker", body: "Verified the build." }),
	]);
});

test("legacy retirement and rehire history does not establish a permanent departure", () => {
	const { db } = fixture();
	for (const [at, type] of [
		[HOUR, "retired"],
		[2 * HOUR, "rehired"],
	])
		db.prepare("insert into events (at, source, session_id, type, data) values (?, 'fixture', 'person', ?, '{}')").run(
			at!,
			type!,
		);
	expect(departureOf(db, "person")).toBeUndefined();
	expect(membership(db, "root").memberAt("person", 3 * HOUR)).toBe(true);
});

function diskFixture(departure: Departure) {
	const directory = mkdtempSync(join(tmpdir(), "apple-pi-departure-files-"));
	directories.push(directory);
	const state = join(directory, "state");
	const usage = join(directory, "sidecar-usage", "person.ndjson");
	mkdirSync(join(state, "handoffs"), { recursive: true });
	mkdirSync(join(directory, "sidecar-usage"));
	const files = {
		...departure,
		sessionFile: join(directory, "person.jsonl"),
		handoffFile: join(state, "handoffs", "person.md"),
	};
	writeFileSync(files.handoffFile, "Retained handoff.");
	writeFileSync(usage, "Private sidecar usage.");
	writeFileSync(`${usage}.1`, "Private rotated usage.");
	return { state, usage, files };
}

test("file cleanup checks transcript identity, removes owned usage including rotation, and keeps the handoff", async () => {
	const { depart } = fixture();
	const { state, usage, files } = diskFixture(depart("root"));
	writeFileSync(files.sessionFile, `${JSON.stringify({ type: "session", id: "person" })}\nUnparsed session content.\n`);
	await removeDepartureFiles(state, "person", files, () => {});
	expect(existsSync(files.sessionFile)).toBe(false);
	expect(existsSync(usage)).toBe(false);
	expect(existsSync(`${usage}.1`)).toBe(false);
	expect(existsSync(files.handoffFile)).toBe(true);
	await expect(removeDepartureFiles(state, "person", files, () => {})).resolves.toBeUndefined();
});

test("a mismatched transcript header prevents deletion of any of that attempt's files", async () => {
	const { depart } = fixture();
	const { state, usage, files } = diskFixture(depart("root"));
	writeFileSync(files.sessionFile, `${JSON.stringify({ type: "session", id: "another-person" })}\n`);
	await expect(removeDepartureFiles(state, "person", files, () => {})).rejects.toThrow("session header");
	expect(existsSync(files.sessionFile)).toBe(true);
	expect(existsSync(usage)).toBe(true);
	expect(existsSync(files.handoffFile)).toBe(true);
});
