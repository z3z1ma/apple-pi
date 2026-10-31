import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sendCommand } from "../src/client.js";
import { fakeBridge, query, runtimePid, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

let state: ReturnType<typeof tempStateDir>;
let parent: ReturnType<typeof standInProcess>;
let owner: Awaited<ReturnType<typeof fakeBridge>>;
let repository: string;
beforeEach(async () => {
	state = tempStateDir();
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	const fixture = new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname;
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	mkdirSync(join(state.agentDir, "roles"));
	writeFileSync(
		join(state.agentDir, "roles", "code-review-specialist.md"),
		'---\ntitle: Fixture Reviewer\nmandate: Inspect the captured source.\nmodels: ["fixture/code-review-specialist:high"]\nwrites: false\nmanages: false\n---\nRead the source and report evidence.\n',
	);
	repository = join(state.agentDir, "checkout");
	mkdirSync(repository);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
	git("init", "-q");
	writeFileSync(join(repository, "value.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
	writeFileSync(join(repository, "value.ts"), "export const value = 2;\n");
	await startRuntime(state.socketPath);
	parent = standInProcess();
	owner = await fakeBridge(state.socketPath, "owner", parent.pid, parent.startedAt, { session: { cwd: repository } });
	await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'owner'")).toHaveLength(1));
});
afterEach(async () => {
	owner?.socket.destroy();
	parent?.child.kill();
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

test("capture and admission survive the requesting connection closing and exact retries retain one target", async () => {
	const command = {
		kind: "review" as const,
		version: 1 as const,
		operation: {
			action: "enqueue" as const,
			request: {
				cwd: repository,
				target: { kind: "working-tree" as const, base: "HEAD" },
				intent: { text: "Change the exported value to two." },
			},
		},
	};
	const accepted = await sendCommand("owner", command, {
		socketPath: state.socketPath,
		commandId: "capture-request",
		until: "accepted",
	});
	expect(accepted.stage).toBe("accepted");
	owner.socket.destroy();
	await vi.waitFor(
		() => {
			const rows = query(state.dbPath, "select id from review_jobs where artifact is not null");
			expect(rows).toHaveLength(1);
			expect(query(state.dbPath, "select stage from commands where command_id = 'capture-request'")).toEqual([
				{ stage: "applied" },
			]);
		},
		{ timeout: 5000 },
	);
	const [row] = query<{ id: string; artifact: string }>(state.dbPath, "select id, artifact from review_jobs");
	const artifact = JSON.parse(row!.artifact);
	expect(readFileSync(join(artifact.source, "value.ts"), "utf8")).toBe("export const value = 2;\n");
	writeFileSync(join(repository, "value.ts"), "export const value = 3;\n");
	const repeated = await sendCommand("owner", command, { socketPath: state.socketPath, commandId: "capture-request" });
	expect(repeated.stage).toBe("applied");
	expect(query(state.dbPath, "select id from review_jobs")).toEqual([{ id: row!.id }]);
	expect(readFileSync(join(artifact.source, "value.ts"), "utf8")).toBe("export const value = 2;\n");
}, 15000);

test("an ordinary reviewer runs in captured source and its result survives guarded peer cleanup", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const job = await enqueue();
	writeFileSync(join(repository, "value.ts"), "export const value = 3;\n");
	await vi.waitFor(
		() => {
			const row = query<{ state: string; reason: string | null }>(
				state.dbPath,
				"select state, reason from review_jobs where id = ?",
				job.id,
			)[0]!;
			expect(row.state, row.reason ?? "Review remains pending").toBe("completed");
		},
		{ timeout: 10000 },
	);
	const attempts = query<{ person: string; model: string; thinking: string; output: string; state: string }>(
		state.dbPath,
		"select person, model, thinking, output, state from review_attempts where review_id = ?",
		job.id,
	);
	expect(attempts.length).toBeGreaterThan(0);
	for (const attempt of attempts) {
		expect(attempt).toMatchObject({ state: "completed", model: "fixture/code-review-specialist", thinking: "high" });
		expect(JSON.parse(attempt.output).summary).toContain("export const value = 2;");
		const header = JSON.parse(
			readFileSync(join(state.agentDir, "peer-records", `${attempt.person}.jsonl`), "utf8").split("\n")[0]!,
		);
		expect(header.cwd).toBe(JSON.parse(job.artifact).source);
	}
	expect(query(state.dbPath, "select * from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select * from program_peers")).toEqual([]);
	expect(query(state.dbPath, "select * from work_tasks")).toEqual([]);
	expect(readFileSync(join(repository, "value.ts"), "utf8")).toBe("export const value = 3;\n");
}, 20000);

async function settled(id: string, expected: string) {
	await vi.waitFor(
		() => {
			const job = query<{ state: string; reason: string | null }>(
				state.dbPath,
				"select state, reason from review_jobs where id = ?",
				id,
			)[0]!;
			const errors = join(state.agentDir, "review-sdk-errors.log");
			expect(
				job.state,
				`${job.reason ?? "Review pending"}${existsSync(errors) ? readFileSync(errors, "utf8") : ""}`,
			).toBe(expected);
		},
		{ timeout: 20000 },
	);
}

test("a declared authority risk dispatches a distinct inspection over the same regions", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { authority: true } }));
	writeFileSync(join(repository, "value.ts"), "export function remove(id: string) {\n  store.delete(id);\n}\n");
	const job = await enqueue();
	await settled(job.id, "completed");
	const focused = query<{ pass_id: string; person: string; input: string }>(
		state.dbPath,
		"select pass_id, person, input from review_attempts where review_id = ? and kind = 'focused' order by created_at",
		job.id,
	);
	expect(focused.map((entry) => entry.pass_id)).toEqual(["value-correctness", "deletion-authority"]);
	expect(new Set(focused.map((entry) => entry.person)).size).toBe(2);
	const inputs = focused.map((entry) => JSON.parse(readFileSync(JSON.parse(entry.input).contextFile, "utf8")));
	expect(inputs[1].pass.regions).toEqual(inputs[0].pass.regions);
	expect(inputs[1].pass.questions[0].question).toBe("Who may remove these records?");
}, 30000);

test("incomplete evidence stays incomplete with zero findings and can resume without repeating finished planning", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { partial: true } }));
	const job = await enqueue();
	await settled(job.id, "incomplete");
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const resumed = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(resumed.stage, resumed.reason).toBe("applied");
	await settled(job.id, "completed");
	expect(
		query(state.dbPath, "select id from review_attempts where review_id = ? and kind = 'planner'", job.id),
	).toHaveLength(1);
	expect(
		query(state.dbPath, "select id from review_attempts where review_id = ? and kind = 'focused'", job.id),
	).toHaveLength(2);
}, 30000);

test("a malformed planner result retains its observed usage without turning zero findings into a clean review", async () => {
	const job = await enqueue();
	await settled(job.id, "failed");
	const [attempt] = query<{ state: string; output: string | null; reason: string; result: string }>(
		state.dbPath,
		"select state, output, reason, result from review_attempts where review_id = ?",
		job.id,
	);
	expect(attempt).toMatchObject({
		state: "failed",
		output: null,
		reason: expect.stringContaining("Invalid review output"),
	});
	expect(JSON.parse(attempt!.result)).toMatchObject({ status: "completed", usage: { cost: { total: 0.3 } } });
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

test("a model outside the recorded role policy fails before a review turn is dispatched", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: true, model: "unexpected/fallback" }),
	);
	const job = await enqueue();
	await settled(job.id, "failed");
	const [attempt] = query<{ model: string; result: string | null }>(
		state.dbPath,
		"select model, result from review_attempts where review_id = ?",
		job.id,
	);
	expect(attempt).toEqual({ model: "unexpected/fallback", result: null });
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select command_id from commands where kind = 'run_turn'")).toEqual([]);
}, 30000);

test("cancellation retains observed turn usage and waits for reviewer cleanup", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { hold: "inspection" } }));
	const job = await enqueue();
	await vi.waitFor(
		() =>
			expect(
				query(
					state.dbPath,
					"select id from review_attempts where review_id = ? and kind = 'focused' and state = 'running'",
					job.id,
				),
			).toHaveLength(1),
		{ timeout: 10000 },
	);
	const cancelled = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "cancel", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(cancelled.stage, cancelled.reason).toBe("applied");
	await settled(job.id, "cancelled");
	const [attempt] = query<{ state: string; result: string }>(
		state.dbPath,
		"select state, result from review_attempts where review_id = ? and kind = 'focused'",
		job.id,
	);
	expect(attempt!.state).toBe("cancelled");
	expect(JSON.parse(attempt!.result)).toMatchObject({ status: "failed", usage: { cost: { total: 0.3 } } });
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select session_id from program_peers")).toEqual([]);
}, 30000);

test("actual first provider inputs keep author narrative and other first reports out until validation", async () => {
	const fixture = new URL("../../../tests/fixtures/review-sdk-peer.ts", import.meta.url).pathname;
	const register = new URL("../src/register.mjs", import.meta.url).pathname;
	writeFileSync(
		join(state.agentDir, "bin", "pi"),
		`#!/bin/sh\nexec '${process.execPath}' --import '${register}' '${fixture}' "$@"\n`,
		{ mode: 0o700 },
	);
	const role = join(state.agentDir, "roles", "code-review-specialist.md");
	writeFileSync(
		role,
		readFileSync(role, "utf8").replace(
			"fixture/code-review-specialist:high",
			"faux-session-provider/faux-session-model:off",
		),
	);
	owner.send({ type: "facts", facts: { self: "## My story\nAUTHOR_NARRATIVE_SENTINEL" } });
	await vi.waitFor(() =>
		expect(query(state.dbPath, "select self from sessions where id = 'owner'")[0]?.self).toContain(
			"AUTHOR_NARRATIVE_SENTINEL",
		),
	);
	const job = await enqueue();
	await settled(job.id, "completed");
	const attempts = query<{ kind: string; person: string }>(
		state.dbPath,
		"select kind, person from review_attempts where review_id = ? order by created_at",
		job.id,
	);
	for (const attempt of attempts) {
		const inputs = readFileSync(join(state.agentDir, "provider-inputs", `${attempt.person}.jsonl`), "utf8");
		expect(inputs).not.toContain("AUTHOR_NARRATIVE_SENTINEL");
		expect(inputs).not.toContain("Team context at your arrival");
		expect(inputs).toContain("export const value = 2;");
		if (attempt.kind === "validation") expect(inputs).toContain("OTHER_FIRST_REPORT_SENTINEL");
		else expect(inputs.split("\n").slice(0, 4).join("\n")).not.toContain("OTHER_FIRST_REPORT_SENTINEL");
		const requests = inputs
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(JSON.stringify(requests[0])).toContain(JSON.parse(job.artifact).source);
		expect(JSON.stringify(requests[0])).toContain("Read the source and report evidence.");
		const shellResults = requests
			.flatMap((request) => request.messages)
			.filter((message) => message.role === "toolResult" && message.toolName === "bash");
		expect(shellResults.length).toBeGreaterThan(0);
		for (const result of shellResults) {
			expect(result.isError).toBe(false);
			expect(JSON.stringify(result.content)).toContain(JSON.parse(job.artifact).source);
		}
	}
	expect(attempts.some((attempt) => attempt.kind === "validation")).toBe(true);
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

async function enqueue() {
	const receipt = await sendCommand(
		"owner",
		{
			kind: "review",
			version: 1,
			operation: { action: "enqueue", request: { cwd: repository, target: { kind: "working-tree", base: "HEAD" } } },
		},
		{ socketPath: state.socketPath },
	);
	expect(receipt.stage, receipt.reason).toBe("applied");
	return query<{ id: string; artifact: string; generation: number }>(
		state.dbPath,
		"select id, artifact, generation from review_jobs",
	)[0]!;
}

test("a branch cannot leave an unfinished review behind, but can move after cancellation", async () => {
	const manager = await fakeBridge(state.socketPath, "manager", parent.pid, parent.startedAt, {
		session: { cwd: repository },
	});
	try {
		owner.send({ type: "facts", facts: { reportsTo: "manager" } });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = 'owner'")).toEqual([
				{ reports_to: "manager" },
			]),
		);
		const job = await enqueue();
		const move = { kind: "organization_move" as const, person: "owner", manager: null, branch: ["owner"] };
		const refused = await sendCommand("operator", move, { socketPath: state.socketPath });
		expect(refused).toMatchObject({ stage: "failed", reason: expect.stringContaining(job.id) });
		await sendCommand(
			"owner",
			{ kind: "review", version: 1, operation: { action: "cancel", review: job.id } },
			{ socketPath: state.socketPath },
		);
		const moved = await sendCommand("operator", move, { socketPath: state.socketPath });
		expect(moved.stage, moved.reason).toBe("applied");
	} finally {
		manager.socket.destroy();
	}
}, 15000);

async function restart() {
	process.kill(runtimePid(state.pidPath)!, "SIGTERM");
	await vi.waitFor(() => expect(existsSync(state.socketPath)).toBe(false), { timeout: 5000 });
	await startRuntime(state.socketPath);
}

test("restart requires explicit resume of the same verified source and rejects a damaged target", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ helloGate: join(state.agentDir, "release-review") }),
	);
	const job = await enqueue();
	const artifact = JSON.parse(job.artifact);
	await restart();
	expect(query(state.dbPath, "select state from review_jobs")).toEqual([{ state: "interrupted" }]);
	writeFileSync(join(repository, "value.ts"), "export const value = 3;\n");
	writeFileSync(join(artifact.source, "value.ts"), "export const value = 99;\n");
	const resume = {
		kind: "review" as const,
		version: 1 as const,
		operation: { action: "resume" as const, review: job.id },
	};
	const refused = await sendCommand("owner", resume, { socketPath: state.socketPath });
	expect(refused).toMatchObject({ stage: "failed", reason: expect.stringContaining("Captured source changed") });
	writeFileSync(join(artifact.source, "value.ts"), "export const value = 2;\n");
	const resumed = await sendCommand("owner", resume, { socketPath: state.socketPath });
	expect(resumed.stage, resumed.reason).toBe("applied");
	const current = query<{ artifact: string; generation: number }>(
		state.dbPath,
		"select artifact, generation from review_jobs",
	)[0]!;
	expect(JSON.parse(current.artifact).digest).toBe(artifact.digest);
	expect(current.generation).toBeGreaterThan(job.generation);
	expect(readFileSync(join(artifact.source, "value.ts"), "utf8")).toBe("export const value = 2;\n");
}, 15000);

test("after interruption an obsolete receipt cannot complete the replacement attempt", async () => {
	const controls = join(state.agentDir, "peer-control.json");
	writeFileSync(controls, JSON.stringify({ review: { hold: "inspection" } }));
	const job = await enqueue();
	await vi.waitFor(
		() =>
			expect(
				query(
					state.dbPath,
					"select id from review_attempts where review_id = ? and kind = 'focused' and state = 'running'",
					job.id,
				),
			).toHaveLength(1),
		{ timeout: 10000 },
	);
	const old = query<{ id: string; person: string; generation: number }>(
		state.dbPath,
		"select id, person, generation from review_attempts where review_id = ? and kind = 'focused'",
		job.id,
	)[0]!;
	await restart();
	await settled(job.id, "interrupted");
	writeFileSync(controls, JSON.stringify({ review: { hold: "inspection" }, replayReviewTurn: `${old.id}:turn` }));
	const resume = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(resume.stage, resume.reason).toBe("applied");
	await vi.waitFor(
		() =>
			expect(
				query(state.dbPath, "select id from sessions where last_error = ?", `Observed obsolete receipt ${old.id}:turn`),
			).toHaveLength(1),
		{ timeout: 10000 },
	);
	const replacement = query<{ id: string; person: string; generation: number; state: string; result: string | null }>(
		state.dbPath,
		"select id, person, generation, state, result from review_attempts where review_id = ? and kind = 'focused' order by created_at desc",
		job.id,
	)[0]!;
	expect(replacement.id).not.toBe(old.id);
	expect(replacement.person).not.toBe(old.person);
	expect(replacement.generation).toBeGreaterThan(old.generation);
	expect(replacement).toMatchObject({ state: "running", result: null });
	expect(query(state.dbPath, "select state, result from review_attempts where id = ?", old.id)).toEqual([
		{ state: "interrupted", result: null },
	]);
	expect(query(state.dbPath, "select state from review_jobs where id = ?", job.id)).toEqual([{ state: "running" }]);
	const cancel = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "cancel", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(cancel.stage, cancel.reason).toBe("applied");
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

test("an unfinished review prevents owner departure until it is explicitly cancelled", async () => {
	const job = await enqueue();
	await vi.waitFor(() => expect(query(state.dbPath, "select state from review_jobs")).toEqual([{ state: "failed" }]), {
		timeout: 10000,
	});
	const refusal = await sendCommand(
		"owner",
		{ kind: "retire", by: "operator", reason: "Close the fixture", handoff: false },
		{ socketPath: state.socketPath, until: "accepted" },
	);
	expect(refusal).toMatchObject({ stage: "failed", reason: expect.stringContaining("review") });
	const cancelled = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "cancel", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(cancelled.stage, cancelled.reason).toBe("applied");
	expect(query(state.dbPath, "select state from review_jobs")).toEqual([{ state: "cancelled" }]);
	expect(query(state.dbPath, "select retired_at from sessions where id = 'owner'")).toEqual([{ retired_at: null }]);
}, 15000);
