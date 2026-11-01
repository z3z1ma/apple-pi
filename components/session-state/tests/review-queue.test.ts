import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import codeReview from "../../../extensions/code-review.js";
import { createEventBus } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { fakeCustom, fakeTui } from "../../../tests/helpers/fake-tui.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import {
	buildCapturedReview,
	capturedSubmission,
	submitCapturedReview,
} from "../../browser-pages/src/captured-review.js";
import { captureReview } from "../../code-review/src/capture.js";
import type { FindingResponse } from "../../code-review/src/decisions.js";
import type { ReviewTarget } from "../../code-review/src/types.js";
import { loadRoles } from "../../organization/src/roles.js";
import { sendCommand } from "../src/client.js";
import {
	readReview,
	readReviewFreshness,
	readReviewSource,
	reviewAssessment,
	reviewQueue,
	reviewSummary,
} from "../src/review-read.js";
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

test("admission refuses changed preview content before starting any reviewer", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const request = { cwd: repository, target: { kind: "working-tree" as const, base: "HEAD" } };
	const preview = await captureReview(request, join(state.agentDir, "preview"));
	writeFileSync(join(repository, "value.ts"), "export const value = 7;\n");
	const command = {
		kind: "review" as const,
		version: 1 as const,
		operation: { action: "enqueue" as const, request, expectedDigest: preview.digest },
	};
	const receipt = await sendCommand("owner", command, { socketPath: state.socketPath });
	expect(receipt).toMatchObject({ stage: "failed", reason: expect.stringContaining("Target changed after preview") });
	expect(query(state.dbPath, "select id from review_attempts")).toEqual([]);
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	const refreshed = await captureReview(request, join(state.agentDir, "refreshed"));
	const commandId = randomUUID();
	const admitted = await sendCommand(
		"owner",
		{
			...command,
			operation: { ...command.operation, expectedDigest: refreshed.digest },
		},
		{ socketPath: state.socketPath, commandId },
	);
	expect(admitted.stage, admitted.reason).toBe("applied");
	const job = query<{ id: string; digest: string }>(
		state.dbPath,
		"select j.id, json_extract(j.artifact, '$.digest') as digest from review_jobs j join commands c on j.id = json_extract(c.result, '$.review') where c.command_id = ?",
		commandId,
	)[0]!;
	expect(job.digest).toBe(refreshed.digest);
	await settled(job.id, "completed");
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

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

test("browser approval binds displayed captured bytes and revision, not live edits or tampered submissions", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const job = await enqueue();
	await settled(job.id, "completed");
	writeFileSync(join(repository, "value.ts"), "export const value = 999;\n");
	const { page } = await buildCapturedReview(
		{
			review: job.id,
			title: "Captured value",
			intent: "Inspect the retained value.",
			chapters: [
				{
					title: "Value",
					kind: "core",
					attention: "high",
					brief: "Check consumers.",
					changes: [{ file: "value.ts", summary: "Change the value." }],
				},
			],
		},
		"owner",
		"captured-browser-test",
	);
	expect(page.capture).toMatchObject({
		review: job.id,
		freshness: { requestedTarget: "not checked", checkout: "not checked", checkedAt: null },
	});
	const shown = Object.values(page.hunks)
		.flatMap((hunk) => hunk.lines.map((line) => line.s.map((segment) => segment.t).join("")))
		.join("\n");
	expect(shown).toContain("export const value = 2;");
	expect(shown).not.toContain("999");
	const binding = page.capture!;
	const body = {
		verdict: "approve",
		comments: [
			{
				hunk: Object.keys(page.hunks)[0]!,
				start: 0,
				end: 0,
				kind: "concern",
				text: "Keep the operator's line feedback with the signed assessment.",
			},
		],
		decisions: [],
		seen: [],
		capture: {
			review: binding.review,
			digest: binding.digest,
			revision: binding.revision,
			planRevision: binding.planRevision,
			acceptLimits: true,
		},
	};
	expect(capturedSubmission({ ...body, capture: { ...body.capture, digest: "tampered" } }, page)).toBeUndefined();
	expect(capturedSubmission({ ...body, capture: { ...body.capture, acceptLimits: false } }, page)).toBeUndefined();
	expect(await submitCapturedReview(body, page)).toMatchObject({ verdict: "approve", capture: body.capture });
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(reviewSummary(db, "owner", job.id).approval).toMatchObject({
			matchesAssessment: true,
			record: {
				actor: "operator",
				digest: binding.digest,
				revision: binding.revision,
				data: { note: expect.stringContaining("Keep the operator's line feedback") },
			},
		});
		const finding = await sendCommand(
			"owner",
			{
				kind: "review",
				version: 1,
				operation: {
					action: "extend",
					review: job.id,
					revision: binding.revision,
					digest: binding.digest,
					question: "Check retry",
					reason: "Missing path",
					doneWhen: "Trace retries",
				},
			},
			{ socketPath: state.socketPath },
		);
		expect(finding.stage).toBe("applied");
		await settled(job.id, "completed");
		await expect(
			submitCapturedReview({ ...body, summary: "Another verdict for the stale page" }, page),
		).rejects.toThrow("assessment changed");
		expect(reviewSummary(db, "owner", job.id).approval?.matchesAssessment).toBe(false);
	} finally {
		db.close();
	}
}, 30000);

test("authorized additional work replans the retained target and exact replay does not run it twice", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const job = await enqueue();
	await settled(job.id, "completed");
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		const before = readReview(db, "owner", job.id);
		writeFileSync(join(repository, "value.ts"), "export const value = 999;\n");
		const command = {
			kind: "review" as const,
			version: 1 as const,
			operation: {
				action: "extend" as const,
				review: job.id,
				revision: before.revision,
				digest: before.artifact!.digest,
				question: "Does the value remain safe for callers during retry?",
				reason: "The first plan did not inspect retry behavior.",
				doneWhen: "Trace caller retry and record the observed value.",
			},
		};
		const receipt = await sendCommand("owner", command, {
			socketPath: state.socketPath,
			commandId: "authorize-retry-question",
		});
		expect(receipt.stage, receipt.reason).toBe("applied");
		await settled(job.id, "completed");
		const after = readReview(db, "owner", job.id);
		expect(after.artifact!.digest).toBe(before.artifact!.digest);
		expect(after.planRevision).toBeGreaterThan(before.planRevision);
		expect(after.additionalWork).toEqual([
			expect.objectContaining({ id: "authorize-retry-question", actor: "owner", question: command.operation.question }),
		]);
		expect(reviewAssessment(db, "owner", job.id).passes).toContainEqual(
			expect.objectContaining({
				pass: expect.objectContaining({ id: "authorize-retry-question" }),
				report: expect.objectContaining({
					coverage: [expect.objectContaining({ state: "completed", evidence: ["export const value = 2;"] })],
				}),
			}),
		);
		const attempts = query(state.dbPath, "select id from review_attempts where review_id = ?", job.id);
		expect(
			(await sendCommand("owner", command, { socketPath: state.socketPath, commandId: "authorize-retry-question" }))
				.stage,
		).toBe("applied");
		expect(query(state.dbPath, "select id from review_attempts where review_id = ?", job.id)).toEqual(attempts);
		const stale = await sendCommand("owner", command, { socketPath: state.socketPath });
		expect(stale).toMatchObject({ stage: "failed", reason: expect.stringContaining("assessment changed") });
	} finally {
		db.close();
	}
}, 30000);

test("freshness separates a stable committed target from checkout changes, policy changes and unavailable source", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const job = await enqueue({ kind: "commit", commit: "HEAD" });
	await settled(job.id, "completed");
	expect(await readReviewFreshness("owner", job.id)).toMatchObject({
		requestedTarget: "matches",
		checkout: "changed",
		policy: "matches",
	});
	const rolePath = join(state.agentDir, "roles", "code-review-specialist.md");
	const role = readFileSync(rolePath, "utf8");
	writeFileSync(rolePath, role.replace("fixture/code-review-specialist:high", "fixture/replacement:high"));
	expect(await readReviewFreshness("owner", job.id)).toMatchObject({ requestedTarget: "changed", policy: "changed" });
	writeFileSync(rolePath, role);
	execFileSync("git", ["branch", "-m", "renamed"], { cwd: repository });
	expect(await readReviewFreshness("owner", job.id)).toMatchObject({
		requestedTarget: "matches",
		checkout: "changed",
		policy: "matches",
	});
	execFileSync("git", ["add", "."], { cwd: repository });
	execFileSync(
		"git",
		["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "moved"],
		{ cwd: repository },
	);
	expect(await readReviewFreshness("owner", job.id)).toMatchObject({ requestedTarget: "changed", checkout: "changed" });
	execFileSync("mv", [repository, `${repository}-moved`]);
	expect(await readReviewFreshness("owner", job.id)).toMatchObject({
		requestedTarget: "unavailable",
		checkout: "unavailable",
		errors: [expect.stringContaining("Live source:")],
	});
	await expect(readReviewFreshness("missing-person", job.id)).rejects.toThrow("current person");
}, 30000);

test("the queue reader separates required coverage, absent intent and findings with explicit paging and scope", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const job = await enqueue();
	await settled(job.id, "completed");
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	const outsider = await fakeBridge(state.socketPath, "outsider", parent.pid, parent.startedAt, {
		facts: { manages: true },
	});
	try {
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select id from sessions where id = 'outsider'")).toHaveLength(1),
		);
		expect(reviewQueue(db, "owner")).toEqual({ total: 1, states: { completed: 1 }, page: null });
		const page = reviewQueue(db, "owner", { limit: 1 });
		expect(page.page).toMatchObject({
			offset: 0,
			nextOffset: null,
			rows: [
				{
					id: job.id,
					state: "completed",
					intent: "not-assessed",
					chunks: 1,
					passes: { completed: 2, required: 2 },
					findings: { reported: 0, confirmed: 0, unresolved: 0 },
				},
			],
		});
		const assessment = reviewAssessment(db, "owner", job.id);
		expect(assessment.passes.map((entry) => entry.report?.pass)).toEqual(["value-correctness", "integration"]);
		expect(assessment.validation?.attempt.state).toBe("completed");
		expect(reviewQueue(db, "outsider", { limit: 1 }).total).toBe(0);
		expect(() => readReview(db, "outsider", job.id)).toThrow("another organization");
		expect(() => reviewQueue(db, "missing-person")).toThrow();
		expect(() => reviewQueue(db, "owner", { offset: 1 })).toThrow("limit");
		expect(query(state.dbPath, "select id from work_tasks")).toEqual([]);
		const moved = await sendCommand("operator", {
			kind: "organization_move",
			person: "owner",
			manager: "outsider",
			branch: ["owner"],
		});
		expect(moved.stage, moved.reason).toBe("applied");
		expect(reviewQueue(db, "outsider", { limit: 1 }).total).toBe(1);
		expect(readReview(db, "outsider", job.id).id).toBe(job.id);
	} finally {
		db.close();
		outsider.socket.destroy();
	}
}, 30000);

test("a challenged question is not completed coverage and resume obtains a new inspection", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { passId: "constructor", finding: true, challenged: true } }),
	);
	const job = await enqueue();
	await settled(job.id, "incomplete");
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		const before = reviewAssessment(db, "owner", job.id);
		expect(before.findings).toMatchObject([
			{
				id: `${before.passes[0]!.attempt!.id}:mismatch`,
				pass: "constructor",
				validation: { disposition: "confirmed" },
			},
		]);
		expect(reviewQueue(db, "owner", { limit: 1 }).page!.rows[0]).toMatchObject({
			state: "incomplete",
			passes: { completed: 1, required: 2 },
			coverage: { completedQuestions: 1, requiredQuestions: 2, unassignedRegions: 0, additionalRequests: 0 },
			findings: { reported: 1, confirmed: 1, unresolved: 0 },
		});
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: false }));
		expect(
			(await sendCommand("owner", { kind: "review", version: 1, operation: { action: "resume", review: job.id } }))
				.stage,
		).toBe("applied");
		await settled(job.id, "failed");
		writeFileSync(
			join(state.agentDir, "peer-control.json"),
			JSON.stringify({ review: { passId: "constructor", finding: true } }),
		);
		expect(
			(await sendCommand("owner", { kind: "review", version: 1, operation: { action: "resume", review: job.id } }))
				.stage,
		).toBe("applied");
		await settled(job.id, "completed");
		const after = reviewAssessment(db, "owner", job.id);
		expect(after.passes[0]!.attempt!.id).not.toBe(before.passes[0]!.attempt!.id);
		expect(after.passes[1]!.attempt!.id).toBe(before.passes[1]!.attempt!.id);
		expect(after.findings[0]!.id).not.toBe(before.findings[0]!.id);
		expect(reviewQueue(db, "owner", { limit: 1 }).page!.rows[0]).toMatchObject({
			state: "completed",
			coverage: { completedQuestions: 2, requiredQuestions: 2 },
		});
	} finally {
		db.close();
	}
}, 30000);

test("partial allegations stay unvalidated while queue pages follow priority and FIFO", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { finding: true, hold: "validation" } }),
	);
	const active = await enqueue();
	await vi.waitFor(
		() =>
			expect(
				query(
					state.dbPath,
					"select id from review_attempts where review_id = ? and kind = 'validation' and state = 'running'",
					active.id,
				),
			).toHaveLength(1),
		{ timeout: 15000 },
	);
	const first = await enqueue();
	const second = await enqueue();
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(reviewQueue(db, "owner", { limit: 1 }).page!.rows[0]).toMatchObject({
			id: active.id,
			phase: { kind: "validation", state: "running" },
			findings: { reported: 1, confirmed: 0, unresolved: 1 },
		});
		expect(reviewQueue(db, "owner", { state: "queued", limit: 1 }).page).toMatchObject({
			nextOffset: 1,
			rows: [{ id: first.id }],
		});
		expect(reviewQueue(db, "owner", { state: "queued", limit: 1, offset: 1 }).page).toMatchObject({
			nextOffset: null,
			rows: [{ id: second.id }],
		});
		expect(readReview(db, "owner", first.id).artifact!.digest).toBe(
			readReview(db, "owner", second.id).artifact!.digest,
		);
		expect(
			(
				await sendCommand("owner", {
					kind: "review",
					version: 1,
					operation: { action: "priority", review: second.id, priority: 1 },
				})
			).stage,
		).toBe("applied");
		expect(reviewQueue(db, "owner", { state: "queued", limit: 1 }).page!.rows[0]!.id).toBe(second.id);
		for (const job of [first, second, active])
			expect(
				(await sendCommand("owner", { kind: "review", version: 1, operation: { action: "cancel", review: job.id } }))
					.stage,
			).toBe("applied");
		expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
		expect(reviewQueue(db, "owner").states).toEqual({ cancelled: 3 });
	} finally {
		db.close();
	}
}, 30000);

async function nativeReviewTools() {
	const replies: ReturnType<typeof fauxAssistantMessage>[] = [];
	const run = await fauxSession(
		[codeReview],
		replies,
		["review_code", "review_queue", "read_review", "manage_review", "resolve_finding"],
		{ cwd: repository, sessionManager: SessionManager.inMemory(repository, { id: "owner" }) },
	);
	async function callTool(name: string, args: Parameters<typeof fauxToolCall>[1]): Promise<Record<string, unknown>> {
		replies.push(
			fauxAssistantMessage([{ ...fauxToolCall(name, args), id: randomUUID() }], { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		);
		await run.session.prompt("Use the requested review tool.");
		const response = run.session.messages.findLast((message) => message.role === "toolResult");
		expect(response).toMatchObject({ role: "toolResult", toolName: name, isError: false });
		if (response?.role !== "toolResult") throw new Error("No native review result");
		const text = response.content.find((entry) => entry.type === "text");
		if (text?.type !== "text") throw new Error("No serialized review result");
		return JSON.parse(text.text);
	}
	return { run, callTool };
}

test("native tools admit, read, cancel, recover exact requests and explicitly capture a fresh rerun", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { finding: true, hold: "validation" } }),
	);
	const { run, callTool } = await nativeReviewTools();
	try {
		const request = {
			target: { kind: "working-tree", base: "HEAD" },
			intent: { text: "Export the value two." },
		};
		const admission = await callTool("review_code", request);
		const handle = admission.request as string;
		expect(handle).toBeTypeOf("string");
		expect(admission).toMatchObject({
			stage: "applied",
			review: { owner: "owner", intent: "captured" },
		});
		const id = (admission.review as { id: string }).id;
		await expect(readReviewSource("missing-person", id)).rejects.toThrow("current person");
		await expect(readReviewSource("owner", id, { offset: 1 })).rejects.toThrow("requires a limit");
		await vi.waitFor(
			() =>
				expect(
					query(
						state.dbPath,
						"select id from review_attempts where review_id = ? and kind = 'validation' and state = 'running'",
						id,
					),
				).toHaveLength(1),
			{ timeout: 15000 },
		);
		expect(await callTool("review_queue", {})).toMatchObject({ total: 1, states: { running: 1 }, page: null });
		expect(await callTool("read_review", { review: id, part: "findings" })).toEqual({ total: 1, page: null });
		expect(await callTool("read_review", { review: id, part: "findings", limit: 1 })).toMatchObject({
			page: { rows: [{ finding: { title: "The value disagrees with its consumer" }, validation: null }] },
		});
		expect(await callTool("read_review", { review: handle, part: "freshness" })).toMatchObject({
			requestedTarget: "matches",
			checkout: "matches",
			policy: "matches",
		});
		const target = await callTool("read_review", { review: handle, part: "target" });
		expect(target).toMatchObject({
			review: id,
			target: { intent: { text: "Export the value two." }, configuration: { hash: expect.any(String) } },
		});
		expect(await callTool("read_review", { review: id, part: "configuration" })).toMatchObject({
			configuration: {
				instructions: { planning: expect.stringContaining("behavior or contract") },
				roleReferences: expect.arrayContaining([
					{ role: "code-review-specialist", models: ["fixture/code-review-specialist:high"] },
				]),
			},
		});
		expect(readFileSync(join((target.target as { source: string }).source, "value.ts"), "utf8")).toBe(
			"export const value = 2;\n",
		);
		expect(await callTool("manage_review", { review: id, action: "cancel" })).toMatchObject({
			stage: "applied",
			review: { id, state: "cancelled" },
		});
		expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
		expect(await callTool("read_review", { review: handle, part: "source" })).toMatchObject({
			review: id,
			kind: "files",
			side: "after",
			total: 1,
			page: null,
		});
		expect(await callTool("read_review", { review: id, part: "source", limit: 1 })).toMatchObject({
			page: { rows: [{ path: "value.ts" }], nextOffset: null },
		});
		expect(await callTool("read_review", { review: id, part: "source", path: "value.ts" })).toMatchObject({
			kind: "file",
			file: { path: "value.ts", content: "text" },
			total: 1,
			page: null,
		});
		expect(
			await callTool("read_review", { review: id, part: "source", path: "value.ts", side: "before", limit: 1 }),
		).toMatchObject({
			page: { offset: 0, rows: ["export const value = 1;"], nextOffset: null },
		});
		const current = await callTool("read_review", { review: id });
		const allegations = await callTool("read_review", { review: id, part: "findings", limit: 1 });
		const allegation = (allegations.page as { rows: { id: string }[] }).rows[0]!.id;
		expect(
			await callTool("resolve_finding", {
				review: id,
				revision: current.revision as number,
				digest: current.digest as string,
				finding: allegation,
				response: { disposition: "acknowledged", reason: "Retained for investigation", evidence: [] },
			}),
		).toMatchObject({ stage: "applied", review: { state: "cancelled" } });
		expect(await callTool("read_review", { review: id, part: "decisions", limit: 1 })).toMatchObject({
			total: 1,
			page: { rows: [{ kind: "finding", actor: "owner", data: { disposition: "acknowledged" } }] },
		});
		writeFileSync(join(repository, "value.ts"), "export const value = 3;\n");
		expect(await callTool("read_review", { review: id, part: "freshness" })).toMatchObject({
			requestedTarget: "changed",
			checkout: "changed",
		});
		expect(await callTool("read_review", { review: id, part: "source", path: "value.ts", limit: 1 })).toMatchObject({
			page: { rows: ["export const value = 2;"] },
		});
		expect(await callTool("review_code", { ...request, request: handle })).toMatchObject({
			stage: "applied",
			review: { id, state: "cancelled" },
		});
		expect(query(state.dbPath, "select id from review_jobs")).toHaveLength(1);
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
		const rerun = await callTool("manage_review", { review: id, action: "rerun" });
		const next = (rerun.review as { id: string }).id;
		expect(next).not.toBe(id);
		await settled(next, "completed");
		expect(query(state.dbPath, "select parent from review_jobs where id = ?", next)).toEqual([{ parent: id }]);
		expect(await callTool("read_review", { review: next, part: "attempts", limit: 1 })).toMatchObject({
			total: 4,
			page: { nextOffset: 1, rows: [{ kind: "planner", state: "completed", selected: true }] },
		});
		const fresh = await callTool("read_review", { review: next, part: "target" });
		expect(readFileSync(join((fresh.target as { source: string }).source, "value.ts"), "utf8")).toBe(
			"export const value = 3;\n",
		);
	} finally {
		await run.session.abort();
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	}
}, 40000);

test.each(["empty", "scoped"])(
	"native %s comparisons retain a no-change outcome without reviewers or unfinished responsibility",
	async (kind) => {
		if (kind === "scoped") {
			writeFileSync(join(repository, "unchanged.ts"), "export const stable = true;\n");
			execFileSync("git", ["add", "unchanged.ts"], { cwd: repository });
			execFileSync(
				"git",
				["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "stable context"],
				{ cwd: repository },
			);
		}
		const managerProcess = standInProcess();
		const manager = await fakeBridge(state.socketPath, "manager", managerProcess.pid, managerProcess.startedAt, {
			session: { cwd: repository },
		});
		owner.send({ type: "facts", facts: { reportsTo: "manager" } });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = 'owner'")).toEqual([
				{ reports_to: "manager" },
			]),
		);
		const { run, callTool } = await nativeReviewTools();
		try {
			const request: Parameters<typeof fauxToolCall>[1] =
				kind === "empty"
					? { target: { kind: "range", base: "HEAD", head: "HEAD" } }
					: { target: { kind: "working-tree", base: "HEAD" }, paths: ["unchanged.ts"] };
			const result = await callTool("review_code", request);
			expect(result).toMatchObject({
				stage: "applied",
				review: {
					state: "no-changes",
					passes: null,
					reason: expect.stringContaining("no reviewers ran"),
					cost: { reportedDollars: 0, reportedAttempts: 0, totalAttempts: 0 },
				},
			});
			const id = (result.review as { id: string }).id;
			expect(await callTool("review_queue", { state: "no-changes" })).toMatchObject({
				total: 1,
				states: { "no-changes": 1 },
			});
			expect(await callTool("read_review", { review: id, part: "attempts" })).toEqual({ total: 0, page: null });
			expect(await callTool("manage_review", { review: id, action: "cancel" })).toMatchObject({
				review: { id, state: "no-changes" },
			});
			expect(await callTool("review_code", { ...request, request: result.request as string })).toMatchObject({
				review: { id, state: "no-changes" },
			});
			expect(query(state.dbPath, "select id from review_attempts")).toEqual([]);
			expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
			expect(query(state.dbPath, "select command_id from commands where kind = 'run_turn'")).toEqual([]);
			const move = await sendCommand(
				"operator",
				{ kind: "organization_move", person: "owner", manager: null, branch: ["owner"] },
				{ socketPath: state.socketPath },
			);
			expect(move.stage, move.reason).toBe("applied");
			await restart();
			expect(query(state.dbPath, "select state from review_jobs where id = ?", id)).toEqual([{ state: "no-changes" }]);
			expect(query(state.dbPath, "select id from review_attempts")).toEqual([]);
			parent.child.kill();
			await vi.waitFor(() => expect(parent.child.signalCode).toBe("SIGTERM"));
			const departure = await sendCommand(
				"owner",
				{
					kind: "retire",
					by: "operator",
					reason: "The empty comparison created no review responsibility",
					handoff: false,
				},
				{ socketPath: state.socketPath },
			);
			expect(departure.stage, departure.reason).toBe("applied");
			expect(query(state.dbPath, "select id from sessions where id = 'owner'")).toEqual([]);
		} finally {
			manager.socket.destroy();
			managerProcess.child.kill();
			await run.session.abort();
			await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			run.dispose();
		}
	},
	20000,
);

test("finding responses retain allegations and approval binds a stable artifact and assessment", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { finding: true, rejectFinding: true } }),
	);
	const job = await enqueue();
	await settled(job.id, "completed");
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		const assessment = reviewAssessment(db, "owner", job.id);
		const finding = assessment.findings[0]!.id;
		const digest = assessment.job.artifact!.digest;
		const decision = (response: FindingResponse, revision = readReview(db, "owner", job.id).revision) =>
			sendCommand("owner", {
				kind: "review",
				version: 1,
				operation: { action: "finding", review: job.id, digest, revision, finding, response },
			});
		expect((await decision({ disposition: "rejected", reason: "Unsupported rejection", evidence: [] })).stage).toBe(
			"failed",
		);
		expect(
			(await decision({ disposition: "accepted-risk", reason: "Accept", evidence: ["Known consequence"] })).stage,
		).toBe("failed");
		expect(reviewAssessment(db, "owner", job.id).decisions).toEqual([]);
		expect(
			(await decision({ disposition: "fixed-claimed", reason: "A fix is claimed but not verified", evidence: [] }))
				.stage,
		).toBe("applied");
		expect(
			(
				await decision(
					{ disposition: "rejected", reason: "Stale response", evidence: ["Old observation"] },
					assessment.job.revision,
				)
			).stage,
		).toBe("failed");
		expect(reviewAssessment(db, "owner", job.id).findings[0]).toMatchObject({
			finding: assessment.findings[0]!.finding,
			validation: { disposition: "rejected" },
			decision: { data: { disposition: "fixed-claimed", verifiedAgainst: null } },
		});
		expect(
			(
				await decision({
					disposition: "fixed",
					reason: "Same target is not a new verification",
					evidence: ["Existing report"],
					verification: { review: job.id, pass: "value-correctness", question: "value" },
				})
			).stage,
		).toBe("failed");
		writeFileSync(join(repository, "value.ts"), "export const value = 3;\n");
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
		const next = await enqueue();
		await settled(next.id, "completed");
		expect(
			(
				await decision({
					disposition: "fixed",
					reason: "Scripted verification decision on the new target",
					evidence: ["Selected question evidence below; this fixture is not a real defect"],
					verification: { review: next.id, pass: "value-correctness", question: "value" },
				})
			).stage,
		).toBe("applied");
		const response = reviewAssessment(db, "owner", job.id).findings[0]!.decision!;
		expect(response.data).toMatchObject({
			disposition: "fixed",
			verifiedAgainst: {
				review: next.id,
				digest: readReview(db, "owner", next.id).artifact!.digest,
				attempt: reviewAssessment(db, "owner", next.id).passes[0]!.attempt!.id,
			},
		});
		const revision = readReview(db, "owner", job.id).revision;
		const approval = {
			action: "approve" as const,
			review: job.id,
			digest,
			revision,
			verdict: "approved" as const,
			note: "The operator accepts the displayed limits",
			acceptLimits: false,
		};
		expect(
			(await sendCommand("owner", { kind: "review", version: 1, operation: { ...approval, acceptLimits: true } }))
				.stage,
		).toBe("failed");
		expect((await sendCommand("operator", { kind: "review", version: 1, operation: approval })).stage).toBe("failed");
		expect(
			(await sendCommand("operator", { kind: "review", version: 1, operation: { ...approval, acceptLimits: true } }))
				.stage,
		).toBe("applied");
		expect(reviewSummary(db, "owner", job.id).approval).toMatchObject({
			matchesAssessment: true,
			record: {
				digest,
				revision,
				actor: "operator",
				data: { verdict: "approved", limits: expect.arrayContaining([expect.stringContaining("later fix")]) },
			},
		});
		expect(
			(
				await decision({
					disposition: "rejected",
					reason: "Explicit counterevidence changes the assessment",
					evidence: ["The alleged consumer is not present in this fixture"],
				})
			).stage,
		).toBe("applied");
		expect(reviewSummary(db, "owner", job.id).approval).toMatchObject({
			matchesAssessment: false,
			record: { revision },
		});
		expect(
			(await sendCommand("operator", { kind: "review", version: 1, operation: { ...approval, acceptLimits: true } }))
				.stage,
		).toBe("failed");
		const history = reviewAssessment(db, "owner", job.id).decisions;
		expect(history).toHaveLength(4);
		expect(history.map((entry) => entry.kind)).toEqual(["finding", "finding", "approval", "finding"]);
		writeFileSync(join(assessment.job.artifact!.source, "value.ts"), "export const value = 99;\n");
		expect(
			(
				await sendCommand("operator", {
					kind: "review",
					version: 1,
					operation: { ...approval, revision: readReview(db, "owner", job.id).revision, acceptLimits: true },
				})
			).stage,
		).toBe("failed");
		expect(reviewAssessment(db, "owner", job.id).decisions).toHaveLength(4);
	} finally {
		db.close();
	}
}, 30000);

test("the loaded reviews command shows the queue, keeps selection and sends a confirmed fresh rerun", async () => {
	const pointers = Array.from({ length: 40 }, (_, index) => `pointer-${String(index).padStart(2, "0")}.dat`);
	for (const path of pointers)
		writeFileSync(
			join(repository, path),
			`version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 1234\n`,
		);
	execFileSync("git", ["add", "--", ...pointers], { cwd: repository, stdio: "pipe" });
	execFileSync(
		"git",
		["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "pointer context"],
		{ cwd: repository, stdio: "pipe" },
	);
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { finding: true } }));
	const first = await enqueue();
	await settled(first.id, "completed");
	writeFileSync(join(repository, "value.ts"), "export const value = 3;\n");
	const second = await enqueue();
	await settled(second.id, "completed");
	const loaded = await loadExtensions(
		[resolve("extensions/code-review.ts")],
		repository,
		createEventBus(),
		createExtensionRuntime(),
	);
	expect(loaded.errors).toEqual([]);
	const extension = loaded.extensions[0]!;
	const command = [...extension.commands.values()].find((entry) => entry.name === "reviews")!;
	const screen = fakeTui(100, 15);
	const ctx = {
		cwd: repository,
		hasUI: true,
		mode: "tui",
		sessionManager: SessionManager.inMemory(repository, { id: "owner" }),
		ui: {
			custom: fakeCustom(screen).custom,
			select: vi.fn(async () => "Capture a fresh rerun"),
			input: vi.fn(async () => "value.ts"),
		},
	} as unknown as ExtensionCommandContext;
	try {
		await command.handler("", ctx);
		expect(screen.stack).toHaveLength(1);
		const panel = screen.stack[0]!.component;
		expect(screen.focused()).toBe(panel);
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain("Reviews (2)");
		panel.handleInput("\x1b");
		expect(screen.focused()).toBe(screen.editor);
		await extension.shortcuts.get("alt+g")!.handler(ctx);
		expect(screen.focused()).toBe(panel);
		panel.handleInput("\x1b[B");
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(first.id.slice(-8));
		for (const title of [
			"Target",
			"Source",
			"Plan",
			"Findings",
			"Coverage",
			"Attempts",
			"Decisions",
			"Configuration",
			"Freshness",
			"Summary",
		]) {
			panel.handleInput("\t");
			const rendered = screen.layout(screen.stack[0]!).lines.join("\n");
			expect(rendered).toContain(`${title} ${first.id.slice(-8)} |`);
			expect(rendered).toContain("> Reviews");
			expect(screen.focused()).toBe(panel);
		}
		expect(ctx.ui.select).not.toHaveBeenCalled();
		panel.handleInput("\x1b[Z");
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(`Freshness ${first.id.slice(-8)} |`);
		panel.handleInput("\t");
		for (const title of ["Target", "Source", "Plan", "Findings"]) {
			panel.handleInput("\t");
			expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(`${title} ${first.id.slice(-8)} |`);
		}
		panel.handleInput("\r");
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(`> Findings ${first.id.slice(-8)} |`);
		panel.handleInput("\x1b[6~");
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain("The value disagrees with its consumer");
		screen.tui.terminal.columns = 160;
		screen.tui.terminal.rows = 40;
		vi.mocked(ctx.ui.select).mockResolvedValueOnce("Choose captured source").mockResolvedValueOnce("before");
		panel.handleInput("a");
		await vi.waitFor(
			() => {
				const rendered = screen.layout(screen.stack[0]!).lines.join("\n");
				expect(rendered).toContain('before: "value.ts"');
				expect(rendered).toContain("Source lines: 1-1 / 1");
				expect(rendered).toContain("1 | export const value = 1;");
			},
			{ timeout: 5000 },
		);
		expect(readFileSync(join(repository, "value.ts"), "utf8")).toBe("export const value = 3;\n");
		vi.mocked(ctx.ui.select).mockResolvedValueOnce("Choose captured source").mockResolvedValueOnce("after");
		vi.mocked(ctx.ui.input).mockResolvedValueOnce("");
		panel.handleInput("a");
		await vi.waitFor(
			() => {
				const rendered = screen.layout(screen.stack[0]!).lines.join("\n");
				expect(rendered).toContain("after: 41 captured files.");
				expect(rendered).toContain('"pointer-00.dat"');
			},
			{ timeout: 5000 },
		);
		panel.handleInput("]");
		await vi.waitFor(() => expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain('"value.ts"'), {
			timeout: 5000,
		});
		panel.handleInput("\x1b[Z");
		await vi.waitFor(() => expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain("Target"));
		panel.handleInput("]");
		let limits = "";
		for (const _path of pointers) {
			panel.handleInput("\x1b[6~");
			limits = screen.layout(screen.stack[0]!).lines.join("\n");
			if (limits.includes(pointers.at(-1)!)) break;
		}
		expect(limits).toContain(pointers.at(-1)!);
		screen.tui.terminal.columns = 100;
		screen.tui.terminal.rows = 15;
		panel.handleInput("a");
		const preview = await captureConfirmation(screen);
		expect(preview.text.replace(/\s+/g, " ")).toContain("coverage and approval are not inherited");
		expect(screen.stack[0]!.handle.isHidden()).toBe(true);
		await extension.shortcuts.get("alt+g")!.handler(ctx);
		expect(screen.focused()).toBe(preview.component);
		preview.component.handleInput("y");
		await vi.waitFor(
			() => expect(query(state.dbPath, "select id from review_jobs where parent = ?", first.id)).toHaveLength(1),
			{ timeout: 10000 },
		);
		const rerun = query<{ id: string }>(state.dbPath, "select id from review_jobs where parent = ?", first.id)[0]!;
		await settled(rerun.id, "completed");
		const admitted = query<{ digest: string }>(
			state.dbPath,
			"select json_extract(artifact, '$.digest') as digest from review_jobs where id = ?",
			rerun.id,
		)[0]!;
		expect(preview.text).toContain(admitted.digest);
		panel.handleInput("q");
		expect(screen.stack).toHaveLength(0);
		await command.handler("", ctx);
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(first.id.slice(-8));
		expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
		screen.stack[0]!.component.handleInput("a");
		await captureConfirmation(screen);
		const neighbor = { render: () => ["Another dialog"], invalidate: () => {} };
		const neighborHandle = screen.tui.showOverlay(neighbor, {});
		for (const handler of extension.handlers.get("session_before_tree") ?? [])
			await handler({ type: "session_before_tree" }, ctx);
		await vi.waitFor(() => expect(screen.stack.map((entry) => entry.component)).toEqual([neighbor]));
		neighborHandle.hide();
		expect(screen.stack).toHaveLength(0);
		await command.handler("", ctx);
		expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(rerun.id.slice(-8));
	} finally {
		for (const handler of extension.handlers.get("session_shutdown") ?? [])
			await handler({ type: "session_shutdown" }, ctx);
	}
	expect(screen.stack).toHaveLength(0);
}, 30000);

test("new capture previews the chosen directory and cancellation or changed source starts no reviewer", async () => {
	const loaded = await loadExtensions(
		[resolve("extensions/code-review.ts")],
		repository,
		createEventBus(),
		createExtensionRuntime(),
	);
	expect(loaded.errors).toEqual([]);
	const extension = loaded.extensions[0]!;
	const command = extension.commands.get("reviews")!;
	const screen = fakeTui(90, 24);
	const ctx = {
		cwd: state.agentDir,
		hasUI: true,
		mode: "tui",
		sessionManager: SessionManager.inMemory(state.agentDir, { id: "owner" }),
		ui: {
			custom: fakeCustom(screen).custom,
			select: async (title: string) => (title === "Review actions" ? "Capture a review" : "working-tree"),
			input: async (title: string) => (title === "Repository or worktree directory" ? "checkout" : ""),
		},
	} as unknown as ExtensionCommandContext;
	try {
		await command.handler("", ctx);
		screen.stack[0]!.component.handleInput("a");
		const cancelled = await captureConfirmation(screen);
		expect(cancelled.text).toContain(repository);
		expect(cancelled.text).toContain("intent compliance stays unassessed");
		cancelled.component.handleInput("\x1b");
		await vi.waitFor(() => expect(screen.stack).toHaveLength(1));
		await vi.waitFor(() =>
			expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain(
				"Capture cancelled; this request was not queued.",
			),
		);
		expect(query(state.dbPath, "select id from review_jobs")).toEqual([]);
		screen.stack[0]!.component.handleInput("a");
		const preview = await captureConfirmation(screen);
		writeFileSync(join(repository, "value.ts"), "export const value = 9;\n");
		preview.component.handleInput("y");
		await vi.waitFor(
			() =>
				expect(
					query(state.dbPath, "select state, artifact, json_extract(request, '$.cwd') as cwd from review_jobs"),
				).toEqual([{ state: "failed", artifact: null, cwd: repository }]),
			{ timeout: 10000 },
		);
		expect(query(state.dbPath, "select id from review_attempts")).toEqual([]);
		expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
		await vi.waitFor(() => expect(screen.focused()).toBe(screen.stack[0]!.component));
		writeFileSync(join(repository, "value.ts"), "export const value = 1;\n");
		screen.stack[0]!.component.handleInput("a");
		await vi.waitFor(() => expect(screen.layout(screen.stack[0]!).lines.join("\n")).toContain("No changed paths"), {
			timeout: 10000,
		});
		expect(query(state.dbPath, "select id from review_jobs")).toHaveLength(1);
		expect(query(state.dbPath, "select id from review_attempts")).toEqual([]);
	} finally {
		for (const handler of extension.handlers.get("session_shutdown") ?? [])
			await handler({ type: "session_shutdown" }, ctx);
	}
}, 20000);

async function captureConfirmation(screen: ReturnType<typeof fakeTui>) {
	await vi.waitFor(() => expect(screen.stack).toHaveLength(2), { timeout: 10000 });
	const entry = screen.stack[1]!;
	const pages: string[] = [];
	for (;;) {
		const page = screen.layout(entry).lines.join("\n");
		if (pages.at(-1) === page) break;
		pages.push(page);
		entry.component.handleInput("\x1b[6~");
	}
	return { component: entry.component, text: pages.join("\n") };
}

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
		"select pass_id, person, input from review_attempts where review_id = ? and kind = 'focused' order by pass_id desc",
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

test.each(["role", "profile", "selection", "catalog"])(
	"resume replans under changed %s policy instead of reusing the earlier assessment",
	async (change) => {
		const rolePath = join(state.agentDir, "roles", "code-review-specialist.md");
		writeFileSync(
			rolePath,
			readFileSync(rolePath, "utf8").replace('models: ["fixture/', 'models: ["balanced", "fixture/'),
		);
		const profilePath = join(state.agentDir, "model-profiles.json");
		const profile = { selection: "ordered", models: [{ model: "fixture/code-review-specialist", thinking: "high" }] };
		writeFileSync(profilePath, JSON.stringify({ profiles: { balanced: profile } }));
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { challenged: true } }));
		const job = await enqueue();
		await settled(job.id, "incomplete");
		const before = query<{ digest: string; revision: number; selected: string }>(
			state.dbPath,
			"select json_extract(artifact, '$.digest') as digest, plan_revision as revision, selected_attempts as selected from review_jobs where id = ?",
			job.id,
		)[0]!;
		if (change === "role")
			writeFileSync(rolePath, `${readFileSync(rolePath, "utf8")}\nTrace recovery as well as the steady state.\n`);
		else if (change === "catalog")
			writeFileSync(
				join(state.agentDir, "roles", "fixture-advisor.md"),
				readFileSync(rolePath, "utf8").replace("Fixture Reviewer", "Recovery Advisor"),
			);
		else {
			if (change === "selection") profile.selection = "round-robin";
			else profile.models.push({ model: "fixture/another", thinking: "high" });
			writeFileSync(profilePath, JSON.stringify({ profiles: { balanced: profile } }));
		}
		writeFileSync(
			join(state.agentDir, "peer-control.json"),
			JSON.stringify({ review: { passId: "new-policy-question" } }),
		);
		const receipt = await sendCommand(
			"owner",
			{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
			{ socketPath: state.socketPath },
		);
		expect(receipt.stage, receipt.reason).toBe("applied");
		await settled(job.id, "completed");
		const db = new DatabaseSync(state.dbPath, { readOnly: true });
		try {
			const after = readReview(db, "owner", job.id);
			expect(after.artifact?.digest).toBe(before.digest);
			expect(after.planRevision).toBe(before.revision + 1);
			expect(after.selectedAttempts).toHaveProperty("new-policy-question");
			for (const id of Object.values(after.selectedAttempts))
				expect(Object.values(JSON.parse(before.selected))).not.toContain(id);
			expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
			expect(existsSync(join(state.stateDir, "model-profile-selection.sqlite"))).toBe(false);
		} finally {
			db.close();
		}
	},
	40000,
);

test("a profile change during startup prevents dispatch even when the model remains eligible", async () => {
	const rolePath = join(state.agentDir, "roles", "code-review-specialist.md");
	writeFileSync(
		rolePath,
		readFileSync(rolePath, "utf8").replace('models: ["fixture/', 'models: ["balanced", "fixture/'),
	);
	const profilePath = join(state.agentDir, "model-profiles.json");
	const profile = { selection: "ordered", models: [{ model: "fixture/code-review-specialist", thinking: "high" }] };
	writeFileSync(profilePath, JSON.stringify({ profiles: { balanced: profile } }));
	const gate = join(state.agentDir, "release-startup");
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true, helloGate: gate }));
	const job = await enqueue();
	await vi.waitFor(
		() => {
			const attempt = query<{ person: string }>(
				state.dbPath,
				"select person from review_attempts where review_id = ?",
				job.id,
			)[0];
			expect(attempt && existsSync(join(state.agentDir, "peer-records", `${attempt.person}.launch.json`))).toBe(true);
		},
		{ timeout: 10000 },
	);
	profile.selection = "round-robin";
	writeFileSync(profilePath, JSON.stringify({ profiles: { balanced: profile } }));
	writeFileSync(gate, "continue");
	await settled(job.id, "failed");
	expect(query(state.dbPath, "select reason, result from review_attempts where review_id = ?", job.id)).toEqual([
		{ reason: expect.stringContaining("policy changed during startup"), result: null },
	]);
	expect(query(state.dbPath, "select command_id from commands where kind = 'run_turn'")).toEqual([]);
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 20000);

test("a policy change during a real SDK turn retains raw results without accepting current-policy coverage", async () => {
	const fixture = new URL("../../../tests/fixtures/review-sdk-peer.ts", import.meta.url).pathname;
	const register = new URL("../src/register.mjs", import.meta.url).pathname;
	writeFileSync(
		join(state.agentDir, "bin", "pi"),
		`#!/bin/sh\nexec '${process.execPath}' --import '${register}' '${fixture}' "$@"\n`,
		{ mode: 0o700 },
	);
	writeFileSync(
		join(state.agentDir, "roles", "code-review-specialist.md"),
		'---\ntitle: Fixture Reviewer\nmandate: Inspect captured code.\nmodels: ["balanced", "faux-session-provider/faux-session-model:off"]\nwrites: false\nmanages: false\n---\nRead the source and report evidence.\n',
	);
	const profilePath = join(state.agentDir, "model-profiles.json");
	const profile = {
		selection: "ordered",
		models: [{ model: "faux-session-provider/faux-session-model", thinking: "off" }],
	};
	writeFileSync(profilePath, JSON.stringify({ profiles: { balanced: profile } }));
	const gate = join(state.agentDir, "release-inspection");
	writeFileSync(join(state.agentDir, "review-sdk-gate.json"), JSON.stringify({ phase: "inspection", release: gate }));
	const job = await enqueue();
	await vi.waitFor(
		() => {
			const attempt = query<{ person: string }>(
				state.dbPath,
				"select person from review_attempts where review_id = ? and kind = 'focused'",
				job.id,
			)[0];
			expect(attempt && existsSync(join(state.agentDir, "provider-inputs", `${attempt.person}.waiting`))).toBe(true);
		},
		{ timeout: 15000 },
	);
	profile.selection = "round-robin";
	writeFileSync(profilePath, JSON.stringify({ profiles: { balanced: profile } }));
	writeFileSync(gate, "continue");
	await settled(job.id, "failed");
	const attempt = query<{ state: string; reason: string; result: string; output: null }>(
		state.dbPath,
		"select state, reason, result, output from review_attempts where review_id = ? and kind = 'focused'",
		job.id,
	)[0]!;
	expect(attempt).toMatchObject({
		state: "failed",
		reason: expect.stringContaining("policy changed during the turn"),
		output: null,
	});
	expect(JSON.parse(attempt.result)).toMatchObject({ status: "completed", value: { pass: "value-correctness" } });
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

test("a policy change between completed turns cannot enter the planned assessment even when the catalog is restored", async () => {
	const rolePath = join(state.agentDir, "roles", "code-review-specialist.md");
	const original = readFileSync(rolePath, "utf8");
	const gate = join(state.agentDir, "cleanup-gates");
	mkdirSync(gate);
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: true, cleanupGate: gate, cleanupPasses: ["planner", "value-correctness"] }),
	);
	const job = await enqueue();
	const attempt = (pass: string) =>
		query<{ person: string; output: string | null }>(
			state.dbPath,
			"select person, output from review_attempts where review_id = ? and pass_id = ? order by rowid desc limit 1",
			job.id,
			pass,
		)[0];
	const waiting = (pass: string) => {
		const row = attempt(pass);
		return !!row?.output && existsSync(join(gate, `${row.person}.waiting`));
	};
	try {
		await vi.waitFor(() => expect(waiting("planner")).toBe(true), { timeout: 15000 });
		writeFileSync(rolePath, `${original}\nInspect with different policy B.\n`);
		writeFileSync(join(gate, `${attempt("planner")!.person}.release`), "continue");
		await vi.waitFor(
			() =>
				expect(
					waiting("value-correctness") ||
						query<{ state: string }>(state.dbPath, "select state from review_jobs where id = ?", job.id)[0]?.state ===
							"failed",
				).toBe(true),
			{ timeout: 15000 },
		);
		writeFileSync(rolePath, original);
		const focused = attempt("value-correctness");
		if (focused) writeFileSync(join(gate, `${focused.person}.release`), "continue");
		await vi.waitFor(
			() =>
				expect(["failed", "completed"]).toContain(
					query<{ state: string }>(state.dbPath, "select state from review_jobs where id = ?", job.id)[0]?.state,
				),
			{ timeout: 15000 },
		);
		expect(query(state.dbPath, "select state, reason from review_jobs where id = ?", job.id)).toEqual([
			{ state: "failed", reason: expect.stringContaining("planned catalog") },
		]);
		expect(focused).toBeUndefined();
		expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
		const resumed = await sendCommand(
			"owner",
			{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
			{ socketPath: state.socketPath },
		);
		expect(resumed.stage, resumed.reason).toBe("applied");
		await settled(job.id, "completed");
		for (const row of query<{ policy: string }>(
			state.dbPath,
			"select policy from review_attempts where review_id = ?",
			job.id,
		))
			expect(JSON.parse(row.policy).role.text).toBe(original);
		expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	} finally {
		writeFileSync(rolePath, original);
		for (const row of query<{ person: string }>(
			state.dbPath,
			"select person from review_attempts where review_id = ?",
			job.id,
		))
			writeFileSync(join(gate, `${row.person}.release`), "continue");
	}
}, 40000);

test("an all-concrete review completes without consulting an unrelated malformed profile file", async () => {
	for (const role of loadRoles(repository).roles.values()) {
		if (role.writes || role.manages) continue;
		writeFileSync(
			join(state.agentDir, "roles", `${role.name}.md`),
			`---\ntitle: ${role.title}\nmandate: Inspect captured source.\nmodels: ["fixture/${role.name}:high"]\nwrites: false\nmanages: false\n---\nRead source and report evidence.\n`,
		);
	}
	writeFileSync(join(state.agentDir, "model-profiles.json"), "invalid");
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const job = await enqueue();
	await settled(job.id, "completed");
	expect(query(state.dbPath, "select state from review_attempts where review_id = ?", job.id)).toEqual(
		Array.from({ length: 4 }, () => ({ state: "completed" })),
	);
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	expect(existsSync(join(state.agentDir, "state", "model-profile-selection.sqlite"))).toBe(false);
}, 20000);

test("reported cost keeps invalid observations and nonfinite totals unavailable", async () => {
	const job = await enqueue();
	await settled(job.id, "failed");
	const resumed = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(resumed.stage, resumed.reason).toBe("applied");
	await settled(job.id, "failed");
	const live = new DatabaseSync(state.dbPath, { readOnly: true });
	const snapshotPath = join(state.agentDir, "cost-snapshot.db");
	try {
		await backup(live, snapshotPath);
	} finally {
		live.close();
	}
	const db = new DatabaseSync(snapshotPath);
	try {
		const setCost = db.prepare(
			"update review_attempts set result = json_set(result, '$.usage.cost.total', json(?)) where review_id = ?",
		);
		for (const cost of ["null", '"0.3"', "-1", "1e999"]) {
			setCost.run(cost, job.id);
			expect(reviewSummary(db, "owner", job.id).cost).toEqual({
				reportedDollars: null,
				reportedAttempts: 0,
				totalAttempts: 2,
			});
		}
		setCost.run("0", job.id);
		expect(reviewSummary(db, "owner", job.id).cost).toEqual({
			reportedDollars: 0,
			reportedAttempts: 2,
			totalAttempts: 2,
		});
		setCost.run(String(2 ** 53), job.id);
		expect(reviewSummary(db, "owner", job.id).cost).toEqual({
			reportedDollars: 2 ** 54,
			reportedAttempts: 2,
			totalAttempts: 2,
		});
		setCost.run(String(Number.MAX_VALUE), job.id);
		expect(reviewSummary(db, "owner", job.id).cost).toEqual({
			reportedDollars: null,
			reportedAttempts: 2,
			totalAttempts: 2,
		});
	} finally {
		db.close();
	}
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
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(reviewSummary(db, "owner", job.id)).toMatchObject({
			cost: { reportedDollars: 0.3, reportedAttempts: 1, totalAttempts: 1 },
		});
		writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
		const resumed = await sendCommand(
			"owner",
			{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
			{ socketPath: state.socketPath },
		);
		expect(resumed.stage, resumed.reason).toBe("applied");
		await settled(job.id, "completed");
		expect(reviewSummary(db, "owner", job.id)).toMatchObject({
			cost: { reportedDollars: 1.5, reportedAttempts: 5, totalAttempts: 5 },
		});
	} finally {
		db.close();
	}
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
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(reviewSummary(db, "owner", job.id)).toMatchObject({
			cost: { reportedDollars: null, reportedAttempts: 0, totalAttempts: 1 },
		});
	} finally {
		db.close();
	}
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select command_id from commands where kind = 'run_turn'")).toEqual([]);
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	const resumed = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "resume", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(resumed.stage, resumed.reason).toBe("applied");
	await settled(job.id, "completed");
	const completed = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(reviewSummary(completed, "owner", job.id).cost).toEqual({
			reportedDollars: 1.2,
			reportedAttempts: 4,
			totalAttempts: 5,
		});
	} finally {
		completed.close();
	}
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

test("planned passes run concurrently instead of one after another", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ review: { hold: "inspection", authority: true } }),
	);
	const job = await enqueue();
	await vi.waitFor(
		() =>
			expect(
				query(
					state.dbPath,
					"select pass_id from review_attempts where review_id = ? and kind in ('focused', 'integration') and state = 'running' order by pass_id",
					job.id,
				),
			).toEqual([{ pass_id: "deletion-authority" }, { pass_id: "integration" }, { pass_id: "value-correctness" }]),
		{ timeout: 15000 },
	);
	const cancelled = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "cancel", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(cancelled.stage, cancelled.reason).toBe("applied");
	await settled(job.id, "cancelled");
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([]);
}, 30000);

test("the owner is mailed when the plan is ready and when the review settles, once each", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { finding: true } }));
	const job = await enqueue();
	await settled(job.id, "completed");
	const messages = () =>
		query<{ body: string; sender: string }>(
			state.dbPath,
			"select body, sender from thread_messages where thread_id = ? order by at, rowid",
			`review:${job.id}`,
		);
	await vi.waitFor(() => expect(messages()).toHaveLength(2));
	const [plan, outcome] = messages();
	expect(plan!.body).toContain("is planned: 1 scope, 2 passes, 2 questions");
	expect(outcome!.body).toContain("completed: 1 confirmed finding");
	expect(outcome!.body).toContain("[high] The value disagrees with its consumer (value.ts:1)");
	expect(
		query(
			state.dbPath,
			"select participant from thread_participants where thread_id = ? and delivery = 'push'",
			`review:${job.id}`,
		),
	).toEqual([{ participant: "owner" }]);
}, 30000);

test("cancellation retains observed turn usage and waits for reviewer cleanup", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: { hold: "inspection" } }));
	const job = await enqueue();
	await vi.waitFor(
		() =>
			expect(
				query(
					state.dbPath,
					"select id from review_attempts where review_id = ? and kind in ('focused', 'integration') and state = 'running'",
					job.id,
				),
			).toHaveLength(2),
		{ timeout: 10000 },
	);
	const cancelled = await sendCommand(
		"owner",
		{ kind: "review", version: 1, operation: { action: "cancel", review: job.id } },
		{ socketPath: state.socketPath },
	);
	expect(cancelled.stage, cancelled.reason).toBe("applied");
	await settled(job.id, "cancelled");
	const inspections = query<{ state: string; result: string }>(
		state.dbPath,
		"select state, result from review_attempts where review_id = ? and kind in ('focused', 'integration')",
		job.id,
	);
	expect(inspections).toHaveLength(2);
	for (const attempt of inspections) {
		expect(attempt.state).toBe("cancelled");
		expect(JSON.parse(attempt.result)).toMatchObject({ status: "failed", usage: { cost: { total: 0.3 } } });
	}
	const db = new DatabaseSync(state.dbPath, { readOnly: true });
	try {
		expect(reviewSummary(db, "owner", job.id)).toMatchObject({
			cost: { reportedDollars: expect.closeTo(0.9, 10), reportedAttempts: 3, totalAttempts: 3 },
		});
	} finally {
		db.close();
	}
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

async function enqueue(target: ReviewTarget = { kind: "working-tree", base: "HEAD" }) {
	const commandId = randomUUID();
	const receipt = await sendCommand(
		"owner",
		{
			kind: "review",
			version: 1,
			operation: { action: "enqueue", request: { cwd: repository, target } },
		},
		{ socketPath: state.socketPath, commandId },
	);
	expect(receipt.stage, receipt.reason).toBe("applied");
	return query<{ id: string; artifact: string; generation: number }>(
		state.dbPath,
		"select j.id, j.artifact, j.generation from review_jobs j join commands c on j.id = json_extract(c.result, '$.review') where c.command_id = ?",
		commandId,
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
				// Every concurrent replacement inspection replays the obsolete receipt through its own socket.
				query(state.dbPath, "select id from sessions where last_error = ?", `Observed obsolete receipt ${old.id}:turn`)
					.length,
			).toBeGreaterThan(0),
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
