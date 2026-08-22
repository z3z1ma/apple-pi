import { describe, expect, it } from "vitest";
import { AutoClear } from "../src/auto-clear.js";
import { DEFAULT_TODOS_CONFIG } from "../src/config.js";
import type { TodoView } from "../src/types.js";

const completed = (): TodoView => ({
	id: 1,
	title: "done",
	description: "",
	status: "completed",
	blockedBy: [],
	blocked: false,
	blocks: [],
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

describe("AutoClear", () => {
	it("keeps completed work visible for four turns", () => {
		const autoClear = new AutoClear();
		const config = { ...DEFAULT_TODOS_CONFIG, autoClearCompleted: "on_todo_complete" as const };
		autoClear.observe([completed()], config, true);
		for (let turn = 0; turn < 3; turn++) expect(autoClear.onTurnStart(config.autoClearCompleted)).toEqual([]);
		expect(autoClear.onTurnStart(config.autoClearCompleted)).toEqual([1]);
	});

	it("never schedules cleanup for a project list", () => {
		const autoClear = new AutoClear();
		autoClear.observe([completed()], DEFAULT_TODOS_CONFIG, false);
		for (let turn = 0; turn < 5; turn++) autoClear.onTurnStart(DEFAULT_TODOS_CONFIG.autoClearCompleted);
		expect(autoClear.onTurnStart(DEFAULT_TODOS_CONFIG.autoClearCompleted)).toEqual([]);
	});

	it("retires a completed batch only after the producing run settles", () => {
		const autoClear = new AutoClear();
		expect(autoClear.shouldRetireCompletedBatch([completed()], "on_list_complete")).toBe(false);
		autoClear.onRunEnded();
		expect(autoClear.shouldRetireCompletedBatch([completed()], "on_list_complete")).toBe(true);
	});
});
