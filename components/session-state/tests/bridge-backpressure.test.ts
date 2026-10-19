import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, tempStateDir } from "./helpers.js";

const state = tempStateDir();
afterAll(() => rmSync(state.agentDir, { recursive: true, force: true }));

test("a runtime that stops reading does not hold up the reply; the bridge coalesces the text it could not send", async () => {
	// A stand-in runtime that accepts the bridge and then stops reading.
	mkdirSync(state.stateDir, { recursive: true });
	const lines: Record<string, any>[] = [];
	let link: Socket | undefined;
	const server = createServer((socket) => {
		link = socket;
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
				lines.push(JSON.parse(buffer.slice(0, end)));
				buffer = buffer.slice(end + 1);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(state.socketPath, resolve));
	const blocks = Array.from({ length: 400 }, (_, i) => `[${i}]${"x".repeat(2000)}`);
	const run = await fauxSession([bridge], [fauxAssistantMessage(blocks.map((text) => fauxText(text)))], [], {
		streamText: true,
	});
	try {
		await vi.waitFor(() => expect(lines.some((line) => line.type === "hello")).toBe(true), { timeout: 5000 });
		link!.pause();
		await run.session.prompt("Write a lot.");
		link!.resume();
		await vi.waitFor(() => expect(lines.some((line) => line.type === "reply_end")).toBe(true), { timeout: 5000 });
		const deltas = lines.filter((line) => line.type === "reply_delta");
		expect(deltas.length).toBeLessThan(blocks.length / 2);
		expect(deltas.map((line) => line.delta).join("")).toBe(blocks.join(""));
		expect(deltas.at(-1)!.seq).toBe(blocks.length);
	} finally {
		await close(run);
		server.close();
	}
}, 30000);
