import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { OutputBuffer } from "../src/output-buffer.js";
import type { CommandTask, ManagedTask, PromptTask } from "../src/types.js";
import { TaskDetailViewer, TaskPanel } from "../src/ui/task-manager.js";

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

describe("TaskPanel", () => {
	const panelTui = (rows = 30, columns = 100) => ({ terminal: { rows, columns }, requestRender: vi.fn() }) as any;

	it("orders active work before settled outcomes and renders every task kind within bounds", () => {
		const now = Date.now();
		const tasks: ManagedTask[] = [
			command("completed", "completed", now + 30),
			{ ...prompt("scheduled", "scheduled", now + 10), prompt: "scheduled full prompt\nsecond line" },
			command("monitor", "running", now + 20, true),
		];
		const panel = new TaskPanel(panelTui(), theme, () => tasks, undefined, vi.fn());
		panel.rowBudget = 20;

		const lines = panel.render(100);
		const text = lines.join("\n");
		expect(text.indexOf("scheduled full prompt")).toBeLessThan(text.indexOf("completed command"));
		expect(text).toContain("Prompt");
		expect(text).toContain("Monitor");
		expect(text).toContain("Command");
		expect(text).toContain("events 2/4");
		expect(panel.title()).toBe("Tasks · 3");
		expect(lines.length).toBeLessThanOrEqual(20);
		expect(lines.at(-1)).toMatch(/^╰─+╯$/);
		for (const line of lines) {
			expect(line).not.toContain("\n");
			expect(visibleWidth(line)).toBeLessThanOrEqual(100);
		}
		panel.rowBudget = 3;
		expect(panel.render(100).length).toBeLessThanOrEqual(3);
		panel.dispose();
	});

	it("selects tasks with Tab, shows the selected detail inline, and confirms cancellation", () => {
		const now = Date.now();
		const tasks: ManagedTask[] = [command("first", "running", now + 20), prompt("second", "scheduled", now + 10)];
		const cancel = vi.fn();
		const panel = new TaskPanel(panelTui(), theme, () => tasks, undefined, cancel);
		panel.rowBudget = 20;
		panel.focused = true;
		expect(panel.render(100).join("\n")).toContain("Command: first command");
		expect(panel.getSelectedId()).toBe("first");

		panel.handleInput("\t");
		expect(panel.getSelectedId()).toBe("second");
		expect(panel.render(100).join("\n")).toContain("second full prompt");
		panel.handleInput("\x1b[Z");
		expect(panel.getSelectedId()).toBe("first");

		// An armed cancel drops when focus leaves or the selection changes.
		panel.handleInput("x");
		expect(panel.render(100).join("\n")).toContain("x again to CANCEL");
		panel.focused = false;
		panel.focused = true;
		expect(panel.render(100).join("\n")).not.toContain("x again to CANCEL");
		panel.handleInput("x");
		panel.handleInput("\t");
		panel.handleInput("\x1b[Z");
		expect(panel.render(100).join("\n")).not.toContain("x again to CANCEL");
		panel.handleInput("x");
		panel.handleInput("x");
		expect(cancel).toHaveBeenCalledWith("first");
		panel.dispose();
	});

	it("keeps each task's scroll and follow-tail position in the shared view map", () => {
		const task = command("long", "running", Date.now());
		for (let index = 0; index < 60; index++) task.output.append(`line ${index}\n`);
		const other = prompt("other", "scheduled", Date.now() - 10);
		const views = new Map();
		const panel = new TaskPanel(panelTui(), theme, () => [task, other], undefined, vi.fn(), undefined, views);
		panel.rowBudget = 20;
		expect(panel.render(100).join("\n")).toContain("line 59");
		panel.handleInput("\x1b[H");
		expect(panel.render(100).join("\n")).toContain("Command: long command");

		panel.handleInput("\t");
		panel.render(100);
		panel.handleInput("\x1b[Z");
		expect(panel.render(100).join("\n")).toContain("Command: long command");

		// Wheel scrolling reaches the detail; scrolling back to the end resumes following.
		panel.handleMouse({ type: "wheel", button: "none", x: 1, y: 1, wheelDelta: 200 } as any);
		task.output.append("fresh tail\n");
		expect(panel.render(100).join("\n")).toContain("fresh tail");
		panel.dispose();
		expect(views.get("long")).toMatchObject({ autoScroll: true });

		const reopened = new TaskPanel(panelTui(), theme, () => [task, other], "long", vi.fn(), undefined, views);
		reopened.rowBudget = 20;
		expect(reopened.render(100).join("\n")).toContain("fresh tail");
		reopened.dispose();
	});

	it("does not carry a position onto a new task that reuses an ID after the roster resets", () => {
		const old = command("task-1", "running", Date.now());
		for (let index = 0; index < 60; index++) old.output.append(`old ${index}\n`);
		let roster: ManagedTask[] = [old];
		const views = new Map();
		const panel = new TaskPanel(panelTui(), theme, () => roster, undefined, vi.fn(), undefined, views);
		panel.rowBudget = 20;
		panel.render(100);
		panel.handleInput("\x1b[H");
		expect(panel.render(100).join("\n")).toContain("Command: task-1 command");

		// The session resets: the owner clears its view map and task IDs restart.
		views.clear();
		const fresh = command("task-1", "running", Date.now());
		for (let index = 0; index < 60; index++) fresh.output.append(`new ${index}\n`);
		roster = [fresh];
		expect(panel.render(100).join("\n")).toContain("new 59");
		expect(views.size).toBe(0);
		panel.dispose();
		expect(views.get("task-1")).toMatchObject({ autoScroll: true });
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

	it("preserves manual scroll across responsive width and height changes", () => {
		const task = command("resize", "running", Date.now());
		for (let index = 0; index < 35; index++) task.output.append(`OUTPUT-${index} ${"detail ".repeat(10)}\n`);
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 40, columns: 160 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			vi.fn(),
		);
		viewer.rowBudget = 20;
		viewer.render(50);
		viewer.handleInput("\u001b[A");
		const before = viewer.view;
		const originalContent = viewer.render(50);
		viewer.rowBudget = 10;
		viewer.render(90);
		expect(viewer.view).toEqual(before);
		viewer.rowBudget = 20;
		expect(viewer.render(50)).toEqual(originalContent);
		expect(viewer.view).toEqual(before);
		viewer.dispose();
	});

	it.each([5, 6])("keeps task content scrollable with a %i-row budget", (rows) => {
		const task = {
			...prompt("compact", "scheduled", Date.now()),
			prompt: Array.from({ length: 20 }, (_, i) => `PROMPT-LINE-${i}`).join("\n"),
		};
		const viewer = new TaskDetailViewer(
			{ terminal: { rows: 16, columns: 100 }, requestRender: vi.fn() } as any,
			task,
			theme,
			vi.fn(),
			vi.fn(),
		);
		viewer.rowBudget = rows;
		expect(viewer.render(90).join("\n")).toContain("PROMPT-LINE-19");
		viewer.handleInput("\u001b[H");
		const atHome = viewer.render(90).join("\n");
		expect(atHome).not.toContain("PROMPT-LINE-19");
		viewer.handleInput("\u001b[F");
		expect(viewer.render(90).join("\n")).toContain("PROMPT-LINE-19");
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
