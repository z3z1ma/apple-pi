import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import * as client from "../src/client.js";
import { installCommunicationTools } from "../src/communication-tools.js";
import type { CommunicationAttempt } from "../src/communication-types.js";
import { fakeBridge, query, sendCommand, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const tools = new Map<string, ToolDefinition>();
installCommunicationTools({
	registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
} as unknown as ExtensionAPI);
const people: { process: ReturnType<typeof standInProcess>; link: Awaited<ReturnType<typeof fakeBridge>> }[] = [];
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	for (const person of people) {
		person.link.socket.destroy();
		person.process.child.kill();
	}
	await stopRuntime(state);
});

async function person(id: string, manager: string | null = null) {
	const process = standInProcess();
	const link = await fakeBridge(state.socketPath, id, process.pid, process.startedAt, {
		session: { name: id },
		facts: { reportsTo: manager },
	});
	people.push({ process, link });
	await vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
	return id;
}

async function invoke(self: string, name: string, args: Record<string, unknown>, id = randomUUID()) {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Missing native tool ${name}`);
	const ctx = { sessionManager: { getSessionId: () => self } } as ExtensionToolContext;
	return tool.execute(id, args, undefined, undefined, ctx);
}

async function applied(self: string, name: string, args: Record<string, unknown>, id = randomUUID()) {
	const result = await invoke(self, name, args, id);
	expect(result).not.toMatchObject({ isError: true });
	const details = result.details as CommunicationAttempt;
	expect(details.outcome).toBe("applied");
	return details;
}

// These exercise public native execution over the isolated real runtime. Core tests own wider authority/retention coverage.
test("an SDK replay preserves the original alias audience and thread rather than resolving a newer team", async () => {
	const root = await person("native-mail-root");
	const ben = await person("native-mail-ben", root);
	const input = { to: ["my-team"], subject: "Review", body: "Please inspect the evidence." };
	const call = randomUUID();
	const first = await applied(root, "send_mail", input, call);
	expect(first.effect?.to).toEqual([ben]);
	await person("native-mail-imani", root);
	const again = await applied(root, "send_mail", input, call);
	expect(again.effect?.to).toEqual([ben]);
	expect(again.effect?.thread.id).toBe(first.effect?.thread.id);
	expect(
		query(state.dbPath, "select id from thread_messages where thread_id = ?", first.effect!.thread.id),
	).toHaveLength(1);
	const distinct = await applied(root, "send_mail", input);
	expect(distinct.effect?.to).toEqual([ben, "native-mail-imani"]);
	expect(distinct.effect?.thread.id).not.toBe(first.effect?.thread.id);
}, 30000);

test("lost publication results retain an attempt recoverable by handle or original SDK call ID", async () => {
	const root = await person("native-lost-root");
	const ben = await person("native-lost-ben", root);
	const original = client.sendCommand;
	const lost = vi.spyOn(client, "sendCommand").mockImplementationOnce(async (...args) => {
		await original(...args);
		throw new Error("connection lost after publication");
	});
	const call = randomUUID();
	try {
		const result = await invoke(root, "send_mail", { to: [ben], subject: "Evidence", body: "One publication." }, call);
		expect(result).toMatchObject({ isError: true, details: { outcome: "uncertain" } });
		const attempt = (result.details as { attempt: string }).attempt;
		for (const handle of [attempt, call]) {
			const checked = await invoke(root, "communication_status", { attempt: handle });
			expect(checked.details).toMatchObject({ attempt, outcome: "applied", effect: { to: [ben] } });
		}
		expect(query(state.dbPath, "select id from thread_messages where sender = ?", root)).toHaveLength(1);
		const missing = await invoke(root, "communication_status", { attempt: "unknown-original-attempt" });
		expect(missing.details).toEqual({ attempt: "unknown-original-attempt", outcome: "not_recorded" });
		expect(query(state.dbPath, "select id from thread_messages where sender = ?", root)).toHaveLength(1);
	} finally {
		lost.mockRestore();
	}
}, 30000);

test("channel prose is quiet, explicit notify is validated, and catch-up SDK replay returns the original page", async () => {
	const root = await person("native-channel-root");
	const ben = await person("native-channel-ben", root);
	const channel = (
		await applied(root, "create_channel", { name: "Evidence", purpose: "Retain evidence", invite: [ben] })
	).effect!.thread.id;
	const first = await applied(root, "post", { channel, body: `${ben} said the earlier retry failed.` });
	expect(first.effect?.notify).toEqual([]);
	await applied(root, "post", { channel, body: "Inspect the newer trace.", notify: [ben] });
	const invalid = await invoke(root, "post", { channel, body: "This must not publish.", notify: ["no such person"] });
	expect(invalid).toMatchObject({ isError: true, details: { outcome: "refused" } });
	expect(query(state.dbPath, "select id from thread_messages where thread_id = ?", channel)).toHaveLength(2);
	const call = randomUUID();
	const args = { thread: channel, view: "catch_up", limit: 1 };
	const page = await applied(ben, "read_thread", args, call);
	expect(page.effect?.page?.messages).toHaveLength(1);
	expect(page.effect?.page?.messages[0].body).toContain("earlier retry");
	await applied(root, "post", { channel, body: "Arrived after the original read." });
	const replay = await applied(ben, "read_thread", args, call);
	expect(replay.effect?.page).toEqual(page.effect?.page);
	const continuation = page.effect!.page!.next_cursor;
	expect(continuation).toBeTruthy();
	const next = await applied(ben, "read_thread", { thread: channel, limit: 1, cursor: continuation });
	expect(next.effect?.page?.messages.map((message) => message.body)).toEqual(["Inspect the newer trace."]);
}, 30000);

test("grant removal reports remaining organization access and preserves following; leaving is separate", async () => {
	const root = await person("native-rights-root");
	const ben = await person("native-rights-ben", root);
	const channel = (
		await applied(root, "create_channel", { name: "Scope", purpose: "Compare access and following", invite: [ben] })
	).effect!.thread.id;
	const removed = await applied(root, "remove_thread_invitation", { thread: channel, people: [ben] });
	expect(removed.effect?.people).toEqual([
		expect.objectContaining({ person: ben, explicit_invitation_removed: true, access: true, following: true }),
	]);
	const left = await applied(ben, "leave_thread", { thread: channel });
	expect(left.effect?.thread).toMatchObject({ access: true, following: false });
	await applied(ben, "post", { channel, body: "Access does not require following." });
	await applied(root, "post", { channel, body: "Latest context to inspect." });
	const inspection = await applied(ben, "read_thread", { thread: channel, view: "recent", limit: 1 });
	expect(inspection.effect?.page).toMatchObject({ acknowledgment: "not_requested", last_confirmed_cursor: 0 });
	const older = await applied(ben, "read_thread", {
		thread: channel,
		limit: 1,
		cursor: inspection.effect!.page!.next_cursor,
	});
	expect(older.effect?.page).toMatchObject({ acknowledgment: "not_requested", last_confirmed_cursor: 0 });
}, 30000);

test("generic lifecycle preserves historical meeting attribution and refuses structural/task closure", async () => {
	const root = await person("native-history-root");
	const ben = await person("native-history-ben", root);
	const thread = `old-meeting-${randomUUID()}`;
	await sendCommand(state.socketPath, root, {
		kind: "thread_post",
		thread,
		threadKind: "meeting",
		subject: "Historical meeting",
		body: "Original agenda",
		to: [ben],
	});
	await applied(ben, "archive_thread", { thread, summary: "A member records the conclusion." });
	const call = randomUUID();
	const reopen = { thread, reason: "New evidence needs discussion." };
	const resumed = await applied(ben, "reopen_thread", reopen, call);
	expect(resumed.effect?.thread.kind).toBe("meeting");
	await applied(root, "archive_thread", { thread, summary: "The new evidence is settled." });
	await applied(ben, "reopen_thread", reopen, call);
	expect(query(state.dbPath, "select closed_at from threads where id = ?", thread)[0]).not.toMatchObject({
		closed_at: null,
	});
	const pin = resumed.effect!.message!.seq;
	await applied(ben, "pin_message", { thread, seq: pin });
	const refused = await invoke(root, "archive_thread", { thread: `team:${root}`, summary: "Not a structural close." });
	expect(refused).toMatchObject({ isError: true, details: { outcome: "refused" } });
	const task = `task-native-${randomUUID()}`;
	await sendCommand(state.socketPath, root, {
		kind: "thread_post",
		thread: task,
		threadKind: "task",
		subject: "Task discussion",
		body: "Work-owned audience",
		to: [ben],
	});
	const taskRefused = await invoke(root, "archive_thread", { thread: task, summary: "Not work completion." });
	expect(taskRefused).toMatchObject({ isError: true, details: { outcome: "refused" } });
}, 30000);

test("reply refuses unknown conversations and post refuses a private thread without publishing", async () => {
	const root = await person("native-existing-root");
	const ben = await person("native-existing-ben", root);
	const sent = await applied(root, "send_mail", {
		to: [ben],
		subject: "Private",
		body: "Original addressed exchange.",
	});
	for (const [name, args] of [
		["reply", { thread: "native-missing-thread", body: "Not a new mail." }],
		["post", { channel: sent.effect!.thread.id, body: "Not a channel post." }],
	] as const) {
		const refused = await invoke(root, name, args);
		expect(refused).toMatchObject({ isError: true, details: { outcome: "refused" } });
	}
	expect(query(state.dbPath, "select id from threads where id = ?", "native-missing-thread")).toEqual([]);
	expect(query(state.dbPath, "select id from thread_messages where sender = ?", root)).toHaveLength(1);
}, 30000);
