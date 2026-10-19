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
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { WorldSnapshot } from "../src/world.js";

// Seam 1: the backend API in Node, without Electron, over a real session-state runtime.
const state = tempStateDir();
const processes: ReturnType<typeof standInProcess>[] = [];
let world: WorldBackend;
const updates: WorldSnapshot[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribe((snapshot) => updates.push(snapshot));
});
afterAll(async () => {
	world.close();
	for (const { child } of processes) child.kill();
	await stopRuntime(state);
});

const names = (snapshot: WorldSnapshot) => snapshot.characters.map((character) => character.name);
const latest = () => updates.at(-1) ?? world.snapshot();
const recorded = (sql: string, ...params: string[]) =>
	vi.waitFor(() => expect(query(state.dbPath, sql, ...params)).toHaveLength(1), { timeout: 15000 });

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

test("the world shows it is disconnected while the runtime is gone and reconnects when it returns", async () => {
	const pid = runtimePid(state.pidPath)!;
	process.kill(pid, "SIGTERM");
	await vi.waitFor(() => expect(latest().connected).toBe(false), { timeout: 3000 });
	await startRuntime(state.socketPath);
	await vi.waitFor(() => expect(latest().connected).toBe(true), { timeout: 3000 });
}, 20000);
