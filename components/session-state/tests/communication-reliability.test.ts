import { createConnection, type Socket } from "node:net";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Command } from "../src/protocol.js";
import { lineReader } from "../src/protocol.js";
import { fakeBridge, query, sendCommand, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

async function client() {
	const socket = createConnection(state.socketPath);
	const receipts: { commandId: string; stage: string }[] = [];
	socket.on(
		"data",
		lineReader((line) => receipts.push(JSON.parse(line))),
	);
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});
	return {
		socket,
		receipts,
		send(id: string, person: string, command: Command) {
			socket.write(`${JSON.stringify({ type: "command", commandId: id, sessionId: person, command })}\n`);
		},
	};
}

async function people(prefix: string) {
	const process = standInProcess();
	const lead = await fakeBridge(state.socketPath, `${prefix}-lead`, process.pid, process.startedAt, {
		facts: { manages: true },
	});
	const reader = await fakeBridge(state.socketPath, `${prefix}-reader`, process.pid, process.startedAt, {
		facts: { reportsTo: `${prefix}-lead` },
	});
	await vi.waitFor(() =>
		expect(query(state.dbPath, "select reports_to from sessions where id = ?", `${prefix}-reader`)).toEqual([
			{ reports_to: `${prefix}-lead` },
		]),
	);
	return {
		process,
		lead,
		reader,
		close() {
			lead.socket.destroy();
			reader.socket.destroy();
			process.child.kill();
		},
	};
}

test("a sparse channel notification preserves earlier unseen history", async () => {
	const group = await people("sparse");
	try {
		const thread = "team:sparse-lead";
		for (const body of ["Unseen A", "Selected B"]) {
			expect(
				(await sendCommand(state.socketPath, "sparse-lead", { kind: "thread_post", thread, body })).at(-1)?.stage,
			).toBe("applied");
		}
		const [{ seq }] = query<{ seq: number }>(
			state.dbPath,
			"select max(seq) as seq from thread_messages where thread_id = ?",
			thread,
		);
		const deliveries: { commandId: string }[] = [];
		group.reader.socket.on(
			"data",
			lineReader((line) => deliveries.push(JSON.parse(line))),
		);
		const sending = await client();
		try {
			sending.send("sparse-notification", "sparse-reader", {
				kind: "mail",
				from: "sparse-lead",
				thread,
				seq,
				body: "Selected B",
				sentAt: new Date().toISOString(),
			});
			await vi.waitFor(() =>
				expect(deliveries.some((delivery) => delivery.commandId === "sparse-notification")).toBe(true),
			);
			group.reader.send({ type: "command_progress", commandId: "sparse-notification", stage: "applied" });
			await vi.waitFor(() => expect(sending.receipts.at(-1)?.stage).toBe("applied"));
			expect(
				query(
					state.dbPath,
					"select read_up_to from thread_participants where thread_id = ? and participant = 'sparse-reader'",
					thread,
				),
			).toEqual([{ read_up_to: 0 }]);
		} finally {
			sending.socket.destroy();
		}
	} finally {
		group.close();
	}
});

test("publishing to a channel does not acknowledge its unread history", async () => {
	const group = await people("author");
	try {
		const thread = "team:author-lead";
		await sendCommand(state.socketPath, "author-lead", { kind: "thread_post", thread, body: "Unseen C" });
		await sendCommand(state.socketPath, "author-reader", { kind: "thread_post", thread, body: "Independent D" });
		expect(
			query(
				state.dbPath,
				"select read_up_to from thread_participants where thread_id = ? and participant = 'author-reader'",
				thread,
			),
		).toEqual([{ read_up_to: 0 }]);
	} finally {
		group.close();
	}
});

test.each(["accepted", "delivered"])(
	"a %s retry and the original waiter both receive completion once",
	async (stage) => {
		const process = standInProcess();
		const bridge = await fakeBridge(state.socketPath, `retry-${stage}`, process.pid, process.startedAt);
		const original = await client();
		const retry = await client();
		const sockets: Socket[] = [bridge.socket, original.socket, retry.socket];
		const id = `retry-command-${stage}`;
		const command: Command = { kind: "mail", from: "sender", body: "Once", sentAt: new Date().toISOString() };
		try {
			await vi.waitFor(() =>
				expect(query(state.dbPath, "select 1 from sessions where id = ?", `retry-${stage}`)).toHaveLength(1),
			);
			original.send(id, `retry-${stage}`, command);
			await vi.waitFor(() =>
				expect(original.receipts).toContainEqual(expect.objectContaining({ commandId: id, stage: "accepted" })),
			);
			if (stage === "delivered") {
				bridge.send({ type: "command_progress", commandId: id, stage });
				await vi.waitFor(() => expect(original.receipts.at(-1)?.stage).toBe("delivered"));
			}
			retry.send(id, `retry-${stage}`, command);
			await vi.waitFor(() => expect(retry.receipts.at(-1)?.stage).toBe(stage));
			bridge.send({ type: "command_progress", commandId: id, stage: "applied" });
			await vi.waitFor(() => {
				expect(original.receipts.at(-1)?.stage).toBe("applied");
				expect(retry.receipts.at(-1)?.stage).toBe("applied");
			});
			expect(query(state.dbPath, "select 1 from commands where command_id = ?", id)).toHaveLength(1);
		} finally {
			for (const socket of sockets) socket.destroy();
			process.child.kill();
		}
	},
);
