import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";

// Redirect the record directory before importing the module under test so
// STATE_DIR resolves into a throwaway location, never a developer's real Pi
// state.
const stateDir = mkdtempSync(join(tmpdir(), "pi-tmux-state-"));
process.env.PI_TMUX_STATE_DIR = stateDir;
afterAll(() => rmSync(stateDir, { recursive: true, force: true }));

const { STATE_DIR, STATE_SCHEMA, safeSessionId, writeState, readAllStates, removeState } = await import(
	"../src/state.js"
);
const { default: registerTmuxSessions } = await import("../src/index.js");

function makeRecord(sessionId: string, overrides: Record<string, unknown> = {}) {
	const ts = 1_700_000_000;
	return {
		schema: STATE_SCHEMA,
		sessionId,
		pid: 4242,
		status: "idle" as const,
		cwd: "/tmp/project",
		sessionName: "",
		paneId: "%7",
		windowId: "@3",
		paneTty: "/dev/ttys009",
		startedAt: ts,
		updatedAt: ts,
		...overrides,
	};
}

test("STATE_DIR honors the PI_TMUX_STATE_DIR override", () => {
	expect(STATE_DIR).toBe(stateDir);
});

test("safeSessionId keeps a filesystem-safe basename", () => {
	expect(safeSessionId("abc-123_.OK")).toBe("abc-123_.OK");
	expect(safeSessionId("a/b\\c:d e")).toBe("a_b_c_d_e");
	expect(safeSessionId("")).toBe("unknown");
});

test("writeState round-trips through readAllStates and writes valid JSON", async () => {
	const record = makeRecord("session-round-trip", { status: "busy", sessionName: "Feature work" });
	await writeState(record);

	const onDisk = JSON.parse(readFileSync(join(stateDir, "session-round-trip.json"), "utf8"));
	expect(onDisk).toEqual(record);

	const all = await readAllStates();
	expect(all).toContainEqual(record);
});

test("writeState leaves no temp files behind for the picker to trip over", async () => {
	await writeState(makeRecord("session-atomic"));
	const { readdirSync } = await import("node:fs");
	const leftovers = readdirSync(stateDir).filter((name) => !name.endsWith(".json"));
	expect(leftovers).toEqual([]);
});

test("readAllStates skips corrupt records instead of throwing", async () => {
	writeFileSync(join(stateDir, "corrupt.json"), "{ not valid json ", "utf8");
	await writeState(makeRecord("session-valid"));
	const all = await readAllStates();
	expect(all.some((entry) => entry.sessionId === "session-valid")).toBe(true);
	expect(all.some((entry) => entry.sessionId === "corrupt")).toBe(false);
});

test("removeState deletes only the target record and tolerates a missing file", async () => {
	await writeState(makeRecord("session-keep"));
	await writeState(makeRecord("session-drop"));
	await removeState("session-drop");
	await removeState("session-drop"); // second removal must not throw

	const ids = (await readAllStates()).map((entry) => entry.sessionId);
	expect(ids).toContain("session-keep");
	expect(ids).not.toContain("session-drop");
});

async function flushUntil(predicate: () => boolean | Promise<boolean>, tries = 50): Promise<void> {
	for (let attempt = 0; attempt < tries; attempt += 1) {
		if (await predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
}

test("uses generic UI prompt lifecycle events for waiting status", async () => {
	const previousPane = process.env.TMUX_PANE;
	const previousBell = process.env.PI_TMUX_SESSION_BELL;
	process.env.TMUX_PANE = "%77";
	process.env.PI_TMUX_SESSION_BELL = "off";
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const pi = {
		on(name: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(name, handler);
		},
		registerCommand() {},
		getSessionName() {
			return "prompt lifecycle";
		},
		async exec(_command: string, args: string[]) {
			if (args[0] === "-c") return { code: 0, stdout: "/opt/homebrew/bin/tmux\n", stderr: "" };
			return { code: 0, stdout: "%77\t@3\t/dev/null\n", stderr: "" };
		},
	};
	let idle = false;
	const ctx = {
		mode: "tui",
		cwd: "/tmp/project",
		isIdle: () => idle,
		sessionManager: { getSessionId: () => "session-ui-prompt" },
	};

	registerTmuxSessions(pi as never);
	expect([...handlers.keys()]).toContain("ui_prompt_start");
	expect([...handlers.keys()]).toContain("ui_prompt_end");
	expect(handlers.has("tool_execution_start")).toBe(false);

	handlers.get("session_start")?.({ reason: "startup" }, ctx);
	await flushUntil(async () => (await readAllStates()).some((record) => record.sessionId === "session-ui-prompt"));
	handlers.get("ui_prompt_start")?.({ type: "ui_prompt_start", reason: "ui_prompt", kind: "custom" }, ctx);
	await flushUntil(
		async () =>
			(await readAllStates()).find((record) => record.sessionId === "session-ui-prompt")?.status === "waiting",
	);

	idle = false;
	handlers.get("ui_prompt_end")?.({ type: "ui_prompt_end", reason: "ui_prompt", kind: "custom" }, ctx);
	await flushUntil(
		async () => (await readAllStates()).find((record) => record.sessionId === "session-ui-prompt")?.status === "busy",
	);

	idle = true;
	handlers.get("ui_prompt_end")?.({ type: "ui_prompt_end", reason: "ui_prompt", kind: "custom" }, ctx);
	await flushUntil(
		async () => (await readAllStates()).find((record) => record.sessionId === "session-ui-prompt")?.status === "idle",
	);

	if (previousPane === undefined) delete process.env.TMUX_PANE;
	else process.env.TMUX_PANE = previousPane;
	if (previousBell === undefined) delete process.env.PI_TMUX_SESSION_BELL;
	else process.env.PI_TMUX_SESSION_BELL = previousBell;
});
