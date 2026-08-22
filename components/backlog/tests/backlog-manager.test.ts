import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { BacklogItem } from "../src/state.js";
import { type BacklogManagerAction, BacklogManagerComponent } from "../src/ui/backlog-manager.js";

function mockTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		inverse: (text: string) => text,
		strikethrough: (text: string) => text,
		getFgAnsi: () => "",
		getBgAnsi: () => "",
		getColorMode: () => "truecolor",
		getThinkingBorderColor: () => (s: string) => s,
		getBashModeBorderColor: () => (s: string) => s,
	} as unknown as Theme;
}

function mockTui(): TUI {
	return {
		requestRender: vi.fn(),
	} as unknown as TUI;
}

const SAMPLE_ITEMS: BacklogItem[] = [
	{
		id: 1,
		title: "Fix cache invalidation bug on session switch",
		description: "When switching sessions, the cached theme may stay stale.\nWe need to invalidate.",
		createdAt: "2026-03-16T12:00:00.000Z",
	},
	{
		id: 2,
		title: "Add keyboard shortcut for quick note",
		description: "A simple shortcut to add notes quickly without opening prompt.",
		createdAt: "2026-03-16T12:05:00.000Z",
	},
	{
		id: 3,
		title: "Third item with no description",
		description: "",
		createdAt: "2026-03-16T12:10:00.000Z",
	},
];

describe("BacklogManagerComponent", () => {
	it("renders empty state properly and all lines fit width", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new BacklogManagerComponent(tui, theme, [], undefined, done);

		for (const width of [20, 40, 80, 120]) {
			component.invalidate();
			const lines = component.render(width);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			const textContent = lines.map((l) => l.trim()).join(" ");
			expect(textContent).toContain("Backlog");
			expect(textContent).toContain("(empty)");
			expect(textContent).toContain("No items in session backlog.");
			expect(textContent).toContain("Esc / Ctrl+C Close");
		}
	});

	it("renders populated item list and selected item details within width bounds", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, 2, done);

		for (const width of [30, 60, 80, 100]) {
			component.invalidate();
			const lines = component.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			const textContent = lines.map((l) => l.trim()).join(" ");
			expect(textContent).toContain("Backlog");
			expect(textContent).toContain("(3 items)");
			expect(textContent).toContain("#2");
			expect(textContent).toContain("Selected:");
			expect(textContent).toContain("Add keyboard shortcut for quick note");
			expect(textContent).toContain("A simple shortcut to add notes quickly without opening prompt.");
		}
	});

	it("preserves selection by selectedId when provided or defaults to first", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		// Default first item
		const comp1 = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, undefined, done);
		const lines1 = comp1.render(80).join("\n");
		expect(lines1).toContain("Selected: #1 Fix cache invalidation");

		// Provided selectedId = 3
		const comp2 = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, 3, done);
		const lines2 = comp2.render(80).join("\n");
		expect(lines2).toContain("Selected: #3 Third item");

		// Non-existent selectedId defaults to 0
		const comp3 = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, 999, done);
		const lines3 = comp3.render(80).join("\n");
		expect(lines3).toContain("Selected: #1 Fix cache invalidation");
	});

	it("handles navigation with up/down and j/k keys, requesting re-renders", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, 1, done);
		expect(component.render(80).join("\n")).toContain("Selected: #1");

		// Move down with 'down' arrow
		component.handleInput("\x1b[B"); // down
		expect(tui.requestRender).toHaveBeenCalledTimes(1);
		expect(component.render(80).join("\n")).toContain("Selected: #2");

		// Move down with 'j'
		component.handleInput("j");
		expect(tui.requestRender).toHaveBeenCalledTimes(2);
		expect(component.render(80).join("\n")).toContain("Selected: #3");

		// Move down at bottom does nothing
		component.handleInput("j");
		expect(tui.requestRender).toHaveBeenCalledTimes(2);

		// Move up with 'k'
		component.handleInput("k");
		expect(tui.requestRender).toHaveBeenCalledTimes(3);
		expect(component.render(80).join("\n")).toContain("Selected: #2");

		// Move up with 'up' arrow
		component.handleInput("\x1b[A"); // up
		expect(tui.requestRender).toHaveBeenCalledTimes(4);
		expect(component.render(80).join("\n")).toContain("Selected: #1");

		// Move up at top does nothing
		component.handleInput("k");
		expect(tui.requestRender).toHaveBeenCalledTimes(4);
	});

	it("dispatches actions for shift+up/down, e, d, escape, ctrl+c", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const actions: BacklogManagerAction[] = [];
		const done = (action: BacklogManagerAction) => actions.push(action);

		const component = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, 2, done);

		// Move up (shift+up)
		component.handleInput("\x1b[1;2A");
		expect(actions).toEqual([{ type: "move", id: 2, direction: "up" }]);

		// Move down (shift+down)
		component.handleInput("\x1b[1;2B");
		expect(actions[1]).toEqual({ type: "move", id: 2, direction: "down" });

		// Edit (e)
		component.handleInput("e");
		expect(actions[2]).toEqual({ type: "edit", id: 2 });

		// Delete (d)
		component.handleInput("d");
		expect(actions[3]).toEqual({ type: "delete", id: 2 });

		// Escape closes
		component.handleInput("\x1b");
		expect(actions[4]).toEqual({ type: "close" });

		// Ctrl+c closes
		component.handleInput("\x03");
		expect(actions[5]).toEqual({ type: "close" });
	});

	it("handles empty backlog input gracefully — only close keys act", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const actions: BacklogManagerAction[] = [];
		const done = (action: BacklogManagerAction) => actions.push(action);

		const component = new BacklogManagerComponent(tui, theme, [], undefined, done);

		// Navigation and action keys do nothing
		component.handleInput("j");
		component.handleInput("k");
		component.handleInput("e");
		component.handleInput("d");
		component.handleInput("\x1b[1;2A");
		expect(actions).toEqual([]);

		// Escape closes
		component.handleInput("\x1b");
		expect(actions).toEqual([{ type: "close" }]);
	});

	it("caches rendered lines and invalidates on request", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new BacklogManagerComponent(tui, theme, SAMPLE_ITEMS, 1, done);

		const render1 = component.render(80);
		const render2 = component.render(80);
		expect(render1).toBe(render2); // exact same array reference (cached)

		component.invalidate();
		const render3 = component.render(80);
		expect(render3).not.toBe(render1); // new array
		expect(render3).toEqual(render1); // same content
	});
});
