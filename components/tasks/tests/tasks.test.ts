import { spawn } from "node:child_process";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import { createBackgroundTaskBashTool, createExecBashToolDefinition } from "../src/bash-tool.js";
import installTasks from "../src/index.js";
import { OutputBuffer } from "../src/output-buffer.js";
import { TaskManager } from "../src/task-manager.js";
import { createTaskManagementTool } from "../src/task-tool.js";
import { scheduleParameters, TASK_NOTIFICATION_CUSTOM_TYPE } from "../src/types.js";

describe("tasks component", () => {
	const activeManagers: TaskManager[] = [];

	afterEach(() => {
		for (const manager of activeManagers) {
			manager.cancelAll();
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
			expect(finishedTask?.kind).toBe("command");
			if (finishedTask?.kind === "command") {
				expect(finishedTask.exitCode).toBe(0);
				expect(finishedTask.output.getSnapshot().content).toContain("hello world");
			}
		});

		it("handles non-zero exit codes as failed", async () => {
			const manager = createManager();
			const child = spawn(process.execPath, ["-e", "process.exit(42);"]);
			const task = manager.createTask("node fail", process.cwd(), child);

			const finishedTask = await manager.waitFor(task.id, 5000);
			expect(finishedTask?.status).toBe("failed");
			expect(finishedTask?.kind).toBe("command");
			if (finishedTask?.kind === "command") expect(finishedTask.exitCode).toBe(42);
		});

		it("schedules commands without starting them before they are due", async () => {
			const manager = createManager();
			const start = vi.fn(() => spawn(process.execPath, ["-e", "console.log('scheduled command');"]));
			const task = manager.scheduleCommand("node scheduled", process.cwd(), 25, start);

			expect(task.status).toBe("scheduled");
			expect(task.pid).toBeUndefined();
			expect(start).not.toHaveBeenCalled();

			const finishedTask = await manager.waitFor(task.id, 5000);
			expect(start).toHaveBeenCalledTimes(1);
			expect(finishedTask?.status).toBe("completed");
			if (finishedTask?.kind === "command") {
				expect(finishedTask.output.getSnapshot().content).toContain("scheduled command");
			}
		});

		it("marks prompts due until their delivery is confirmed", async () => {
			const manager = createManager();
			const due = vi.fn();
			manager.onPromptDue(due);
			const task = manager.schedulePrompt("Continue after settlement.", 0);

			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(due).toHaveBeenCalledWith(task);
			expect(task.status).toBe("due");

			expect(manager.markPromptDelivered(task.id)).toBe(true);
			expect(task.status).toBe("delivered");
		});

		it("cancels scheduled and running work", async () => {
			const manager = createManager();
			const scheduled = manager.schedulePrompt("Do not deliver.", 60_000);
			const scheduledResult = manager.cancel(scheduled.id);
			expect(scheduledResult.success).toBe(true);
			expect(scheduled.status).toBe("cancelled");

			const start = vi.fn(() => spawn(process.execPath, ["-e", "process.exit(0)"]));
			const command = manager.scheduleCommand("node later", process.cwd(), 20, start);
			expect(manager.cancel(command.id).success).toBe(true);
			await new Promise((resolve) => setTimeout(resolve, 40));
			expect(start).not.toHaveBeenCalled();

			const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
			const running = manager.createTask("node endless", process.cwd(), child);
			const runningResult = manager.cancel(running.id);
			expect(runningResult.success).toBe(true);
			expect(running.status).toBe("cancelled");
		});
	});

	describe("schedule schema", () => {
		it("accepts exactly one prompt or command with a non-negative delay", () => {
			expect(Value.Check(scheduleParameters, { delay_seconds: 0, prompt: "Continue." })).toBe(true);
			expect(Value.Check(scheduleParameters, { delay_seconds: 1, command: "npm test" })).toBe(true);
			expect(Value.Check(scheduleParameters, { delay_seconds: 0 })).toBe(false);
			expect(Value.Check(scheduleParameters, { delay_seconds: 0, prompt: "Continue.", command: "npm test" })).toBe(
				false,
			);
			expect(Value.Check(scheduleParameters, { delay_seconds: -1, prompt: "Continue." })).toBe(false);
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

		it("passes stdin to foreground commands", async () => {
			const manager = createManager();
			const bashTool = createBackgroundTaskBashTool(manager);

			const result = await bashTool.execute(
				"call-stdin-fg",
				{
					command:
						"node -e \"let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => console.log('received:' + d));\"",
					stdin: "piped foreground input",
				},
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);

			expect(getResultText(result)).toContain("received:piped foreground input");
		});

		it("passes stdin to background commands", async () => {
			const manager = createManager();
			const bashTool = createBackgroundTaskBashTool(manager);

			const result = await bashTool.execute(
				"call-stdin-bg",
				{
					command:
						"node -e \"let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => console.log('bg received:' + d));\"",
					stdin: "piped bg input",
					run_in_background: true,
				},
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);

			expect(result.details?.backgrounded).toBe(true);
			const task = await manager.waitFor("task-1", 5000);
			expect(task?.status).toBe("completed");
			expect(task?.kind).toBe("command");
			if (task?.kind === "command") expect(task.output.getSnapshot().content).toContain("bg received:piped bg input");
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
			expect(task?.kind).toBe("command");
			if (task?.kind === "command") expect(task.output.getSnapshot().content).toContain("bg finished");
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
			expect(task?.kind).toBe("command");
			if (task?.kind === "command") expect(task.output.getSnapshot().content).toContain("late output");
		});

		it("terminates foreground command and throws when aborted", async () => {
			const manager = createManager();
			const bashTool = createBackgroundTaskBashTool(manager);
			const controller = new AbortController();

			const executePromise = bashTool.execute(
				"call-abort",
				{ command: "node -e \"setTimeout(() => console.log('not printed'), 2000);\"" },
				controller.signal,
				undefined,
				{ cwd: process.cwd() } as any,
			);

			setTimeout(() => controller.abort(), 50);

			await expect(executePromise).rejects.toThrow("Command aborted");
		});
	});

	describe("task management tool", () => {
		it("lists, gets status, and cancels managed tasks", async () => {
			const manager = createManager();
			const taskTool = createTaskManagementTool(manager);

			// Initially empty
			const emptyList = await taskTool.execute("call-list-1", { action: "list" }, undefined, undefined, {} as any);
			expect(getResultText(emptyList)).toBe("No managed tasks found.");

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

			// Cancel action
			const child2 = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
			const task2 = manager.createTask("node endless", process.cwd(), child2);

			const cancelResult = await taskTool.execute(
				"call-cancel-1",
				{
					action: "cancel",
					task_id: task2.id,
				},
				undefined,
				undefined,
				{} as any,
			);
			expect(getResultText(cancelResult)).toContain(`Task '${task2.id}' was cancelled.`);
			expect(task2.status).toBe("cancelled");
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
			expect(registeredTools.some((t) => t.name === "schedule")).toBe(true);
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

		it("delivers due prompts once after the active run settles", async () => {
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

			for (const handler of eventHandlers.get("before_agent_start") ?? []) handler();
			const scheduleTool = registeredTools.find((tool) => tool.name === "schedule");
			const result = await scheduleTool.execute(
				"schedule-prompt",
				{ delay_seconds: 0, prompt: "Run the focused test." },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			await scheduleTool.execute(
				"schedule-second-prompt",
				{ delay_seconds: 0, prompt: "Then inspect the diff." },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			expect(getResultText(result)).toContain("task-1");
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(sentMessages).toHaveLength(0);

			for (const handler of eventHandlers.get("agent_settled") ?? []) handler();
			expect(sentMessages).toHaveLength(1);
			expect(sentMessages[0].msg.content).toContain("Run the focused test.");
			expect(sentMessages[0].msg.content).toContain("Then inspect the diff.");
			expect(sentMessages[0].msg.content).toMatch(/own deferred prompts/i);
			expect(sentMessages[0].msg.content).toMatch(/not new operator authority/i);
			expect(sentMessages[0].opts).toEqual({ deliverAs: "followUp", triggerTurn: true });
		});

		it("starts scheduled commands and wakes only after completion", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const handlers = new Map<string, any[]>();
			installTasks({
				registerTool: (tool: any) => registeredTools.push(tool),
				registerMessageRenderer: vi.fn(),
				sendMessage: (msg: any, opts: any) => sentMessages.push({ msg, opts }),
				on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			} as any);

			const scheduleTool = registeredTools.find((tool) => tool.name === "schedule");
			await scheduleTool.execute(
				"schedule-command",
				{ delay_seconds: 0.02, command: "node -e \"console.log('scheduled wake');\"" },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			expect(sentMessages).toHaveLength(0);
			await new Promise((resolve) => setTimeout(resolve, 300));
			const notification = sentMessages.find((message) => message.msg.customType === TASK_NOTIFICATION_CUSTOM_TYPE);
			expect(notification?.msg.content).toContain("scheduled wake");
			expect(notification?.opts).toEqual({ deliverAs: "followUp", triggerTurn: true });
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

	describe("createExecBashToolDefinition", () => {
		it("excludes run_in_background and verbatim from parameter schema", () => {
			const tool = createExecBashToolDefinition();
			const props = (tool.parameters as any).properties;
			expect(props.command).toBeDefined();
			expect(props.timeout).toBeDefined();
			expect(props.stdin).toBeDefined();
			expect(props.run_in_background).toBeUndefined();
			expect(props.verbatim).toBeUndefined();
		});

		it("does not mention backgrounding or verbatim in guidelines and description", () => {
			const tool = createExecBashToolDefinition();
			expect(tool.description).not.toContain("run_in_background");
			expect(tool.description).not.toContain("Ctrl+B");
			expect(tool.promptSnippet).not.toContain("background");
			for (const guideline of tool.promptGuidelines ?? []) {
				expect(guideline).not.toContain("run_in_background");
				expect(guideline).not.toContain("Ctrl+B");
				expect(guideline).not.toContain("verbatim");
			}
		});

		it("executes commands directly without backgrounding support", async () => {
			const tool = createExecBashToolDefinition();
			const result = await tool.execute(
				"call-exec",
				{ command: "node -e \"console.log('direct output');\"" },
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);
			const text = getResultText(result);
			expect(text).toContain("direct output");
			expect(result.details?.backgrounded).toBeUndefined();
			expect(result.details?.rtk).toBe(false);
		});
	});
});
