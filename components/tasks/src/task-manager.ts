import type { ChildProcess } from "node:child_process";
import { OutputBuffer } from "./output-buffer.js";
import { killProcessTree } from "./process-killer.js";
import type { CommandTask, ManagedTask, PromptTask } from "./types.js";

export interface CreateTaskOptions {
	detachedByOperator?: boolean;
	initialText?: string;
}

interface TaskControl {
	child?: ChildProcess;
	timer?: NodeJS.Timeout;
	graceTimer?: NodeJS.Timeout;
	settled: boolean;
}

const isActive = (task: ManagedTask): boolean =>
	task.status === "scheduled" || task.status === "due" || task.status === "running";

export class TaskManager {
	private nextId = 1;
	private readonly tasks = new Map<string, ManagedTask>();
	private readonly controls = new Map<string, TaskControl>();
	private readonly finishListeners = new Set<(task: ManagedTask) => void>();
	private readonly promptDueListeners = new Set<(task: PromptTask) => void>();

	createTask(command: string, cwd: string, child: ChildProcess, options: CreateTaskOptions = {}): CommandTask {
		const now = Date.now();
		const task = this.createCommandRecord(command, cwd, now, {
			...options,
			startedAt: now,
			status: "running",
			pid: child.pid,
		});
		const control: TaskControl = { child, settled: false };
		this.controls.set(task.id, control);
		this.attachChild(task, child, control);
		return task;
	}

	scheduleCommand(command: string, cwd: string, delayMs: number, start: () => ChildProcess): CommandTask {
		const now = Date.now();
		const dueAt = now + delayMs;
		const task = this.createCommandRecord(command, cwd, dueAt, { status: "scheduled" });
		const control: TaskControl = { settled: false };
		control.timer = setTimeout(() => {
			control.timer = undefined;
			if (control.settled || task.status !== "scheduled") return;
			task.status = "running";
			task.startedAt = Date.now();
			try {
				const child = start();
				control.child = child;
				task.pid = child.pid;
				this.attachChild(task, child, control);
			} catch (error) {
				task.output.append(`Process error: ${error instanceof Error ? error.message : String(error)}\n`);
				task.exitCode = -1;
				task.status = "failed";
				task.endedAt = Date.now();
				task.output.finish();
				control.settled = true;
				this.emitFinished(task);
			}
		}, delayMs);
		this.controls.set(task.id, control);
		return task;
	}

	schedulePrompt(prompt: string, delayMs: number): PromptTask {
		const now = Date.now();
		const task: PromptTask = {
			id: this.allocateId(),
			kind: "prompt",
			prompt,
			createdAt: now,
			dueAt: now + delayMs,
			status: "scheduled",
		};
		const control: TaskControl = { settled: false };
		control.timer = setTimeout(() => {
			control.timer = undefined;
			if (control.settled || task.status !== "scheduled") return;
			task.status = "due";
			for (const listener of this.promptDueListeners) {
				try {
					listener(task);
				} catch {
					// One listener must not prevent another from observing a due prompt.
				}
			}
		}, delayMs);
		this.tasks.set(task.id, task);
		this.controls.set(task.id, control);
		return task;
	}

	markPromptDelivered(taskId: string): boolean {
		const task = this.tasks.get(taskId);
		const control = this.controls.get(taskId);
		if (task?.kind !== "prompt" || task.status !== "due" || !control || control.settled) return false;
		control.settled = true;
		task.status = "delivered";
		task.endedAt = Date.now();
		this.emitFinished(task);
		return true;
	}

	get(taskId: string): ManagedTask | undefined {
		return this.tasks.get(taskId);
	}

	list(): ManagedTask[] {
		return Array.from(this.tasks.values());
	}

	cancel(taskId: string): { success: boolean; message: string } {
		const task = this.tasks.get(taskId);
		const control = this.controls.get(taskId);
		if (!task || !control) {
			return { success: false, message: `Task '${taskId}' not found.` };
		}
		if (!isActive(task) || control.settled) {
			return { success: false, message: `Task '${taskId}' is not active (status: ${task.status}).` };
		}

		if (control.timer) {
			clearTimeout(control.timer);
			control.timer = undefined;
		}
		control.settled = true;
		task.status = "cancelled";
		task.endedAt = Date.now();
		if (control.child?.pid) killProcessTree(control.child.pid);
		if (task.kind === "command") task.output.finish();
		this.emitFinished(task);
		return { success: true, message: `Task '${taskId}' was cancelled.` };
	}

	async waitFor(taskId: string, timeoutMs: number): Promise<ManagedTask | undefined> {
		const task = this.tasks.get(taskId);
		if (!task) return undefined;
		if (!isActive(task)) return task;

		return new Promise<ManagedTask>((resolve) => {
			let timer: NodeJS.Timeout | undefined;
			const unsubscribe = this.onTaskFinished((finishedTask) => {
				if (finishedTask.id === taskId) {
					cleanup();
					resolve(finishedTask);
				}
			});
			const cleanup = () => {
				if (timer) clearTimeout(timer);
				unsubscribe();
			};
			if (timeoutMs > 0) {
				timer = setTimeout(() => {
					cleanup();
					resolve(task);
				}, timeoutMs);
			}
		});
	}

	cancelAll(): void {
		for (const task of this.tasks.values()) {
			if (isActive(task)) this.cancel(task.id);
		}
	}

	cleanupAll(): void {
		for (const task of this.tasks.values()) {
			if (task.kind === "command") task.output.cleanup();
		}
	}

	onTaskFinished(listener: (task: ManagedTask) => void): () => void {
		this.finishListeners.add(listener);
		return () => {
			this.finishListeners.delete(listener);
		};
	}

	onPromptDue(listener: (task: PromptTask) => void): () => void {
		this.promptDueListeners.add(listener);
		return () => {
			this.promptDueListeners.delete(listener);
		};
	}

	private allocateId(): string {
		return `task-${this.nextId++}`;
	}

	private createCommandRecord(
		command: string,
		cwd: string,
		dueAt: number,
		options: CreateTaskOptions & {
			status: CommandTask["status"];
			startedAt?: number;
			pid?: number;
		},
	): CommandTask {
		const task: CommandTask = {
			id: this.allocateId(),
			kind: "command",
			command,
			cwd,
			createdAt: Date.now(),
			dueAt,
			startedAt: options.startedAt,
			pid: options.pid,
			status: options.status,
			output: new OutputBuffer({
				initialText: options.initialText,
				tempFilePrefix: `pi-task`,
			}),
			detachedByOperator: options.detachedByOperator,
		};
		this.tasks.set(task.id, task);
		return task;
	}

	private attachChild(task: CommandTask, child: ChildProcess, control: TaskControl): void {
		child.stdout?.on("data", (chunk: Buffer) => task.output.append(chunk));
		child.stderr?.on("data", (chunk: Buffer) => task.output.append(chunk));
		let exitCode: number | null = null;

		const finalize = (code: number | null) => {
			if (control.settled) return;
			control.settled = true;
			if (control.graceTimer) {
				clearTimeout(control.graceTimer);
				control.graceTimer = undefined;
			}
			task.endedAt = Date.now();
			task.exitCode = code;
			if (task.status === "running") task.status = code === 0 ? "completed" : "failed";
			task.output.finish();
			this.emitFinished(task);
		};

		child.once("error", (error) => {
			task.output.append(`\nProcess error: ${error.message}\n`);
			finalize(-1);
		});
		child.once("exit", (code) => {
			exitCode = code;
			control.graceTimer = setTimeout(() => finalize(exitCode), 100);
		});
		child.once("close", (code) => finalize(code ?? exitCode));
	}

	private emitFinished(task: ManagedTask): void {
		for (const listener of this.finishListeners) {
			try {
				listener(task);
			} catch {
				// Listener errors must not affect other listeners.
			}
		}
	}
}
