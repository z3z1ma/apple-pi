import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import {
	fakeBridge,
	query,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { openCommands } from "../src/backend/commands.js";
import { openOrg } from "../src/backend/org.js";
import { openWorldBackend } from "../src/backend/world-backend.js";
import type { OrgStartProgress, OrgStartRequest } from "../src/org.js";

function retry(plan: OrgStartRequest, progress: OrgStartProgress, withReady = false): OrgStartRequest {
	return {
		...plan,
		withReady,
		positions: plan.positions.map((position) => ({
			...position,
			person: progress.people.find((person) => person.id === position.id)!.person,
		})),
	};
}

test("Org holds team openings, preserves retry goals and sends one kickoff to the head", async () => {
	const state = tempStateDir();
	const directory = realpathSync(state.agentDir);
	const bin = join(directory, "bin");
	const log = join(directory, "launches.jsonl");
	const failure = join(directory, "fail-worker");
	mkdirSync(bin);
	writeFileSync(failure, "Fail the report before its first hello.");
	writeFileSync(
		join(bin, "pi"),
		`#!${process.execPath}
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { createConnection } = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const id = flag("--session-id");
const db = new DatabaseSync(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.db", { readOnly: true });
const task = db.prepare("select t.bundle from work_tasks t join work_focus f on f.task_id = t.id where f.person = ?").get(id);
const goal = task ? readFileSync(task.bundle + "/task.md", "utf8") : null;
const manager = flag("--reports-to");
const managerReady = !manager || !!db.prepare("select 1 from incarnations where session_id = ? and ended_at is null and process_state = 'alive'").get(manager);
db.close();
const record = (value) => appendFileSync(process.env.ORG_RUNTIME_LOG, JSON.stringify({ id, ...value }) + "\\n");
record({ event: "launch", args, goal, managerReady });
if (flag("--role") !== "coordinator" && existsSync(process.env.ORG_RUNTIME_FAILURE)) process.exit(1);
const startedAt = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim());
const socket = createConnection(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.sock");
const send = (value) => socket.write(JSON.stringify(value) + "\\n");
let heartbeat;
socket.on("connect", () => {
	send({ type: "hello", session: { id, kind: "root", cwd: process.cwd(), name: flag("--name") },
		process: { pid: process.pid, startedAt }, run: "idle",
		facts: { reportsTo: manager ?? null, role: flag("--role"), manages: flag("--role") === "coordinator" } });
	heartbeat = setInterval(() => send({ type: "heartbeat" }), 1000);
});
let buffer = "";
socket.on("data", (chunk) => {
	buffer += chunk.toString();
	for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
		const message = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		if (message.type !== "command") continue;
		record({ event: "command", command: message.command });
		send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
	}
});
socket.on("close", () => { clearInterval(heartbeat); process.exit(0); });
process.stdin.resume();
process.stdin.on("end", () => socket.end());
`,
	);
	chmodSync(join(bin, "pi"), 0o755);
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("ORG_RUNTIME_LOG", log);
	vi.stubEnv("ORG_RUNTIME_FAILURE", failure);
	await startRuntime(state.socketPath);
	const stand = standInProcess();
	const seed = await fakeBridge(state.socketPath, "seed", stand.pid, stand.startedAt, {
		session: { cwd: directory },
		facts: { manages: true },
	});
	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const commands = openCommands(state.socketPath);
	let org = openOrg({ db: state.dbPath, agentDir: directory }, commands, () => world.snapshot());
	const plan: OrgStartRequest = {
		id: "socket-plan",
		cwd: directory,
		goal: "Deliver the invoice retry change.",
		positions: [
			{
				id: "report",
				manager: "head",
				role: "implementation-engineer",
				name: "Report",
				goal: "Implement invoice retries.",
			},
			{ id: "head", manager: null, role: "coordinator", name: "Head", goal: "Coordinate invoice retry delivery." },
		],
	};
	try {
		await vi.waitFor(
			() => {
				expect(world.snapshot().connected).toBe(true);
				expect(world.snapshot().workplace?.threads.some((thread) => thread.id === "organization:seed")).toBe(true);
			},
			{ timeout: 10000 },
		);
		const partial = await org.orgStart(plan);
		expect(partial.next).toBe("choose-ready");
		expect(partial.kickoff).toBeUndefined();
		const head = partial.people.find((person) => person.id === "head")!.person!;
		const report = partial.people.find((person) => person.id === "report")!.person!;
		expect(partial.people).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "head", state: "ready" }),
				expect.objectContaining({ id: "report", state: "failed" }),
			]),
		);
		expect(
			query(
				state.dbPath,
				"select delivery, read_up_to from thread_participants where thread_id = ? and participant = 'operator'",
				partial.channel!,
			),
		).toEqual([{ delivery: "pull", read_up_to: 0 }]);
		const subset = await org.orgStart(retry(plan, partial, true));
		expect(subset.kickoff).toBeDefined();
		const kickoffThread = subset.kickoff!.thread;
		expect(subset.complete).toBe(false);
		expect(subset.people.find((person) => person.id === "report")?.state).toBe("failed");
		rmSync(failure);
		org = openOrg({ db: state.dbPath, agentDir: directory }, commands, () => world.snapshot());
		const complete = await org.orgStart(retry(plan, subset));
		expect(complete.complete, JSON.stringify(complete)).toBe(true);
		expect(Object.fromEntries(complete.people.map(({ id, person }) => [id, person]))).toEqual(
			Object.fromEntries(partial.people.map(({ id, person }) => [id, person])),
		);
		expect(complete.readiness?.thread).toBe(`organization:${head}`);
		await vi.waitFor(
			() => {
				const tasks = world.snapshot().workplace?.tasks ?? [];
				expect(tasks).toHaveLength(2);
				expect(
					tasks.map((task) => ({
						headquarters: task.headquarters,
						people: task.assignees.map((assignee) => assignee.person),
					})),
				).toEqual(
					expect.arrayContaining([
						{ headquarters: head, people: [head] },
						{ headquarters: head, people: [report] },
					]),
				);
			},
			{ timeout: 10000 },
		);
		const kickoff = query<{ body: string }>(
			state.dbPath,
			"select body from thread_messages where thread_id = ?",
			kickoffThread,
		);
		expect(kickoff).toHaveLength(1);
		expect(kickoff[0].body.startsWith(`${plan.goal}\n\nReady teammates (session IDs):\n`)).toBe(true);
		expect(JSON.parse(kickoff[0].body.split("Ready teammates (session IDs):\n")[1])).toEqual([head]);

		const recorded = () =>
			readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
		await vi.waitFor(
			() => {
				const readiness = recorded().filter(
					(entry) =>
						entry.event === "command" && entry.command.kind === "mail" && entry.command.thread === complete.channel,
				);
				expect(readiness.map((entry) => entry.id)).toEqual([head]);
				const receivedKickoff = recorded().filter(
					(entry) =>
						entry.event === "command" && entry.command.kind === "mail" && entry.command.thread === kickoffThread,
				);
				expect(receivedKickoff.map((entry) => ({ id: entry.id, body: entry.command.body }))).toEqual([
					{ id: head, body: kickoff[0].body },
				]);
			},
			{ timeout: 10000 },
		);
		expect(recorded().filter((entry) => entry.event === "command" && entry.command.kind === "steer")).toEqual([]);
		const launches = recorded().filter((entry) => entry.event === "launch");
		expect(launches[0].id).toBe(head);
		expect(launches.filter((entry) => entry.id === head)).toHaveLength(1);
		expect(launches.every((entry) => entry.managerReady)).toBe(true);
		expect(launches[0].goal).toContain("Coordinate invoice retry delivery.");
		const reportLaunches = launches.filter((entry) => entry.id === report);
		expect(reportLaunches.length).toBeGreaterThan(1);
		for (const launch of reportLaunches) expect(launch.goal).toContain("Implement invoice retries.");
		await org.orgStart(retry(plan, complete));
		expect(recorded().filter((entry) => entry.event === "launch")).toHaveLength(launches.length);
		expect(query(state.dbPath, "select id from thread_messages where thread_id = ?", complete.channel!)).toHaveLength(
			1,
		);
		expect(query(state.dbPath, "select id from thread_messages where thread_id = ?", kickoffThread)).toHaveLength(1);
	} finally {
		world.close();
		commands.close();
		seed.socket.destroy();
		stand.child.kill();
		await stopRuntime(state);
	}
}, 30000);
