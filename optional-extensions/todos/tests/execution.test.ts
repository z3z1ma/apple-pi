import { describe, expect, it, vi } from "vitest";
import { TodoController } from "../src/controller.js";
import { TodoExecution } from "../src/execution.js";
import { SessionTodoRepository } from "../src/repository.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

describe("TodoExecution", () => {
	it("resets an atomic claim when catalog launch fails", () => {
		const controller = new TodoController(new SessionTodoRepository());
		controller.create({ title: "run", agentType: "builder" });
		const execution = new TodoExecution(
			controller,
			() => ({ cwd: process.cwd() }) as any,
			() => {},
			() => false,
			() =>
				({
					startBackground: () => {
						throw new Error("disabled");
					},
					abort: () => false,
					runFresh: async () => null,
				}) as any,
		);
		expect(execution.execute([1]).errors).toEqual([{ id: 1, error: "disabled" }]);
		expect(controller.get(1)).toMatchObject({
			status: "open",
			lastError: "disabled",
		});
		expect(controller.get(1)?.execution).toBeUndefined();
	});

	it("reports partial batch launch failures without hiding already-started IDs", () => {
		const controller = new TodoController(new SessionTodoRepository());
		controller.create({ title: "first", agentType: "builder" });
		controller.create({ title: "second", agentType: "builder" });
		const execution = new TodoExecution(
			controller,
			() => ({ cwd: process.cwd() }) as any,
			() => {},
			() => false,
			() =>
				({
					startBackground: () => ({
						id: "agent",
						completion: new Promise(() => {}),
						abort: () => true,
					}),
					abort: () => false,
					runFresh: async () => null,
				}) as any,
		);
		const batch = execution.execute([1, 2, 99]);
		expect(batch.started.map((todo) => todo.id)).toEqual([1, 2]);
		expect(batch.errors).toEqual([{ id: 99, error: "Todo #99 not found" }]);
		expect(controller.get(1)?.execution).toBeDefined();
		expect(controller.get(2)?.execution).toBeDefined();
	});

	it("rejects completed and manually active work", () => {
		const controller = new TodoController(new SessionTodoRepository());
		controller.create({ title: "completed", agentType: "builder" });
		controller.create({ title: "manual", agentType: "builder" });
		controller.update(1, { status: "completed" });
		controller.update(2, { status: "active" });
		const execution = new TodoExecution(
			controller,
			() => ({ cwd: process.cwd() }) as any,
			() => {},
			() => false,
			() =>
				({
					startBackground: () => {
						throw new Error("must not launch");
					},
				}) as any,
		);
		expect(execution.execute([1, 2]).errors).toEqual([
			{ id: 1, error: "Todo #1 must be open before execution" },
			{ id: 2, error: "Todo #2 must be open before execution" },
		]);
	});

	it("settles success and cascades only its now-unblocked dependent", async () => {
		const controller = new TodoController(new SessionTodoRepository());
		controller.create({ title: "first", agentType: "builder" });
		controller.create({
			title: "second",
			agentType: "builder",
			blockedBy: [1],
		});
		const runs: ReturnType<typeof deferred<any>>[] = [];
		const managedCompletions = vi.fn();
		const execution = new TodoExecution(
			controller,
			() => ({ cwd: process.cwd() }) as any,
			() => {},
			() => true,
			() =>
				({
					startBackground: () => {
						const done = deferred<any>();
						runs.push(done);
						return {
							id: `agent-${runs.length}`,
							completion: done.promise,
							abort: () => true,
						};
					},
					abort: () => false,
					runFresh: async () => null,
				}) as any,
			{ onManagedCompletion: managedCompletions },
		);
		execution.execute([1]);
		runs[0].resolve({ status: "completed", result: "done" });
		await Promise.resolve();
		await Promise.resolve();
		expect(controller.get(1)?.status).toBe("completed");
		expect(controller.get(2)).toMatchObject({ status: "active" });
		expect(runs).toHaveLength(2);
		expect(managedCompletions).toHaveBeenCalledTimes(1);
	});
});
