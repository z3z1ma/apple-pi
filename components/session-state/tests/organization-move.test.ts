import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sendCommand } from "../src/client.js";
import type { Command } from "../src/protocol.js";
import { fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const processes: ReturnType<typeof standInProcess>[] = [];
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	for (const { child } of processes) child.kill();
	await stopRuntime(state);
});

const seen = (id: string) =>
	vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
async function person(id: string, reportsTo?: string, manages = false) {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { name: id },
		facts: { ...(reportsTo ? { reportsTo } : {}), ...(manages ? { manages: true } : {}) },
	});
	await seen(id);
	return link;
}
const move = (command: Extract<Command, { kind: "organization_move" }>) => sendCommand("operator", command);
const reports = (id: string) =>
	query<{ reports_to: string | null; hired_at: number | null }>(
		state.dbPath,
		"select reports_to, hired_at from sessions where id = ?",
		id,
	);

test("the operator moves a branch across organizations without rewriting hire dates", async () => {
	await person("alpha", undefined, true);
	await person("beta", undefined, true);
	await person("maya", "alpha");
	await person("nia", "maya");
	const db = new DatabaseSync(state.dbPath);
	db.prepare("update sessions set hired_at = 5 where id = 'maya'").run();
	db.close();
	const moved = await move({
		kind: "organization_move",
		person: "maya",
		manager: "beta",
		branch: ["maya", "nia"],
	});
	expect(moved.stage, moved.reason).toBe("applied");
	expect(reports("maya")).toEqual([{ reports_to: "beta", hired_at: 5 }]);
	expect(reports("nia")).toEqual([{ reports_to: "maya", hired_at: null }]);
	expect(
		query(
			state.dbPath,
			"select participant from thread_participants where thread_id = 'team:beta' order by participant",
		),
	).toEqual([{ participant: "beta" }, { participant: "maya" }]);
	const again = await move({ kind: "organization_move", person: "maya", manager: "beta", branch: ["maya", "nia"] });
	expect(again.stage, again.reason).toBe("applied");
	expect(
		query(state.dbPath, "select type from events where session_id = 'maya' and type = 'transferred'"),
	).toHaveLength(1);
	const agent = await sendCommand("maya", { kind: "transfer", manager: "alpha", by: "beta" });
	expect(agent.stage).toBe("failed");
	expect(reports("maya")).toEqual([{ reports_to: "beta", hired_at: 5 }]);
});

test("a split stays independent when the old launch flag reconnects", async () => {
	await person("root", undefined, true);
	const link = await person("split", "root");
	const notices: string[] = [];
	link.socket.on("data", (chunk) => notices.push(chunk.toString()));
	const moved = await move({ kind: "organization_move", person: "split", manager: null, branch: ["split"] });
	expect(moved.stage, moved.reason).toBe("applied");
	expect(reports("split")).toEqual([{ reports_to: null, hired_at: null }]);
	await vi.waitFor(() => expect(notices.join("")).toContain('"manager":""'));
	const stand = standInProcess();
	processes.push(stand);
	await fakeBridge(state.socketPath, "split", stand.pid, stand.startedAt, {
		session: { name: "split" },
		facts: { reportsTo: "root" },
	});
	await vi.waitFor(
		() => expect(query(state.dbPath, "select generation from incarnations where session_id = 'split'")).toHaveLength(2),
		{ timeout: 15000 },
	);
	expect(reports("split")).toEqual([{ reports_to: null, hired_at: null }]);
	await person("admitted", "root");
	expect(reports("admitted")).toEqual([{ reports_to: "root", hired_at: null }]);
});

test("a stale branch, a cycle, an incapable manager, and a departed person are refused", async () => {
	await person("home", undefined, true);
	await person("lead", "home", true);
	await person("report", "lead");
	await person("worker", "home");
	const stale = await move({ kind: "organization_move", person: "lead", manager: null, branch: ["lead"] });
	expect(stale.reason).toBe("the branch changed; review it and try again");
	const cycle = await move({
		kind: "organization_move",
		person: "home",
		manager: "lead",
		branch: ["home", "lead", "report", "worker"],
	});
	expect(cycle.reason).toBe("that manager is in this branch");
	const incapable = await move({
		kind: "organization_move",
		person: "report",
		manager: "worker",
		branch: ["report"],
	});
	expect(incapable.reason).toBe("that person cannot manage a branch");
	const db = new DatabaseSync(state.dbPath);
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (1, 'runtime', 'gone', 'person_departed', '{}')",
	).run();
	db.close();
	const departed = await move({ kind: "organization_move", person: "gone", manager: "home", branch: ["gone"] });
	expect(departed.reason).toBe("A permanently departed person cannot take part in a reporting change.");
	const stranger = await sendCommand("home", {
		kind: "organization_move",
		person: "report",
		manager: null,
		branch: ["report"],
	});
	expect(stranger.reason).toBe("only the operator can move a branch across organizations");
	expect(reports("lead")[0]?.reports_to).toBe("home");
});

test("lasting branch matching hides temporary descendants but keeps their work and ancestry safe", async () => {
	await person("visible-root", undefined, true);
	await person("visible-lead", "visible-root", true);
	await person("visible-child", "visible-lead");
	await person("hidden-peer", "visible-lead", true);
	await person("destination", undefined, true);
	const db = new DatabaseSync(state.dbPath);
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (1, 'runtime', 'hidden-peer', 'program_peer_created', ?)",
	).run(JSON.stringify({ caller: "visible-lead" }));
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread) values ('hidden-work', '/tmp/hidden-work', '/tmp', 'visible-root', 1, 'task:hidden-work')",
	).run();
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at) values ('hidden-peer', 'hidden-work', 'operator', 1)",
	).run();
	db.close();
	const direct = await move({
		kind: "organization_move",
		person: "hidden-peer",
		manager: "destination",
		branch: ["hidden-peer"],
	});
	expect(direct.reason).toBe("a temporary peer cannot change organization");
	const temporaryManager = await move({
		kind: "organization_move",
		person: "visible-child",
		manager: "hidden-peer",
		branch: ["visible-child"],
	});
	expect(temporaryManager.reason).toBe("a temporary peer cannot change organization");
	const stale = await move({
		kind: "organization_move",
		person: "visible-lead",
		manager: "destination",
		branch: ["visible-lead"],
	});
	expect(stale.reason).toBe("the branch changed; review it and try again");
	const blocked = await move({
		kind: "organization_move",
		person: "visible-lead",
		manager: "destination",
		branch: ["visible-lead", "visible-child"],
	});
	expect(blocked.reason).toBe("unfinished work would leave its organization: hidden-work");
	const ended = new DatabaseSync(state.dbPath);
	ended.prepare("update assignments set ended_at = 2, outcome = 'done' where task_id = 'hidden-work'").run();
	ended.close();
	const moved = await move({
		kind: "organization_move",
		person: "visible-lead",
		manager: "destination",
		branch: ["visible-lead", "visible-child"],
	});
	expect(moved.stage, moved.reason).toBe("applied");
	expect(reports("visible-lead")[0]?.reports_to).toBe("destination");
	expect(reports("visible-child")[0]?.reports_to).toBe("visible-lead");
	expect(reports("hidden-peer")[0]?.reports_to).toBe("visible-lead");
});

test("unfinished work blocks a partial move but a whole-organization merge preserves the assignment and focus", async () => {
	await person("tree", undefined, true);
	await person("other", undefined, true);
	await person("holder", "tree");
	const db = new DatabaseSync(state.dbPath);
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread) values ('task-a', '/tmp/task-a', '/tmp', 'tree', 1, 'task:task-a')",
	).run();
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at) values ('holder', 'task-a', 'operator', 1)",
	).run();
	db.prepare("insert into work_focus (person, task_id) values ('holder', 'task-a')").run();
	db.close();
	const partial = await move({
		kind: "organization_move",
		person: "holder",
		manager: "other",
		branch: ["holder"],
	});
	expect(partial.reason).toBe("unfinished work would leave its organization: task-a");
	expect(reports("holder")).toEqual([{ reports_to: "tree", hired_at: null }]);
	const merged = await move({
		kind: "organization_move",
		person: "tree",
		manager: "other",
		branch: ["tree", "holder"],
	});
	expect(merged.stage, merged.reason).toBe("applied");
	expect(reports("tree")).toEqual([{ reports_to: "other", hired_at: null }]);
	expect(reports("holder")).toEqual([{ reports_to: "tree", hired_at: null }]);
	expect(query(state.dbPath, "select organization from work_tasks where id = 'task-a'")).toEqual([
		{ organization: "tree" },
	]);
	expect(query(state.dbPath, "select task_id from work_focus where person = 'holder'")).toEqual([
		{ task_id: "task-a" },
	]);
	expect(
		query(state.dbPath, "select task_id, assigned_by, assigned_at, ended_at from assignments where person = 'holder'"),
	).toEqual([{ task_id: "task-a", assigned_by: "operator", assigned_at: 1, ended_at: null }]);
});
