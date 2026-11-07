import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { sendCommand } from "../src/client.js";
import { type Command, lineReader } from "../src/protocol.js";
import { readReview, reviewQueue, reviewStates } from "../src/review-read.js";
import { migrate } from "../src/schema.js";
import { anchorsOf, rootOf, taskOrganization } from "../src/tree.js";
import { fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

function person(db: DatabaseSync, id: string, manager: string | null) {
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
	).run(id, manager);
}

function depart(db: DatabaseSync, id: string, manager: string | null) {
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (0, 'runtime', ?, 'person_departed', ?)",
	).run(id, JSON.stringify({ reportsTo: manager }));
	db.prepare("delete from sessions where id = ?").run(id);
}

test("retained task anchors follow removed managers without changing their provenance", () => {
	const db = new DatabaseSync(":memory:");
	try {
		migrate(db);
		person(db, "head", null);
		person(db, "middle", "head");
		person(db, "old", "middle");
		person(db, "worker", "old");
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread) values ('task', '/task', '/', 'old', 1, 'task:task')",
		).run();
		depart(db, "old", "middle");
		depart(db, "middle", "head");
		expect(rootOf(db, "old")).toBe("head");
		expect(rootOf(db, "worker")).toBe("head");
		expect(rootOf(db, "worker", new Map([["worker", null]]))).toBe("worker");
		expect(taskOrganization(db, "task")).toBe("head");
		expect(anchorsOf(db, "head")).toEqual(["head", "old"]);
		expect(
			rootOf(
				db,
				"old",
				new Map([
					["head", "next"],
					["next", null],
				]),
			),
		).toBe("next");
		expect(() => rootOf(db, "old", new Map([["head", "old"]]))).toThrow("cycle");
		expect(db.prepare("select organization from work_tasks where id = 'task'").get()).toEqual({ organization: "old" });
	} finally {
		db.close();
	}
});

test("unknown ancestry and independent departures stay separate, and current reporting wins", () => {
	const db = new DatabaseSync(":memory:");
	try {
		migrate(db);
		person(db, "head", null);
		person(db, "worker", "missing");
		depart(db, "independent", null);
		depart(db, "obsolete", "head");
		person(db, "obsolete", null);
		expect(rootOf(db, "missing")).toBe("missing");
		expect(rootOf(db, "worker")).toBe("worker");
		expect(rootOf(db, "independent")).toBe("independent");
		expect(rootOf(db, "obsolete")).toBe("obsolete");
		expect(rootOf(db, "obsolete", new Map([["obsolete", "head"]]))).toBe("head");
		depart(db, "a", "b");
		depart(db, "b", "a");
		expect(() => rootOf(db, "a")).toThrow("cycle");
	} finally {
		db.close();
	}
});

test("after root cleanup its successor can read reviews, assign inherited tasks and resolve links, but strangers cannot", async () => {
	const state = tempStateDir();
	const people: { process: ReturnType<typeof standInProcess>; link: Awaited<ReturnType<typeof fakeBridge>> }[] = [];
	const repository = join(state.agentDir, "checkout");
	mkdirSync(repository);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
	git("init", "-q");
	writeFileSync(join(repository, "value.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
	const command = (id: string, value: Command) => sendCommand(id, value, { socketPath: state.socketPath });
	async function admit(id: string, manager: string | null) {
		const process = standInProcess();
		const link = await fakeBridge(state.socketPath, id, process.pid, process.startedAt, {
			session: { cwd: repository },
			facts: { reportsTo: manager },
		});
		people.push({ process, link });
		link.socket.on(
			"data",
			lineReader((line) => {
				const message = JSON.parse(line);
				if (message.type !== "command") return;
				if (message.command.kind === "close") {
					link.send({ type: "shutdown", reason: "quit" });
					process.child.kill();
				} else link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
			}),
		);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = ?", id)).toEqual([
				{ reports_to: manager },
			]),
		);
	}
	function read<T>(action: (db: DatabaseSync) => T) {
		const db = new DatabaseSync(state.dbPath, { readOnly: true });
		try {
			return action(db);
		} finally {
			db.close();
		}
	}
	try {
		await startRuntime(state.socketPath);
		await admit("old", null);
		await admit("successor", null);
		await admit("worker", "successor");
		await admit("outsider", null);
		const taken = await command("old", {
			kind: "work",
			action: "take",
			cwd: repository,
			goal: "Keep the inherited work accessible.",
			title: "Inherited work",
			value: 0,
			cost_of_delay: 0,
		});
		expect(taken.stage, taken.reason).toBe("applied");
		const task = query<{ id: string }>(state.dbPath, "select id from work_tasks where organization = 'old'")[0]!.id;
		const capture = await command("old", {
			kind: "review",
			version: 1,
			operation: {
				action: "enqueue",
				request: { cwd: repository, target: { kind: "range", base: "HEAD", head: "HEAD" } },
			},
		});
		expect(capture.stage, capture.reason).toBe("applied");
		const review = query<{ id: string }>(state.dbPath, "select id from review_jobs where organization = 'old'")[0]!.id;
		const linked = await command("old", {
			kind: "link_record",
			from: { kind: "file", id: "value.ts" },
			to: { kind: "commit", id: "abc" },
			relation: "produced",
		});
		expect(linked.stage, linked.reason).toBe("applied");
		const failedCapture = await command("old", {
			kind: "review",
			version: 1,
			operation: {
				action: "enqueue",
				request: { cwd: repository, target: { kind: "range", base: "missing-revision", head: "HEAD" } },
			},
		});
		expect(failedCapture.stage).toBe("failed");
		const unfinishedReview = query<{ id: string }>(
			state.dbPath,
			"select id from review_jobs where state = 'failed'",
		)[0]!.id;
		const moved = await command("operator", {
			kind: "organization_move",
			person: "old",
			manager: "successor",
			branch: ["old"],
		});
		expect(moved.stage, moved.reason).toBe("applied");
		for (const value of [
			{ kind: "work", action: "assign", cwd: repository, person: "successor", task },
			{ kind: "work", action: "unassign", cwd: repository, person: "old", task },
			{ kind: "review", version: 1, operation: { action: "reassign", review, owner: "successor" } },
		] as Command[]) {
			const receipt = await command("successor", value);
			expect(receipt.stage, receipt.reason).toBe("applied");
		}
		expect(
			(
				await command("successor", {
					kind: "review",
					version: 1,
					operation: { action: "reassign", review: unfinishedReview, owner: "worker" },
				})
			).stage,
		).toBe("applied");
		const partialMove: Command = {
			kind: "organization_move",
			person: "worker",
			manager: "outsider",
			branch: ["worker"],
		};
		expect(await command("operator", partialMove)).toMatchObject({
			stage: "failed",
			reason: expect.stringContaining(unfinishedReview),
		});
		const retired = await command("old", {
			kind: "retire",
			by: "operator",
			reason: "Replaced by the successor.",
			handoff: false,
			successor: "successor",
		});
		expect(retired.stage, retired.reason).toBe("applied");
		expect(query(state.dbPath, "select id from sessions where id = 'old'")).toEqual([]);
		expect(
			query(state.dbPath, "select data from events where session_id = 'old' and type = 'person_departed'"),
		).toHaveLength(1);
		expect(read((db) => readReview(db, "successor", review))).toMatchObject({
			owner: "successor",
			organization: "old",
			state: "no-changes",
		});
		expect(read((db) => reviewQueue(db, "successor").total)).toBe(2);
		expect(read((db) => reviewStates(db, "successor"))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: review }),
				expect.objectContaining({ id: unfinishedReview }),
			]),
		);
		expect(() => read((db) => readReview(db, "outsider", review))).toThrow("another organization");
		expect(read((db) => reviewQueue(db, "outsider").total)).toBe(0);
		for (const value of [
			{ kind: "work", action: "assign", cwd: repository, person: "outsider", task },
			{ kind: "link_resolve", id: linked.commandId },
		] as Command[]) {
			const receipt = await command("outsider", value);
			expect(receipt).toMatchObject({ stage: "failed", reason: expect.stringContaining("another organization") });
		}
		for (const [actor, value] of [
			["successor", { kind: "work", action: "assign", cwd: repository, person: "worker", task }],
			["worker", { kind: "work", action: "focus", cwd: repository, task }],
			["successor", { kind: "link_resolve", id: linked.commandId, resolution: "verified" }],
		] as [string, Command][]) {
			const receipt = await command(actor, value);
			expect(receipt.stage, receipt.reason).toBe("applied");
		}
		const refused = await command("operator", partialMove);
		expect(refused).toMatchObject({ stage: "failed", reason: expect.stringContaining(task) });
		expect(refused.reason).toContain(unfinishedReview);
		expect(query(state.dbPath, "select reports_to from sessions where id = 'worker'")).toEqual([
			{ reports_to: "successor" },
		]);
		expect(
			query(state.dbPath, "select ended_at from assignments where person = 'worker' and task_id = ?", task),
		).toEqual([{ ended_at: null }]);
		expect((await command("worker", { kind: "work", action: "focus", cwd: repository, task })).stage).toBe("applied");
		expect(
			(await command("successor", { kind: "work", action: "unassign", cwd: repository, person: "worker", task })).stage,
		).toBe("applied");
		const reviewOnly = await command("operator", partialMove);
		expect(reviewOnly).toMatchObject({ stage: "failed", reason: expect.stringContaining(unfinishedReview) });
		expect(reviewOnly.reason).not.toContain(task);
		expect(
			(await command("successor", { kind: "work", action: "assign", cwd: repository, person: "worker", task })).stage,
		).toBe("applied");
		expect(
			(
				await command("operator", {
					kind: "organization_move",
					person: "successor",
					manager: "outsider",
					branch: ["successor", "worker"],
				})
			).stage,
		).toBe("applied");
		expect(read((db) => rootOf(db, "old"))).toBe("outsider");
		expect((await command("worker", { kind: "work", action: "focus", cwd: repository, task })).stage).toBe("applied");
		expect(query(state.dbPath, "select organization from work_tasks where id = ?", task)).toEqual([
			{ organization: "old" },
		]);
		expect(query(state.dbPath, "select organization, resolution from links where id = ?", linked.commandId)).toEqual([
			{ organization: "old", resolution: "verified" },
		]);
		await admit("broken-a", "broken-b");
		expect(
			(
				await command("broken-a", {
					kind: "work",
					action: "take",
					cwd: repository,
					goal: "Retain invalid ancestry for diagnosis.",
					title: "Cycle diagnosis",
					value: 0,
					cost_of_delay: 0,
				})
			).stage,
		).toBe("applied");
		await admit("broken-b", "broken-a");
		await admit("destination", null);
		const healthyMove: Command = {
			kind: "organization_move",
			person: "outsider",
			manager: "destination",
			branch: ["outsider", "successor", "worker"],
		};
		const failedMove = await sendCommand("operator", healthyMove, {
			socketPath: state.socketPath,
			commandId: "cyclic-move",
			signal: AbortSignal.timeout(5000),
		});
		expect(failedMove).toMatchObject({ stage: "failed", reason: expect.stringContaining("cycle") });
		expect(query(state.dbPath, "select stage, reason from commands where command_id = 'cyclic-move'")).toEqual([
			{ stage: "failed", reason: failedMove.reason },
		]);
		expect(
			await sendCommand("operator", healthyMove, {
				socketPath: state.socketPath,
				commandId: "cyclic-move",
			}),
		).toMatchObject({ stage: "failed", reason: failedMove.reason });
		expect(query(state.dbPath, "select reports_to from sessions where id = 'outsider'")).toEqual([
			{ reports_to: null },
		]);
	} finally {
		for (const { process, link } of people) {
			link.socket.destroy();
			process.child.kill();
		}
		await stopRuntime(state);
		vi.unstubAllEnvs();
	}
}, 30000);
