import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { syncChannels } from "../src/channels.js";
import { lineReader } from "../src/protocol.js";
import { migrate } from "../src/schema.js";
import {
	fakeBridge,
	query,
	replyToTurns,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "./helpers.js";

const state = tempStateDir();
let stand: ReturnType<typeof standInProcess>;
beforeAll(async () => {
	stand = standInProcess();
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	for (const id of ["manager", "done", "interrupted", "rollback", "reopened"]) {
		db.prepare(`insert into sessions (id, kind, cwd, run_state, generation, reports_to, retired_at, source, updated_at)
			values (?, 'root', '/tmp', 'idle', 1, ?, ?, 'fixture', 0)`).run(
			id,
			id === "manager" ? null : "manager",
			["done", "reopened"].includes(id) ? 1 : null,
		);
	}
	syncChannels(db, 1);
	for (const id of ["done", "interrupted"])
		db.prepare(
			"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values (?, ?, 'retire', ?, 'accepted', 1, 1)",
		).run(id, id, JSON.stringify({ kind: "retire", reason: "Assignment ended." }));
	db.exec(
		"insert into thread_messages (id, thread_id, sender, body, at) values ('done:handover', 'team:manager', 'done', 'The evidence is in docs/result.md.', 1)",
	);
	for (const id of ["done", "reopened"]) {
		db.prepare(`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, ended_at, source, updated_at)
			values (?, 1, ?, ?, 'alive_bridge_lost', 1, ?, 'fixture', 1)`).run(
			id,
			stand.pid,
			stand.startedAt,
			id === "reopened" ? 1 : null,
		);
		db.prepare(`insert into commands (command_id, session_id, generation, bound_generation, kind, command, stage, created_at, updated_at)
			values (?, ?, 1, 1, 'close', ?, 'accepted', 2, 2)`).run(`${id}:close`, id, JSON.stringify({ kind: "close" }));
	}
	// Old mail must wait for a later reopening, rather than starting work while a committed retirement closes.
	db.prepare(`insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at)
		values ('old-mail', 'done', 'mail', ?, 'accepted', 0, 0)`).run(
		JSON.stringify({ kind: "mail", from: "manager", body: "Old queued work", sentAt: new Date(0).toISOString() }),
	);
	db.exec(
		"create trigger refuse_retirement_close before insert on commands when new.command_id = 'broken:close' begin select raise(abort, 'outbox unavailable'); end",
	);
	db.close();
	await startRuntime(state.socketPath);
});
afterAll(async () => {
	stand?.child.kill();
	await stopRuntime(state);
});

test("startup keeps a committed handover once and fails an interrupted request without restarting the model", async () => {
	expect(
		query(state.dbPath, "select command_id, stage from commands where kind = 'retire' order by command_id"),
	).toEqual([
		{ command_id: "done", stage: "applied" },
		{ command_id: "interrupted", stage: "failed" },
	]);
	expect(query(state.dbPath, "select 1 from commands where kind in ('run_turn', 'start')")).toEqual([]);
	const repeated = await sendCommand(
		state.socketPath,
		"done",
		{ kind: "retire", reason: "Ignored duplicate" },
		{ commandId: "done" },
	);
	expect(repeated.at(-1)?.stage).toBe("applied");
	expect(query(state.dbPath, "select body from thread_messages")).toEqual([
		{ body: "The evidence is in docs/result.md." },
	]);
});

test("a committed retirement closes the same incarnation on reconnect before any queued work is replayed", async () => {
	const link = await fakeBridge(state.socketPath, "done", stand.pid, stand.startedAt);
	const received: string[] = [];
	link.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line);
			if (message.type === "command") received.push(message.command.kind);
		}),
	);
	try {
		await vi.waitFor(() => expect(received).toContain("close"));
		expect(received).toEqual(["close"]);
		expect(query(state.dbPath, "select stage from commands where command_id = 'old-mail'")).toEqual([
			{ stage: "accepted" },
		]);
	} finally {
		link.send({ type: "shutdown", reason: "quit" });
		link.socket.end();
	}
});

test("a previous incarnation's pending close never closes a later reopening", async () => {
	const link = await fakeBridge(state.socketPath, "reopened", stand.pid, stand.startedAt);
	const received: string[] = [];
	link.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line);
			if (message.type === "command") {
				received.push(message.command.kind);
				if (message.command.kind === "steer")
					link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
			}
		}),
	);
	try {
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select generation from sessions where id = 'reopened'")).toEqual([{ generation: 2 }]),
		);
		// A delivered barrier shows this bridge has processed everything from its hello.
		expect((await sendCommand(state.socketPath, "reopened", { kind: "steer", text: "Barrier" })).at(-1)?.stage).toBe(
			"applied",
		);
		await vi.waitFor(() => expect(received).toContain("steer"));
		expect(received).toEqual(["steer"]);
	} finally {
		link.send({ type: "shutdown", reason: "quit" });
		link.socket.end();
	}
});

test("a failed close outbox rolls back the handover, retirement, and team membership change", async () => {
	const link = await fakeBridge(state.socketPath, "rollback", stand.pid, stand.startedAt, {
		facts: { reportsTo: "manager" },
	});
	replyToTurns(link, "Verified the work; pointers are in docs/result.md.");
	try {
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select 1 from incarnations where session_id = 'rollback'")).toHaveLength(1),
		);
		const receipts = await sendCommand(
			state.socketPath,
			"rollback",
			{ kind: "retire", reason: "Done" },
			{ commandId: "broken" },
		);
		expect(receipts.at(-1)).toMatchObject({ stage: "failed", reason: "outbox unavailable" });
		expect(query(state.dbPath, "select retired_at from sessions where id = 'rollback'")).toEqual([
			{ retired_at: null },
		]);
		expect(query(state.dbPath, "select 1 from thread_messages where sender = 'rollback'")).toEqual([]);
		expect(
			query(
				state.dbPath,
				"select 1 from thread_participants where participant = 'rollback' and thread_id = 'team:manager'",
			),
		).toHaveLength(1);
	} finally {
		link.send({ type: "shutdown", reason: "quit" });
		link.socket.end();
	}
});
