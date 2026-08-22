import { randomUUID } from "node:crypto";
import type { ExecutionClaim, Todo, TodoInput, TodoState, TodoUpdate, TodoView } from "./types.js";

export const TODOS_STATE_ENTRY = "apple-pi.todos-state";
export const TODO_PROCESS_UUID = randomUUID();

export const createTodoState = (): TodoState => ({ nextId: 1, todos: [] });

function copyState(state: TodoState): TodoState {
	return structuredClone(state);
}

function text(value: string | undefined, name: string, max: number, oneLine = false): string {
	const normalized = (value ?? "").trim();
	if (name === "title" && !normalized) throw new Error("Todo title is required");
	if (normalized.length > max) throw new Error(`Todo ${name} must be at most ${max} characters`);
	if (oneLine && /[\r\n]/.test(normalized)) throw new Error(`Todo ${name} must be one line`);
	return normalized;
}

function isTimestamp(value: string): boolean {
	return !Number.isNaN(Date.parse(value));
}

function assertState(state: TodoState): void {
	if (!Number.isInteger(state.nextId) || state.nextId < 1 || !Array.isArray(state.todos)) {
		throw new Error("Invalid todo state");
	}
	const ids = new Set(state.todos.map((todo) => todo.id));
	if (ids.size !== state.todos.length || state.todos.some((todo) => !Number.isInteger(todo.id) || todo.id < 1)) {
		throw new Error("Invalid todo IDs");
	}
	if (state.nextId <= Math.max(0, ...ids)) throw new Error("Todo nextId is not monotonic");

	for (const todo of state.todos) {
		if (
			!["open", "active", "completed"].includes(todo.status) ||
			typeof todo.title !== "string" ||
			!todo.title ||
			todo.title.length > 160 ||
			/[\r\n]/.test(todo.title) ||
			(todo.activeForm !== undefined &&
				(typeof todo.activeForm !== "string" || todo.activeForm.length > 160 || /[\r\n]/.test(todo.activeForm))) ||
			typeof todo.description !== "string" ||
			todo.description.length > 2_000 ||
			!Array.isArray(todo.blockedBy) ||
			typeof todo.createdAt !== "string" ||
			!isTimestamp(todo.createdAt) ||
			typeof todo.updatedAt !== "string" ||
			!isTimestamp(todo.updatedAt) ||
			(todo.agentType !== undefined && typeof todo.agentType !== "string") ||
			(todo.agentProfile !== undefined && typeof todo.agentProfile !== "string") ||
			(todo.result !== undefined && (typeof todo.result !== "string" || todo.result.length > 10_000)) ||
			(todo.lastError !== undefined && (typeof todo.lastError !== "string" || todo.lastError.length > 2_000))
		) {
			throw new Error("Invalid todo record");
		}
		if (
			todo.execution &&
			(typeof todo.execution.runId !== "string" ||
				!todo.execution.runId ||
				(todo.execution.agentId !== undefined &&
					(typeof todo.execution.agentId !== "string" || !todo.execution.agentId)) ||
				!Number.isSafeInteger(todo.execution.ownerPid) ||
				todo.execution.ownerPid < 1 ||
				typeof todo.execution.ownerProcessUuid !== "string" ||
				!todo.execution.ownerProcessUuid ||
				typeof todo.execution.claimedAt !== "string" ||
				!isTimestamp(todo.execution.claimedAt))
		) {
			throw new Error("Invalid execution claim");
		}
		if (todo.execution && todo.status !== "active") throw new Error("Execution claim requires an active todo");
		if (new Set(todo.blockedBy).size !== todo.blockedBy.length) throw new Error("Duplicate dependency");
		for (const dependency of todo.blockedBy) {
			if (!Number.isInteger(dependency) || dependency === todo.id) throw new Error("A todo cannot depend on itself");
			if (!ids.has(dependency)) throw new Error(`Todo dependency #${dependency} not found`);
		}
		if (
			todo.status === "active" &&
			todo.blockedBy.some((id) => state.todos.find((item) => item.id === id)?.status !== "completed")
		) {
			throw new Error("Active todo has unresolved blockers");
		}
	}
	const byId = new Map(state.todos.map((todo) => [todo.id, todo]));
	const visiting = new Set<number>();
	const visited = new Set<number>();
	const visit = (id: number): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) throw new Error("Todo dependencies cannot contain a cycle");
		visiting.add(id);
		for (const dependency of byId.get(id)!.blockedBy) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const todo of state.todos) visit(todo.id);
}

export function parseTodoState(state: TodoState): TodoState {
	const copy = copyState(state);
	assertState(copy);
	return copy;
}

export function todoViews(state: TodoState): TodoView[] {
	const valid = parseTodoState(state);
	return valid.todos.map((todo) => ({
		...todo,
		blocked:
			todo.status === "open" &&
			todo.blockedBy.some((id) => valid.todos.find((item) => item.id === id)?.status !== "completed"),
		blocks: valid.todos.filter((item) => item.blockedBy.includes(todo.id)).map((item) => item.id),
	}));
}

export function createTodo(state: TodoState, input: TodoInput, now = new Date()): { state: TodoState; todo: Todo } {
	const valid = parseTodoState(state);
	const timestamp = now.toISOString();
	const todo: Todo = {
		id: valid.nextId,
		title: text(input.title, "title", 160, true),
		description: text(input.description, "description", 2_000),
		status: "open",
		blockedBy: [...(input.blockedBy ?? [])],
		...(input.activeForm ? { activeForm: text(input.activeForm, "active form", 160, true) } : {}),
		createdAt: timestamp,
		updatedAt: timestamp,
		...(input.agentType ? { agentType: text(input.agentType, "agent type", 80, true) } : {}),
		...(input.agentProfile ? { agentProfile: text(input.agentProfile, "agent profile", 80, true) } : {}),
	};
	const next = { nextId: valid.nextId + 1, todos: [...valid.todos, todo] };
	return { state: parseTodoState(next), todo };
}

export function updateTodo(state: TodoState, id: number, input: TodoUpdate, now = new Date()): TodoState {
	const valid = parseTodoState(state);
	const previous = valid.todos.find((todo) => todo.id === id);
	if (!previous) throw new Error(`Todo #${id} not found`);
	if (previous.execution) throw new Error(`Todo #${id} has managed execution; use settlement or recovery`);
	const nextTodo: Todo = {
		...previous,
		...(input.status ? { status: input.status } : {}),
		...(input.title !== undefined ? { title: text(input.title, "title", 160, true) } : {}),
		...(input.description !== undefined ? { description: text(input.description, "description", 2_000) } : {}),
		...(input.activeForm !== undefined
			? {
					activeForm: text(input.activeForm, "active form", 160, true) || undefined,
				}
			: {}),
		...(input.blockedBy !== undefined ? { blockedBy: [...input.blockedBy] } : {}),
		...(input.agentType !== undefined
			? {
					agentType: input.agentType ? text(input.agentType, "agent type", 80, true) : undefined,
				}
			: {}),
		...(input.agentProfile !== undefined
			? {
					agentProfile: input.agentProfile ? text(input.agentProfile, "agent profile", 80, true) : undefined,
				}
			: {}),
		...(input.result !== undefined ? { result: text(input.result, "result", 10_000) } : {}),
		...(input.lastError !== undefined ? { lastError: text(input.lastError, "last error", 2_000) } : {}),
		updatedAt: now.toISOString(),
	};
	if (input.agentType === "") delete nextTodo.agentType;
	if (input.agentProfile === "") delete nextTodo.agentProfile;
	if (input.activeForm === "") delete nextTodo.activeForm;
	return parseTodoState({
		nextId: valid.nextId,
		todos: valid.todos.map((todo) => (todo.id === id ? nextTodo : todo)),
	});
}

export function deleteTodo(state: TodoState, id: number): TodoState {
	const valid = parseTodoState(state);
	const todo = valid.todos.find((item) => item.id === id);
	if (!todo) throw new Error(`Todo #${id} not found`);
	if (todo.execution) throw new Error(`Todo #${id} has managed execution; use settlement or recovery`);
	const managedDependent = valid.todos.find((item) => item.blockedBy.includes(id) && item.execution);
	if (managedDependent) {
		throw new Error(
			`Todo #${id} is a prerequisite of managed todo #${managedDependent.id}; use settlement or recovery`,
		);
	}
	return parseTodoState({
		nextId: valid.nextId,
		todos: valid.todos
			.filter((item) => item.id !== id)
			.map((item) => ({
				...item,
				blockedBy: item.blockedBy.filter((dependency) => dependency !== id),
			})),
	});
}

export function claimExecution(
	state: TodoState,
	id: number,
	claim: ExecutionClaim = {
		runId: randomUUID(),
		ownerPid: process.pid,
		ownerProcessUuid: TODO_PROCESS_UUID,
		claimedAt: new Date().toISOString(),
	},
): TodoState {
	const valid = parseTodoState(state);
	const todo = valid.todos.find((item) => item.id === id);
	if (!todo) throw new Error(`Todo #${id} not found`);
	if (todo.execution) throw new Error(`Todo #${id} already has an execution claim`);
	if (todo.status !== "open") throw new Error(`Todo #${id} must be open before execution`);
	const next = {
		...todo,
		status: "active" as const,
		execution: claim,
		updatedAt: new Date().toISOString(),
	};
	return parseTodoState({
		nextId: valid.nextId,
		todos: valid.todos.map((item) => (item.id === id ? next : item)),
	});
}

export function attachExecutionAgent(state: TodoState, id: number, runId: string, agentId: string): TodoState {
	const valid = parseTodoState(state);
	const todo = valid.todos.find((item) => item.id === id);
	if (!todo || todo.execution?.runId !== runId) return valid;
	const next = { ...todo, execution: { ...todo.execution, agentId }, updatedAt: new Date().toISOString() };
	return parseTodoState({
		nextId: valid.nextId,
		todos: valid.todos.map((item) => (item.id === id ? next : item)),
	});
}

export function settleExecution(
	state: TodoState,
	id: number,
	runId: string,
	result?: string,
	error?: string,
): TodoState {
	const valid = parseTodoState(state);
	const todo = valid.todos.find((item) => item.id === id);
	if (!todo || todo.execution?.runId !== runId) return valid;
	const next: Todo = {
		...todo,
		status: error ? ("open" as const) : ("completed" as const),
		execution: undefined,
		updatedAt: new Date().toISOString(),
	};
	if (error) {
		next.lastError = text(error, "last error", 2_000);
		delete next.result;
	} else {
		next.result = text(result ?? "", "result", 10_000);
		delete next.lastError;
	}
	return parseTodoState({
		nextId: valid.nextId,
		todos: valid.todos.map((item) => (item.id === id ? next : item)),
	});
}

export function restoreTodoState(entries: readonly unknown[]): TodoState {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as {
			type?: string;
			customType?: string;
			data?: TodoState;
		};
		if (entry?.type === "custom" && entry.customType === TODOS_STATE_ENTRY)
			return parseTodoState(entry.data as TodoState);
	}
	return createTodoState();
}
