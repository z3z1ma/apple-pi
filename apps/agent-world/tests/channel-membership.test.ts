import { afterAll, expect, test, vi } from "vitest";
import type { Command } from "../../../components/session-state/src/protocol.js";
import {
	fakeBridge,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { openCommands } from "../src/backend/commands.js";
import { openWorkplace } from "../src/backend/workplace.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

const state = tempStateDir();
const leadProcess = standInProcess();
const workerProcess = standInProcess();
const channel = "team:lead";

afterAll(() => {
	leadProcess.child.kill();
	workerProcess.child.kill();
});

test("joining a channel refreshes the snapshot and the existing read path, and a private thread is refused", async () => {
	await startRuntime(state.socketPath);
	const lead = await fakeBridge(state.socketPath, "lead", leadProcess.pid, leadProcess.startedAt, {
		session: { name: "Lead" },
		facts: { manages: true },
	});
	const worker = await fakeBridge(state.socketPath, "worker", workerProcess.pid, workerProcess.startedAt, {
		session: { name: "Worker" },
		facts: { reportsTo: "lead" },
	});
	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const commands = openCommands(state.socketPath);
	const workplace = openWorkplace(state.dbPath, commands, () => world.snapshot());
	const send = async (command: Command) =>
		expect((await sendCommand(state.socketPath, "lead", command)).at(-1)).toMatchObject({ stage: "applied" });
	try {
		await vi.waitFor(
			() => {
				expect(world.snapshot().workplace?.threads.some((thread) => thread.id === channel)).toBe(true);
				expect(world.snapshot().characters.some((person) => person.id === "worker")).toBe(true);
			},
			{ timeout: 10000 },
		);
		await send({ kind: "thread_post", thread: channel, body: "History the operator has not read." });
		await send({
			kind: "thread_post",
			thread: "private",
			subject: "Private mail",
			to: ["worker"],
			body: "Not a channel.",
		});

		expect(await workplace.setChannelMembership(channel, true)).toEqual({ ok: true, stage: "applied" });
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.threads.find((thread) => thread.id === channel)?.participants).toContain(
					"operator",
				),
			{ timeout: 10000 },
		);
		await vi.waitFor(
			() => expect(world.snapshot().operatorMail).toContainEqual(expect.objectContaining({ id: channel, unread: 1 })),
			{ timeout: 10000 },
		);
		const firstRead = await workplace.readWorkplaceThread(channel);
		expect(firstRead).toMatchObject({
			ok: true,
			thread: { readUpTo: 0, messages: [expect.objectContaining({ body: "History the operator has not read." })] },
		});
		if (!firstRead.ok) throw new Error(firstRead.reason);
		const firstSeq = firstRead.thread.messages.at(-1)!.seq;
		await vi.waitFor(
			() => expect(world.snapshot().operatorMail).toContainEqual(expect.objectContaining({ id: channel, unread: 0 })),
			{ timeout: 10000 },
		);

		expect(
			(
				await sendCommand(state.socketPath, "operator", { kind: "thread_post", thread: channel, body: "My own post." })
			).at(-1),
		).toMatchObject({ stage: "applied" });
		await send({ kind: "thread_post", thread: "private", body: "A global sequence outside the channel." });
		await send({ kind: "thread_post", thread: channel, body: "Another incoming post after a global sequence gap." });
		await vi.waitFor(
			() => expect(world.snapshot().operatorMail).toContainEqual(expect.objectContaining({ id: channel, unread: 1 })),
			{ timeout: 10000 },
		);
		const nextRead = await workplace.readWorkplaceThread(channel);
		expect(nextRead).toMatchObject({
			ok: true,
			thread: {
				messages: expect.arrayContaining([
					expect.objectContaining({ body: "My own post." }),
					expect.objectContaining({ body: "Another incoming post after a global sequence gap." }),
				]),
			},
		});

		if (!nextRead.ok) throw new Error(nextRead.reason);
		const ownPost = nextRead.thread.messages.find((message) => message.body === "My own post.")!;
		expect(ownPost.seq).toBeGreaterThan(firstSeq);
		expect(nextRead.thread.readUpTo).toBe(ownPost.seq);
		await vi.waitFor(
			() => expect(world.snapshot().operatorMail).toContainEqual(expect.objectContaining({ id: channel, unread: 0 })),
			{ timeout: 10000 },
		);

		expect(await workplace.setChannelMembership("private", true)).toMatchObject({
			ok: false,
			reason: "no team channel with that id",
		});
		expect(await workplace.readWorkplaceThread("private")).toMatchObject({ ok: false });
		expect(await workplace.setChannelMembership(channel, false)).toEqual({ ok: true, stage: "applied" });
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.threads.find((thread) => thread.id === channel)?.participants).not.toContain(
					"operator",
				),
			{ timeout: 10000 },
		);
	} finally {
		lead.socket.destroy();
		worker.socket.destroy();
		world.close();
		commands.close();
		await stopRuntime(state);
	}
}, 40000);
