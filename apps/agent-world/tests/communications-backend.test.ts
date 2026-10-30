import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	fakeBridge,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { openCommunications } from "../src/backend/communications.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

const state = tempStateDir();
const process = standInProcess();
let lead: Awaited<ReturnType<typeof fakeBridge>>;
let commands: Commands;
let api: ReturnType<typeof openCommunications>;
let world: ReturnType<typeof openWorldBackend>;

beforeAll(async () => {
	await startRuntime(state.socketPath);
	lead = await fakeBridge(state.socketPath, "lead", process.pid, process.startedAt, {
		session: { name: "Lead", cwd: state.agentDir },
		facts: { manages: true },
	});
	commands = openCommands(state.socketPath);
	api = openCommunications(state.dbPath, commands);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
});

afterAll(async () => {
	world?.close();
	commands?.close();
	lead?.socket.destroy();
	process.child.kill();
	await stopRuntime(state);
});

async function channel(name: string) {
	const result = await api.createChannel({
		attempt: randomUUID(),
		scopeHead: "lead",
		name,
		purpose: "Coordinate the work",
	});
	expect(result).toMatchObject({
		outcome: "applied",
		effect: { thread: { name, scope_head: "lead", following: true } },
	});
	if (!("effect" in result) || !result.effect) throw new Error(JSON.stringify(result));
	return result.effect.thread.id;
}

async function publish(thread: string, body: string) {
	expect((await sendCommand(state.socketPath, "lead", { kind: "thread_post", thread, body })).at(-1)).toMatchObject({
		stage: "applied",
	});
}

test("operator discovery and following use recorded scope and refresh metadata without implicit reads", async () => {
	const thread = await channel("Release notes");
	await publish(thread, "Unread context");
	await vi.waitFor(
		() => {
			expect(world.snapshot().workplace?.threads).toContainEqual(
				expect.objectContaining({
					id: thread,
					headquarters: "lead",
					scopeHead: "lead",
					channelType: "topic",
					participants: ["operator"],
				}),
			);
			expect(world.snapshot().operatorMail).toContainEqual(expect.objectContaining({ id: thread, unread: 1 }));
		},
		{ timeout: 10000 },
	);
	expect(await api.findChannels({ query: "Release notes", scopeHead: "lead", limit: 10 })).toMatchObject({
		ok: true,
		value: { threads: [expect.objectContaining({ id: thread, unread: 1, read_up_to: 0 })] },
	});
	expect(await api.leave({ thread, attempt: randomUUID() })).toMatchObject({ outcome: "applied" });
	await vi.waitFor(
		() => {
			expect(world.snapshot().workplace?.threads.some((row) => row.id === thread)).toBe(false);
			expect(world.snapshot().operatorMail?.some((row) => row.id === thread)).toBe(false);
		},
		{ timeout: 10000 },
	);
	expect(await api.findChannels({ query: "Release notes", limit: 10 })).toMatchObject({
		ok: true,
		value: { threads: [expect.objectContaining({ id: thread, access: true, following: false })] },
	});
	expect(await api.join({ thread, attempt: randomUUID() })).toMatchObject({ outcome: "applied" });
	expect(await api.readThread({ thread, view: "recent", limit: 10 })).toMatchObject({
		ok: true,
		page: { acknowledgment: "not_requested", last_confirmed_cursor: 0 },
	});
});

test("catch-up replays its original acknowledged page while inspections and searches never advance it", async () => {
	const thread = await channel("Catch-up");
	await publish(thread, "First");
	await publish(thread, "Second");
	expect(await api.readThread({ thread, view: "recent", limit: 1 })).toMatchObject({
		ok: true,
		page: {
			messages: [expect.objectContaining({ body: "Second" })],
			last_confirmed_cursor: 0,
			acknowledgment: "not_requested",
		},
	});
	expect(await api.searchMessages({ thread, query: "First", limit: 1 })).toMatchObject({
		ok: true,
		value: { messages: [expect.objectContaining({ body: "First" })] },
	});
	const request = { thread, view: "catch_up" as const, limit: 1, attempt: randomUUID() };
	const first = await api.readThread(request);
	expect(first).toMatchObject({
		ok: true,
		page: { messages: [expect.objectContaining({ body: "First" })], acknowledgment: "applied" },
	});
	await publish(thread, "Third");
	expect(await api.readThread(request)).toEqual(first);
	expect(await api.readThread({ ...request, attempt: randomUUID() })).toMatchObject({
		ok: true,
		page: { messages: [expect.objectContaining({ body: "Second" })], acknowledgment: "applied" },
	});
});

test("lost publication receipts recover the recorded effect without republishing changed or repeated intent", async () => {
	const thread = await channel("Receipt recovery");
	const send = vi.fn<Commands["send"]>(async (...args) => {
		await commands.send(...args);
		return { ok: false, reason: "The receipt was lost." };
	});
	const recovering = openCommunications(state.dbPath, { send, close() {} });
	const request = { thread, body: "Publish once", attempt: randomUUID(), notify: [] };
	const result = await recovering.post(request);
	expect(result).toMatchObject({ outcome: "applied", effect: { message: { body: "Publish once" } } });
	expect(await recovering.post(request)).toEqual(result);
	expect(await recovering.status({ attempt: request.attempt })).toEqual(result);
	expect(await recovering.status({ attempt: result.attempt })).toEqual(result);
	expect(await recovering.post({ ...request, body: "Changed intent" })).toMatchObject({ outcome: "refused" });
	expect(send).toHaveBeenCalledTimes(1);
	expect(await api.searchMessages({ thread, query: "Publish once", limit: 10 })).toMatchObject({
		ok: true,
		value: { messages: [expect.objectContaining({ body: "Publish once" })] },
	});
});

test("new addressed mail reuses its original thread when a lost receipt is recovered", async () => {
	const send = vi.fn<Commands["send"]>(async (...args) => {
		await commands.send(...args);
		return { ok: false, reason: "Receipt lost" };
	});
	const recovering = openCommunications(state.dbPath, { send, close() {} });
	const request = { attempt: randomUUID(), to: ["lead"], subject: "Review request", body: "Please check this" };
	const first = await recovering.sendMail(request);
	expect(first).toMatchObject({
		outcome: "applied",
		effect: { thread: { kind: "mail", name: "Review request" }, to: ["lead"] },
	});
	expect(await recovering.sendMail(request)).toEqual(first);
	expect(await recovering.status({ attempt: request.attempt })).toEqual(first);
	expect(send).toHaveBeenCalledTimes(1);
});

test("an unrecorded transport failure stays uncertain and status never publishes", async () => {
	const send = vi.fn<Commands["send"]>().mockResolvedValue({ ok: false, reason: "Not connected" });
	const offline = openCommunications(state.dbPath, { send, close() {} });
	const attempt = randomUUID();
	expect(await offline.post({ attempt, thread: "not-sent", body: "No accepted publication" })).toMatchObject({
		outcome: "uncertain",
	});
	expect(await offline.status({ attempt })).toMatchObject({ outcome: "not_recorded" });
	expect(send).toHaveBeenCalledTimes(1);
});

test("a reply to an unknown conversation is refused rather than creating private mail", async () => {
	const thread = `missing-${randomUUID()}`;
	expect(await api.post({ thread, body: "Continue the missing conversation", attempt: randomUUID() })).toMatchObject({
		outcome: "refused",
	});
	expect(await api.readThread({ thread, view: "recent", limit: 10 })).toMatchObject({ ok: false });
});

test("an older schema refuses new communication semantics before submitting anything", async () => {
	const path = join(state.agentDir, "older.db");
	const db = new DatabaseSync(path);
	db.exec("create table commands(command_id text primary key)");
	db.close();
	const send = vi.fn<Commands["send"]>();
	const older = openCommunications(path, { send, close() {} });
	expect(await older.findChannels({ limit: 10 })).toMatchObject({
		ok: false,
		reason: expect.stringContaining("Restart"),
	});
	expect(
		await older.createChannel({ attempt: randomUUID(), scopeHead: "lead", name: "New", purpose: "Test" }),
	).toMatchObject({ outcome: "refused", reason: expect.stringContaining("Restart") });
	expect(send).not.toHaveBeenCalled();
});
