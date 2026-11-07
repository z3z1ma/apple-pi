import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { openCommands } from "../../../apps/agent-workplace/src/backend/commands.js";
import { openLifecycle } from "../../../apps/agent-workplace/src/backend/lifecycle.js";
import { openOrg } from "../../../apps/agent-workplace/src/backend/org.js";
import type { WorldSnapshot } from "../../../apps/agent-workplace/src/world.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/bridge.js";
import { sendCommand } from "../src/client.js";
import { organizationLifetime } from "../src/organization-lifetime.js";
import { statePaths } from "../src/paths.js";
import { lineReader } from "../src/protocol.js";
import { Runtime } from "../src/runtime.js";
import { migrate } from "../src/schema.js";
import { sessionInput } from "../src/session-input.js";
import { close, fakeBridge, standInProcess, tempStateDir } from "./helpers.js";
import { rewindRecentSchema } from "./historical-schema.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.unstubAllEnvs();
});

async function fixture() {
	vi.stubEnv("PI_PROGRAM_ID", undefined);
	vi.stubEnv("PI_PROGRAM_PARENT", undefined);
	const state = tempStateDir();
	writeFileSync(join(state.agentDir, "pi"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
	vi.stubEnv("PATH", `${state.agentDir}:${process.env.PATH}`);
	const paths = statePaths();
	const runtime = new Runtime(paths);
	expect(await runtime.start()).toBe(true);
	const db = new DatabaseSync(paths.db);
	let stopped = false;
	const stop = () => {
		if (!stopped) {
			runtime.stop();
			stopped = true;
		}
	};
	cleanups.push(() => {
		stop();
		db.close();
		rmSync(state.agentDir, { recursive: true, force: true });
	});
	async function person(
		id: string,
		options: {
			manager?: string;
			interactive?: boolean;
			incorporate?: boolean;
			run?: string;
			holdClose?: boolean;
			holdQuiesce?: boolean;
			quiescence?: boolean;
			onCall?: boolean;
		} = {},
	) {
		const process = standInProcess();
		const file = join(state.agentDir, `${id}.jsonl`);
		writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: state.agentDir })}\n`);
		const link = await fakeBridge(paths.socket, id, process.pid, process.startedAt, {
			session: {
				file,
				interactive: options.interactive,
				incorporate: options.incorporate,
				quiescence: options.quiescence !== false,
			},
			facts: { reportsTo: options.manager ?? null, onCall: options.onCall ?? false },
			run: options.run,
		});
		link.socket.on(
			"data",
			lineReader((line) => {
				const message = JSON.parse(line);
				if (
					message.type === "command" &&
					(message.command.kind === "release_input" || (message.command.kind === "quiesce" && !options.holdQuiesce))
				)
					link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
				if (message.type === "command" && message.command.kind === "close") {
					if (options.holdClose) return;
					link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
					link.send({ type: "shutdown", reason: "quit", closeCommand: message.commandId });
					process.child.kill("SIGTERM");
				}
			}),
		);
		cleanups.push(() => {
			link.socket.destroy();
			process.child.kill("SIGTERM");
		});
		await vi.waitFor(() =>
			expect(
				db.prepare("select pid from incarnations where session_id = ? order by generation desc limit 1").get(id),
			).toEqual({ pid: process.pid }),
		);
		return {
			...link,
			file,
			process,
			quit(reason = "quit") {
				link.send({ type: "shutdown", reason, deliberate: true });
				process.child.kill("SIGTERM");
			},
		};
	}
	const departed = (id: string) =>
		db.prepare("select 1 from events where session_id = ? and type = 'person_departed'").get(id);
	return { ...state, paths, runtime, stop, db, person, departed };
}

test("migration protects every existing identity including sleeping roots and later admissions default temporary", () => {
	const db = new DatabaseSync(":memory:");
	try {
		migrate(db);
		rewindRecentSchema(db, 53);
		for (const id of [
			"01a18155-0ec7-71f5-9809-638184a366dd",
			"floqast",
			"01a183f2-16d5-7611-b2b7-165b9eea062d",
			"sleeping-report",
		])
			db.prepare(
				"insert into sessions (id,kind,cwd,run_state,generation,source,updated_at) values (?, 'root', '/tmp','idle',0,'test',0)",
			).run(id);
		db.prepare("update sessions set reports_to = ? where id = 'sleeping-report'").run(
			"01a18155-0ec7-71f5-9809-638184a366dd",
		);
		migrate(db);
		expect(
			db.prepare("select count(*) as n from sessions where incorporated = 1 and closing_generation is null").get(),
		).toEqual({ n: 4 });
		db.prepare(
			"insert into sessions (id,kind,cwd,run_state,generation,source,updated_at) values ('new','root','/tmp','idle',0,'test',0)",
		).run();
		expect(organizationLifetime(db, "new")).toMatchObject({ incorporated: false, closing: false });
		migrate(db);
		expect(organizationLifetime(db, "new").incorporated).toBe(false);
	} finally {
		db.close();
	}
});

test("interactive root close removes idle reports first without handoffs and retains unassigned backlog", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true, onCall: true });
	await f.person("manager", { manager: "root" });
	await f.person("worker", { manager: "manager" });
	f.db
		.prepare(
			"insert into work_tasks (id,bundle,project,organization,ephemeral,thread) values ('backlog','/tmp/backlog','/tmp','root',1,'backlog-thread')",
		)
		.run();
	root.quit();
	await vi.waitFor(() => expect(f.db.prepare("select id from sessions").all()).toEqual([]), { timeout: 12000 });
	const gone = f.db.prepare("select session_id, data from events where type = 'person_departed' order by seq").all();
	expect(gone.map((row) => row.session_id)).toEqual(["worker", "manager", "root"]);
	for (const row of gone) expect(JSON.parse(row.data as string).handoffFile).toBeNull();
	expect(f.db.prepare("select id from work_tasks").all()).toEqual([{ id: "backlog" }]);
	expect(f.db.prepare("select 1 from commands where kind = 'start' and session_id = 'root'").get()).toBeUndefined();
	expect(f.db.prepare("select 1 from commands where kind = 'run_turn'").get()).toBeUndefined();
	for (const name of ["root", "manager", "worker"]) expect(existsSync(join(f.agentDir, `${name}.jsonl`))).toBe(false);
}, 20000);

test("busy and assigned people stay, while reopening cancels remaining departures", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	await f.person("idle", { manager: "root" });
	const busy = await f.person("busy", { manager: "root", run: "thinking" });
	f.db
		.prepare("insert into assignments (person,task_id,assigned_by,assigned_at) values ('busy','held','root',0)")
		.run();
	root.quit();
	await vi.waitFor(() => expect(f.departed("idle")).toBeDefined(), { timeout: 6000 });
	expect(f.departed("busy")).toBeUndefined();
	expect(organizationLifetime(f.db, "root").waiting.find((p) => p.person === "busy")?.reason).toMatch(/turn/);
	busy.send({ type: "run", run: "idle" });
	await vi.waitFor(() =>
		expect(organizationLifetime(f.db, "root").waiting.find((p) => p.person === "busy")?.reason).toMatch(
			/held assignments/,
		),
	);
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("busy")).toBeUndefined();
	const reopened = await f.person("root");
	expect(organizationLifetime(f.db, "root").closing).toBe(false);
	f.db.prepare("update assignments set ended_at = 1 where person = 'busy'").run();
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("busy")).toBeUndefined();
	expect(f.departed("root")).toBeUndefined();
	expect(f.departed("idle")).toBeDefined();
	expect(
		(
			await sendCommand(
				"busy",
				{
					kind: "retire",
					by: "operator",
					handoff: false,
					reason: "Delayed cleanup from the closed incarnation",
					dissolution: { root: "root", generation: 1 },
				},
				{ socketPath: f.paths.socket },
			)
		).stage,
	).toBe("failed");
	expect(existsSync(busy.file)).toBe(true);
	reopened.socket.destroy();
}, 15000);

test("incorporating while waiting cancels cleanup and is idempotent through the real command path", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	const worker = await f.person("worker", { manager: "root", run: "thinking" });
	root.quit();
	await vi.waitFor(() => expect(organizationLifetime(f.db, "root").closing).toBe(true));
	const receipt = await sendCommand(
		"root",
		{ kind: "incorporate", by: "operator" },
		{ socketPath: f.paths.socket, commandId: "keep" },
	);
	expect(receipt.stage).toBe("applied");
	expect(organizationLifetime(f.db, "root")).toMatchObject({ incorporated: true, closing: false });
	worker.send({ type: "run", run: "idle" });
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("worker")).toBeUndefined();
	await f.person("target");
	expect(
		(
			await sendCommand(
				"operator",
				{
					kind: "organization_move",
					person: "root",
					manager: "target",
					branch: ["root", "worker"],
				},
				{ socketPath: f.paths.socket },
			)
		).stage,
	).toBe("applied");
	expect(
		(
			await sendCommand(
				"root",
				{ kind: "incorporate", by: "operator" },
				{ socketPath: f.paths.socket, commandId: "keep" },
			)
		).stage,
	).toBe("applied");
	expect(organizationLifetime(f.db, "root")).toMatchObject({ root: "target", incorporated: false });
}, 10000);

test.each(["new", "resume", "reload", "fork", "quit"])(
	"unrecorded headless shutdown %s does not dissolve",
	async (reason) => {
		const f = await fixture();
		const root = await f.person("root");
		root.quit(reason);
		await new Promise((resolve) => setTimeout(resolve, 1400));
		expect(f.departed("root")).toBeUndefined();
		expect(organizationLifetime(f.db, "root")).toMatchObject({ incorporated: false, closing: false });
	},
);

test("explicit headless end dissolves, while incorporation keeps an interactive root", async () => {
	const f = await fixture();
	await f.person("headless");
	expect((await sendCommand("headless", { kind: "close", dissolve: true }, { socketPath: f.paths.socket })).stage).toBe(
		"applied",
	);
	await vi.waitFor(() => expect(f.departed("headless")).toBeDefined(), { timeout: 6000 });
	const kept = await f.person("kept", { interactive: true, incorporate: true });
	kept.quit();
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("kept")).toBeUndefined();
	expect(organizationLifetime(f.db, "kept").incorporated).toBe(true);
}, 10000);

test("split retains the source incorporation; merges adopt the target and moved-out workers escape pending cleanup", async () => {
	const f = await fixture();
	await f.person("kept", { incorporate: true });
	await f.person("branch", { manager: "kept" });
	const root = await f.person("temporary", { interactive: true });
	const worker = await f.person("worker", { manager: "temporary", run: "thinking" });
	const move = (person: string, manager: string | null) =>
		sendCommand(
			"operator",
			{ kind: "organization_move", person, manager, branch: [person] },
			{ socketPath: f.paths.socket },
		);
	expect((await move("branch", null)).stage).toBe("applied");
	expect(organizationLifetime(f.db, "branch").incorporated).toBe(true);
	expect((await move("branch", "temporary")).stage).toBe("applied");
	expect(organizationLifetime(f.db, "branch").incorporated).toBe(false);
	root.quit();
	expect((await move("worker", "kept")).stage).toBe("applied");
	worker.send({ type: "run", run: "idle" });
	await vi.waitFor(() => expect(f.departed("temporary")).toBeDefined(), { timeout: 8000 });
	expect(f.departed("worker")).toBeUndefined();
	expect(organizationLifetime(f.db, "worker")).toMatchObject({ root: "kept", incorporated: true });
}, 15000);

test("restart resumes committed child cleanup and preserves the pending root close", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	const child = await f.person("child", { manager: "root", holdClose: true });
	root.quit();
	await vi.waitFor(() => expect(f.departed("child")).toBeDefined(), { timeout: 6000 });
	expect(existsSync(child.file)).toBe(true);
	expect(f.departed("root")).toBeUndefined();
	f.stop();
	const restarted = new Runtime(f.paths);
	cleanups.push(() => restarted.stop());
	expect(await restarted.start()).toBe(true);
	await vi.waitFor(() =>
		expect(
			f.db.prepare("select 1 from events where type = 'departure_cleanup_blocked' and session_id = 'child'").get(),
		).toBeDefined(),
	);
	expect(existsSync(child.file)).toBe(true);
	child.process.child.kill("SIGTERM");
	await vi.waitFor(() => expect(f.db.prepare("select id from sessions").all()).toEqual([]), { timeout: 10000 });
	expect(existsSync(child.file)).toBe(false);
	expect(f.departed("root")).toBeDefined();
	expect(
		f.db.prepare("select count(*) as n from events where session_id = 'child' and type = 'person_departed'").get(),
	).toEqual({ n: 1 });
	expect(f.db.prepare("select 1 from commands where kind = 'run_turn'").get()).toBeUndefined();
}, 20000);

test("process loss and runtime restart without deliberate closing retain interactive organizations", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	root.socket.destroy();
	root.process.child.kill("SIGTERM");
	f.stop();
	const restarted = new Runtime(f.paths);
	cleanups.push(() => restarted.stop());
	expect(await restarted.start()).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("root")).toBeUndefined();
	expect(organizationLifetime(f.db, "root").closing).toBe(false);
	expect(existsSync(root.file)).toBe(true);
});

test("review: native preparing input is protected before agent_start", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = false;
	const worker = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" ? "root" : getFlag(name));
				bridge(pi);
				pi.on("input", async () => {
					entered = true;
					await held;
					return { action: "continue" };
				});
			},
		],
		[],
		[],
	);
	try {
		const id = worker.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(f.db.prepare("select reports_to from sessions where id = ?").get(id)).toEqual({ reports_to: "root" }),
		);
		expect(
			(await sendCommand(id, { kind: "talk", text: "Hold this preparation" }, { socketPath: f.paths.socket })).stage,
		).toBe("applied");
		await vi.waitFor(() => expect(entered).toBe(true));
		expect(worker.session.isIdle).toBe(true);
		expect(worker.requests).toHaveLength(0);
		root.quit();
		await new Promise((resolve) => setTimeout(resolve, 1400));
		expect(f.departed(id)).toBeUndefined();
		expect(worker.requests).toHaveLength(0);
	} finally {
		release();
		await worker.session.abort();
		await close(worker);
		f.stop();
		const gate = sessionInput(worker.session);
		if (gate.ticket) gate.release(gate.ticket);
	}
}, 15000);

test("SDK startup flag consumption and /incorporate command need no model turn", async () => {
	const f = await fixture();
	const flagged = await fauxSession(
		[
			(pi) => {
				const original = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "incorporate" ? true : original(name));
				bridge(pi);
			},
		],
		[],
		[],
	);
	const ordinary = await fauxSession([bridge], [], []);
	try {
		const id = flagged.session.sessionManager.getSessionId();
		const other = ordinary.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(f.db.prepare("select incorporated from sessions where id = ?").get(id)).toEqual({ incorporated: 1 }),
		);
		await vi.waitFor(() =>
			expect(f.db.prepare("select incorporated from sessions where id = ?").get(other)).toEqual({ incorporated: 0 }),
		);
		await ordinary.session.prompt("/incorporate");
		expect(organizationLifetime(f.db, other).incorporated).toBe(true);
		expect(flagged.requests).toHaveLength(0);
		expect(ordinary.requests).toHaveLength(0);
	} finally {
		await close(flagged);
		await close(ordinary);
	}
}, 15000);

test("a flagged process reconnect cannot incorporate a later merge target", async () => {
	const f = await fixture();
	const flagged = await f.person("flagged", { incorporate: true });
	await f.person("target");
	expect(
		(
			await sendCommand(
				"operator",
				{ kind: "organization_move", person: "flagged", manager: "target", branch: ["flagged"] },
				{ socketPath: f.paths.socket },
			)
		).stage,
	).toBe("applied");
	const reconnected = await fakeBridge(f.paths.socket, "flagged", flagged.process.pid, flagged.process.startedAt, {
		session: { file: flagged.file, name: "Reconnected", incorporate: true },
	});
	cleanups.push(() => reconnected.socket.destroy());
	await vi.waitFor(() =>
		expect(f.db.prepare("select name from sessions where id = 'flagged'").get()).toEqual({ name: "Reconnected" }),
	);
	expect(organizationLifetime(f.db, "flagged")).toMatchObject({ root: "target", incorporated: false });
});

test.each([undefined, false])(
	"review: interactive quit without deliberate provenance (%s) retains the tree",
	async (deliberate) => {
		const f = await fixture();
		const root = await f.person("root", { interactive: true });
		root.send({ type: "shutdown", reason: "quit", ...(deliberate === undefined ? {} : { deliberate }) });
		root.process.child.kill("SIGTERM");
		await vi.waitFor(() =>
			expect(f.db.prepare("select ended_at from incarnations where session_id = 'root'").get()).toMatchObject({
				ended_at: expect.any(Number),
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 1400));
		expect(f.departed("root")).toBeUndefined();
		expect(existsSync(root.file)).toBe(true);
	},
);

test("review: close requires an explicit dissolution choice for an unincorporated root", async () => {
	const f = await fixture();
	await f.person("root");
	const receipt = await sendCommand("root", { kind: "close" }, { socketPath: f.paths.socket });
	expect(receipt.stage, receipt.reason).toBe("failed");
	expect(receipt.reason).toMatch(/incorporate|dissolv/i);
	expect(f.departed("root")).toBeUndefined();
});

test("review: Workplace requests dissolution consent before sending a close", async () => {
	const f = await fixture();
	await f.person("root");
	const commands = openCommands(f.paths.socket);
	try {
		const lifecycle = openLifecycle(
			{ db: f.paths.db, agentDir: f.agentDir },
			commands,
			() =>
				({
					characters: [{ id: "root", name: "Root", facts: { run: "idle" } }],
					dormant: [],
				}) as unknown as WorldSnapshot,
		);
		expect(await lifecycle.endSession("root")).toMatchObject({ ok: false, dissolve: true });
		expect(f.db.prepare("select 1 from commands where kind = 'close'").get()).toBeUndefined();
	} finally {
		commands.close();
	}
});

test("review: resuming a flagged launch cannot incorporate its later merge target", async () => {
	const f = await fixture();
	const flagged = await f.person("flagged", { incorporate: true });
	await f.person("target");
	expect(
		(
			await sendCommand(
				"operator",
				{ kind: "organization_move", person: "flagged", manager: "target", branch: ["flagged"] },
				{ socketPath: f.paths.socket },
			)
		).stage,
	).toBe("applied");
	flagged.send({ type: "shutdown", reason: "new" });
	await vi.waitFor(() =>
		expect(f.db.prepare("select ended_at from incarnations where session_id = 'flagged'").get()).toMatchObject({
			ended_at: expect.any(Number),
		}),
	);
	const resumed = await fakeBridge(f.paths.socket, "flagged", flagged.process.pid, flagged.process.startedAt + 1, {
		session: { file: flagged.file, incorporate: true },
	});
	cleanups.push(() => resumed.socket.destroy());
	await vi.waitFor(() =>
		expect(f.db.prepare("select generation from sessions where id = 'flagged'").get()).toEqual({ generation: 2 }),
	);
	expect(organizationLifetime(f.db, "target").incorporated).toBe(false);
});

test("review: consumed launch intent survives removal of its private incarnation history", async () => {
	const f = await fixture();
	const original = await f.person("original", { incorporate: true });
	original.send({ type: "shutdown", reason: "new" });
	await vi.waitFor(() =>
		expect(f.db.prepare("select ended_at from incarnations where session_id = 'original'").get()).toMatchObject({
			ended_at: expect.any(Number),
		}),
	);
	original.socket.destroy();
	f.db.prepare("delete from incarnations where session_id = 'original'").run();
	const replacement = await fakeBridge(
		f.paths.socket,
		"replacement",
		original.process.pid,
		original.process.startedAt + 1,
		{ session: { incorporate: true } },
	);
	cleanups.push(() => replacement.socket.destroy());
	await vi.waitFor(() => expect(f.db.prepare("select 1 from sessions where id = 'replacement'").get()).toBeDefined());
	expect(organizationLifetime(f.db, "replacement").incorporated).toBe(false);
});

test("review: input reservation refuses new turns and incorporation releases it", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	await f.person("child", { manager: "root", holdQuiesce: true });
	root.quit();
	await vi.waitFor(
		() =>
			expect(
				f.db
					.prepare("select 1 from commands where session_id = 'child' and kind = 'quiesce' and stage = 'accepted'")
					.get(),
			).toBeDefined(),
		{ timeout: 5000 },
	);
	expect(
		(
			await sendCommand(
				"child",
				{ kind: "talk", text: "Later input" },
				{ socketPath: f.paths.socket, until: "accepted" },
			)
		).stage,
	).toBe("failed");
	expect(
		(await sendCommand("root", { kind: "incorporate", by: "operator" }, { socketPath: f.paths.socket })).stage,
	).toBe("applied");
	await vi.waitFor(
		() =>
			expect(
				f.db
					.prepare("select 1 from commands where session_id = 'child' and kind = 'release_input' and stage = 'applied'")
					.get(),
			).toBeDefined(),
		{ timeout: 5000 },
	);
	expect(
		(
			await sendCommand(
				"child",
				{ kind: "talk", text: "After cancellation" },
				{ socketPath: f.paths.socket, until: "accepted" },
			)
		).stage,
	).toBe("accepted");
	expect(f.departed("child")).toBeUndefined();
});

test("review: a reply to an obsolete agreement cannot seal a later closing epoch", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	const child = await f.person("child", { manager: "root", holdQuiesce: true });
	const tickets = () =>
		f.db
			.prepare("select command_id from commands where session_id = 'child' and kind = 'quiesce' order by created_at")
			.all() as { command_id: string }[];
	root.quit();
	await vi.waitFor(() => expect(tickets()).toHaveLength(1), { timeout: 5000 });
	const replacement = await f.person("root", { interactive: true });
	await vi.waitFor(
		() =>
			expect(
				f.db.prepare("select 1 from commands where kind = 'release_input' and stage = 'applied'").get(),
			).toBeDefined(),
		{ timeout: 5000 },
	);
	replacement.quit();
	await vi.waitFor(() => expect(tickets()).toHaveLength(2), { timeout: 5000 });
	child.send({ type: "command_progress", commandId: tickets()[0]!.command_id, stage: "applied" });
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("child")).toBeUndefined();
	child.send({ type: "command_progress", commandId: tickets()[1]!.command_id, stage: "applied" });
	await vi.waitFor(() => expect(f.departed("child")).toBeDefined(), { timeout: 5000 });
});

test("review: interrupted delivered close cannot turn later process loss into authority", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true, holdClose: true });
	const command = await sendCommand(
		"root",
		{ kind: "close", dissolve: true },
		{ socketPath: f.paths.socket, until: "accepted" },
	);
	root.send({ type: "command_progress", commandId: command.commandId, stage: "delivered" });
	await vi.waitFor(() =>
		expect(f.db.prepare("select stage from commands where command_id = ?").get(command.commandId)).toEqual({
			stage: "delivered",
		}),
	);
	f.stop();
	const restarted = new Runtime(f.paths);
	cleanups.push(() => restarted.stop());
	expect(await restarted.start()).toBe(true);
	const resumed = await fakeBridge(f.paths.socket, "root", root.process.pid, root.process.startedAt, {
		session: { file: root.file, interactive: true },
	});
	cleanups.push(() => resumed.socket.destroy());
	resumed.send({ type: "facts", facts: { cost: 29 } });
	await vi.waitFor(() =>
		expect(f.db.prepare("select cost from sessions where id = 'root'").get()).toEqual({ cost: 29 }),
	);
	resumed.socket.destroy();
	root.process.child.kill("SIGTERM");
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(organizationLifetime(f.db, "root").closing).toBe(false);
	expect(f.departed("root")).toBeUndefined();
	expect(existsSync(root.file)).toBe(true);
});

test("review: accepted undelivered input blocks permanent departure", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	await f.person("child", { manager: "root" });
	expect(
		(
			await sendCommand(
				"child",
				{ kind: "talk", text: "Work that has not been consumed" },
				{ socketPath: f.paths.socket, until: "accepted" },
			)
		).stage,
	).toBe("accepted");
	root.quit();
	await vi.waitFor(() => expect(organizationLifetime(f.db, "root").closing).toBe(true));
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("child")).toBeUndefined();
});

test("review: disconnected live idle observation does not authorize departure", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	const child = await f.person("child", { manager: "root" });
	child.socket.destroy();
	await vi.waitFor(
		() =>
			expect(f.db.prepare("select process_state from incarnations where session_id = 'child'").get()).toEqual({
				process_state: "alive_bridge_lost",
			}),
		{ timeout: 8000 },
	);
	root.quit();
	await vi.waitFor(() => expect(organizationLifetime(f.db, "root").closing).toBe(true));
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("child")).toBeUndefined();
}, 15000);

test("Workplace lifetime adapter reads current blockers and sends only the fixed operator mutation", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	await f.person("child", { manager: "root", run: "thinking" });
	const commands = openCommands(f.paths.socket);
	try {
		const org = openOrg(
			{ db: f.paths.db, agentDir: f.agentDir },
			commands,
			() => ({ characters: [], dormant: [] }) as unknown as WorldSnapshot,
		);
		root.quit();
		await vi.waitFor(() => expect(org.organizationLifetime("root").closing).toBe(true));
		expect(org.organizationLifetime("child").waiting).toContainEqual({
			person: "child",
			reason: expect.stringMatching(/turn/),
		});
		expect(await org.incorporateOrganization("root")).toMatchObject({ ok: true });
		expect(org.organizationLifetime("child")).toMatchObject({
			root: "root",
			incorporated: true,
			closing: false,
			waiting: [],
		});
		expect(await org.incorporateOrganization("child")).toMatchObject({ ok: false });
	} finally {
		commands.close();
	}
}, 10000);
