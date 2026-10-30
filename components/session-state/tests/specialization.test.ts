import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { specializationOf } from "../../organization/src/directory.js";
import { installOrganization } from "../../organization/src/install.js";
import { loadRoles } from "../../organization/src/roles.js";
import { SELF_ENTRY } from "../../organization/src/self.js";
import { ROLE_ENTRY } from "../../organization/src/session-role.js";
import * as client from "../src/client.js";
import { sendCommand } from "../src/client.js";
import { installCoordinator } from "../src/coordinator.js";
import bridge from "../src/index.js";
import { migrate } from "../src/schema.js";
import { close, fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";
import { rewindRecentSchema } from "./historical-schema.js";

const fixture = new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname;
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function launchFixture(state: ReturnType<typeof tempStateDir>) {
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
}

test("creation focus reaches the prompt and survives failed startup, retry and reconnect without changing role", async () => {
	const state = tempStateDir();
	launchFixture(state);
	const manager = standInProcess();
	const sessionManager = SessionManager.inMemory(state.agentDir);
	sessionManager.appendCustomEntry(ROLE_ENTRY, {
		role: "staff-engineer-simplicity",
		mind: { model: "faux-session-provider/faux-session-model", thinking: "off" },
		soul: {
			fragments: [
				{ title: "One", extract: "First" },
				{ title: "Two", extract: "Second" },
				{ title: "Three", extract: "Third" },
			],
		},
	});
	const selfStory = "I preserve the evidence behind each engineering decision.";
	sessionManager.appendCustomEntry(SELF_ENTRY, { story: selfStory });
	const expectedPromptBodies = [
		"<specialization>\nApply this focus within your role; fulfill all role responsibilities.\n\nFocus on database correctness.",
		loadRoles(state.agentDir).roles.get("staff-engineer-simplicity")!.body.trimEnd(),
		`<self>\n## My story\n${selfStory}`,
		"**One**",
		"First",
		"**Two**",
		"Second",
		"**Three**",
		"Third",
	];
	const id = sessionManager.getSessionId();
	await startRuntime(state.socketPath);
	let run: Awaited<ReturnType<typeof fauxSession>> | undefined;
	try {
		await fakeBridge(state.socketPath, "manager", manager.pid, manager.startedAt, {
			session: { cwd: state.agentDir },
			facts: { manages: true },
		});
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'manager'")).toHaveLength(1));
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ failStartup: true }));
		const failed = await sendCommand(id, {
			kind: "start",
			cwd: state.agentDir,
			reportsTo: "manager",
			role: "staff-engineer-simplicity",
			specialization: "  Focus on database correctness.  ",
			goal: { text: "Prove creation context.", by: "manager" },
		});
		expect(failed.stage, failed.reason).toBe("failed");
		expect(specializationOf(id)).toBe("Focus on database correctness.");
		writeFileSync(join(state.agentDir, "peer-control.json"), "{}");
		const retry = await sendCommand(id, { kind: "start", specialization: "Replace the original focus." });
		expect(retry.stage, retry.reason).toBe("applied");
		expect(specializationOf(id)).toBe("Focus on database correctness.");
		run = await fauxSession(
			[installOrganization],
			[fauxAssistantMessage("ok"), fauxAssistantMessage("again")],
			["read", "edit", "write"],
			{ cwd: state.agentDir, sessionManager },
		);
		await run.session.prompt("Check the assigned work.");
		for (const body of expectedPromptBodies) expect(run.session.agent.state.systemPrompt).toContain(body);
		expect(run.session.getActiveToolNames()).toContain("read");
		expect(run.session.getActiveToolNames()).not.toContain("edit");
		expect(run.session.getActiveToolNames()).not.toContain("write");
		const pid = query<{ pid: number }>(
			state.dbPath,
			"select pid from incarnations where session_id = ? and ended_at is null",
			id,
		)[0].pid;
		process.kill(pid, "SIGTERM");
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select ended_at from incarnations where session_id = ? and pid = ?", id, pid)[0].ended_at,
			).not.toBeNull(),
		);
		const reopened = await sendCommand(id, { kind: "start", specialization: "Changed at call in" });
		expect(reopened.stage, reopened.reason).toBe("applied");
		await run.session.bindExtensions({});
		await run.session.prompt("Resume.");
		expect(specializationOf(id)).toBe("Focus on database correctness.");
		for (const body of expectedPromptBodies) expect(run.session.agent.state.systemPrompt).toContain(body);
		expect(run.session.getActiveToolNames()).toContain("read");
		expect(run.session.getActiveToolNames()).not.toContain("edit");
		expect(run.session.getActiveToolNames()).not.toContain("write");
	} finally {
		run?.dispose();
		manager.child.kill();
		await stopRuntime(state);
	}
}, 40000);

test("absence remains absence on later starts, while goal-less new creation can retain focus", async () => {
	const state = tempStateDir();
	launchFixture(state);
	await startRuntime(state.socketPath);
	try {
		for (const [id, specialization] of [
			["absent", undefined],
			["empty", "  \n  "],
			["focused", "Data integrity"],
		] as const) {
			const result = await sendCommand(id, { kind: "start", cwd: state.agentDir, specialization });
			expect(result.stage, result.reason).toBe("applied");
		}
		expect(query(state.dbPath, "select id, specialization from sessions order by id")).toEqual([
			{ id: "absent", specialization: null },
			{ id: "empty", specialization: null },
			{ id: "focused", specialization: "Data integrity" },
		]);
		const pid = query<{ pid: number }>(
			state.dbPath,
			"select pid from incarnations where session_id = 'absent' and ended_at is null",
		)[0].pid;
		process.kill(pid, "SIGTERM");
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select ended_at from incarnations where session_id = 'absent' and pid = ?", pid)[0]
					.ended_at,
			).not.toBeNull(),
		);
		const reopened = await sendCommand("absent", { kind: "start", specialization: "Invented later" });
		expect(reopened.stage, reopened.reason).toBe("applied");
		expect(specializationOf("absent")).toBeNull();
	} finally {
		await stopRuntime(state);
	}
}, 40000);

test("manager hire forwards trimmed specialization through the typed tool and leaves omitted hires unchanged", async () => {
	const state = tempStateDir();
	launchFixture(state);
	await startRuntime(state.socketPath);
	const role = "repository-archaeologist";
	const run = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage(
				[
					fauxToolCall("hire", {
						role,
						goal: "Check creation context.",
						title: "Check creation context",
						session_id: "tool-focused",
						specialization: "  Focus on storage reliability.\n ",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("hire", {
						role,
						goal: "Check ordinary creation.",
						title: "Check ordinary creation",
						session_id: "tool-ordinary",
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
		await run.session.prompt("Hire the two people with their written goals.");
		const results = run.session.messages.filter((message) => message.role === "toolResult");
		expect(results).toHaveLength(2);
		for (const result of results) expect(result).toMatchObject({ isError: false });

		expect(
			query(
				state.dbPath,
				"select id, role, manages, specialization, reports_to from sessions where id like 'tool-%' order by id",
			),
		).toEqual([
			{ id: "tool-focused", role, manages: 0, specialization: "Focus on storage reliability.", reports_to: manager },
			{ id: "tool-ordinary", role, manages: 0, specialization: null, reports_to: manager },
		]);
	} finally {
		await close(run);
		await stopRuntime(state);
	}
}, 40000);

test("manager hire refuses nonempty focus before transport on old schemas, but omitted and blank remain ordinary", async () => {
	const state = tempStateDir();
	mkdirSync(state.stateDir);
	const manager = SessionManager.inMemory(state.agentDir);
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	rewindRecentSchema(db, 31);
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values (?, 'root', ?, 'idle', 1, 'fixture', 1)",
	).run(manager.getSessionId(), state.agentDir);
	db.close();
	const transport = vi
		.spyOn(client, "sendCommand")
		.mockResolvedValue({ type: "receipt", commandId: "old-writer", stage: "applied" });
	const run = await fauxSession(
		[installOrganization, installCoordinator],
		[
			fauxAssistantMessage(
				[
					fauxToolCall("hire", {
						role: "repository-archaeologist",
						goal: "Check focus.",
						title: "Check focus",
						session_id: "blocked",
						specialization: "Keep this focus",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("hire", {
						role: "repository-archaeologist",
						goal: "Ordinary hire.",
						title: "Ordinary hire",
						session_id: "omitted",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("hire", {
						role: "repository-archaeologist",
						goal: "Blank hire.",
						title: "Blank hire",
						session_id: "blank",
						specialization: "  ",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		],
		[],
		{ cwd: state.agentDir, sessionManager: manager },
	);
	try {
		await run.session.prompt("Try the creator options.");
		const results = run.session.messages.filter((message) => message.role === "toolResult");
		expect(results).toHaveLength(3);
		expect(results[0]).toMatchObject({ isError: true });
		expect(JSON.stringify(results[0])).toContain("Restart the session runtime");
		for (const result of results.slice(1)) expect(result).toMatchObject({ isError: false });
		expect(transport.mock.calls.map(([id]) => id)).toEqual(["omitted", "blank"]);
		for (const [, command] of transport.mock.calls) expect(command).not.toHaveProperty("specialization");
	} finally {
		run.dispose();
		rmSync(state.agentDir, { recursive: true, force: true });
	}
});

test("older schemas read no focus and migration never backfills historical people", async () => {
	const state = tempStateDir();
	mkdirSync(state.stateDir);
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	rewindRecentSchema(db, 31);
	db.exec(
		"insert into sessions (id,kind,cwd,run_state,generation,source,updated_at) values ('old','root','/','idle',1,'fixture',1)",
	);
	try {
		expect(specializationOf("old")).toBeNull();
		migrate(db);
		expect(specializationOf("old")).toBeNull();
		expect(db.prepare("select specialization from sessions where id='old'").get()).toEqual({ specialization: null });
	} finally {
		db.close();
		rmSync(state.agentDir, { recursive: true, force: true });
	}
});

test("a person with no recorded focus gets no specialization prompt section", async () => {
	const state = tempStateDir();
	const run = await fauxSession([installOrganization], [fauxAssistantMessage("ok")], []);
	try {
		await run.session.prompt("Hi");
		expect(run.session.agent.state.systemPrompt).not.toContain("<specialization>");
	} finally {
		run.dispose();
		rmSync(state.agentDir, { recursive: true, force: true });
	}
});
