import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoView } from "../src/types.js";
import { formatDuration, formatTokens, sortTodos, TodoWidget, type Theme, type UICtx } from "../src/ui/todo-widget.js";

function mockTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		strikethrough: (text: string) => `~~${text}~~`,
	};
}

function mockUICtx() {
	const state: {
		widgets: Map<string, any>;
		statuses: Map<string, string | undefined>;
	} = {
		widgets: new Map(),
		statuses: new Map(),
	};

	const ctx: UICtx = {
		setWidget(key, content, options) {
			state.widgets.set(key, { content, options });
		},
		setStatus(key, text) {
			state.statuses.set(key, text);
		},
	};

	return { ctx, state };
}

function renderWidget(state: ReturnType<typeof mockUICtx>["state"], width = 80): string[] {
	const entry = state.widgets.get("todos");
	if (!entry?.content) return [];
	const theme = mockTheme();
	const tui = { terminal: { columns: width }, requestRender: vi.fn() };
	const result = entry.content(tui, theme);
	return result.render(width);
}

describe("formatDuration and formatTokens", () => {
	it("formats durations accurately", () => {
		expect(formatDuration(500)).toBe("0s");
		expect(formatDuration(45000)).toBe("45s");
		expect(formatDuration(125000)).toBe("2m 5s");
		expect(formatDuration(3600000)).toBe("1h");
		expect(formatDuration(3725000)).toBe("1h 2m");
	});

	it("formats tokens with compact k/exact", () => {
		expect(formatTokens(850)).toBe("850");
		expect(formatTokens(1200)).toBe("1.2k");
		expect(formatTokens(10000)).toBe("10k");
	});
});

describe("sortTodos", () => {
	const items: TodoView[] = [
		{
			id: 3,
			title: "Three",
			description: "",
			status: "completed",
			blockedBy: [],
			blocked: false,
			blocks: [],
			createdAt: "2026-08-21T10:00:00.000Z",
			updatedAt: "2026-08-21T10:00:00.000Z",
		},
		{
			id: 1,
			title: "One",
			description: "",
			status: "open",
			blockedBy: [],
			blocked: false,
			blocks: [],
			createdAt: "2026-08-21T09:00:00.000Z",
			updatedAt: "2026-08-21T11:00:00.000Z",
		},
		{
			id: 2,
			title: "Two",
			description: "",
			status: "active",
			blockedBy: [],
			blocked: false,
			blocks: [],
			createdAt: "2026-08-21T09:30:00.000Z",
			updatedAt: "2026-08-21T09:30:00.000Z",
		},
	];

	it("sorts by id by default", () => {
		const sorted = sortTodos(items, "id");
		expect(sorted.map((t) => t.id)).toEqual([1, 2, 3]);
	});

	it("sorts by active (active -> open -> completed)", () => {
		const sorted = sortTodos(items, "active");
		expect(sorted.map((t) => t.id)).toEqual([2, 1, 3]);
	});

	it("sorts by recent (updatedAt desc)", () => {
		const sorted = sortTodos(items, "recent");
		expect(sorted.map((t) => t.id)).toEqual([1, 3, 2]);
	});
});

describe("TodoWidget", () => {
	let todos: TodoView[] = [];
	let widget: TodoWidget;
	let ui: ReturnType<typeof mockUICtx>;

	beforeEach(() => {
		vi.useFakeTimers();
		todos = [];
		widget = new TodoWidget(() => todos);
		ui = mockUICtx();
		widget.setUICtx(ui.ctx);
	});

	afterEach(() => {
		widget.dispose();
		vi.useRealTimers();
	});

	it("clears widget when todo list is empty", () => {
		widget.update();
		const entry = ui.state.widgets.get("todos");
		expect(entry?.content).toBeUndefined();
	});

	it("renders open, active, and completed todos with proper icons", () => {
		todos = [
			{
				id: 1,
				title: "Open item",
				description: "",
				status: "open",
				blockedBy: [],
				blocked: false,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
			{
				id: 2,
				title: "Active item",
				description: "",
				status: "active",
				blockedBy: [],
				blocked: false,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
			{
				id: 3,
				title: "Completed item",
				description: "",
				status: "completed",
				blockedBy: [],
				blocked: false,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
		];

		widget.update();
		const lines = renderWidget(ui.state);
		expect(lines[0]).toContain("3 todos (1 done, 1 active, 1 open)");
		expect(lines[1]).toContain("◻");
		expect(lines[1]).toContain("#1 Open item");
		expect(lines[2]).toContain("◼");
		expect(lines[2]).toContain("#2 Active item");
		expect(lines[3]).toContain("✔");
		expect(lines[3]).toContain("~~#3 Completed item~~");
	});

	it("renders active managed execution with spinner and metrics", () => {
		todos = [
			{
				id: 1,
				title: "Running subagent task",
				activeForm: "Building tests",
				description: "",
				agentType: "builder",
				status: "active",
				execution: {
					runId: "run-123",
					ownerPid: 1234,
					ownerProcessUuid: "proc-123",
					claimedAt: new Date().toISOString(),
				},
				blockedBy: [],
				blocked: false,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
		];

		widget.setActiveRun(1, true);
		widget.addTokenUsage(1200, 450, 1);
		widget.update();

		const lines = renderWidget(ui.state);
		expect(lines[1]).toContain("Building tests (builder)…");
		expect(lines[1]).toContain("↑ 1.2k ↓ 450");
	});

	it("shows blocked by indicator for open todos with incomplete blockers", () => {
		todos = [
			{
				id: 1,
				title: "Prerequisite",
				description: "",
				status: "open",
				blockedBy: [],
				blocked: false,
				blocks: [2],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
			{
				id: 2,
				title: "Dependent task",
				description: "",
				status: "open",
				blockedBy: [1],
				blocked: true,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
		];

		widget.update();
		const lines = renderWidget(ui.state);
		expect(lines[2]).toContain("› blocked by #1");
	});

	it("supports collapseCompleted configuration", () => {
		todos = [
			{
				id: 1,
				title: "Done 1",
				description: "",
				status: "completed",
				blockedBy: [],
				blocked: false,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
			{
				id: 2,
				title: "Open 1",
				description: "",
				status: "open",
				blockedBy: [],
				blocked: false,
				blocks: [],
				createdAt: "2026-08-21T10:00:00.000Z",
				updatedAt: "2026-08-21T10:00:00.000Z",
			},
		];

		widget.setConfig({ collapseCompleted: true });
		widget.update();
		const lines = renderWidget(ui.state);
		expect(lines.some((l) => l.includes("1 completed"))).toBe(true);
		expect(lines.some((l) => l.includes("Done 1"))).toBe(false);
	});
});
