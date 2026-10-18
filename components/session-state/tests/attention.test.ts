import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import askUserQuestion from "../../ask-user-question/src/index.js";
import bridge from "../src/index.js";
import { close, query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

// A scratch tmux server under its own TMUX_TMPDIR, with a real client attached through a pty, so "the pane a
// client shows" is what tmux itself reports.
const tmuxDir = mkdtempSync(join(tmpdir(), "apa-"));
const state = tempStateDir();
vi.stubEnv("TMUX_TMPDIR", tmuxDir);
const PLUGIN = new URL("../../tmux-sessions/pi_session_manager.tmux", import.meta.url).pathname;
let client: ChildProcess | undefined;
let socket = "";

const tmux = (...args: string[]) =>
	execFileSync("tmux", ["-L", "attn", "-f", "/dev/null", ...args], { encoding: "utf8" }).trim();
const option = (name: string) => tmux("show-option", "-gqv", name);

beforeAll(async () => {
	tmux("new-session", "-d", "-s", "work", "-x", "120", "-y", "40");
	tmux("new-window", "-d", "-t", "work");
	tmux("new-window", "-d", "-t", "work");
	socket = tmux("display-message", "-p", "#{socket_path}");
	// The client attaches to window 2, which holds no Pi session.
	tmux("select-window", "-t", "work:2");
	client = spawn(
		"python3",
		[
			"-c",
			`import fcntl, os, pty, struct, termios, sys
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    os.execvp("tmux", ["tmux", "-L", "attn", "attach", "-t", "work"])
while True:
    try:
        os.read(fd, 65536)
    except OSError:
        sys.exit(0)`,
		],
		{ env: { ...process.env, TERM: "xterm-256color" }, stdio: "ignore" },
	);
	await vi.waitFor(() => expect(tmux("list-clients", "-F", "#{client_name}")).not.toBe(""), { timeout: 10000 });
	await startRuntime(state.socketPath);
});
afterAll(async () => {
	client?.kill();
	try {
		execFileSync("tmux", ["-L", "attn", "kill-server"], { stdio: "ignore" });
	} catch {}
	await stopRuntime(state);
	rmSync(tmuxDir, { recursive: true, force: true });
});

type Row = { seen_at: number | null; settled_at: number | null; needs_you_since: number | null };
const row = (id: string) =>
	query<Row>(state.dbPath, "select seen_at, settled_at, needs_you_since from sessions where id = ?", id)[0];
const pane = (window: number) => tmux("display-message", "-p", "-t", `work:${window}`, "#{pane_id}");

/** A faux session bound to a pane of the scratch server; `replies` as for `fauxSession`. */
async function inPane(window: number, replies: Parameters<typeof fauxSession>[1], tools: string[] = []) {
	vi.stubEnv("TMUX", `${socket},1,0`);
	vi.stubEnv("TMUX_PANE", pane(window));
	const run = await fauxSession([bridge, askUserQuestion], replies, tools);
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(
		() =>
			expect(
				query(state.dbPath, "select 1 from incarnations where session_id = ? and pane_id is not null", id),
			).toHaveLength(1),
		{ timeout: 15000 },
	);
	return { run, id };
}

test("a settled session needs you until a client shows its pane, then counts as seen without a hook", async () => {
	const { run, id } = await inPane(0, [fauxAssistantMessage("done")]);
	try {
		await run.session.prompt("work");
		await vi.waitFor(() => expect(row(id).needs_you_since).not.toBeNull());
		expect(row(id).seen_at).toBeNull();
		await vi.waitFor(() => expect(option("@pi_jump_target")).toBe(pane(0)));
		expect(option("@pi_agents")).toContain("\u2713 1");

		tmux("select-window", "-t", "work:0");
		await vi.waitFor(() => expect(row(id)).toMatchObject({ needs_you_since: null, seen_at: expect.any(Number) }), {
			timeout: 5000,
		});
		expect(query(state.dbPath, "select data from events where session_id = ? and type = 'seen'", id)).toEqual([
			{ data: JSON.stringify({ via: "pane" }) },
		]);
		await vi.waitFor(() => expect(option("@pi_jump_target")).toBe(""));
		expect(option("@pi_agents")).toContain("\u00b7 1");
	} finally {
		tmux("select-window", "-t", "work:2");
		await close(run);
	}
}, 30000);

test("a mark-seen command clears needs you; an open questionnaire needs you until it closes", async () => {
	let answer: (value: unknown) => void = () => {};
	const questions = [
		{
			question: "Which runtime?",
			header: "Runtime",
			options: [
				{ label: "Node", description: "Built in" },
				{ label: "Rust", description: "Native" },
			],
		},
	];
	const ask: Reply = fauxAssistantMessage([fauxToolCall("ask_user_question", { questions })], {
		stopReason: "toolUse",
	});
	const { run, id } = await inPane(
		1,
		[fauxAssistantMessage("first"), ask, fauxAssistantMessage("thanks")],
		["ask_user_question"],
	);
	try {
		// With a UI from the start: without one, ask_user_question leaves the active tools.
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: { custom: () => new Promise((resolve) => (answer = resolve)), notify: () => {} } as never,
		});
		// The rebound bridge reconnects; a settle before that would go unseen by the runtime.
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select 1 from events where session_id = ? and type = 'gap'", id)).toHaveLength(1),
		);
		await run.session.prompt("work");
		await vi.waitFor(() => expect(row(id).needs_you_since).not.toBeNull());
		expect((await sendCommand(state.socketPath, id, { kind: "mark_seen" })).at(-1)).toEqual({ stage: "applied" });
		expect(row(id)).toMatchObject({ needs_you_since: null, seen_at: expect.any(Number) });

		const turn = run.session.prompt("ask me");
		await vi.waitFor(() => expect(row(id).needs_you_since).not.toBeNull(), { timeout: 10000 });
		await vi.waitFor(() => expect(option("@pi_agents")).toContain("? 1"));
		// Seeing it does not clear an open prompt.
		await sendCommand(state.socketPath, id, { kind: "mark_seen" });
		expect(row(id).needs_you_since).not.toBeNull();
		answer({ answers: [], cancelled: true });
		await turn;
		await vi.waitFor(() => expect(option("@pi_agents")).not.toContain("? 1"));
	} finally {
		await close(run);
	}
}, 30000);

test("the jump target is the pane that has needed you longest, and the jump key goes there", async () => {
	const older = await inPane(0, [fauxAssistantMessage("first")]);
	let newer: Awaited<ReturnType<typeof inPane>> | undefined;
	try {
		const second = await inPane(1, [fauxAssistantMessage("second")]);
		newer = second;
		await older.run.session.prompt("work");
		await vi.waitFor(() => expect(row(older.id).needs_you_since).not.toBeNull());
		await second.run.session.prompt("work");
		await vi.waitFor(() => expect(row(second.id).needs_you_since).not.toBeNull());
		await vi.waitFor(() => expect(option("@pi_jump_target")).toBe(pane(0)));
		expect(option("@pi_agents")).toContain("\u2713 2");

		tmux("run-shell", PLUGIN);
		expect(tmux("show-hooks", "-g")).not.toContain("pane-focus-in");
		expect(tmux("list-keys", "-T", "prefix", "y")).toContain("jump");
		const clientName = tmux("list-clients", "-F", "#{client_name}");
		const sidebar = new URL("../../tmux-sessions/scripts/sidebar.sh", import.meta.url).pathname;
		tmux("run-shell", `'${sidebar}' jump '${clientName}'`);
		expect(tmux("list-clients", "-F", "#{pane_id}")).toBe(pane(0));
		// Shown now, so seen: the next one in line becomes the target.
		await vi.waitFor(() => expect(option("@pi_jump_target")).toBe(pane(1)), { timeout: 5000 });
	} finally {
		tmux("select-window", "-t", "work:2");
		await close(older.run);
		if (newer) await close(newer.run);
	}
}, 30000);
