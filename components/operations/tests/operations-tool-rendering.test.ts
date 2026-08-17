import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { RalphProgressSnapshot } from "../../ralph/src/types.js";
import { CompactOperationsWidget, renderCompactLines } from "../src/ui/compact-widget.js";
import type { Theme } from "../src/ui/format.js";
import { renderRalphProgressCard, throttleUpdates } from "../src/ui/tool-renderers.js";

const theme: Theme = { fg: (_c, text) => text, bold: (text) => text };

const ralph: RalphProgressSnapshot = {
	runId: "ralph",
	projectRoot: "/repo",
	ledgerRoot: "/repo",
	taskPath: ".ledger/202608151813-build-harness-operations-ui/task.md",
	sequence: 5,
	startedAt: new Date(Date.now() - 4000).toISOString(),
	updatedAt: new Date().toISOString(),
	state: "executing",
	iteration: 2,
	mode: "auto",
	usage: { totalTokens: 12000 },
	policy: { mode: "auto" },
	activity: { phase: "tool", toolName: "read", turnCount: 3, toolCount: 4, label: "reading…" },
	workItems: {
		open: 5,
		complete: 2,
		cancelled: 0,
		total: 7,
		items: [{ id: "WI-003", state: "open", description: "Integrate the work-item parser now." }],
	},
	nextObjective: "Keep the widget live.",
};

describe("operations tool rendering", () => {
	it("renders partial and final cards and clamps the compact widget", () => {
		const finalRalph = renderRalphProgressCard(
			{ ...ralph, state: "done", terminalOutcome: { state: "done", lastOutcome: "closed" } },
			theme,
			false,
		).render(80);
		expect(finalRalph.join("\n")).toMatch(/WI 2\/7/);
		const widget = renderCompactLines(
			{
				activeTask: {
					pointer: { schemaVersion: 1, ledgerRoot: "/repo", taskPath: ralph.taskPath },
				},
				catalogTask: {
					taskId: "202608151813-build-harness-operations-ui",
					taskPath: ralph.taskPath,
					title: "Build interactive Ralph and ledger-task operations UI",
					status: "active",
					digest: "b".repeat(64),
					acceptance: ["AC-001"],
					workItems: { open: 5, complete: 2, cancelled: 0, total: 7 },
					issues: 0,
				},
				ralph: [ralph],
			},
			theme,
			28,
		);
		expect(widget.some((line) => /Ralph|Harness|WI/.test(line))).toBe(true);
		expect(widget.every((line) => visibleWidth(line) <= 28)).toBe(true);
		expect(widget.join("\n")).not.toContain("agent-");
	});

	it("does not recurse when Pi disposes the widget via setWidget", () => {
		let depth = 0;
		let current: { dispose?: () => void } | undefined;
		const ui = {
			setStatus() {},
			setWidget(
				_key: string,
				factory:
					| undefined
					| ((
							tui: unknown,
							theme: Theme,
					  ) => {
							render(width?: number): string[];
							invalidate(): void;
							dispose?(): void;
					  }),
			) {
				depth++;
				if (depth > 20) throw new RangeError("Maximum call stack size exceeded");
				current?.dispose?.();
				current = factory ? factory({ requestRender() {} }, theme) : undefined;
				depth--;
			},
		};
		const widget = new CompactOperationsWidget();
		widget.setUICtx(ui);
		widget.setActiveTask({
			pointer: { schemaVersion: 1, ledgerRoot: "/repo", taskPath: ralph.taskPath },
		});
		expect(() => widget.setActiveTask({})).not.toThrow();
		widget.setActiveTask({
			pointer: { schemaVersion: 1, ledgerRoot: "/repo", taskPath: ralph.taskPath },
		});
		expect(() => widget.dispose()).not.toThrow();
	});

	it("throttles partial updates", async () => {
		const seen: number[] = [];
		const send = throttleUpdates((value: number) => seen.push(value), 20);
		send(1);
		send(2);
		send(3);
		expect(seen).toEqual([1]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(seen.at(-1)).toBe(3);
	});
});
