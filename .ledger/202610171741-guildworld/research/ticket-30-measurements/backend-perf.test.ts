import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	fakeBridge,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { serialize } from "node:v8";
import { FACTS_COLUMNS, FACTS_JOINS, factsOf, taskReader } from "../src/backend/facts.js";
import { dormantAgents } from "../src/backend/inn.js";
import { readMail } from "../src/backend/mail.js";
import { projectWorld } from "../src/backend/projection.js";
import { openWorldBackend } from "../src/backend/world-backend.js";
import type { WorldSnapshot } from "../src/world.js";

// Scratch measurement (ticket 30): a synthetic database with many stopped root sessions, built through the real
// runtime's migrations, and the backend's snapshot build time, size, and update cost. Not part of the suite.
const LABEL = process.env.AW_PERF_LABEL ?? "run";
const DORMANT = Number(process.env.AW_PERF_DORMANT ?? 3000);
const AWAKE = 40;
const state = tempStateDir();
const processes: ReturnType<typeof standInProcess>[] = [];
const beats: NodeJS.Timeout[] = [];
const out: Record<string, unknown> = { label: LABEL, dormant: DORMANT, awake: AWAKE + 1 };

beforeAll(async () => {
	await startRuntime(state.socketPath);
	await vi.waitFor(() => {
		const db = new DatabaseSync(state.dbPath);
		try {
			db.prepare("select 1 from preferences").get();
		} finally {
			db.close();
		}
	}, { timeout: 10000 });
	const bundles = join(state.agentDir, "ledger");
	for (let t = 0; t < 60; t++) {
		mkdirSync(join(bundles, `task-${t}`), { recursive: true });
		writeFileSync(join(bundles, `task-${t}`, "task.md"), `# Task number ${t}\n\nStatus: in-progress\n`);
	}
	const db = new DatabaseSync(state.dbPath);
	db.exec("pragma busy_timeout = 10000");
	db.exec("begin");
	const now = Date.now();
	const session = db.prepare(`insert into sessions (id, kind, session_file, cwd, name, run_state, generation, source,
		updated_at, git, config, reports_to, current_task, cost, model) values (?, 'root', ?, ?, ?, 'idle', 1, 'bridge', ?, ?, ?, ?, ?, 1.5, 'claude')`);
	const incarnation = db.prepare(`insert into incarnations (session_id, generation, pid, process_started_at,
		process_state, started_at, ended_at, end_reason, source, updated_at) values (?, 1, ?, ?, 'exited', ?, ?, 'exited', 'bridge', ?)`);
	const message = db.prepare(`insert into messages (session_id, entry_id, part, at, role, tool, size, preview, source,
		observed_at) values (?, ?, '0', ?, ?, ?, 400, 'a preview of the message text that is about this long', 'runtime', ?)`);
	const mail = db.prepare(`insert into commands (command_id, session_id, generation, kind, command, stage, created_at,
		updated_at) values (?, ?, 1, 'mail', ?, ?, ?, ?)`);
	const event = db.prepare("insert into events (at, source, session_id, generation, type, data) values (?, 'bridge', ?, 1, ?, ?)");
	for (let i = 0; i < DORMANT; i++) {
		const id = `sleeper-${i}`;
		const repo = `/repos/project-${i % 30}`;
		const started = now - (DORMANT - i) * 600_000;
		session.run(id, `/sessions/${id}.jsonl`, repo, i % 3 ? `worker ${i}` : null, started,
			JSON.stringify({ repository: repo, worktree: repo, branch: `feature-${i}` }),
			JSON.stringify({ name: `worker ${i}`, flags: [], activeTools: [], extensions: [], skills: [], mcpServers: [] }),
			i % 4 === 0 ? null : "coord-0",
			JSON.stringify({ bundle: join(bundles, `task-${i % 60}`), taskId: `task-${i % 60}` }));
		incarnation.run(id, 1000 + i, started, started, started + 300_000, started + 300_000);
		for (let m = 0; m < 100; m++) message.run(id, `e${m}`, started + m, m % 2 ? "assistant" : "user", m % 5 ? null : "bash", started + m);
		for (let e = 0; e < 30; e++) event.run(started + e, id, "cost_changed", '{"cost":1}');
	}
	for (let k = 0; k < 5000; k++) {
		const stage = k % 50 === 0 ? "accepted" : "applied";
		mail.run(`mail-${k}`, `sleeper-${k % DORMANT}`, JSON.stringify({ kind: "mail", from: `sleeper-${(k + 7) % DORMANT}`, body: `Mail body number ${k} with some words in it.` }), stage, now - (5000 - k) * 1000, now - (5000 - k) * 1000);
	}
	db.exec("commit");
	db.close();
	// Awake: a coordinator and its workers, all in one wing.
	const awake = async (id: string, options: { coordinator?: boolean; reportsTo?: string; repository?: string }) => {
		const stand = standInProcess();
		processes.push(stand);
		const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
			session: { cwd: `/home/${id}` },
			facts: {
				reportsTo: options.reportsTo ?? null,
				git: options.repository ? { repository: options.repository, worktree: options.repository, branch: "main" } : null,
				config: { name: id, flags: options.coordinator ? ["coordinator"] : [], activeTools: [], extensions: [], skills: [], mcpServers: [] },
			},
		});
		link.socket.on("error", () => {});
		beats.push(setInterval(() => link.send({ type: "heartbeat" }), 1000));
		return link;
	};
	await awake("coord-0", { coordinator: true });
	for (let w = 0; w < AWAKE; w++) await awake(`busy-${w}`, { reportsTo: "coord-0", repository: "/repos/project-0" });
}, 180000);

afterAll(async () => {
	for (const beat of beats) clearInterval(beat);
	for (const { child } of processes) child.kill();
	writeFileSync(`/tmp/aw30/perf-${LABEL}.json`, JSON.stringify(out, null, 2));
	await stopRuntime(state);
});

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test("measure", async () => {
	// Wait until every awake session is recorded.
	{
		const probe = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
		await vi.waitFor(() => expect(probe.snapshot().characters.length).toBe(AWAKE + 1), { timeout: 30000 });
		probe.close();
	}
	// 1. A full snapshot build: the first poll runs inside openWorldBackend.
	const opens: number[] = [];
	for (let k = 0; k < 7; k++) {
		const start = performance.now();
		const backend = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
		opens.push(performance.now() - start);
		backend.close();
	}
	out.openMs = opens.map((ms) => Math.round(ms * 10) / 10);
	out.openMedianMs = median(opens);

	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	let publishes = 0;
	let last: WorldSnapshot | undefined;
	world.subscribe((snapshot) => {
		publishes++;
		last = snapshot;
	});
	await vi.waitFor(() => expect(world.snapshot().connected).toBe(true), { timeout: 5000 });
	const snapshot = world.snapshot();
	const json = JSON.stringify(snapshot);
	out.snapshotBytes = json.length;
	out.dormantBytes = JSON.stringify(snapshot.dormant).length;
	out.mailBytes = JSON.stringify(snapshot.mail).length;
	out.characters = snapshot.characters.length;
	out.dormantCount = snapshot.dormant?.length;
	out.mailCount = snapshot.mail?.length;

	// 2. Idle: no events for 6 s (the task reread runs every 2 s).
	await new Promise((resolve) => setTimeout(resolve, 1000));
	let elu = performance.eventLoopUtilization();
	publishes = 0;
	await new Promise((resolve) => setTimeout(resolve, 6000));
	elu = performance.eventLoopUtilization(elu);
	out.idle = { seconds: 6, busyFraction: elu.utilization, busyMsPerSecond: (elu.active / 6), publishes };

	// 3. Busy: a working agent's cost changes 10 times a second for 6 s.
	const writer = new DatabaseSync(state.dbPath);
	writer.exec("pragma busy_timeout = 5000");
	const bump = writer.prepare("update sessions set cost = cost + 0.01 where id = ?");
	const event = writer.prepare("insert into events (at, source, session_id, generation, type, data) values (?, 'bridge', ?, 1, 'cost_changed', '{}')");
	publishes = 0;
	const { Session } = await import("node:inspector/promises");
	const inspector = new Session();
	const PROF = !!process.env.AW_PROF;
	if (PROF) {
	inspector.connect();
	await inspector.post("Profiler.enable");
	await inspector.post("Profiler.setSamplingInterval", { interval: 200 });
	await inspector.post("Profiler.start");
	}
	elu = performance.eventLoopUtilization();
	const started = performance.now();
	let writes = 0;
	const timer = setInterval(() => {
		bump.run("busy-1");
		event.run(Date.now(), "busy-1");
		writes++;
	}, 100);
	await new Promise((resolve) => setTimeout(resolve, 6000));
	clearInterval(timer);
	elu = performance.eventLoopUtilization(elu);
	if (PROF) {
	const { profile } = (await inspector.post("Profiler.stop")) as any;
	inspector.disconnect();
	const self = new Map<string, number>();
	const dt = new Map<number, number>();
	profile.samples.forEach((id: number, i: number) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
	for (const node of profile.nodes) {
		const f = node.callFrame;
		const key = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}`;
		self.set(key, (self.get(key) ?? 0) + (dt.get(node.id) ?? 0) / 1000);
	}
	out.profileTop = [...self].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
	}
	const seconds = (performance.now() - started) / 1000;
	writer.close();
	out.busy = {
		seconds,
		writes,
		busyFraction: elu.utilization,
		busyMsPerSecond: elu.active / seconds,
		publishes,
		publishesPerSecond: publishes / seconds,
		ipcBytesPerSecond: (publishes * JSON.stringify(last).length) / seconds,
	};
	world.close();

	// 4. Where a full read's time goes, part by part (median of 7).
	const SESSIONS = `select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git, s.config,
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake,
	i.ended_at as stoppedAt, i.end_reason as stopReason, ${FACTS_COLUMNS}
from sessions s ${FACTS_JOINS} where s.kind = 'root'`;
	const db = new DatabaseSync(state.dbPath);
	db.exec("pragma query_only = 1");
	const parts: Record<string, number[]> = { query: [], project: [], facts: [], inn: [], mail: [], compareJson: [], ipcSerialize: [] };
	const readTask = taskReader();
	for (let k = 0; k < 7; k++) {
		let t = performance.now();
		const rows = db.prepare(SESSIONS).all() as any[];
		parts.query.push(performance.now() - t);
		t = performance.now();
		const sessions = rows.map((row) => ({ id: row.id, name: row.name, cwd: row.cwd, reportsTo: row.reportsTo, repository: JSON.parse(row.git ?? "null")?.repository ?? null, coordinatorFlag: JSON.parse(row.config ?? "null")?.flags?.includes("coordinator") ?? false, awake: row.awake === 1, firstStartedAt: row.firstStartedAt ?? undefined, stoppedAt: row.stoppedAt ?? undefined }));
		const projected = projectWorld(sessions, {});
		parts.project.push(performance.now() - t);
		const byId = new Map(rows.map((row) => [row.id, row]));
		t = performance.now();
		projected.characters.map((c) => factsOf(byId.get(c.id), readTask));
		parts.facts.push(performance.now() - t);
		t = performance.now();
		const inn = dormantAgents(projected.dormant, byId, readTask);
		parts.inn.push(performance.now() - t);
		{
			t = performance.now();
			(dormantAgents as any)(projected.dormant, byId, (task: string | null) => (readTask as any)(task, false), inn);
			(parts.innUnchanged ??= []).push(performance.now() - t);
		}
		t = performance.now();
		readMail(db);
		parts.mail.push(performance.now() - t);
		t = performance.now();
		JSON.stringify(snapshot) === JSON.stringify({ ...snapshot });
		parts.compareJson.push(performance.now() - t);
		t = performance.now();
		serialize(snapshot);
		parts.ipcSerialize.push(performance.now() - t);
	}
	db.close();
	out.partsMedianMs = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(median(v) * 100) / 100]));
}, 120000);
