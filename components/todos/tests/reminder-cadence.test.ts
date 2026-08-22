import { describe, expect, it } from "vitest";
import { ReminderCadence } from "../src/reminder-cadence.js";
import type { TodoView } from "../src/types.js";

const todo = (status: TodoView["status"] = "open"): TodoView => ({
	id: 1,
	title: "Keep this safe\nplease",
	description: "",
	status,
	blockedBy: [],
	blocked: false,
	blocks: [],
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

describe("ReminderCadence", () => {
	it("reminds after four idle turns and resets on any todo tool", () => {
		const cadence = new ReminderCadence();
		for (let i = 0; i < 3; i++) cadence.onTurnEnd(false);
		expect(cadence.consume([todo()], true)).toBeUndefined();
		cadence.onTurnEnd(false);
		expect(cadence.consume([todo()], true)).toContain("#1 [open] Keep this safe please");
		cadence.noteTodoTool();
		for (let i = 0; i < 3; i++) cadence.onTurnEnd(false);
		expect(cadence.consume([todo()], true)).toBeUndefined();
	});

	it("uses the shorter active cadence", () => {
		const cadence = new ReminderCadence();
		cadence.onTurnEnd(true);
		expect(cadence.consume([todo("active")], true)).toBeUndefined();
		cadence.onTurnEnd(true);
		expect(cadence.consume([todo("active")], true)).toContain("[active]");
	});
});
