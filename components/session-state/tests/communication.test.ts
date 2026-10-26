import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { syncChannels } from "../src/channels.js";
import { communicationIn } from "../src/inspect.js";
import { migrate } from "../src/schema.js";
import { postToThread } from "../src/threads.js";

const HOUR = 3_600_000;

function fixture() {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["lead", "root"],
		["a", "root"],
		["b", "lead"],
	] as const)
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
		).run(id, manager);
	return db;
}

test("ordinary channel departures preserve past audiences without preserving access", () => {
	const db = fixture();
	db.prepare("update sessions set reports_to = 'root' where id = 'b'").run();
	syncChannels(db, 0);
	postToThread(db, "a", "old-post", { thread: "team:root", threadKind: "channel", body: "hello" }, HOUR);
	const before = communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR });
	expect(before.pairs).toContainEqual({ people: ["person:a", "person:b"], messages: 1 });
	db.prepare("update sessions set reports_to = 'lead' where id = 'b'").run();
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (?, 'runtime', 'b', 'transferred', ?)",
	).run(3 * HOUR, JSON.stringify({ from: "root", to: "lead" }));
	syncChannels(db, 3 * HOUR);
	expect(
		postToThread(
			db,
			"b",
			"refused",
			{ thread: "team:root", threadKind: "channel", body: "No longer on this team" },
			4 * HOUR,
		),
	).toBe("you are not in this thread");
	expect(communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR })).toEqual(before);
	db.close();
});

test("later participant additions and organizational joins do not import earlier communication", () => {
	const db = fixture();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('foreign', 'root', '/', 'idle', 1, 'test', 0)",
	).run();
	postToThread(db, "a", "internal", { thread: "old", subject: "Internal", body: "private", to: ["root"] }, HOUR);
	postToThread(db, "a", "invite", { thread: "old", body: "join", to: ["b"] }, 3 * HOUR);
	postToThread(
		db,
		"foreign",
		"foreign-msg",
		{ thread: "external", subject: "Outside", body: "outside", to: ["a"] },
		HOUR,
	);
	const before = communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR });
	expect(before.pairs).toEqual([{ people: ["person:a", "person:root"], messages: 1 }]);
	db.prepare("update sessions set reports_to = 'root' where id = 'foreign'").run();
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (?, 'runtime', 'foreign', 'reports_to_changed', ?)",
	).run(4 * HOUR, JSON.stringify({ from: null, to: "root" }));
	expect(communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR })).toEqual(before);
	db.close();
});

test("communication shows scoped open decisions and explicit escalations awaiting a reply", () => {
	const db = fixture();
	for (const id of ["d1", "d2"])
		db.prepare(
			"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values (?, 'person', 'a', 'person', 'root', 'requires_decision', 'a', 0, 0)",
		).run(id);
	postToThread(
		db,
		"a",
		"request",
		{ thread: "escalated", threadKind: "escalation", subject: "Escalation", body: "Decide", to: ["root"] },
		HOUR,
	);
	postToThread(
		db,
		"a",
		"ordinary",
		{ thread: "ordinary", subject: "Escalation", body: "Not marked", to: ["root"] },
		HOUR,
	);
	const result = communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR }, { person: "root" });
	expect(result.requests).toEqual([
		{ person: "person:root", decisions: ["link:d1", "link:d2"], escalations: ["thread:escalated"] },
	]);
	expect(communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR }, { subtree: "lead" }).requests).toEqual([]);
	db.prepare("insert into events (at, source, session_id, type, data) values (?, 'runtime', 'a', 'retired', '{}')").run(
		2.5 * HOUR,
	);
	expect(
		communicationIn(db, "root", { cwd: "/", from: 0, to: 2.75 * HOUR }, { person: "root" }).requests[0].escalations,
	).toEqual(["thread:escalated"]);
	postToThread(db, "root", "answer", { thread: "escalated", body: "Decided" }, 3 * HOUR);
	expect(
		communicationIn(db, "root", { cwd: "/", from: 0, to: 4 * HOUR }, { person: "root" }).requests[0].escalations,
	).toEqual([]);
	expect(
		communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR }, { person: "root" }).requests[0].escalations,
	).toEqual(["thread:escalated"]);
	db.close();
});

test("a group message contributes one pair per other participant but one thread message", () => {
	const db = fixture();
	postToThread(db, "a", "group-message", { thread: "group", subject: "Group", body: "hello", to: ["b", "lead"] }, HOUR);
	const result = communicationIn(db, "root", { cwd: "/", from: 0, to: 2 * HOUR });
	expect(result.pairs).toEqual([
		{ people: ["person:a", "person:b"], messages: 1 },
		{ people: ["person:a", "person:lead"], messages: 1 },
	]);
	expect(result.threads).toEqual([{ ref: "thread:group", messages: 1 }]);
	db.close();
});

test("communication counts participant pairs, teams and thread activity only within the window", () => {
	const db = fixture();
	postToThread(db, "a", "m1", { thread: "one", subject: "One", body: "hello", to: ["b"] }, HOUR);
	postToThread(db, "b", "m2", { thread: "one", body: "reply" }, 2 * HOUR);
	postToThread(
		db,
		"a",
		"m3",
		{ thread: "two", subject: "Two", body: "hello", to: ["b"], threadKind: "meeting" },
		3 * HOUR,
	);
	postToThread(db, "b", "outside", { thread: "two", body: "later" }, 4 * HOUR);
	const result = communicationIn(db, "root", { cwd: "/", from: 0, to: 4 * HOUR });
	expect(result.pairs).toEqual([{ people: ["person:a", "person:b"], messages: 3 }]);
	expect(result.teams).toEqual([{ managers: ["person:lead", "person:root"], messages: 3 }]);
	expect(result.threads).toEqual([
		{ ref: "thread:one", messages: 2 },
		{ ref: "thread:two", messages: 1 },
	]);
	expect(communicationIn(db, "root", { cwd: "/", from: 0, to: 4 * HOUR }, { person: "lead" }).pairs).toEqual([]);
	expect(communicationIn(db, "root", { cwd: "/", from: 0, to: 4 * HOUR }, { subtree: "lead" }).pairs).toEqual(
		result.pairs,
	);
	db.close();
});
