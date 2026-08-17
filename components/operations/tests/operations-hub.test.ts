import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { isTuiContext } from "../src/runtime.js";
import type { Theme } from "../src/ui/format.js";
import { createHubModel, handleHubInput, renderHub } from "../src/ui/hub.js";

const theme: Theme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

const actions = {
	selectTask() {},
	clearTask() {},
	startRalph() {},
	runRalph() {},
	stopRalph() {},
	stopReview() {},
};

describe("operations hub", () => {
	it("clamps narrow widths and switches views without losing ledger selection", () => {
		const model = createHubModel({}, [
			{
				taskId: "202608151200-alpha-task",
				taskPath: ".ledger/202608151200-alpha-task/task.md",
				title: "Alpha work",
				status: "open",
				digest: "a".repeat(64),
				acceptance: ["AC-001"],
				workItems: { open: 1, complete: 0, cancelled: 0, total: 1 },
				issues: 0,
			},
		]);
		const narrow = renderHub(model, theme, 20, 8);
		expect(narrow.every((line) => visibleWidth(line) <= 20)).toBe(true);
		const next = handleHubInput(model, Key.right, actions);
		expect(next.model.view).toBe("ralph");
		expect(next.model.ledger.selectedId).toBe(model.ledger.selectedId);
		const back = handleHubInput(next.model, Key.escape, actions);
		expect(back.close).toBe(true);
	});

	it("does not treat print mode as TUI", () => {
		expect(isTuiContext({ mode: "print", hasUI: false })).toBe(false);
		expect(isTuiContext({ mode: "tui", hasUI: true })).toBe(true);
	});
});
