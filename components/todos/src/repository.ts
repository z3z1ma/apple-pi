import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTodoState, parseTodoState, restoreTodoState } from "./state.js";
import type { TodoState } from "./types.js";
export interface TodoRepository {
	read(): TodoState;
	write(state: TodoState): void;
	mutate<T>(fn: (state: TodoState) => { state: TodoState; value: T }): T;
}
const clone = (s: TodoState) => JSON.parse(JSON.stringify(s)) as TodoState;
export class SessionTodoRepository implements TodoRepository {
	constructor(
		private state: TodoState = createTodoState(),
		private beforeCommit?: (state: TodoState) => void,
	) {}
	read() {
		return clone(this.state);
	}
	write(state: TodoState) {
		const valid = parseTodoState(state);
		this.beforeCommit?.(valid);
		this.state = valid;
	}
	mutate<T>(fn: (state: TodoState) => { state: TodoState; value: T }) {
		const result = fn(this.read());
		this.write(result.state);
		return result.value;
	}
	restore(entries: readonly unknown[], processUuid?: string) {
		const restored = restoreTodoState(entries);
		this.state =
			processUuid === undefined
				? restored
				: parseTodoState({
						nextId: restored.nextId,
						todos: restored.todos.map((todo) =>
							todo.execution &&
							(todo.execution.ownerProcessUuid === processUuid || isProcessDead(todo.execution.ownerPid))
								? {
										...todo,
										status: "open",
										execution: undefined,
										lastError: "Recovered interrupted session execution",
										updatedAt: new Date().toISOString(),
									}
								: todo,
						),
					});
		return this.read();
	}
}
/** True only when the OS positively reports that the PID no longer exists. */
export function isProcessDead(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error: unknown) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}
export function isProcessLive(pid: number): boolean {
	return !isProcessDead(pid);
}
export class ProjectTodoRepository implements TodoRepository {
	readonly filePath: string;
	private lockPath: string;
	private recoveryLockPath: string;
	constructor(cwd: string) {
		this.filePath = join(cwd, ".pi", "todos", "shared.json");
		this.lockPath = `${this.filePath}.lock`;
		this.recoveryLockPath = `${this.lockPath}.recovery`;
	}
	private readFile() {
		if (!existsSync(this.filePath)) return createTodoState();
		const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as TodoState;
		return parseTodoState(raw);
	}
	read() {
		return clone(this.readFile());
	}
	private acquire() {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const token = `${process.pid}:${randomUUID()}`;
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				writeFileSync(this.lockPath, token, { flag: "wx" });
				return token;
			} catch (error: unknown) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				this.recoverDeadLock();
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
			}
		}
		throw new Error("Failed to acquire todos project lock");
	}
	private recoverDeadLock(): void {
		const recoveryToken = `${process.pid}:${randomUUID()}`;
		try {
			writeFileSync(this.recoveryLockPath, recoveryToken, { flag: "wx" });
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
			throw error;
		}
		try {
			let current: string;
			try {
				current = readFileSync(this.lockPath, "utf8");
			} catch {
				return;
			}
			const ownerPid = Number.parseInt(current, 10);
			if (ownerPid > 0 && isProcessDead(ownerPid)) unlinkSync(this.lockPath);
		} finally {
			this.releasePath(this.recoveryLockPath, recoveryToken);
		}
	}
	private releasePath(path: string, token: string): void {
		try {
			if (readFileSync(path, "utf8") === token) unlinkSync(path);
		} catch {}
	}
	private release(token: string) {
		this.releasePath(this.lockPath, token);
	}
	write(state: TodoState) {
		const valid = parseTodoState(state);
		const token = this.acquire();
		try {
			this.atomicWrite(valid);
		} finally {
			this.release(token);
		}
	}
	private atomicWrite(state: TodoState) {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const tmp = join(dirname(this.filePath), `.shared.${process.pid}.${randomUUID()}.tmp`);
		try {
			writeFileSync(tmp, JSON.stringify(state, null, 2));
			renameSync(tmp, this.filePath);
		} finally {
			if (existsSync(tmp))
				try {
					unlinkSync(tmp);
				} catch {}
		}
	}
	mutate<T>(fn: (state: TodoState) => { state: TodoState; value: T }) {
		const token = this.acquire();
		try {
			const result = fn(clone(this.readFile()));
			this.atomicWrite(parseTodoState(result.state));
			return result.value;
		} finally {
			this.release(token);
		}
	}
}
export function recoverStaleClaim(
	repository: ProjectTodoRepository,
	id: number,
	runId: string,
	isDead = isProcessDead,
): boolean {
	return repository.mutate((state) => {
		const todo = state.todos.find((t) => t.id === id);
		if (!todo || todo.execution?.runId !== runId || !isDead(todo.execution.ownerPid)) return { state, value: false };
		return {
			state: {
				...state,
				todos: state.todos.map((t) =>
					t.id === id
						? {
								...t,
								status: "open",
								execution: undefined,
								lastError: "Recovered stale execution claim",
								updatedAt: new Date().toISOString(),
							}
						: t,
				),
			},
			value: true,
		};
	});
}
