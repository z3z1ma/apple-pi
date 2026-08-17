import { describe, expect, it } from "vitest";
import type { ReviewProgressSnapshot } from "../../review/src/types.js";
import type { Theme } from "../src/ui/format.js";
import { type HubModel, handleHubInput } from "../src/ui/hub.js";
import { type ReviewViewRow, renderReviewDetail, renderReviewView } from "../src/ui/review-view.js";

const theme: Theme = { fg: (_c, text) => text, bold: (text) => text };

function snapshot(overrides: Partial<ReviewProgressSnapshot> = {}): ReviewProgressSnapshot {
	return {
		runId: "rev-1",
		projectRoot: "/repo",
		source: { mode: "workspace" },
		profile: "balanced",
		sequence: 3,
		startedAt: new Date(0).toISOString(),
		updatedAt: new Date().toISOString(),
		state: "reviewing",
		cycleIndex: 1,
		cycleCap: 1,
		policy: { profile: "balanced", selectedItems: 2, maxCycles: 1, maxFocuses: 6, maxConcurrency: 6 },
		usage: { totalTokens: 1200 },
		planner: { status: "completed" },
		verifier: { status: "idle" },
		partitions: [{ id: "p1", title: "Controller", itemCount: 2, completedItemCount: 1 }],
		focuses: [
			{ id: "f1", partitionId: "p1", title: "Export", state: "running", findingCount: 1 },
			{ id: "f2", partitionId: "p1", title: "Docs", state: "queued", findingCount: 0 },
		],
		findings: [{ id: "fd1", cycle: 1, severity: "minor", path: "a.ts", summary: "Changed", validation: "confirmed" }],
		notes: [],
		verifierDecisions: [{ findingId: "fd1", status: "confirmed" }],
		failures: [],
		residualRisk: [],
		coverage: { selected: 2, completed: 1, failed: 0, waived: 0 },
		...overrides,
	};
}

describe("review operations view", () => {
	it("renders live and persisted details and blocks nested stop", () => {
		const live = snapshot();
		const rows: ReviewViewRow[] = [
			{ runId: "rev-1", live, ownership: { kind: "owned" } },
			{
				runId: "rev-2",
				receipt: { kind: "load_error", runId: "rev-2", receiptPath: "/tmp/x.jsonl", reason: "corrupt" },
				ownership: { kind: "stale" },
			},
		];
		const list = renderReviewView(rows, "rev-1", theme, 40);
		expect(list.every((line) => line.length <= 40)).toBe(true);
		expect(list.join("\n")).toContain("load error");
		const detail = renderReviewDetail(
			{ ...live, state: "complete", terminalOutcome: { state: "complete", lastOutcome: "done" } },
			theme,
			60,
		);
		expect(detail.join("\n")).toMatch(/cycle 1\/1/);
		expect(detail.join("\n")).toMatch(/finding/);
		const model: HubModel = {
			view: "review",
			ledger: { tasks: [], query: "", active: {}, searchFocused: false },
			ralph: [],
			reviews: [{ runId: "nested", live, ownership: { kind: "nested", parentRunId: "ralph-1" } }],
			selectedReviewId: "nested",
		};
		const opened = handleHubInput(model, "\r", {
			selectTask() {},
			clearTask() {},
			startRalph() {},
			runRalph() {},
			stopRalph() {},
			stopReview() {
				throw new Error("should not stop nested");
			},
		});
		expect(opened.model.detail?.canStop).toBe(false);
		expect(opened.model.detail?.stopBlockedReason).toMatch(/Ralph/);
	});
});
