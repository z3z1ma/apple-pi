import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DEFAULT_RALPH_BUDGETS, RalphController } from "../components/ralph/src/controller.js";
import { roleProfile } from "../components/ralph/src/roles.js";
import type { ReviewerOutput } from "../components/ralph/src/types.js";
import type { ReviewRun } from "../components/review/src/types.js";
import type { ManagedAgentRequest, ManagedSubagentService } from "../components/subagents/src/service.js";
import type { AgentRecord } from "../components/subagents/src/types.js";

const roots: string[] = [];
const TASK = ".ledger/202608151200-work/task.md";
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function task(): string {
	return `Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Implement behavior

## Scope

Implement one observable behavior.

## Non-goals

No adjacent work.

## Acceptance Criteria

- AC-001: The behavior is implemented and verified.

## References

None.

## Assumptions

Record-backed by inspected source.

## Journal

- Opened.

## Blockers

None.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
`;
}

function repository(): string {
	const root = mkdtempSync(join(tmpdir(), "ralph-controller-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "ralph@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Ralph Test"]);
	mkdirSync(join(root, ".ledger", "202608151200-work"), { recursive: true });
	writeFileSync(join(root, ".ledger", "README.md"), `# Task Ledger\n\n- \`${TASK}\`\n`);
	writeFileSync(join(root, TASK), task());
	writeFileSync(join(root, "source.txt"), "before\n");
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	const agentDir = mkdtempSync(join(tmpdir(), "ralph-controller-agent-"));
	roots.push(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	return root;
}

function context(cwd: string) {
	return {
		cwd,
		model: { provider: "test", id: "model" },
		isProjectTrusted: () => true,
	} as any;
}

function completeTask(root: string, label = "implemented"): void {
	writeFileSync(join(root, "source.txt"), `${label}\n`);
}

function ignoreLedger(root: string): void {
	writeFileSync(join(root, ".gitignore"), "/.ledger/\n");
	execFileSync("git", ["-C", root, "rm", "-qr", "--cached", ".ledger"]);
	execFileSync("git", ["-C", root, "add", ".gitignore"]);
	execFileSync("git", ["-C", root, "commit", "-qm", "ignore local ledger"]);
}

interface PlannedRole {
	role: "ralph-executor" | "shared-review-test" | "ralph-judge";
	output: unknown;
	mutate?: (request: ManagedAgentRequest) => void | Promise<void>;
	compactions?: number;
}

function service(plan: PlannedRole[], seen: ManagedAgentRequest[]): ManagedSubagentService {
	let sequence = 0;
	return {
		async runFresh(_ctx, request) {
			seen.push(request);
			const next = plan.shift();
			if (!next) throw new Error("unexpected role call");
			expect(request.type).toBe(next.role);
			await next.mutate?.(request);
			sequence++;
			return {
				id: `agent-${sequence}`,
				type: request.type,
				description: request.description,
				status: "completed",
				result: JSON.stringify(next.output),
				toolUses: 1,
				startedAt: Date.now() - 10,
				completedAt: Date.now(),
				lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
				compactionCount: next.compactions ?? 0,
			} satisfies AgentRecord;
		},
		abort: () => true,
	};
}

function testController(mock: ManagedSubagentService): RalphController {
	return new RalphController({
		getService: () => mock,
		reviewController: {
			async run(ctx, _source, options) {
				const profile = roleProfile("judge");
				const reviewRoot = options.root ?? ctx.cwd;
				const record = await mock.runFresh(ctx, {
					type: "shared-review-test",
					description: "Shared review test adapter",
					prompt: "Review the current Ralph workspace through the test seam.",
					agentConfig: profile.config,
					maxTurns: DEFAULT_RALPH_BUDGETS.reviewerMaxTurns,
					thinkingLevel: "xhigh",
					cwd: reviewRoot,
					toolPolicy: async () => undefined,
				});
				const output = JSON.parse(record.result ?? "{}") as ReviewerOutput;
				const now = new Date().toISOString();
				return {
					schemaVersion: 1,
					runId: randomUUID(),
					projectRoot: reviewRoot,
					source: { mode: "workspace" },
					profile: "balanced",
					state: "complete",
					startedAt: now,
					updatedAt: now,
					inputHash: "test-input",
					selected: [{ id: "item", path: "source.txt", status: "modified", insertions: 1, deletions: 1, fingerprint: "test", binary: false }],
					waived: [],
					completedItemIds: ["item"],
					failures: [],
					findings: output.findings.map((finding, index) => ({
						id: `finding-${index}`,
						groupId: "test",
						severity: finding.severity,
						category: "bug",
						summary: finding.summary,
						impact: finding.evidence,
						evidence: finding.evidence,
						path: finding.path ?? "source.txt",
						anchor: "test",
						side: "new",
						anchorProvenance: "unresolved",
						anchorMatchCount: 0,
						validation: { status: "confirmed", reason: "test adapter", evidence: finding.evidence },
					})),
					residualRisk: output.residualRisk,
					totalTokens: record.lifetimeUsage.input + record.lifetimeUsage.output,
					budgets: { maxTokens: 10000, timeoutSeconds: 60, maxConcurrency: 1, plannerMaxTurns: 1, reviewerMaxTurns: 1, verifierMaxTurns: 1, maxGroups: 1, maxPromptBytes: 32768 },
					routing: { plannerMode: "test", fastMode: "test", strongMode: "test" },
					agents: [],
					lastOutcome: output.summary,
				} satisfies ReviewRun;
			},
		},
	});
}

const executorDone = {
	status: "done",
	summary: "Implemented the bounded behavior.",
	acceptanceCriteria: [{ id: "AC-001", status: "satisfied", evidence: "test behavior passed" }],
	journal: ["Implemented the bounded behavior."],
	blockers: [],
	retrospective: "An explicit boundary made the behavior and failure observable.",
	distillation: ["The implementation and focused test remain the durable owners of this bounded invariant."],
};
const reviewPass = { verdict: "pass", summary: "No falsifying defect found.", findings: [], residualRisk: ["Only AC-001 was reviewed."] };
const judgeClose = {
	decision: "close",
	reason: "Evidence, review, and authority agree.",
	acceptanceCriteria: [{ id: "AC-001", status: "satisfied", evidence: "Task evidence maps the passing behavior test." }],
};

describe("Ralph state machine", () => {
	it("validates budgets before activating an open task", async () => {
		const root = repository();
		const path = join(root, TASK);
		writeFileSync(path, readFileSync(path, "utf8").replace("Status: active", "Status: open"));
		execFileSync("git", ["-C", root, "add", path]);
		execFileSync("git", ["-C", root, "commit", "-qm", "open task"]);
		const controller = testController(service([], []));
		await expect(controller.start(context(root), TASK, { budgets: { maxIterations: 1.5 } })).rejects.toThrow(/integer/);
		expect(readFileSync(join(root, TASK), "utf8")).toContain("Status: open");
	});

	it("runs three distinct fresh roles, records review/judgment, and closes only after all gates", async () => {
		const root = repository();
		const seen: ManagedAgentRequest[] = [];
		const mock = service([
			{ role: "ralph-executor", output: executorDone, mutate: () => completeTask(root) },
			{ role: "shared-review-test", output: reviewPass },
			{ role: "ralph-judge", output: judgeClose },
		], seen);
		const controller = testController(mock);
		const started = await controller.start(context(root), TASK);
		const result = await controller.step(context(root), started.runId);
		expect(result.state).toBe("done");
		expect(result.iteration).toBe(1);
		expect(result.totalTokens).toBe(450);
		expect(seen.map((request) => request.type)).toEqual(["ralph-executor", "shared-review-test", "ralph-judge"]);
		expect(seen[0].agentConfig.builtinToolNames).toContain("write");
		expect(seen[1].agentConfig.builtinToolNames).toEqual(["read", "grep", "find", "ls"]);
		expect(seen[2].agentConfig.builtinToolNames).toEqual(["read", "grep", "find", "ls"]);
		expect(seen[1].toolPolicy).toBeTypeOf("function");
		expect(seen[2].toolPolicy).toBeTypeOf("function");
		const updated = readFileSync(join(root, TASK), "utf8");
		expect(updated).toContain("Status: done");
		expect(updated).toContain("Ralph independent review");
		expect(updated).toContain("Ralph judgment");
		expect(existsSync(join(root, ".ledger", "202608151200-work", "evidence"))).toBe(false);
		expect(existsSync(join(root, ".ledger", "202608151200-work", "reviews"))).toBe(false);
	}, 15_000);

	it("targets a linked worktree while keeping task authority in the main checkout", async () => {
		const root = repository();
		const worktree = join(tmpdir(), `ralph-linked-${randomUUID()}`);
		execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `ralph-${randomUUID()}`, worktree]);
		roots.push(worktree);
		const seen: ManagedAgentRequest[] = [];
		const controller = testController(service([
			{ role: "ralph-executor", output: executorDone, mutate: () => completeTask(worktree, "changed only in linked worktree") },
			{ role: "shared-review-test", output: reviewPass },
			{ role: "ralph-judge", output: judgeClose },
		], seen));
		const result = await controller.run(context(root), TASK, { root: worktree, ledgerRoot: root, budgets: { maxIterations: 1 } });
		expect(result.state).toBe("done");
		expect(result.projectRoot).toBe(realpathSync(worktree));
		expect(result.ledgerRoot).toBe(realpathSync(root));
		expect(seen.every((request) => request.cwd === realpathSync(worktree))).toBe(true);
		expect(readFileSync(join(root, TASK), "utf8")).toContain("Status: done");
		expect(readFileSync(join(worktree, TASK), "utf8")).toContain("Status: active");
		expect(readFileSync(join(worktree, "source.txt"), "utf8")).toContain("changed only in linked worktree");
	}, 15_000);

	it("uses the worktree's own task copy when committed ledger authority is current there", async () => {
		const root = repository();
		const worktree = join(tmpdir(), `ralph-linked-local-ledger-${randomUUID()}`);
		execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `ralph-local-${randomUUID()}`, worktree]);
		roots.push(worktree);
		const controller = testController(service([
			{ role: "ralph-executor", output: executorDone, mutate: () => completeTask(worktree) },
			{ role: "shared-review-test", output: reviewPass },
			{ role: "ralph-judge", output: judgeClose },
		], []));
		const result = await controller.run(context(root), TASK, { root: worktree, budgets: { maxIterations: 1 } });
		expect(result.state).toBe("done");
		expect(result.projectRoot).toBe(realpathSync(worktree));
		expect(result.ledgerRoot).toBe(realpathSync(worktree));
		expect(readFileSync(join(worktree, TASK), "utf8")).toContain("Status: done");
		expect(readFileSync(join(root, TASK), "utf8")).toContain("Status: active");
	}, 15_000);

	it("stops when external ledger authority drifts during a linked-worktree stage", async () => {
		const root = repository();
		const worktree = join(tmpdir(), `ralph-linked-drift-${randomUUID()}`);
		execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `ralph-drift-${randomUUID()}`, worktree]);
		roots.push(worktree);
		const controller = testController(service([{
			role: "ralph-executor",
			output: executorDone,
			mutate: () => {
				completeTask(worktree);
				writeFileSync(join(root, TASK), `${readFileSync(join(root, TASK), "utf8")}\n`);
			},
		}], []));
		const started = await controller.start(context(root), TASK, { root: worktree, ledgerRoot: root });
		const result = await controller.step(context(root), started.runId, undefined, worktree);
		expect(result.state).toBe("workspace_conflict");
		expect(result.lastOutcome).toMatch(/Ledger authority changed/);
	}, 15_000);

	it("completes normally when the team policy ignores .ledger", async () => {
		const root = repository();
		ignoreLedger(root);
		const controller = testController(service([
			{ role: "ralph-executor", output: executorDone, mutate: () => completeTask(root) },
			{ role: "shared-review-test", output: reviewPass },
			{ role: "ralph-judge", output: judgeClose },
		], []));
		const result = await controller.run(context(root), TASK, { budgets: { maxIterations: 1 } });
		expect(result.state).toBe("done");
		expect(readFileSync(join(root, TASK), "utf8")).toContain("Status: done");
		expect(execFileSync("git", ["-C", root, "status", "--short"], { encoding: "utf8" })).toBe(" M source.txt\n");
	});

	it("uses a new executor after an iterate judgment and converges within the explicit bound", async () => {
		const root = repository();
		const seen: ManagedAgentRequest[] = [];
		const judgeIterate = {
			decision: "iterate",
			reason: "One in-scope observation remains.",
			acceptanceCriteria: [{ id: "AC-001", status: "unknown", evidence: "Not observed yet." }],
			nextObjective: "Run and record the missing behavior check.",
		};
		const mock = service([
			{ role: "ralph-executor", output: { ...executorDone, status: "partial", nextObjective: "Record the behavior check." }, mutate: () => {
					writeFileSync(join(root, "source.txt"), "first iteration\n");
				} },
			{ role: "shared-review-test", output: { ...reviewPass, verdict: "concerns", summary: "Evidence remains incomplete." } },
			{ role: "ralph-judge", output: judgeIterate },
			{ role: "ralph-executor", output: executorDone, mutate: () => completeTask(root, "verified in iteration two") },
			{ role: "shared-review-test", output: reviewPass },
			{ role: "ralph-judge", output: judgeClose },
		], seen);
		const controller = testController(mock);
		const result = await controller.run(context(root), TASK, { budgets: { maxIterations: 2 } });
		expect(result.state).toBe("done");
		expect(result.iteration).toBe(2);
		expect(seen.filter((request) => request.type === "ralph-executor")).toHaveLength(2);
		expect(seen[3].prompt).toContain("Run and record the missing behavior check.");
	});

	it("refuses executor attempts to rewrite .ledger task authority", async () => {
		const root = repository();
		const mock = service([{
			role: "ralph-executor",
			output: executorDone,
			mutate: () => {
				const path = join(root, TASK);
				writeFileSync(path, readFileSync(path, "utf8").replace("Status: active", "Status: done"));
			},
		}], []);
		const controller = testController(mock);
		const started = await controller.start(context(root), TASK);
		const result = await controller.step(context(root), started.runId);
		expect(result.state).toBe("authority_required");
		expect(result.lastOutcome).toMatch(/semantic authority directly/);
	});

	it("detects direct ledger mutation when the team policy ignores .ledger", async () => {
		const root = repository();
		ignoreLedger(root);
		const mock = service([{
			role: "ralph-executor",
			output: executorDone,
			mutate: () => writeFileSync(join(root, ".ledger", "README.md"), "# Compromised ledger\n"),
		}], []);
		const controller = testController(mock);
		const started = await controller.start(context(root), TASK);
		const result = await controller.step(context(root), started.runId);
		expect(result.state).toBe("authority_required");
		expect(result.lastOutcome).toMatch(/\.ledger\/README\.md/);
	});

	it("stops when a read-only reviewer mutates the workspace", async () => {
		const root = repository();
		const mock = service([
			{ role: "ralph-executor", output: executorDone, mutate: () => completeTask(root) },
			{ role: "shared-review-test", output: reviewPass, mutate: () => writeFileSync(join(root, "reviewer-write.txt"), "not allowed\n") },
		], []);
		const controller = testController(mock);
		const started = await controller.start(context(root), TASK);
		const result = await controller.step(context(root), started.runId);
		expect(result.state).toBe("workspace_conflict");
		expect(readFileSync(join(root, TASK), "utf8")).not.toContain("Ralph independent review");
	});

	it("refuses a judge close decision when task evidence, retrospective, and distillation gates are unmet", async () => {
		const root = repository();
		const mock = service([
			{ role: "ralph-executor", output: { ...executorDone, acceptanceCriteria: [] }, mutate: () => writeFileSync(join(root, "source.txt"), "changed without evidence\n") },
			{ role: "shared-review-test", output: reviewPass },
			{ role: "ralph-judge", output: judgeClose },
		], []);
		const controller = testController(mock);
		const started = await controller.start(context(root), TASK);
		const result = await controller.step(context(root), started.runId);
		expect(result.state).toBe("evidence_failed");
		expect(result.lastOutcome).toMatch(/Evidence omits AC-001/);
		expect(readFileSync(join(root, TASK), "utf8")).not.toContain("Status: done");
	});

	it("records between-step workspace drift as a terminal conflict without launching an agent", async () => {
		const root = repository();
		const seen: ManagedAgentRequest[] = [];
		const mock = service([], seen);
		const controller = testController(mock);
		const started = await controller.start(context(root), TASK);
		writeFileSync(join(root, "source.txt"), "external edit\n");
		const result = await controller.step(context(root), started.runId);
		expect(result.state).toBe("workspace_conflict");
		expect(seen).toHaveLength(0);
		expect((controller.status(root, started.runId) as any).state).toBe("workspace_conflict");
	});

	it("waits for the active role to quiesce before returning an operator stop", async () => {
		const root = repository();
		let started!: () => void;
		const roleStarted = new Promise<void>((resolve) => { started = resolve; });
		let calls = 0;
		const pending: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				calls++;
				request.onStarted?.("agent-stop");
				started();
				await new Promise<void>((resolve) => {
					if (request.signal?.aborted) resolve();
					else request.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return {
					id: "agent-stop",
					type: request.type,
					description: request.description,
					status: "stopped",
					result: "",
					toolUses: 0,
					startedAt: Date.now() - 10,
					completedAt: Date.now(),
					lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
					compactionCount: 0,
				};
			},
			abort: () => true,
		};
		const controller = testController(pending);
		const run = await controller.start(context(root), TASK);
		const execution = controller.step(context(root), run.runId);
		await roleStarted;
		const stopped = await controller.stop(root, run.runId);
		const executionResult = await execution;
		expect(stopped.state).toBe("stopped");
		expect(executionResult.state).toBe("stopped");
		expect(calls).toBe(1);
	});

	it("stops honestly on authority denial and compaction", async () => {
		const deniedRoot = repository();
		const deniedSeen: ManagedAgentRequest[] = [];
		const deniedService = service([{
			role: "ralph-executor",
			output: executorDone,
			mutate: async (request) => {
				const result = await request.toolPolicy?.({ toolName: "bash", args: { command: "git push origin main" } });
				expect(result).toMatchObject({ block: true, terminate: true });
			},
		}], deniedSeen);
		const deniedController = testController(deniedService);
		const deniedStart = await deniedController.start(context(deniedRoot), TASK);
		const denied = await deniedController.step(context(deniedRoot), deniedStart.runId);
		expect(denied.state).toBe("authority_required");
		expect(readFileSync(join(deniedRoot, TASK), "utf8")).not.toContain("Status: done");

		const compactedRoot = repository();
		const compactedService = service([{ role: "ralph-executor", output: executorDone, compactions: 1 }], []);
		const compactedController = testController(compactedService);
		const compactedStart = await compactedController.start(context(compactedRoot), TASK);
		const compacted = await compactedController.step(context(compactedRoot), compactedStart.runId);
		expect(compacted.state).toBe("compacted");
	});
});
