import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
		tmuxSocket: "/private/tmp/tmux-501/default",
		reportsTo: "",
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

test("writeState leaves no temp files behind for the sidebar to trip over", async () => {
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

/** Wait for the extension's queued file writes; under full-suite load they can take far longer than a few ticks. */
async function flushUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
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
		registerFlag() {},
		getFlag: () => undefined,
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

test("loads the tmux plugin once per tmux server and points it at the state directory", async () => {
	const previousPane = process.env.TMUX_PANE;
	process.env.TMUX_PANE = "%78";
	const server = new Map<string, string>();
	const pluginRuns: string[] = [];
	const startPi = (sessionId: string) => {
		const handlers = new Map<string, (...args: unknown[]) => unknown>();
		const pi = {
			on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
			registerCommand() {},
			registerFlag() {},
			getFlag: () => undefined,
			getSessionName: () => "",
			async exec(_command: string, args: string[]) {
				if (args[0] === "-c") return { code: 0, stdout: "tmux\n", stderr: "" };
				if (args[0] === "display-message") return { code: 0, stdout: "%78\t@4\t/dev/null\n", stderr: "" };
				if (args[0] === "show-option") return { code: 0, stdout: `${server.get(args[2]) ?? ""}\n`, stderr: "" };
				if (args[0] === "set-option") server.set(args[2], args[3]);
				if (args[0] === "run-shell") pluginRuns.push(args[1]);
				return { code: 0, stdout: "", stderr: "" };
			},
		};
		registerTmuxSessions(pi as never);
		handlers.get("session_start")?.(
			{ reason: "startup" },
			{ mode: "tui", cwd: "/tmp/project", isIdle: () => true, sessionManager: { getSessionId: () => sessionId } },
		);
	};

	startPi("session-plugin-a");
	await flushUntil(() => server.has("@pi_sessions_plugin"));
	startPi("session-plugin-b");
	await flushUntil(async () => (await readAllStates()).some((record) => record.sessionId === "session-plugin-b"));
	await new Promise((resolve) => setTimeout(resolve, 20));

	expect(pluginRuns).toHaveLength(1);
	expect(pluginRuns[0]).toMatch(/components\/tmux-sessions\/pi_session_manager\.tmux$/);
	expect(server.get("@pi_state_dir")).toBe(stateDir);

	if (previousPane === undefined) delete process.env.TMUX_PANE;
	else process.env.TMUX_PANE = previousPane;
});

/**
 * Start one Pi process in a fake tmux pane on the given OS and open each root session in turn, as `/new` or a resume
 * would; `notch` answers the notch launcher's exec.
 */
async function startPiOn(
	os: NodeJS.Platform,
	sessionIds: string | string[],
	notch: (command: string, args: string[]) => Promise<unknown>,
) {
	const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
	const previousPane = process.env.TMUX_PANE;
	process.env.TMUX_PANE = "%80";
	Object.defineProperty(process, "platform", { value: os });
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const pi = {
		on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
		registerCommand() {},
		registerFlag() {},
		getFlag: () => undefined,
		getSessionName: () => "",
		async exec(command: string, args: string[]) {
			if (command.endsWith("notch.sh")) return notch(command, args);
			if (args[0] === "-c") return { code: 0, stdout: "tmux\n", stderr: "" };
			if (args[0] === "display-message") return { code: 0, stdout: "%80\t@5\t/dev/null\n", stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	try {
		registerTmuxSessions(pi as never);
		for (const sessionId of [sessionIds].flat()) {
			const ctx = {
				mode: "tui",
				cwd: "/tmp/project",
				isIdle: () => true,
				sessionManager: { getSessionId: () => sessionId },
			};
			handlers.get("session_start")?.({ reason: "startup" }, ctx);
			await flushUntil(async () => (await readAllStates()).some((record) => record.sessionId === sessionId));
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	} finally {
		Object.defineProperty(process, "platform", platform);
		if (previousPane === undefined) delete process.env.TMUX_PANE;
		else process.env.TMUX_PANE = previousPane;
	}
	return handlers;
}

test("each root Pi session start in tmux starts the notch panel on macOS and nowhere else", async () => {
	const starts: string[][] = [];
	const notch = async (command: string, args: string[]) => {
		starts.push([command, ...args]);
		return { code: 0, stdout: "", stderr: "" };
	};
	const start = [expect.stringMatching(/components\/tmux-sessions\/scripts\/notch\.sh$/), "start"];

	await startPiOn("darwin", ["session-notch-mac", "session-notch-mac-new"], notch);
	await startPiOn("linux", "session-notch-linux", notch);

	expect(starts).toEqual([start, start]);
});

test("a failing notch start does not stop status publishing", async () => {
	const handlers = await startPiOn("darwin", "session-notch-fails", async () => {
		throw new Error("swiftc crashed");
	});

	handlers.get("agent_start")?.({ type: "agent_start" });
	await flushUntil(
		async () => (await readAllStates()).find((record) => record.sessionId === "session-notch-fails")?.status === "busy",
	);

	expect((await readAllStates()).find((record) => record.sessionId === "session-notch-fails")?.status).toBe("busy");
});

test("a session rename updates the record's name without counting as a status change", async () => {
	const previousPane = process.env.TMUX_PANE;
	process.env.TMUX_PANE = "%79";
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const pi = {
		on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
		registerCommand() {},
		registerFlag() {},
		getFlag: () => undefined,
		getSessionName: () => "",
		async exec(_command: string, args: string[]) {
			if (args[0] === "display-message") return { code: 0, stdout: "%79\t@5\t/dev/null\n", stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	registerTmuxSessions(pi as never);
	handlers.get("session_start")?.(
		{ reason: "startup" },
		{ mode: "tui", cwd: "/tmp/project", isIdle: () => true, sessionManager: { getSessionId: () => "session-rename" } },
	);
	const find = async () => (await readAllStates()).find((record) => record.sessionId === "session-rename");
	await flushUntil(async () => Boolean(await find()));
	const before = await find();
	await new Promise((resolve) => setTimeout(resolve, 1_100));
	handlers.get("session_info_changed")?.({ name: "Auto title" });
	await flushUntil(async () => (await find())?.sessionName === "Auto title");

	expect((await find())?.sessionName).toBe("Auto title");
	expect((await find())?.updatedAt).toBe(before?.updatedAt);

	if (previousPane === undefined) delete process.env.TMUX_PANE;
	else process.env.TMUX_PANE = previousPane;
});

test("a session started with --reports-to publishes its supervisor and removes its record before shutdown resolves", async () => {
	const previousPane = process.env.TMUX_PANE;
	process.env.TMUX_PANE = "%81";
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const flags = new Map<string, unknown>();
	const pi = {
		on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
		registerCommand() {},
		registerFlag(name: string) {
			flags.set(name, "coordinator-test");
		},
		getFlag: (name: string) => flags.get(name),
		getSessionName: () => "Worker",
		async exec(_command: string, args: string[]) {
			if (args[0] === "display-message") return { code: 0, stdout: "%81\t@6\t/dev/null\n", stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	registerTmuxSessions(pi as never);
	handlers.get("session_start")?.(
		{ reason: "startup" },
		{ mode: "tui", cwd: "/tmp/worker", isIdle: () => true, sessionManager: { getSessionId: () => "session-worker" } },
	);
	const find = async () => (await readAllStates()).find((record) => record.sessionId === "session-worker");
	await flushUntil(async () => Boolean(await find()));
	expect((await find())?.reportsTo).toBe("coordinator-test");

	handlers.get("session_shutdown")?.({ reason: "reload" });

	handlers.get("session_start")?.(
		{ reason: "reload" },
		{ mode: "tui", cwd: "/tmp/worker", isIdle: () => true, sessionManager: { getSessionId: () => "session-worker" } },
	);
	await flushUntil(async () => Boolean(await find()));
	handlers.get("agent_start")?.({ type: "agent_start" });
	await flushUntil(async () => (await find())?.status === "busy");
	// Pi awaits the handler before a SIGHUP exit, so the record must be gone when it resolves.
	await handlers.get("session_shutdown")?.({ reason: "quit" });
	expect(existsSync(join(stateDir, "session-worker.json"))).toBe(false);

	if (previousPane === undefined) delete process.env.TMUX_PANE;
	else process.env.TMUX_PANE = previousPane;
});
