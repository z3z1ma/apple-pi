import { describe, expect, it } from "vitest";
import { TodoController } from "../src/controller.js";
import { SessionTodoRepository } from "../src/repository.js";

describe("TodoController bulk clear", () => {
	it("preserves completed prerequisites referenced by managed execution", () => {
		const controller = new TodoController(new SessionTodoRepository());
		controller.create({ title: "prerequisite" });
		controller.create({ title: "dependent", blockedBy: [1] });
		controller.update(1, { status: "completed" });
		controller.claimExecution(2, "run");
		expect(controller.clearCompleted()).toBe(0);
		expect(controller.get(1)?.status).toBe("completed");
		expect(controller.get(2)?.blockedBy).toEqual([1]);
	});
});
