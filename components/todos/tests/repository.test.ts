import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTodoRepository, recoverStaleClaim } from "../src/repository.js";
import { createTodo } from "../src/state.js";
describe("project repository", () =>
	it("re-reads under lock and atomically persists", () => {
		const cwd = mkdtempSync(join(tmpdir(), "todos-"));
		const a = new ProjectTodoRepository(cwd),
			b = new ProjectTodoRepository(cwd);
		a.mutate((s) => {
			const r = createTodo(s, { title: "a" });
			return { state: r.state, value: undefined };
		});
		b.mutate((s) => {
			const r = createTodo(s, { title: "b" });
			return { state: r.state, value: undefined };
		});
		expect(a.read().todos.map((x) => x.id)).toEqual([1, 2]);
		expect(JSON.parse(readFileSync(a.filePath, "utf8")).nextId).toBe(3);
	}));

describe("stale recovery", () =>
	it("fails closed unless owner death is positively established", () => {
		const cwd = mkdtempSync(join(tmpdir(), "todos-"));
		const repo = new ProjectTodoRepository(cwd);
		repo.mutate((s) => {
			const r = createTodo(s, { title: "claimed" });
			r.state.todos[0].execution = {
				runId: "run",
				ownerPid: 123,
				ownerProcessUuid: "process",
				claimedAt: new Date().toISOString(),
			};
			r.state.todos[0].status = "active";
			return { state: r.state, value: undefined };
		});
		expect(recoverStaleClaim(repo, 1, "run", () => false)).toBe(false);
		expect(repo.read().todos[0].execution?.runId).toBe("run");
		expect(recoverStaleClaim(repo, 1, "run", () => true)).toBe(true);
		expect(repo.read().todos[0].execution).toBeUndefined();
	}));

it("rejects invalid direct writes before persisting", () => {
	const cwd = mkdtempSync(join(tmpdir(), "todos-"));
	const repo = new ProjectTodoRepository(cwd);
	expect(() => repo.write({ nextId: 1, todos: [{ id: 1 }] } as any)).toThrow(/Invalid|monotonic/);
});
