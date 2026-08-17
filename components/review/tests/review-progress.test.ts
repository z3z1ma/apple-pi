import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedAgentRequest, ManagedSubagentService } from "../../subagents/src/service.js";
import type { AgentRecord } from "../../subagents/src/types.js";
import { type ResolvedReviewModel, ReviewController } from "../src/controller.js";
import type { ReviewProgressSnapshot } from "../src/types.js";

const roots: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): string {
	const root = mkdtempSync(join(tmpdir(), "apple-review-progress-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "review@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Review Test"]);
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "value.ts"), "export const value = 1;\n");
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	writeFileSync(join(root, "src", "value.ts"), "export const value = 2;\n");
	const agentDir = mkdtempSync(join(tmpdir(), "apple-review-progress-agent-"));
	roots.push(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	return root;
}

function context(cwd: string) {
	const model = { provider: "test", id: "caller", reasoning: true } as Model<any>;
	return {
		cwd,
		model,
		modelRegistry: { find: () => model },
		thinkingLevel: "high",
		isProjectTrusted: () => true,
	} as any;
}

async function invoke(request: ManagedAgentRequest, name: string, params: unknown): Promise<void> {
	const tool = request.customTools?.find((entry) => entry.name === name);
	if (!tool) throw new Error(`missing tool ${name}`);
	await tool.execute("test-result", params as never, undefined, undefined, {} as never);
}

function record(request: ManagedAgentRequest, sequence: number): AgentRecord {
	return {
		id: `agent-${sequence}`,
		type: request.type,
		description: request.description,
		status: "completed",
		result: "ok",
		toolUses: 1,
		startedAt: Date.now() - 20,
		completedAt: Date.now(),
		lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
		compactionCount: 0,
	};
}

describe("review progress", () => {
	it("publishes monotonic cycle/focus snapshots without internal IDs", async () => {
		const root = repository();
		const snapshots: ReviewProgressSnapshot[] = [];
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`secret-agent-${++sequence}`);
				request.onActivity?.({ phase: "tool", toolName: "read", turnCount: 1, toolCount: 1, label: "reading…" });
				if (request.type === "review-planner") {
					await invoke(request, "open_review", {
						title: "Value",
						files: ["src/value.ts"],
						focuses: [
							{ title: "Export", question: "Did the export change?", checks: ["Read the export."] },
							{ title: "Callers", question: "Do callers break?", checks: ["Search callers."] },
						],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") {
					await invoke(request, "report", {
						kind: "finding",
						severity: "minor",
						path: "src/value.ts",
						what: "Value changed",
						why: "Callers may notice.",
						evidence: "export const value = 2;",
					});
					return record(request, sequence);
				}
				const block = request.prompt.split("<candidate-findings>")[1]?.split("</candidate-findings>")[0] ?? "[]";
				const findingIds = (JSON.parse(block) as Array<{ id: string }>).map((finding) => finding.id);
				await invoke(request, "submit_meta_review", {
					decisions: findingIds.map((findingId) => ({
						findingId,
						status: "confirmed",
						reason: "The export is observably different.",
						evidence: "The sealed line changed.",
					})),
					sentiment: "Small contract change.",
					compoundRisks: [],
					residuals: ["Check callers later."],
					coverageGaps: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const controller = new ReviewController({
			getService: () => service,
			resolveModel: async (_ctx, mode, tier): Promise<ResolvedReviewModel> => ({
				model: { provider: "test", id: mode, reasoning: true } as Model<any>,
				thinkingLevel: "low",
				mode,
				tier,
			}),
		});
		const unsub = controller.subscribeProgress((snapshot) => snapshots.push(snapshot));
		const run = await controller.run(context(root), { mode: "workspace" }, { root, profile: "fast" });
		unsub();
		expect(run.state).toBe("complete");
		expect(snapshots.length).toBeGreaterThan(3);
		const sequences = snapshots.map((snapshot) => snapshot.sequence);
		expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
		expect(new Set(sequences).size).toBe(sequences.length);
		expect(snapshots.some((snapshot) => snapshot.cycleIndex === 1 && snapshot.cycleCap >= 1)).toBe(true);
		expect(snapshots.some((snapshot) => snapshot.focuses.some((focus) => focus.state === "queued"))).toBe(true);
		expect(snapshots.some((snapshot) => snapshot.focuses.some((focus) => focus.state === "running"))).toBe(true);
		expect(snapshots.some((snapshot) => snapshot.focuses.every((focus) => focus.state === "completed"))).toBe(true);
		expect(snapshots.some((snapshot) => snapshot.planner.status === "running")).toBe(true);
		expect(snapshots.at(-1)?.findings.length).toBeGreaterThan(0);
		expect(snapshots.at(-1)?.usage.totalTokens).toBeGreaterThan(0);
		expect(snapshots.at(-1)?.terminalOutcome?.state).toBe("complete");
		const leaked = JSON.stringify(snapshots);
		expect(leaked).not.toMatch(/secret-agent/);
		expect(leaked).not.toMatch(/sessionFile/);
	});
});
