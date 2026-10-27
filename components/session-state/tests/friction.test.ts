import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import type { Departure } from "../src/departures.js";
import { type FrictionNotice, frictionIn } from "../src/friction.js";
import { recordLink, resolveLink } from "../src/links.js";
import { migrate } from "../src/schema.js";
import { participateIn, postToThread } from "../src/threads.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

function fixture() {
	const db = new DatabaseSync(":memory:");
	databases.push(db);
	migrate(db);
	for (const [id, manager, role, manages] of [
		["root", null, null, 0],
		["manager", "root", "coordinator", 1],
		["other-manager", "root", "coordinator", 1],
		["a", "manager", "implementation-engineer", 0],
		["b", "manager", "implementation-engineer", 0],
		["c", "manager", "implementation-engineer", 0],
		["d", "other-manager", "implementation-engineer", 0],
		["stranger", null, null, 0],
	] as const)
		db.prepare(`insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to, role, manages)
		values (?, 'root', '/not-read', 'idle', 1, 'bridge', 0, ?, ?, ?)`).run(id, manager, role, manages);
	for (const person of ["a", "b", "c", "d"]) {
		db.prepare(`insert into work_tasks (id, bundle, project, organization, ephemeral, thread)
			values (?, ?, '/not-read', 'root', 0, ?)`).run(person, `/not-read/${person}`, `task:${person}`);
		db.prepare("insert into assignments (person, task_id, assigned_by, assigned_at) values (?, ?, 'root', 0)").run(
			person,
			person,
		);
	}
	let sequence = 0;
	const wait = (from: string, to: string, relation = "blocks") => {
		const id = `wait-${++sequence}`;
		const entity = (ref: string) => {
			const colon = ref.indexOf(":");
			return { kind: ref.slice(0, colon), id: ref.slice(colon + 1) };
		};
		recordLink(db, id, "root", { from: entity(from), to: entity(to), relation }, 10);
		return id;
	};
	let message = 0;
	const post = (sender: string) => {
		const result = postToThread(
			db,
			sender,
			`message-${++message}`,
			{
				thread: "task:a",
				threadKind: "task",
				subject: "Task A",
				to: ["a", "b", "manager", "root"],
				body: "Private message body must not appear in a notice.",
			},
			11 + message,
		);
		if (typeof result === "string") throw new Error(result);
	};
	return { db, wait, post };
}

test("ordinary converging requests and message volume alone produce no friction notice", () => {
	const { db, wait, post } = fixture();
	wait("task:a", "task:c");
	wait("task:b", "task:c");
	for (let i = 0; i < 20; i++) post(i % 2 ? "manager" : "a");
	expect(frictionIn(db).raised).toEqual([]);
});

test("one explicit wait cycle is routed to its team's manager with a usable evidence reference", () => {
	const { db, wait } = fixture();
	const first = wait("task:a", "task:b");
	const second = wait("task:b", "task:a");
	const notices = frictionIn(db).raised;
	expect(notices).toHaveLength(1);
	expect(notices[0]).toMatchObject({
		kind: "wait_cycle",
		organization: "root",
		recipient: "manager",
	});
	expect([`link:${first}`, `link:${second}`]).toContain(notices[0].anchor);
	expect(notices[0].body).toContain(notices[0].anchor);
	expect(notices[0].body).toContain("2 references");
	expect(notices[0].body).toContain("not proof");
});

test("cross-team dependencies reach the common manager and current reporting changes routing", () => {
	const { db, wait } = fixture();
	wait("task:a", "task:d");
	wait("task:d", "task:a");
	const original = frictionIn(db).raised;
	expect(original).toHaveLength(1);
	expect(original[0].recipient).toBe("root");
	db.prepare("update sessions set reports_to = 'other-manager' where id = 'a'").run();
	const moved = frictionIn(db).raised;
	expect(moved).toHaveLength(1);
	expect(moved[0].recipient).toBe("other-manager");
	expect(moved[0].key).not.toBe(original[0].key);
});

test("converging work is observed only when its shared dependency itself has an explicit open wait", () => {
	const { db, wait } = fixture();
	wait("task:a", "task:c");
	wait("task:b", "task:c");
	expect(frictionIn(db).raised).toEqual([]);
	wait("task:c", "file:required-result");
	const notices = frictionIn(db).raised;
	expect(notices).toHaveLength(1);
	expect(notices[0]).toMatchObject({ kind: "blocked_fan_in", recipient: "manager" });
	expect(notices[0].body).toContain("2 waiting references involving 2 people");
});

test("multiple waiting tasks held by one person are not counted as several waiting people", () => {
	const { db, wait } = fixture();
	db.prepare("update assignments set person = 'a' where task_id = 'b'").run();
	wait("task:a", "task:c");
	wait("task:b", "task:c");
	wait("task:c", "file:required-result");
	expect(frictionIn(db).raised).toEqual([]);
});

test("a discussion notice needs a retained decision wait, dependent waits, and returning authors", () => {
	const { db, wait, post } = fixture();
	const decision = wait("task:a", "person:manager", "requires_decision");
	post("a");
	post("manager");
	post("a");
	post("manager");
	expect(frictionIn(db).raised).toEqual([]);
	wait("task:b", "task:a");
	const notices = frictionIn(db).raised;
	expect(notices).toHaveLength(1);
	expect(notices[0]).toMatchObject({ kind: "discussion_wait", recipient: "manager", anchor: `link:${decision}` });
	expect(notices[0].body).toContain("potential audience, not delivery or reads");
	expect(notices[0].body).not.toContain("Private message body");
	post("a");
	expect(frictionIn(db).raised[0].key).toBe(notices[0].key);
	resolveLink(db, "root", decision, "answered", 30);
	expect(frictionIn(db).raised).toEqual([]);
});

test("one return is not repeated exchange, and passive cross-team recipients do not change its manager", () => {
	const { db, wait, post } = fixture();
	wait("task:a", "person:manager", "requires_decision");
	wait("task:b", "task:a");
	post("a");
	post("manager");
	post("a");
	expect(frictionIn(db).raised).toEqual([]);
	participateIn(db, "task:a", "d", 14, "pull");
	post("manager");
	const notices = frictionIn(db).raised;
	expect(notices).toHaveLength(1);
	expect(notices[0].recipient).toBe("manager");
});

test("different organizations receive only their own dependency observations", () => {
	const { db, wait } = fixture();
	wait("task:a", "task:b");
	wait("task:b", "task:a");
	recordLink(
		db,
		"stranger-self",
		"stranger",
		{
			from: { kind: "person", id: "stranger" },
			to: { kind: "person", id: "stranger" },
			relation: "blocks",
		},
		10,
	);
	const notices = frictionIn(db).raised;
	expect(notices).toHaveLength(2);
	expect(notices.find((notice) => notice.organization === "root")?.recipient).toBe("manager");
	expect(notices.find((notice) => notice.organization === "stranger")?.recipient).toBe("stranger");
	expect(notices.find((notice) => notice.organization === "root")?.body).not.toContain("stranger-self");
});

test("retained task waits survive an organization join and removal of its former root anchor", () => {
	const { db, wait } = fixture();
	wait("task:a", "task:b");
	wait("task:b", "task:a");
	db.prepare("update sessions set reports_to = 'stranger' where id in ('root', 'manager', 'other-manager')").run();
	const departure: Departure = {
		commandId: "depart-old-root",
		reason: "Joined the other organization and handed off its reports.",
		name: "Former root",
		role: null,
		title: null,
		reportsTo: "stranger",
		handoffFile: "/not-read/handoff.md",
		sessionFile: null,
	};
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (20, 'runtime', 'root', 'person_departed', ?)",
	).run(JSON.stringify(departure));
	db.prepare("delete from sessions where id = 'root'").run();
	const notices = frictionIn(db).raised;
	expect(notices).toHaveLength(1);
	expect(notices[0]).toMatchObject({ organization: "stranger", recipient: "manager", kind: "wait_cycle" });
});

test("cross-team observations fall back to the operator when no common eligible manager exists", () => {
	const { db, wait } = fixture();
	db.prepare("update sessions set role = 'implementation-engineer', manages = 0 where id = 'root'").run();
	wait("task:a", "task:d");
	wait("task:d", "task:a");
	expect(frictionIn(db).raised).toHaveLength(1);
	expect(frictionIn(db).raised[0].recipient).toBe("operator");
});

test("publication planning suppresses committed notices and rearms only after a recorded clear", () => {
	const { db, wait } = fixture();
	wait("task:a", "task:b");
	const back = wait("task:b", "task:a");
	const first = frictionIn(db);
	expect(first.raised).toHaveLength(1);
	expect(first.cleared).toEqual([]);
	expect(frictionIn(db)).toEqual(first);
	const record = (type: string, notice: Pick<FrictionNotice, "key" | "organization">) =>
		db
			.prepare("insert into events (at, source, session_id, type, data) values (20, 'runtime', ?, ?, ?)")
			.run(notice.organization, type, JSON.stringify({ key: notice.key, organization: notice.organization }));
	record("friction_raised", first.raised[0]);
	expect(frictionIn(db)).toEqual({ raised: [], cleared: [] });
	resolveLink(db, "root", back, "answered", 30);
	const cleared = frictionIn(db);
	expect(cleared).toEqual({ raised: [], cleared: [{ key: first.raised[0].key, organization: "root" }] });
	expect(frictionIn(db)).toEqual(cleared);
	record("friction_cleared", cleared.cleared[0]);
	expect(frictionIn(db)).toEqual({ raised: [], cleared: [] });
	wait("task:b", "task:a");
	expect(frictionIn(db).raised).toHaveLength(1);
	expect(frictionIn(db).raised[0].key).toBe(first.raised[0].key);
});

test("a responsibility move clears the previous recipient's condition and plans the new recipient", () => {
	const { db, wait } = fixture();
	wait("task:a", "task:b");
	wait("task:b", "task:a");
	const original = frictionIn(db).raised[0];
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (20, 'runtime', 'root', 'friction_raised', ?)",
	).run(JSON.stringify({ key: original.key, organization: original.organization }));
	db.prepare("update sessions set reports_to = 'other-manager' where id = 'b'").run();
	const moved = frictionIn(db);
	expect(moved.raised).toHaveLength(1);
	expect(moved.raised[0].recipient).toBe("root");
	expect(moved.cleared).toEqual([{ key: original.key, organization: "root" }]);
});
