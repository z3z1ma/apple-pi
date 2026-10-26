import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/bridge.js";
import { membership, realizedFitness } from "../src/fitness.js";
import { statePaths } from "../src/paths.js";
import { discardProgramPeople, temporaryCallers } from "../src/program-peers.js";
import type { Command, Hello } from "../src/protocol.js";
import { Runtime } from "../src/runtime.js";
import { migrate } from "../src/schema.js";
import { participateIn, postToThread } from "../src/threads.js";
import { changeWork } from "../src/work.js";
import { close, tempStateDir } from "./helpers.js";

const HOUR = 3_600_000;
afterEach(() => vi.restoreAllMocks());

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-peer-history-"));
	const db = new DatabaseSync(join(dir, "state.db"));
	migrate(db);
	const clock = vi.spyOn(Date, "now").mockReturnValue(0);
	const person = (id: string, manager: string | null) =>
		db
			.prepare(
				"insert into sessions (id, kind, cwd, run_state, generation, reports_to, source, updated_at) values (?, 'root', ?, 'idle', 1, ?, 'test', 0)",
			)
			.run(id, dir, manager);
	person("root", null);
	person("caller", "root");
	person("dev", "root");
	const program = {
		id: "program",
		caller: "caller",
		created: new Set<string>(),
		discarded: new Set<string>(),
		closing: false,
	};
	const scopes = new Map([[program.id, { program }]]);
	const runtime = Object.assign(Object.create(Runtime.prototype), {
		db,
		starting: new Set(),
		discarding: new Set(),
		programs: scopes,
		applyWork: vi.fn(() => false),
		launchSession: vi.fn(),
		setCommandStage: vi.fn(),
	}) as {
		startSession: (
			commandId: string,
			id: string,
			command: Extract<Command, { kind: "start" }>,
			scope?: typeof program,
		) => Promise<unknown>;
		applyFacts: (id: string, generation: number, facts: { cost: number }, hello?: boolean) => void;
		applyWork: ReturnType<typeof vi.fn>;
		launchSession: ReturnType<typeof vi.fn>;
		setCommandStage: ReturnType<typeof vi.fn>;
	};
	const event = (at: number, id: string, type: string, data: unknown = {}) =>
		db
			.prepare("insert into events (at, source, session_id, type, data) values (?, 'test', ?, ?, ?)")
			.run(at, id, type, JSON.stringify(data));
	const start = async (id: string, caller = "caller") => {
		const scope = { ...program, caller };
		await runtime.startSession(
			`start-${id}`,
			id,
			{ kind: "start", role: "implementation-engineer", goal: { by: caller, text: "Work on the caller's task." } },
			scope,
		);
	};
	const peer = async (id: string, caller = "caller") => {
		await start(id, caller);
		person(id, caller);
	};
	const move = (id: string, manager: string, at: number) => {
		const before = db.prepare("select reports_to from sessions where id = ?").get(id) as { reports_to: string | null };
		db.prepare("update sessions set reports_to = ? where id = ?").run(manager, id);
		event(at, id, "transferred", { from: before.reports_to, to: manager, by: "root" });
	};
	const task = (id: string, holders: string[], ephemeral = false) => {
		const bundle = join(dir, "tasks", id);
		mkdirSync(bundle, { recursive: true });
		writeFileSync(join(bundle, "task.md"), "Status: in-progress\nValue: $0\nCost of delay: $5/hour\n# Work\n");
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values (?, ?, ?, 'root', ?, ?, 0)",
		).run(id, bundle, dir, Number(ephemeral), `task:${id}`);
		db.prepare(
			"insert into threads (id, kind, subject, created_by, created_at) values (?, 'task', ?, 'caller', 0)",
		).run(`task:${id}`, id);
		for (const holder of holders) {
			db.prepare("insert into assignments (task_id, person, assigned_by, assigned_at) values (?, ?, 'caller', 0)").run(
				id,
				holder,
			);
			participateIn(db, `task:${id}`, holder, 0, "push");
		}
		return bundle;
	};
	const mail = (id: string, at: number, kind: "mail" | "escalation" = "mail") => {
		const thread = `operator-${id}-${at}`;
		db.prepare(
			"insert into threads (id, kind, subject, created_by, created_at) values (?, ?, 'Needs operator', ?, ?)",
		).run(thread, kind, id, at);
		participateIn(db, thread, id, at, "push");
		participateIn(db, thread, "operator", at, "pull");
		expect(postToThread(db, id, `${thread}:message`, { thread, body: "Please decide." }, at)).not.toBeTypeOf("string");
	};
	return { db, dir, person, clock, runtime, event, start, peer, move, task, mail, program, scopes };
}

async function nativeHistory() {
	const state = tempStateDir();
	vi.stubEnv("PI_PROGRAM_ID", "");
	vi.stubEnv("PI_PROGRAM_PARENT", "");
	const runtime = new Runtime(statePaths());
	expect(await runtime.start()).toBe(true);
	const host = runtime as unknown as {
		db: DatabaseSync;
		hello: (connection: unknown, message: Hello) => void;
		programs: Map<
			string,
			{ program: { id: string; caller: string; closing: boolean; created: Set<string>; discarded: Set<string> } }
		>;
	};
	const person = (id: string, parent: string | null) =>
		host.db
			.prepare(
				"insert into sessions (id, kind, cwd, run_state, generation, reports_to, source, updated_at) values (?, 'root', ?, 'idle', 1, ?, 'test', 0)",
			)
			.run(id, state.agentDir, parent);
	person("caller", null);
	const seedPeer = (id: string) => {
		person(id, "caller");
		host.db
			.prepare(
				"insert into program_peers (session_id, program_id, created_by, task_id) values (?, 'program', 'caller', 'absent')",
			)
			.run(id);
		host.db
			.prepare(
				"insert into events (at, source, session_id, type, data) values (0, 'runtime', ?, 'program_peer_created', ?)",
			)
			.run(id, JSON.stringify({ caller: "caller" }));
		host.db
			.prepare("insert into events (at, source, session_id, type, data) values (0, 'runtime', ?, 'cost_changed', ?)")
			.run(id, JSON.stringify({ from: 0, to: 0, initial: true }));
	};
	return { state, runtime, host, seedPeer };
}

test.each([false, true])(
	"bridge resume of a retained temporary transcript is rejected before state writes with missing/stale program flags (flagged=%s)",
	async (flagged) => {
		const { state, runtime, host, seedPeer } = await nativeHistory();
		let run: Awaited<ReturnType<typeof fauxSession>> | undefined;
		try {
			const id = randomUUID();
			seedPeer(id);
			const transcript = SessionManager.create(state.agentDir, join(state.agentDir, "transcripts"), { id });
			transcript.appendMessage(fauxAssistantMessage("Retained temporary history."));
			discardProgramPeople(host.db, state.stateDir, new Set([id]), 1);
			const before = host.db.prepare("select count(*) as n from events where session_id = ?").get(id);
			const sent: unknown[] = [];
			const receive = host.hello.bind(runtime);
			const hello = vi.spyOn(host, "hello").mockImplementation((connection, message) => {
				const socket = (connection as { socket: { write: (line: string) => boolean } }).socket;
				const write = socket.write.bind(socket);
				vi.spyOn(socket, "write").mockImplementation((line) => {
					sent.push(JSON.parse(line));
					return write(line);
				});
				receive(connection, message);
			});
			if (flagged) {
				vi.stubEnv("PI_PROGRAM_ID", "program");
				vi.stubEnv("PI_PROGRAM_PARENT", "caller");
			}
			const resumed = SessionManager.open(transcript.getSessionFile()!);
			expect(resumed.getSessionId()).toBe(id);
			run = await fauxSession([bridge], [], [], { cwd: state.agentDir, sessionManager: resumed });
			await vi.waitFor(() => expect(hello).toHaveBeenCalled(), { timeout: 5000 });
			if (flagged) expect(hello.mock.calls[0]![1].session.program).toEqual({ id: "program", parent: "caller" });
			else expect(hello.mock.calls[0]![1].session.program).toBeUndefined();
			expect(sent).toContainEqual(
				expect.objectContaining({ type: "command", sessionId: id, command: { kind: "close" } }),
			);
			expect(host.db.prepare("select 1 from sessions where id = ?").get(id)).toBeUndefined();
			expect(host.db.prepare("select 1 from incarnations where session_id = ?").get(id)).toBeUndefined();
			expect(host.db.prepare("select count(*) as n from events where session_id = ?").get(id)).toEqual(before);
			expect(realizedFitness(host.db, "caller", 0, Date.now()).compute).toBe(0);
		} finally {
			if (run) await close(run);
			runtime.stop();
			vi.unstubAllEnvs();
			rmSync(state.agentDir, { recursive: true, force: true });
		}
	},
);

test.each([false, true])(
	"real bridge admits ordinary new IDs and valid live program first hello/reconnect (program=%s)",
	async (temporary) => {
		const { state, runtime, host, seedPeer } = await nativeHistory();
		let run: Awaited<ReturnType<typeof fauxSession>> | undefined;
		try {
			const id = randomUUID();
			if (temporary) {
				seedPeer(id);
				host.programs.set("program", {
					program: { id: "program", caller: "caller", closing: false, created: new Set([id]), discarded: new Set() },
				});
				vi.stubEnv("PI_PROGRAM_ID", "program");
				vi.stubEnv("PI_PROGRAM_PARENT", "caller");
			}
			const hello = vi.spyOn(host, "hello");
			const sessionManager = SessionManager.create(state.agentDir, join(state.agentDir, "transcripts"), { id });
			const reply = fauxAssistantMessage("Measured work.");
			reply.usage.cost.total = 3;
			run = await fauxSession([bridge], [reply], [], { cwd: state.agentDir, sessionManager });
			const onError = vi.fn();
			await run.session.bindExtensions({ onError });
			await vi.waitFor(
				() =>
					expect(host.db.prepare("select generation from incarnations where session_id = ?").get(id)).toEqual({
						generation: 1,
					}),
				{ timeout: 5000 },
			);
			await run.session.prompt("Perform the work.");
			await vi.waitFor(() =>
				expect(host.db.prepare("select cost from sessions where id = ?").get(id)).toEqual({ cost: 3 }),
			);
			const before = realizedFitness(host.db, temporary ? "caller" : id, 0, Date.now());
			expect(before.compute).toBe(3);
			const priorHellos = hello.mock.calls.length;
			await run.session.reload();
			await vi.waitFor(() => expect(hello.mock.calls.length).toBeGreaterThan(priorHellos), { timeout: 5000 });
			expect(host.db.prepare("select generation from incarnations where session_id = ?").all(id)).toEqual([
				{ generation: 1 },
			]);
			expect(host.db.prepare("select cost from sessions where id = ?").get(id)).toEqual({ cost: 3 });
			expect(realizedFitness(host.db, temporary ? "caller" : id, 0, Date.now()).compute).toBe(3);
			expect(onError).not.toHaveBeenCalled();
		} finally {
			if (run) await close(run);
			runtime.stop();
			vi.unstubAllEnvs();
			rmSync(state.agentDir, { recursive: true, force: true });
		}
	},
);

test.each(["program_peer_created", "cost_changed"])(
	"new launch ownership and identity/baseline roll back together on %s failure before work or launch",
	async (type) => {
		const { db, start, runtime } = fixture();
		db.exec(
			`create trigger fail_identity before insert on events when new.type = '${type}' begin select raise(abort, 'identity failure'); end`,
		);
		await expect(start("peer")).rejects.toThrow("identity failure");
		expect(db.prepare("select * from program_peers").all()).toEqual([]);
		expect(db.prepare("select * from events where session_id = 'peer'").all()).toEqual([]);
		expect(db.isTransaction).toBe(false);
		expect(runtime.applyWork).not.toHaveBeenCalled();
		expect(runtime.launchSession).not.toHaveBeenCalled();
		db.exec("drop trigger fail_identity");
		await start("peer");
		expect(temporaryCallers(db).get("peer")).toBe("caller");
		expect(db.prepare("select id from sessions where id = 'peer'").get()).toBeUndefined();
		expect(runtime.applyWork).toHaveBeenCalledOnce();
	},
);

test.each([false, true])(
	"new identity zero baseline counts the first positive hello, including after a zero hello (%s)",
	async (zeroHello) => {
		const { db, dir, peer, runtime, clock } = fixture();
		await peer("peer");
		if (zeroHello) runtime.applyFacts("peer", 1, { cost: 0 }, true);
		clock.mockReturnValue(HOUR);
		runtime.applyFacts("peer", 1, { cost: 3 }, true);
		const before = realizedFitness(db, "root", 0, 2 * HOUR);
		expect(before).toMatchObject({
			compute: 3,
			contributions: [expect.objectContaining({ source: "person:caller", compute: 3 })],
		});
		expect(
			JSON.parse(
				(
					db
						.prepare(
							"select data from events where session_id = 'peer' and type = 'cost_changed' order by seq desc limit 1",
						)
						.get() as { data: string }
				).data,
			),
		).toEqual({ from: 0, to: 3 });
		discardProgramPeople(db, dir, new Set(["peer"]), 2 * HOUR);
		expect(realizedFitness(db, "root", 0, 2 * HOUR)).toEqual(before);
	},
);

test("ordinary and observed legacy peers keep first-sight transcript baselines, not invented zero spend", () => {
	const { db, person, runtime, clock } = fixture();
	person("legacy", "caller");
	db.prepare(
		"insert into program_peers (session_id, program_id, created_by, task_id) values ('legacy', 'old', 'caller', 'old-task')",
	).run();
	clock.mockReturnValue(HOUR);
	runtime.applyFacts("legacy", 1, { cost: 12 }, true);
	runtime.applyFacts("dev", 1, { cost: 12 }, true);
	expect(realizedFitness(db, "root", 0, 2 * HOUR).compute).toBe(0);
	runtime.applyFacts("legacy", 1, { cost: 15 }, true);
	runtime.applyFacts("dev", 1, { cost: 14 }, true);
	expect(realizedFitness(db, "root", 0, 2 * HOUR).compute).toBe(5);
});

test("nested peer spend follows immutable callers once, independent of reporting transfers and disposal", async () => {
	const { db, dir, peer, move, event } = fixture();
	await peer("parent");
	await peer("child", "parent");
	move("parent", "dev", HOUR / 2);
	move("child", "root", HOUR / 2);
	event(HOUR, "parent", "cost_changed", { from: 0, to: 2 });
	event(HOUR, "child", "cost_changed", { from: 0, to: 3 });
	const before = realizedFitness(db, "root", 0, 2 * HOUR);
	expect(before).toMatchObject({
		compute: 5,
		contributions: [expect.objectContaining({ source: "person:caller", compute: 5 })],
	});
	expect(membership(db, "root").memberAt("child", HOUR)).toBe(false);
	expect(realizedFitness(db, "root", 0, HOUR).compute + realizedFitness(db, "root", HOUR, 2 * HOUR).compute).toBe(
		before.compute,
	);
	discardProgramPeople(db, dir, new Set(["parent", "child"]), 2 * HOUR);
	expect(realizedFitness(db, "root", 0, 2 * HOUR)).toEqual(before);
	expect(temporaryCallers(db).get("child")).toBe("parent");
});

test("caller membership at each observation excludes pre-join peer spend and operator demands", async () => {
	const { db, dir, peer, event, move, mail } = fixture();
	db.prepare("update sessions set reports_to = null where id = 'caller'").run();
	await peer("peer");
	event(HOUR / 2, "peer", "cost_changed", { from: 0, to: 2 });
	event(HOUR / 2, "peer", "prompt_opened");
	mail("peer", HOUR / 2);
	move("caller", "root", HOUR);
	event(1.5 * HOUR, "peer", "cost_changed", { from: 2, to: 5 });
	event(1.5 * HOUR, "peer", "prompt_opened");
	mail("peer", 1.5 * HOUR, "escalation");
	const before = realizedFitness(db, "root", 0, 2 * HOUR);
	expect(before).toMatchObject({ compute: 3, interruptions: 2 });
	expect(realizedFitness(db, "root", 0, HOUR)).toMatchObject({ compute: 0, interruptions: 0 });
	discardProgramPeople(db, dir, new Set(["peer"]), 2 * HOUR);
	expect(realizedFitness(db, "root", 0, 2 * HOUR)).toEqual(before);
	expect(db.prepare("select count(*) as n from thread_messages").get()).toEqual({ n: 2 });
});

test("lasting report compute and retained task state/post history survive reparenting and assignment ending", async () => {
	const { db, dir, peer, move, event, task } = fixture();
	await peer("peer");
	move("dev", "peer", HOUR / 4);
	task("retained", ["peer"]);
	db.exec("begin");
	const changed = changeWork(
		db,
		dir,
		"focus",
		"peer",
		{ kind: "work", action: "focus", task: "retained", cwd: dir },
		HOUR / 2,
		[],
		[],
	);
	expect(postToThread(db, "peer", "focus:post", changed.post, HOUR / 2)).not.toBeTypeOf("string");
	db.exec("commit");
	event(HOUR / 2, "dev", "cost_changed", { from: 0, to: 4 });
	const before = realizedFitness(db, "root", 0, HOUR);
	expect(before).toMatchObject({ compute: 4, delay: 5, delayByState: { inProgress: 5, queued: 0 } });
	discardProgramPeople(db, dir, new Set(["peer"]), 2 * HOUR);
	expect(realizedFitness(db, "root", 0, HOUR)).toEqual(before);
	expect(realizedFitness(db, "root", 2 * HOUR, 3 * HOUR)).toMatchObject({
		delay: 5,
		delayByState: { inProgress: 0, queued: 5 },
	});
	expect(membership(db, "root").managerAt("dev", HOUR)).toBe("peer");
	expect(membership(db, "root").managerAt("dev", 3 * HOUR)).toBe("caller");
	expect(db.prepare("select ended_at, end_reason, outcome from assignments where person = 'peer'").get()).toEqual({
		ended_at: 2 * HOUR,
		end_reason: "discarded",
		outcome: null,
	});
	expect(db.prepare("select action from work_changes where command_id = 'focus'").get()).toEqual({ action: "focus" });
	expect(db.prepare("select body from thread_messages where id = 'focus:post'").get()).toBeDefined();
});

test("disposal preserves earlier assignment ends and outcomes instead of rewriting them", async () => {
	const { db, dir, peer, task } = fixture();
	await peer("peer");
	task("kept", ["peer"]);
	db.prepare(
		"update assignments set ended_at = ?, end_reason = 'finished', outcome = 'Earlier outcome' where person = 'peer'",
	).run(HOUR);
	discardProgramPeople(db, dir, new Set(["peer"]), 2 * HOUR);
	expect(db.prepare("select ended_at, end_reason, outcome from assignments").get()).toEqual({
		ended_at: HOUR,
		end_reason: "finished",
		outcome: "Earlier outcome",
	});
});

test.each([false, true])(
	"sequential temporary cleanup preserves internal classification; lasting history=%s",
	async (lasting) => {
		const { db, dir, peer, task } = fixture();
		await peer("one");
		await peer("two");
		task("step", lasting ? ["one", "two", "dev"] : ["one", "two"], true);
		if (lasting)
			db.prepare("update assignments set ended_at = ?, end_reason = 'unassigned' where person = 'dev'").run(HOUR / 4);
		expect(realizedFitness(db, "root", 0, HOUR).delay).toBe(lasting ? 5 : 0);
		discardProgramPeople(db, dir, new Set(["one"]), HOUR);
		expect(realizedFitness(db, "root", 0, HOUR).delay).toBe(lasting ? 5 : 0);
		discardProgramPeople(db, dir, new Set(["two"]), 2 * HOUR);
		expect(db.prepare("select id from work_tasks where id = 'step'").all()).toHaveLength(lasting ? 1 : 0);
		expect(realizedFitness(db, "root", 0, HOUR).delay).toBe(lasting ? 5 : 0);
	},
);

test.skipIf(process.getuid?.() === 0)(
	"sequential internal cleanup keeps current launch ownership through actual file-removal failure and retry",
	async () => {
		const { db, dir, peer, task } = fixture();
		await peer("one");
		await peer("two");
		const bundle = task("step", ["one", "two"], true);
		const before = realizedFitness(db, "root", 0, HOUR);
		discardProgramPeople(db, dir, new Set(["one"]), HOUR);
		const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		chmodSync(bundle, 0o500);
		try {
			expect(() => discardProgramPeople(db, dir, new Set(["two"]), 2 * HOUR)).toThrow("Could not discard task data");
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Task source cleanup failed"));
			expect(existsSync(join(bundle, "task.md"))).toBe(true);
			expect(db.prepare("select 1 from program_peers where session_id = 'two'").get()).toBeDefined();
			expect(
				db
					.prepare("select person, previous_bundle from work_changes where task_id = 'step' and action = 'discard'")
					.get(),
			).toEqual({ person: "two", previous_bundle: bundle });
		} finally {
			if (existsSync(bundle)) chmodSync(bundle, 0o700);
		}
		discardProgramPeople(db, dir, new Set(["two"]), 2 * HOUR);
		expect(existsSync(bundle)).toBe(false);
		expect(db.prepare("select 1 from program_peers where session_id = 'two'").get()).toBeUndefined();
		expect(
			db.prepare("select previous_bundle from work_changes where task_id = 'step' and action = 'discard'").get(),
		).toEqual({ previous_bundle: null });
		expect(realizedFitness(db, "root", 0, HOUR)).toEqual(before);
	},
);

test("dropped-work attribution follows accounting caller focus, not a temporary emitter's different focus", async () => {
	const { db, dir, peer, task, event } = fixture();
	await peer("peer");
	task("caller-work", ["caller"]);
	task("peer-work", ["peer"]);
	for (const [person, taskId] of [
		["caller", "caller-work"],
		["peer", "peer-work"],
	] as const) {
		db.exec("begin");
		const change = changeWork(
			db,
			dir,
			`focus-${person}`,
			person,
			{ kind: "work", action: "focus", task: taskId, cwd: dir },
			HOUR / 4,
			[],
			[],
		);
		expect(postToThread(db, person, `focus-${person}:post`, change.post, HOUR / 4)).not.toBeTypeOf("string");
		db.exec("commit");
	}
	event(HOUR / 2, "peer", "cost_changed", { from: 0, to: 3 });
	db.prepare("update work_tasks set archived_at = ?, close_status = 'cancelled'").run(2 * HOUR);
	const before = realizedFitness(db, "root", 0, HOUR);
	expect(before).toMatchObject({
		compute: 3,
		delay: 10,
		total: -13,
		droppedWork: {
			unattributedCompute: 0,
			tasks: expect.arrayContaining([
				expect.objectContaining({ task: "task:caller-work", compute: 3, delay: 5 }),
				expect.objectContaining({ task: "task:peer-work", compute: 0, delay: 5 }),
			]),
		},
	});
	discardProgramPeople(db, dir, new Set(["peer"]), 3 * HOUR);
	expect(realizedFitness(db, "root", 0, HOUR)).toEqual(before);
});

test("disposal failure rolls back assignment, reparenting, participation and deletion; retry is stable", async () => {
	const { db, dir, peer, task, move } = fixture();
	await peer("peer");
	task("kept", ["peer"]);
	move("dev", "peer", HOUR / 4);
	const before = realizedFitness(db, "root", 0, HOUR);
	db.exec(
		"create trigger fail_discard before delete on sessions when old.id = 'peer' begin select raise(abort, 'disposal failure'); end",
	);
	expect(() => discardProgramPeople(db, dir, new Set(["peer"]), 2 * HOUR)).toThrow("disposal failure");
	expect(db.prepare("select ended_at from assignments where person = 'peer'").get()).toEqual({ ended_at: null });
	expect(membership(db, "root").managerAt("dev", 3 * HOUR)).toBe("peer");
	expect(db.prepare("select 1 from thread_participants where participant = 'peer'").all()).toHaveLength(1);
	expect(db.prepare("select 1 from sessions where id = 'peer'").get()).toBeDefined();
	expect(db.prepare("select 1 from events where type = 'person_discarded'").get()).toBeUndefined();
	expect(db.isTransaction).toBe(false);
	db.exec("drop trigger fail_discard");
	discardProgramPeople(db, dir, new Set(["peer"]), 2 * HOUR);
	expect(realizedFitness(db, "root", 0, HOUR)).toEqual(before);
});

test("migration preserves observed surviving callers once, never invents legacy baseline/birth or lost callers", () => {
	const { db, dir, person, event, mail } = fixture();
	person("legacy", "dev");
	db.prepare(
		"insert into program_peers (session_id, program_id, created_by, task_id) values ('legacy', 'old', 'caller', 'old-task')",
	).run();
	event(0, "legacy", "cost_changed", { from: 0, to: 12, hello: true });
	event(HOUR / 2, "legacy", "cost_changed", { from: 12, to: 15 });
	event(HOUR / 2, "legacy", "prompt_opened");
	mail("legacy", HOUR / 2);
	event(HOUR, "legacy", "transferred", { from: "caller", to: "dev", by: "root" });
	event(HOUR, "lost", "person_discarded");
	db.exec("pragma user_version = 28");
	migrate(db);
	migrate(db);
	expect(
		db.prepare("select type from events where session_id = 'legacy' and type like 'program_peer_%'").all(),
	).toEqual([{ type: "program_peer_observed" }]);
	expect(
		db.prepare("select 1 from events where session_id = 'legacy' and type = 'program_peer_created'").get(),
	).toBeUndefined();
	expect(
		db
			.prepare(
				"select 1 from events where session_id = 'legacy' and type = 'cost_changed' and json_extract(data, '$.initial') = 1",
			)
			.get(),
	).toBeUndefined();
	const before = realizedFitness(db, "root", 0, HOUR);
	expect(before).toMatchObject({ compute: 3, interruptions: 2 });
	discardProgramPeople(db, dir, new Set(["legacy"]), 2 * HOUR);
	expect(realizedFitness(db, "root", 0, HOUR)).toEqual(before);
	const history = membership(db, "root");
	expect(history.accountingPerson("legacy")).toBe("caller");
	expect(history.managerAt("legacy", 2 * HOUR)).toBe("dev");
	expect(temporaryCallers(db).has("lost")).toBe(true);
	expect(history.accountingPerson("lost")).toBeUndefined();
	expect(history.memberAt("lost", 2 * HOUR)).toBe(false);
});

test.each([false, true])(
	"a discarded legacy identity stays unknown through later live/observed reuse, including pre-provisional launch (row=%s)",
	(provisional) => {
		const { db, dir, person, event, mail } = fixture();
		person("r2", null);
		person("legacy", "caller");
		db.prepare(
			"insert into program_peers (session_id, program_id, created_by, task_id) values ('legacy', 'old-r1', 'caller', 'old-task')",
		).run();
		event(5, "legacy", "cost_changed", { from: 12, to: 15 });
		event(6, "legacy", "prompt_opened");
		mail("legacy", 6);
		expect(realizedFitness(db, "root", 0, 10)).toMatchObject({ compute: 3, interruptions: 2 });
		discardProgramPeople(db, dir, new Set(["legacy"]), 10);
		db.prepare(
			"insert into program_peers (session_id, program_id, created_by, task_id) values ('legacy', 'old-r2', 'r2', 'later-task')",
		).run();
		if (provisional) person("legacy", "r2");
		expect(temporaryCallers(db).get("legacy")).toBeNull();
		expect(realizedFitness(db, "r2", 0, 10)).toMatchObject({ compute: 0, interruptions: 0 });
		db.exec("pragma user_version = 28");
		migrate(db);
		migrate(db);
		expect(
			db
				.prepare(
					"select type from events where session_id = 'legacy' and type in ('person_discarded', 'program_peer_observed') order by seq",
				)
				.all(),
		).toEqual([{ type: "person_discarded" }, { type: "program_peer_observed" }]);
		expect(temporaryCallers(db).get("legacy")).toBeNull();
		expect(membership(db, "r2").accountingPerson("legacy")).toBeUndefined();
		for (const organization of ["root", "r2"])
			expect(realizedFitness(db, organization, 0, 10)).toMatchObject({ compute: 0, interruptions: 0 });
	},
);

test("ambiguous temporary snapshots and a later first transfer cannot backfill lasting descendants' old membership", () => {
	const { db, person, event, move } = fixture();
	person("r2", null);
	person("legacy", "r2");
	db.prepare("update sessions set reports_to = 'legacy' where id = 'dev'").run();
	event(5, "dev", "cost_changed", { from: 0, to: 4 });
	event(10, "legacy", "person_discarded");
	expect(temporaryCallers(db).get("legacy")).toBeNull();
	expect(realizedFitness(db, "r2", 0, 10).compute).toBe(0);
	move("legacy", "root", 30);
	event(35, "dev", "cost_changed", { from: 4, to: 6 });
	expect(membership(db, "root").managerAt("legacy", 25)).toBeNull();
	expect(membership(db, "root").managerAt("legacy", 35)).toBe("root");
	for (const organization of ["root", "r2"]) expect(realizedFitness(db, organization, 0, 10).compute).toBe(0);
	expect(realizedFitness(db, "root", 30, 40).compute).toBe(2);
	expect(realizedFitness(db, "r2", 30, 40).compute).toBe(0);
});

test.each(["created", "observed"] as const)(
	"unambiguous %s identity keeps its known first-transfer ancestry convention",
	async (kind) => {
		const { db, person, peer, event, move } = fixture();
		person("r2", null);
		if (kind === "created") await peer("known");
		else {
			person("known", "caller");
			db.prepare(
				"insert into program_peers (session_id, program_id, created_by, task_id) values ('known', 'old', 'caller', 'old-task')",
			).run();
			db.exec("pragma user_version = 28");
			migrate(db);
		}
		db.prepare("update sessions set reports_to = 'known' where id = 'dev'").run();
		event(5, "dev", "cost_changed", { from: 0, to: 4 });
		move("known", "r2", 30);
		event(35, "dev", "cost_changed", { from: 4, to: 6 });
		expect(realizedFitness(db, "root", 0, 10).compute).toBe(4);
		expect(realizedFitness(db, "r2", 0, 10).compute).toBe(0);
		expect(realizedFitness(db, "root", 30, 40).compute).toBe(0);
		expect(realizedFitness(db, "r2", 30, 40).compute).toBe(2);
	},
);

test("an unknown temporary caller in a new creation chain stays unattributed instead of becoming a lasting beneficiary", async () => {
	const { db, peer, person, event, mail, clock } = fixture();
	person("unknown", "root");
	event(10, "unknown", "person_discarded");
	clock.mockReturnValue(12);
	await peer("child", "unknown");
	event(15, "child", "cost_changed", { from: 0, to: 2 });
	event(15, "child", "prompt_opened");
	mail("child", 15);
	expect(membership(db, "root").accountingPerson("child")).toBeUndefined();
	expect(realizedFitness(db, "root", 0, 20)).toMatchObject({ compute: 0, interruptions: 0 });
});

test.each([false, true])(
	"disposed identity cannot be reused by ordinary or fresh program start (program=%s)",
	async (temporary) => {
		const { db, dir, peer, runtime, program, scopes } = fixture();
		await peer("peer");
		discardProgramPeople(db, dir, new Set(["peer"]), HOUR);
		runtime.applyWork.mockClear();
		const fresh = {
			...program,
			id: "new-program",
			caller: "dev",
			created: new Set<string>(),
			discarded: new Set<string>(),
		};
		scopes.set(fresh.id, { program: fresh });
		await runtime.startSession(
			"reuse",
			"peer",
			{ kind: "start", cwd: dir, role: "implementation-engineer", goal: { by: "caller", text: "New work" } },
			temporary ? fresh : undefined,
		);
		expect(runtime.setCommandStage).toHaveBeenCalledWith(
			"reuse",
			"failed",
			"Program peers cannot be reopened; create a new handle",
		);
		expect(runtime.applyWork).not.toHaveBeenCalled();
		expect(temporaryCallers(db).get("peer")).toBe("caller");
	},
);
