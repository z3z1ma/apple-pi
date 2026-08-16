import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProjectLease, acquireRalphRunLeases, activeProjectLease } from "../components/ralph/src/lease.js";
import { appendReceipt, listRunSummaries, loadRun, receiptPath, readReceiptEvents } from "../components/ralph/src/receipts.js";
import { parseExecutorOutput, parseJudgeOutput, roleProfile } from "../components/ralph/src/roles.js";
import { appendIndependentReview, appendJudgment, closeTask, completeTaskWorkItemsUnderLease, mutateTaskWorkItems } from "../components/ralph/src/task.js";
import type { RalphRun } from "../components/ralph/src/types.js";
import { compileWorkGraph } from "../components/ralph/src/work-graph.js";
import { captureWorkspace } from "../components/ralph/src/workspace.js";

const roots: string[] = [];
const TASK = ".ledger/202608151200-work/task.md";
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function task(): string {
	return `Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Work

## Scope

One thing.

## Non-goals

None.

## Acceptance Criteria

- AC-001: Works.

## References

None.

## Assumptions

Record-backed.

## Journal

Opened.

## Blockers

None.

## Evidence

- AC-001: The bounded behavior was observed in the focused verification.

## Review

Pending.

## Retrospective

An explicit boundary prevented the prior ambiguous state from recurring.

## Distillation

The implementation and focused test remain the durable owners of this bounded invariant.
`;
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "ralph-records-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "ralph@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Ralph Test"]);
	mkdirSync(join(root, ".ledger", "202608151200-work"), { recursive: true });
	writeFileSync(join(root, ".ledger", "README.md"), `# Task Ledger\n\n- \`${TASK}\`\n`);
	writeFileSync(join(root, TASK), task());
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	return root;
}

describe("Ralph role contracts", () => {
	it("loads packaged executor and judge skills with exact authority", () => {
		const executor = roleProfile("executor");
		const judge = roleProfile("judge");
		expect(executor.skillHash).toMatch(/^[a-f0-9]{64}$/);
		expect(executor.config.builtinToolNames).toContain("edit");
		expect(judge.config.builtinToolNames).toEqual(["read", "grep", "find", "ls"]);
		expect(judge.config.extensions).toBe(false);
	});

	it("rejects malformed or incomplete structured role output", () => {
		expect(() => parseExecutorOutput("prose output")).toThrowError(/JSON object/);
		expect(() => parseExecutorOutput({ status: "done", summary: "done", acceptanceCriteria: [], journal: [], blockers: [], retrospective: "learned" })).toThrowError(/distillation/);
		expect(() => parseExecutorOutput({ status: "done", summary: "Implemented bounded behavior.", acceptanceCriteria: [], journal: [], blockers: [], retrospective: "A durable lesson was recorded.", distillation: [], workItemCompletions: [{ id: "WI-001", evidence: "Substantive completion evidence.", cancel: true }] })).toThrowError(/unsupported fields/);
		expect(() => parseJudgeOutput({ decision: "iterate", reason: "more", acceptanceCriteria: [] })).toThrowError(/nextObjective/);
		expect(() => parseJudgeOutput({ decision: "close", reason: "The evidence and review agree.", acceptanceCriteria: [], workItemJudgments: [{ id: "WI-001", decision: "confirmed", reason: "Substantive judgment reason.", applied: true }] })).toThrowError(/unsupported fields/);
	});
});

describe("task recording and receipts", () => {
	it("records independent review and judgment in task.md before deterministic closure", async () => {
		const root = repo();
		let graph = compileWorkGraph(root, TASK);
		await appendIndependentReview(graph.task.absolutePath, graph.task.digest, "run-12345678", 1, {
			verdict: "pass", summary: "No falsifying defect found.", findings: [], residualRisk: ["Only the named behavior was inspected."],
		});
		graph = compileWorkGraph(root, TASK);
		await appendJudgment(graph.task.absolutePath, graph.task.digest, "run-12345678", 1, {
			decision: "close", reason: "All gates hold.", acceptanceCriteria: [{ id: "AC-001", status: "satisfied", evidence: "Task observation." }], workItemJudgments: [],
		});
		graph = compileWorkGraph(root, TASK);
		await closeTask(graph.task.absolutePath, graph.task.digest);
		const content = readFileSync(graph.task.absolutePath, "utf8");
		expect(content).toContain("Status: done");
		expect(content).toContain("Ralph independent review");
		expect(content).toContain("Ralph judgment");
	});

	it("refuses to add open work to a done task", async () => {
		const root = repo();
		const path = join(root, TASK);
		const closed = await closeTask(path, compileWorkGraph(root, TASK).task.digest);
		const before = readFileSync(path, "utf8");
		await expect(mutateTaskWorkItems(path, closed.digest, { kind: "add", id: "WI-001", description: "Reopen the completed task through an authorized follow-up." })).rejects.toThrow(/done task cannot contain open work items/);
		expect(readFileSync(path, "utf8")).toBe(before);
	});

	it("rejects post-judgment work-item drift before leased completion", async () => {
		const root = repo();
		const path = join(root, TASK);
		let graph = compileWorkGraph(root, TASK);
		await mutateTaskWorkItems(path, graph.task.digest, { kind: "add", id: "WI-001", description: "Implement the authority-preserving completion boundary." });
		graph = compileWorkGraph(root, TASK);
		const judged = await appendJudgment(path, graph.task.digest, "controller-owner", 1, {
			decision: "close",
			reason: "The bounded evidence supports closure.",
			acceptanceCriteria: [{ id: "AC-001", status: "satisfied", evidence: "The focused behavior check passed." }],
			workItemJudgments: [{ id: "WI-001", decision: "confirmed", reason: "The reviewed change supports this completion." }],
		});
		writeFileSync(path, readFileSync(path, "utf8").replace("Implement the authority-preserving completion boundary.", "A concurrent edit changed the judged work-item description."));
		expect(compileWorkGraph(root, TASK).task.digest).not.toBe(judged.digest);
		const release = acquireProjectLease(dirname(path), "controller-owner");
		await expect(completeTaskWorkItemsUnderLease(path, judged.digest, "controller-owner", ["WI-001"])).rejects.toThrow(/changed concurrently/);
		release();
		expect(readFileSync(path, "utf8")).toContain("- [ ] WI-001: A concurrent edit changed the judged work-item description.");
	});

	it("mutates work items under the task-bundle lease and preserves failed task bytes", async () => {
		const root = repo();
		const path = join(root, TASK);
		let digest = compileWorkGraph(root, TASK).task.digest;
		let mutation = await mutateTaskWorkItems(path, digest, { kind: "add", id: "WI-001", description: "Implement the canonical work-item mutation boundary." });
		digest = mutation.digest;
		mutation = await mutateTaskWorkItems(path, digest, { kind: "add", id: "WI-002", description: "Preserve atomic failures under the task-bundle lease." });
		digest = mutation.digest;
		mutation = await mutateTaskWorkItems(path, digest, { kind: "reorder", id: "WI-002", beforeId: "WI-001" });
		digest = mutation.digest;
		expect(readFileSync(path, "utf8")).toMatch(/WI-002[\s\S]*WI-001/);
		mutation = await mutateTaskWorkItems(path, digest, { kind: "complete", id: "WI-001" });
		digest = mutation.digest;
		mutation = await mutateTaskWorkItems(path, digest, { kind: "reopen", id: "WI-001" });
		digest = mutation.digest;
		mutation = await mutateTaskWorkItems(path, digest, { kind: "cancel", id: "WI-001", reason: "No longer required because the active specification excludes it." });
		const beforeFailure = readFileSync(path, "utf8");
		await expect(mutateTaskWorkItems(path, mutation.digest, { kind: "complete", id: "WI-001" })).rejects.toThrow(/Only open/);
		await expect(mutateTaskWorkItems(path, digest, { kind: "add", id: "WI-003", description: "Stale writes must not alter the task document." })).rejects.toThrow(/changed concurrently/);
		expect(readFileSync(path, "utf8")).toBe(beforeFailure);

		const release = acquireProjectLease(dirname(path), "foreign-task-owner");
		await expect(mutateTaskWorkItems(path, mutation.digest, { kind: "add", id: "WI-003", description: "Foreign leases must retain exclusive task authority." })).rejects.toThrow(/already owns/);
		release();

		mutation = await mutateTaskWorkItems(path, mutation.digest, { kind: "add", id: "WI-003", description: "Controller confirmation needs an owned task-bundle lease." });
		await expect(completeTaskWorkItemsUnderLease(path, mutation.digest, "missing-owner", ["WI-003"])).rejects.toThrow(/does not own/);
		const controllerLease = acquireProjectLease(dirname(path), "controller-owner");
		const completed = await completeTaskWorkItemsUnderLease(path, mutation.digest, "controller-owner", ["WI-003"]);
		controllerLease();
		expect(completed.content).toContain("- [x] WI-003");
	});

	it("holds an exclusive user-local project lease", () => {
		const root = repo();
		const agentDir = mkdtempSync(join(tmpdir(), "ralph-lease-agent-"));
		roots.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const release = acquireProjectLease(root, "11111111-abcd");
		expect(activeProjectLease(root)).toMatchObject({ runId: "11111111-abcd", pid: process.pid });
		expect(() => acquireProjectLease(root, "22222222-abcd")).toThrowError(/already owns/);
		release();
		expect(activeProjectLease(root)).toBeUndefined();
		const releaseAgain = acquireProjectLease(root, "22222222-abcd");
		releaseAgain();
	});

	it("leases the implementation workspace and authoritative task independently", () => {
		const root = repo();
		const agentDir = mkdtempSync(join(tmpdir(), "ralph-dual-lease-agent-"));
		const workspaceA = mkdtempSync(join(tmpdir(), "ralph-dual-workspace-a-"));
		const workspaceB = mkdtempSync(join(tmpdir(), "ralph-dual-workspace-b-"));
		roots.push(agentDir, workspaceA, workspaceB);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const secondTask = ".ledger/202608151201-other/task.md";
		mkdirSync(join(root, ".ledger", "202608151201-other"), { recursive: true });
		const release = acquireRalphRunLeases(workspaceA, root, TASK, "aaaaaaaa-run");
		expect(() => acquireRalphRunLeases(workspaceB, root, TASK, "bbbbbbbb-run")).toThrowError(/already owns this resource/);
		const releaseOther = acquireRalphRunLeases(workspaceB, root, secondTask, "cccccccc-run");
		releaseOther();
		release();
	});

	it("persists schema-v2 recoverable state and refuses legacy resume", async () => {
		const root = repo();
		const agentDir = mkdtempSync(join(tmpdir(), "ralph-agent-dir-"));
		roots.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const snapshot = captureWorkspace(root);
		const auditLedger = mkdtempSync(join(tmpdir(), "ralph-removed-ledger-"));
		roots.push(auditLedger);
		const storedLedgerRoot = realpathSync(auditLedger);
		const run: RalphRun = {
			schemaVersion: 2,
			runId: "12345678-abcd-1234-abcd-123456789abc",
			projectRoot: realpathSync(root),
			ledgerRoot: storedLedgerRoot,
			taskPath: TASK,
			mode: "step",
			state: "ready",
			iteration: 0,
			budgets: { maxIterations: 1, maxTokens: 10000, timeoutSeconds: 60, executorMaxTurns: 1, reviewerMaxTurns: 1, judgeMaxTurns: 1 },
			startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), graphHash: "a".repeat(64),
			baselineWorkspace: snapshot, expectedWorkspace: snapshot, totalTokens: 0,
		};
		await expect(appendReceipt(run, { outcome: "malformed", workItems: null as never })).rejects.toThrow(/workItems is invalid/);
		await expect(appendReceipt(run, { stage: "executor", outcome: "done", workItems: { proposals: [{ id: "WI-001", evidence: "The completion evidence is substantive." }] } })).rejects.toThrow(/invalid proposal event/);
		await appendReceipt(run, { outcome: "started" });
		run.state = "executing"; run.iteration = 1; await appendReceipt(run, { stage: "executor", outcome: "stage_started" });
		run.state = "reviewing"; await appendReceipt(run, { stage: "reviewer", outcome: "stage_started" });
		run.state = "judging"; await appendReceipt(run, { stage: "judge", outcome: "stage_started" });
		run.state = "iterating"; await appendReceipt(run, { outcome: "iteration_complete" });
		run.state = "executing"; run.iteration = 2;
		const proposals = [{ id: "WI-001", evidence: "Implemented and validated the bounded mutation." }];
		await expect(appendReceipt(run, { stage: "reviewer", outcome: "done", workItems: { proposals } })).rejects.toThrow(/invalid proposal event/);
		await expect(appendReceipt(run, { stage: "executor", outcome: "done", workItems: { proposals, unexpected: true } as never })).rejects.toThrow(/invalid envelope/);
		await expect(appendReceipt(run, { stage: "executor", outcome: "done", workItems: { proposals: [{ ...proposals[0], unexpected: true }] as never } })).rejects.toThrow(/invalid proposal event/);
		await expect(appendReceipt(run, { stage: "executor", outcome: "done", workItems: { proposals: [{ id: "WI-001", evidence: "todo" }] } })).rejects.toThrow(/invalid proposal event/);
		await appendReceipt(run, { stage: "executor", outcome: "done", workItems: { proposals } });
		await expect(appendReceipt(run, { stage: "executor", outcome: "done", workItems: { proposals } })).rejects.toThrow(/duplicate work-item proposals/);
		run.state = "reviewing"; await appendReceipt(run, { stage: "reviewer", outcome: "stage_started" });
		run.state = "judging";
		const judgments = [{ id: "WI-001", decision: "confirmed" as const, reason: "The supplied evidence is sufficient." }];
		await expect(appendReceipt(run, { stage: "judge", outcome: "iterate", workItems: { judgments: [] } })).rejects.toThrow(/does not assess work-item proposals exactly/);
		await expect(appendReceipt(run, { stage: "judge", outcome: "iterate", workItems: { judgments: [{ ...judgments[0], unexpected: true }] as never } })).rejects.toThrow(/invalid judgment event/);
		await expect(appendReceipt(run, { stage: "judge", outcome: "iterate", workItems: { judgments: [{ id: "WI-001", decision: "confirmed", reason: "pending" }] } })).rejects.toThrow(/invalid judgment event/);
		await appendReceipt(run, { stage: "judge", outcome: "iterate", workItems: { judgments } });
		await expect(appendReceipt(run, { stage: "judge", outcome: "iterate", workItems: { judgments } })).rejects.toThrow(/repeats work-item judgments/);
		const taskDigest = "b".repeat(64);
		await expect(appendReceipt(run, { stage: "judge", outcome: "work_items_applied", workItems: { confirmedIds: ["WI-001"], rejectedIds: ["WI-001"], taskDigest } })).rejects.toThrow(/invalid applied work-item state/);
		await expect(appendReceipt(run, { stage: "judge", outcome: "work_items_applied", workItems: { confirmedIds: ["WI-999"], rejectedIds: [], taskDigest } })).rejects.toThrow(/invalid applied work-item state/);
		await appendReceipt(run, { stage: "judge", outcome: "work_items_applied", workItems: { confirmedIds: ["WI-001"], rejectedIds: [], taskDigest } });
		await expect(appendReceipt(run, { stage: "judge", outcome: "work_items_applied", workItems: { confirmedIds: ["WI-001"], rejectedIds: [], taskDigest } })).rejects.toThrow(/repeats applied work-item state/);
		run.state = "iterating"; await appendReceipt(run, { outcome: "iteration_complete" });
		rmSync(auditLedger, { recursive: true, force: true });
		expect(loadRun(root, run.runId)).toMatchObject({ state: "iterating", ledgerRoot: storedLedgerRoot });
		run.state = "error";
		run.terminalCause = "invalid_output";
		await appendReceipt(run, { outcome: "gate", gate: { kind: "error", reason: "Ralph executor did not submit exactly one typed result" } });
		expect(loadRun(root, run.runId)).toMatchObject({ state: "error", terminalCause: "invalid_output" });
		expect(listRunSummaries(root)).toHaveLength(1);
		expect(receiptPath(root, run.runId).startsWith(agentDir)).toBe(true);

		const legacyId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
		appendFileSync(receiptPath(root, legacyId), `${JSON.stringify({ schemaVersion: 1, runId: legacyId })}\n`);
		expect(() => loadRun(root, legacyId)).toThrowError(/audit-only/);
		expect(listRunSummaries(root)).toHaveLength(1);

		const events = readReceiptEvents(root, run.runId);
		const forged = structuredClone(events.at(-1)!);
		forged.sequence++;
		forged.timestamp = new Date().toISOString();
		delete (forged.run!.budgets as Partial<RalphRun["budgets"]>).maxTokens;
		appendFileSync(receiptPath(root, run.runId), `${JSON.stringify(forged)}\n`);
		expect(() => loadRun(root, run.runId)).toThrowError(/incomplete budgets/);
	});
});
