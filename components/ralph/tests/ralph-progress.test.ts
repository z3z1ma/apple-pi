import { describe, expect, it } from "vitest";
import { ProgressChannel } from "../../operations/src/progress-channel.js";
import { buildRalphProgressSnapshot, ralphProgressIdentity } from "../src/progress.js";
import type { RalphProgressSnapshot, RalphRun } from "../src/types.js";

function run(overrides: Partial<RalphRun> = {}): RalphRun {
	return {
		schemaVersion: 2,
		runId: "ralph-1",
		projectRoot: "/ws",
		ledgerRoot: "/ledger",
		taskPath: ".ledger/202608151200-work/task.md",
		mode: "auto",
		state: "executing",
		iteration: 2,
		budgets: {
			maxIterations: 10,
			maxTokens: 1_000_000,
			timeoutSeconds: 7200,
			executorMaxTurns: 80,
			reviewerMaxTurns: 30,
			judgeMaxTurns: 20,
		},
		startedAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:01:00.000Z",
		graphHash: "a".repeat(64),
		totalTokens: 3210,
		nextObjective: "Integrate catalog",
		activeAgentId: "must-not-leak",
		...overrides,
	};
}

describe("ralph progress", () => {
	it("builds sanitized monotonic snapshots with work items and nested review", () => {
		const channel = new ProgressChannel<RalphProgressSnapshot>();
		const first = channel.publish(
			buildRalphProgressSnapshot(run(), {
				sequence: channel.nextSequence("ralph-1"),
				workItems: [{ id: "WI-001", state: "open", description: "Add catalog parsing now." }],
				activity: { phase: "tool", toolName: "read", turnCount: 2, toolCount: 3, label: "reading…" },
			}),
		);
		const second = channel.publish(
			buildRalphProgressSnapshot(run({ state: "reviewing", totalTokens: 4000 }), {
				sequence: channel.nextSequence("ralph-1"),
				workItems: [{ id: "WI-001", state: "open", description: "Add catalog parsing now." }],
				nestedReviewRunId: "rev-9",
				review: {
					runId: "rev-9",
					projectRoot: "/ws",
					source: { mode: "workspace" },
					profile: "balanced",
					sequence: 1,
					startedAt: run().startedAt,
					updatedAt: run().updatedAt,
					state: "reviewing",
					cycleIndex: 1,
					cycleCap: 1,
					policy: { profile: "balanced", selectedItems: 1, maxCycles: 1, maxFocuses: 6, maxConcurrency: 6 },
					usage: { totalTokens: 10 },
					planner: { status: "completed" },
					verifier: { status: "idle" },
					partitions: [],
					focuses: [{ id: "f1", partitionId: "p", title: "Export", state: "running", findingCount: 0 }],
					findings: [],
					notes: [],
					verifierDecisions: [],
					failures: [],
					residualRisk: [],
					coverage: { selected: 1, completed: 0, failed: 0, waived: 0 },
				},
			}),
		);
		expect(second.sequence).toBeGreaterThan(first.sequence);
		expect(ralphProgressIdentity(first)).toBe(ralphProgressIdentity(second));
		expect(second.workItems.total).toBe(1);
		expect(second.review?.focuses[0]?.state).toBe("running");
		expect(JSON.stringify(second)).not.toContain("must-not-leak");
		const replayed: number[] = [];
		channel.subscribe((snapshot) => replayed.push(snapshot.sequence));
		expect(replayed).toEqual([second.sequence]);
	});
});
