import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { registerRecallTool, sessionSearchTool } from "../src/tool.js";
import { assistantText, userMsg } from "./fixtures.js";
import { startRecallRuntime } from "./indexed-runtime.js";

vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>();
	return { ...actual, open: vi.fn(actual.open) };
});

const dir = mkdtempSync(join(tmpdir(), "recall-offset-"));
const file = join(dir, "prefix.jsonl");
const entries = [
	{ type: "message", id: "prefix", parentId: null, message: userMsg("prefix \u03bb text") },
	{ type: "message", id: "hit", parentId: "prefix", message: assistantText("offsetneedle precise evidence") },
];
let runtime: Awaited<ReturnType<typeof startRecallRuntime>>;
beforeAll(async () => {
	runtime = await startRecallRuntime(file, entries);
});
afterAll(async () => {
	await runtime?.stop();
	rmSync(dir, { recursive: true, force: true });
});

for (const wrongIdentity of [false, true]) {
	test(
		wrongIdentity
			? "a wrong identity at the indexed offset recovers silently by stable entry ID"
			: "selected body recovery reads only its indexed byte range",
		async () => {
			const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
			const batches: unknown[][][] = [];
			let injected = false;
			vi.mocked(open).mockImplementation(async (...args: Parameters<typeof actual.open>) => {
				const handle = await actual.open(...args);
				if (args[0] === file) {
					const spy = vi.spyOn(handle, "read");
					batches.push(spy.mock.calls);
					if (wrongIdentity && !injected) {
						injected = true;
						spy.mockImplementationOnce((async (buffer: Buffer, _offset: number, length: number) => {
							buffer.fill(32);
							buffer.write('{"id":"wrong"}');
							return { bytesRead: length, buffer };
						}) as any);
					}
				}
				return handle;
			});
			try {
				const result = await sessionSearchTool.execute("search", { query: "offsetneedle" }, undefined, undefined, {
					sessionManager: {
						getSessionId: () => runtime.sessionId,
						getSessionFile: () => file,
						getEntries: () => runtime.entries,
						getBranch: () => runtime.entries,
					},
				} as any);
				expect((result.content[0] as any).text).toContain("offsetneedle precise evidence");
				expect((result.content[0] as any).text).toContain("Read source: entry:hit");
				const text = readFileSync(file, "utf8");
				const line = text.split("\n").find((value) => value && JSON.parse(value).id === "hit")!;
				const reads = batches.flat();
				expect(reads[0]).toEqual([
					expect.any(Buffer),
					0,
					Buffer.byteLength(line),
					Buffer.byteLength(text.slice(0, text.indexOf(line))),
				]);
				if (!wrongIdentity) expect(reads).toHaveLength(1);
			} finally {
				vi.mocked(open).mockImplementation(actual.open);
			}
		},
	);
}

test("unreachable runtime is a native failed tool call", async () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(dir, "missing-runtime");
	const run = await fauxSession(
		[(pi) => registerRecallTool(pi)],
		[
			fauxAssistantMessage(fauxToolCall("search_session", { query: "offsetneedle" }, { id: "failure" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done"),
		],
		["search_session"],
		{ cwd: dir, sessionManager: SessionManager.create(dir, join(dir, "native-sessions")) },
	);
	try {
		await run.session.prompt("Search history.");
		const result = run.session.messages.find(
			(message) => message.role === "toolResult" && message.toolCallId === "failure",
		);
		expect(result?.role).toBe("toolResult");
		if (result?.role !== "toolResult") throw new Error("Missing failed recall result");
		expect(result.isError).toBe(true);
		expect(result.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "text", text: expect.stringContaining("Indexed session search failed") }),
			]),
		);
	} finally {
		run.dispose();
		process.env.PI_CODING_AGENT_DIR = previous;
	}
});
