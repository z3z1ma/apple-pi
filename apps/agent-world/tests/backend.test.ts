import { afterAll, beforeAll, expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import {
	close,
	fakeBridge,
	query,
	runtimePid,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { openWorldBackend, PREFERENCE_KEY, type WorldBackend } from "../src/backend/world-backend.js";
import type { WorldSnapshot } from "../src/world.js";

// Seam 1: the backend API in Node, without Electron, over a real session-state runtime.
const state = tempStateDir();
const processes: ReturnType<typeof standInProcess>[] = [];
const heartbeats: NodeJS.Timeout[] = [];
let world: WorldBackend;
const updates: WorldSnapshot[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribe((snapshot) => updates.push(snapshot));
});
afterAll(async () => {
	world.close();
	for (const beat of heartbeats) clearInterval(beat);
	for (const { child } of processes) child.kill();
	await stopRuntime(state);
});

const names = (snapshot: WorldSnapshot) => snapshot.characters.map((character) => character.name);
const latest = () => updates.at(-1) ?? world.snapshot();
const character = (id: string) => latest().characters.find((c) => c.id === id);
const wings = (headquarters: string, snapshot = latest()) =>
	snapshot.headquarters.find((hq) => hq.id === headquarters)?.wings.map((wing) => `${wing.name}:${wing.headcount}`);
const recorded = (sql: string, ...params: string[]) =>
	vi.waitFor(() => expect(query(state.dbPath, sql, ...params)).toHaveLength(1), { timeout: 15000 });
const soon = (check: () => void) => vi.waitFor(check, { timeout: 3000 });

/** A top-level session on a fake bridge, kept alive by heartbeats; `stop` ends it the way Pi quits. */
async function session(id: string, options: { coordinator?: boolean; reportsTo?: string; repository?: string } = {}) {
	const stand = standInProcess();
	processes.push(stand);
	const { repository } = options;
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { cwd: `/home/${id}` },
		facts: {
			reportsTo: options.reportsTo ?? null,
			git: repository ? { repository, worktree: repository, branch: "main" } : null,
			config: {
				name: id,
				flags: options.coordinator ? ["coordinator"] : [],
				activeTools: [],
				extensions: [],
				skills: [],
				mcpServers: [],
			},
		},
	});
	link.socket.on("error", () => {}); // heartbeats meet a closed socket while the runtime is down
	const beat = setInterval(() => link.send({ type: "heartbeat" }), 1000);
	heartbeats.push(beat);
	await soon(() => expect(character(id)).toBeDefined());
	return {
		async stop() {
			link.send({ type: "shutdown", reason: "quit" });
			clearInterval(beat);
			link.socket.end();
			stand.child.kill();
			await recorded("select 1 from incarnations where session_id = ? and ended_at is not null", id);
		},
	};
}

test("a root session becomes a character within a second of the runtime recording it, and leaves when it ends", async () => {
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 5000 });
	const run = await fauxSession([bridge], [], []);
	const id = run.session.sessionManager.getSessionId();
	try {
		await recorded("select 1 from sessions where id = ?", id);
		await vi.waitFor(() => expect(latest().characters.map((c) => c.id)).toContain(id), { timeout: 1000 });
	} finally {
		await close(run);
	}
	await recorded("select 1 from incarnations where session_id = ? and ended_at is not null", id);
	await vi.waitFor(() => expect(latest().characters.map((c) => c.id)).not.toContain(id), { timeout: 1000 });
}, 30000);

test("child sessions are not characters; a named root session shows its name", async () => {
	const stand = standInProcess();
	processes.push(stand);
	await fakeBridge(state.socketPath, "root-1", stand.pid, stand.startedAt, { session: { name: "docs-worker" } });
	await fakeBridge(state.socketPath, "child-1", stand.pid, stand.startedAt, {
		session: { kind: "child", spawnedBy: "root-1" },
	});
	await recorded("select 1 from sessions where id = 'child-1'");
	await vi.waitFor(() => expect(names(latest())).toContain("docs-worker"), { timeout: 1000 });
	expect(latest().characters.map((c) => c.id)).not.toContain("child-1");
}, 20000);

test("the coordinator is in its hall, its workers in their repository's wing or else the common room, independents in the square, and stopped sessions in no awake place", async () => {
	await session("coord-1", { coordinator: true });
	await session("w-alpha", { reportsTo: "coord-1", repository: "/repos/alpha" });
	await session("w-loose", { reportsTo: "coord-1" });
	await session("solo");
	const gone = await session("w-gone", { reportsTo: "coord-1", repository: "/repos/alpha" });
	await gone.stop();
	await soon(() => expect(character("w-gone")).toBeUndefined());
	expect(character("coord-1")).toMatchObject({
		role: "coordinator",
		place: { kind: "headquarters", headquarters: "coord-1" },
	});
	expect(character("w-alpha")).toMatchObject({
		role: "worker",
		place: { kind: "wing", headquarters: "coord-1", repository: "/repos/alpha" },
	});
	expect(character("w-loose")).toMatchObject({
		role: "worker",
		place: { kind: "common-room", headquarters: "coord-1" },
	});
	expect(character("solo")).toMatchObject({ role: "independent", place: { kind: "square" } });
	expect(latest().headquarters.map((hq) => hq.id)).toEqual(["coord-1"]);
	expect(wings("coord-1")).toEqual(["alpha:1"]);
	// Characters come in the order their sessions started, so nobody moves when another leaves.
	const ids = latest().characters.map((c) => c.id);
	expect(ids.indexOf("coord-1")).toBeLessThan(ids.indexOf("w-alpha"));
	expect(ids.indexOf("w-alpha")).toBeLessThan(ids.indexOf("solo"));
}, 60000);

test("two coordinators each get their own headquarters; a session others report to is a coordinator without the flag", async () => {
	await session("lead");
	await session("w-lead", { reportsTo: "lead", repository: "/repos/alpha" });
	await soon(() => expect(latest().headquarters.map((hq) => hq.id)).toEqual(["coord-1", "lead"]));
	expect(character("lead")).toMatchObject({
		role: "coordinator",
		place: { kind: "headquarters", headquarters: "lead" },
	});
	expect(character("w-lead")?.place).toEqual({ kind: "wing", headquarters: "lead", repository: "/repos/alpha" });
	expect(wings("coord-1")).toEqual(["alpha:1"]);
	expect(wings("lead")).toEqual(["alpha:1"]);
}, 30000);

test("a wing stays once seen, in first-seen order, boarded when its last agent stops, and is still there after the app restarts", async () => {
	const beta = await session("w-beta", { reportsTo: "coord-1", repository: "/repos/beta" });
	await session("w-gamma", { reportsTo: "coord-1", repository: "/repos/gamma" });
	await session("w-alpha-2", { reportsTo: "coord-1", repository: "/repos/alpha" });
	await soon(() => expect(wings("coord-1")).toEqual(["alpha:2", "beta:1", "gamma:1"]));
	await beta.stop();
	await soon(() => expect(wings("coord-1")).toEqual(["alpha:2", "beta:0", "gamma:1"]));
	// Remembered through the runtime, as a preference.
	await soon(() => {
		const [row] = query<{ value: string }>(state.dbPath, "select value from preferences where key = ?", PREFERENCE_KEY);
		expect(JSON.parse(row?.value ?? "{}").wings).toEqual({
			"coord-1": ["/repos/alpha", "/repos/beta", "/repos/gamma"],
			lead: ["/repos/alpha"],
		});
	});

	world.close();
	const restarted = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	try {
		await soon(() => expect(wings("coord-1", restarted.snapshot())).toEqual(["alpha:2", "beta:0", "gamma:1"]));
	} finally {
		restarted.close();
	}
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribe((snapshot) => updates.push(snapshot));
}, 60000);

test("the world shows it is disconnected while the runtime is gone and reconnects when it returns", async () => {
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 3000 });
	const pid = runtimePid(state.pidPath)!;
	process.kill(pid, "SIGTERM");
	await vi.waitFor(() => expect(latest().connected).toBe(false), { timeout: 3000 });
	await startRuntime(state.socketPath);
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 3000 });
}, 20000);
