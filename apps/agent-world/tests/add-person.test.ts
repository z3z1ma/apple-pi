import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import type { Commands } from "../src/backend/commands.js";
import { openLifecycle } from "../src/backend/lifecycle.js";
import type { WorldSnapshot } from "../src/world.js";

let directory: string;
let db: DatabaseSync;
let commands: Commands;
let lifecycle: ReturnType<typeof openLifecycle>;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "aw-add-person-"));
	const path = join(directory, "state.db");
	db = new DatabaseSync(path);
	migrate(db);
	db.prepare(`insert into sessions (id, kind, cwd, name, reports_to, role, manages, run_state, generation, source, updated_at)
		values ('head', 'root', ?, 'Ada', null, 'coordinator', 1, 'idle', 0, 'runtime', 1)`).run(directory);
	commands = {
		close() {},
		send: vi.fn<Commands["send"]>(async (_id, _command, options) => {
			options?.onReceipt?.("applied", undefined);
			return { ok: true };
		}),
	};
	const snapshot = {
		characters: [{ id: "head", name: "Ada", facts: { tmux: { socket: "/fake/tmux", pane: "%1" } } }],
	} as WorldSnapshot;
	lifecycle = openLifecycle({ db: path, agentDir: directory }, commands, () => snapshot);
});

afterEach(() => {
	vi.useRealTimers();
	db.close();
	rmSync(directory, { recursive: true, force: true });
});

function request() {
	return {
		name: "",
		cwd: directory,
		brief: "Build the agreed change.",
		reportsTo: "head",
		role: "implementation-engineer",
	};
}

test("an unnamed role hire starts with the selected role, manager and goal, without overriding its automatic name", async () => {
	const receipt = await lifecycle.recruit(request());
	expect(receipt).toMatchObject({ ok: true, stage: "applied", sessionId: expect.any(String) });
	const [id, command] = vi.mocked(commands.send).mock.calls[0];
	expect(receipt.sessionId).toBe(id);
	expect(command).toMatchObject({
		kind: "start",
		tmux: { socket: "/fake/tmux", pane: "%1" },
		cwd: directory,
		reportsTo: "head",
		role: "implementation-engineer",
		goal: { text: "Build the agreed change.", by: "operator" },
	});
	expect(command).not.toHaveProperty("name");
	expect(command).not.toHaveProperty("specialization");
});

test.each(["  Data correctness\nReview edge cases.  ", "  "])(
	"specialization is trimmed and blank text is omitted: %j",
	async (specialization) => {
		await lifecycle.recruit({ ...request(), specialization });
		const command = vi.mocked(commands.send).mock.calls[0][1];
		if (specialization.trim()) expect(command).toHaveProperty("specialization", specialization.trim());
		else expect(command).not.toHaveProperty("specialization");
	},
);

test("an old runtime refuses specialized creation before dispatch but still permits ordinary creation", async () => {
	db.exec("alter table sessions drop column specialization");
	expect(await lifecycle.recruit({ ...request(), specialization: "Data correctness" })).toMatchObject({
		ok: false,
		reason: expect.stringContaining("Restart the session runtime"),
	});
	expect(commands.send).not.toHaveBeenCalled();
	expect(await lifecycle.recruit({ ...request(), specialization: "  " })).toMatchObject({ ok: true });
	expect(vi.mocked(commands.send).mock.calls[0][1]).not.toHaveProperty("specialization");
});

test.each([undefined, "", "  \n "])("an unnamed role hire without a goal requests an idle start: %j", async (brief) => {
	const result = await lifecycle.recruit({ ...request(), brief, specialization: "Data correctness" });
	expect(result).toMatchObject({ ok: true, stage: "applied" });
	const command = vi.mocked(commands.send).mock.calls[0][1];
	expect(command).toMatchObject({
		kind: "start",
		role: "implementation-engineer",
		specialization: "Data correctness",
		prompt: "",
	});
	expect(command).not.toHaveProperty("goal");
	expect(command).not.toHaveProperty("name");
});

test("explicit names retain whitespace normalization", async () => {
	await lifecycle.recruit({ ...request(), name: "  Aida   Stone  " });
	expect(vi.mocked(commands.send).mock.calls[0][1]).toMatchObject({ name: "Aida Stone" });
});

test.each([
	[{ role: undefined }, "Give the new agent a name."],
	[{ role: "not-a-role" }, "No role in the catalog is named not-a-role."],
	[{ cwd: "" }, "Choose the directory it works in."],
])("invalid requests open no session: %j", async (change, reason) => {
	expect(await lifecycle.recruit({ ...request(), ...change })).toEqual({ ok: false, reason });
	expect(commands.send).not.toHaveBeenCalled();
});

test.each([
	["update sessions set manages = 0", "nonmanaging role"],
	["update sessions set retired_at = 1", "departed manager"],
	["update sessions set role = null, manages = null, reports_to = 'other'", "unroled report"],
	[
		"insert into events (source, session_id, type, data, at) values ('runtime', 'head', 'program_peer_created', '{}', 1)",
		"temporary manager",
	],
])("manager authority is read from runtime records: %s (%s)", async (sql) => {
	db.exec(sql);
	expect(await lifecycle.recruit(request())).toEqual({ ok: false, reason: "That person cannot manage new reports." });
	expect(commands.send).not.toHaveBeenCalled();
});

test("an unroled independent root retains ordinary management authority", async () => {
	db.exec("update sessions set role = null, manages = null");
	expect(await lifecycle.recruit(request())).toMatchObject({ ok: true, stage: "applied" });
});

test("accepted-only startup is pending rather than applied success", async () => {
	vi.useFakeTimers();
	commands.send = vi.fn<Commands["send"]>((_id, _command, options) => {
		options?.onReceipt?.("accepted", undefined);
		return new Promise(() => {});
	});
	const result = lifecycle.recruit(request());
	await vi.runOnlyPendingTimersAsync();
	expect(await result).toMatchObject({ ok: true, stage: "accepted", sessionId: expect.any(String) });
});
