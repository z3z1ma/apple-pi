import type { TodoView } from "./types.js";

export const TODO_REMINDER_CUSTOM_TYPE = "apple-pi.todos-reminder";
const MAX_REMINDER_TODOS = 10;
const MAX_REMINDER_CHARS = 1_200;

function clean(value: string): string {
	return value
		.replace(/<\/?system-reminder>/gi, "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Session-local cadence; it is deliberately neither persisted nor shared. */
export class ReminderCadence {
	private idleTurns = 0;
	private due = false;

	noteTodoTool(): void {
		this.idleTurns = 0;
		this.due = false;
	}

	onTurnEnd(hasActiveTodo: boolean): void {
		this.idleTurns++;
		if (this.idleTurns >= (hasActiveTodo ? 2 : 4)) this.due = true;
	}

	consume(todos: readonly TodoView[], enabled: boolean): string | undefined {
		if (!enabled || !this.due) return undefined;
		this.due = false;
		this.idleTurns = 0;
		const actionable = todos
			.filter((todo) => todo.status !== "completed")
			.sort((left, right) => {
				const rank = (todo: TodoView) => (todo.status === "active" ? 0 : todo.blocked ? 2 : 1);
				return rank(left) - rank(right) || left.id - right.id;
			});
		if (actionable.length === 0)
			return "No active execution to-dos are recorded. Use todo_create only when a multi-step checklist would help; do not duplicate backlog or Ledger work.";
		const shown = actionable.slice(0, MAX_REMINDER_TODOS);
		const rows = shown.map((todo) => {
			const blocker = todo.blocked ? ` (blocked by #${todo.blockedBy.join(", #")})` : "";
			return `#${todo.id} [${todo.status}] ${clean(todo.title)}${blocker}`;
		});
		let text = `Active execution checklist (not durable Ledger authority):\n${rows.join("\n")}`;
		if (actionable.length > shown.length) text += "\n… additional to-dos omitted.";
		return text.slice(0, MAX_REMINDER_CHARS);
	}

	reset(): void {
		this.idleTurns = 0;
		this.due = false;
	}
}
