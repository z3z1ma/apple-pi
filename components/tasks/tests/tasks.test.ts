import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import { createBackgroundTaskBashTool } from "../src/bash-tool.js";
import installTasks from "../src/index.js";
import { OutputBuffer } from "../src/output-buffer.js";
import { TaskManager } from "../src/task-manager.js";
import { createTaskManagementTool } from "../src/task-tool.js";
import { TASK_NOTIFICATION_CUSTOM_TYPE } from "../src/types.js";

describe("tasks component", () => {
	const activeManagers: TaskManager[] = [];

	afterEach(() => {
		for (const manager of activeManagers) {
			manager.killAll();
			manager.cleanupAll();
		}
		activeManagers.length = 0;
	});

	function createManager(): TaskManager {
		const manager = new TaskManager();
		activeManagers.push(manager);
		return manager;
	}

	function getResultText(result: { content: { type: string; text?: string }[] }): string {
		const first = result.content[0];
		return first && first.type === "text" ? (first.text ?? "") : "";
	}

	describe("OutputBuffer", () => {
		it("accumulates text and produces snapshots", () => {
			const buffer = new OutputBuffer({ maxBytes: 1024, maxLines: 100 });
			buffer.append("line 1\n");
			buffer.append("line 2\n");
			const snapshot = buffer.getSnapshot();
			expect(snapshot.content).toBe("line 1\nline 2\n");
			expect(snapshot.totalLines).toBe(2);
			expect(snapshot.truncated).toBe(false);
		});

		it("truncates head when capacity is exceeded and saves full output", () => {
			const buffer = new OutputBuffer({ maxBytes: 50, maxLines: 5 });
			for (let i = 1; i <= 20; i++) {
				buffer.append(`line ${i} with extra text\n`);
			}
			const snapshot = buffer.getSnapshot();
			expect(snapshot.truncated).toBe(true);
			expect(snapshot.fullOutputPath).toBeDefined();
			expect(snapshot.content).toContain("line 20");
			buffer.cleanup();
		});
	});

	describe("TaskManager", () => {
		it("tracks process lifecycle and exit codes", async () => {
			const manager = createManager();
			const child = spawn(process.execPath, ["-e", "console.log('hello world'); process.exit(0);"]);
			const task = manager.createTask("node hello", process.cwd(), child);

			expect(task.status).toBe("running");
			expect(manager.get(task.id)).toBe(task);
			expect(manager.list()).toHaveLength(1);

			const finishedTask = await manager.waitFor(task.id, 5000);
			expect(finishedTask?.status).toBe("completed");
			expect(finishedTask?.exitCode).toBe(0);
			expect(finishedTask?.output.getSnapshot().content).toContain("hello world");
		});

		it("handles non-zero exit codes as failed", async () => {
			const manager = createManager();
			const child = spawn(process.execPath, ["-e", "process.exit(42);"]);
			const task = manager.createTask("node fail", process.cwd(), child);

			const finishedTask = await manager.waitFor(task.id, 5000);
			expect(finishedTask?.status).toBe("failed");
			expect(finishedTask?.exitCode).toBe(42);
		});

		it("kills running processes and process trees", async () => {
			const manager = createManager();
			const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
			const task = manager.createTask("node endless", process.cwd(), child);

			const result = manager.kill(task.id);
			expect(result.success).toBe(true);
			expect(task.status).toBe("killed");
		});
	});

	describe("bash tool", () => {
		it("runs foreground commands to completion", async () => {
			const manager = createManager();
			const bashTool = createBackgroundTaskBashTool(manager);

			const result = await bashTool.execute(
				"call-1",
				{ command: "node -e \"console.log('foreground output')\"" },
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);

			expect(getResultText(result)).toContain("foreground output");
		});

		it("starts commands in background when run_in_background is true", async () => {
			const manager = createManager();
			const bashTool = createBackgroundTaskBashTool(manager);

			const result = await bashTool.execute(
				"call-2",
				{
					command: "node -e \"setTimeout(() => console.log('bg finished'), 200);\"",
					run_in_background: true,
				},
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);

			expect(getResultText(result)).toContain("Command started in background as task-1");
			expect(result.details?.backgrounded).toBe(true);
			expect(result.details?.taskId).toBe("task-1");

			// The task should continue running in the background and eventually complete
			const task = await manager.waitFor("task-1", 5000);
			expect(task?.status).toBe("completed");
			expect(task?.output.getSnapshot().content).toContain("bg finished");
		});

		it("detaches foreground command when operator inputs Ctrl+B", async () => {
			const manager = createManager();
			const bashTool = createBackgroundTaskBashTool(manager);

			let terminalInputHandler: ((data: string) => any) | undefined;
			const mockUi = {
				onTerminalInput: (handler: (data: string) => any) => {
					terminalInputHandler = handler;
					return () => {
						terminalInputHandler = undefined;
					};
				},
				notify: vi.fn(),
			};

			// Start a command that runs for 2 seconds
			const executePromise = bashTool.execute(
				"call-3",
				{ command: "node -e \"console.log('early output'); setTimeout(() => console.log('late output'), 500);\"" },
				undefined,
				undefined,
				{ cwd: process.cwd(), ui: mockUi } as any,
			);

			// Allow child process to start and register terminal listener
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(terminalInputHandler).toBeDefined();

			// Operator presses Ctrl+B (\x02)
			const res = terminalInputHandler!("\x02");
			expect(res?.consume).toBe(true);

			const result = await executePromise;
			expect(getResultText(result)).toContain("Command backgrounded by operator (Ctrl+B)");
			expect(result.details?.backgrounded).toBe(true);
			expect(result.details?.taskId).toBe("task-1");
			expect(mockUi.notify).toHaveBeenCalledWith("Backgrounded command (task-1)", "info");

			// Ensure the process continues in background and finishes
			const task = await manager.waitFor("task-1", 5000);
			expect(task?.status).toBe("completed");
			expect(task?.output.getSnapshot().content).toContain("late output");
		});
	});

	describe("task management tool", () => {
		it("lists, gets status, and kills background tasks", async () => {
			const manager = createManager();
			const taskTool = createTaskManagementTool(manager);

			// Initially empty
			const emptyList = await taskTool.execute("call-list-1", { action: "list" }, undefined, undefined, {} as any);
			expect(getResultText(emptyList)).toBe("No background tasks found.");

			// Spawn a task
			const child = spawn(process.execPath, ["-e", "setTimeout(() => console.log('done'), 150);"]);
			const task = manager.createTask("node -e 'done'", process.cwd(), child);

			// List tasks
			const listResult = await taskTool.execute("call-list-2", { action: "list" }, undefined, undefined, {} as any);
			expect(getResultText(listResult)).toContain(task.id);
			expect(getResultText(listResult)).toContain("running");

			// Check status with wait_seconds
			const statusResult = await taskTool.execute(
				"call-status-1",
				{
					action: "status",
					task_id: task.id,
					wait_seconds: 2,
				},
				undefined,
				undefined,
				{} as any,
			);
			expect(getResultText(statusResult)).toContain(`Task: ${task.id}`);
			expect(getResultText(statusResult)).toContain("Status: completed");
			expect(getResultText(statusResult)).toContain("done");

			// Kill action
			const child2 = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
			const task2 = manager.createTask("node endless", process.cwd(), child2);

			const killResult = await taskTool.execute(
				"call-kill-1",
				{
					action: "kill",
					task_id: task2.id,
				},
				undefined,
				undefined,
				{} as any,
			);
			expect(getResultText(killResult)).toContain(`Task '${task2.id}' (PID ${task2.pid}) was killed.`);
			expect(task2.status).toBe("killed");
		});
	});

	describe("extension installation & reactive wake-up", () => {
		it("sends reactive wake-up message when background task finishes", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const eventHandlers = new Map<string, any[]>();

			const mockPi = {
				registerTool: (tool: any) => registeredTools.push(tool),
				registerMessageRenderer: vi.fn(),
				sendMessage: (msg: any, opts: any) => sentMessages.push({ msg, opts }),
				on: (event: string, handler: any) => {
					const list = eventHandlers.get(event) ?? [];
					list.push(handler);
					eventHandlers.set(event, list);
				},
			};

			installTasks(mockPi as any);

			expect(registeredTools.some((t) => t.name === "bash")).toBe(true);
			expect(registeredTools.some((t) => t.name === "task")).toBe(true);

			const bashTool = registeredTools.find((t) => t.name === "bash");
			await bashTool.execute(
				"call-bg",
				{ command: "node -e \"console.log('wake me up!');\"", run_in_background: true },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);

			// Wait for task to finish and send message
			await new Promise((resolve) => setTimeout(resolve, 300));

			expect(sentMessages.length).toBeGreaterThanOrEqual(1);
			const notification = sentMessages.find((m) => m.msg.customType === TASK_NOTIFICATION_CUSTOM_TYPE);
			expect(notification).toBeDefined();
			expect(notification.msg.content).toContain('<task-notification id="task-1" status="completed">');
			expect(notification.msg.content).toContain("wake me up!");
			expect(notification.opts).toEqual({ deliverAs: "followUp", triggerTurn: true });

			// Shutdown cleanup
			const shutdownHandlers = eventHandlers.get("session_shutdown") ?? [];
			for (const h of shutdownHandlers) h();
		});

		it("skips installation in child sessions", () => {
			const registeredTools: any[] = [];
			const mockPi = {
				registerTool: (tool: any) => registeredTools.push(tool),
				registerMessageRenderer: vi.fn(),
				sendMessage: vi.fn(),
				on: vi.fn(),
			};

			runInChildSessionContext(() => {
				installTasks(mockPi as any);
			});

			expect(registeredTools.length).toBe(0);
		});
	});
});
