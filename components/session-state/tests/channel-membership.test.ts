import { existsSync } from "node:fs";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Command } from "../src/protocol.js";
import type { ThreadKind } from "../src/threads.js";
import {
	fakeBridge,
	query,
	runtimePid,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "./helpers.js";

const state = tempStateDir();
const stand = standInProcess();
const other = standInProcess();
const channel = "team:lead";

beforeAll(async () => {
	await startRuntime(state.socketPath);
	await fakeBridge(state.socketPath, "lead", stand.pid, stand.startedAt, {
		session: { name: "Lead" },
		facts: { manages: true },
	});
	await fakeBridge(state.socketPath, "other", other.pid, other.startedAt, {
		session: { name: "Other" },
		facts: { manages: true },
	});
	await vi.waitFor(() => expect(query(state.dbPath, "select id from threads where id = ?", channel)).toHaveLength(1), {
		timeout: 10000,
	});
});
afterAll(async () => {
	stand.child.kill();
	other.child.kill();
	await stopRuntime(state);
});

const sent = async (who: string, command: Command, commandId?: string) => {
	const receipt = (await sendCommand(state.socketPath, who, command, commandId ? { commandId } : {})).at(-1);
	if (!receipt) throw new Error(`no receipt for ${command.kind}`);
	return receipt;
};
const membership = () =>
	query<{ delivery: string; read_up_to: number; invited: number }>(
		state.dbPath,
		"select delivery, read_up_to, invited from thread_participants where thread_id = ? and participant = 'operator'",
		channel,
	);
const audience = (type: string, thread = channel) =>
	query<{ at: number }>(
		state.dbPath,
		"select at from events where session_id = 'operator' and type = ? and json_extract(data, '$.thread') = ? order by seq",
		type,
		thread,
	);
async function restart() {
	const pid = runtimePid(state.pidPath)!;
	process.kill(pid, "SIGTERM");
	await vi.waitFor(() => expect(existsSync(state.socketPath)).toBe(false), { timeout: 10000 });
	await startRuntime(state.socketPath);
}

test("the operator joins and leaves a team channel, and reconciliation keeps that choice", async () => {
	expect((await sent("operator", { kind: "thread_post", thread: channel, body: "Before I join." })).reason).toBe(
		"you are not in this thread",
	);
	await sent("lead", { kind: "thread_post", thread: channel, body: "History before the operator joins." });
	const seq = query<{ seq: number }>(
		state.dbPath,
		"select max(seq) as seq from thread_messages where thread_id = ?",
		channel,
	)[0].seq;

	expect(await sent("operator", { kind: "channel_membership", thread: channel, joined: true }, "join-once")).toEqual({
		stage: "applied",
	});
	expect(membership()).toEqual([{ delivery: "pull", read_up_to: 0, invited: 1 }]);
	expect(audience("thread_joined")).toHaveLength(1);

	await sent("operator", { kind: "thread_read", thread: channel, seq });
	expect(await sent("operator", { kind: "channel_membership", thread: channel, joined: true })).toEqual({
		stage: "applied",
	});
	expect(membership()).toEqual([{ delivery: "pull", read_up_to: seq, invited: 1 }]);
	expect(audience("thread_joined")).toHaveLength(1);

	expect(await sent("operator", { kind: "thread_post", thread: channel, body: "I will watch this channel." })).toEqual({
		stage: "applied",
	});

	const cursor = membership()[0].read_up_to;
	await restart();
	expect(membership()).toEqual([{ delivery: "pull", read_up_to: cursor, invited: 1 }]);
	expect(audience("thread_joined")).toHaveLength(1);
	expect(audience("thread_left")).toEqual([]);

	expect(await sent("operator", { kind: "channel_membership", thread: channel, joined: false }, "leave-once")).toEqual({
		stage: "applied",
	});
	expect(membership()).toEqual([]);
	expect(audience("thread_left")).toHaveLength(1);
	expect(await sent("operator", { kind: "channel_membership", thread: channel, joined: false })).toEqual({
		stage: "applied",
	});
	expect(audience("thread_left")).toHaveLength(1);
	expect((await sent("operator", { kind: "thread_post", thread: channel, body: "After I leave." })).reason).toBe(
		"you are not in this thread",
	);

	await restart();
	expect(membership()).toEqual([]);
	expect(audience("thread_joined")).toHaveLength(1);
	expect(audience("thread_left")).toHaveLength(1);
	expect(await sent("operator", { kind: "channel_membership", thread: channel, joined: true }, "join-once")).toEqual({
		stage: "applied",
	});
	expect(membership()).toEqual([]);
}, 40000);

test("membership is refused for a person and for any thread that is not a team channel", async () => {
	const make = async (thread: string, threadKind: ThreadKind) => {
		expect(
			(
				await sent("lead", {
					kind: "thread_post",
					thread,
					threadKind,
					subject: thread,
					to: ["other"],
					body: "Private.",
				})
			)?.stage,
		).toBe("applied");
	};
	await make("t-mail", "mail");
	await make("t-meeting", "meeting");
	await make("t-task", "task");
	await make("t-escalation", "escalation");
	for (const thread of ["t-mail", "t-meeting", "t-task", "t-escalation", "team:missing"]) {
		expect((await sent("operator", { kind: "channel_membership", thread, joined: true })).reason).toBe(
			"no team channel with that id",
		);
		expect(
			query(state.dbPath, "select 1 from thread_participants where thread_id = ? and participant = 'operator'", thread),
		).toEqual([]);
	}
	expect(
		(
			await sent("operator", {
				kind: "channel_membership",
				thread: "",
				joined: true,
			})
		).reason,
	).toBe("channel membership needs a thread and whether to join");
	expect(
		(
			await sent("operator", {
				kind: "channel_membership",
				thread: channel,
				joined: "yes" as unknown as boolean,
			})
		).reason,
	).toBe("channel membership needs a thread and whether to join");
	expect((await sent("other", { kind: "channel_membership", thread: channel, joined: true })).reason).toBe(
		"only the operator can join or leave a channel this way",
	);
	expect(
		query(
			state.dbPath,
			"select participant from thread_participants where thread_id = ? and participant = 'other'",
			channel,
		),
	).toEqual([]);
	expect(await sent("operator", { kind: "channel_membership", thread: "team:other", joined: true })).toEqual({
		stage: "applied",
	});
	expect(
		query(
			state.dbPath,
			"select delivery, invited from thread_participants where thread_id = 'team:other' and participant = 'operator'",
		),
	).toEqual([{ delivery: "pull", invited: 1 }]);
});
