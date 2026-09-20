import { describe, expect, it, vi } from "vitest";
import {
	installWorkManager,
	WorkManager,
	WorkManagerComponent,
	type WorkSection,
} from "../components/shared/src/work-manager.js";
import installSubagents from "../components/subagents/src/installer.js";
import installTasks from "../components/tasks/src/index.js";
import type { PromptTask } from "../components/tasks/src/types.js";
import { TaskManagerComponent } from "../components/tasks/src/ui/task-manager.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => `[${text.trim()}]`,
	bold: (text: string) => text,
};

describe("work manager entrypoints", () => {
	it("registers one shared /work command and Ctrl+W shortcut that open the tabbed modal", async () => {
		const commands = new Map<string, any[]>();
		const shortcuts = new Map<string, any[]>();
		const handlers = new Map<string, any[]>();
		const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
		const events = {
			on: (channel: string, handler: (data: unknown) => void) => {
				const listeners = eventHandlers.get(channel) ?? new Set();
				listeners.add(handler);
				eventHandlers.set(channel, listeners);
				return () => listeners.delete(handler);
			},
			emit: (channel: string, data: unknown) => {
				for (const listener of eventHandlers.get(channel) ?? []) listener(data);
			},
		};
		const pi = {
			events,
			on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
			registerCommand: (name: string, command: any) => commands.set(name, [...(commands.get(name) ?? []), command]),
			registerShortcut: (key: string, shortcut: any) => shortcuts.set(key, [...(shortcuts.get(key) ?? []), shortcut]),
			registerMessageRenderer: vi.fn(),
			registerTool: vi.fn(),
			sendMessage: vi.fn(),
		};
		installWorkManager(pi as any);
		installSubagents(pi as any);
		installTasks(pi as any);

		const selectedTabs: string[] = [];
		const custom = vi.fn(async (factory: any) => {
			let result: any;
			const component = factory(
				{ terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() },
				theme,
				undefined,
				(value: any) => {
					result = value;
				},
			);
			const rendered = component.render(100).join("\n");
			expect(rendered).toContain("Agents");
			expect(rendered).toContain("Tasks");
			selectedTabs.push(rendered.includes("[Tasks]") ? "tasks" : "agents");
			component.handleInput("q");
			component.dispose();
			return result;
		});
		const ctx = {
			cwd: process.cwd(),
			hasUI: true,
			mode: "tui",
			isProjectTrusted: () => false,
			ui: { custom, setStatus: vi.fn(), setWidget: vi.fn() },
		};

		expect(commands.get("work")).toHaveLength(1);
		expect(commands.get("agents")).toHaveLength(1);
		expect(commands.get("tasks")).toHaveLength(1);
		expect(shortcuts.get("ctrl+w")).toHaveLength(1);
		await commands.get("work")![0].handler("", ctx);
		await shortcuts.get("ctrl+w")![0].handler(ctx);
		await commands.get("agents")![0].handler("", ctx);
		await commands.get("tasks")![0].handler("", ctx);
		expect(selectedTabs).toEqual(["agents", "agents", "agents", "tasks"]);
		expect(custom).toHaveBeenCalledTimes(4);

		for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
	});

	it("renders the active section inside a rounded modal border", () => {
		const section: WorkSection = {
			key: "agents",
			label: "Agents",
			create: () => ({ render: () => ["Agents roster", "footer"], invalidate: () => {} }),
			inspect: async () => {},
		};
		const component = new WorkManagerComponent(
			{ terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() } as any,
			theme,
			[section],
			"agents",
			new Map(),
			vi.fn(),
			undefined,
		);

		const lines = component.render(60);
		expect(lines[0]).toMatch(/^╭─+╮$/);
		expect(lines.at(-1)).toMatch(/^╰─+╯$/);
		expect(lines.slice(1, -1).every((line) => line.startsWith("│") && line.endsWith("│"))).toBe(true);
		component.dispose();
	});

	it("switches tabs while preserving each tab's local selection", () => {
		const tui = { terminal: { rows: 20, columns: 100 }, requestRender: vi.fn() } as any;
		const section = (key: string, label: string): WorkSection => ({
			key,
			label,
			create: (_tui, _theme, _keybindings, selectedId, done) => {
				const ids = [`${key}-1`, `${key}-2`];
				let selected = Math.max(0, ids.indexOf(selectedId ?? ids[0]!));
				return {
					render: () => [`${label} roster`, `${ids[selected]}`, "footer"],
					handleInput: (data: string) => {
						if (data === "j") selected = Math.min(ids.length - 1, selected + 1);
						if (data === "\r") done({ type: "inspect", id: ids[selected]! });
					},
					invalidate: () => {},
				};
			},
			inspect: async () => {},
		});
		const done = vi.fn();
		const component = new WorkManagerComponent(
			tui,
			theme,
			[section("agents", "Agents"), section("tasks", "Tasks")],
			"agents",
			new Map(),
			done,
			undefined,
		);

		component.handleInput("j");
		expect(component.render(100).join("\n")).toContain("agents-2");
		component.handleInput("\t");
		expect(component.render(100).join("\n")).toContain("Tasks roster");
		component.handleInput("\x1b[Z");
		expect(component.render(100).join("\n")).toContain("agents-2");
		component.handleInput("\r");
		expect(done).toHaveBeenCalledWith({ type: "inspect", section: "agents", id: "agents-2" });
		component.dispose();
	});

	it("returns from detail to the same section and stable item ID", async () => {
		const manager = new WorkManager({ registerCommand: vi.fn(), registerShortcut: vi.fn() } as any);
		const selectedIds: Array<string | undefined> = [];
		const inspect = vi.fn(async () => {});
		manager.registerSection({
			key: "agents",
			label: "Agents",
			create: (_tui, _theme, _keybindings, selectedId, done) => {
				selectedIds.push(selectedId);
				return {
					render: () => ["Agents", "footer"],
					handleInput: (data: string) => done(data === "\r" ? { type: "inspect", id: "agent-2" } : { type: "close" }),
					invalidate: () => {},
				};
			},
			inspect,
		});
		let call = 0;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				custom: async (factory: any) => {
					let result: any;
					const component = factory(
						{ terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() },
						theme,
						undefined,
						(value: any) => {
							result = value;
						},
					);
					component.handleInput(call++ === 0 ? "\r" : "q");
					component.dispose();
					return result;
				},
			},
		} as any;

		await manager.open(ctx, "agents");
		expect(inspect).toHaveBeenCalledWith(ctx, "agent-2");
		expect(selectedIds).toEqual([undefined, "agent-2"]);
	});

	it("keeps the selected roster row visible while reserving height for the tab bar", () => {
		const tui = { terminal: { rows: 20, columns: 100 }, requestRender: vi.fn() } as any;
		const tasks: PromptTask[] = Array.from({ length: 30 }, (_, index) => ({
			id: `task-${index}`,
			kind: "prompt",
			prompt: `prompt ${index}`,
			createdAt: index,
			dueAt: index + 60_000,
			status: "scheduled",
		}));
		const sections: WorkSection[] = [
			{
				key: "agents",
				label: "Agents",
				create: () => ({ render: () => ["Agents", "footer"], invalidate: () => {} }),
				inspect: async () => {},
			},
			{
				key: "tasks",
				label: "Tasks",
				create: (sectionTui, sectionTheme, keybindings, selectedId, done, reservedLines) =>
					new TaskManagerComponent(sectionTui, sectionTheme, () => tasks, selectedId, done, keybindings, reservedLines),
				inspect: async () => {},
			},
		];
		const component = new WorkManagerComponent(
			tui,
			theme,
			sections,
			"tasks",
			new Map([["tasks", "task-0"]]),
			vi.fn(),
			undefined,
		);

		const lines = component.render(100);
		expect(lines.length).toBeLessThanOrEqual(16);
		expect(lines.join("\n")).toContain("> ● Prompt task-0");
		component.dispose();
	});
});
