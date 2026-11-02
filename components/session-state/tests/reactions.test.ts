import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { entryReaction, react, reactionsOf } from "../src/reactions.js";
import { migrate } from "../src/schema.js";
import { OPERATOR } from "../src/threads.js";

function conversation() {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('t', 'task', 'Work', 'ada', 1)",
	).run();
	db.prepare(
		"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values ('t', 'ada', 'push', 0, 1)",
	).run();
	db.prepare(
		"insert into thread_messages (id, thread_id, sender, body, at) values ('m1', 't', 'ada', 'Shipped.', 2)",
	).run();
	return db;
}

test("reactions record who chose each emoji, toggle off, and need a part in the conversation", () => {
	const db = conversation();
	try {
		react(db, OPERATOR, OPERATOR, { message: "m1", emoji: "\u2705", on: true }, 3);
		react(db, "ada", OPERATOR, { message: "m1", emoji: "\u2705", on: true }, 4);
		react(db, "ada", OPERATOR, { message: "m1", emoji: "\u{1F440}", on: true }, 5);
		react(db, OPERATOR, OPERATOR, { message: "m1", emoji: "\u2705", on: true }, 6);
		expect(reactionsOf(db, "m1")).toEqual([
			{ emoji: "\u2705", people: [OPERATOR, "ada"] },
			{ emoji: "\u{1F440}", people: ["ada"] },
		]);
		react(db, OPERATOR, OPERATOR, { message: "m1", emoji: "\u2705", on: false }, 7);
		expect(reactionsOf(db, "m1")[0]).toEqual({ emoji: "\u2705", people: ["ada"] });
		expect(() => react(db, "ben", OPERATOR, { message: "m1", emoji: "\u2705", on: true }, 8)).toThrow(
			"not in that conversation",
		);
		expect(() => react(db, OPERATOR, OPERATOR, { message: "missing", emoji: "\u2705", on: true }, 8)).toThrow(
			"No message",
		);
		expect(() => react(db, OPERATOR, OPERATOR, { message: "m1", emoji: "two words", on: true }, 8)).toThrow(
			"one emoji",
		);
	} finally {
		db.close();
	}
});

test("in a direct conversation only the operator reacts, on an entry its transcript indexed", () => {
	const db = conversation();
	try {
		db.prepare(
			"insert into messages (session_id, entry_id, part, at, role, size, preview, source) values ('ada', 'e1', '', 2, 'assistant', 5, 'Done.', 'test')",
		).run();
		react(db, OPERATOR, OPERATOR, { message: entryReaction("ada", "e1"), emoji: "\u{1F44D}", on: true }, 3);
		expect(reactionsOf(db, entryReaction("ada", "e1"))).toEqual([{ emoji: "\u{1F44D}", people: [OPERATOR] }]);
		expect(() =>
			react(db, "ada", OPERATOR, { message: entryReaction("ada", "e1"), emoji: "\u{1F44D}", on: true }, 4),
		).toThrow("Only the operator");
		expect(() =>
			react(db, OPERATOR, OPERATOR, { message: entryReaction("ada", "e9"), emoji: "\u{1F44D}", on: true }, 4),
		).toThrow("No message");
	} finally {
		db.close();
	}
});

test("a database before the reactions table has none", () => {
	const db = new DatabaseSync(":memory:");
	try {
		expect(reactionsOf(db, "m1")).toEqual([]);
	} finally {
		db.close();
	}
});
