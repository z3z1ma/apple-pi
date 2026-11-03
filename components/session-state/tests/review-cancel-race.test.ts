import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { captureReview } from "../../code-review/src/capture.js";
import { sendCommand } from "../src/client.js";
import { readReview } from "../src/review-read.js";
import { tempStateDir } from "./helpers.js";

test("an older cancellation cannot cancel newly authorized review work", async () => {
	const state = tempStateDir();
	const cleanupWaits: number[] = [];
	let child: ChildProcess | undefined;
	let exited: Promise<void> | undefined;
	let db: DatabaseSync | undefined;
	try {
		const repository = join(state.agentDir, "checkout");
		mkdirSync(repository);
		const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
		git("init", "-q");
		writeFileSync(join(repository, "value.ts"), "export const value = 1;\n");
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
		writeFileSync(join(repository, "value.ts"), "export const value = 2;\n");
		const request = { cwd: repository, target: { kind: "working-tree" as const, base: "HEAD" } };
		const artifactDirectory = join(state.agentDir, "captured");
		const artifact = await captureReview(request, artifactDirectory);
		child = fork(new URL("./fixtures/review-cancel-runtime.ts", import.meta.url), [], {
			execArgv: ["--import", new URL("../src/register.mjs", import.meta.url).href],
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		exited = new Promise((resolve) => child!.once("exit", () => resolve()));
		let ready = false;
		let errors = "";
		child.stderr?.on("data", (chunk) => {
			errors += String(chunk);
		});
		child.on("message", (message: { type: string; index?: number }) => {
			if (message.type === "ready") ready = true;
			if (message.type === "waiting") cleanupWaits.push(message.index!);
		});
		await vi.waitFor(() => expect(ready, errors).toBe(true), { timeout: 5000 });
		db = new DatabaseSync(state.dbPath);
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('owner', 'root', ?, 'idle', 0, 'runtime', 1)",
		).run(repository);
		db.prepare(
			`insert into review_jobs (id, command_id, requester, owner, organization, state, generation, request, artifact_directory, artifact, created_at, updated_at)
			 values ('review', 'capture', 'owner', 'owner', 'owner', 'incomplete', 1, ?, ?, ?, 1, 1)`,
		).run(JSON.stringify(request), artifactDirectory, JSON.stringify(artifact));
		db.prepare("insert into program_scopes (id, caller) values ('previous-reviewer', 'owner')").run();
		db.prepare(
			`insert into review_attempts (id, review_id, generation, plan_revision, pass_id, kind, program_id, person, role, policy, input, input_key, state, created_at)
			 values ('attempt', 'review', 1, 0, 'planner', 'planner', 'previous-reviewer', 'reviewer', 'code-review-specialist', '{}', '{}', 'input', 'interrupted', 1)`,
		).run();
		const cancel = (commandId: string) =>
			sendCommand(
				"owner",
				{ kind: "review", version: 1, operation: { action: "cancel", review: "review" } },
				{ socketPath: state.socketPath, commandId },
			);
		const first = cancel("first-cancel");
		await vi.waitFor(() => expect(cleanupWaits).toHaveLength(1));
		const second = cancel("second-cancel");
		await vi.waitFor(() => expect(cleanupWaits).toHaveLength(2));
		db.prepare("delete from program_scopes where id = 'previous-reviewer'").run();
		child.send({ type: "release", index: cleanupWaits[0] });
		expect(await first).toMatchObject({ stage: "applied" });
		const cancelled = readReview(db, "owner", "review");
		expect(cancelled.state).toBe("cancelled");
		const extension = await sendCommand(
			"owner",
			{
				kind: "review",
				version: 1,
				operation: {
					action: "extend",
					review: "review",
					revision: cancelled.revision,
					digest: artifact.digest,
					question: "Does the new value preserve the exported API?",
					reason: "The previous review did not answer this question.",
					doneWhen: "Inspect the captured export and report its compatibility.",
				},
			},
			{ socketPath: state.socketPath, commandId: "extend" },
		);
		expect(extension).toMatchObject({ stage: "applied" });
		const assessment = () => readReview(db!, "owner", "review");
		const authorized = assessment();
		expect(authorized).toMatchObject({
			state: "queued",
			additionalWork: [{ id: "extend", question: "Does the new value preserve the exported API?" }],
		});
		child.send({ type: "release", index: cleanupWaits[1] });
		expect(await second).toMatchObject({ stage: "applied" });
		expect(errors).toBe("");
		expect(assessment()).toEqual(authorized);
	} finally {
		if (child?.connected) child.send({ type: "stop" });
		await exited;
		db?.close();
		vi.unstubAllEnvs();
		rmSync(state.agentDir, { recursive: true, force: true });
	}
}, 15000);
