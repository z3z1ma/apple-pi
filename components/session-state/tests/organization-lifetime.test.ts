import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { openCommands } from "../../../apps/agent-workplace/src/backend/commands.js";
import { openLifecycle } from "../../../apps/agent-workplace/src/backend/lifecycle.js";
import { openOrg } from "../../../apps/agent-workplace/src/backend/org.js";
import type { WorldSnapshot } from "../../../apps/agent-workplace/src/world.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { trackLiveSessions } from "../../shared/src/forked-continuation.js";
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
			holdRelease?: boolean;
			quiescence?: boolean;
			onCall?: boolean;
		} = {},
	) {
		const process = { ...standInProcess(), launch: `launch-${id}-${Math.random()}` };
		const file = join(state.agentDir, `${id}.jsonl`);
		writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: state.agentDir })}\n`);
		const link = await fakeBridge(paths.socket, id, process.pid, process.startedAt, {
			session: {
				file,
				interactive: options.interactive,
				incorporate: options.incorporate,
				quiescence: options.quiescence !== false ? "launch" : undefined,
			},
			process: { launch: process.launch },
			facts: { reportsTo: options.manager ?? null, onCall: options.onCall ?? false },
			run: options.run,
		});
		link.socket.on(
			"data",
			lineReader((line) => {
				const message = JSON.parse(line);
				if (
					message.type === "command" &&
					((message.command.kind === "release_input" && !options.holdRelease) ||
						(message.command.kind === "quiesce" && !options.holdQuiesce))
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
		process: { launch: flagged.process.launch },
	});
	cleanups.push(() => resumed.socket.destroy());
	await vi.waitFor(() =>
		expect(f.db.prepare("select generation from sessions where id = 'flagged'").get()).toEqual({ generation: 2 }),
	);
	expect(organizationLifetime(f.db, "target").incorporated).toBe(false);
});

test("opening a new person in a flagged launch does not reapply startup incorporation", async () => {
	const f = await fixture();
	const original = await f.person("original", { incorporate: true });
	original.send({ type: "shutdown", reason: "new" });
	await vi.waitFor(() =>
		expect(f.db.prepare("select ended_at from incarnations where session_id = 'original'").get()).toMatchObject({
			ended_at: expect.any(Number),
		}),
	);
	original.socket.destroy();
	const replacement = await fakeBridge(
		f.paths.socket,
		"replacement",
		original.process.pid,
		original.process.startedAt + 1,
		{ session: { incorporate: true }, process: { launch: original.process.launch } },
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

test.each(["delivered", "applied"] as const)(
	"round2: %s close consent cannot authorize a reformed root",
	async (stage) => {
		const f = await fixture();
		const root = await f.person("a", { interactive: true, holdClose: true });
		await f.person("b");
		const receipt = await sendCommand(
			"a",
			{ kind: "close", dissolve: true },
			{ socketPath: f.paths.socket, until: "accepted" },
		);
		root.send({ type: "command_progress", commandId: receipt.commandId, stage });
		await vi.waitFor(() =>
			expect(f.db.prepare("select stage from commands where command_id = ?").get(receipt.commandId)).toEqual({ stage }),
		);
		for (const [person, manager] of [
			["a", "b"],
			["a", null],
			["b", "a"],
		] as const) {
			expect(
				(
					await sendCommand(
						"operator",
						{ kind: "organization_move", person, manager, branch: [person] },
						{ socketPath: f.paths.socket },
					)
				).stage,
			).toBe("applied");
		}
		root.send({ type: "shutdown", reason: "quit", closeCommand: receipt.commandId });
		await vi.waitFor(() =>
			expect(f.db.prepare("select ended_at from incarnations where session_id = 'a'").get()).toEqual({
				ended_at: expect.any(Number),
			}),
		);
		expect(organizationLifetime(f.db, "a").closing).toBe(false);
		expect(f.departed("b")).toBeUndefined();
	},
);

test.each([false, true])(
	"round2: superseded connection cannot close its live generation (command=%s)",
	async (command) => {
		const f = await fixture();
		const old = await f.person("root", { interactive: true, holdClose: true });
		await f.person("child", { manager: "root" });
		let closeId: string | undefined;
		if (command) {
			const receipt = await sendCommand(
				"root",
				{ kind: "close", dissolve: true },
				{ socketPath: f.paths.socket, until: "accepted" },
			);
			closeId = receipt.commandId;
			old.send({ type: "command_progress", commandId: closeId, stage: "applied" });
			await vi.waitFor(() =>
				expect(f.db.prepare("select stage from commands where command_id = ?").get(closeId!)).toEqual({
					stage: "applied",
				}),
			);
		}
		const fresh = await fakeBridge(f.paths.socket, "root", old.process.pid, old.process.startedAt, {
			session: { interactive: true },
			facts: { cost: 41 },
		});
		cleanups.push(() => fresh.socket.destroy());
		await vi.waitFor(() =>
			expect(f.db.prepare("select cost from sessions where id = 'root'").get()).toEqual({ cost: 41 }),
		);
		old.send({ type: "shutdown", reason: "quit", deliberate: true, ...(closeId ? { closeCommand: closeId } : {}) });
		await new Promise((resolve) => setTimeout(resolve, 1400));
		expect(organizationLifetime(f.db, "root").closing).toBe(false);
		expect(f.departed("child")).toBeUndefined();
		expect(f.db.prepare("select ended_at from incarnations where session_id = 'root'").get()).toEqual({
			ended_at: null,
		});
		if (closeId) {
			fresh.send({ type: "shutdown", reason: "quit", deliberate: true, closeCommand: closeId });
			await vi.waitFor(() =>
				expect(f.db.prepare("select ended_at from incarnations where session_id = 'root'").get()).toEqual({
					ended_at: expect.any(Number),
				}),
			);
			expect(organizationLifetime(f.db, "root").closing).toBe(false);
		}
	},
);

test.each(["thread_post", "communication"] as const)(
	"round2: %s mail during reservation remains deliverable",
	async (kind) => {
		const f = await fixture();
		const root = await f.person("root", { interactive: true });
		const child = await f.person("child", { manager: "root", holdQuiesce: true });
		const delivered: string[] = [];
		child.socket.on(
			"data",
			lineReader((line) => {
				const message = JSON.parse(line);
				if (message.type === "command" && message.command.kind === "mail") {
					delivered.push(message.command.body);
					child.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
				}
			}),
		);
		root.quit();
		await vi.waitFor(
			() =>
				expect(
					f.db.prepare("select 1 from commands where session_id = 'child' and kind = 'quiesce'").get(),
				).toBeDefined(),
			{ timeout: 5000 },
		);
		const post = {
			thread: `reserved-${kind}`,
			threadKind: "mail" as const,
			subject: "Held mail",
			body: "Deliver after release",
			to: ["child"],
		};
		const publication = await sendCommand(
			"operator",
			kind === "thread_post"
				? { kind, ...post }
				: { kind, version: 1, input: { tool: "send_mail", arguments: post }, operation: { action: "post", ...post } },
			{ socketPath: f.paths.socket },
		);
		expect(publication.stage).toBe("applied");
		expect(
			f.db.prepare("select stage from commands where session_id = 'child' and kind = 'mail'").all(),
		).not.toContainEqual({ stage: "failed" });
		expect(
			(await sendCommand("root", { kind: "incorporate", by: "operator" }, { socketPath: f.paths.socket })).stage,
		).toBe("applied");
		await vi.waitFor(() => expect(delivered).toEqual(["Deliver after release"]), { timeout: 5000 });
		expect(f.departed("child")).toBeUndefined();
		expect(f.db.prepare("select stage from commands where session_id = 'child' and kind = 'mail'").all()).toEqual([
			{ stage: "applied" },
		]);
	},
);

test.each(["reconnect", "restart"] as const)(
	"round2: retained mail waits for release acknowledgement across %s",
	async (mode) => {
		const f = await fixture();
		const root = await f.person("root", { interactive: true });
		const child = await f.person("child", { manager: "root", holdQuiesce: true, holdRelease: true });
		root.quit();
		await vi.waitFor(
			() =>
				expect(
					f.db.prepare("select 1 from commands where session_id = 'child' and kind = 'quiesce'").get(),
				).toBeDefined(),
			{ timeout: 5000 },
		);
		expect(
			(
				await sendCommand(
					"operator",
					{
						kind: "thread_post",
						thread: `held-${mode}`,
						threadKind: "mail",
						subject: "Held",
						body: "Replay once",
						to: ["child"],
					},
					{ socketPath: f.paths.socket },
				)
			).stage,
		).toBe("applied");
		const release = f.db
			.prepare("select command_id from commands where session_id = 'child' and kind = 'release_input'")
			.get() as { command_id: string };
		const ticket = (
			JSON.parse(
				(
					f.db.prepare("select command from commands where command_id = ?").get(release.command_id) as {
						command: string;
					}
				).command,
			) as { ticket: string }
		).ticket;
		expect(
			(await sendCommand("root", { kind: "incorporate", by: "operator" }, { socketPath: f.paths.socket })).stage,
		).toBe("applied");
		expect(f.db.prepare("select stage from commands where session_id = 'child' and kind = 'mail'").all()).toEqual([
			{ stage: "accepted" },
		]);
		expect(
			(
				await sendCommand(
					"child",
					{ kind: "talk", text: "Wait for release" },
					{ socketPath: f.paths.socket, until: "accepted" },
				)
			).stage,
		).toBe("failed");
		child.socket.destroy();
		if (mode === "restart") {
			f.stop();
			const next = new Runtime(f.paths);
			expect(await next.start()).toBe(true);
			cleanups.push(() => next.stop());
		}
		const replacement = await fakeBridge(f.paths.socket, "child", child.process.pid, child.process.startedAt, {
			session: { file: child.file, quiescence: "launch", inputSeal: ticket },
			process: { launch: child.process.launch },
			facts: { cost: 61 },
		});
		cleanups.push(() => replacement.socket.destroy());
		const received: string[] = [];
		let freshRelease: string | undefined;
		replacement.socket.on(
			"data",
			lineReader((line) => {
				const message = JSON.parse(line);
				if (message.type !== "command") return;
				if (message.command.kind === "release_input") freshRelease = message.commandId;
				if (message.command.kind === "mail") {
					received.push(message.command.body);
					replacement.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
				}
			}),
		);
		await vi.waitFor(() => expect(freshRelease).toBeDefined());
		expect(received).toEqual([]);
		expect(f.db.prepare("select stage from commands where session_id = 'child' and kind = 'mail'").all()).toEqual([
			{ stage: "accepted" },
		]);
		replacement.send({ type: "command_progress", commandId: freshRelease!, stage: "applied" });
		await vi.waitFor(() => expect(received).toEqual(["Replay once"]));
		await vi.waitFor(() =>
			expect(f.db.prepare("select stage from commands where session_id = 'child' and kind = 'mail'").all()).toEqual([
				{ stage: "applied" },
			]),
		);
	},
);

test("round2: a legacy gate boolean cannot certify quiescence", async () => {
	const f = await fixture();
	const root = await f.person("root", { interactive: true });
	const child = await f.person("child", { manager: "root", quiescence: false });
	const legacy = await fakeBridge(f.paths.socket, "child", child.process.pid, child.process.startedAt, {
		session: { file: child.file, quiescence: true },
		facts: { cost: 63 },
	});
	cleanups.push(() => legacy.socket.destroy());
	legacy.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line);
			if (message.type === "command" && message.command.kind === "quiesce")
				legacy.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
		}),
	);
	await vi.waitFor(() =>
		expect(f.db.prepare("select cost from sessions where id = 'child'").get()).toEqual({ cost: 63 }),
	);
	root.quit();
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(organizationLifetime(f.db, "root").closing).toBe(true);
	expect(f.departed("child")).toBeUndefined();
	expect(existsSync(child.file)).toBe(true);
});

test("round2: a missing launch token keeps recorded lifetime instead of inferring startup intent", async () => {
	const f = await fixture();
	const root = await f.person("root", { incorporate: true });
	await f.person("target");
	expect(
		(
			await sendCommand(
				"operator",
				{ kind: "organization_move", person: "root", manager: "target", branch: ["root"] },
				{ socketPath: f.paths.socket },
			)
		).stage,
	).toBe("applied");
	const legacy = await fakeBridge(f.paths.socket, "root", root.process.pid, root.process.startedAt + 5000, {
		session: { file: root.file, incorporate: true },
		facts: { cost: 67 },
	});
	cleanups.push(() => legacy.socket.destroy());
	await vi.waitFor(() =>
		expect(f.db.prepare("select cost from sessions where id = 'root'").get()).toEqual({ cost: 67 }),
	);
	expect(organizationLifetime(f.db, "target").incorporated).toBe(false);
});

test("round2: first bridge installation during reload grants no launch authority", async () => {
	const f = await fixture();
	const latch = Symbol.for("apple-pi.launch-input-seal");
	const launch = Symbol.for("apple-pi.bridge-launch");
	const host = process as NodeJS.Process & Record<symbol, unknown>;
	const previousLatch = host[latch];
	const previousLaunch = host[launch];
	delete host[latch];
	delete host[launch];
	trackLiveSessions();
	let install!: () => void;
	const worker = await fauxSession(
		[
			(pi) => {
				const original = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "incorporate" ? true : original(name));
				install = () => bridge(pi);
			},
		],
		[],
		[],
	);
	try {
		install();
		await worker.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
		const id = worker.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(f.db.prepare("select incorporated from sessions where id = ?").get(id)).toBeDefined(),
		);
		expect(organizationLifetime(f.db, id).incorporated).toBe(false);
		expect(worker.requests).toHaveLength(0);
	} finally {
		await close(worker);
		host[latch] = previousLatch;
		host[launch] = previousLaunch;
	}
});

test("round2: hot-loaded bridge in a legacy launch cannot mint fresh startup intent", async () => {
	const f = await fixture();
	const latch = Symbol.for("apple-pi.launch-input-seal");
	const launch = Symbol.for("apple-pi.bridge-launch");
	const host = process as NodeJS.Process & Record<symbol, unknown>;
	const previousLatch = host[latch];
	const previousLaunch = host[launch];
	host[latch] = {};
	delete host[launch];
	const worker = await fauxSession(
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
	try {
		const id = worker.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(f.db.prepare("select incorporated from sessions where id = ?").get(id)).toBeDefined(),
		);
		expect(organizationLifetime(f.db, id).incorporated).toBe(false);
		expect(worker.requests).toHaveLength(0);
	} finally {
		await close(worker);
		host[latch] = previousLatch;
		host[launch] = previousLaunch;
	}
});

test("round2: native reload after wall-clock correction does not reapply its launch flag", async () => {
	const f = await fixture();
	await f.person("clock-target");
	const worker = await fauxSession(
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
	try {
		const id = worker.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(f.db.prepare("select incorporated from sessions where id = ?").get(id)).toEqual({ incorporated: 1 }),
		);
		expect(
			(
				await sendCommand(
					"operator",
					{ kind: "organization_move", person: id, manager: "clock-target", branch: [id] },
					{ socketPath: f.paths.socket },
				)
			).stage,
		).toBe("applied");
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now + 5000);
		try {
			worker.session.sessionManager.appendSessionInfo("clock-reloaded");
			await worker.session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
			await worker.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
			await vi.waitFor(() =>
				expect(f.db.prepare("select name from sessions where id = ?").get(id)).toEqual({ name: "clock-reloaded" }),
			);
			expect(organizationLifetime(f.db, "clock-target").incorporated).toBe(false);
		} finally {
			clock.mockRestore();
		}
		expect(worker.requests).toHaveLength(0);
	} finally {
		await close(worker);
	}
});

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
