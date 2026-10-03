import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeCustom, fakeTui } from "../../../tests/helpers/fake-tui.js";
import { installWorkManager } from "../../shared/src/work-manager.js";
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
			manager.reset();
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
			expect(Value.Check(scheduleParameters, { delay_seconds: 30 * 24 * 60 * 60, prompt: "Next month." })).toBe(false);
		});

		it("does not schedule a command after its call was interrupted", async () => {
			const manager = createManager();
			const controller = new AbortController();
			controller.abort();

			await expect(
				createScheduleTool(manager).execute(
					"cancelled-schedule",
					{ delay_seconds: 60, command: "echo should-not-run" },
					controller.signal,
					undefined,
					{ cwd: process.cwd() } as any,
				),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(manager.list()).toHaveLength(0);
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

		it("reports a surprise only when the predicted exit status misses", async () => {
			const bashTool = createBackgroundTaskBashTool(createManager());
			const run = (command: string, expect: "success" | "failure") =>
				bashTool.execute("call-expect", { command, expect }, undefined, undefined, { cwd: process.cwd() } as any);
			const pass = "node -e \"console.log('ran')\"";
			const fail = 'node -e "process.exit(3)"';

			expect(getResultText(await run(pass, "success"))).not.toContain("Surprise");
			await expect(run(fail, "failure")).rejects.toThrow(/exited with code 3$/);
			expect(getResultText(await run(pass, "failure"))).toMatch(
				/ran\n+Surprise: you predicted this command would fail\.$/,
			);
			await expect(run(fail, "success")).rejects.toThrow(
				/exited with code 3\n\nSurprise: you predicted this command would succeed\.$/,
			);

			const passed = await run(pass, "failure");
			expect(passed.details?.surprise).toBe(true);
			const background = await bashTool.execute(
				"call-expect-bg",
				{ command: pass, expect: "failure", run_in_background: true },
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);
			expect(getResultText(background)).not.toContain("Surprise");
			expect(background.details?.surprise).toBeUndefined();
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

		it("interrupts a status wait without cancelling the managed task", async () => {
			const manager = createManager();
			const taskTool = createTaskManagementTool(manager);
			const task = manager.schedulePrompt("Still scheduled", 60_000);
			const controller = new AbortController();
			const removeListener = vi.spyOn(controller.signal, "removeEventListener");
			const wait = taskTool.execute(
				"wait-status",
				{ action: "status", task_id: task.id, wait_seconds: 30 },
				controller.signal,
				undefined,
				{} as any,
			);
			const outcome = wait.then(
				() => "resolved",
				() => "aborted",
			);

			controller.abort();
			expect(
				await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 50))]),
			).toBe("aborted");
			expect(task.status).toBe("scheduled");
			expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
		});

		it("rejects a status wait if already interrupted", async () => {
			const manager = createManager();
			const task = manager.schedulePrompt("Still scheduled", 60_000);
			const controller = new AbortController();
			controller.abort();

			await expect(
				createTaskManagementTool(manager).execute(
					"wait-status",
					{ action: "status", task_id: task.id, wait_seconds: 30 },
					controller.signal,
					undefined,
					{} as any,
				),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(task.status).toBe("scheduled");
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
		it("publishes active task UI and steers the main agent when the work panel cancels work", async () => {
			const registeredTools: any[] = [];
			const commands = new Map<string, any>();
			const handlers = new Map<string, any[]>();
			const setStatus = vi.fn();
			const setWidget = vi.fn();
			const terminalInput = vi.fn();
			const sendMessage = vi.fn();
			const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
			const pi = {
				events: {
					on: (channel: string, handler: (data: unknown) => void) => {
						const listeners = eventHandlers.get(channel) ?? new Set();
						listeners.add(handler);
						eventHandlers.set(channel, listeners);
						return () => listeners.delete(handler);
					},
					emit: (channel: string, data: unknown) => {
						for (const listener of eventHandlers.get(channel) ?? []) listener(data);
					},
				},
				registerTool: (tool: any) => registeredTools.push(tool),
				registerShortcut: vi.fn(),
				registerCommand: (name: string, command: any) => commands.set(name, command),
				registerMessageRenderer: vi.fn(),
				sendMessage,
				on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			};
			installWorkManager(pi as any);
			installTasks(pi as any);
			const screen = fakeTui(160, 40);
			const { custom } = fakeCustom(screen);
			const ctx = {
				cwd: process.cwd(),
				hasUI: true,
				mode: "tui",
				ui: { custom, setStatus, setWidget, onTerminalInput: terminalInput },
			};
			for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
			const bashTool = registeredTools.find((tool) => tool.name === "bash");

			await bashTool.execute(
				"background-command",
				{ command: 'node -e "setInterval(() => {}, 1000);"', run_in_background: true },
				undefined,
				undefined,
				ctx,
			);
			expect(setStatus).toHaveBeenCalledWith("tasks", "tasks:1");
			expect(setWidget).toHaveBeenCalledWith("active-work", expect.any(Function), { placement: "aboveEditor" });
			expect(terminalInput).not.toHaveBeenCalled();
			await commands.get("tasks").handler("", ctx);
			// The panel opens directly on the Tasks tab with the task's detail inline.
			const panel = screen.stack[0]!.component;
			const rendered = () => screen.layout(screen.stack[0]!).lines.join("\n");
			expect(rendered()).toContain("[Tasks · 1]");
			expect(rendered()).toContain("Command: node");
			expect(rendered()).toContain("x cancel");
			panel.handleInput("x");
			panel.handleInput("x");
			panel.handleInput("q");
			expect(screen.stack).toHaveLength(0);
			expect(custom).toHaveBeenCalledTimes(1);
			expect(terminalInput).not.toHaveBeenCalled();
			expect(setStatus).toHaveBeenLastCalledWith("tasks", undefined);
			expect(sendMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					customType: TASK_NOTIFICATION_CUSTOM_TYPE,
					content: expect.stringContaining('<task-notification id="task-1" status="cancelled">'),
				}),
				{ deliverAs: "steer", triggerTurn: true },
			);
			for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
		});

		it("steers the main agent when a background task fails", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const eventHandlers = new Map<string, any[]>();

			const mockPi = {
				events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
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
				{ command: "node -e \"console.log('wake me up!'); process.exitCode = 3;\"", run_in_background: true },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);

			// Wait for task to finish and send message
			await new Promise((resolve) => setTimeout(resolve, 300));

			expect(sentMessages.length).toBeGreaterThanOrEqual(1);
			const notification = sentMessages.find((m) => m.msg.customType === TASK_NOTIFICATION_CUSTOM_TYPE);
			expect(notification).toBeDefined();
			expect(notification.msg.content).toContain('<task-notification id="task-1" status="failed">');
			expect(notification.msg.content).toContain("wake me up!");
			expect(notification.opts).toEqual({ deliverAs: "steer", triggerTurn: true });

			// Shutdown cleanup
			const shutdownHandlers = eventHandlers.get("session_shutdown") ?? [];
			for (const h of shutdownHandlers) h();
		});

		it("steers once per monitor stdout line and again on completion", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const handlers = new Map<string, any[]>();
			installTasks({
				events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
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
			expect(completion?.opts).toEqual({ deliverAs: "steer", triggerTurn: true });
			expect(completion?.msg.details.monitor).toBe(true);

			for (const handler of handlers.get("session_shutdown") ?? []) handler();
		});

		it("steers each prompt into an active run as soon as it is due", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const handlers = new Map<string, any[]>();
			installTasks({
				events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: vi.fn(),
				registerMessageRenderer: vi.fn(),
				sendMessage: (msg: any, opts: any) => sentMessages.push({ msg, opts }),
				on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			} as any);
			for (const handler of handlers.get("agent_start") ?? []) handler();
			const scheduleTool = registeredTools.find((tool) => tool.name === "schedule");
			const taskTool = registeredTools.find((tool) => tool.name === "task");
			const context = { cwd: process.cwd() };
			await scheduleTool.execute(
				"prompt",
				{ delay_seconds: 0.02, prompt: "Run the focused test." },
				undefined,
				undefined,
				context,
			);

			await scheduleTool.execute(
				"second-prompt",
				{ delay_seconds: 0.02, prompt: "Then inspect the diff." },
				undefined,
				undefined,
				context,
			);

			const statuses = await Promise.all(
				["task-1", "task-2"].map((task_id) =>
					taskTool.execute("wait", { action: "status", task_id, wait_seconds: 5 }, undefined, undefined, context),
				),
			);

			expect(statuses.map((status) => status.details.status)).toEqual(["delivered", "delivered"]);
			expect(sentMessages).toHaveLength(2);
			expect(sentMessages[0].msg.content).toContain('<scheduled-prompt id="task-1">');
			expect(sentMessages[0].msg.content).toContain("Run the focused test.");
			expect(sentMessages[1].msg.content).toContain('<scheduled-prompt id="task-2">');
			expect(sentMessages[1].msg.content).toContain("Then inspect the diff.");
			expect(sentMessages[1].msg.content).not.toContain("Run the focused test.");
			expect(sentMessages[0].msg.content).toMatch(/own deferred prompt/i);
			expect(sentMessages[0].msg.content).toMatch(/not new operator authority/i);
			expect(sentMessages[0].opts).toEqual({ deliverAs: "steer", triggerTurn: true });
		});

		it("discards active work without notifications at a session boundary", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const handlers = new Map<string, any[]>();
			installTasks({
				events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: vi.fn(),
				registerMessageRenderer: vi.fn(),
				sendMessage: (msg: any, opts: any) => sentMessages.push({ msg, opts }),
				on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			} as any);
			const scheduleTool = registeredTools.find((tool) => tool.name === "schedule");
			const bashTool = registeredTools.find((tool) => tool.name === "bash");
			const context = { cwd: process.cwd() };
			await scheduleTool.execute("prompt", { delay_seconds: 60, prompt: "Later." }, undefined, undefined, context);
			await bashTool.execute(
				"background",
				{ command: 'node -e "setInterval(() => {}, 1000);"', run_in_background: true },
				undefined,
				undefined,
				context,
			);

			for (const handler of handlers.get("session_before_fork") ?? []) handler();
			await new Promise((resolve) => setTimeout(resolve, 300));

			expect(sentMessages).toEqual([]);
			for (const handler of handlers.get("session_shutdown") ?? []) handler();
		});

		it("rejects delays beyond the platform timer range", async () => {
			const manager = createManager();
			await expect(
				createScheduleTool(manager).execute(
					"too-late",
					{ delay_seconds: 30 * 24 * 60 * 60, prompt: "Next month." },
					undefined,
					undefined,
					{ cwd: process.cwd() } as any,
				),
			).rejects.toThrow("delay_seconds");
			expect(manager.list()).toEqual([]);
		});

		it("starts scheduled commands and wakes only after completion", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			const handlers = new Map<string, any[]>();
			installTasks({
				events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
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
			expect(notification?.opts).toEqual({ deliverAs: "steer", triggerTurn: true });
		});

		it("steers once when a scheduled prompt is cancelled", async () => {
			const registeredTools: any[] = [];
			const sentMessages: any[] = [];
			installTasks({
				events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
				registerTool: (tool: any) => registeredTools.push(tool),
				registerCommand: vi.fn(),
				registerMessageRenderer: vi.fn(),
				sendMessage: (msg: any, opts: any) => sentMessages.push({ msg, opts }),
				on: vi.fn(),
			} as any);
			const scheduleTool = registeredTools.find((tool) => tool.name === "schedule");
			const taskTool = registeredTools.find((tool) => tool.name === "task");
			await scheduleTool.execute(
				"schedule-prompt",
				{ delay_seconds: 60, prompt: "Do not run this." },
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			await taskTool.execute("cancel-prompt", { action: "cancel", task_id: "task-1" }, undefined, undefined, {
				cwd: process.cwd(),
			});

			expect(sentMessages).toHaveLength(1);
			expect(sentMessages[0].msg).toMatchObject({
				customType: TASK_NOTIFICATION_CUSTOM_TYPE,
				details: { taskId: "task-1", kind: "prompt", status: "cancelled", prompt: "Do not run this." },
			});
			expect(sentMessages[0].opts).toEqual({ deliverAs: "steer", triggerTurn: true });
		});

		it("reopens task detail at its last scroll position or live tail without session persistence", async () => {
			const release = join(mkdtempSync(join(tmpdir(), "apple-pi-tasks-")), "release");
			const install = () => {
				const registeredTools: any[] = [];
				const commands = new Map<string, any>();
				const handlers = new Map<string, any[]>();
				const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
				const pi = {
					events: {
						on: (channel: string, handler: (data: unknown) => void) => {
							const listeners = eventHandlers.get(channel) ?? new Set();
							listeners.add(handler);
							eventHandlers.set(channel, listeners);
							return () => listeners.delete(handler);
						},
						emit: (channel: string, data: unknown) => {
							for (const listener of eventHandlers.get(channel) ?? []) listener(data);
						},
					},
					registerTool: (tool: any) => registeredTools.push(tool),
					registerShortcut: vi.fn(),
					registerCommand: (name: string, command: any) => commands.set(name, command),
					registerMessageRenderer: vi.fn(),
					sendMessage: vi.fn(),
					appendEntry: vi.fn(),
					on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
				};
				installWorkManager(pi as any);
				installTasks(pi as any);
				const detailRenders: string[] = [];
				const detailScripts: string[][] = [];
				const screen = fakeTui(160, 40);
				const { custom } = fakeCustom(screen);
				// Each /tasks opening renders task-1's inline detail, runs one script, then closes the panel.
				const openTasks = async () => {
					await commands.get("tasks").handler("", ctx);
					const entry = screen.stack[0]!;
					detailRenders.push(screen.layout(entry).lines.join("\n"));
					for (const input of detailScripts.shift() ?? []) {
						entry.component.handleInput(input);
						screen.layout(entry);
					}
					entry.component.handleInput("q");
				};
				const ctx = {
					cwd: process.cwd(),
					hasUI: true,
					mode: "tui",
					ui: { custom, setStatus: vi.fn(), setWidget: vi.fn() },
				};
				for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
				const tool = (name: string) => registeredTools.find((candidate) => candidate.name === name);
				const status = async () =>
					getResultText(
						await tool("task").execute("status", { action: "status", task_id: "task-1" }, undefined, undefined, ctx),
					);
				const shutdown = () => {
					for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
				};
				return { pi, commands, ctx, tool, status, detailRenders, detailScripts, shutdown, openTasks };
			};
			const script = `for (let i = 0; i < 60; i++) console.log("line " + i); const fs = require("fs"); const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) { for (let j = 0; j < 5; j++) console.log("late" + " tail " + j); clearInterval(t); setInterval(() => {}, 1000); } }, 20);`;
			const start = async (session: ReturnType<typeof install>) => {
				await session
					.tool("bash")
					.execute(
						"background",
						{ command: `node -e ${JSON.stringify(script)}`, run_in_background: true },
						undefined,
						undefined,
						session.ctx,
					);
				await vi.waitFor(async () => expect(await session.status()).toContain("line 59"), { timeout: 5000 });
			};

			const session = install();
			await start(session);
			// Scroll near the top and close; reopening restores that position.
			session.detailScripts.push(["\x1b[H", "\x1b[B", "\x1b[B", "\x1b[B"]);
			await session.openTasks();
			expect(session.detailRenders[0]).toContain("line 59");
			// Then return to the live tail before closing; reopening keeps following new output.
			session.detailScripts.push(["\x1b[F"]);
			await session.openTasks();
			expect(session.detailRenders[1]).toContain("Command: node");
			expect(session.detailRenders[1]).not.toContain("line 59");
			writeFileSync(release, "");
			await vi.waitFor(async () => expect(await session.status()).toContain("late tail 4"), { timeout: 5000 });
			await session.openTasks();
			expect(session.detailRenders[2]).toContain("late tail 4");
			expect(session.pi.appendEntry).not.toHaveBeenCalled();
			session.shutdown();

			// A fresh install restores nothing: task-1 opens on the live tail.
			rmSync(release);
			const fresh = install();
			await start(fresh);
			await fresh.openTasks();
			expect(fresh.detailRenders[0]).toContain("line 59");
			expect(fresh.detailRenders[0]).not.toContain("Command: node");
			expect(fresh.pi.appendEntry).not.toHaveBeenCalled();
			fresh.shutdown();
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
