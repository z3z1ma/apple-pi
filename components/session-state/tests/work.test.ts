import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import installLedger from "../../../extensions/ledger.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { addLedgerTask } from "../../shared/src/ledger-files.js";
import bridge from "../src/index.js";
import type { communicationIn, waitsIn, workIn } from "../src/inspect.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
import { migrate } from "../src/schema.js";
import { readValuation } from "../src/valuation.js";
import type { WorkTask } from "../src/work.js";
import { TASK_GOAL_CUSTOM_TYPE } from "../src/work-tools.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
async function person(manager?: string, role?: string, cwd?: string) {
	const script: Reply[] = [];
	const run = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" && manager ? manager : getFlag(name));
				bridge(pi);
				installLedger(pi);
			},
		],
		// A finished task starts a self-reflection fork; it answers without taking the script's next call.
		(context) =>
			JSON.stringify(context.messages.at(-1)).includes("You have finished a task.")
				? fauxAssistantMessage("Nothing changed.")
				: (script.shift() ?? fauxAssistantMessage("noted")),
		["ledger_add", "ledger_status", "read"],
		{ cwd },
	);
	const id = run.session.sessionManager.getSessionId();
	if (role) {
		run.session.extensionRunner.setFlagValue("role", role);
		await run.session.bindExtensions({});
		await vi.waitFor(
			() => expect(query(state.dbPath, "select role from sessions where id = ?", id)).toEqual([{ role }]),
			{ timeout: 15000 },
		);
	}
	await vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
	await run.session.prompt("ready");
	async function invoke<T = WorkTask>(name: string, args: Parameters<typeof fauxToolCall>[1]) {
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
		script.push(call(name, args));
		await run.session.prompt(`call ${name}`);
		const result = run.session.messages.filter((m) => m.role === "toolResult").at(-1)!;
		expect(result).toMatchObject({ isError: false });
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
		return result.details as unknown as T;
	}
	async function attempt(name: string, args: Parameters<typeof fauxToolCall>[1]) {
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
		script.push(call(name, args));
		await run.session.prompt(`call ${name}`);
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
		return run.session.messages.filter((m) => m.role === "toolResult").at(-1)!;
	}
	return { run, id, invoke, attempt, script };
}
function goalPackets(run: Awaited<ReturnType<typeof fauxSession>>) {
	return run.session.messages.filter(
		(m) =>
			(m.role === "toolResult" ||
				(m.role === "custom" && (m.customType === MAIL_CUSTOM_TYPE || m.customType === TASK_GOAL_CUSTOM_TYPE))) &&
			JSON.stringify(m.content).includes("Focused task:"),
	);
}
async function packets(run: Awaited<ReturnType<typeof fauxSession>>, count: number) {
	await vi.waitFor(() => expect(goalPackets(run)).toHaveLength(count), { timeout: 10000 });
	await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
}

test("ledger creation and status callers remain task participants without assignments", async () => {
	const creator = await person();
	const editor = await person(creator.id, undefined, creator.run.cwd);
	const closer = await person(creator.id, undefined, creator.run.cwd);
	type TaskThread = { id: string; kind: string; subject: string; participants: { id: string }[] };
	const taskThreads = async (who: typeof creator) =>
		(await who.invoke<{ threads: TaskThread[] }>("inbox", { all: true })).threads.filter(
			(thread) => thread.kind === "task",
		);
	const participantIds = (thread: TaskThread) => thread.participants.map((participant) => participant.id).sort();
	try {
		const added = await creator.invoke<{ taskId: string; bundlePath: string }>("ledger_add", {
			title: "Preserve task context",
			description: "Keep session relationships in workplace state",
		});
		const bundle = realpathSync(join(creator.run.cwd, added.bundlePath));
		const threads = await taskThreads(creator);
		expect(threads).toHaveLength(1);
		const thread = threads[0];
		expect(thread.subject).toBe("Preserve task context");
		expect(participantIds(thread)).toEqual([creator.id]);
		for (const status of ["ready", "in-progress"]) await editor.invoke("ledger_status", { task: bundle, status });
		const edited = (await taskThreads(editor)).find((entry) => entry.id === thread.id)!;
		expect(participantIds(edited)).toEqual([creator.id, editor.id].sort());
		await closer.invoke("ledger_status", { task: bundle, status: "done" });
		for (const who of [creator, editor, closer]) {
			const retained = (await taskThreads(who)).find((entry) => entry.id === thread.id)!;
			expect(participantIds(retained)).toEqual([creator.id, editor.id, closer.id].sort());
			const read = await who.invoke<{ thread: { id: string; subject: string } }>("read_thread", { thread: thread.id });
			expect(read.thread).toMatchObject({ id: thread.id, subject: "Preserve task context" });
		}
		const directory = await creator.invoke<{
			members: { id: string; held: number; finished: number; focus: unknown }[];
		}>("directory", { subtree: creator.id });
		for (const who of [creator, editor, closer])
			expect(directory.members.find((member) => member.id === who.id)).toMatchObject({
				held: 0,
				finished: 0,
				focus: null,
			});
	} finally {
		for (const who of [closer, editor, creator]) await close(who.run);
	}
}, 30000);

test("taking, switching, rereading, and compaction append the explicit goal; finishing preserves informal work and its artifacts in place", async () => {
	const who = await person();
	try {
		const first = await who.invoke("take_task", {
			goal: "Find why requests stall.\nVerify the slow path.",
			title: "Requests stall",
		});
		expect(first.ephemeral).toBe(1);
		expect(first.bundle).toContain("/state/tasks/");
		// The short title names the task; the goal keeps every line.
		expect(readFileSync(join(first.bundle, "task.md"), "utf8")).toContain(
			"# Requests stall\n\n## Intent\n\nFind why requests stall.\nVerify the slow path.",
		);
		who.script.push(call("take_task", { goal: "Untitled work." }));
		await who.run.session.prompt("take untitled work");
		expect(who.run.session.messages.filter((m) => m.role === "toolResult").at(-1)).toMatchObject({
			isError: true,
			content: [{ text: "Give a short title with the goal." }],
		});
		expect(readFileSync(join(first.bundle, "task.md"), "utf8")).toContain("Verify the slow path.");
		expect(existsSync(join(first.bundle, "retrospective.md"))).toBe(true);
		await packets(who.run, 1);
		expect(query(state.dbPath, "select sender, receiver from mail where receiver = ?", who.id)).toEqual([]);
		const second = await who.invoke("take_task", { goal: "Compare the retry policy.", title: "Retry policy" });
		await packets(who.run, 2);
		expect(
			query(state.dbPath, "select task_id from assignments where person = ? and ended_at is null order by id", who.id),
		).toEqual([{ task_id: first.id }, { task_id: second.id }]);
		writeFileSync(
			join(first.bundle, "task.md"),
			"Status: in-progress\n\n# Diagnose requests\n\nThe revised goal: verify the queue, not retries.\n",
		);
		await who.invoke("focus", { task: first.id });
		await packets(who.run, 3);
		expect(JSON.stringify(goalPackets(who.run).at(-1))).toContain("The revised goal: verify the queue, not retries.");
		who.run.session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
		await who.run.session.compact();
		await who.run.session.prompt("continue after compaction");
		const request = JSON.stringify(who.run.requests.at(-1));
		expect(request).toContain("The revised goal: verify the queue, not retries.");
		expect(who.run.customMessages(TASK_GOAL_CUSTOM_TYPE)).toHaveLength(1);
		writeFileSync(
			join(first.bundle, "retrospective.md"),
			"# Retrospective\n\nA blocked queue, verified against the trace.\n",
		);
		mkdirSync(join(first.bundle, "evidence"));
		const artifact = join(first.bundle, "evidence", "trace.bin");
		const bytes = Buffer.from([0, 1, 127, 255]);
		writeFileSync(artifact, bytes);
		const finished = await who.invoke("finish_task", {
			outcome: "Queue blockage verified against the trace; no retry cause found.",
		});
		expect(query(state.dbPath, "select sender, receiver from mail where receiver = ?", who.id)).toEqual([]);
		expect(finished.bundle).toBe(first.bundle);
		expect(readFileSync(artifact)).toEqual(bytes);
		expect(readFileSync(join(first.bundle, "task.md"), "utf8")).toMatch(/^Status: done$/m);
		expect(readFileSync(join(finished.bundle, "task.md"), "utf8")).toContain("Queue blockage verified");
		expect(readFileSync(join(finished.bundle, "retrospective.md"), "utf8")).toContain("blocked queue");
		expect(query(state.dbPath, "select task_id from work_focus where person = ?", who.id)).toEqual([]);
		expect(
			query(
				state.dbPath,
				"select end_reason, outcome from assignments where person = ? and task_id = ?",
				who.id,
				first.id,
			),
		).toEqual([
			{ end_reason: "finished", outcome: "Queue blockage verified against the trace; no retry cause found." },
		]);
	} finally {
		await close(who.run);
	}
}, 40000);

test("assignments are shared task conversations, unassigning reports the change, and completion reaches the assigner", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id);
	const reviewer = await person(manager.id);
	try {
		const task = await manager.invoke("assign", {
			person: engineer.id,
			goal: "Prove the cache invalidation boundary.",
			title: "Cache invalidation",
		});
		await packets(engineer.run, 1);
		expect(query(state.dbPath, "select assigned_by from assignments where person = ?", engineer.id)).toEqual([
			{ assigned_by: manager.id },
		]);
		expect(
			query(
				state.dbPath,
				"select participant from thread_participants where thread_id = ? order by participant",
				task.thread,
			).map((r) => r.participant),
		).toEqual([manager.id, engineer.id].sort());
		await manager.invoke("unassign", { person: engineer.id, task: task.id });
		await vi.waitFor(() =>
			expect(JSON.stringify(engineer.run.customMessages(MAIL_CUSTOM_TYPE))).toContain("unassigned"),
		);
		expect(query(state.dbPath, "select * from work_focus where person = ?", engineer.id)).toEqual([]);
		await vi.waitFor(() => expect(engineer.run.session.isStreaming).toBe(false));
		await engineer.invoke("take_task", { task: task.id });
		await packets(engineer.run, 2);
		expect(
			query(
				state.dbPath,
				"select sender, receiver from mail where sender = ? and receiver = ?",
				engineer.id,
				engineer.id,
			),
		).toEqual([]);
		await vi.waitFor(() => expect(JSON.stringify(manager.run.customMessages(MAIL_CUSTOM_TYPE))).toContain("assigned"));
		await manager.invoke("assign", { person: reviewer.id, task: task.id });
		await packets(reviewer.run, 1);
		const partial = await engineer.invoke("finish_task", {
			outcome: "Verified invalidation after every write; confidence high.",
		});
		expect(
			query(
				state.dbPath,
				"select sender, receiver from mail where sender = ? and receiver = ?",
				engineer.id,
				engineer.id,
			),
		).toEqual([]);
		expect(partial.archived_at).toBeNull();
		expect(existsSync(join(task.bundle, "task.md"))).toBe(true);
		expect(query(state.dbPath, "select task_id from work_focus where person = ?", reviewer.id)).toEqual([
			{ task_id: task.id },
		]);
		const completed = await reviewer.invoke("finish_task", { outcome: "Independently verified the boundary cases." });
		expect(completed.archived_at).not.toBeNull();
		expect(completed.bundle).toBe(task.bundle);
		expect(readFileSync(join(completed.bundle, "task.md"), "utf8")).toContain(
			"Independently verified the boundary cases.",
		);
		await vi.waitFor(
			() =>
				expect(JSON.stringify(manager.run.customMessages(MAIL_CUSTOM_TYPE))).toContain(
					"Verified invalidation after every write",
				),
			{ timeout: 10000 },
		);
		expect(query(state.dbPath, "select end_reason from assignments where task_id = ? order by id", task.id)).toEqual([
			{ end_reason: "unassigned" },
			{ end_reason: "finished" },
			{ end_reason: "finished" },
		]);
	} finally {
		await close(reviewer.run);
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("links stay universal; insights belong to an unroled root, not its unroled or working-role reports", async () => {
	const root = await person();
	const worker = await person(root.id, "implementation-engineer");
	const unroled = await person(root.id);
	try {
		for (const who of [root, worker, unroled]) {
			const task = await who.invoke("take_task", { goal: "Check interfaces.", title: "Interfaces" });
			const relationship = await who.invoke<{ id: string }>("link", {
				from: `task:${task.id}`,
				to: "file:app.ts",
				relation: "produced",
			});
			await who.invoke("link", { id: relationship.id, resolution: "recorded" });
			for (const tool of [
				"org_work",
				"org_waits",
				"org_expertise",
				"org_communication",
				"org_fitness",
				"predictions",
				"hire",
			])
				expect(who.run.session.getActiveToolNames().includes(tool)).toBe(who === root);
			expect(await who.attempt("org_work", {})).toMatchObject({ isError: who !== root });
		}
		// The human inspection command remains available without granting model tools.
		const notices: string[] = [];
		const errors: unknown[] = [];
		await root.run.session.bindExtensions({
			onError: (error) => errors.push(error),
			uiContext: { notify: (text: string) => notices.push(text), setStatus() {} } as never,
		});
		const turns = root.run.requests.length;
		await root.run.session.prompt("/org");
		expect(errors).toEqual([]);
		expect(notices.at(-1)).toContain("Open waits:");
		expect(root.run.requests).toHaveLength(turns);
		expect(root.run.session.getActiveToolNames()).toContain("org_work");
	} finally {
		await close(unroled.run);
		await close(worker.run);
		await close(root.run);
	}
}, 30000);

test("promotion keeps files, assignment identity and conversation, while ledger tasks can be taken by path", async () => {
	const who = await person();
	try {
		const task = await who.invoke("take_task", { goal: "Measure the queue", title: "Queue" });
		await packets(who.run, 1);
		writeFileSync(join(task.bundle, "evidence.md"), "Observed ten queued requests.\n");
		const promoted = await who.invoke("promote_task", { task: task.id });
		expect(promoted.id).toBe(task.id);
		expect(promoted.thread).toBe(task.thread);
		expect(promoted.ephemeral).toBe(0);
		expect(existsSync(task.bundle)).toBe(false);
		expect(readFileSync(join(promoted.bundle, "evidence.md"), "utf8")).toBe("Observed ten queued requests.\n");
		expect(readFileSync(join(who.run.cwd, ".ledger", "INDEX.md"), "utf8")).toContain("in-progress");
		await packets(who.run, 2);
		expect(JSON.stringify(goalPackets(who.run).at(-1))).toContain(promoted.bundle);
		const ledger = await addLedgerTask(who.run.cwd, "Release checks", "Verify release readiness");
		const taken = await who.invoke("take_task", { task: ledger.taskPath });
		expect(taken.ephemeral).toBe(0);
		expect(taken.bundle).toBe(realpathSync(join(who.run.cwd, ledger.bundlePath)));
		await packets(who.run, 3);
	} finally {
		await close(who.run);
	}
}, 30000);

test("archiving a ledger bundle updates its path without changing the assignment, focus, or thread", async () => {
	const who = await person();
	try {
		const ledger = await addLedgerTask(
			who.run.cwd,
			"Verify task archive paths",
			"Keep the goal reachable after archive",
		);
		const taken = await who.invoke("take_task", { task: ledger.taskId });
		await packets(who.run, 1);
		await who.invoke("ledger_status", { task: ledger.taskId, status: "done" });
		const after = await who.invoke("focus", { task: taken.id });
		await packets(who.run, 2);
		expect(after).toMatchObject({
			id: taken.id,
			thread: taken.thread,
			bundle: realpathSync(join(who.run.cwd, ".ledger", "history", ledger.taskId)),
		});
		expect(JSON.stringify(goalPackets(who.run).at(-1))).toContain("Status: done");
		expect(
			query(state.dbPath, "select task_id from assignments where person = ? and ended_at is null", who.id),
		).toEqual([{ task_id: taken.id }]);
	} finally {
		await close(who.run);
	}
}, 30000);

test("the runtime records once when each task opens and how it closes, even for ledger tasks nobody was assigned", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id);
	const reviewer = await person(manager.id);
	type Lifecycle = { opened_at: number | null; archived_at: number | null; close_status: string | null };
	const lifecycle = (bundle: string) =>
		query<Lifecycle>(
			state.dbPath,
			"select opened_at, archived_at, close_status from work_tasks where bundle = ?",
			realpathSync(bundle),
		);
	try {
		const shared = await manager.invoke("assign", { person: engineer.id, goal: "Fix the cache.", title: "Cache" });
		await packets(engineer.run, 1);
		await manager.invoke("assign", { person: reviewer.id, task: shared.id });
		await packets(reviewer.run, 1);
		const [opened] = query<Lifecycle>(
			state.dbPath,
			"select opened_at, archived_at, close_status from work_tasks where id = ?",
			shared.id,
		);
		expect(opened.opened_at).not.toBeNull();
		await engineer.invoke("finish_task", { outcome: "Fixed." });
		expect(query(state.dbPath, "select archived_at, close_status from work_tasks where id = ?", shared.id)).toEqual([
			{ archived_at: null, close_status: null },
		]);
		await reviewer.invoke("finish_task", { outcome: "Checked." });
		const [closed] = query<Lifecycle>(
			state.dbPath,
			"select opened_at, archived_at, close_status from work_tasks where id = ?",
			shared.id,
		);
		expect(closed).toMatchObject({ opened_at: opened.opened_at, close_status: "done" });
		expect(closed.archived_at).not.toBeNull();

		// Created through the tool: open at creation, though nobody is ever assigned.
		await manager.invoke("ledger_add", { title: "Drop the old flag", description: "Remove it", slug: "drop-flag" });
		await manager.invoke("ledger_add", { title: "Rewrite the parser", description: "Maybe", slug: "rewrite" });
		const ledger = join(manager.run.cwd, ".ledger");
		const bundleOf = (slug: string) => join(ledger, readdirSync(ledger).find((name) => name.endsWith(`-${slug}`))!);
		const dropFlag = bundleOf("drop-flag");
		const rewrite = bundleOf("rewrite");
		const [unassigned] = lifecycle(dropFlag);
		expect(unassigned).toMatchObject({ archived_at: null, close_status: null });
		expect(unassigned.opened_at).not.toBeNull();
		await manager.invoke("ledger_status", { task: basename(dropFlag), status: "done" });
		await manager.invoke("ledger_status", { task: basename(rewrite), status: "cancelled" });
		const [done] = lifecycle(join(ledger, "history", basename(dropFlag)));
		expect(done).toMatchObject({ opened_at: unassigned.opened_at, close_status: "done" });
		expect(done.archived_at).not.toBeNull();
		expect(lifecycle(join(ledger, "history", basename(rewrite)))[0]).toMatchObject({ close_status: "cancelled" });

		// Created before the runtime heard of it: opens when first recorded, here when taken.
		const older = await addLedgerTask(manager.run.cwd, "Old backlog item", "Predates the records");
		expect(lifecycle(join(manager.run.cwd, older.bundlePath))).toEqual([]);
		const taken = await engineer.invoke("take_task", { task: join(manager.run.cwd, older.bundlePath) });
		await packets(engineer.run, 2);
		const [before] = lifecycle(taken.bundle);
		expect(before.opened_at).not.toBeNull();
		await manager.invoke("ledger_status", { task: older.taskId, status: "done" });
		const [after] = lifecycle(join(ledger, "history", older.taskId));
		expect(after).toMatchObject({ opened_at: before.opened_at, close_status: "done" });
	} finally {
		await close(reviewer.run);
		await close(engineer.run);
		await close(manager.run);
	}
}, 45000);

test("a new task carries the value and cost of delay its writer estimated, and the next read sees an edit", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id);
	try {
		const valued = await manager.invoke("assign", {
			person: engineer.id,
			goal: "Fix the flaky test.",
			title: "Flaky test",
			value: 50,
			cost_of_delay: 5,
		});
		await packets(engineer.run, 1);
		const path = join(valued.bundle, "task.md");
		const header = readFileSync(path, "utf8").split("\n# ")[0];
		expect(header).toMatch(/^Value: \$50 \(estimated by .+\)$/m);
		expect(header).toContain("Cost of delay: $5/hour");
		const taken = await engineer.invoke("take_task", { goal: "Tidy imports.", title: "Imports", value: 3 });
		expect(readFileSync(join(taken.bundle, "task.md"), "utf8")).toMatch(/^Value: \$3 \(estimated by .+\)$/m);
		const plain = await engineer.invoke("take_task", { goal: "Read the logs.", title: "Logs" });
		expect(readFileSync(join(plain.bundle, "task.md"), "utf8")).not.toMatch(/^(Value|Cost of delay):/m);
		writeFileSync(path, readFileSync(path, "utf8").replace(/^Value: .*$/m, "Value: $80"));
		expect(readValuation(readFileSync(path, "utf8"))).toEqual({ value: 80, costOfDelayPerHour: 5, estimatedBy: null });
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("a managing role reads its organization's realized fitness over a window it names", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id, "coordinator");
	try {
		const flaky = await manager.invoke("assign", {
			person: engineer.id,
			goal: "Fix the flaky test.",
			title: "Flaky test",
			value: 50,
			cost_of_delay: 5,
		});
		await packets(engineer.run, 1);
		const tidy = await engineer.invoke("take_task", { goal: "Tidy up.", title: "Tidy" });
		await engineer.invoke("focus", { task: flaky.id });
		await engineer.invoke("finish_task", { outcome: "Fixed." });
		type Fitness = { value: number; delay: number; total: number; coverage: { unvalued: number }; incomplete: boolean };
		const fitness = await engineer.invoke<Fitness>("org_fitness", { since: "1h" });
		const ahead = await engineer.attempt("org_fitness", {
			since: "1h",
			until: new Date(Date.now() + 3_600_000).toISOString(),
		});
		expect(ahead).toMatchObject({ isError: true });
		expect(JSON.stringify(ahead.content)).toContain("covers the past");
		expect(fitness.value).toBe(50);
		expect(fitness.delay).toBeGreaterThan(0);
		expect(fitness.total).toBeCloseTo(50 - fitness.delay, 9);
		expect(fitness).toMatchObject({ coverage: { unvalued: 1 }, incomplete: true });
		await engineer.invoke("link", {
			from: `check:review`,
			to: `task:${flaky.id}`,
			relation: "finds",
			data: { impact: { dollars: -120, kind: "estimated" } },
		});
		const replacement = await engineer.invoke<{ id: string }>("link", {
			from: `task:${tidy.id}`,
			to: `task:${flaky.id}`,
			relation: "supersedes",
		});
		const evidence = await engineer.attempt("org_fitness", { since: "1h" });
		expect(evidence.isError).not.toBe(true);
		const text = JSON.stringify(evidence.content);
		expect(text).toContain("estimated $-120.00");
		expect(text).toContain("not an extra charge or waste verdict");
		expect(text).toContain("estimate from focus at compute observation time");
		expect(text).toContain(`person:${engineer.id}`);
		expect(text).toContain(`task:${flaky.id}`);
		expect(evidence.details).toMatchObject({
			total: fitness.total,
			impacts: [
				{
					kind: "estimated",
					dollars: -120,
					recordedBy: `person:${engineer.id}`,
					to: `task:${flaky.id}`,
				},
			],
			droppedWork: {
				tasks: [
					{
						task: `task:${flaky.id}`,
						compute: 0,
						delay: fitness.delay,
						cancelled: false,
						supersededBy: [`link:${replacement.id}`],
					},
				],
				unattributedCompute: 0,
			},
			findings: {
				byTask: [{ task: `task:${flaky.id}`, findings: [{ person: `person:${engineer.id}`, resolution: null }] }],
				byPerson: [{ person: `person:${engineer.id}`, findings: [{ task: `task:${flaky.id}`, resolution: null }] }],
			},
		});
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("a managing role compares optional scenarios and reads recorded predictions through native tools", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id, "coordinator");
	try {
		expect(engineer.run.session.getActiveToolNames()).toContain("hire");
		const scenario = {
			name: "Builder",
			decisionAt: "recording",
			horizonMs: 3_600_000,
			organization: "One builder",
			opportunities: [{ id: "change", value: 300, costOfDelayPerHour: 0 }],
			start: [],
			outcomes: [
				{
					probability: 0.7,
					tasks: [{ opportunity: "change", openedMs: 0, closedMs: 1, status: "done" }],
					compute: [{ atMs: 0, dollars: 10 }],
					impacts: [],
				},
				{
					probability: 0.3,
					tasks: [{ opportunity: "change", openedMs: 0, closedMs: 1, status: "done" }],
					compute: [{ atMs: 0, dollars: 10 }],
					impacts: [{ atMs: 1, dollars: -300 }],
				},
			],
		};
		const reviewed = structuredClone(scenario);
		reviewed.name = "Reviewed";
		reviewed.organization = "Builder and reviewer";
		reviewed.outcomes[0].probability = 0.9;
		reviewed.outcomes[1].probability = 0.1;
		for (const outcome of reviewed.outcomes) outcome.compute[0].dollars = 16;
		const comparison = await engineer.invoke<{ scenarios: { expected: number; decisionAt: number }[] }>("org_fitness", {
			scenarios: [scenario, reviewed],
		});
		expect(comparison.scenarios.map((row) => row.expected)).toEqual([200, 254]);
		expect(comparison.scenarios[0].decisionAt).toBe(comparison.scenarios[1].decisionAt);
		const invalidModes: Parameters<typeof fauxToolCall>[1][] = [
			{},
			{ since: "1h", scenarios: [scenario] },
			{ until: "1h", scenarios: [scenario] },
			{ subtree: manager.id, scenarios: [scenario] },
		];
		for (const args of invalidModes) {
			const invalid = await engineer.attempt("org_fitness", args);
			expect(invalid.isError).toBe(true);
			expect(JSON.stringify(invalid.content)).toContain("exactly one mode");
		}
		await engineer.invoke("send_mail", {
			to: [manager.id],
			subject: "Forecasted change",
			body: "Add a reviewer after recording this forecast.",
		});
		const message = query(
			state.dbPath,
			"select id from thread_messages where sender = ? order by seq desc limit 1",
			engineer.id,
		)[0] as { id: string };
		const data = { scenario: reviewed, note: "unaltered assertion" };
		const link = await engineer.invoke<{ id: string }>("link", {
			from: `message:${message.id}`,
			to: `organization:${manager.id}`,
			relation: "predicts",
			data,
		});
		const stored = query(state.dbPath, "select data, created_at from links where id = ?", link.id)[0] as {
			data: string;
			created_at: number;
		};
		expect(JSON.parse(stored.data)).toEqual(data);
		const result = await engineer.attempt("predictions", {});
		expect(result.isError).not.toBe(true);
		expect(result.details).toMatchObject({
			predictions: [
				{
					link: `link:${link.id}`,
					expected: 254,
					status: "pending",
					reason: "valuation unverifiable",
					forecastError: null,
					recordedAt: stored.created_at,
				},
			],
		});
		expect(JSON.stringify(result.content)).toContain("calibration, not the causal effect");
		await engineer.invoke("take_task", { title: "Unpriced work", goal: "Investigate work without a value yet." });
		const short = structuredClone(reviewed);
		short.horizonMs = 1;
		const shortLink = await engineer.invoke<{ id: string }>("link", {
			from: `message:${message.id}`,
			to: `organization:${manager.id}`,
			relation: "predicts",
			data: { scenario: short },
		});
		const shortRow = query(state.dbPath, "select created_at from links where id = ?", shortLink.id)[0] as {
			created_at: number;
		};
		await vi.waitFor(() => expect(Date.now()).toBeGreaterThanOrEqual(shortRow.created_at + short.horizonMs));
		const matured = await engineer.attempt("predictions", {});
		expect(matured.isError).not.toBe(true);
		expect(matured.details).toMatchObject({
			predictions: expect.arrayContaining([
				expect.objectContaining({
					link: `link:${shortLink.id}`,
					status: "observed",
					observed: 0,
					forecastError: null,
					reason: "valuation unverifiable; observed fitness incomplete",
					observation: expect.objectContaining({
						incomplete: true,
						coverage: expect.objectContaining({ tasks: 1, unvalued: 1 }),
						excludes: expect.stringContaining("pi_exec"),
					}),
				}),
			]),
		});
		expect(JSON.stringify(matured.content)).toContain("observed coverage 1 tasks, 1 unvalued (incomplete)");
		expect(JSON.stringify(matured.content)).toContain("known exclusions:");
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("a managing role finds who has context on an area from what people actually read", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id);
	try {
		await engineer.invoke("read", { path: "app.ts" });
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from messages where session_id = ? and tool = 'read'", engineer.id),
			).not.toHaveLength(0),
		);
		type Expertise = { people: { ref: string; reads: number; status: string }[] };
		const found = await manager.invoke<Expertise>("org_expertise", { area: "app.ts" });
		expect(found.people).toMatchObject([{ ref: `person:${engineer.id}`, reads: 1 }]);
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("a manager inspects explicitly recorded escalation requests through org_communication", async () => {
	const manager = await person(undefined, "coordinator");
	const report = await person(manager.id);
	try {
		const result = await report.invoke<{ thread: string }>("escalate", { body: "Need a decision." });
		const view = await manager.invoke<{ requests: { person: string; escalations: string[] }[] }>("org_communication", {
			since: "1h",
			person: manager.id,
		});
		expect(view.requests).toContainEqual(
			expect.objectContaining({ person: `person:${manager.id}`, escalations: [`thread:${result.thread}`] }),
		);
	} finally {
		await close(report.run);
		await close(manager.run);
	}
}, 30000);

test("escalate records an explicit escalation kind, not merely a subject", async () => {
	const manager = await person(undefined, "coordinator");
	const report = await person(manager.id);
	try {
		const result = await report.invoke<{ thread: string }>("escalate", { body: "Need a decision." });
		const read = await manager.invoke<{ thread: { kind: string; subject: string } }>("read_thread", {
			thread: result.thread,
		});
		expect(read.thread).toMatchObject({ kind: "escalation", subject: "Escalation" });
	} finally {
		await close(report.run);
		await close(manager.run);
	}
}, 30000);

test("a scripted manager inspects a ready task and relevant idle experience, assigns it, and observes the change", async () => {
	const manager = await person(undefined, "coordinator");
	const specialist = await person(manager.id);
	try {
		const ready = await manager.invoke("take_task", {
			goal: "Review app.ts interfaces.",
			title: "Review app interfaces",
		});
		await manager.invoke("unassign", { person: manager.id, task: ready.id });
		const blocked = await manager.invoke("take_task", { goal: "Choose the API version.", title: "API version" });
		const decision = await manager.invoke<{ id: string }>("link", {
			from: `task:${blocked.id}`,
			to: `person:${manager.id}`,
			relation: "requires_decision",
			reason: "Choose the supported API version.",
		});
		await specialist.invoke("read", { path: "app.ts" });
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from messages where session_id = ? and tool = 'read'", specialist.id).length,
			).toBeGreaterThan(0),
		);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select run_state from sessions where id = ?", specialist.id)).toEqual([
				{ run_state: "idle" },
			]),
		);
		expect(
			query(state.dbPath, "select 1 from assignments where person = ? and ended_at is null", specialist.id),
		).toEqual([]);
		const start = manager.run.session.messages.length;
		manager.script.push(
			call("org_work", {}),
			call("org_expertise", { area: "app.ts" }),
			call("assign", { person: specialist.id, task: ready.id }),
			call("org_work", {}),
			fauxAssistantMessage(
				"The experienced idle specialist now holds the ready review; the API decision remains blocked.",
			),
		);
		await manager.run.session.prompt(
			"Inspect the work and relevant experience, assign the ready review, then inspect the result.",
		);
		const results = manager.run.session.messages.slice(start).filter((message) => message.role === "toolResult");
		expect(results.map((result) => result.toolName)).toEqual(["org_work", "org_expertise", "assign", "org_work"]);
		for (const result of results) expect(result.isError).toBe(false);
		const before = results[0].details as ReturnType<typeof workIn>;
		const experience = results[1].details as {
			people: { ref: string; reads: number; status: string; tasks: unknown[] }[];
		};
		const after = results[3].details as ReturnType<typeof workIn>;
		expect(before.ready).toContainEqual(expect.objectContaining({ ref: `task:${ready.id}`, holders: [] }));
		expect(before.waiting).toContainEqual(
			expect.objectContaining({ ref: `task:${blocked.id}`, waits: [`link:${decision.id}`] }),
		);
		expect(experience.people).toContainEqual(
			expect.objectContaining({ ref: `person:${specialist.id}`, reads: 1, status: "idle", tasks: [] }),
		);
		expect(after.ready.map((task) => task.ref)).not.toContain(`task:${ready.id}`);
		expect(after.inProgress).toContainEqual(
			expect.objectContaining({ ref: `task:${ready.id}`, holders: [`person:${specialist.id}`] }),
		);
		expect(after.waiting).toContainEqual(
			expect.objectContaining({ ref: `task:${blocked.id}`, waits: [`link:${decision.id}`] }),
		);
		expect(manager.run.session.agent.state.systemPrompt).toContain("## Adapt with evidence");
	} finally {
		await close(specialist.run);
		await close(manager.run);
	}
}, 40000);

test("a managing role inspects held work through org_work", async () => {
	const who = await person(undefined, "coordinator");
	try {
		const task = await who.invoke("take_task", { goal: "Ship the change.", title: "Change" });
		const work = await who.invoke<{ inProgress: { ref: string; holders: string[] }[] }>("org_work", { task: task.id });
		expect(work.inProgress).toEqual([
			expect.objectContaining({ ref: `task:${task.id}`, holders: [`person:${who.id}`] }),
		]);
	} finally {
		await close(who.run);
	}
}, 30000);

test("a manager sees a wait its report recorded, grouped under what it waits on", async () => {
	const manager = await person(undefined, "coordinator");
	const engineer = await person(manager.id);
	try {
		const task = await engineer.invoke("take_task", { goal: "Ship the API.", title: "API" });
		await engineer.invoke("link", {
			from: `task:${task.id}`,
			to: `person:${manager.id}`,
			relation: "requires_decision",
			reason: "Which version?",
		});
		type Waits = { open: number; targets: { ref: string; waits: { reason: string }[] }[] };
		const waits = await manager.invoke<Waits>("org_waits", {});
		expect(waits).toMatchObject({
			open: 1,
			targets: [{ ref: `person:${manager.id}`, waits: [{ reason: "Which version?" }] }],
		});
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("/org shares the native organization snapshot counts and references without a model turn", async () => {
	const manager = await person(undefined, "coordinator");
	const report = await person(manager.id);
	const notices: string[] = [];
	try {
		await manager.run.session.bindExtensions({ uiContext: { notify: (text: string) => notices.push(text) } as never });
		await manager.invoke("take_task", { goal: "Review API.", title: "API review" });
		await manager.invoke("take_task", { goal: "Review UI.", title: "UI review" });
		const ready = await manager.invoke("take_task", { goal: "Ready work.", title: "Ready work" });
		await manager.invoke("unassign", { person: manager.id, task: ready.id });
		const blocked = await report.invoke("take_task", { goal: "Blocked work.", title: "Blocked work" });
		await report.invoke("link", {
			from: `task:${blocked.id}`,
			to: `person:${manager.id}`,
			relation: "requires_decision",
		});
		await report.invoke("escalate", { body: "Need a decision." });
		const turns = manager.run.requests.length;
		await manager.run.session.prompt("/org");
		expect(manager.run.requests).toHaveLength(turns);
		const text = notices.at(-1)!;
		const until = text.split("\n")[0].split(" at ")[1];
		expect(Date.parse(until)).not.toBeNaN();
		const waits = await manager.invoke<ReturnType<typeof waitsIn>>("org_waits", { until });
		const work = await manager.invoke<ReturnType<typeof workIn>>("org_work", { until });
		const communication = await manager.invoke<ReturnType<typeof communicationIn>>("org_communication", {
			since: new Date(Date.parse(until) - 3_600_000).toISOString(),
			until,
		});
		expect(waits.open).toBe(1);
		expect(work.ready).toHaveLength(1);
		expect(work.multiple).toHaveLength(1);
		expect(text).toContain(`Open waits: ${waits.open}, on ${waits.targets.length} targets.`);
		expect(text).toContain(`Ready unowned work: ${work.ready.length}`);
		expect(text).toContain(`Multiple-task holders: ${work.multiple.length}`);
		for (const target of waits.targets) {
			expect(text).toContain(`- ${target.ref}: ${target.waits.length} waits;`);
			for (const wait of target.waits) expect(text).toContain(wait.ref);
		}
		for (const task of work.ready) expect(text).toContain(task.ref);
		for (const holder of work.multiple) {
			expect(text).toContain(holder.person);
			for (const task of holder.tasks) expect(text).toContain(task);
		}
		expect(communication.requests).toMatchObject([
			{ person: `person:${manager.id}`, decisions: [expect.any(String)], escalations: [expect.any(String)] },
		]);
		expect(text).toContain(
			`Pending decisions: ${communication.requests.reduce((n, request) => n + request.decisions.length, 0)}; escalations: ${communication.requests.reduce((n, request) => n + request.escalations.length, 0)}`,
		);
		for (const request of communication.requests) {
			expect(text).toContain(request.person);
			for (const ref of [...request.decisions, ...request.escalations]) expect(text).toContain(ref);
		}
	} finally {
		await close(report.run);
		await close(manager.run);
	}
}, 40000);

test("/org expertise shares area and spaced-person rendering, and preserves explicit-person errors", async () => {
	const manager = await person(undefined, "coordinator");
	const report = await person(manager.id);
	const notices: string[] = [];
	const errors: string[] = [];
	try {
		await manager.run.session.bindExtensions({
			uiContext: { notify: (text: string) => notices.push(text), setStatus: () => {} } as never,
			onError: (error) => errors.push(error.error),
		});
		report.run.session.setSessionName("Ada Example");
		await report.invoke("read", { path: "app.ts" });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select name from sessions where id = ?", report.id)).toEqual([
				{ name: "Ada Example" },
			]),
		);
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from messages where session_id = ? and tool = 'read'", report.id).length,
			).toBeGreaterThan(0),
		);
		await manager.invoke("org_expertise", { area: "app.ts" });
		const area = manager.run.session.messages.filter((message) => message.role === "toolResult").at(-1)!;
		await manager.run.session.prompt("/org expertise app.ts");
		expect(notices.at(-1)).toBe((area.content[0] as { text: string }).text);
		expect(notices.at(-1)).toContain(`person:${report.id}`);
		await manager.invoke("org_expertise", { person: report.id });
		const personView = manager.run.session.messages.filter((message) => message.role === "toolResult").at(-1)!;
		for (const argument of ["Ada Example", report.id, "person:Ada Example"]) {
			const count = notices.length;
			await manager.run.session.prompt(`/org expertise ${argument}`);
			expect(notices).toHaveLength(count + 1);
			expect(notices.at(-1)).toBe((personView.content[0] as { text: string }).text);
		}
		manager.run.session.setSessionName("Root Example");
		await manager.invoke("read", { path: "app.ts" });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select name from sessions where id = ?", manager.id)).toEqual([
				{ name: "Root Example" },
			]),
		);
		await manager.invoke("org_expertise", { person: manager.id });
		const selfView = manager.run.session.messages.filter((message) => message.role === "toolResult").at(-1)!;
		for (const argument of ["Root Example", manager.id, "person:Root Example", `person:${manager.id}`]) {
			const count = notices.length;
			await manager.run.session.prompt(`/org expertise ${argument}`);
			expect(notices).toHaveLength(count + 1);
			expect(notices.at(-1)).toBe((selfView.content[0] as { text: string }).text);
		}
		expect(errors).toEqual([]);
		await manager.run.session.prompt("/org expertise person:Unknown Person");
		expect(errors.at(-1)).toMatch(/Nobody in your organization is named Unknown Person/);
	} finally {
		await close(report.run);
		await close(manager.run);
	}
}, 40000);

test("/org expertise rejects duplicate names including the caller, while IDs select native views", async () => {
	const manager = await person(undefined, "coordinator");
	const first = await person(manager.id);
	const second = await person(manager.id);
	const notices: string[] = [];
	const errors: string[] = [];
	try {
		await manager.run.session.bindExtensions({
			uiContext: { notify: (text: string) => notices.push(text), setStatus: () => {} } as never,
			onError: (error) => errors.push(error.error),
		});
		first.run.session.setSessionName("Shared Name");
		second.run.session.setSessionName("Shared Name");
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select id from sessions where name = 'Shared Name' order by id")).toEqual(
				[first.id, second.id].sort().map((id) => ({ id })),
			),
		);
		for (const includeCaller of [false, true]) {
			if (includeCaller) {
				second.run.session.setSessionName("Other Name");
				manager.run.session.setSessionName("Shared Name");
				await vi.waitFor(() =>
					expect(query(state.dbPath, "select id from sessions where name = 'Shared Name' order by id")).toEqual(
						[first.id, manager.id].sort().map((id) => ({ id })),
					),
				);
			}
			for (const argument of ["Shared Name", "person:Shared Name"]) {
				const count = notices.length;
				const failures = errors.length;
				await manager.run.session.prompt(`/org expertise ${argument}`);
				expect(errors).toHaveLength(failures + 1);
				expect(errors.at(-1)).toBe("More than one person is named Shared Name; use the session id.");
				expect(notices).toHaveLength(count);
			}
			for (const id of includeCaller ? [manager.id, first.id] : [first.id, second.id]) {
				await manager.invoke("org_expertise", { person: id });
				const native = manager.run.session.messages.filter((message) => message.role === "toolResult").at(-1)!;
				const count = notices.length;
				await manager.run.session.prompt(`/org expertise person:${id}`);
				expect(notices).toHaveLength(count + 1);
				expect(notices.at(-1)).toBe((native.content[0] as { text: string }).text);
			}
		}
	} finally {
		await close(second.run);
		await close(first.run);
		await close(manager.run);
	}
}, 40000);

test("/org fitness reuses the native breakdown and incomplete or unknown forms show help", async () => {
	const who = await person(undefined, "coordinator");
	const notices: string[] = [];
	try {
		await who.run.session.bindExtensions({ uiContext: { notify: (text: string) => notices.push(text) } as never });
		const task = await who.invoke("take_task", {
			goal: "Deliver the priced result.",
			title: "Priced result",
			value: 25,
		});
		writeFileSync(join(task.bundle, "retrospective.md"), "# Retrospective\n\nDelivered the priced result.\n");
		await who.invoke("finish_task", { outcome: "Delivered the priced result." });
		await who.run.session.prompt("/org fitness 1h");
		const text = notices.at(-1)!;
		const [, since, until] = text.split("\n")[0].match(/from (\S+) to (\S+)\./)!;
		await who.invoke("org_fitness", { since, until });
		const native = who.run.session.messages.filter((message) => message.role === "toolResult").at(-1)!;
		expect(native.details).toMatchObject({ value: 25 });
		expect(text).toBe((native.content[0] as { text: string }).text);
		for (const args of ["unknown", "fitness", "expertise"]) {
			const count = notices.length;
			await who.run.session.prompt(`/org ${args}`);
			expect(notices).toHaveLength(count + 1);
			expect(notices.at(-1)).toContain("/org fitness <since>");
			expect(notices.at(-1)).toContain("/org expertise <area or person>");
			expect(notices.at(-1)).toContain("person:<name-or-id>");
		}
	} finally {
		await close(who.run);
	}
}, 30000);

test("a database before lifecycle tracking gains task lifecycle columns and keeps its rows", () => {
	const path = join(mkdtempSync(join(tmpdir(), "apple-pi-lifecycle-")), "state.db");
	const db = new DatabaseSync(path);
	try {
		migrate(db);
		db.exec(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, archived_at) values ('t', '/b', '/p', 'o', 1, 'task:t', 900), ('u', '/c', '/p', 'o', 0, 'task:u', null)",
		);
		db.exec(
			"insert into assignments (person, task_id, assigned_by, assigned_at) values ('a', 't', 'm', 700), ('b', 't', 'm', 500), ('a', 'u', 'm', 800)",
		);
		// Back to the version before the lifecycle columns: the links table came after them.
		db.exec(
			"drop table links; alter table work_tasks drop column opened_at; alter table work_tasks drop column close_status",
		);
		db.exec("drop index events_by_type; pragma user_version = 24");
		migrate(db);
		// Opened at the first assignment; an archived ephemeral task closed done.
		expect(db.prepare("select id, opened_at, close_status from work_tasks order by id").all()).toEqual([
			{ id: "t", opened_at: 500, close_status: "done" },
			{ id: "u", opened_at: 800, close_status: null },
		]);
	} finally {
		db.close();
	}
});

test("directory profiles keep current responsibility concise and retrieve only requested finished-assignment history", async () => {
	const who = await person(undefined, "coordinator");
	type Profile = {
		id: string;
		availability: string;
		focus: { id: string; title: string } | null;
		tasks: { id: string }[];
		finished: number;
	};
	type History = { total: number; nextOffset: number | null; record: { outcome: string; endReason: string }[] };
	try {
		const ledger = await addLedgerTask(who.run.cwd, "Review release readiness", "Check the release evidence");
		const overview = await who.invoke("directory", {});
		expect(overview).not.toHaveProperty("members");
		expect(overview).not.toHaveProperty("backlog");
		let profile = await who.invoke<Profile>("directory", { person: who.id });
		expect(profile).toMatchObject({ availability: "available", focus: null, tasks: [], finished: 0 });
		const task = await who.invoke("take_task", { task: join(who.run.cwd, ".ledger", ledger.taskId) });
		await packets(who.run, 1);
		profile = await who.invoke<Profile>("directory", { person: who.id });
		expect(profile).toMatchObject({
			availability: "assigned",
			focus: { id: task.id, title: "Review release readiness" },
			tasks: [expect.objectContaining({ id: task.id })],
			finished: 0,
		});
		await who.invoke("unassign", { person: who.id, task: task.id });
		profile = await who.invoke<Profile>("directory", { person: who.id });
		expect(profile).toMatchObject({ availability: "available", focus: null, tasks: [], finished: 0 });
		expect(await who.invoke<History>("directory", { person: who.id, history: { limit: 1 } })).toMatchObject({
			total: 0,
			record: [],
			nextOffset: null,
		});
		await who.invoke("take_task", { task: task.id });
		await packets(who.run, 2);
		const outcome = "Release checks passed; load behavior remains unverified.";
		await who.invoke("finish_task", { outcome });
		profile = await who.invoke<Profile>("directory", { person: who.id });
		expect(profile).toMatchObject({ availability: "available", focus: null, tasks: [], finished: 1 });
		expect(JSON.stringify(profile)).not.toContain(outcome);
		expect(profile).not.toHaveProperty("record");
		expect(await who.invoke<History>("directory", { person: who.id, history: { limit: 1 } })).toMatchObject({
			total: 1,
			nextOffset: null,
			record: [{ endReason: "finished", outcome }],
		});
		expect(await who.invoke<History>("directory", { person: who.id, history: { limit: 1, offset: 1 } })).toMatchObject({
			total: 1,
			nextOffset: null,
			record: [],
		});
	} finally {
		await close(who.run);
	}
}, 30000);
