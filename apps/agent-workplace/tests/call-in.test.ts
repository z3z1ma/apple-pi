import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Command } from "../../../components/session-state/src/protocol.js";
import { migrate } from "../../../components/session-state/src/schema.js";
import type { Commands } from "../src/backend/commands.js";
import { openLifecycle } from "../src/backend/lifecycle.js";
import { type CallInRequest, isCallInRequest } from "../src/call-in.js";

const pane = vi.hoisted(() => vi.fn());
vi.mock("../src/backend/inn.js", () => ({ operatorPane: pane }));
let directory: string;
let db: DatabaseSync;
let lifecycle: ReturnType<typeof openLifecycle>;
let commands: Commands;
let sent: { person: string; command: Command; commandId: string }[];
let modes: Map<string, "failed" | "accepted" | "delivered" | "unjoined" | "unrecorded">;
let afterStart: (id: string) => void;
let clock: number;
const request = (): CallInRequest => ({ id: "request", person: "leaf", expected: ["leaf", "manager", "head"] });
const restart = () =>
	openLifecycle({ db: join(directory, "state.db"), agentDir: directory }, commands, () => ({
		connected: true,
		characters: [],
		headquarters: [],
	}));
function person(id: string, manager: string | null, connected = false) {
	db.prepare(`insert into sessions (id, kind, cwd, name, reports_to, role, run_state, generation, source, updated_at)
		values (?, 'root', ?, ?, ?, 'implementation-engineer', 'idle', 0, 'runtime', ?)`).run(
		id,
		directory,
		id,
		manager,
		clock,
	);
	if (connected) connect(id);
}
function connect(id: string) {
	db.prepare("update sessions set generation = generation + 1 where id = ?").run(id);
	db.prepare(`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, source, updated_at)
		select id, generation, 123, ?, 'alive', ?, 'bridge', ? from sessions where id = ?`).run(clock, clock, clock, id);
}
function record(id: string, commandId: string, stage: string) {
	db.prepare(`insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at)
		values (?, ?, 'start', '{"kind":"start"}', ?, ?, ?)`).run(commandId, id, stage, ++clock, clock);
}
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "aw-call-in-"));
	db = new DatabaseSync(join(directory, "state.db"));
	migrate(db);
	clock = 100;
	sent = [];
	modes = new Map();
	afterStart = () => {};
	pane.mockReset().mockResolvedValue({ socket: "/fixture/tmux", pane: "%1" });
	person("head", null);
	person("manager", "head");
	person("leaf", "manager");
	person("report", "leaf");
	commands = {
		close() {},
		async send(id, command, options = {}) {
			const commandId = options.commandId ?? `ordinary-${sent.length}`;
			sent.push({ person: id, command, commandId });
			const mode = modes.get(id);
			if (mode === "unrecorded") return { ok: false, reason: "Connection outcome unknown" };
			record(id, commandId, "accepted");
			options.onReceipt?.("accepted");
			if (mode === "accepted" || mode === "delivered") {
				db.prepare("update commands set stage = ? where command_id = ?").run(mode, commandId);
				options.onReceipt?.(mode);
				return new Promise(() => {});
			}
			if (mode === "failed") {
				db.prepare("update commands set stage = 'failed', reason = 'Launch refused' where command_id = ?").run(
					commandId,
				);
				return { ok: false, reason: "Launch refused" };
			}
			if (mode !== "unjoined") connect(id);
			afterStart(id);
			db.prepare("update commands set stage = 'applied' where command_id = ?").run(commandId);
			return { ok: true };
		},
	};
	lifecycle = restart();
});
afterEach(() => {
	vi.useRealTimers();
	db.close();
	rmSync(directory, { recursive: true, force: true });
});

test("calls only the confirmed upward chain, highest first, preserving ordinary wake payloads", async () => {
	afterStart = (id) => {
		if (id === "leaf") db.prepare("update sessions set run_state = 'thinking' where id = ?").run(id);
	};
	const result = await lifecycle.callIn(request());
	expect(result.ok).toBe(true);
	expect(result.people.map(({ person, state, stage }) => ({ person, state, stage }))).toEqual([
		{ person: "head", state: "ready", stage: "applied" },
		{ person: "manager", state: "ready", stage: "applied" },
		{ person: "leaf", state: "active", stage: "applied" },
	]);
	expect(sent.map((start) => start.person)).toEqual(["head", "manager", "leaf"]);
	for (const start of sent)
		expect(start.command).toEqual({ kind: "start", tmux: { socket: "/fixture/tmux", pane: "%1" } });
	expect(await restart().callIn(request())).toEqual(result);
	expect(sent).toHaveLength(3);
	expect(db.prepare("select count(*) as count from work_tasks").get()).toMatchObject({ count: 0 });
});

test("a singleton call-in and ancestors that became awake need no extra starts", async () => {
	connect("head");
	connect("manager");
	expect((await lifecycle.callIn({ ...request(), expected: ["leaf"] })).ok).toBe(true);
	expect(sent.map((start) => start.person)).toEqual(["leaf"]);
	pane.mockResolvedValue(undefined);
	expect((await restart().callIn(request())).ok).toBe(true);
	expect(sent).toHaveLength(1);
});

test.each(["unapproved", "stale", "missing", "former", "temporary", "cycle"])(
	"refuses %s ancestry before any start",
	async (kind) => {
		const input = request();
		if (kind === "unapproved") input.expected = ["leaf"];
		if (kind === "stale") input.expected.push("report");
		if (kind === "missing") db.prepare("update sessions set reports_to = 'missing' where id = 'head'").run();
		if (kind === "former") db.prepare("update sessions set retired_at = 1 where id = 'head'").run();
		if (kind === "temporary")
			db.prepare(
				"insert into events (at, source, session_id, type, data) values (1, 'runtime', 'manager', 'program_peer_created', '{}')",
			).run();
		if (kind === "cycle") db.prepare("update sessions set reports_to = 'leaf' where id = 'head'").run();
		expect(await lifecycle.callIn(input)).toMatchObject({ ok: false, reason: expect.any(String) });
		expect(sent).toEqual([]);
	},
);

test("a bridge-lost ancestor is uncertain rather than a sleeping person to duplicate", async () => {
	connect("head");
	db.prepare("update incarnations set process_state = 'alive_bridge_lost' where session_id = 'head'").run();
	const result = await lifecycle.callIn(request());
	expect(result.ok).toBe(false);
	expect(result.people[0]).toMatchObject({
		person: "head",
		state: "uncertain",
		reason: expect.stringContaining("bridge"),
	});
	expect(sent).toEqual([]);
});

test("no attached tmux refuses before starts and a stale preview is rechecked after locating the pane", async () => {
	pane.mockResolvedValue(undefined);
	expect(await lifecycle.callIn(request())).toMatchObject({ ok: false, reason: expect.stringContaining("tmux") });
	pane.mockImplementation(async () => {
		person("other", null);
		db.prepare("update sessions set reports_to = 'other' where id = 'head'").run();
		return { socket: "/fixture/tmux", pane: "%1" };
	});
	expect(await lifecycle.callIn(request())).toMatchObject({ ok: false, reason: expect.stringContaining("preview") });
	expect(sent).toEqual([]);
});

test("partial failure retains joined people and retries only the failed/dependent people after controller recreation", async () => {
	modes.set("manager", "failed");
	const failed = await lifecycle.callIn(request());
	expect(failed.ok).toBe(false);
	expect(failed.people.map((person) => person.state)).toEqual(["ready", "failed", "blocked"]);
	expect(sent.map((start) => start.person)).toEqual(["head", "manager"]);
	modes.delete("manager");
	const retried = await restart().callIn(request());
	expect(retried.ok).toBe(true);
	expect(sent.map((start) => start.person)).toEqual(["head", "manager", "manager", "leaf"]);
	expect(retried.people[0].commandId).toBe(failed.people[0].commandId);
	expect(retried.people[1].commandId).not.toBe(failed.people[1].commandId);
});

test.each(["accepted", "delivered"] as const)(
	"%s receipt is uncertain and blocks reports without retrying an unresolved start",
	async (stage) => {
		vi.useFakeTimers();
		modes.set("head", stage);
		const pending = lifecycle.callIn(request());
		await vi.advanceTimersByTimeAsync(30_000);
		const result = await pending;
		expect(result.ok).toBe(false);
		expect(result.people[0]).toMatchObject({ state: "uncertain", stage });
		expect(result.people.slice(1).map((person) => person.state)).toEqual(["blocked", "blocked"]);
		expect((await restart().callIn(request())).people[0]).toMatchObject({ state: "uncertain", stage });
		expect(sent).toHaveLength(1);
		connect("head");
		db.prepare("update commands set stage = 'applied' where session_id = 'head'").run();
		modes.delete("head");
		expect((await restart().callIn(request())).ok).toBe(true);
		expect(sent.map((start) => start.person)).toEqual(["head", "manager", "leaf"]);
	},
);

test("applied without a visible joined incarnation is uncertain, not ready", async () => {
	modes.set("head", "unjoined");
	const result = await lifecycle.callIn(request());
	expect(result.people[0]).toMatchObject({ state: "uncertain", stage: "applied" });
	expect(result.ok).toBe(false);
	expect((await restart().callIn(request())).ok).toBe(false);
	expect(sent).toHaveLength(1);
});

test("reporting changes after an applied ancestor retain its receipt but stop remaining starts", async () => {
	person("other", null, true);
	afterStart = (id) => {
		if (id === "head") db.prepare("update sessions set reports_to = 'other' where id = 'leaf'").run();
	};
	const result = await lifecycle.callIn(request());
	expect(result.ok).toBe(false);
	expect(result.people[0]).toMatchObject({ state: "ready", stage: "applied", commandId: expect.any(String) });
	expect(sent.map((start) => start.person)).toEqual(["head"]);
});

test("an outcome lost before journal evidence retries the same command identity", async () => {
	modes.set("head", "unrecorded");
	const first = await lifecycle.callIn(request());
	expect(first.people[0].state).toBe("uncertain");
	modes.delete("head");
	expect((await restart().callIn(request())).ok).toBe(true);
	expect(sent[0].commandId).toBe(sent[1].commandId);
});

test("a completed operation does not reopen someone who subsequently went home", async () => {
	await lifecycle.callIn(request());
	db.prepare("update incarnations set ended_at = 200, process_state = 'exited' where session_id = 'leaf'").run();
	const result = await restart().callIn(request());
	expect(result.people.at(-1)).toMatchObject({ state: "uncertain", reason: expect.stringContaining("new call-in") });
	expect(sent).toHaveLength(3);
	expect((await restart().callIn({ ...request(), id: "another-explicit-action" })).ok).toBe(true);
	expect(sent).toHaveLength(4);
});

test("in-flight identical requests coalesce; changed consent under the same id is refused", async () => {
	let release!: (value: { socket: string; pane: string }) => void;
	pane.mockImplementation(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const first = lifecycle.callIn(request());
	const repeated = lifecycle.callIn(request());
	expect(repeated).toBe(first);
	expect(await lifecycle.callIn({ ...request(), expected: ["leaf"] })).toMatchObject({ ok: false });
	release({ socket: "/fixture/tmux", pane: "%1" });
	expect((await first).ok).toBe(true);
	expect(sent).toHaveLength(3);
});

test("awake intermediate managers do not cut off the absent ancestors above them", async () => {
	connect("manager");
	const result = await lifecycle.callIn({ ...request(), expected: ["head", "leaf"] });
	expect(result.ok).toBe(true);
	expect(sent.map((start) => start.person)).toEqual(["head", "leaf"]);
});

test("an ancestor that stops during the final launch is reported uncertain, with its applied receipt retained", async () => {
	afterStart = (id) => {
		if (id === "leaf")
			db.prepare("update incarnations set ended_at = 200, process_state = 'exited' where session_id = 'head'").run();
	};
	const result = await lifecycle.callIn(request());
	expect(result.ok).toBe(false);
	expect(result.people[0]).toMatchObject({ person: "head", state: "uncertain", stage: "applied" });
	expect(result.people.at(-1)).toMatchObject({ person: "leaf", state: "ready", stage: "applied" });
	expect(sent.map((start) => start.person)).toEqual(["head", "manager", "leaf"]);
});

test("the original World wake still opens only its selected sleeper", async () => {
	const worldLifecycle = openLifecycle({ db: join(directory, "state.db"), agentDir: directory }, commands, () => ({
		connected: true,
		characters: [],
		headquarters: [],
		dormant: [
			{
				id: "leaf",
				name: "Leaf",
				role: "worker",
				reportsTo: "manager",
				repository: null,
				cwd: directory,
				task: null,
				stoppedAt: null,
				stopReason: null,
				startedAt: 1,
			},
		],
	}));
	expect(await worldLifecycle.wake("leaf")).toEqual({ ok: true, stage: "applied" });
	expect(sent.map((start) => start.person)).toEqual(["leaf"]);
	expect(sent[0].command).toEqual({
		kind: "start",
		tmux: { socket: "/fixture/tmux", pane: "%1" },
		reportsTo: "manager",
	});
});

test("request guards require explicit unique consent including the selected person", () => {
	expect(isCallInRequest(request())).toBe(true);
	for (const value of [
		null,
		{},
		{ ...request(), id: "" },
		{ ...request(), expected: [] },
		{ ...request(), expected: ["head"] },
		{ ...request(), expected: ["leaf", "leaf"] },
		{ ...request(), expected: ["leaf", 3] },
	])
		expect(isCallInRequest(value)).toBe(false);
});
