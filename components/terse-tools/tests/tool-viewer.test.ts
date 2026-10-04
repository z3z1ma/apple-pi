import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	stripTerminalSequences,
	type TUI,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ToolInspection, ToolViewer } from "../src/tool-viewer.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
const viewers: ToolViewer[] = [];
afterEach(() => {
	for (const viewer of viewers.splice(0)) viewer.dispose();
	vi.useRealTimers();
});

function fixture(overrides: Partial<ToolInspection> = {}, rows = 20) {
	let inspection: ToolInspection = {
		toolName: "bash",
		toolCallId: "call_viewer",
		args: { command: "echo input" },
		result: { content: [{ type: "text", text: "Output result" }] },
		isPartial: false,
		...overrides,
	};
	const tui = { terminal: { rows }, requestRender: vi.fn() };
	const done = vi.fn();
	const viewer = new ToolViewer(
		tui as unknown as TUI,
		theme,
		new KeybindingsManager(TUI_KEYBINDINGS, {}),
		done,
		() => inspection,
	);
	viewers.push(viewer);
	const frame = (width = 80) => viewer.render(width).map(stripTerminalSequences).join("\n");
	return {
		viewer,
		tui,
		done,
		frame,
		update: (next: Partial<ToolInspection>) => {
			inspection = { ...inspection, ...next };
		},
	};
}

function outputFixture() {
	const f = fixture({
		result: {
			content: [
				{ type: "text", text: Array.from({ length: 60 }, (_, i) => `Log ${i + 1}: retained output`).join("\n") },
			],
		},
	});
	f.frame();
	f.viewer.handleInput("\t");
	return f;
}

function firstLog(frame: string): number {
	const match = /Log (\d+):/.exec(frame);
	expect(match).not.toBeNull();
	return Number(match![1]);
}

describe("tool inspector display", () => {
	it("shows multiline inputs as readable lines and retains other arguments", () => {
		const f = fixture({
			args: { command: "echo first\necho second", timeout: 30, options: { enabled: true, paths: ["a.ts", "b.ts"] } },
		});
		const frame = f.frame();
		expect(frame).toContain("echo first");
		expect(frame).toContain("echo second");
		expect(frame).not.toContain("first\\necho second");
		expect(frame).toContain("timeout: 30");
		expect(frame).toContain('"enabled": true');
		expect(frame).toContain('"a.ts"');
		expect(frame).toContain('"b.ts"');
	});

	it("makes all long input lines reachable through scrolling", () => {
		const f = fixture({ args: { code: Array.from({ length: 60 }, (_, i) => `statement_${i + 1}()`).join("\n") } });
		expect(f.frame()).toContain("statement_1()");
		f.viewer.handleInput("\x1b[F");
		expect(f.frame()).toContain("statement_60()");
	});

	it("shows every output block and structured details", () => {
		const f = fixture(
			{
				result: {
					content: [
						{ type: "text", text: "Build succeeded" },
						{ type: "text", text: "Tests passed" },
						{ type: "image", mimeType: "image/png", data: "abcd" },
					],
					details: { exitCode: 0, fullOutputPath: "/tmp/full-output.log", diff: "-old line\n+new line" },
				},
			},
			30,
		);
		f.frame();
		f.viewer.handleInput("\t");
		const frame = f.frame();
		for (const text of [
			"Build succeeded",
			"Tests passed",
			"image/png",
			"-old line",
			"+new line",
			"exitCode",
			"/tmp/full-output.log",
		])
			expect(frame).toContain(text);
	});

	it("shows the tool's failure and its error output", () => {
		const f = fixture({ result: { isError: true, content: [{ type: "text", text: "Permission denied" }] } });
		f.frame();
		f.viewer.handleInput("\t");
		expect(f.frame()).toContain("Execution failed");
		expect(f.frame()).toContain("Permission denied");
	});

	it("shows running status and refreshes to completed output", () => {
		vi.useFakeTimers();
		const f = fixture({ result: undefined, isPartial: true });
		expect(f.frame()).toContain("[running]");
		f.viewer.handleInput("\t");
		expect(f.frame()).toContain("waiting for output");
		f.tui.requestRender.mockClear();
		f.update({ isPartial: false, result: { content: [{ type: "text", text: "Compilation complete" }] } });
		vi.advanceTimersByTime(1000);
		expect(f.tui.requestRender).toHaveBeenCalled();
		expect(f.frame()).toContain("Compilation complete");
		expect(f.frame()).not.toContain("[running]");
		f.viewer.handleInput("q");
		f.tui.requestRender.mockClear();
		vi.advanceTimersByTime(1000);
		expect(f.tui.requestRender).not.toHaveBeenCalled();
	});
});

describe("tool inspector navigation", () => {
	it("switches displayed content with Tab, Shift+Tab, and a tab click", () => {
		const f = fixture();
		expect(f.frame()).toContain("echo input");
		f.viewer.handleInput("\t");
		expect(f.frame()).toContain("Output result");
		expect(f.frame()).not.toContain("echo input");
		f.viewer.handleInput("\x1b[Z");
		expect(f.frame()).toContain("echo input");
		f.viewer.handleMouse({ type: "press", button: "left", x: 14, y: 1 } as any);
		expect(f.frame()).toContain("Output result");
	});

	it("moves the visible output with arrows and page keys", () => {
		const f = outputFixture();
		const start = firstLog(f.frame());
		f.viewer.handleInput("\x1b[B");
		expect(firstLog(f.frame())).toBe(start + 1);
		f.viewer.handleInput("\x1b[A");
		expect(firstLog(f.frame())).toBe(start);
		f.viewer.handleInput("\x1b[6~");
		const nextPage = firstLog(f.frame());
		expect(nextPage).toBeGreaterThan(start + 1);
		f.viewer.handleInput("\x1b[5~");
		expect(firstLog(f.frame())).toBe(start);
	});

	it("reaches output beyond the inline preview when Tab and End arrive together", () => {
		const f = outputFixture();
		f.viewer.handleInput("\x1b[F");
		expect(f.frame()).toContain("Log 60:");
		f.viewer.handleInput("\x1b[H");
		expect(firstLog(f.frame())).toBe(1);
	});

	it("moves visible output with the wheel in both directions", () => {
		const f = outputFixture();
		expect(firstLog(f.frame())).toBe(1);
		f.viewer.handleMouse({ type: "wheel", wheelDelta: 5 } as any);
		expect(firstLog(f.frame())).toBe(6);
		f.viewer.handleMouse({ type: "wheel", wheelDelta: -3 } as any);
		expect(firstLog(f.frame())).toBe(3);
	});

	it.each(["\x1b", "q"])("closes with %j", (key) => {
		const f = fixture();
		f.viewer.handleInput(key);
		expect(f.done).toHaveBeenCalledTimes(1);
	});

	it("keeps inputs and output accessible after resizing", () => {
		const f = outputFixture();
		for (const width of [100, 50, 22]) {
			for (const line of f.viewer.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		f.tui.terminal.rows = 10;
		const small = f.viewer.render(50);
		expect(small.length).toBeGreaterThan(0);
		expect(small.length).toBeLessThan(f.tui.terminal.rows);
		f.viewer.handleInput("\x1b[F");
		expect(f.frame(50)).toContain("Log 60:");
		f.viewer.handleInput("\x1b[Z");
		expect(f.frame(50)).toContain("echo input");
	});
});
