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

test("an unfinished review prevents owner departure until it is explicitly cancelled", async () => {
	const job = await enqueue();
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
