import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { lineReader } from "../src/protocol.js";
import { migrate } from "../src/schema.js";
import { fakeBridge, query, sendCommand, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(async () => {
	// A stopped runtime's database at the two crash boundaries: accepted before the post transaction, or committed
	// with its outgoing mail before the caller's applied receipt. Only fixture setup writes the database here.
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	for (const id of ["sender", "recipient"])
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values (?, 'root', '/tmp', 'idle', 1, 'fixture', 0)",
		).run(id);
	for (const suffix of ["new", "done"]) {
		const command = {
			kind: "thread_post",
			thread: `t-${suffix}`,
			threadKind: "meeting",
			subject: "Meeting",
			to: ["recipient"],
			body: `Agenda ${suffix}`,
		};
		db.prepare(
			"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values (?, 'sender', 'thread_post', ?, 'accepted', 1, 1)",
		).run(`command-${suffix}`, JSON.stringify(command));
	}
	db.exec(
		"insert into threads (id, kind, subject, created_by, created_at) values ('t-done', 'meeting', 'Meeting', 'sender', 1)",
	);
	for (const id of ["sender", "recipient"])
		db.prepare(
			"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values ('t-done', ?, 'push', 0, 1)",
		).run(id);
	db.exec(
		"insert into thread_messages (id, thread_id, sender, body, at) values ('command-done', 't-done', 'sender', 'Agenda done', 1)",
	);
	db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values ('command-done:recipient', 'recipient', 'mail', ?, 'accepted', 1, 1)",
	).run(
		JSON.stringify({
			kind: "mail",
			from: "sender",
			thread: "t-done",
			body: "Agenda done",
			seq: 1,
			sentAt: new Date(1).toISOString(),
		}),
	);
	db.exec(
		"create trigger reject_summary before insert on commands when new.command_id = 'close-fails:recipient' begin select raise(abort, 'outbox unavailable'); end",
	);
	db.close();
	await startRuntime(state.socketPath);
});
afterAll(() => stopRuntime(state));

test("startup completes accepted posts, never duplicates committed messages, and replays their full outbox", async () => {
	expect(query(state.dbPath, "select stage from commands where kind = 'thread_post'")).toEqual([
		{ stage: "applied" },
		{ stage: "applied" },
	]);
	expect(query(state.dbPath, "select id from thread_messages order by id")).toEqual([
		{ id: "command-done" },
		{ id: "command-new" },
	]);
	const retry = await sendCommand(
		state.socketPath,
		"sender",
		{ kind: "thread_post", thread: "t-done", body: "Ignored duplicate" },
		{ commandId: "command-done" },
	);
	expect(retry.at(-1)?.stage).toBe("applied");
	const stand = standInProcess();
	const reader = await fakeBridge(state.socketPath, "recipient", stand.pid, stand.startedAt);
	const bodies: string[] = [];
	reader.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line);
			if (message.command?.kind === "mail") bodies.push(message.command.body);
		}),
	);
	try {
		await vi.waitFor(() => expect(bodies.sort()).toEqual(["Agenda done", "Agenda new"]));
	} finally {
		reader.socket.destroy();
		stand.child.kill();
	}
});

test("a failed outgoing delivery rolls back both the meeting summary and closing it", async () => {
	const failed = await sendCommand(
		state.socketPath,
		"sender",
		{ kind: "thread_post", thread: "t-new", body: "Our decision.", closeMeeting: true },
		{ commandId: "close-fails" },
	);
	expect(failed.at(-1)).toMatchObject({ stage: "failed", reason: "outbox unavailable" });
	expect(query(state.dbPath, "select closed_at from threads where id = 't-new'")).toEqual([{ closed_at: null }]);
	expect(query(state.dbPath, "select body from thread_messages where thread_id = 't-new'")).toEqual([
		{ body: "Agenda new" },
	]);
});
