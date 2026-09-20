import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { OutputBuffer } from "../src/output-buffer.js";
import type { CommandTask, ManagedTask, PromptTask } from "../src/types.js";
import { TaskDetailViewer, TaskManagerComponent } from "../src/ui/task-manager.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function prompt(id: string, status: PromptTask["status"], createdAt: number): PromptTask {
	return { id, kind: "prompt", prompt: `${id} full prompt`, createdAt, dueAt: createdAt + 60_000, status };
}

function command(id: string, status: CommandTask["status"], createdAt: number, monitor = false): CommandTask {
	return {
		id,
		kind: "command",
		command: `${id} command`,
		cwd: "/project",
		createdAt,
		dueAt: createdAt,
		startedAt: createdAt,
		status,
		pid: 123,
		output: new OutputBuffer(),
		monitor: monitor ? { deliveredEvents: 2, maxEvents: 4, muted: false } : undefined,
	};
}

describe("TaskManagerComponent", () => {
	it("orders active work before settled outcomes and renders every task kind within bounds", () => {
		const now = Date.now();
		const tasks: ManagedTask[] = [
			command("completed", "completed", now + 30),
			{ ...prompt("scheduled", "scheduled", now + 10), prompt: "scheduled full prompt\nsecond line" },
			command("monitor", "running", now + 20, true),
		];
		const tui = { terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() } as any;
		const component = new TaskManagerComponent(tui, theme, () => tasks, undefined, vi.fn());

		const lines = component.render(100);
		const text = lines.join("\n");
		expect(text.indexOf("scheduled full prompt")).toBeLessThan(text.indexOf("completed command"));
		expect(text).toContain("Prompt");
		expect(text).toContain("Monitor");
		expect(text).toContain("Command");
		expect(text).toContain("events 2/4");
		for (const line of lines) {
			expect(line).not.toContain("\n");
			expect(visibleWidth(line)).toBeLessThanOrEqual(100);
		}
		tui.terminal.rows = 4;
		expect(component.render(100).length).toBeLessThanOrEqual(3);
		component.dispose();
	});

	it("uses configured navigation", () => {
		const now = Date.now();
		const tasks: ManagedTask[] = [command("first", "running", now + 20), prompt("second", "scheduled", now + 10)];
		const done = vi.fn();
		const component = new TaskManagerComponent(
			{ terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() } as any,
			theme,
			() => tasks,
			undefined,
			done,
			{
				matches: (data: string, binding: string) => data === "D" && binding === "tui.select.down",
				getKeys: (binding: string) =>
					binding === "tui.select.up" ? ["ctrl+p"] : binding === "tui.select.down" ? ["ctrl+n"] : [],
			},
		);

		expect(component.render(100).join("\n")).toContain("ctrl+p/ctrl+n select");
		component.handleInput("D");
		component.handleInput("\r");
		expect(done).toHaveBeenCalledWith({ type: "inspect", id: "second" });
		component.dispose();
	});
});

describe("TaskDetailViewer", () => {
	it("shows a scheduled prompt's complete content and timing with confirmed cancellation", () => {
		const cancel = vi.fn();
		const task = prompt("task-1", "scheduled", Date.now());
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 30, columns: 80 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			cancel,
		);

		const text = viewer.render(80).join("\n");
		expect(text).toContain("Prompt task-1");
		expect(text).toContain("Status: scheduled");
		expect(text).toContain("Created:");
		expect(text).toContain("Due:");
		expect(text).toContain("task-1 full prompt");
		expect(text).toContain("x cancel");
		viewer.handleInput("x");
		expect(cancel).not.toHaveBeenCalled();
		expect(viewer.render(80).join("\n")).toContain("x again to CANCEL");
		viewer.handleInput("x");
		expect(cancel).toHaveBeenCalledTimes(1);
		viewer.dispose();
	});

	it("follows live command output and retains final process metadata after settlement", () => {
		const task = command("task-2", "running", Date.now());
		task.output.append("first line\n");
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 32, columns: 100 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			vi.fn(),
		);

		let text = viewer.render(100).join("\n");
		expect(text).toContain("Command task-2");
		expect(text).toContain("Command: task-2 command");
		expect(text).toContain("Working directory: /project");
		expect(text).toContain("PID: 123");
		expect(text).toContain("first line");

		task.output.append("second line\n");
		task.status = "completed";
		task.exitCode = 0;
		task.endedAt = Date.now();
		text = viewer.render(100).join("\n");
		expect(text).toContain("Status: completed");
		expect(text).toContain("Exit code: 0");
		expect(text).toContain("second line");
		expect(text).not.toContain("x cancel");
		viewer.dispose();
	});

	it("follows the rolling output tail by default while a command is running", () => {
		const task = command("task-tail", "running", Date.now());
		for (let index = 0; index < 40; index++) task.output.append(`line ${index}\n`);
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 20, columns: 80 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			vi.fn(),
		);

		expect(viewer.render(80).join("\n")).toContain("line 39");
		viewer.dispose();
	});

	it("shows monitor event limits and active, silent, then finished delivery state", () => {
		const task = command("task-3", "running", Date.now(), true);
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 32, columns: 100 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			vi.fn(),
		);

		expect(viewer.render(100).join("\n")).toContain("Events delivered: 2/4");
		expect(viewer.render(100).join("\n")).toContain("Delivery: active");
		task.monitor!.muted = true;
		expect(viewer.render(100).join("\n")).toContain("Delivery: silent until completion");
		task.status = "completed";
		task.endedAt = Date.now();
		expect(viewer.render(100).join("\n")).toContain("Delivery: finished");
		viewer.dispose();
	});

	it("wraps complete command and working-directory text for inspection", () => {
		const task: CommandTask = {
			...command("task-long", "scheduled", Date.now()),
			command: "printf alpha beta gamma omega",
			cwd: "/workspace/projects/a-very-long-directory-name",
		};
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 100, columns: 24 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			vi.fn(),
		);

		const rendered = viewer.render(24).join("\n");
		expect(rendered).toContain("omega");
		expect(rendered).toContain("a-very-long-director");
		expect(rendered).toContain("y-name");
		viewer.dispose();
	});

	it("bounds narrow details and exposes the full-output path when the rolling tail is truncated", () => {
		const output = new OutputBuffer({ maxBytes: 40, maxLines: 3 });
		for (let index = 0; index < 20; index++) output.append(`output line ${index}\n`);
		const task = command("task-4", "running", Date.now());
		(task as any).output = output;
		const tui = { terminal: { rows: 20, columns: 42 }, requestRender: vi.fn() } as any;
		const viewer = new TaskDetailViewer(tui, task, theme, vi.fn(), vi.fn());

		let lines = viewer.render(42);
		expect(lines.length).toBeLessThanOrEqual(Math.floor(20 * 0.7));
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(42);
		viewer.handleInput("\x1b[F");
		lines = viewer.render(42);
		expect(lines.join("\n")).toContain("Output is truncated");
		expect(lines.join("\n")).toContain("Full output:");
		tui.terminal.rows = 4;
		expect(viewer.render(42).length).toBeLessThanOrEqual(2);
		viewer.dispose();
		output.cleanup();
	});
});
