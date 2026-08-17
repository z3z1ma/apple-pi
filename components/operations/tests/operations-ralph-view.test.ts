import { describe, expect, it } from "vitest";
import type { RalphProgressSnapshot } from "../../ralph/src/types.js";
import type { Theme } from "../src/ui/format.js";
import { type HubModel, handleHubInput } from "../src/ui/hub.js";
import { renderRalphDetail, renderRalphView } from "../src/ui/ralph-view.js";

const theme: Theme = { fg: (_c, text) => text, bold: (text) => text };

function ralph(root: string, runId: string): RalphProgressSnapshot {
	return {
		runId,
		projectRoot: root,
		ledgerRoot: root,
		taskPath: ".ledger/202608151200-work/task.md",
		sequence: 4,
		startedAt: new Date(0).toISOString(),
		updatedAt: new Date().toISOString(),
		state: "executing",
		stage: "executor",
		iteration: 2,
		mode: "auto",
		usage: { totalTokens: 4400 },
		policy: { mode: "auto" },
		workItems: {
			open: 1,
			complete: 2,
			cancelled: 0,
			total: 3,
			items: [
				{ id: "WI-001", state: "complete", description: "First item done here." },
				{ id: "WI-002", state: "complete", description: "Second item done here." },
				{ id: "WI-003", state: "open", description: "Integrate catalog parsing now." },
			],
		},
		nextObjective: "Finish catalog tests.",
	};
}

describe("ralph operations view", () => {
	it("keeps distinct roots; stop stays on the owning Ralph run", () => {
		const a = ralph("/ws-a", "run-a");
		const b = ralph("/ws-b", "run-b");
		const rows = [
			{ runId: "run-a", workspaceRoot: "/ws-a", live: a, ownership: { kind: "owned" as const } },
			{
				runId: "run-b",
				workspaceRoot: "/ws-b",
				live: b,
				ownership: { kind: "foreign" as const, pid: 9, ownerRunId: "run-b" },
			},
		];
		const list = renderRalphView(rows, "run-a", theme, 48);
		expect(list.join("\n")).toMatch(/iter 2/);
		expect(list.join("\n")).toMatch(/pid 9/);
		const detail = renderRalphDetail(a, theme, 80);
		expect(detail.join("\n")).toMatch(/WI-003/);
		let stopped = "";
		const model: HubModel = {
			view: "ralph",
			ledger: { tasks: [], query: "", active: {}, searchFocused: false },
			ralph: rows,
			selectedRalphId: "run-a",
			detail: { lines: detail, offset: 0, confirmingStop: false, canStop: true },
		};
		const armed = handleHubInput(model, "s", {
			selectTask() {},
			clearTask() {},
			startRalph() {},
			runRalph() {},
			stopRalph(root, id) {
				stopped = `${root}:${id}`;
			},
		});
		expect(armed.model.detail?.confirmingStop).toBe(true);
		handleHubInput(armed.model, "s", {
			selectTask() {},
			clearTask() {},
			startRalph() {},
			runRalph() {},
			stopRalph(root, id) {
				stopped = `${root}:${id}`;
			},
		});
		expect(stopped).toBe("/ws-a:run-a");
	});
});
