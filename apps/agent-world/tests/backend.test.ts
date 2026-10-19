import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import {
	close,
	fakeBridge,
	query,
	runtimePid,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { openWorldBackend, PREFERENCE_KEY, type WorldBackend } from "../src/backend/world-backend.js";
import type { FeedKind, FeedLine, WorldSnapshot } from "../src/world.js";

// Seam 1: the backend API in Node, without Electron, over a real session-state runtime.
const state = tempStateDir();
const processes: ReturnType<typeof standInProcess>[] = [];
const heartbeats: NodeJS.Timeout[] = [];
let world: WorldBackend;
const updates: WorldSnapshot[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribe((snapshot) => updates.push(snapshot));
});
afterAll(async () => {
	world.close();
	for (const beat of heartbeats) clearInterval(beat);
	for (const { child } of processes) child.kill();
	await stopRuntime(state);
});

const names = (snapshot: WorldSnapshot) => snapshot.characters.map((character) => character.name);
const latest = () => updates.at(-1) ?? world.snapshot();
const character = (id: string) => latest().characters.find((c) => c.id === id);
const wings = (headquarters: string, snapshot = latest()) =>
	snapshot.headquarters.find((hq) => hq.id === headquarters)?.wings.map((wing) => `${wing.name}:${wing.headcount}`);
const recorded = (sql: string, ...params: string[]) =>
	vi.waitFor(() => expect(query(state.dbPath, sql, ...params)).toHaveLength(1), { timeout: 15000 });
const soon = (check: () => void) => vi.waitFor(check, { timeout: 3000 });

/** A top-level session on a fake bridge, kept alive by heartbeats; `stop` ends it the way Pi quits. */
async function session(id: string, options: { coordinator?: boolean; reportsTo?: string; repository?: string } = {}) {
	const stand = standInProcess();
	processes.push(stand);
	const { repository } = options;
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { cwd: `/home/${id}` },
		facts: {
			reportsTo: options.reportsTo ?? null,
			git: repository ? { repository, worktree: repository, branch: "main" } : null,
			config: {
				name: id,
				flags: options.coordinator ? ["coordinator"] : [],
				activeTools: [],
				extensions: [],
				skills: [],
				mcpServers: [],
			},
		},
	});
	link.socket.on("error", () => {}); // heartbeats meet a closed socket while the runtime is down
	const beat = setInterval(() => link.send({ type: "heartbeat" }), 1000);
	heartbeats.push(beat);
	await soon(() => expect(character(id)).toBeDefined());
	return {
		async stop() {
			link.send({ type: "shutdown", reason: "quit" });
			clearInterval(beat);
			link.socket.end();
			stand.child.kill();
			await recorded("select 1 from incarnations where session_id = ? and ended_at is not null", id);
		},
	};
}

test("a root session becomes a character within a second of the runtime recording it, and leaves when it ends", async () => {
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 5000 });
	const run = await fauxSession([bridge], [], []);
	const id = run.session.sessionManager.getSessionId();
	try {
		await recorded("select 1 from sessions where id = ?", id);
		await vi.waitFor(() => expect(latest().characters.map((c) => c.id)).toContain(id), { timeout: 1000 });
	} finally {
		await close(run);
	}
	await recorded("select 1 from incarnations where session_id = ? and ended_at is not null", id);
	await vi.waitFor(() => expect(latest().characters.map((c) => c.id)).not.toContain(id), { timeout: 1000 });
}, 30000);

test("child sessions are not characters; a named root session shows its name", async () => {
	const stand = standInProcess();
	processes.push(stand);
	await fakeBridge(state.socketPath, "root-1", stand.pid, stand.startedAt, { session: { name: "docs-worker" } });
	await fakeBridge(state.socketPath, "child-1", stand.pid, stand.startedAt, {
		session: { kind: "child", spawnedBy: "root-1" },
	});
	await recorded("select 1 from sessions where id = 'child-1'");
	await vi.waitFor(() => expect(names(latest())).toContain("docs-worker"), { timeout: 1000 });
	expect(latest().characters.map((c) => c.id)).not.toContain("child-1");
}, 20000);

test("the coordinator is in its hall, its workers in their repository's wing or else the common room, independents in the square, and stopped sessions in no awake place", async () => {
	await session("coord-1", { coordinator: true });
	await session("w-alpha", { reportsTo: "coord-1", repository: "/repos/alpha" });
	await session("w-loose", { reportsTo: "coord-1" });
	await session("solo");
	const gone = await session("w-gone", { reportsTo: "coord-1", repository: "/repos/alpha" });
	await gone.stop();
	await soon(() => expect(character("w-gone")).toBeUndefined());
	expect(character("coord-1")).toMatchObject({
		role: "coordinator",
		place: { kind: "headquarters", headquarters: "coord-1" },
	});
	expect(character("w-alpha")).toMatchObject({
		role: "worker",
		place: { kind: "wing", headquarters: "coord-1", repository: "/repos/alpha" },
	});
	expect(character("w-loose")).toMatchObject({
		role: "worker",
		place: { kind: "common-room", headquarters: "coord-1" },
	});
	expect(character("solo")).toMatchObject({ role: "independent", place: { kind: "square" } });
	expect(latest().headquarters.map((hq) => hq.id)).toEqual(["coord-1"]);
	expect(wings("coord-1")).toEqual(["alpha:1"]);
	// Characters come in the order their sessions started, so nobody moves when another leaves.
	const ids = latest().characters.map((c) => c.id);
	expect(ids.indexOf("coord-1")).toBeLessThan(ids.indexOf("w-alpha"));
	expect(ids.indexOf("w-alpha")).toBeLessThan(ids.indexOf("solo"));
}, 60000);

test("two coordinators each get their own headquarters; a session others report to is a coordinator without the flag", async () => {
	await session("lead");
	await session("w-lead", { reportsTo: "lead", repository: "/repos/alpha" });
	await soon(() => expect(latest().headquarters.map((hq) => hq.id)).toEqual(["coord-1", "lead"]));
	expect(character("lead")).toMatchObject({
		role: "coordinator",
		place: { kind: "headquarters", headquarters: "lead" },
	});
	expect(character("w-lead")?.place).toEqual({ kind: "wing", headquarters: "lead", repository: "/repos/alpha" });
	expect(wings("coord-1")).toEqual(["alpha:1"]);
	expect(wings("lead")).toEqual(["alpha:1"]);
}, 30000);

test("a wing stays once seen, in first-seen order, boarded when its last agent stops, and is still there after the app restarts", async () => {
	const beta = await session("w-beta", { reportsTo: "coord-1", repository: "/repos/beta" });
	await session("w-gamma", { reportsTo: "coord-1", repository: "/repos/gamma" });
	await session("w-alpha-2", { reportsTo: "coord-1", repository: "/repos/alpha" });
	await soon(() => expect(wings("coord-1")).toEqual(["alpha:2", "beta:1", "gamma:1"]));
	await beta.stop();
	await soon(() => expect(wings("coord-1")).toEqual(["alpha:2", "beta:0", "gamma:1"]));
	// Remembered through the runtime, as a preference.
	await soon(() => {
		const [row] = query<{ value: string }>(state.dbPath, "select value from preferences where key = ?", PREFERENCE_KEY);
		expect(JSON.parse(row?.value ?? "{}").wings).toEqual({
			"coord-1": ["/repos/alpha", "/repos/beta", "/repos/gamma"],
			lead: ["/repos/alpha"],
		});
	});

	world.close();
	const restarted = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	try {
		await soon(() => expect(wings("coord-1", restarted.snapshot())).toEqual(["alpha:2", "beta:0", "gamma:1"]));
	} finally {
		restarted.close();
	}
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribe((snapshot) => updates.push(snapshot));
}, 60000);

// A scratch tmux server for panes, never the operator's: tempStateDir points TMUX_TMPDIR at its own directory.
const TMUX_NAME = `aw-${process.pid}`;
const tmux = (...args: string[]) =>
	execFileSync("tmux", ["-L", TMUX_NAME, "-f", "/dev/null", ...args], { encoding: "utf8", timeout: 5000 }).trim();
let tmuxSocket = "";
let client: ChildProcess | undefined;
const panes: string[] = [];
beforeAll(() => {
	mkdirSync(process.env.TMUX_TMPDIR!, { recursive: true });
	tmux("new-session", "-d", "-s", "home", "-x", "100", "-y", "30");
	tmux("new-session", "-d", "-s", "work", "-x", "100", "-y", "30");
	for (let i = 0; i < 9; i++) tmux("new-window", "-t", "work");
	tmux("split-window", "-t", "work:3");
	panes.push(...tmux("list-panes", "-s", "-t", "work", "-F", "#{pane_id}").split("\n"));
	tmuxSocket = tmux("display-message", "-p", "#{socket_path}");
});
afterAll(() => {
	client?.kill();
	try {
		tmux("kill-server");
	} catch {}
});

/** The next unused pane of the scratch server's `work` session, which no client shows until a test switches to it. */
const nextPane = () => panes.shift()!;

/** A live top-level session in a scratch pane, on a bridge speaking the socket protocol; `send` changes its state. */
async function agent(id: string, facts: Record<string, unknown> = {}, cwd = `/home/${id}`) {
	const stand = standInProcess();
	processes.push(stand);
	const pane = nextPane();
	const socket = createConnection(state.socketPath);
	await new Promise((resolve) => socket.once("connect", resolve));
	socket.on("error", () => {});
	const send = (message: unknown) => socket.write(`${JSON.stringify(message)}\n`);
	send({
		type: "hello",
		session: { id, kind: "root", cwd },
		process: { pid: stand.pid, startedAt: stand.startedAt },
		tmux: { socket: tmuxSocket, pane },
		run: "idle",
		facts: { config: { name: id, flags: [], activeTools: [], extensions: [], skills: [], mcpServers: [] }, ...facts },
	});
	heartbeats.push(setInterval(() => send({ type: "heartbeat" }), 1000));
	await soon(() => expect(character(id)).toBeDefined());
	return { pane, send };
}

test("each character carries the facts the views show: run state, tool, ledger task, git, cost, model, context, and pane", async () => {
	const bundle = join(state.agentDir, "ledger", "202610190000-invoice-retries");
	mkdirSync(bundle, { recursive: true });
	writeFileSync(
		join(bundle, "task.md"),
		"Status: in-progress\nCreated: 2026-10-19\n\n# Retry failed invoices\n\nBody.\n",
	);
	const { pane, send } = await agent("facts-1", {
		git: { repository: "/repos/billing", worktree: "/repos/billing-wt", branch: "retry" },
		currentTask: { bundle, taskId: "202610190000-invoice-retries" },
		model: "claude-opus",
		contextTokens: 52000,
		contextWindow: 200000,
		cost: 1.25,
	});
	send({ type: "run", run: "running_tool" });
	send({ type: "tool_start", tool: { id: "t1", name: "bash", arg: "npm test", since: 1_700_000_000_000 } });
	await soon(() => expect(character("facts-1")?.facts?.tool?.name).toBe("bash"));
	expect(character("facts-1")?.facts).toMatchObject({
		run: "running_tool",
		status: "working",
		asking: null,
		needsYouSince: null,
		unseen: false,
		tool: { name: "bash", arg: "npm test", since: 1_700_000_000_000 },
		task: { title: "Retry failed invoices", status: "in-progress", bundle },
		git: { repository: "/repos/billing", worktree: "/repos/billing-wt", branch: "retry" },
		cwd: "/home/facts-1",
		reportsTo: null,
		model: "claude-opus",
		contextTokens: 52000,
		contextWindow: 200000,
		cost: 1.25,
		tmux: { socket: realpathSync(tmuxSocket), pane },
	});
	// The runtime reads tmux once a second; then the pane's tmux session and window are known.
	await vi.waitFor(() => expect(character("facts-1")?.facts?.tmux?.session).toBe("work"), { timeout: 5000 });
	send({ type: "tool_end", id: "t1", name: "bash", durationMs: 5, isError: false, current: null });
	send({ type: "run", run: "idle" });
	await soon(() =>
		expect(character("facts-1")?.facts).toMatchObject({ run: "idle", status: "idle", tool: null, unseen: true }),
	);
}, 30000);

test("attention matches the tmux sidebar for the same sessions: asking, finished and unseen, working, idle and seen", async () => {
	const asking = await agent("att-asking");
	const finished = await agent("att-finished");
	const working = await agent("att-working");
	const seen = await agent("att-seen");
	for (const { send } of [finished, seen, asking]) {
		send({ type: "run", run: "thinking" });
		send({ type: "run", run: "idle" });
	}
	asking.send({
		type: "facts",
		facts: { prompt: { kind: "questionnaire", id: "q1", questions: [{ question: "Which branch?" }] } },
	});
	working.send({ type: "run", run: "writing_reply" });
	await soon(() => expect(character("att-seen")?.facts?.unseen).toBe(true));
	expect(await sendCommand(state.socketPath, "att-seen", { kind: "mark_seen" })).toContainEqual({ stage: "applied" });
	await soon(() => {
		expect(character("att-asking")?.facts).toMatchObject({
			status: "asking",
			asking: { kind: "questionnaire", text: "Which branch?" },
			unseen: false,
		});
		expect(character("att-asking")?.facts?.needsYouSince).toBeTypeOf("number");
		expect(character("att-finished")?.facts).toMatchObject({ status: "idle", unseen: true });
		expect(character("att-working")?.facts).toMatchObject({ status: "working", unseen: false, needsYouSince: null });
		expect(character("att-seen")?.facts).toMatchObject({ status: "idle", unseen: false, needsYouSince: null });
	});

	// The sidebar's own model, reading the same database for the same tmux server.
	const script = [
		"import json, sys",
		"sys.path.insert(0, 'components/tmux-sessions/sidebar')",
		"import model",
		"print(json.dumps({a.session_id: [a.status, a.unseen, a.needs_you] for a in model.live()}))",
	].join("\n");
	const sidebar = JSON.parse(
		execFileSync("python3", ["-c", script], {
			cwd: fileURLToPath(new URL("../../..", import.meta.url)),
			env: { ...process.env, TMUX: `${tmuxSocket},0,0` },
			encoding: "utf8",
			timeout: 10000,
		}),
	) as Record<string, [string, boolean, boolean]>;
	const SIDEBAR_STATUS = { asking: "waiting", working: "busy", idle: "idle" };
	const ours = Object.fromEntries(
		latest()
			.characters.filter((c) => c.facts?.tmux)
			.map((c) => [c.id, [SIDEBAR_STATUS[c.facts!.status], c.facts!.unseen, c.facts!.needsYouSince !== null]]),
	);
	expect(Object.keys(sidebar)).toHaveLength(5);
	expect(ours).toEqual(sidebar);
}, 30000);

test("runtime events reach the chatbox feed within a second: start, settle, question, mail, commands, stop", async () => {
	const lines: FeedLine[] = [];
	world.subscribeFeed((batch) => lines.push(...batch));
	const line = (match: RegExp) => lines.find((l) => l.character === "feed-1" && match.test(l.text));
	const within = (match: RegExp, kind: FeedKind) =>
		vi.waitFor(() => expect(line(match)?.kind).toBe(kind), { timeout: 1000 });

	const { send } = await agent("feed-1");
	await within(/^feed-1 started\.$/, "agents");
	send({ type: "run", run: "thinking" });
	send({ type: "run", run: "idle" });
	await within(/^feed-1 finished its turn\.$/, "agents");
	send({ type: "facts", facts: { prompt: { kind: "confirm", title: "Deploy now?" } } });
	await within(/^feed-1 asks: Deploy now\?$/, "agents");
	send({ type: "facts", facts: { prompt: null } });
	await within(/^feed-1's question was answered\.$/, "agents");

	const mail = sendCommand(state.socketPath, "feed-1", {
		kind: "mail",
		from: "att-working",
		body: "Rebase on main first.",
		sentAt: new Date().toISOString(),
	});
	await within(/^Mail from att-working to feed-1: Rebase on main first\.$/, "mail");
	await mail;
	void sendCommand(state.socketPath, "feed-1", { kind: "talk", text: "Run the tests." });
	await within(/^Message for feed-1: Run the tests\.$/, "commands");
	// The views' own bookkeeping is not news.
	await sendCommand(state.socketPath, "feed-1", { kind: "mark_seen" });

	send({ type: "shutdown", reason: "quit" });
	await within(/^feed-1 stopped \(quit\)\.$/, "agents");
	expect(lines.some((l) => /mark_seen|seen|preference/i.test(l.text))).toBe(false);
	// Each line once, in order; and the backlog a newly opened world starts with.
	expect(lines.map((l) => l.seq)).toEqual([...new Set(lines.map((l) => l.seq))].sort((a, b) => a - b));
	expect(world.feed().map((l) => l.text)).toEqual(expect.arrayContaining(lines.map((l) => l.text)));
}, 30000);

test("a command that fails says why in the feed", async () => {
	const lines: FeedLine[] = [];
	world.subscribeFeed((batch) => lines.push(...batch));
	await sendCommand(state.socketPath, "att-finished", { kind: "abort" });
	await sendCommand(state.socketPath, "feed-1", { kind: "steer", text: "Stop and rebase." });
	await vi.waitFor(
		() =>
			expect(lines.map((l) => l.text)).toEqual(
				expect.arrayContaining(["Redirect for feed-1: Stop and rebase.", "Redirect for feed-1 failed: not running."]),
			),
		{ timeout: 1000 },
	);
	expect(lines.find((l) => l.text === "Stop for att-finished.")?.kind).toBe("commands");
}, 30000);

/** Attach a client to the scratch server's `home` session through a pseudo-terminal, as a terminal app would. */
async function attachClient() {
	const script = [
		"import os, pty, sys",
		"pid, fd = pty.fork()",
		"if pid == 0:",
		`    os.execvp('tmux', ['tmux', '-L', '${TMUX_NAME}', 'attach', '-t', 'home'])`,
		"while True:",
		"    try:",
		"        os.read(fd, 65536)",
		"    except OSError:",
		"        break",
	].join("\n");
	client = spawn("python3", ["-c", script], { stdio: "ignore" });
	await vi.waitFor(() => expect(tmux("list-clients", "-F", "#{client_tty}")).not.toBe(""), { timeout: 5000 });
}
const clientPane = () => tmux("list-clients", "-F", "#{pane_id}");

test("Go to its terminal switches the operator's tmux client to the character's pane, which marks it seen", async () => {
	const { pane, send } = await agent("term-1");
	send({ type: "run", run: "thinking" });
	send({ type: "run", run: "idle" });
	await soon(() => expect(character("term-1")?.facts?.unseen).toBe(true));
	await attachClient();
	expect(clientPane()).not.toBe(pane);

	expect(await world.goToTerminal("term-1")).toEqual({ ok: true });
	expect(clientPane()).toBe(pane);
	expect(tmux("list-clients", "-F", "#{session_name}")).toBe("work");
	// The runtime sees a client showing the pane: every view agrees the operator saw it.
	await vi.waitFor(() => expect(character("term-1")?.facts?.unseen).toBe(false), { timeout: 5000 });

	expect(await world.goToTerminal("solo")).toEqual({ ok: false, reason: "solo is not running in tmux." });
	expect(await world.goToTerminal("nobody")).toEqual({ ok: false, reason: "No such character is awake." });
	expect(clientPane()).toBe(pane);
}, 30000);

test("Go to its terminal says so when no terminal shows that tmux server", async () => {
	client?.kill();
	await vi.waitFor(() => expect(tmux("list-clients", "-F", "#{client_tty}")).toBe(""), { timeout: 5000 });
	expect(await world.goToTerminal("term-1")).toEqual({
		ok: false,
		reason: "No terminal is attached to term-1's tmux server.",
	});
}, 30000);

test("the world shows it is disconnected while the runtime is gone and reconnects when it returns", async () => {
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 3000 });
	const pid = runtimePid(state.pidPath)!;
	process.kill(pid, "SIGTERM");
	await vi.waitFor(() => expect(latest().connected).toBe(false), { timeout: 3000 });
	await startRuntime(state.socketPath);
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 3000 });
}, 20000);
