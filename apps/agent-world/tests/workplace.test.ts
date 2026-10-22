import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import type { Command } from "../../../components/session-state/src/protocol.js";
import {
	close,
	fakeBridge,
	query,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { openCommands } from "../src/backend/commands.js";
import { taskReader } from "../src/backend/facts.js";
import { openMailbox } from "../src/backend/mail.js";
import { openWorkplace, workplaceReader } from "../src/backend/workplace.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

function ledger(project: string, id: string, title: string, status = "ready") {
	const bundle = join(project, ".ledger", id);
	mkdirSync(bundle, { recursive: true });
	writeFileSync(join(bundle, "task.md"), `# ${title}\n\nStatus: ${status}\n\nThe written goal.\n`);
	return bundle;
}

test("the workplace reads shared threads and goals, discovers backlog without registering it, and assigns through the runtime", async () => {
	const state = tempStateDir();
	const process = standInProcess();
	const project = join(realpathSync(state.agentDir), "project");
	mkdirSync(project);
	const bundle = ledger(project, "202610220001-invoices", "Retry invoices");
	ledger(project, "202610220002-finished", "Already done", "done");
	ledger(project, "history/202610220003-old", "Old task");
	mkdirSync(join(project, ".ledger", "202610220000-empty"));
	await startRuntime(state.socketPath);
	const lead = await fakeBridge(state.socketPath, "lead", process.pid, process.startedAt, {
		session: { cwd: project, name: "Lead" },
		facts: { manages: true },
	});
	const worker = await fakeBridge(state.socketPath, "worker", process.pid, process.startedAt, {
		session: { cwd: project, name: "Writer" },
		facts: { reportsTo: "lead" },
	});
	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const commands = openCommands(state.socketPath);
	const workplace = openWorkplace(state.dbPath, commands, () => world.snapshot());
	const send = async (from: string, command: Command) =>
		expect((await sendCommand(state.socketPath, from, command)).at(-1)).toMatchObject({ stage: "applied" });
	try {
		await vi.waitFor(() => expect(world.snapshot().characters).toHaveLength(2), { timeout: 10000 });
		expect(query(state.dbPath, "select reports_to from sessions where id = 'worker'")).toEqual([
			{ reports_to: "lead" },
		]);
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.tasks).toEqual([
					expect.objectContaining({
						id: bundle,
						title: "Retry invoices",
						headquarters: "lead",
						ephemeral: false,
						assignees: [],
					}),
				]),
			{ timeout: 10000 },
		);
		expect(query(state.dbPath, "select * from work_tasks")).toEqual([]);
		expect(await workplace.readTask(bundle)).toMatchObject({
			ok: true,
			text: expect.stringContaining("The written goal."),
		});
		expect(await workplace.readTask("/etc/passwd")).toMatchObject({ ok: false });
		await send("lead", { kind: "thread_post", thread: "team:lead", body: "Deployment needs a review." });
		await send("lead", {
			kind: "thread_post",
			thread: "meeting",
			threadKind: "meeting",
			subject: "Release decision",
			to: ["worker"],
			body: "Can we release?",
		});
		await send("lead", {
			kind: "thread_post",
			thread: "private",
			subject: "Private mail",
			to: ["worker"],
			body: "For your eyes.",
		});
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.threads).toContainEqual(
					expect.objectContaining({
						id: "meeting",
						kind: "meeting",
						headquarters: "lead",
						closed: false,
						participants: ["lead", "worker"],
					}),
				),
			{ timeout: 10000 },
		);
		expect(world.snapshot().characters.map((person) => person.place)).toEqual([
			{ kind: "meeting-room", headquarters: "lead" },
			{ kind: "meeting-room", headquarters: "lead" },
		]);
		const cursors = query(
			state.dbPath,
			"select participant, read_up_to from thread_participants where thread_id = 'team:lead'",
		);
		expect(await workplace.readWorkplaceThread("team:lead")).toMatchObject({
			ok: true,
			thread: { messages: [expect.objectContaining({ body: "Deployment needs a review." })] },
		});
		expect(
			query(state.dbPath, "select participant, read_up_to from thread_participants where thread_id = 'team:lead'"),
		).toEqual(cursors);
		expect(await workplace.readWorkplaceThread("private")).toMatchObject({ ok: false });
		expect(await workplace.assignTask("worker", bundle)).toEqual({ ok: true, stage: "applied" });
		expect(query(state.dbPath, "select person, assigned_by from assignments where ended_at is null")).toEqual([
			{ person: "worker", assigned_by: "operator" },
		]);
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.tasks[0]).toMatchObject({
					title: "Retry invoices",
					assignees: [{ person: "worker", focused: true }],
					thread: expect.any(String),
				}),
			{ timeout: 10000 },
		);
		expect(world.snapshot().characters.find((person) => person.id === "worker")?.facts?.task?.title).toBe(
			"Retry invoices",
		);
		await send("lead", { kind: "work", action: "take", goal: "Investigate the empty invoice", cwd: project });
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.tasks).toContainEqual(
					expect.objectContaining({
						ephemeral: true,
						headquarters: "lead",
						assignees: [{ person: "lead", focused: true }],
					}),
				),
			{ timeout: 10000 },
		);
		await send("lead", { kind: "thread_post", thread: "meeting", body: "Ship after review.", closeMeeting: true });
		await vi.waitFor(
			() => expect(world.snapshot().workplace?.threads.some((thread) => thread.id === "meeting")).toBe(false),
			{ timeout: 10000 },
		);
		expect(await workplace.readWorkplaceThread("meeting")).toMatchObject({ ok: true, thread: { closed: true } });
		expect(world.snapshot().characters.find((person) => person.id === "worker")?.place).toEqual({
			kind: "common-room",
			headquarters: "lead",
		});
		const newBundle = ledger(project, "202610220004-follow-up", "Check receipts");
		writeFileSync(join(bundle, "task.md"), "# Retry invoices safely\n\nStatus: in-progress\n");
		await vi.waitFor(
			() => {
				expect(world.snapshot().workplace?.tasks).toContainEqual(
					expect.objectContaining({ id: newBundle, assignees: [] }),
				);
				expect(world.snapshot().workplace?.tasks).toContainEqual(
					expect.objectContaining({ title: "Retry invoices safely", status: "in-progress" }),
				);
			},
			{ timeout: 10000 },
		);
		expect(query(state.dbPath, "select * from work_tasks where bundle = ?", newBundle)).toEqual([]);
		writeFileSync(join(bundle, "task.md"), "# Retry invoices safely\n\nStatus: done\n");
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.tasks.find((task) => task.bundle === bundle)).toMatchObject({
					status: "done",
					assignees: [{ person: "worker", focused: true }],
				}),
			{ timeout: 5000 },
		);
		await send("worker", { kind: "work", action: "finish", outcome: "Invoice retries verified.", cwd: project });
		await vi.waitFor(
			() => expect(world.snapshot().workplace?.tasks.some((task) => task.bundle === bundle)).toBe(false),
			{ timeout: 10000 },
		);
		await send("lead", { kind: "work", action: "finish", outcome: "Verified the cause.", cwd: project });
		await vi.waitFor(() => expect(world.snapshot().workplace?.tasks.some((task) => task.ephemeral)).toBe(false), {
			timeout: 10000,
		});
		const other = await fakeBridge(state.socketPath, "other", process.pid, process.startedAt, {
			session: { cwd: project },
		});
		try {
			await vi.waitFor(() => expect(world.snapshot().characters).toHaveLength(3), { timeout: 10000 });
			const foreign = ledger(project, "202610220005-other-team", "Another team's work");
			await send("other", { kind: "work", action: "take", task: foreign, cwd: project });
			await vi.waitFor(
				() =>
					expect(world.snapshot().workplace?.tasks.filter((task) => task.bundle === foreign)).toEqual([
						expect.objectContaining({ headquarters: "other", assignees: [{ person: "other", focused: true }] }),
					]),
				{ timeout: 10000 },
			);
			expect(await workplace.assignTask("worker", foreign)).toMatchObject({ ok: false });
		} finally {
			other.socket.destroy();
		}
	} finally {
		world.close();
		commands.close();
		lead.socket.destroy();
		worker.socket.destroy();
		process.child.kill();
		await stopRuntime(state);
	}
}, 40000);

test("a native escalation appears until the operator reads it, without depending on the sender's run state", async () => {
	const state = tempStateDir();
	await startRuntime(state.socketPath);
	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const commands = openCommands(state.socketPath);
	const mailbox = openMailbox(state.dbPath, commands);
	const author = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage([fauxToolCall("escalate", { body: "This needs your release decision." })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("I can keep checking the evidence."),
		],
		[],
	);
	try {
		await author.session.prompt("escalate");
		expect(author.session.messages.filter((message) => message.role === "toolResult").at(-1)).toMatchObject({
			isError: false,
		});
		const id = author.session.sessionManager.getSessionId();
		await vi.waitFor(
			() =>
				expect(world.snapshot().workplace?.escalations).toEqual([
					{ person: id, headquarters: id, thread: expect.any(String) },
				]),
			{ timeout: 10000 },
		);
		expect(world.snapshot().characters.find((person) => person.id === id)).toMatchObject({
			role: "independent",
			place: { kind: "headquarters", headquarters: id },
		});
		const escalation = world.snapshot().workplace!.escalations[0];
		expect(await mailbox.readThread(escalation.thread)).toMatchObject({ ok: true });
		await vi.waitFor(() => expect(world.snapshot().workplace?.escalations).toEqual([]), { timeout: 10000 });
		expect(world.snapshot().characters.find((person) => person.id === id)?.place).toEqual({ kind: "square" });
	} finally {
		await close(author);
		world.close();
		commands.close();
		await stopRuntime(state);
	}
}, 30000);

test("a runtime that has not migrated workplace tables yields no invented work", () => {
	const db = new DatabaseSync(":memory:");
	try {
		expect(workplaceReader(taskReader())(db, [], true)).toEqual({ threads: [], tasks: [], escalations: [] });
	} finally {
		db.close();
	}
});
