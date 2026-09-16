import type { ChildProcess } from "node:child_process";
import { OutputBuffer } from "./output-buffer.js";
import { killProcessTree } from "./process-killer.js";
import type { BackgroundTask } from "./types.js";

export interface CreateTaskOptions {
	detachedByOperator?: boolean;
	initialText?: string;
}

export class TaskManager {
	private nextId = 1;
	private readonly tasks = new Map<string, BackgroundTask>();
	private readonly finishListeners = new Set<(task: BackgroundTask) => void>();

	createTask(command: string, cwd: string, child: ChildProcess, options: CreateTaskOptions = {}): BackgroundTask {
		const id = `task-${this.nextId++}`;
		const pid = child.pid ?? 0;
		const output = new OutputBuffer({
			initialText: options.initialText,
			tempFilePrefix: `pi-${id}`,
		});

		const task: BackgroundTask = {
			id,
			command,
			cwd,
			pid,
			startedAt: Date.now(),
			status: "running",
			output,
			detachedByOperator: options.detachedByOperator,
		};

		this.tasks.set(id, task);

		// Pipe stdout & stderr to output buffer
		child.stdout?.on("data", (chunk: Buffer) => {
			output.append(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			output.append(chunk);
		});

		let settled = false;
		let exitCode: number | null = null;
		let graceTimer: NodeJS.Timeout | undefined;

		const finalize = (code: number | null) => {
			if (settled) return;
			settled = true;
			if (graceTimer) {
				clearTimeout(graceTimer);
				graceTimer = undefined;
			}
			task.endedAt = Date.now();
			task.exitCode = code;
			if (task.status === "running") {
				task.status = code === 0 ? "completed" : "failed";
			}
			task.output.finish();

			for (const listener of this.finishListeners) {
				try {
					listener(task);
				} catch {
					// Listener error must not affect other listeners
				}
			}
		};

		child.once("error", (err) => {
			task.output.append(`\nProcess error: ${err.message}\n`);
			finalize(-1);
		});

		child.once("exit", (code) => {
			exitCode = code;
			// Allow up to 100ms grace period for pipes to drain
			graceTimer = setTimeout(() => finalize(exitCode), 100);
		});

		child.once("close", (code) => {
			finalize(code ?? exitCode);
		});

		return task;
	}

	get(taskId: string): BackgroundTask | undefined {
		return this.tasks.get(taskId);
	}

	list(): BackgroundTask[] {
		return Array.from(this.tasks.values());
	}

	kill(taskId: string): { success: boolean; message: string } {
		const task = this.tasks.get(taskId);
		if (!task) {
			return { success: false, message: `Task '${taskId}' not found.` };
		}
		if (task.status !== "running") {
			return { success: false, message: `Task '${taskId}' is not running (status: ${task.status}).` };
		}

		task.status = "killed";
		task.endedAt = Date.now();
		if (task.pid > 0) {
			killProcessTree(task.pid);
		}
		task.output.finish();

		return {
			success: true,
			message: `Task '${taskId}' (PID ${task.pid}) was killed.`,
		};
	}

	async waitFor(taskId: string, timeoutMs: number): Promise<BackgroundTask | undefined> {
		const task = this.tasks.get(taskId);
		if (!task) return undefined;
		if (task.status !== "running") return task;

		return new Promise<BackgroundTask>((resolve) => {
			let timer: NodeJS.Timeout | undefined;

			const unsubscribe = this.onTaskFinished((finishedTask) => {
				if (finishedTask.id === taskId) {
					cleanup();
					resolve(finishedTask);
				}
			});

			const cleanup = () => {
				if (timer) {
					clearTimeout(timer);
					timer = undefined;
				}
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

	killAll(): void {
		for (const task of this.tasks.values()) {
			if (task.status === "running") {
				task.status = "killed";
				task.endedAt = Date.now();
				if (task.pid > 0) {
					killProcessTree(task.pid);
				}
				task.output.finish();
			}
		}
	}

	cleanupAll(): void {
		for (const task of this.tasks.values()) {
			task.output.cleanup();
		}
	}

	onTaskFinished(listener: (task: BackgroundTask) => void): () => void {
		this.finishListeners.add(listener);
		return () => {
			this.finishListeners.delete(listener);
		};
	}
}
