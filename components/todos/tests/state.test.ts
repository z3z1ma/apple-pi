import { describe, it, expect } from "vitest";
import {
	createTodoState,
	createTodo,
	updateTodo,
	todoViews,
	settleExecution,
	claimExecution,
	restoreTodoState,
	TODOS_STATE_ENTRY,
	deleteTodo,
} from "../src/state.js";
describe("todo state", () =>
	it("validates atomic dependency changes and derives blockers", () => {
		let s = createTodoState();
		s = createTodo(s, { title: "one" }).state;
		s = createTodo(s, { title: "two", blockedBy: [1] }).state;
		expect(todoViews(s)[1].blocked).true;
		expect(() => updateTodo(s, 1, { blockedBy: [2] })).toThrow(/cycle/);
		expect(() => updateTodo(s, 2, { status: "active" })).toThrow(/block/);
		s = updateTodo(s, 1, { status: "completed" });
		expect(todoViews(s)[1].blocked).false;
		expect(() => updateTodo(s, 2, { status: "active" })).not.toThrow();
		s = updateTodo(s, 1, { status: "open" });
		expect(() => updateTodo(s, 2, { status: "active" })).toThrow(/block/);
		s = updateTodo(s, 1, { status: "completed" });
		let defaults = createTodoState();
		defaults = createTodo(defaults, { title: "default one" }).state;
		defaults = createTodo(defaults, { title: "default two" }).state;
		const defaultsA = claimExecution(defaults, 1);
		const defaultsB = claimExecution(defaults, 2);
		expect(defaultsA.todos[0].execution?.ownerProcessUuid).toBe(defaultsB.todos[1].execution?.ownerProcessUuid);
		const once = claimExecution(s, 2, {
			runId: "claim",
			ownerPid: 1,
			ownerProcessUuid: "p",
			claimedAt: new Date().toISOString(),
		});
		expect(() => claimExecution(once, 2)).toThrow(/claim/);
		s = createTodo(s, { title: "three" }).state;
		const claimedTwo = claimExecution(s, 3, {
			runId: "claim-two",
			ownerPid: 2,
			ownerProcessUuid: "process-two",
			claimedAt: new Date().toISOString(),
		});
		expect(claimedTwo.todos.find((t) => t.id === 3)?.execution?.ownerProcessUuid).toBe("process-two");
		const claimed = {
			...s.todos[1],
			status: "active" as const,
			execution: {
				runId: "r",
				ownerPid: 1,
				ownerProcessUuid: "p",
				claimedAt: new Date().toISOString(),
			},
		};
		s = { ...s, todos: [s.todos[0], claimed] };
		expect(settleExecution(s, 2, "r", "done").todos[1].execution).undefined;
	}));
describe("execution outcomes", () =>
	it("clears stale failure output after a successful retry", () => {
		let state = createTodoState();
		state = createTodo(state, { title: "retry" }).state;
		state = claimExecution(state, 1, {
			runId: "first",
			ownerPid: 1,
			ownerProcessUuid: "process",
			claimedAt: new Date().toISOString(),
		});
		state = settleExecution(state, 1, "first", undefined, "failed");
		state = claimExecution(state, 1, {
			runId: "second",
			ownerPid: 1,
			ownerProcessUuid: "process",
			claimedAt: new Date().toISOString(),
		});
		const settled = settleExecution(state, 1, "second", "success").todos[0];
		expect(settled).toMatchObject({ status: "completed", result: "success" });
		expect(settled.lastError).toBeUndefined();
	}));

describe("todo state restoration and managed mutations", () => {
	it("rejects a malformed newest recognized snapshot and active blocked records", () => {
		const timestamp = new Date().toISOString();
		const malformed = {
			nextId: 3,
			todos: [
				{
					id: 1,
					title: "prerequisite",
					description: "",
					status: "open",
					blockedBy: [],
					createdAt: timestamp,
					updatedAt: timestamp,
				},
				{
					id: 2,
					title: "blocked active",
					description: "",
					status: "active",
					blockedBy: [1],
					createdAt: timestamp,
					updatedAt: timestamp,
				},
			],
		};
		expect(() =>
			restoreTodoState([
				{
					type: "custom",
					customType: TODOS_STATE_ENTRY,
					data: createTodo(createTodoState(), { title: "old" }).state,
				},
				{ type: "custom", customType: TODOS_STATE_ENTRY, data: malformed },
			]),
		).toThrow(/unresolved blockers/i);
	});
	it("does not permit ordinary managed update or deletion", () => {
		const base = createTodo(createTodoState(), { title: "owned" }).state;
		const claimed = claimExecution(base, 1);
		expect(() => updateTodo(claimed, 1, { status: "completed" })).toThrow(/managed execution/);
		expect(() => deleteTodo(claimed, 1)).toThrow(/managed execution/);
	});
	it("does not remove a completed prerequisite from a managed dependent", () => {
		let state = createTodo(createTodoState(), { title: "prerequisite" }).state;
		state = createTodo(state, { title: "dependent", blockedBy: [1] }).state;
		state = updateTodo(state, 1, { status: "completed" });
		state = claimExecution(state, 2);
		expect(() => deleteTodo(state, 1)).toThrow(/prerequisite of managed todo/);
	});
});
