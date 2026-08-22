import type { TodosConfig, TodoView } from "./types.js";

const DEFAULT_DELAY_TURNS = 4;

/** Turn-based cleanup state. Storage mutation stays with the controller. */
export class AutoClear {
	private turn = 0;
	private completedAt = new Map<number, number>();
	private allCompletedAt: number | undefined;
	private runEnded = false;

	constructor(private delayTurns = DEFAULT_DELAY_TURNS) {}

	observe(todos: readonly TodoView[], config: Required<TodosConfig>, isSessionStorage: boolean): void {
		if (!isSessionStorage || config.autoClearCompleted === "never") {
			this.completedAt.clear();
			this.allCompletedAt = undefined;
			return;
		}
		const present = new Set(todos.map((todo) => todo.id));
		for (const id of this.completedAt.keys()) if (!present.has(id)) this.completedAt.delete(id);
		for (const todo of todos) {
			if (todo.status === "completed") {
				if (!this.completedAt.has(todo.id)) this.completedAt.set(todo.id, this.turn);
			} else {
				this.completedAt.delete(todo.id);
			}
		}
		if (todos.length > 0 && todos.every((todo) => todo.status === "completed")) this.allCompletedAt ??= this.turn;
		else this.allCompletedAt = undefined;
	}

	onTurnStart(mode: Required<TodosConfig>["autoClearCompleted"]): number[] {
		this.turn++;
		if (mode === "on_todo_complete")
			return [...this.completedAt]
				.filter(([, completedAt]) => this.turn - completedAt >= this.delayTurns)
				.map(([id]) => id);
		if (
			mode === "on_list_complete" &&
			this.allCompletedAt !== undefined &&
			this.turn - this.allCompletedAt >= this.delayTurns
		)
			return [...this.completedAt.keys()];
		return [];
	}

	onRunEnded(): void {
		this.runEnded = true;
	}

	shouldRetireCompletedBatch(todos: readonly TodoView[], mode: Required<TodosConfig>["autoClearCompleted"]): boolean {
		const retire =
			this.runEnded && mode !== "never" && todos.length > 0 && todos.every((todo) => todo.status === "completed");
		this.runEnded = false;
		return retire;
	}

	reset(): void {
		this.turn = 0;
		this.completedAt.clear();
		this.allCompletedAt = undefined;
		this.runEnded = false;
	}
}
