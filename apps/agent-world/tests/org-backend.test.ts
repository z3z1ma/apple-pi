import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { syncChannels } from "../../../components/session-state/src/channels.js";
import type { Command } from "../../../components/session-state/src/protocol.js";
import { migrate } from "../../../components/session-state/src/schema.js";
import {
	markRead,
	messagesOf,
	participateIn,
	postToThread,
	threadsOf,
} from "../../../components/session-state/src/threads.js";
import type { Commands } from "../src/backend/commands.js";
import { openOrg } from "../src/backend/org.js";
import type { OrgStartProgress, OrgStartRequest } from "../src/org.js";

vi.mock("../src/backend/inn.js", () => ({ operatorPane: async () => undefined }));

let directory: string;
let db: DatabaseSync;
let org: ReturnType<typeof openOrg>;
let now: number;
let fail: Map<string, "failed" | "delivered">;
let sent: { person: string; command: Command; commandId: string }[];
let pushed: string[][];
let events: OrgStartProgress[];

function person(id: string, manager: string | null = null, awake = false, role: string | null = "coordinator") {
	db.prepare(`insert into sessions (id, kind, cwd, name, reports_to, role, manages, run_state, generation, source, updated_at)
		values (?, 'root', ?, ?, ?, ?, ?, 'idle', 0, 'runtime', ?)`).run(
		id,
		directory,
		id,
		manager,
		role,
		role === "coordinator" ? 1 : 0,
		now,
	);
	if (awake) connect(id);
}
function connect(id: string) {
	db.prepare("update sessions set generation = generation + 1 where id = ?").run(id);
	db.prepare(`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, source, updated_at)
		select id, generation, 123, ?, 'alive', ?, 'bridge', ? from sessions where id = ?`).run(now, now, now, id);
	syncChannels(db, now);
}
function plan(): OrgStartRequest {
	return {
		id: "plan",
		cwd: directory,
		goal: "Deliver the agreed change.",
		positions: [
			{
				id: "worker",
				manager: "head",
				role: "implementation-engineer",
				name: "Worker",
				goal: "Build the agreed change.",
			},
			{ id: "head", manager: null, role: "coordinator", name: "Head", goal: "Coordinate the change." },
		],
	};
}
function retry(request: OrgStartRequest, progress: OrgStartProgress): OrgStartRequest {
	return {
		...request,
		positions: request.positions.map((position) => ({
			...position,
			person: progress.people.find((member) => member.id === position.id)?.person,
		})),
	};
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "aw-org-backend-"));
	db = new DatabaseSync(join(directory, "state.db"));
	migrate(db);
	now = 100;
	fail = new Map();
	sent = [];
	pushed = [];
	events = [];
	person("seed");
	syncChannels(db, now);
	const commands: Commands = {
		close() {},
		async send(id, command, options = {}) {
			const commandId = options.commandId ?? `command-${sent.length}`;
			const previous = db.prepare("select stage, reason from commands where command_id = ?").get(commandId) as
				| { stage: string; reason: string | null }
				| undefined;
			if (previous)
				return previous.stage === "applied" ? { ok: true } : { ok: false, reason: previous.reason ?? "uncertain" };
			sent.push({ person: id, command, commandId });
			now++;
			db.prepare(
				"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values (?, ?, ?, ?, 'accepted', ?, ?)",
			).run(commandId, id, command.kind, JSON.stringify(command), now, now);
			let reason: string | undefined;
			let stage = "applied";
			if (command.kind === "start") {
				if (!db.prepare("select 1 from sessions where id = ?").get(id)) {
					person(id, command.reportsTo ?? null, false, command.role ?? null);
					db.prepare("update sessions set name = ?, manages = null where id = ?").run(command.name ?? id, id);
				}
				const name = (db.prepare("select name from sessions where id = ?").get(id) as { name: string }).name;
				stage = fail.get(name) ?? "applied";
				if (stage === "applied") {
					db.prepare("update sessions set manages = case when role = 'coordinator' then 1 else 0 end where id = ?").run(
						id,
					);
					connect(id);
				} else reason = stage === "failed" ? "injected start failure" : "connection lost after acceptance";
			} else if (command.kind === "organization_move") {
				if (fail.has(command.person)) {
					stage = "failed";
					reason = "injected move blocker";
				} else {
					db.prepare("update sessions set reports_to = ? where id = ?").run(command.manager, command.person);
					syncChannels(db, now);
				}
			} else if (command.kind === "channel_membership") {
				participateIn(db, command.thread, "operator", now, command.joined ? "pull" : null);
				db.prepare("update thread_participants set invited = 1 where thread_id = ? and participant = 'operator'").run(
					command.thread,
				);
			} else if (command.kind === "thread_post") {
				const result = postToThread(db, id, `message:${commandId}`, command, now);
				if (typeof result === "string") {
					reason = result;
					stage = "failed";
				} else pushed.push(result.push);
			}
			db.prepare("update commands set stage = ?, reason = ? where command_id = ?").run(
				stage,
				reason ?? null,
				commandId,
			);
			return stage === "applied" ? { ok: true } : { ok: false, reason: reason ?? "uncertain" };
		},
	};
	org = openOrg({ db: join(directory, "state.db"), agentDir: directory }, commands, () => ({
		connected: true,
		headquarters: [],
		characters: [],
	}));
	org.onOrgStart((progress) => events.push(progress));
});
afterEach(() => {
	db.close();
	rmSync(directory, { recursive: true, force: true });
});

test("prepares managers before reports with held prompts, joins without reading, and kicks off only the head once", async () => {
	const request = plan();
	const result = await org.orgStart(request);
	expect(result.complete).toBe(true);
	const head = result.people.find((member) => member.id === "head")!.person!;
	const worker = result.people.find((member) => member.id === "worker")!.person!;
	const starts = sent.filter((entry) => entry.command.kind === "start");
	expect(starts.map((entry) => entry.person)).toEqual([head, worker]);
	expect(starts[0]!.command).toMatchObject({
		prompt: "",
		role: "coordinator",
		goal: { by: "operator", text: "Coordinate the change." },
	});
	expect(starts[1]!.command).toMatchObject({ prompt: "", reportsTo: head });
	expect(messagesOf(db, result.kickoff!.thread)).toMatchObject([
		{ from: "operator", body: expect.stringContaining(request.goal) },
	]);
	expect(pushed).toEqual([[head]]);
	expect(events.some((event) => event.people.some((member) => member.state === "preparing"))).toBe(true);
	expect(threadsOf(db, "operator", false).find((thread) => thread.id === result.channel)?.unread).toBe(0);
	postToThread(db, head, "channel-seen", { thread: result.channel!, body: "Reviewed update." }, ++now);
	const seen = messagesOf(db, result.channel!).at(-1)!;
	markRead(db, result.channel!, "operator", seen.seq);
	postToThread(db, head, "channel-unread", { thread: result.channel!, body: "New update." }, ++now);
	const again = await org.orgStart(retry(request, result));
	expect(again.complete).toBe(true);
	expect(sent.filter((entry) => entry.command.kind === "start")).toHaveLength(2);
	expect(messagesOf(db, result.kickoff!.thread)).toHaveLength(1);
	expect(threadsOf(db, "operator", false).find((thread) => thread.id === result.channel)?.unread).toBe(1);
});

test("partial starts wait by default, explicit subset kicks off once, late readiness mentions only the head", async () => {
	fail.set("Worker", "failed");
	const request = plan();
	const partial = await org.orgStart(request);
	expect(partial.next).toBe("choose-ready");
	expect(partial.kickoff).toBeUndefined();
	const subset = await org.orgStart({ ...retry(request, partial), withReady: true });
	expect(subset.kickoff).toBeDefined();
	expect(subset.complete).toBe(false);
	fail.clear();
	const done = await org.orgStart(retry(request, subset));
	expect(done.complete).toBe(true);
	const head = done.people.find((member) => member.id === "head")!.person!;
	const worker = done.people.find((member) => member.id === "worker")!.person!;
	expect(done.readiness).toBeDefined();
	const readiness = messagesOf(db, done.channel!).at(-1)!;
	expect(readiness.body).toContain(`@${head}`);
	expect(readiness.body).toContain("1 implementation-engineer");
	expect(readiness.body).not.toContain(worker);
	expect(readiness.body).not.toContain("Worker");
	expect(pushed).toEqual([[head], [head]]);
	expect(
		sent.filter((entry) => entry.command.kind === "start" && entry.person === worker && "goal" in entry.command),
	).toHaveLength(1);
	db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values (?, ?, 'mail', ?, 'accepted', ?, ?)",
	).run(
		`${done.readiness!.commandId}:post:${head}`,
		head,
		JSON.stringify({ kind: "mail", from: "operator", body: readiness.body, sentAt: now }),
		now,
		now,
	);
	const repeated = await org.orgStart(retry(request, done));
	expect(repeated.complete).toBe(true);
	expect(messagesOf(db, done.channel!)).toHaveLength(1);
	expect(messagesOf(db, done.kickoff!.thread)).toHaveLength(1);
});

test("lost accepted starts stay uncertain and reconcile a later connection without a duplicate start or goal", async () => {
	fail.set("Head", "delivered");
	const request = plan();
	const first = await org.orgStart(request);
	expect(first.people.find((member) => member.id === "head")?.state).toBe("uncertain");
	expect(first.people.find((member) => member.id === "worker")?.state).toBe("blocked");
	const again = await org.orgStart(retry(request, first));
	expect(again.people.find((member) => member.id === "head")?.state).toBe("uncertain");
	expect(sent.filter((entry) => entry.command.kind === "start")).toHaveLength(1);
	const head = first.people.find((member) => member.id === "head")!.person!;
	db.prepare("update sessions set manages = 1 where id = ?").run(head);
	now++;
	connect(head);
	fail.clear();
	const final = await org.orgStart(retry(request, again));
	expect(final.complete).toBe(true);
	expect(sent.filter((entry) => entry.command.kind === "start" && entry.person === head)).toHaveLength(1);
});

test("obsolete runtime and invalid planned roles or cycles send no commands", async () => {
	db.prepare("delete from threads where id like 'organization:%'").run();
	const obsolete = await org.orgStart(plan());
	expect(obsolete.note).toContain("Restart the session runtime");
	expect(sent).toEqual([]);
	syncChannels(db, now);
	const unknown = plan();
	unknown.positions[0]!.role = "missing-role";
	expect((await org.orgStart(unknown)).note).toContain("catalog role");
	const cycle = plan();
	cycle.positions[0]!.role = "coordinator";
	cycle.positions[0]!.manager = "worker";
	expect((await org.orgStart(cycle)).note).toContain("cycle");
	expect(sent).toEqual([]);
});

test("existing active people are moved through runtime authority without starts or new assignments", async () => {
	person("existing-head", null, true);
	person("existing-worker", "seed", true, "implementation-engineer");
	db.prepare("update sessions set run_state = 'thinking' where id = 'existing-worker'").run();
	const request: OrgStartRequest = {
		id: "existing",
		cwd: directory,
		goal: "Continue existing work.",
		positions: [
			{ id: "head", person: "existing-head", manager: null },
			{ id: "worker", person: "existing-worker", manager: "head" },
		],
	};
	const result = await org.orgStart(request);
	expect(result.complete).toBe(true);
	expect(result.people.find((member) => member.id === "worker")?.state).toBe("active");
	expect(sent.filter((entry) => entry.command.kind === "start")).toEqual([]);
	expect(sent.find((entry) => entry.command.kind === "organization_move")).toMatchObject({
		person: "operator",
		command: { person: "existing-worker", manager: "existing-head", branch: ["existing-worker"] },
	});
});

test("unfinished assignments block planned boundary changes before any preparation", async () => {
	person("existing-worker", "seed", false, "implementation-engineer");
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread) values ('held', '/held', '/', 'seed', 1, 'task:held')",
	).run();
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at) values ('existing-worker', 'held', 'seed', 1)",
	).run();
	const request = plan();
	request.positions[0]!.person = "existing-worker";
	const result = await org.orgStart(request);
	expect(result.people.every((member) => member.state === "blocked")).toBe(true);
	expect(result.people[0]!.tasks).toEqual(["held"]);
	expect(sent).toEqual([]);
});

test("a proven stopped prepared person wakes under the same identity without another goal", async () => {
	const request = plan();
	const first = await org.orgStart(request);
	const worker = first.people.find((member) => member.id === "worker")!.person!;
	db.prepare("update incarnations set ended_at = ?, process_state = 'dead' where session_id = ?").run(++now, worker);
	const second = await org.orgStart(retry(request, first));
	expect(second.complete).toBe(true);
	const starts = sent.filter((entry) => entry.command.kind === "start" && entry.person === worker);
	expect(starts).toHaveLength(2);
	expect(starts[1]!.command).not.toHaveProperty("goal");
	expect(messagesOf(db, second.kickoff!.thread)).toHaveLength(1);
	expect(second.readiness).toBeUndefined();
	expect(messagesOf(db, second.channel!)).toEqual([]);
});

test("a live process with a lost bridge is uncertain, not at home or safe to start again", async () => {
	person("existing-head", null, true);
	db.prepare("update incarnations set process_state = 'alive_bridge_lost' where session_id = 'existing-head'").run();
	const request: OrgStartRequest = {
		id: "lost-bridge",
		cwd: directory,
		goal: "Continue the work.",
		positions: [{ id: "head", person: "existing-head", manager: null }],
	};
	const result = await org.orgStart(request);
	expect(result.people[0]).toMatchObject({ state: "uncertain", atHome: false });
	expect(sent).toEqual([]);
});

test("move forwards only the permitted command fields and returns runtime work blockers", async () => {
	const request = { person: "seed", manager: null, branch: ["seed"], kind: "retire", reason: "unexpected" };
	const result = await org.orgMove(request);
	expect(result).toEqual({ ok: true, person: "seed", manager: null, branch: ["seed"] });
	expect(sent[0]!.command).toEqual({ kind: "organization_move", person: "seed", manager: null, branch: ["seed"] });
	const refused = openOrg(
		{ db: join(directory, "state.db"), agentDir: directory },
		{
			close() {},
			send: async () => ({ ok: false, reason: "unfinished work would leave its organization: task-one, task-two" }),
		},
		() => ({ connected: true, headquarters: [], characters: [] }),
	);
	expect(await refused.orgMove(request)).toEqual({
		ok: false,
		reason: "unfinished work would leave its organization: task-one, task-two",
		tasks: ["task-one", "task-two"],
	});
});

test("nested pending assignment mail does not become a launch attempt or prevent retry", async () => {
	fail.set("Worker", "failed");
	const request = plan();
	const first = await org.orgStart(request);
	const worker = first.people.find((member) => member.id === "worker")!.person!;
	const attempt = sent.find((entry) => entry.person === worker && entry.command.kind === "start")!;
	db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values (?, ?, 'mail', ?, 'accepted', ?, ?)",
	).run(
		`${attempt.commandId}:post:${worker}`,
		worker,
		JSON.stringify({ kind: "mail", from: "operator", body: "Assignment context", sentAt: now }),
		now,
		now,
	);
	fail.clear();
	const second = await org.orgStart(retry(request, first));
	expect(second.complete).toBe(true);
	expect(second.people.find((member) => member.id === "worker")).toMatchObject({ person: worker, state: "ready" });
	const starts = sent.filter((entry) => entry.person === worker && entry.command.kind === "start");
	expect(starts).toHaveLength(2);
	expect(starts[1]!.command).not.toHaveProperty("goal");
});

test("only untouched preflight failures leave the draft editable", async () => {
	const request = plan();
	const invalid = await org.orgStart({ ...request, cwd: "/missing-org-directory" });
	expect(invalid.editable).toBe(true);
	fail.set("Worker", "failed");
	const partial = await org.orgStart(request);
	expect(partial.editable).toBe(false);
	const refused = await org.orgStart({ ...retry(request, partial), cwd: "/missing-org-directory" });
	expect(refused.editable).toBe(false);
});

test("a prepared person's goal cannot silently change on retry", async () => {
	fail.set("Worker", "failed");
	const request = plan();
	const partial = await org.orgStart(request);
	const before = sent.length;
	const changed = retry(request, partial);
	changed.positions[0]!.goal = "Different work";
	const result = await org.orgStart(changed);
	expect(result.note).toContain("cannot change on retry");
	expect(result.editable).toBe(false);
	expect(sent).toHaveLength(before);
});

test("an already-awake member that joins after subset kickoff gets one readiness notice", async () => {
	person("existing-head", null, true);
	person("existing-worker", "seed", true, "implementation-engineer");
	fail.set("existing-worker", "failed");
	const request: OrgStartRequest = {
		id: "late-existing",
		cwd: directory,
		goal: "Coordinate the existing people.",
		withReady: true,
		positions: [
			{ id: "head", person: "existing-head", manager: null },
			{ id: "worker", person: "existing-worker", manager: "head" },
		],
	};
	const partial = await org.orgStart(request);
	expect(partial.kickoff).toBeDefined();
	fail.clear();
	const done = await org.orgStart(request);
	expect(done.complete).toBe(true);
	expect(done.readiness).toBeDefined();
	expect(pushed).toEqual([["existing-head"], ["existing-head"]]);
	expect(messagesOf(db, done.channel!)[0]!.body).not.toContain("existing-worker");
	await org.orgStart(request);
	expect(messagesOf(db, done.channel!)).toHaveLength(1);
});

test("temporary identities cannot be staged as existing people", async () => {
	person("temporary", "seed", false, "implementation-engineer");
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (?, 'runtime', 'temporary', 'program_peer_created', '{}')",
	).run(now);
	const request = plan();
	request.positions[0]!.person = "temporary";
	const result = await org.orgStart(request);
	expect(result.note).toContain("Temporary or departed");
	expect(sent).toEqual([]);
});
