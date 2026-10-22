import { describe, expect, it, vi } from "vitest";
import {
	installWorkManager,
	WORK_PANEL_FOCUS_KEY,
	WorkManager,
	type WorkSection,
	type WorkSectionComponent,
} from "../components/shared/src/work-manager.js";
import installTasks from "../components/tasks/src/index.js";
import { type FakeScreen, fakeCustom, fakeTui } from "./helpers/fake-tui.js";

const ESC = "\x1b";
const ALT_G = "\x1bg";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";

function fakePi() {
	const commands = new Map<string, any[]>();
	const shortcuts = new Map<string, any[]>();
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
		on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		registerCommand: (name: string, command: any) => commands.set(name, [...(commands.get(name) ?? []), command]),
		registerShortcut: (key: string, shortcut: any) => shortcuts.set(key, [...(shortcuts.get(key) ?? []), shortcut]),
		registerMessageRenderer: vi.fn(),
		registerTool: vi.fn(),
		sendMessage: vi.fn(),
		appendEntry: vi.fn(),
	};
	return { pi, commands, shortcuts, handlers };
}

function fakeCtx(screen: FakeScreen) {
	const { custom, modalScripts } = fakeCustom(screen);
	return {
		cwd: process.cwd(),
		hasUI: true,
		mode: "tui",
		isProjectTrusted: () => false,
		ui: { custom, setStatus: vi.fn(), setWidget: vi.fn() },
		modalScripts,
	} as any;
}

function listSection(key: string, label: string) {
	const created: WorkSectionComponent[] = [];
	const section: WorkSection = {
		key,
		label,
		create: (_ui, selectedId) => {
			const ids = [`${key}-1`, `${key}-2`, `${key}-3`];
			let selected = Math.max(0, ids.indexOf(selectedId ?? ids[0]!));
			let scroll = 0;
			const component: WorkSectionComponent = {
				focused: false,
				rowBudget: 0,
				render: (width) => {
					const row = (text: string) => `${text.padEnd(width - 1)}\u2502`;
					return [
						row(`\u2502 ${label} records`),
						row(`\u2502 > ${ids[selected]} scroll=${scroll}`),
						`\u2570${"\u2500".repeat(width - 2)}\u256f`,
					];
				},
				handleInput: (data) => {
					if (data === "\t") selected = (selected + 1) % ids.length;
					else if (data === "j") scroll++;
				},
				handleMouse: (event) => {
					if (event.type === "wheel") scroll += event.wheelDelta ?? 0;
					return { handled: true };
				},
				getSelectedId: () => ids[selected],
				title: () => `${label} \u00b7 ${ids.length}`,
				invalidate: () => {},
				dispose: vi.fn(),
			};
			created.push(component);
			return component;
		},
	};
	return { section, created };
}

function managerWithSections(screen: FakeScreen) {
	const { pi, shortcuts, commands } = fakePi();
	const manager = new WorkManager(pi as any);
	const tasks = listSection("tasks", "Tasks");
	const programs = listSection("pi-exec", "Pi Exec");
	manager.registerSection(tasks.section);
	manager.registerSection(programs.section);
	const ctx = fakeCtx(screen);
	const panel = () => screen.stack[0]?.component;
	const text = () => screen.layout(screen.stack[0]!).lines.join("\n");
	const focus = () => shortcuts.get(WORK_PANEL_FOCUS_KEY)![0].handler(ctx);
	return { manager, pi, shortcuts, commands, tasks, programs, ctx, panel, text, focus };
}

describe("work panel entrypoints", () => {
	it("reuses one non-capturing panel for /work and /tasks without a picker", async () => {
		const { pi, commands, shortcuts, handlers } = fakePi();
		installWorkManager(pi as any);
		installTasks(pi as any);
		const screen = fakeTui(160, 40);
		const ctx = fakeCtx(screen);

		expect(commands.get("work")).toHaveLength(1);
		expect(commands.has("agents")).toBe(false);
		expect(commands.get("tasks")).toHaveLength(1);
		expect(shortcuts.get("ctrl+w")).toHaveLength(1);
		expect(shortcuts.get(WORK_PANEL_FOCUS_KEY)).toHaveLength(1);
		await commands.get("work")![0].handler("", ctx);
		expect(screen.stack).toHaveLength(1);
		const [entry] = screen.stack;
		expect(entry!.options.nonCapturing).toBe(true);
		expect(screen.focused()).toBe(screen.editor);
		expect(screen.editor.text).toBe("draft to main agent");
		const text = () => screen.layout(entry!).lines.join("\n");
		expect(text()).toContain("[Tasks");
		await commands.get("tasks")![0].handler("", ctx);
		await commands.get("work")![0].handler("", ctx);
		expect(text()).toContain("[Tasks");
		expect(screen.tui.showOverlay).toHaveBeenCalledTimes(1);
		expect(screen.stack).toEqual([entry]);
		expect(screen.tui.showOverlay.mock.calls.every(([, options]) => options?.nonCapturing)).toBe(true);
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		expect(entry!.handle.hide).toHaveBeenCalled();
		expect(screen.stack).toHaveLength(0);
	});

	it("toggles with Ctrl+W and restores the selected record", async () => {
		const screen = fakeTui(160, 40);
		const { shortcuts, commands, ctx, focus, panel, text } = managerWithSections(screen);
		const toggle = () => shortcuts.get("ctrl+w")![0].handler(ctx);
		await toggle();
		expect(screen.stack).toHaveLength(1);
		await commands.get("tasks")![0].handler("", ctx);
		focus();
		panel()!.handleInput!("\t");
		expect(text()).toContain("tasks-2");
		await toggle();
		expect(screen.stack).toHaveLength(0);
		expect(screen.focused()).toBe(screen.editor);
		await toggle();
		expect(screen.stack).toHaveLength(1);
		expect(text()).toContain("[Tasks");
		expect(text()).toContain("tasks-2");
		expect(screen.focused()).toBe(screen.editor);
		await toggle();
		expect(screen.stack).toHaveLength(0);
	});

	it("places the panel top-right when wide and top-center when narrow without remounting or hiding it", async () => {
		const screen = fakeTui(160, 40);
		const { manager, ctx, tasks, panel, focus } = managerWithSections(screen);
		await manager.open(ctx);
		const [entry] = screen.stack;
		const component = panel();
		let placed = screen.layout(entry!);
		expect(placed.anchor).toBe("top-right");
		expect(placed.width).toBe(Math.floor(160 * 0.33));
		expect(placed.maxHeight).toBe(Math.floor(40 * 0.7));
		focus();
		component.handleInput("\t");
		component.handleInput("j");
		screen.tui.terminal.columns = 100;
		placed = screen.layout(entry!);
		expect(placed.anchor).toBe("top-center");
		expect(placed.width).toBe(90);
		expect(placed.maxHeight).toBe(20);
		expect(placed.lines.length).toBeGreaterThan(0);
		expect(placed.lines.join("\n")).toContain("> tasks-2 scroll=1");
		expect(entry!.options.visible?.(80, 40) ?? true).toBe(true);
		screen.tui.terminal.columns = 160;
		placed = screen.layout(entry!);
		expect(placed.anchor).toBe("top-right");
		expect(placed.lines.join("\n")).toContain("> tasks-2 scroll=1");
		expect(screen.stack).toEqual([entry]);
		expect(screen.stack[0]!.component).toBe(component);
		expect(tasks.created).toHaveLength(1);
		expect(screen.tui.showOverlay).toHaveBeenCalledTimes(1);
	});

	it("gives each tab a row budget matching the current placement height", async () => {
		const screen = fakeTui(160, 40);
		const { manager, ctx, tasks, panel } = managerWithSections(screen);
		await manager.open(ctx);
		panel().render(52);
		expect(tasks.created[0]!.rowBudget).toBe(Math.floor(40 * 0.7) - 2);
		screen.tui.terminal.columns = 100;
		panel().render(90);
		expect(tasks.created[0]!.rowBudget).toBe(Math.floor(40 * 0.5) - 2);
	});
});

describe("work panel focus and tabs", () => {
	it("moves focus with Alt+G, returns it with Esc, and closes with q", async () => {
		const screen = fakeTui();
		const { manager, ctx, shortcuts, panel, tasks } = managerWithSections(screen);
		const altG = () => shortcuts.get(WORK_PANEL_FOCUS_KEY)![0].handler(ctx);
		expect(() => altG()).not.toThrow();
		await manager.open(ctx);
		const [entry] = screen.stack;
		expect(screen.focused()).toBe(screen.editor);
		altG();
		expect(screen.focused()).toBe(panel());
		expect(tasks.created[0]!.focused).toBe(true);
		panel().handleInput(ESC);
		expect(screen.focused()).toBe(screen.editor);
		expect(tasks.created[0]!.focused).toBe(false);
		expect(screen.editor.text).toBe("draft to main agent");
		altG();
		panel().handleInput(ALT_G);
		expect(screen.focused()).toBe(screen.editor);
		altG();
		altG();
		expect(screen.focused()).toBe(screen.editor);
		altG();
		panel().handleInput("q");
		expect(entry!.handle.hide).toHaveBeenCalled();
		expect(screen.stack).toHaveLength(0);
		expect(screen.focused()).toBe(screen.editor);
		expect(tasks.created[0]!.dispose).toHaveBeenCalled();
		expect(() => altG()).not.toThrow();
	});

	it("switches tabs by click and left/right while each keeps its selection and scroll", async () => {
		const screen = fakeTui();
		const { manager, ctx, panel, text, focus } = managerWithSections(screen);
		await manager.open(ctx);
		focus();
		panel().handleInput("\t");
		panel().handleInput("j");
		expect(text()).toContain("> tasks-2 scroll=1");
		const programsX = text().split("\n")[1]!.indexOf("Pi Exec");
		panel().handleMouse({ type: "press", button: "left", x: programsX, y: 1 } as any);
		expect(text()).toContain("[Pi Exec");
		expect(text()).toContain("> pi-exec-1 scroll=0");
		panel().handleInput("\t");
		panel().handleInput(LEFT);
		expect(text()).toContain("[Tasks");
		expect(text()).toContain("> tasks-2 scroll=1");
		panel().handleInput(RIGHT);
		expect(text()).toContain("> pi-exec-2 scroll=0");
	});

	it("focuses on a left press and forwards wheel scrolling to the active tab", async () => {
		const screen = fakeTui();
		const { manager, ctx, panel, text } = managerWithSections(screen);
		await manager.open(ctx);
		expect(panel().handleMouse({ type: "press", button: "left", x: 3, y: 4 } as any)).toMatchObject({ focus: true });
		panel().handleMouse({ type: "wheel", button: "none", x: 3, y: 4, wheelDelta: 3 } as any);
		expect(text()).toContain("scroll=3");
	});

	it("reopens on the last tab and selected row for the manager's lifetime without session persistence", async () => {
		const screen = fakeTui();
		const first = managerWithSections(screen);
		await first.manager.open(first.ctx);
		first.focus();
		first.panel().handleInput(RIGHT);
		first.panel().handleInput("\t");
		first.panel().handleInput("q");
		expect(screen.stack).toHaveLength(0);
		await first.manager.open(first.ctx);
		expect(first.text()).toContain("[Pi Exec");
		expect(first.text()).toContain("> pi-exec-2");
		await first.manager.open(first.ctx, "tasks");
		expect(first.text()).toContain("[Tasks");
		first.panel().handleInput("q");
		await first.manager.open(first.ctx);
		expect(first.text()).toContain("[Tasks");
		expect(first.pi.appendEntry).not.toHaveBeenCalled();
		first.panel().handleInput("q");
		const fresh = managerWithSections(screen);
		await fresh.manager.open(fresh.ctx);
		expect(fresh.text()).toContain("[Tasks");
		expect(fresh.text()).toContain("> tasks-1");
		expect(fresh.pi.appendEntry).not.toHaveBeenCalled();
	});
});
