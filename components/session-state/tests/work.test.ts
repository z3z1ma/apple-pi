import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import installLedger from "../../../extensions/ledger.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { addLedgerTask } from "../../shared/src/ledger-files.js";
import bridge from "../src/index.js";
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
async function person(manager?: string) {
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
	);
	const id = run.session.sessionManager.getSessionId();
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

test("taking, switching, rereading, and compaction append the explicit goal; finishing archives informal work and its retrospective", async () => {
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
		const finished = await who.invoke("finish_task", {
			outcome: "Queue blockage verified against the trace; no retry cause found.",
		});
		expect(query(state.dbPath, "select sender, receiver from mail where receiver = ?", who.id)).toEqual([]);
		expect(finished.bundle).toContain("/tasks/history/");
		expect(existsSync(first.bundle)).toBe(false);
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
	const manager = await person();
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
	const manager = await person();
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
	const manager = await person();
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

test("anyone reads their organization's realized fitness over a window they name", async () => {
	const manager = await person();
	const engineer = await person(manager.id);
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

test("a nonmanager compares optional scenarios and reads recorded predictions through native tools", async () => {
	const manager = await person();
	const engineer = await person(manager.id);
	try {
		expect(engineer.run.session.getActiveToolNames()).not.toContain("hire");
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

test("anyone finds who has context on an area from what people actually read", async () => {
	const manager = await person();
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
	const manager = await person();
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
	const manager = await person();
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

test("a person inspects held work through org_work", async () => {
	const who = await person();
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
	const manager = await person();
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
		db.exec("pragma user_version = 24");
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

test("the directory shows availability, assigned work, focus, ended outcomes, and the unassigned ledger backlog", async () => {
	const who = await person();
	type Directory = {
		members: {
			id: string;
			availability: string;
			focus: { id: string; title: string } | null;
			tasks: { id: string }[];
			record: { outcome: string; endReason: string }[];
		}[];
		backlog: { id: string; bundle: string; title: string }[];
	};
	try {
		const ledger = await addLedgerTask(who.run.cwd, "Review release readiness", "Check the release evidence");
		let directory = await who.invoke<Directory>("directory", {});
		expect(directory.members.find((m) => m.id === who.id)).toMatchObject({
			availability: "available",
			focus: null,
			tasks: [],
			record: [],
		});
		expect(directory.backlog).toContainEqual(expect.objectContaining({ title: "Review release readiness" }));
		const task = await who.invoke("take_task", {
			task: directory.backlog.find((entry) => entry.bundle.endsWith(ledger.taskId))!.id,
		});
		await packets(who.run, 1);
		directory = await who.invoke<Directory>("directory", {});
		expect(directory.backlog).toEqual([]);
		expect(directory.members.find((m) => m.id === who.id)).toMatchObject({
			availability: "assigned",
			focus: { id: task.id, title: "Review release readiness" },
			tasks: [expect.objectContaining({ id: task.id })],
		});
		await who.invoke("unassign", { person: who.id, task: task.id });
		directory = await who.invoke<Directory>("directory", {});
		expect(directory.members.find((m) => m.id === who.id)).toMatchObject({
			availability: "available",
			focus: null,
			tasks: [],
			record: [],
		});
		expect(directory.backlog).toContainEqual(expect.objectContaining({ id: task.id }));
		await who.invoke("take_task", { task: task.id });
		await packets(who.run, 2);
		await who.invoke("finish_task", { outcome: "Release checks passed; load behavior remains unverified." });
		directory = await who.invoke<Directory>("directory", {});
		expect(directory.members.find((m) => m.id === who.id)).toMatchObject({
			availability: "available",
			focus: null,
			tasks: [],
			record: [
				expect.objectContaining({
					endReason: "finished",
					outcome: "Release checks passed; load behavior remains unverified.",
				}),
			],
		});
	} finally {
		await close(who.run);
	}
}, 30000);
