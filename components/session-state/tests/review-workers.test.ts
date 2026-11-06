import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import codeReview from "../../../extensions/code-review.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { sendCommand } from "../src/client.js";
import { readReviewPart } from "../src/review-read.js";
import { fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

let state: ReturnType<typeof tempStateDir>;
let parent: ReturnType<typeof standInProcess>;
let owner: Awaited<ReturnType<typeof fakeBridge>>;
let awake: Awaited<ReturnType<typeof fakeBridge>>;
let repository: string;
let workers: { id: string; file: string; before: Buffer }[];

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
		'---\ntitle: Fixture Reviewer\nmandate: Inspect.\nmodels: ["fixture/code-review-specialist:high"]\nwrites: false\nmanages: false\n---\nInspect the source.\n',
	);
	repository = join(state.agentDir, "checkout");
	mkdirSync(repository);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
	git("init", "-q");
	writeFileSync(join(repository, "value.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
	writeFileSync(join(repository, "value.ts"), "export const value = 2;\n");
	workers = Array.from({ length: 4 }, (_, index) => {
		const session = SessionManager.create(repository, join(state.agentDir, "workers"));
		session.appendModelChange("fixture", `worker-${index}`);
		session.appendCustomEntry("organization-role", { role: "implementation-engineer" });
		session.appendMessage({
			...fauxAssistantMessage([{ type: "text", text: `Worker ${index} history` }]),
			provider: "fixture",
			model: `worker-${index}`,
		});
		const file = session.getSessionFile()!;
		return { id: session.getSessionId(), file, before: readFileSync(file) };
	});
	await startRuntime(state.socketPath);
	parent = standInProcess();
	owner = await fakeBridge(state.socketPath, "owner", parent.pid, parent.startedAt, { session: { cwd: repository } });
	awake = await fakeBridge(state.socketPath, workers[0]!.id, parent.pid, parent.startedAt, {
		session: { cwd: repository, file: workers[0]!.file },
		facts: { reportsTo: "owner", role: "implementation-engineer", model: "fixture/worker-0" },
	});
	const db = new DatabaseSync(state.dbPath);
	for (const worker of workers.slice(1))
		db.prepare(
			"insert into sessions (id, kind, cwd, name, session_file, reports_to, run_state, generation, source, updated_at) values (?, 'root', ?, ?, ?, 'owner', 'idle', 0, 'fixture', 1)",
		).run(worker.id, repository, `Worker ${workers.indexOf(worker)}`, worker.file);
	db.close();
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { authority: true } }));
});
afterEach(async () => {
	owner?.socket.destroy();
	awake?.socket.destroy();
	parent?.child.kill();
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

async function enqueue(selected: string[]) {
	const commandId = crypto.randomUUID();
	const receipt = await sendCommand(
		"owner",
		{
			kind: "review",
			version: 1,
			operation: {
				action: "enqueue",
				request: { cwd: repository, target: { kind: "working-tree", base: "HEAD" }, workers: selected },
			},
		},
		{ socketPath: state.socketPath, commandId },
	);
	expect(receipt.stage, receipt.reason).toBe("applied");
	return query<{ id: string }>(state.dbPath, "select id from review_jobs where command_id = ?", commandId)[0]!.id;
}
async function settled(id: string, expected: string) {
	await vi.waitFor(
		() => {
			const job = query<{ state: string; reason: string | null }>(
				state.dbPath,
				"select state, reason from review_jobs where id = ?",
				id,
			)[0]!;
			expect(job.state, job.reason ?? "Review pending").toBe(expected);
		},
		{ timeout: 15000 },
	);
}
function unchanged() {
	for (const worker of workers) expect(readFileSync(worker.file)).toEqual(worker.before);
}
function noResources() {
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select session_id from program_peers")).toEqual([]);
	for (const worker of workers) {
		expect(query(state.dbPath, "select id from sessions where id = ?", worker.id)).toHaveLength(1);
		expect(
			query(state.dbPath, "select command_id from commands where session_id = ? and kind = 'run_turn'", worker.id),
		).toEqual([]);
	}
	unchanged();
}
function attempts(id: string) {
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		return (
			readReviewPart(db, "owner", id, { part: "attempts", limit: 100 }) as {
				page: { rows: { id: string; pass: string; reviewer: { kind: string; person?: string }; state: string }[] };
			}
		).page;
	} finally {
		db.close();
	}
}

test("two existing workers fork in plan order before the third pass uses a temp", async () => {
	const id = await enqueue([workers[0]!.id, "Worker 1"]);
	await settled(id, "completed");
	const page = attempts(id).rows;
	for (const [pass, worker] of [
		["value-correctness", workers[0]!],
		["deletion-authority", workers[1]!],
	] as const) {
		const attempt = page.find((entry) => entry.pass === pass)!;
		const db = new DatabaseSync(state.dbPath, { readOnly: true });
		try {
			expect(readReviewPart(db, "owner", id, { part: "pass", pass })).toMatchObject({
				attempt: { reviewer: { kind: "worker", person: worker.id } },
			});
			expect(readReviewPart(db, "owner", id, { part: "log", attempt: attempt.id })).toMatchObject([
				{ reviewer: { kind: "worker", person: worker.id } },
			]);
		} finally {
			db.close();
		}
		expect(attempt.reviewer).toMatchObject({ kind: "worker", person: worker.id });
		const row = query<{ person: string; model: string }>(
			state.dbPath,
			"select person, model from review_attempts where id = ?",
			attempt.id,
		)[0]!;
		const launch = JSON.parse(readFileSync(join(state.agentDir, "peer-records", `${row.person}.launch.json`), "utf8"));
		expect(launch.args).toContain("--fork");
		expect(launch.args[launch.args.indexOf("--fork") + 1]).toBe(worker.file);
		expect(row.model).toBe(`fixture/worker-${workers.indexOf(worker)}`);
	}
	expect(page.find((entry) => entry.pass === "integration")!.reviewer).toEqual({ kind: "temp" });
	expect(page.find((entry) => entry.pass === "planner")!.reviewer).toEqual({ kind: "temp" });
	noResources();
}, 30000);

test("workers beyond the three planned passes remain unused", async () => {
	const id = await enqueue(workers.map(({ id }) => id));
	await settled(id, "completed");
	const selected = attempts(id).rows.filter((entry) => entry.reviewer.kind === "worker");
	expect(selected.map((entry) => entry.reviewer.person).sort()).toEqual(
		workers
			.slice(0, 3)
			.map(({ id }) => id)
			.sort(),
	);
	const launches = readdirSync(join(state.agentDir, "peer-records"))
		.filter((name) => name.endsWith(".launch.json"))
		.map((name) => readFileSync(join(state.agentDir, "peer-records", name), "utf8"));
	expect(launches.some((text) => text.includes(workers[3]!.file))).toBe(false);
	noResources();
}, 30000);

test("cancellation disposes fork processes without altering their workers", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { authority: true, hold: "inspection" } }),
	);
	const id = await enqueue(workers.slice(0, 2).map(({ id }) => id));
	await vi.waitFor(
		() =>
			expect(
				query(
					state.dbPath,
					"select id from review_attempts where review_id = ? and kind != 'planner' and state = 'running'",
					id,
				),
			).toHaveLength(3),
		{ timeout: 15000 },
	);
	const receipt = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "cancel", review: id } },
		{ socketPath: state.socketPath },
	);
	expect(receipt.stage, receipt.reason).toBe("applied");
	await settled(id, "cancelled");
	expect(
		attempts(id)
			.rows.filter((entry) => entry.reviewer.kind === "worker")
			.every((entry) => entry.state === "cancelled"),
	).toBe(true);
	noResources();
}, 30000);

test("native capture and fresh rerun retain their worker pool", async () => {
	const replies: ReturnType<typeof fauxAssistantMessage>[] = [];
	const run = await fauxSession([codeReview], replies, ["review_code", "manage_review"], {
		cwd: repository,
		sessionManager: SessionManager.inMemory(repository, { id: "owner" }),
	});
	const call = async (name: string, args: Parameters<typeof fauxToolCall>[1]) => {
		replies.push(
			fauxAssistantMessage([{ ...fauxToolCall(name, args), id: crypto.randomUUID() }], { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		);
		await run.session.prompt("Use the requested tool.");
		const response = run.session.messages.findLast((message) => message.role === "toolResult");
		expect(response, JSON.stringify(response)).toMatchObject({ role: "toolResult", toolName: name, isError: false });
		if (response?.role !== "toolResult") throw new Error("Missing review response");
		const text = response.content.find((entry) => entry.type === "text");
		if (text?.type !== "text") throw new Error("Missing response text");
		return JSON.parse(text.text) as { review: { id: string }; stage: string };
	};
	try {
		const admitted = await call("review_code", {
			target: { kind: "working-tree", base: "HEAD" },
			workers: [workers[0]!.id],
		});
		expect(admitted.stage).toBe("applied");
		await settled(admitted.review.id, "completed");
		const rerun = await call("manage_review", { review: admitted.review.id, action: "rerun" });
		expect(rerun.stage).toBe("applied");
		await settled(rerun.review.id, "completed");
		expect(attempts(rerun.review.id).rows.filter((entry) => entry.reviewer.kind === "worker")).toHaveLength(1);
		expect(
			query<{ request: string }>(state.dbPath, "select request from review_jobs where id = ?", rerun.review.id).map(
				(row) => JSON.parse(row.request).workers,
			),
		).toEqual([[workers[0]!.id]]);
		noResources();
	} finally {
		await run.session.abort();
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	}
}, 40000);

test("a failed fork retries the same worker and cleans both attempts", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { authority: true }, failFork: true }),
	);
	const id = await enqueue([workers[0]!.id]);
	await settled(id, "incomplete");
	const failed = attempts(id).rows.filter((entry) => entry.reviewer.kind === "worker");
	expect(failed).toHaveLength(2);
	for (const attempt of failed)
		expect(attempt).toMatchObject({
			pass: "value-correctness",
			reviewer: { kind: "worker", person: workers[0]!.id },
			state: "failed",
		});
	noResources();
}, 30000);
