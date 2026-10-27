import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { communicationIn } from "../src/inspect.js";
import { migrate } from "../src/schema.js";
import { audienceAt, isParticipant, participateIn } from "../src/threads.js";

test("participation history survives leave/rejoin and changes access atomically with its event", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	participateIn(db, "t", "a", 1, "pull");
	participateIn(db, "t", "a", 2, "pull");
	participateIn(db, "t", "a", 3, null);
	participateIn(db, "t", "a", 5, "pull");
	expect(audienceAt(db, "t", 2)).toEqual(["a"]);
	expect(audienceAt(db, "t", 4)).toEqual([]);
	expect(audienceAt(db, "t", 6)).toEqual(["a"]);
	db.exec(
		"create trigger fail_history before insert on events when new.type = 'thread_left' begin select raise(abort, 'injected history failure'); end",
	);
	expect(() => participateIn(db, "t", "a", 7, null)).toThrow("injected history failure");
	expect(isParticipant(db, "t", "a")).toBe(true);
	expect(audienceAt(db, "t", 8)).toEqual(["a"]);
	expect(db.isTransaction).toBe(false);
	db.close();
});

test("the participation migration seeds only surviving known joins and marks the coverage boundary", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	db.exec("drop index events_by_type; delete from events; pragma user_version = 27");
	db.prepare(
		"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values ('t', 'a', 'push', 0, 10)",
	).run();
	migrate(db);
	expect(audienceAt(db, "t", 9)).toEqual([]);
	expect(audienceAt(db, "t", 10)).toEqual(["a"]);
	const coverage = communicationIn(db, "root", { cwd: "/", from: 0, to: Date.now() }).audienceHistory;
	expect(coverage.completeSince).toBeTypeOf("number");
	expect(coverage.earlierHistory).toContain("departed participants before tracking cannot be recovered");
	migrate(db);
	expect(audienceAt(db, "t", 10)).toEqual(["a"]);
	expect(communicationIn(db, "root", { cwd: "/", from: 0, to: Date.now() }).audienceHistory).toEqual(coverage);
	db.close();
});
