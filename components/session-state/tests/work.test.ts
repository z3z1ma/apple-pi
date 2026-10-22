import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import installLedger from "../../../extensions/ledger.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { addLedgerTask } from "../../shared/src/ledger-files.js";
import bridge from "../src/index.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
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
		() => script.shift() ?? fauxAssistantMessage("noted"),
		["ledger_status"],
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
	return { run, id, invoke, script };
}
function goalPackets(run: Awaited<ReturnType<typeof fauxSession>>) {
	return run.session.messages.filter(
		(m) =>
			m.role === "custom" &&
			(m.customType === MAIL_CUSTOM_TYPE || m.customType === TASK_GOAL_CUSTOM_TYPE) &&
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
		const first = await who.invoke("take_task", { goal: "Find why requests stall.\nVerify the slow path." });
		expect(first.ephemeral).toBe(1);
		expect(first.bundle).toContain("/state/tasks/");
		expect(readFileSync(join(first.bundle, "task.md"), "utf8")).toContain("Verify the slow path.");
		expect(existsSync(join(first.bundle, "retrospective.md"))).toBe(true);
		await packets(who.run, 1);
		const second = await who.invoke("take_task", { goal: "Compare the retry policy." });
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
		await manager.invoke("assign", { person: reviewer.id, task: task.id });
		await packets(reviewer.run, 1);
		const partial = await engineer.invoke("finish_task", {
			outcome: "Verified invalidation after every write; confidence high.",
		});
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
		const task = await who.invoke("take_task", { goal: "Measure the queue" });
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
