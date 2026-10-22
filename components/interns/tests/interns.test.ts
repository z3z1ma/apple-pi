import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { installInterns } from "../src/index.js";

let dir: string;
let originalArgv: string | undefined;
const sessions: Awaited<ReturnType<typeof fauxSession>>[] = [];
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "intern-test-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", dir);
	vi.stubEnv("INTERN_TEST_DIR", dir);
	writeFileSync(
		join(dir, "model-profiles.json"),
		JSON.stringify({ profiles: { quick: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
	);
	originalArgv = process.argv[1];
	process.argv[1] = fileURLToPath(new URL("../../../tests/fixtures/intern-worker.mjs", import.meta.url));
});
afterEach(async () => {
	for (const run of sessions.splice(0)) {
		await run.session.abort();
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	}
	process.argv[1] = originalArgv!;
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});
const started = (question: string) =>
	JSON.parse(readFileSync(join(dir, `${question}.json`), "utf8")) as {
		pid: number;
		child?: number;
		args: string[];
		context?: string;
		material?: unknown;
	};
const gone = (pid: number) => {
	try {
		process.kill(pid, 0);
		return false;
	} catch {
		return true;
	}
};
const call = (name: string, question: string, material?: string) =>
	fauxToolCall(name, { question, ...(material ? { material } : {}) });
async function session(calls: ReturnType<typeof fauxToolCall>[]) {
	const run = await fauxSession([installInterns], [fauxAssistantMessage(calls, { stopReason: "toolUse" })], []);
	sessions.push(run);
	return run;
}
const results = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.messages.filter((m) => m.role === "toolResult");

test("a one-shot intern returns its answer, exposes current tool activity, and leaves no worker or bound material", async () => {
	const run = await session([call("research", "sources", "Read https://example.test/docs")]);
	const updates: string[] = [];
	run.session.subscribe((event) => {
		if (event.type === "tool_execution_update") updates.push(JSON.stringify(event.partialResult));
	});
	await run.session.prompt("read the sources");
	expect(results(run)).toContainEqual(
		expect.objectContaining({
			toolName: "research",
			isError: false,
			content: [{ type: "text", text: "Report for sources" }],
		}),
	);
	expect(updates.some((text) => text.includes("read src/sample.ts"))).toBe(true);
	const worker = started("sources");
	expect(gone(worker.pid)).toBe(true);
	expect(worker.args).toContain("--no-session");
	expect(worker.args.slice(-2)).toEqual(["--", "sources"]);
	expect(worker.args[worker.args.indexOf("--model") + 1]).toBe("faux-session-provider/faux-session-model");
	expect(worker.args[worker.args.indexOf("--thinking") + 1]).toBe("off");
	const tools = worker.args[worker.args.indexOf("--tools") + 1].split(",");
	expect(tools).toContain("read");
	expect(tools).toContain("bash");
	expect(tools).not.toContain("edit");
	expect(tools).not.toContain("write");
	expect(worker.material).toEqual({ material: "Read https://example.test/docs" });
	expect(existsSync(worker.context!)).toBe(false);
}, 15000);

test("two intern calls in one assistant message overlap and both exit", async () => {
	const run = await session([call("explore", "parallel-one"), call("research", "parallel-two")]);
	await run.session.prompt("investigate independently");
	expect(results(run).map((r) => r.isError)).toEqual([false, false]);
	expect(JSON.stringify(results(run))).toContain("Report for parallel-one");
	expect(JSON.stringify(results(run))).toContain("Report for parallel-two");
	for (const question of ["parallel-one", "parallel-two"]) expect(gone(started(question).pid)).toBe(true);
}, 15000);

test.each(["abort", "shutdown"] as const)(
	"%s waits for the intern and its tool process to stop",
	async (reason) => {
		const run = await session([call("explore", "waiting")]);
		let render: (() => string[]) | undefined;
		const statuses = new Map<string, string | undefined>();
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: {
				setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
				setWidget: (_key: string, factory: unknown) => {
					render =
						typeof factory === "function"
							? factory(
									{ terminal: { columns: 100 }, requestRender: () => {} },
									{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
								).render
							: undefined;
				},
			} as never,
		});
		const turn = run.session.prompt("read until interrupted");
		await vi.waitFor(() => expect(existsSync(join(dir, "waiting.json"))).toBe(true), { timeout: 10000 });
		const worker = started("waiting");
		await vi.waitFor(() => expect(render?.().join("\n")).toContain("read src/sample.ts"));
		expect(statuses.get("interns")).toBe("interns:1");
		let firstShutdown: Promise<unknown> | undefined;
		if (reason === "abort") await run.session.abort();
		else {
			firstShutdown = run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		}
		expect(gone(worker.pid)).toBe(true);
		expect(gone(worker.child!)).toBe(true);
		await firstShutdown;
		await turn;
		expect(existsSync(join(dir, "waiting.stopped"))).toBe(true);
		expect(render).toBeUndefined();
		expect(statuses.get("interns")).toBeUndefined();
	},
	15000,
);

test("a failed or truncated intern report is an error, not a completed finding", async () => {
	const run = await session([call("explore", "failed"), call("research", "truncated")]);
	await run.session.prompt("read two sources");
	expect(results(run).map((r) => r.isError)).toEqual([true, true]);
	expect(JSON.stringify(results(run))).toContain("source is unavailable");
	expect(JSON.stringify(results(run))).toContain("text is partial");
});

test("both tool descriptions and guidelines teach the cheap intern's benefits and risks", () => {
	const definitions: ToolDefinition[] = [];
	installInterns({
		on: vi.fn(),
		registerTool: (tool: ToolDefinition) => definitions.push(tool),
	} as unknown as ExtensionAPI);
	for (const tool of definitions) {
		for (const text of [tool.description, tool.promptGuidelines?.join("\n") ?? ""]) {
			expect(text).toMatch(/cheap intern/i);
			expect(text).toMatch(/lossy summary/);
			expect(text).toMatch(/miss, misread, or state a belief as fact/);
			expect(text).toMatch(/Verify findings/);
			expect(text).toMatch(/read the source/);
		}
	}
	expect(definitions.map((tool) => tool.name)).toEqual(["explore", "research"]);
});
