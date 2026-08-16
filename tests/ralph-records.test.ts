import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProjectLease, acquireRalphRunLeases, activeProjectLease } from "../components/ralph/src/lease.js";
import { appendReceipt, listRunSummaries, loadRun, receiptPath, readReceiptEvents } from "../components/ralph/src/receipts.js";
import { parseExecutorOutput, parseJudgeOutput, roleProfile } from "../components/ralph/src/roles.js";
import { appendIndependentReview, appendJudgment, closeTask } from "../components/ralph/src/task.js";
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
		expect(() => parseExecutorOutput("```json\n{}\n```")).toThrowError(/malformed JSON/);
		expect(() => parseExecutorOutput(JSON.stringify({ status: "done", summary: "done", acceptanceCriteria: [], journal: [], blockers: [], retrospective: "learned" }))).toThrowError(/distillation/);
		expect(() => parseJudgeOutput(JSON.stringify({ decision: "iterate", reason: "more", acceptanceCriteria: [] }))).toThrowError(/nextObjective/);
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
			decision: "close", reason: "All gates hold.", acceptanceCriteria: [{ id: "AC-001", status: "satisfied", evidence: "Task observation." }],
		});
		graph = compileWorkGraph(root, TASK);
		await closeTask(graph.task.absolutePath, graph.task.digest);
		const content = readFileSync(graph.task.absolutePath, "utf8");
		expect(content).toContain("Status: done");
		expect(content).toContain("Ralph independent review");
		expect(content).toContain("Ralph judgment");
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
		await appendReceipt(run, { outcome: "started" });
		run.state = "executing"; run.iteration = 1; await appendReceipt(run, { stage: "executor", outcome: "stage_started" });
		run.state = "reviewing"; await appendReceipt(run, { stage: "reviewer", outcome: "stage_started" });
		run.state = "judging"; await appendReceipt(run, { stage: "judge", outcome: "stage_started" });
		run.state = "iterating"; await appendReceipt(run, { outcome: "iteration_complete" });
		rmSync(auditLedger, { recursive: true, force: true });
		expect(loadRun(root, run.runId)).toMatchObject({ state: "iterating", ledgerRoot: storedLedgerRoot });
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
