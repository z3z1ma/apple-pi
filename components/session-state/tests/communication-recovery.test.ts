import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { communicationAttempt } from "../src/communication.js";
import { applyCommunication, type PublishCommunication } from "../src/communication-actions.js";
import type { CommunicationCommand } from "../src/communication-types.js";
import { lineReader } from "../src/protocol.js";
import { migrate } from "../src/schema.js";
import { nameOf, participateIn, postToThread } from "../src/threads.js";
import { fakeBridge, query, sendCommand, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const command = (suffix: string): CommunicationCommand => ({
	kind: "communication",
	version: 1,
	input: { tool: "send_mail", arguments: { to: ["Reader"], subject: suffix, body: `Evidence ${suffix}` } },
	operation: {
		action: "post",
		thread: `recovery-${suffix}`,
		subject: suffix,
		to: ["recipient"],
		body: `Evidence ${suffix}`,
	},
});

beforeAll(async () => {
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	try {
		migrate(db);
		for (const id of ["sender", "recipient"])
			db.prepare(
				"insert into sessions(id,kind,cwd,name,run_state,generation,source,updated_at) values (?,'root','/tmp',?,'idle',1,'fixture',0)",
			).run(id, id);
		for (const suffix of ["new", "done"])
			db.prepare(
				"insert into commands(command_id,session_id,kind,command,stage,created_at,updated_at) values (?,'sender','communication',?,'accepted',1,1)",
			).run(`recovery-${suffix}`, JSON.stringify(command(suffix)));
		// Simulate the committed effect+outbox boundary before a terminal receipt, not an OS crash.
		const publish: PublishCommunication = (post, _suffix, sender = "sender") => {
			const result = postToThread(db, sender, "recovery-done", post, 1);
			if (typeof result === "string") throw new Error(result);
			const message = {
				thread: post.thread,
				seq: result.seq,
				id: "recovery-done",
				from: sender,
				fromName: nameOf(db, sender),
				body: post.body,
				at: 1,
				reference: { thread: post.thread, seq: result.seq, id: "recovery-done" },
			};
			db.prepare(
				"insert into commands(command_id,session_id,kind,command,stage,created_at,updated_at) values ('recovery-done:recipient','recipient','mail',?,'accepted',1,1)",
			).run(
				JSON.stringify({
					kind: "mail",
					from: sender,
					body: post.body,
					sentAt: new Date(1).toISOString(),
					thread: post.thread,
					seq: result.seq,
					threadKind: "mail",
					reference: message.reference,
				}),
			);
			return { message, audience: ["sender", "recipient"], queued: ["recipient"] };
		};
		const effect = applyCommunication(db, "sender", command("done").operation, 1, "recovery-done", publish);
		db.prepare("update commands set result = ? where command_id = 'recovery-done'").run(JSON.stringify(effect));
		// Revocation stops future access, but cannot revoke this already-addressed notification.
		participateIn(db, "recovery-done", "recipient", 2, null);
		db.exec(
			"create trigger reject_archive before insert on commands when new.command_id = 'archive-broken:recipient' begin select raise(abort, 'outbox unavailable'); end",
		);
	} finally {
		db.close();
	}
	await startRuntime(state.socketPath);
});
afterAll(() => stopRuntime(state));

test("startup recovers canonical accepted operations and retains committed effect/outbox without republishing", async () => {
	expect(query(state.dbPath, "select stage from commands where kind = 'communication' order by command_id")).toEqual([
		{ stage: "applied" },
		{ stage: "applied" },
	]);
	expect(query(state.dbPath, "select body from thread_messages order by body")).toEqual([
		{ body: "Evidence done" },
		{ body: "Evidence new" },
	]);
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(communicationAttempt(db, "sender", "recovery-done", command("done").input)).toMatchObject({
			outcome: "applied",
			effect: { queued: ["recipient"], message: { body: "Evidence done" } },
		});
		expect(() => communicationAttempt(db, "recipient", "recovery-done")).toThrow(/another caller/);
	} finally {
		db.close();
	}
	expect(
		(await sendCommand(state.socketPath, "sender", command("done"), { commandId: "recovery-done" })).at(-1)?.stage,
	).toBe("applied");
	const process = standInProcess();
	const reader = await fakeBridge(state.socketPath, "recipient", process.pid, process.startedAt);
	const bodies: string[] = [];
	reader.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line);
			if (message.command?.kind === "mail") {
				bodies.push(message.command.body);
				reader.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
			}
		}),
	);
	try {
		await vi.waitFor(() => expect(bodies.sort()).toEqual(["Evidence done", "Evidence new"]));
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select stage from commands where kind = 'mail'")).toEqual([
				{ stage: "applied" },
				{ stage: "applied" },
			]),
		);
		expect(
			query(
				state.dbPath,
				"select 1 from thread_participants where thread_id = 'recovery-done' and participant = 'recipient'",
			),
		).toEqual([]);
	} finally {
		reader.socket.destroy();
		process.child.kill();
	}
});

test("publication failure rolls back lifecycle, message and original effect together", async () => {
	const archive: CommunicationCommand = {
		kind: "communication",
		version: 1,
		input: { tool: "archive_thread", arguments: { thread: "recovery-new", summary: "Concluded" } },
		operation: { action: "archive", thread: "recovery-new", body: "Concluded" },
	};
	expect(
		(await sendCommand(state.socketPath, "sender", archive, { commandId: "archive-broken" })).at(-1),
	).toMatchObject({ stage: "failed", reason: "outbox unavailable" });
	expect(query(state.dbPath, "select closed_at from threads where id = 'recovery-new'")).toEqual([{ closed_at: null }]);
	expect(query(state.dbPath, "select body from thread_messages where thread_id = 'recovery-new'")).toEqual([
		{ body: "Evidence new" },
	]);
	expect(query(state.dbPath, "select stage,result from commands where command_id = 'archive-broken'")).toEqual([
		{ stage: "failed", result: null },
	]);
});
