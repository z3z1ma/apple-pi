import { spawn } from "node:child_process";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import { createTaskActiveWorkSource } from "../src/active-work.js";
import { createBackgroundTaskBashTool, createExecBashToolDefinition } from "../src/bash-tool.js";
import installTasks from "../src/index.js";
import { createMonitorTool } from "../src/monitor-tool.js";
import { OutputBuffer } from "../src/output-buffer.js";
import { createScheduleTool } from "../src/schedule-tool.js";
import { TaskManager } from "../src/task-manager.js";
import { createTaskManagementTool } from "../src/task-tool.js";
import {
	MONITOR_EVENT_CUSTOM_TYPE,
	monitorParameters,
	scheduleParameters,
	TASK_NOTIFICATION_CUSTOM_TYPE,
} from "../src/types.js";

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
		it("publishes prompt creation, due, delivery, and cancellation lifecycle changes", async () => {
			vi.useFakeTimers();
			const manager = createManager();
			const changes: Array<{ id: string; status: string }> = [];
			manager.onTaskChanged((task) => changes.push({ id: task.id, status: task.status }));

			const delivered = manager.schedulePrompt("Continue.", 100);
			const cancelled = manager.schedulePrompt("Cancel me.", 500);
			expect(changes).toContainEqual({ id: delivered.id, status: "scheduled" });
			expect(changes).toContainEqual({ id: cancelled.id, status: "scheduled" });

			await vi.advanceTimersByTimeAsync(100);
			expect(changes).toContainEqual({ id: delivered.id, status: "due" });
			manager.markPromptDelivered(delivered.id);
			expect(changes).toContainEqual({ id: delivered.id, status: "delivered" });
			manager.cancel(cancelled.id);
			expect(changes).toContainEqual({ id: cancelled.id, status: "cancelled" });
			vi.useRealTimers();
		});

		it("resets all active and settled records at a session boundary", () => {
			const manager = createManager();
			const settled = manager.schedulePrompt("Old session", 60_000);
			manager.cancel(settled.id);
			manager.schedulePrompt("Still active", 60_000);
			expect(manager.list()).toHaveLength(2);

			manager.reset();

			expect(manager.list()).toEqual([]);
		});

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

		it("emits completed stdout lines from monitors without treating stderr or fragments as events", async () => {
			const manager = createManager();
			const events: string[] = [];
			manager.onMonitorEvent((event) => events.push(event.line));
			const child = spawn(process.execPath, [
				"-e",
				"process.stdout.write('first\\npartial'); process.stderr.write('stderr\\n'); setTimeout(() => process.stdout.write(' rest\\nunterminated'), 20);",
			]);
			const task = manager.createMonitor("node monitor", process.cwd(), () => child);

			await manager.waitFor(task.id, 5000);
			expect(events).toEqual(["first", "partial rest"]);
			expect(task.output.getSnapshot().content).toContain("stderr");
			expect(task.output.getSnapshot().content).toContain("unterminated");
		});

		it("silences a monitor after its caller-owned event limit", async () => {
			const manager = createManager();
			const events: Array<{ line: string; reachedLimit: boolean }> = [];
			manager.onMonitorEvent((event) => events.push({ line: event.line, reachedLimit: event.reachedLimit }));
			const child = spawn(process.execPath, ["-e", "process.stdout.write('one\\ntwo\\nthree\\n');"]);
			const task = manager.createMonitor("node monitor", process.cwd(), () => child, 2);

			await manager.waitFor(task.id, 5000);
			expect(events).toEqual([
				{ line: "one", reachedLimit: false },
				{ line: "two", reachedLimit: true },
			]);
			expect(task.monitor).toMatchObject({ maxEvents: 2, deliveredEvents: 2, muted: true });
			expect(task.output.getSnapshot().content).toContain("three");
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

	describe("active-work projection", () => {
		it("renders active prompt, command, and monitor state and excludes settled tasks", () => {
			const manager = createManager();
			const prompt = manager.schedulePrompt("Recheck the release branch\nwithout adding a widget line", 60_000);
			const command = manager.scheduleCommand("npm test", "/project", 60_000, () => {
				throw new Error("not due");
			});
			const monitor = manager.createMonitor(
				"tail -F app.log",
				"/project",
				() => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
				2,
			);
			const source = createTaskActiveWorkSource(manager);
			const entries = source.getEntries();
			const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
			const rendered = entries.flatMap((entry) => entry.render(72, theme, "⠋"));
			const text = rendered.join("\n");

			expect(entries.map((entry) => entry.id)).toEqual([prompt.id, command.id, monitor.id]);
			expect(text).toContain("Prompt");
			expect(text).toContain("due in");
			expect(text).toContain("Command");
			expect(text).toContain("Monitor");
			expect(text).toContain("events 0/2");
			for (const line of rendered) {
				expect(line).not.toContain("\n");
				expect(visibleWidth(line)).toBeLessThanOrEqual(72);
			}

			manager.cancel(prompt.id);
			expect(source.getEntries().map((entry) => entry.id)).not.toContain(prompt.id);
		});
	});

	describe("monitor and schedule schemas", () => {
		it("accepts a command with an optional positive event limit", () => {
			expect(Value.Check(monitorParameters, { command: "tail -F app.log" })).toBe(true);
			expect(Value.Check(monitorParameters, { command: "tail -F app.log", max_events: 5 })).toBe(true);
			expect(Value.Check(monitorParameters, { command: "tail -F app.log", max_events: 0 })).toBe(false);
			expect(Value.Check(monitorParameters, { command: "tail -F app.log", max_events: 1.5 })).toBe(false);
		});

		it("keeps the provider schema structural and Bedrock-compatible", () => {
			expect(scheduleParameters).not.toHaveProperty("oneOf");
			expect(Value.Check(scheduleParameters, { delay_seconds: 0, prompt: "Continue." })).toBe(true);
			expect(Value.Check(scheduleParameters, { delay_seconds: 1, command: "npm test" })).toBe(true);
			expect(Value.Check(scheduleParameters, { delay_seconds: 0 })).toBe(true);
			expect(Value.Check(scheduleParameters, { delay_seconds: 0, prompt: "Continue.", command: "npm test" })).toBe(
				true,
			);
			expect(Value.Check(scheduleParameters, { delay_seconds: -1, prompt: "Continue." })).toBe(false);
		});

		it("enforces exactly one prompt or command at execution time", async () => {
			const tool = createScheduleTool(createManager());
			const context = { cwd: process.cwd() } as any;
			await expect(tool.execute("missing", { delay_seconds: 0 }, undefined, undefined, context)).rejects.toThrow(
				"schedule requires exactly one prompt or command",
			);
			await expect(
				tool.execute(
					"both",
					{ delay_seconds: 0, prompt: "Continue.", command: "npm test" },
					undefined,
					undefined,
					context,
				),
			).rejects.toThrow("schedule requires exactly one prompt or command");
		});
	});

	describe("monitor tool", () => {
		it("starts a verbatim managed command and returns its task ID", async () => {
			const manager = createManager();
			const monitorTool = createMonitorTool(manager);
			const result = await monitorTool.execute(
				"call-monitor",
				{ command: "node -e \"console.log('event')\"", max_events: 1 },
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);

			expect(getResultText(result)).toContain("Monitor started as task-1");
			expect(result.details).toMatchObject({ taskId: "task-1", status: "running", maxEvents: 1 });
			expect((await manager.waitFor("task-1", 5000))?.status).toBe("completed");
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

		it("labels monitors and cancelled prompts accurately", async () => {
			const manager = createManager();
			const taskTool = createTaskManagementTool(manager);
			const monitor = manager.createMonitor(
				"node monitor",
				process.cwd(),
				() => spawn(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]),
				2,
			);
			const list = await taskTool.execute("list", { action: "list" }, undefined, undefined, {} as any);
			expect(getResultText(list)).toContain("monitor");
			const status = await taskTool.execute(
				"status",
				{ action: "status", task_id: monitor.id },
				undefined,
				undefined,
				{} as any,
			);
			expect(getResultText(status)).toContain("Kind: monitor");
			expect(getResultText(status)).toContain("Monitor Events: 0/2");
			manager.cancel(monitor.id);

			const prompt = manager.schedulePrompt("Do not deliver", 60_000);
			manager.cancel(prompt.id);
			const promptStatus = await taskTool.execute(
				"prompt-status",
				{ action: "status", task_id: prompt.id },
				undefined,
				undefined,
				{} as any,
			);
			expect(getResultText(promptStatus)).toContain("Cancelled:");
			expect(getResultText(promptStatus)).not.toContain("Delivered:");
		});
	});

	describe("extension installation & reactive wake-up", () => {
		it("publishes active task counts and rows above the editor without terminal input interception", async () => {
			const registeredTools: any[] = [];
			const commands = new Map<string, any>();
			const handlers = new Map<string, any[]>();
			const setStatus = vi.fn();
			const setWidget = vi.fn();
			const terminalInput = vi.fn();
			installTasks({
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: (name: string, command: any) => commands.set(name, command),
				registerMessageRenderer: vi.fn(),
				sendMessage: vi.fn(),
				on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			} as any);
			let overlayCall = 0;
			const custom = vi.fn(async (factory: any) => {
				overlayCall++;
				let result: any;
				const component = factory(
					{ terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
					undefined,
					(value: any) => {
						result = value;
					},
				);
				component.handleInput(overlayCall === 1 ? "\r" : "q");
				component.dispose();
				return result;
			});
			const ctx = {
				cwd: process.cwd(),
				hasUI: true,
				ui: { custom, setStatus, setWidget, onTerminalInput: terminalInput },
			};
			for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
			const schedule = registeredTools.find((tool) => tool.name === "schedule");
			const task = registeredTools.find((tool) => tool.name === "task");

			await schedule.execute("schedule", { delay_seconds: 60, prompt: "Continue later" }, undefined, undefined, ctx);
			expect(setStatus).toHaveBeenCalledWith("tasks", "tasks:1");
			expect(setWidget).toHaveBeenCalledWith("active-work", expect.any(Function), { placement: "aboveEditor" });
			expect(terminalInput).not.toHaveBeenCalled();
			await commands.get("tasks").handler("", ctx);
			expect(custom).toHaveBeenCalledTimes(3);
			expect(terminalInput).not.toHaveBeenCalled();

			await task.execute("cancel", { action: "cancel", task_id: "task-1" }, undefined, undefined, ctx);
			expect(setStatus).toHaveBeenLastCalledWith("tasks", undefined);
			for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
		});

		it("sends reactive wake-up message when background task finishes", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const eventHandlers = new Map<string, any[]>();

			const mockPi = {
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: vi.fn(),
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
			expect(registeredTools.some((t) => t.name === "monitor")).toBe(true);
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

		it("steers once per monitor stdout line and still follows up on completion", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const handlers = new Map<string, any[]>();
			installTasks({
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: vi.fn(),
				registerMessageRenderer: vi.fn(),
				sendMessage: (msg: any, opts: any) => sentMessages.push({ msg, opts }),
				on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			} as any);

			const monitorTool = registeredTools.find((tool) => tool.name === "monitor");
			await monitorTool.execute(
				"monitor",
				{
					command: "node -e \"console.log('first'); console.log('second'); console.error('diagnostic')\"",
					max_events: 2,
				},
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			await new Promise((resolve) => setTimeout(resolve, 300));

			const events = sentMessages.filter((message) => message.msg.customType === MONITOR_EVENT_CUSTOM_TYPE);
			expect(events).toHaveLength(2);
			expect(events.map((message) => message.msg.details.line)).toEqual(["first", "second"]);
			expect(events[0].opts).toEqual({ deliverAs: "steer", triggerTurn: true });
			expect(events[1].msg.content).toMatch(/continue silently/i);
			expect(events.some((message) => message.msg.content.includes("diagnostic"))).toBe(false);
			const completion = sentMessages.find((message) => message.msg.customType === TASK_NOTIFICATION_CUSTOM_TYPE);
			expect(completion?.opts).toEqual({ deliverAs: "followUp", triggerTurn: true });
			expect(completion?.msg.details.monitor).toBe(true);

			for (const handler of handlers.get("session_shutdown") ?? []) handler();
		});

		it("delivers due prompts once after the active run settles", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const eventHandlers = new Map<string, any[]>();
			const mockPi = {
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: vi.fn(),
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
				registerCommand: vi.fn(),
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
