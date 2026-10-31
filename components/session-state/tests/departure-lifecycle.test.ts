import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { readStoredThread } from "../../../apps/agent-world/src/backend/mail.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { sendCommand } from "../src/client.js";
import { realizedFitness } from "../src/fitness.js";
import bridge from "../src/index.js";
import { openPeerProgram } from "../src/program-client.js";
import { migrate } from "../src/schema.js";
import { close, query, runtimePid, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const people: ChildProcess[] = [];
const managers: Awaited<ReturnType<typeof fauxSession>>[] = [];
const legacyActive = randomUUID();
const legacyFormer = randomUUID();
beforeAll(async () => {
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	for (const [id, retired] of [
		[legacyActive, null],
		[legacyFormer, 1],
	] as const) {
		db.prepare(
			"insert into sessions (id, kind, cwd, retired_at, run_state, generation, source, updated_at) values (?, 'root', ?, ?, 'idle', 0, 'runtime', 1)",
		).run(id, state.agentDir, retired);
		db.prepare("insert into events (at, source, session_id, type, data) values (1, 'runtime', ?, 'retired', '{}')").run(
			id,
		);
		if (retired === null)
			db.prepare(
				"insert into events (at, source, session_id, type, data) values (2, 'runtime', ?, 'rehired', '{}')",
			).run(id);
	}
	db.close();
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "pi"),
		`#!${process.execPath}
(async () => {
 const { DatabaseSync } = await import('node:sqlite');
 const args = process.argv.slice(2);
 const id = args[args.indexOf('--session-id') + 1];
 const db = new DatabaseSync(${JSON.stringify(state.dbPath)}, { readOnly: true });
 const row = db.prepare('select cwd, session_file, reports_to from sessions where id = ?').get(id);
 db.close();
 process.argv[2] = JSON.stringify({ cwd: row.cwd, person: id, manager: row.reports_to, file: row.session_file || undefined,
  statusFile: ${JSON.stringify(state.agentDir)} + '/launch-' + id + '.ndjson' });
 await import(${JSON.stringify(new URL("../src/register.mjs", import.meta.url).href)});
 await import(${JSON.stringify(new URL("./fixtures/departure-person.ts", import.meta.url).href)});
})().catch(error => { console.error(error); process.exit(1); });
`,
	);
	chmodSync(join(bin, "pi"), 0o755);
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	await startRuntime(state.socketPath);
});
afterEach(async () => {
	for (const child of people.splice(0))
		if (child.exitCode === null && child.signalCode === null) {
			const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
			child.kill("SIGKILL");
			await exited;
		}
	for (const manager of managers.splice(0)) await close(manager);
});
afterAll(() => stopRuntime(state));

async function organization() {
	let target = "";
	let handoff: boolean | undefined;
	const errors: unknown[] = [];
	const manager = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1);
			return last?.role === "user" && JSON.stringify(last.content).includes("REQUEST_LET_GO_ONLY")
				? fauxAssistantMessage(
						[
							fauxToolCall("let_go", {
								person: target,
								reason: "The verified work is complete.",
								...(handoff === undefined ? {} : { handoff }),
							}),
						],
						{
							stopReason: "toolUse",
						},
					)
				: fauxAssistantMessage("Noted.");
		},
		[],
	);
	managers.push(manager);
	manager.session.extensionRunner.setFlagValue("role", "coordinator");
	await manager.session.bindExtensions({ onError: (error) => errors.push(error) });
	const id = manager.session.sessionManager.getSessionId();
	return {
		...manager,
		id,
		errors,
		target: (person: string, requestedHandoff?: boolean) => {
			target = person;
			handoff = requestedHandoff;
		},
	};
}

interface HostEvent {
	type: string;
	person?: string;
	file?: string;
	retained?: boolean;
	signal?: string;
}
async function person(
	manager: string | null,
	options: {
		role?: string;
		holdHandoff?: boolean;
		busy?: boolean;
		emptyHandoff?: boolean;
		afterClose?: "exit" | "hold" | "switch";
		successor?: string;
		person?: string;
		file?: string;
		flagFree?: boolean;
		expectRejection?: boolean;
	} = {},
) {
	const { expectRejection, ...configuration } = options;
	const id = options.person ?? randomUUID();
	const cwd = join(state.agentDir, id);
	mkdirSync(cwd, { recursive: true });
	const events: HostEvent[] = [];
	let log = "";
	const child = fork(
		new URL("./fixtures/departure-person.ts", import.meta.url),
		[JSON.stringify({ ...configuration, person: id, manager, cwd })],
		{
			execArgv: ["--import", new URL("../src/register.mjs", import.meta.url).href],
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		},
	);
	people.push(child);
	child.on("message", (message) => events.push(message as HostEvent));
	child.stdout?.on("data", (chunk) => {
		log += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		log += String(chunk);
	});
	await vi.waitFor(
		() =>
			expect(
				events.find((event) => event.type === "ready"),
				log,
			).toBeDefined(),
		{ timeout: 10000 },
	);
	const file = events.find((event) => event.type === "ready")!.file!;
	if (!expectRejection)
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = ?", id)).toEqual([
				{ reports_to: manager },
			]),
		);
	return { id, cwd, child, events, file };
}

async function request(manager: Awaited<ReturnType<typeof organization>>, id: string, handoff?: boolean) {
	manager.target(id, handoff);
	await manager.session.prompt("REQUEST_LET_GO_ONLY", { streamingBehavior: "followUp" });
	const result = manager.session.messages.findLast(
		(message) => message.role === "toolResult" && message.toolName === "let_go",
	);
	expect(result?.role).toBe("toolResult");
	if (result?.role !== "toolResult") throw new Error("Missing native let_go result");
	expect(result.isError).toBe(false);
	expect(result.details).toMatchObject({ sessionId: id, stage: "accepted" });
	return (result.details as { commandId: string }).commandId;
}
async function operatorDeparture(id: string, handoff?: boolean) {
	const receipt = await sendCommand(
		id,
		{
			kind: "retire",
			reason: "The verified work is complete.",
			by: "operator",
			...(handoff === undefined ? {} : { handoff }),
		},
		{ socketPath: state.socketPath, until: "accepted" },
	);
	expect(receipt.stage, receipt.reason).toBe("accepted");
	return receipt.commandId;
}
const stage = (id: string) => query(state.dbPath, "select stage from commands where command_id = ?", id)[0]?.stage;
const command = async (id: string, value: Parameters<typeof sendCommand>[1]) => {
	const receipt = await sendCommand(id, value, { socketPath: state.socketPath });
	expect(receipt.stage, receipt.reason).toBe("applied");
	return receipt;
};

test.each([undefined, "implementation-engineer"])(
	"operator lets an independent %s person leave through handoff and private cleanup",
	async (role) => {
		const worker = await person(null, { role, holdHandoff: true });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select role, reports_to from sessions where id = ?", worker.id)).toEqual([
				{ role: role ?? null, reports_to: null },
			]),
		);
		const commandId = await operatorDeparture(worker.id);
		await vi.waitFor(() => expect(worker.events.some((event) => event.type === "handoff")).toBe(true));
		expect(existsSync(worker.file)).toBe(true);
		worker.child.send("release");
		await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
		expect(query(state.dbPath, "select 1 from sessions where id = ?", worker.id)).toEqual([]);
		expect(existsSync(worker.file)).toBe(false);
		const departure = JSON.parse(
			query<{ data: string }>(
				state.dbPath,
				"select data from events where session_id = ? and type = 'person_departed'",
				worker.id,
			)[0]!.data,
		);
		expect(departure).toMatchObject({ reportsTo: null, role: role ?? null, sessionFile: null });
		expect(readFileSync(departure.handoffFile, "utf8")).toContain(
			"Verified retained context: RETAINED_DEPARTURE_FACT.",
		);
		expect(
			query(
				state.dbPath,
				"select participant from thread_participants where thread_id = ? order by participant",
				`departure:${commandId}`,
			),
		).toEqual([{ participant: "harness" }, { participant: "operator" }]);
		const repeated = await sendCommand(
			worker.id,
			{ kind: "retire", reason: "Duplicate", by: "operator" },
			{ socketPath: state.socketPath, commandId },
		);
		expect(repeated.stage).toBe("failed");
		const replayed = await sendCommand(
			worker.id,
			{ kind: "retire", reason: "The verified work is complete.", by: "operator" },
			{ socketPath: state.socketPath, commandId },
		);
		expect(replayed.stage, replayed.reason).toBe("applied");
	},
	30000,
);

test.each([
	{ native: true, asleep: false },
	{ native: true, asleep: true },
	{ native: false, asleep: false },
	{ native: false, asleep: true },
])(
	"departure without handoff skips the model and wake but completes private cleanup (%j)",
	async ({ native, asleep }) => {
		const manager = native ? await organization() : undefined;
		const worker = await person(manager?.id ?? null);
		if (asleep) {
			await command(worker.id, { kind: "close" });
			await vi.waitFor(() => expect(worker.child.exitCode).toBe(0));
		}
		const commandId = manager ? await request(manager, worker.id, false) : await operatorDeparture(worker.id, false);
		await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
		expect(query(state.dbPath, "select 1 from sessions where id = ?", worker.id)).toEqual([]);
		expect(existsSync(worker.file)).toBe(false);
		expect(worker.events.some((event) => event.type === "handoff")).toBe(false);
		expect(existsSync(join(state.agentDir, `launch-${worker.id}.ndjson`))).toBe(false);
		expect(query(state.dbPath, "select 1 from commands where command_id = ?", `${commandId}:handoff`)).toEqual([]);
		expect(query(state.dbPath, "select 1 from links where id = ?", `${commandId}:handoff-file`)).toEqual([]);
		expect(existsSync(join(state.stateDir, "handoffs", `${worker.id}.md`))).toBe(false);
		const departure = JSON.parse(
			query<{ data: string }>(
				state.dbPath,
				"select data from events where session_id = ? and type = 'person_departed'",
				worker.id,
			)[0]!.data,
		);
		expect(departure.handoffFile).toBeNull();
	},
	30000,
);

test("no-handoff departure preserves a failed first launch without observed process identity", async () => {
	const id = randomUUID();
	const start = await sendCommand(
		id,
		{
			kind: "start",
			role: "implementation-engineer",
			cwd: state.agentDir,
			prompt: "",
			tmux: { socket: join(state.agentDir, "absent-tmux.socket"), pane: "%0" },
		},
		{ socketPath: state.socketPath },
	);
	expect(start.stage, start.reason).toBe("failed");
	expect(query(state.dbPath, "select generation, retired_at from sessions where id = ?", id)).toEqual([
		{ generation: 0, retired_at: null },
	]);
	const receipt = await sendCommand(
		id,
		{ kind: "retire", reason: "Failed to start.", by: "operator", handoff: false },
		{ socketPath: state.socketPath, until: "accepted" },
	);
	await vi.waitFor(() => expect(stage(receipt.commandId)).toBe("failed"));
	expect(
		query<{ reason: string }>(state.dbPath, "select reason from commands where command_id = ?", receipt.commandId)[0]
			?.reason,
	).toContain("process identity");
	expect(query(state.dbPath, "select retired_at from sessions where id = ?", id)).toEqual([{ retired_at: null }]);
	expect(query(state.dbPath, "select 1 from events where session_id = ? and type = 'person_departed'", id)).toEqual([]);
}, 15000);

test("ordinary agents and self cannot request independent departure", async () => {
	const manager = await organization();
	const worker = await person(null);
	for (const by of [undefined, manager.id, worker.id]) {
		const receipt = await sendCommand(
			worker.id,
			{ kind: "retire", reason: "Not authorized.", ...(by ? { by } : {}) },
			{ socketPath: state.socketPath },
		);
		expect(receipt.stage).toBe("failed");
		expect(receipt.reason).toContain(by === worker.id ? "manager or the operator" : "organization root");
	}
	expect(worker.events.some((event) => event.type === "handoff")).toBe(false);
	expect(existsSync(worker.file)).toBe(true);
});

test("operator independent departure still refuses unfinished work, reports and owned program scopes", async () => {
	const refuse = async (id: string, reason: string) => {
		for (const handoff of [true, false]) {
			const receipt = await sendCommand(
				id,
				{ kind: "retire", reason: "Not ready.", by: "operator", handoff },
				{ socketPath: state.socketPath },
			);
			expect(receipt.stage).toBe("failed");
			expect(receipt.reason).toContain(reason);
		}
	};
	const assigned = await person(null);
	await command("operator", {
		kind: "work",
		action: "assign",
		cwd: assigned.cwd,
		person: assigned.id,
		goal: "Unfinished independent work.",
	});
	await refuse(assigned.id, "unfinished assignments");
	const parent = await person(null);
	await person(parent.id);
	await refuse(parent.id, "reports first");
	const caller = await person(null);
	const program = await openPeerProgram(caller.id);
	try {
		await refuse(caller.id, "program delegations");
	} finally {
		await program.close();
	}
	for (const worker of [assigned, parent, caller]) {
		expect(worker.events.some((event) => event.type === "handoff")).toBe(false);
		expect(existsSync(worker.file)).toBe(true);
	}
}, 30000);

test("native acceptance continues through the retained-session bridge, observed final spend, process exit and private cleanup", async () => {
	const manager = await organization();
	const worker = await person(manager.id, { holdHandoff: true });
	const copy = join(state.agentDir, `retained-copy-${worker.id}.jsonl`);
	copyFileSync(worker.file, copy);
	await command(manager.id, {
		kind: "work",
		action: "assign",
		cwd: worker.cwd,
		person: worker.id,
		goal: "Verify the retained fixture.",
		title: "Retained result",
		value: 12,
		cost_of_delay: 0,
	});
	await command(worker.id, { kind: "work", action: "finish", cwd: worker.cwd, outcome: "Verified shared outcome." });
	const thread = `shared-${randomUUID()}`;
	await command(worker.id, {
		kind: "thread_post",
		thread,
		subject: "Retained shared evidence",
		to: [manager.id],
		body: "Shared evidence remains readable.",
	});
	const usage = join(state.agentDir, "sidecar-usage", `${worker.id}.ndjson`);
	mkdirSync(join(state.agentDir, "sidecar-usage"), { recursive: true });
	writeFileSync(usage, "private usage\n");
	writeFileSync(`${usage}.1`, "rotated private usage\n");
	const beforeDb = new DatabaseSync(state.dbPath, { readOnly: true });
	const beforeCompute = realizedFitness(beforeDb, manager.id, 0, Date.now() + 1).compute;
	beforeDb.close();
	const commandId = await request(manager, worker.id);
	expect(stage(commandId)).toBe("accepted");
	expect(existsSync(worker.file)).toBe(true);
	expect(
		query(state.dbPath, "select 1 from events where type = 'person_departed' and session_id = ?", worker.id),
	).toHaveLength(0);
	await vi.waitFor(() =>
		expect(worker.events).toContainEqual(expect.objectContaining({ type: "handoff", retained: true })),
	);
	worker.child.send("release");
	await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
	expect(worker.child.exitCode).toBe(0);
	expect(worker.events.filter((event) => event.type === "signal" || event.type === "extension-error")).toEqual([]);
	expect([worker.file, usage, `${usage}.1`].map(existsSync)).toEqual([false, false, false]);
	expect(query(state.dbPath, "select 1 from sessions where id = ?", worker.id)).toHaveLength(0);
	expect(query(state.dbPath, "select 1 from incarnations where session_id = ?", worker.id)).toHaveLength(0);
	expect(query(state.dbPath, "select 1 from messages where session_id = ?", worker.id)).toHaveLength(0);
	const [{ data }] = query<{ data: string }>(
		state.dbPath,
		"select data from events where type = 'person_departed' and session_id = ?",
		worker.id,
	);
	const departure = JSON.parse(data) as { handoffFile: string; sessionFile: null };
	expect(departure.sessionFile).toBeNull();
	expect(readFileSync(departure.handoffFile, "utf8")).toContain(
		"\nVerified retained context: RETAINED_DEPARTURE_FACT.\nUncertainty: the next operator decision is still open.\n\n",
	);
	expect(query(state.dbPath, "select outcome from assignments where person = ?", worker.id)).toEqual([
		{ outcome: "Verified shared outcome." },
	]);
	expect(query(state.dbPath, "select 1 from thread_participants where participant = ?", worker.id)).toHaveLength(0);
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(realizedFitness(db, manager.id, 0, Date.now() + 1).compute).toBe(beforeCompute + 3);
		expect(
			readStoredThread(db, thread)?.messages.some(
				(message) =>
					message.from === worker.id &&
					message.body === "Shared evidence remains readable." &&
					message.name === "Retained Worker",
			),
		).toBe(true);
	} finally {
		db.close();
	}
	const ordered = query<{ type: string }>(
		state.dbPath,
		"select type from events where session_id = ? and (type = 'person_departed' or (type = 'cost_changed' and json_extract(data, '$.to') - json_extract(data, '$.from') = 3)) order by seq",
		worker.id,
	);
	expect(ordered.map((event) => event.type)).toEqual(["cost_changed", "person_departed"]);
	expect(existsSync(copy)).toBe(true);
	const deniedStart = await sendCommand(
		worker.id,
		{ kind: "start", cwd: worker.cwd },
		{ socketPath: state.socketPath },
	);
	expect(deniedStart.stage).toBe("failed");
	const resumed = await person(manager.id, { person: worker.id, file: copy, flagFree: true, expectRejection: true });
	await vi.waitFor(() => expect(resumed.child.exitCode).toBe(0), { timeout: 10000 });
	await vi.waitFor(() => expect(existsSync(copy)).toBe(false), { timeout: 10000 });
	expect(stage(commandId)).toBe("applied");
	expect(query(state.dbPath, "select 1 from sessions where id = ?", worker.id)).toHaveLength(0);
	expect(query(state.dbPath, "select 1 from incarnations where session_id = ?", worker.id)).toHaveLength(0);
	expect(
		query(state.dbPath, "select 1 from events where type = 'person_removed' and session_id = ?", worker.id),
	).toHaveLength(1);
	expect(
		query(state.dbPath, "select 1 from events where type = 'departure_resources_removed' and session_id = ?", worker.id)
			.length,
	).toBeGreaterThan(0);
	expect(manager.errors).toEqual([]);
}, 30000);

test("a shutdown receipt and ended incarnation do not authorize deleting files while the SDK host still lives", async () => {
	const manager = await organization();
	const worker = await person(manager.id, { afterClose: "hold" });
	const commandId = await request(manager, worker.id);
	await vi.waitFor(() => expect(worker.events.some((event) => event.type === "closed")).toBe(true), { timeout: 10000 });
	await vi.waitFor(() =>
		expect(
			query(
				state.dbPath,
				"select 1 from events where type = 'departure_cleanup_blocked' and session_id = ?",
				worker.id,
			),
		).toHaveLength(1),
	);
	expect(stage(commandId)).toBe("delivered");
	expect(worker.child.exitCode).toBeNull();
	expect(worker.events.some((event) => event.type === "signal")).toBe(false);
	expect(existsSync(worker.file)).toBe(true);
	expect(query(state.dbPath, "select 1 from sessions where id = ?", worker.id)).toHaveLength(1);
	const copy = join(state.agentDir, `pending-copy-${worker.id}.jsonl`);
	copyFileSync(worker.file, copy);
	const rejected = await person(manager.id, { person: worker.id, file: copy, flagFree: true, expectRejection: true });
	await vi.waitFor(() => expect(rejected.child.exitCode).toBe(0));
	expect([worker.file, copy].map(existsSync)).toEqual([true, true]);
	expect(
		query(
			state.dbPath,
			"select 1 from events where session_id = ? and type = 'departure_writer_seen' and json_extract(data, '$.cleanedAt') is null",
			worker.id,
		).length,
	).toBeGreaterThan(0);
	worker.child.send("exit");
	await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
	expect([worker.file, copy].map(existsSync)).toEqual([false, false]);
	expect(
		query(
			state.dbPath,
			"select 1 from events where session_id = ? and type = 'departure_writer_seen' and json_extract(data, '$.sessionFile') is not null",
			worker.id,
		),
	).toHaveLength(0);
}, 30000);

test("a busy ordinary turn completes before the correlated final handoff", async () => {
	const manager = await organization();
	const worker = await person(manager.id, { busy: true });
	await vi.waitFor(() => expect(worker.events.some((event) => event.type === "busy")).toBe(true));
	const commandId = await request(manager, worker.id);
	expect(worker.events.some((event) => event.type === "handoff")).toBe(false);
	worker.child.send("release-busy");
	await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
	expect(worker.events).toContainEqual(expect.objectContaining({ type: "handoff", busyDone: true }));
}, 30000);

test.each([false, true])(
	"an empty final reply retains person and private session (independent=%s)",
	async (independent) => {
		const manager = await organization();
		const worker = await person(independent ? null : manager.id, { emptyHandoff: true });
		const commandId = independent ? await operatorDeparture(worker.id) : await request(manager, worker.id);
		await vi.waitFor(() => expect(stage(commandId)).toBe("failed"), { timeout: 10000 });
		expect(query(state.dbPath, "select retired_at from sessions where id = ?", worker.id)).toEqual([
			{ retired_at: null },
		]);
		expect(
			query(state.dbPath, "select 1 from events where type = 'person_departed' and session_id = ?", worker.id),
		).toHaveLength(0);
		expect(existsSync(worker.file)).toBe(true);
		expect(worker.child.exitCode).toBeNull();
		expect(worker.events.filter((event) => event.type === "handoff")).toHaveLength(1);
		expect(
			query(
				state.dbPath,
				"select body from thread_messages where thread_id = ? and id = ?",
				`departure:${commandId}`,
				`${commandId}:failed`,
			),
		).toHaveLength(1);
	},
	30000,
);

test.each([false, true])(
	"a responsibility arriving during handoff prevents commitment (independent=%s)",
	async (independent) => {
		const manager = await organization();
		const worker = await person(independent ? null : manager.id, { holdHandoff: true });
		const commandId = independent ? await operatorDeparture(worker.id) : await request(manager, worker.id);
		await vi.waitFor(() => expect(worker.events.some((event) => event.type === "handoff")).toBe(true));
		await command(independent ? "operator" : manager.id, {
			kind: "work",
			action: "assign",
			cwd: worker.cwd,
			person: worker.id,
			goal: "An arriving obligation still needs its owner.",
		});
		worker.child.send("release");
		await vi.waitFor(() => expect(stage(commandId)).toBe("failed"), { timeout: 10000 });
		expect(query(state.dbPath, "select retired_at from sessions where id = ?", worker.id)).toEqual([
			{ retired_at: null },
		]);
		expect(
			query(state.dbPath, "select 1 from assignments where person = ? and ended_at is null", worker.id),
		).toHaveLength(1);
		expect(
			query(state.dbPath, "select 1 from events where type = 'person_departed' and session_id = ?", worker.id),
		).toHaveLength(0);
		expect(existsSync(worker.file)).toBe(true);
	},
	30000,
);

test.each([
	{ independent: false, handoff: true },
	{ independent: true, handoff: true },
	{ independent: false, handoff: false },
	{ independent: true, handoff: false },
])(
	"header failure recovers cleanup across restart without replaying handoff (%j)",
	async ({ independent, handoff }) => {
		const manager = await organization();
		const worker = await person(independent ? null : manager.id, { afterClose: "hold" });
		const commandId = independent
			? await operatorDeparture(worker.id, handoff)
			: await request(manager, worker.id, handoff);
		await vi.waitFor(() => expect(worker.events.some((event) => event.type === "closed")).toBe(true));
		const contents = readFileSync(worker.file, "utf8");
		writeFileSync(
			worker.file,
			`${JSON.stringify({ type: "session", id: randomUUID() })}\n${contents.split("\n").slice(1).join("\n")}`,
		);
		worker.child.send("exit");
		await vi.waitFor(
			() =>
				expect(
					query<{ reason: string }>(state.dbPath, "select reason from commands where command_id = ?", commandId)[0]
						?.reason,
				).toContain("header"),
			{ timeout: 10000 },
		);
		expect(stage(commandId)).toBe("delivered");
		expect(existsSync(worker.file)).toBe(true);
		await close(manager);
		managers.splice(
			managers.findIndex((run) => run.session === manager.session),
			1,
		);
		process.kill(runtimePid(state.pidPath)!, "SIGTERM");
		await vi.waitFor(() => expect(existsSync(state.socketPath)).toBe(false));
		await startRuntime(state.socketPath);
		expect(stage(commandId)).toBe("delivered");
		writeFileSync(worker.file, contents);
		await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
		expect(existsSync(worker.file)).toBe(false);
		expect(existsSync(join(state.agentDir, `launch-${worker.id}.ndjson`))).toBe(false);
		expect(worker.events.filter((event) => event.type === "handoff")).toHaveLength(handoff ? 1 : 0);
		expect(
			query(state.dbPath, "select 1 from events where type = 'person_departed' and session_id = ?", worker.id),
		).toHaveLength(1);
		expect(
			(
				await sendCommand(
					worker.id,
					{
						kind: "retire",
						reason: "The verified work is complete.",
						by: independent ? "operator" : manager.id,
						handoff,
					},
					{ socketPath: state.socketPath, commandId },
				)
			).stage,
		).toBe("applied");
	},
	30000,
);

test("an observed SDK replacement in the same live process preserves its new identity and file", async () => {
	const manager = await organization();
	const successor = randomUUID();
	const worker = await person(manager.id, { afterClose: "switch", successor });
	const commandId = await request(manager, worker.id);
	await vi.waitFor(
		() => expect(worker.events.find((event) => event.type === "ready" && event.person === successor)).toBeDefined(),
		{ timeout: 10000 },
	);
	await vi.waitFor(() => expect(stage(commandId)).toBe("applied"), { timeout: 10000 });
	const successorFile = worker.events.find((event) => event.type === "ready" && event.person === successor)!.file!;
	expect(worker.child.exitCode).toBeNull();
	expect(worker.events.filter((event) => event.type === "signal" || event.type === "extension-error")).toEqual([]);
	expect(existsSync(worker.file)).toBe(false);
	expect(existsSync(successorFile)).toBe(true);
	expect(query(state.dbPath, "select name from sessions where id = ?", successor)).toEqual([
		{ name: "Successor Worker" },
	]);
}, 30000);

test("active legacy reopening history still admits hello/start, while a legacy former hello changes no stored history", async () => {
	const manager = await organization();
	const active = await person(manager.id, { person: legacyActive });
	expect(query(state.dbPath, "select retired_at from sessions where id = ?", active.id)).toEqual([
		{ retired_at: null },
	]);
	await command(active.id, { kind: "close" });
	await vi.waitFor(() => expect(active.child.exitCode).toBe(0));
	const departure = await request(manager, active.id);
	await vi.waitFor(() => expect(stage(departure)).toBe("applied"), { timeout: 10000 });
	expect(existsSync(active.file)).toBe(false);
	const launch = readFileSync(join(state.agentDir, `launch-${active.id}.ndjson`), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(launch.find((event) => event.type === "model")).toMatchObject({ handoff: true });
	const denied = await sendCommand(
		legacyFormer,
		{ kind: "start", cwd: state.agentDir },
		{ socketPath: state.socketPath },
	);
	expect(denied.stage).toBe("failed");
	const before = query(state.dbPath, "select count(*) as count from events where session_id = ?", legacyFormer);
	const former = await person(manager.id, { person: legacyFormer, flagFree: true, expectRejection: true });
	await vi.waitFor(() => expect(former.events.some((event) => event.type === "closed")).toBe(true), { timeout: 10000 });
	await vi.waitFor(() => expect(former.child.exitCode).toBe(0));
	expect(query(state.dbPath, "select count(*) as count from events where session_id = ?", legacyFormer)).toEqual(
		before,
	);
	expect(query(state.dbPath, "select 1 from incarnations where session_id = ?", legacyFormer)).toHaveLength(0);
	expect(query(state.dbPath, "select retired_at from sessions where id = ?", legacyFormer)).toEqual([
		{ retired_at: 1 },
	]);
	expect(existsSync(former.file)).toBe(true);
}, 30000);
