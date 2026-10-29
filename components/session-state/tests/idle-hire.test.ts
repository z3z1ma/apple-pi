import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { sendCommand } from "../src/client.js";
import bridge from "../src/index.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const fixture = new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname;
afterEach(() => vi.unstubAllEnvs());
function launchFixture(state: ReturnType<typeof tempStateDir>) {
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
}

test("typed hire connects idle people for omitted and blank goals and still assigns explicit work", async () => {
	const state = tempStateDir();
	launchFixture(state);
	await startRuntime(state.socketPath);
	const role = "repository-archaeologist";
	const run = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage(
				[fauxToolCall("hire", { role, session_id: "idle", specialization: "Storage reliability" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[fauxToolCall("hire", { role, session_id: "blank", goal: " \n ", value: 50, cost_of_delay: 2 })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("hire", {
						role,
						session_id: "working",
						goal: "  Review the storage boundary.  ",
						title: "Storage review",
						value: 50,
						cost_of_delay: 2,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		],
		[],
		{ cwd: state.agentDir },
	);
	try {
		const manager = run.session.sessionManager.getSessionId();
		await vi.waitFor(
			() => expect(query(state.dbPath, "select id from sessions where id = ?", manager)).toHaveLength(1),
			{ timeout: 10000 },
		);
		await run.session.prompt("Bring in two idle people and assign a third the review.");
		const results = run.session.messages.filter((message) => message.role === "toolResult");
		expect(results).toHaveLength(3);
		for (const result of results) expect(result).toMatchObject({ isError: false });
		for (const id of ["idle", "blank", "working"]) {
			const person = query(
				state.dbPath,
				"select s.role, s.hired_at, i.started_at from sessions s join incarnations i on i.session_id = s.id and i.generation = s.generation where s.id = ?",
				id,
			)[0];
			expect(person.role).toBe(role);
			expect(person.hired_at).toBe(person.started_at);
			expect(person.hired_at).toBeGreaterThan(0);
		}
		for (const id of ["idle", "blank"]) {
			expect(query(state.dbPath, "select task_id from assignments where person = ?", id)).toEqual([]);
			expect(query(state.dbPath, "select task_id from work_focus where person = ?", id)).toEqual([]);
			expect(
				query(state.dbPath, "select command_id from commands where session_id = ? and kind = 'steer'", id),
			).toEqual([]);
			const command = JSON.parse(
				query<{ command: string }>(
					state.dbPath,
					"select command from commands where session_id = ? and kind = 'start'",
					id,
				)[0].command,
			);
			expect(command).toMatchObject({ role, prompt: "" });
			expect(command).not.toHaveProperty("goal");
		}
		const tasks = query<{ bundle: string }>(state.dbPath, "select bundle from work_tasks");
		expect(tasks).toHaveLength(1);
		const goalFile = readFileSync(join(tasks[0].bundle, "task.md"), "utf8");
		expect(goalFile).toContain("Storage review");
		expect(goalFile).toContain("Review the storage boundary.");
		expect(query(state.dbPath, "select person from assignments")).toEqual([{ person: "working" }]);
		const assigned = JSON.parse(
			query<{ command: string }>(
				state.dbPath,
				"select command from commands where session_id = 'working' and kind = 'start'",
			)[0].command,
		);
		expect(assigned.goal).toMatchObject({
			text: "Review the storage boundary.",
			title: "Storage review",
			value: 50,
			cost_of_delay: 2,
		});
		expect(
			query(state.dbPath, "select command_id from commands where session_id = 'working' and kind = 'steer'"),
		).toHaveLength(1);
		const before = query(state.dbPath, "select specialization, hired_at from sessions where id = 'idle'")[0];
		expect(before.specialization).toBe("Storage reliability");
		const pid = query<{ pid: number }>(
			state.dbPath,
			"select pid from incarnations where session_id = 'idle' and ended_at is null",
		)[0].pid;
		process.kill(pid, "SIGTERM");
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select ended_at from incarnations where session_id = 'idle' and pid = ?", pid)[0].ended_at,
			).not.toBeNull(),
		);
		const reopened = await sendCommand("idle", { kind: "start", specialization: "Replacement", prompt: "" });
		expect(reopened.stage, reopened.reason).toBe("applied");
		expect(query(state.dbPath, "select specialization, hired_at from sessions where id = 'idle'")).toEqual([before]);
		expect(query(state.dbPath, "select task_id from assignments where person = 'idle'")).toEqual([]);
	} finally {
		await close(run);
		await stopRuntime(state);
	}
}, 40000);

test("an idle hire that fails startup keeps its role and focus but no hire date on later call-in", async () => {
	const state = tempStateDir();
	launchFixture(state);
	await startRuntime(state.socketPath);
	try {
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ failStartup: true }));
		const failed = await sendCommand("failed-idle", {
			kind: "start",
			cwd: state.agentDir,
			role: "repository-archaeologist",
			specialization: "Reliability",
			prompt: "",
		});
		expect(failed.stage).toBe("failed");
		expect(query(state.dbPath, "select role, specialization, hired_at from sessions where id = 'failed-idle'")).toEqual(
			[{ role: "repository-archaeologist", specialization: "Reliability", hired_at: null }],
		);
		writeFileSync(join(state.agentDir, "peer-control.json"), "{}");
		const reopened = await sendCommand("failed-idle", { kind: "start", prompt: "" });
		expect(reopened.stage, reopened.reason).toBe("applied");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'failed-idle'")).toEqual([{ hired_at: null }]);
		expect(query(state.dbPath, "select id from work_tasks")).toEqual([]);
	} finally {
		await stopRuntime(state);
	}
}, 40000);
