import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { openCommands } from "../../../apps/agent-workplace/src/backend/commands.js";
import { openOrg } from "../../../apps/agent-workplace/src/backend/org.js";
import type { WorldSnapshot } from "../../../apps/agent-workplace/src/world.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/bridge.js";
import { sendCommand } from "../src/client.js";
import { organizationLifetime, requireDissolution } from "../src/organization-lifetime.js";
import { statePaths } from "../src/paths.js";
import { lineReader } from "../src/protocol.js";
import { Runtime } from "../src/runtime.js";
import { migrate } from "../src/schema.js";
import { close, fakeBridge, standInProcess, tempStateDir } from "./helpers.js";
import { rewindRecentSchema } from "./historical-schema.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.unstubAllEnvs();
});

async function fixture() {
	const state = tempStateDir();
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
			onCall?: boolean;
		} = {},
	) {
		const process = standInProcess();
		const file = join(state.agentDir, `${id}.jsonl`);
		writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: state.agentDir })}\n`);
		const link = await fakeBridge(paths.socket, id, process.pid, process.startedAt, {
			session: { file, interactive: options.interactive, incorporate: options.incorporate },
			facts: { reportsTo: options.manager ?? null, onCall: options.onCall ?? false },
			run: options.run,
		});
		link.socket.on(
			"data",
			lineReader((line) => {
				const message = JSON.parse(line);
				if (message.type === "command" && message.command.kind === "close") {
					if (options.holdClose) return;
					link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
					link.send({ type: "shutdown", reason: "quit" });
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
				link.send({ type: "shutdown", reason });
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
	const reopened = await f.person("root");
	expect(organizationLifetime(f.db, "root").closing).toBe(false);
	busy.send({ type: "run", run: "idle" });
	f.db.prepare("update assignments set ended_at = 1 where person = 'busy'").run();
	await new Promise((resolve) => setTimeout(resolve, 1400));
	expect(f.departed("busy")).toBeUndefined();
	expect(f.departed("root")).toBeUndefined();
	expect(f.departed("idle")).toBeDefined();
	expect(() => requireDissolution(f.db, "busy", "root", 1)).toThrow(/no longer current/);
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
	expect(
		(
			await sendCommand(
				"root",
				{ kind: "incorporate", by: "operator" },
				{ socketPath: f.paths.socket, commandId: "keep" },
			)
		).stage,
	).toBe("applied");
	expect(f.db.prepare("select count(*) as n from events where type = 'organization_incorporated'").get()).toEqual({
		n: 1,
	});
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
	expect((await sendCommand("headless", { kind: "close" }, { socketPath: f.paths.socket })).stage).toBe("applied");
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

test("native flag consumption and /incorporate command need no model turn", async () => {
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
	expect(
		f.db
			.prepare(
				"select count(*) as n from events where session_id = 'flagged' and type = 'organization_startup_incorporated'",
			)
			.get(),
	).toEqual({ n: 1 });
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
