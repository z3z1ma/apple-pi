import { randomUUID } from "node:crypto";
import {
	attachExecutionAgent,
	claimExecution,
	createTodo,
	deleteTodo,
	settleExecution,
	todoViews,
	updateTodo,
} from "./state.js";
import type { TodoInput, TodoUpdate } from "./types.js";
import { ProjectTodoRepository, recoverStaleClaim } from "./repository.js";
import type { TodoRepository } from "./repository.js";
export class TodoController {
	private current = true;

	constructor(
		private repository: TodoRepository,
		readonly processUuid = randomUUID(),
		readonly generation = 0,
	) {}
	invalidate(): void {
		this.current = false;
	}
	list() {
		return todoViews(this.repository.read());
	}
	get(id: number) {
		return this.list().find((t) => t.id === id);
	}
	create(input: TodoInput) {
		return this.repository.mutate((s) => {
			const r = createTodo(s, input);
			return { state: r.state, value: r.todo };
		});
	}
	update(id: number, input: TodoUpdate) {
		return this.repository.mutate((s) => {
			const next = updateTodo(s, id, input);
			return { state: next, value: todoViews(next).find((t) => t.id === id)! };
		});
	}
	delete(id: number) {
		return this.repository.mutate((s) => ({
			state: deleteTodo(s, id),
			value: { deleted: id },
		}));
	}
	clearCompleted(ids?: readonly number[]) {
		return this.repository.mutate((state) => {
			const requested = ids ? new Set(ids) : undefined;
			const protectedIds = new Set(state.todos.filter((todo) => todo.execution).flatMap((todo) => todo.blockedBy));
			const removed = new Set(
				state.todos
					.filter(
						(todo) =>
							todo.status === "completed" &&
							(requested === undefined || requested.has(todo.id)) &&
							!protectedIds.has(todo.id),
					)
					.map((todo) => todo.id),
			);
			return {
				state: {
					...state,
					todos: state.todos
						.filter((todo) => !removed.has(todo.id))
						.map((todo) => ({
							...todo,
							blockedBy: todo.blockedBy.filter((id) => !removed.has(id)),
						})),
				},
				value: removed.size,
			};
		});
	}
	clearAll() {
		return this.repository.mutate((s) => {
			if (s.todos.some((todo) => todo.execution)) throw new Error("Cannot clear todos with managed execution");
			return { state: { ...s, todos: [] }, value: s.todos.length };
		});
	}
	claimExecution(id: number, runId: string = randomUUID()) {
		if (!this.current) throw new Error("Todo controller is no longer current");
		return this.repository.mutate((s) => ({
			state: claimExecution(s, id, {
				runId,
				ownerPid: process.pid,
				ownerProcessUuid: this.processUuid,
				claimedAt: new Date().toISOString(),
			}),
			value: { id, runId, generation: this.generation },
		}));
	}
	attachExecutionAgent(id: number, runId: string, agentId: string): void {
		if (!this.current) throw new Error("Todo controller is no longer current");
		this.repository.mutate((state) => ({
			state: attachExecutionAgent(state, id, runId, agentId),
			value: undefined,
		}));
	}
	recoverStaleProjectRun(id: number, runId: string, isDead?: (pid: number) => boolean) {
		if (!(this.repository instanceof ProjectTodoRepository)) return false;
		return recoverStaleClaim(this.repository, id, runId, isDead);
	}
	settle(id: number, runId: string, generation: number, result?: string, error?: string) {
		if (!this.current || generation !== this.generation) return false;
		return this.repository.mutate((s) => {
			const todo = s.todos.find((item) => item.id === id);
			if (todo?.execution?.runId !== runId) return { state: s, value: false };
			return {
				state: settleExecution(s, id, runId, result, error),
				value: true,
			};
		});
	}
}
