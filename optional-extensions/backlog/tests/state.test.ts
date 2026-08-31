import { describe, expect, it } from "vitest";
import {
	addBacklogItem,
	BACKLOG_STATE_ENTRY,
	createBacklogState,
	deleteBacklogItem,
	editBacklogItem,
	moveBacklogItem,
	restoreBacklogState,
} from "../src/state.js";

describe("backlog state", () => {
	it("adds stable session-local items and validates their content", () => {
		const initial = createBacklogState();
		const { state, item } = addBacklogItem(
			initial,
			{ title: "  Follow up on cache invalidation  ", description: " Capture the edge case. " },
			new Date("2026-03-16T12:00:00.000Z"),
		);

		expect(item).toEqual({
			id: 1,
			title: "Follow up on cache invalidation",
			description: "Capture the edge case.",
			createdAt: "2026-03-16T12:00:00.000Z",
		});
		expect(state).toEqual({ items: [item], nextId: 2 });
		expect(() => addBacklogItem(state, { title: "  " })).toThrow(/title/i);
		expect(() => addBacklogItem(state, { title: "line one\nline two" })).toThrow(/one line/i);
	});

	it("edits, manually reorders, and deletes items without changing their identity", () => {
		let state = createBacklogState();
		state = addBacklogItem(state, { title: "First" }).state;
		state = addBacklogItem(state, { title: "Second" }).state;
		state = addBacklogItem(state, { title: "Third" }).state;

		state = editBacklogItem(state, 2, { title: "Second revised", description: "More context" });
		state = moveBacklogItem(state, 3, "up");
		expect(state.items.map((item) => [item.id, item.title])).toEqual([
			[1, "First"],
			[3, "Third"],
			[2, "Second revised"],
		]);

		state = deleteBacklogItem(state, 1);
		expect(state.items.map((item) => item.id)).toEqual([3, 2]);
		expect(state.nextId).toBe(4);
	});

	it("restores the latest snapshot on the active session branch", () => {
		const older = addBacklogItem(createBacklogState(), { title: "Older" }).state;
		const current = addBacklogItem(older, { title: "Current" }).state;
		const branch = [
			{ type: "custom", customType: BACKLOG_STATE_ENTRY, data: older },
			{ type: "message", message: { role: "assistant" } },
			{ type: "custom", customType: BACKLOG_STATE_ENTRY, data: current },
		];

		expect(restoreBacklogState(branch)).toEqual(current);
		expect(restoreBacklogState([])).toEqual(createBacklogState());
	});
});
