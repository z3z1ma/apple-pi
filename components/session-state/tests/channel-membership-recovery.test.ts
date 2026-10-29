import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../src/schema.js";
import { query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();

beforeAll(async () => {
	// A stopped runtime, with accepted membership commands at both crash boundaries. Only this fixture writes the
	// database; the runtime then reconciles channels and replays those commands.
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	for (const id of ["kept", "pending", "left", "both"])
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values (?, 'root', '/tmp', 'idle', 1, 'fixture', 0)",
		).run(id);
	const thread = db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values (?, 'channel', ?, ?, 1)",
	);
	const member = db.prepare(
		"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at, invited) values (?, 'operator', 'pull', ?, 10, 1)",
	);
	const command = db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values (?, 'operator', 'channel_membership', ?, 'accepted', ?, ?)",
	);
	const event = db.prepare(
		"insert into events (at, source, session_id, type, data) values (?, 'runtime', 'operator', ?, ?)",
	);
	thread.run("team:kept", "Kept", "kept");
	member.run("team:kept", 4);
	event.run(10, "thread_joined", JSON.stringify({ thread: "team:kept" }));
	command.run("join-kept", JSON.stringify({ kind: "channel_membership", thread: "team:kept", joined: true }), 20, 20);

	thread.run("team:pending", "Pending", "pending");
	command.run(
		"join-pending",
		JSON.stringify({ kind: "channel_membership", thread: "team:pending", joined: true }),
		30,
		30,
	);

	thread.run("team:left", "Left", "left");
	member.run("team:left", 2);
	event.run(10, "thread_joined", JSON.stringify({ thread: "team:left" }));
	command.run(
		"leave-pending",
		JSON.stringify({ kind: "channel_membership", thread: "team:left", joined: false }),
		40,
		40,
	);

	thread.run("team:gone", "Gone", "kept");
	event.run(10, "thread_joined", JSON.stringify({ thread: "team:gone" }));
	event.run(15, "thread_left", JSON.stringify({ thread: "team:gone" }));
	command.run("leave-done", JSON.stringify({ kind: "channel_membership", thread: "team:gone", joined: false }), 50, 50);

	thread.run("team:both", "Both", "both");
	command.run("join-both", JSON.stringify({ kind: "channel_membership", thread: "team:both", joined: true }), 70, 70);
	command.run("leave-both", JSON.stringify({ kind: "channel_membership", thread: "team:both", joined: false }), 80, 80);

	command.run("join-mail", JSON.stringify({ kind: "channel_membership", thread: "t-mail", joined: true }), 60, 60);
	db.exec(
		"insert into threads (id, kind, subject, created_by, created_at) values ('t-mail', 'mail', 'Mail', 'kept', 1)",
	);
	db.close();
	await startRuntime(state.socketPath);
});
afterAll(() => stopRuntime(state));

const row = (thread: string) =>
	query<{ delivery: string; read_up_to: number; invited: number }>(
		state.dbPath,
		"select delivery, read_up_to, invited from thread_participants where thread_id = ? and participant = 'operator'",
		thread,
	);
const events = (thread: string, type: string) =>
	query<{ at: number }>(
		state.dbPath,
		"select at from events where session_id = 'operator' and type = ? and json_extract(data, '$.thread') = ? order by seq",
		type,
		thread,
	);

test("startup finishes accepted membership without resetting a committed cursor or repeating a committed leave", () => {
	expect(
		query(
			state.dbPath,
			"select command_id, stage, reason from commands where kind = 'channel_membership' order by created_at",
		),
	).toEqual([
		{ command_id: "join-kept", stage: "applied", reason: null },
		{ command_id: "join-pending", stage: "applied", reason: null },
		{ command_id: "leave-pending", stage: "applied", reason: null },
		{ command_id: "leave-done", stage: "applied", reason: null },
		{ command_id: "join-mail", stage: "failed", reason: "no team channel with that id" },
		{ command_id: "join-both", stage: "applied", reason: null },
		{ command_id: "leave-both", stage: "applied", reason: null },
	]);
	expect(row("team:kept")).toEqual([{ delivery: "pull", read_up_to: 4, invited: 1 }]);
	expect(events("team:kept", "thread_joined")).toEqual([{ at: 10 }]);
	expect(events("team:kept", "thread_left")).toEqual([]);
	expect(row("team:pending")).toEqual([{ delivery: "pull", read_up_to: 0, invited: 1 }]);
	expect(events("team:pending", "thread_joined")).toEqual([{ at: 30 }]);
	expect(row("team:left")).toEqual([]);
	expect(events("team:left", "thread_left")).toEqual([{ at: 40 }]);
	expect(row("team:gone")).toEqual([]);
	expect(events("team:gone", "thread_left")).toEqual([{ at: 15 }]);
	expect(row("t-mail")).toEqual([]);
	expect(row("team:both")).toEqual([]);
	expect(events("team:both", "thread_joined")).toEqual([{ at: 70 }]);
	expect(events("team:both", "thread_left")).toEqual([{ at: 80 }]);
});
