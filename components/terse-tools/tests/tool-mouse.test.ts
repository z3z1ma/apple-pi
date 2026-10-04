import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, Text, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installTerseToolRenderer, setToolInspector } from "../src/patch.js";

beforeAll(() => {
	initTheme();
	installTerseToolRenderer();
});

afterEach(() => setToolInspector());

function fixture(expanded = false, leadingText = false, selfRendered = false) {
	const parent = new Container();
	if (leadingText) parent.addChild(new Text("Assistant text", 0, 0));
	const tool = new ToolExecutionComponent(
		"bash",
		"call_mouse",
		{ command: "echo hello" },
		{},
		selfRendered ? ({ renderShell: "self", renderCall: () => new Text("Native call", 0, 0) } as any) : undefined,
		{ requestRender: vi.fn() } as any,
		process.cwd(),
	);
	tool.updateResult({ content: [{ type: "text", text: "hello\nworld" }], isError: false });
	tool.setExpanded(expanded);
	parent.addChild(tool);
	const lines = parent.render(100);
	return { parent, tool, lines, headerRow: leadingText ? 2 : 0 };
}

function isExpanded(tool: ToolExecutionComponent): boolean {
	return tool.render(100).some((line) => stripTerminalSequences(line).includes("└ "));
}

function mouse(x: number, y: number, height: number, overrides: Partial<TuiMouseEvent> = {}): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 100,
		height,
		shift: false,
		alt: false,
		ctrl: false,
		...overrides,
	};
}

describe("terse tool mouse routing", () => {
	it.each([false, true])("opens the inspector only on the gold label, expanded=%s", (expanded) => {
		const { parent, tool, lines, headerRow } = fixture(expanded);
		const inspect = vi.fn();
		setToolInspector(inspect);
		for (const x of [2, 3, 5]) {
			expect(parent.handleMouse(mouse(x, headerRow, lines.length))?.handled).toBe(true);
			expect(isExpanded(tool)).toBe(expanded);
		}
		expect(inspect).toHaveBeenCalledTimes(3);
		expect(inspect).toHaveBeenCalledWith(tool);
	});

	it.each([0, 1, 6, 15, 99])("toggles one tool from the non-label header column %s", (x) => {
		const { parent, tool, lines } = fixture();
		const inspect = vi.fn();
		setToolInspector(inspect);
		expect(parent.handleMouse(mouse(x, 0, lines.length))?.handled).toBe(true);
		expect(isExpanded(tool)).toBe(true);
		const expandedLines = parent.render(100);
		expect(parent.handleMouse(mouse(x, 0, expandedLines.length))?.handled).toBe(true);
		expect(isExpanded(tool)).toBe(false);
		expect(inspect).not.toHaveBeenCalled();
	});

	it("aligns the header after assistant text and leaves its separator unhandled", () => {
		const { parent, tool, lines, headerRow } = fixture(false, true);
		const inspect = vi.fn();
		setToolInspector(inspect);
		expect(parent.handleMouse(mouse(3, headerRow - 1, lines.length))).toBeUndefined();
		expect(parent.handleMouse(mouse(3, headerRow, lines.length))?.handled).toBe(true);
		expect(inspect).toHaveBeenCalledWith(tool);
		expect(parent.handleMouse(mouse(8, headerRow, lines.length))?.handled).toBe(true);
		expect(isExpanded(tool)).toBe(true);
	});

	it("collapses from output rows without treating them as labels or including trailing spacing", () => {
		const { parent, tool, lines } = fixture(true);
		const inspect = vi.fn();
		setToolInspector(inspect);
		expect(parent.handleMouse(mouse(3, lines.length - 1, lines.length))).toBeUndefined();
		expect(isExpanded(tool)).toBe(true);
		expect(parent.handleMouse(mouse(3, 1, lines.length))?.handled).toBe(true);
		expect(isExpanded(tool)).toBe(false);
		expect(inspect).not.toHaveBeenCalled();
	});

	it("uses terse geometry even for tools with their own native framing", () => {
		const { parent, tool, lines } = fixture(false, false, true);
		const inspect = vi.fn();
		setToolInspector(inspect);
		expect(parent.handleMouse(mouse(3, 0, lines.length))?.handled).toBe(true);
		expect(inspect).toHaveBeenCalledWith(tool);
	});

	it("leaves drag selection, wheel scrolling, and secondary clicks to Pi", () => {
		const { parent, lines } = fixture();
		const inspect = vi.fn();
		setToolInspector(inspect);
		for (const type of ["press", "drag", "release", "wheel"] as const) {
			expect(parent.handleMouse(mouse(3, 0, lines.length, { type }))).toBeUndefined();
		}
		expect(parent.handleMouse(mouse(3, 0, lines.length, { button: "right" }))).toBeUndefined();
		expect(inspect).not.toHaveBeenCalled();
	});

	it("keeps truncated ellipses outside the visible label hitbox on resize", () => {
		const { parent, tool } = fixture();
		const inspect = vi.fn();
		setToolInspector(inspect);
		const lines = parent.render(5);
		expect(parent.handleMouse(mouse(3, 0, lines.length, { width: 5 }))?.handled).toBe(true);
		expect(isExpanded(tool)).toBe(true);
		expect(inspect).not.toHaveBeenCalled();
	});

	it("toggles only the selected tool in a dense sequence", () => {
		const { parent, tool } = fixture();
		const next = new ToolExecutionComponent(
			"read",
			"call_next",
			{ path: "README.md" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		parent.addChild(next);
		const lines = parent.render(100);
		parent.handleMouse(mouse(20, 1, lines.length));
		expect(isExpanded(next)).toBe(true);
		expect(isExpanded(tool)).toBe(false);
	});
});
