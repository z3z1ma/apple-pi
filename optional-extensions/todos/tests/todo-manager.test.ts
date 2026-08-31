import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { TodoView } from "../src/types.js";
import { TodoManagerComponent, openTodoManagerModal } from "../src/ui/todo-manager.js";

function mockTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		inverse: (text: string) => text,
		strikethrough: (text: string) => `~~${text}~~`,
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

const SAMPLE_TODOS: TodoView[] = [
	{
		id: 1,
		title: "Scaffold UI components",
		description: "Implement width-safe widget and full manager action surface.",
		activeForm: "Scaffolding UI",
		status: "completed",
		blockedBy: [],
		blocked: false,
		blocks: [2],
		agentType: "designer",
		createdAt: "2026-08-21T12:00:00.000Z",
		updatedAt: "2026-08-21T12:10:00.000Z",
		result: "Created widget and manager successfully",
	},
	{
		id: 2,
		title: "Wire subagent execution service",
		description: "Connect to apple-pi background runner without duplicate processes.",
		status: "active",
		blockedBy: [1],
		blocked: false,
		blocks: [],
		agentType: "builder",
		execution: {
			runId: "run-abc-123",
			ownerPid: 9876,
			ownerProcessUuid: "proc-test-uuid",
			claimedAt: "2026-08-21T12:15:00.000Z",
		},
		createdAt: "2026-08-21T12:00:00.000Z",
		updatedAt: "2026-08-21T12:15:00.000Z",
	},
	{
		id: 3,
		title: "Validate documentation and release",
		description: "Check boundaries and third party notices.",
		status: "open",
		blockedBy: [2],
		blocked: true,
		blocks: [],
		createdAt: "2026-08-21T12:00:00.000Z",
		updatedAt: "2026-08-21T12:00:00.000Z",
	},
];

describe("TodoManagerComponent", () => {
	it("renders empty state properly and all lines fit width", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new TodoManagerComponent(tui, theme, [], undefined, done);

		for (const width of [20, 40, 80, 120]) {
			component.invalidate();
			const lines = component.render(width);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			const textContent = lines.map((l) => l.trim()).join(" ");
			expect(textContent).toContain("Todos");
			expect(textContent).toContain("empty");
			expect(textContent).toContain("No todos in current list.");
			expect(textContent).toContain("c Create");
		}
	});

	it("renders populated todo list and selected todo details within width bounds", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new TodoManagerComponent(tui, theme, SAMPLE_TODOS, 2, done);

		for (const width of [30, 60, 80, 100]) {
			component.invalidate();
			const lines = component.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			const textContent = lines.map((l) => l.trim()).join(" ");
			expect(textContent).toContain("Todos");
			expect(textContent).toContain("3 todos (1 done, 1 active, 1 open)");
			expect(textContent).toContain("#2");
			expect(textContent).toContain("Selected:");
			expect(textContent).toContain("Wire subagent execution service");
			expect(textContent).toContain("Execution run: run-abc-…");
		}
	});

	it("navigates up/down and requests re-render", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new TodoManagerComponent(tui, theme, SAMPLE_TODOS, 1, done);
		expect(component.selectedTodo?.id).toBe(1);

		component.handleInput("\u001b[B"); // down arrow
		expect(component.selectedTodo?.id).toBe(2);
		expect(tui.requestRender).toHaveBeenCalled();

		component.handleInput("k"); // up via vim key
		expect(component.selectedTodo?.id).toBe(1);
	});

	it("dispatches actions for keyboard commands", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		const component = new TodoManagerComponent(tui, theme, SAMPLE_TODOS, 1, done);

		component.handleInput("c");
		expect(done).toHaveBeenLastCalledWith({ type: "create" });

		component.handleInput("s");
		expect(done).toHaveBeenLastCalledWith({ type: "settings" });

		component.handleInput("e");
		expect(done).toHaveBeenLastCalledWith({ type: "edit", id: 1 });

		component.handleInput("d");
		expect(done).toHaveBeenLastCalledWith({ type: "delete", id: 1 });

		component.handleInput("b");
		expect(done).toHaveBeenLastCalledWith({ type: "blockers", id: 1 });

		component.handleInput("o");
		expect(done).toHaveBeenLastCalledWith({ type: "output", id: 1 });

		component.handleInput("x");
		expect(done).toHaveBeenLastCalledWith({ type: "clear_completed" });

		component.handleInput("X");
		expect(done).toHaveBeenLastCalledWith({ type: "clear_all" });

		component.handleInput("\x1b");
		expect(done).toHaveBeenLastCalledWith({ type: "close" });
	});

	it("toggles status or execution depending on state", () => {
		const tui = mockTui();
		const theme = mockTheme();
		const done = vi.fn();

		// Item 2 is active with execution
		const comp2 = new TodoManagerComponent(tui, theme, SAMPLE_TODOS, 2, done);
		comp2.handleInput("\r"); // enter on active item completes it
		expect(done).toHaveBeenLastCalledWith({ type: "complete", id: 2 });

		comp2.handleInput("t"); // 't' on executing item stops it
		expect(done).toHaveBeenLastCalledWith({ type: "stop", id: 2 });

		// Item 1 is completed
		const comp1 = new TodoManagerComponent(tui, theme, SAMPLE_TODOS, 1, done);
		comp1.handleInput("\r"); // enter on completed item reopens it
		expect(done).toHaveBeenLastCalledWith({ type: "reopen", id: 1 });
	});

	it("opens modal via openTodoManagerModal helper", async () => {
		const customMock = vi.fn().mockImplementation((factory) => {
			const tui = mockTui();
			const theme = mockTheme();
			const done = vi.fn();
			const comp = factory(tui, theme, {}, done);
			expect(comp).toBeInstanceOf(TodoManagerComponent);
			return Promise.resolve({ type: "close" });
		});

		const ui = { custom: customMock };
		const result = await openTodoManagerModal(ui as any, () => SAMPLE_TODOS, 1);
		expect(result).toEqual({ type: "close" });
	});
});
