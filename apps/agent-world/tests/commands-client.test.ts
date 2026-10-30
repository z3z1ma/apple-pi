import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type Commands, openCommands } from "../src/backend/commands.js";
import type { ReceiptStage } from "../src/world.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

let directory: string;
let server: Server;
let commands: Commands;
let connection: Socket;
let request: ReturnType<typeof deferred<{ commandId: string }>>;
let requests: string[];

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), "world-commands-"));
	request = deferred();
	requests = [];
	server = createServer((socket) => {
		connection = socket;
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
				const packet = JSON.parse(buffer.slice(0, newline)) as { commandId: string };
				buffer = buffer.slice(newline + 1);
				requests.push(packet.commandId);
				request.resolve(packet);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(join(directory, "runtime.sock"), resolve));
	commands = openCommands(join(directory, "runtime.sock"));
});

afterEach(async () => {
	commands.close();
	connection?.destroy();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	vi.useRealTimers();
	rmSync(directory, { recursive: true, force: true });
});

function receipt(commandId: string, stage: ReceiptStage) {
	connection.write(`${JSON.stringify({ type: "receipt", commandId, stage })}\n`);
}

test("a delivered retry snapshot waits for the terminal outcome beyond the acceptance timeout", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const delivered = deferred<void>();
	let settled = false;
	const result = commands
		.send(
			"person",
			{ kind: "abort" },
			{
				commandId: "retry",
				onReceipt: (stage) => {
					if (stage === "delivered") delivered.resolve();
				},
			},
		)
		.then((value) => {
			settled = true;
			return value;
		});
	await request.promise;
	receipt("retry", "delivered");
	await delivered.promise;
	await vi.runAllTimersAsync();
	expect(settled).toBe(false);
	receipt("retry", "applied");
	await expect(result).resolves.toEqual({ ok: true });
});

test("same-attempt callers retain both outcomes and receive the current and subsequent stages", async () => {
	const accepted = deferred<void>();
	const firstStages: ReceiptStage[] = [];
	const secondStages: ReceiptStage[] = [];
	const first = commands.send(
		"person",
		{ kind: "abort" },
		{
			commandId: "shared",
			onReceipt: (stage) => {
				firstStages.push(stage);
				if (stage === "accepted") accepted.resolve();
			},
		},
	);
	await request.promise;
	receipt("shared", "accepted");
	await accepted.promise;
	const joined = deferred<void>();
	const second = commands.send(
		"person",
		{ kind: "abort" },
		{
			commandId: "shared",
			onReceipt: (stage) => {
				secondStages.push(stage);
				if (stage === "accepted") joined.resolve();
			},
		},
	);
	await joined.promise;
	receipt("shared", "delivered");
	receipt("shared", "applied");
	await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
	expect(firstStages).toEqual(["accepted", "delivered", "applied"]);
	expect(secondStages).toEqual(firstStages);
});

test("a changed request cannot replace a waiting same-ID caller", async () => {
	const first = commands.send("person", { kind: "abort" }, { commandId: "same" });
	await request.promise;
	await expect(commands.send("another-person", { kind: "abort" }, { commandId: "same" })).resolves.toMatchObject({
		ok: false,
		reason: expect.stringContaining("different request"),
	});
	expect(requests).toEqual(["same"]);
	receipt("same", "applied");
	await expect(first).resolves.toEqual({ ok: true });
});

test("losing the connection after a delivered snapshot reports uncertainty to every caller", async () => {
	const delivered = deferred<void>();
	const first = commands.send(
		"person",
		{ kind: "abort" },
		{
			commandId: "lost",
			onReceipt: (stage) => {
				if (stage === "delivered") delivered.resolve();
			},
		},
	);
	await request.promise;
	receipt("lost", "delivered");
	await delivered.promise;
	const joined = deferred<void>();
	const second = commands.send("person", { kind: "abort" }, { commandId: "lost", onReceipt: () => joined.resolve() });
	await joined.promise;
	connection.destroy();
	for (const result of await Promise.all([first, second]))
		expect(result).toMatchObject({
			ok: false,
			reason: expect.stringContaining("may still have been applied"),
		});
});
