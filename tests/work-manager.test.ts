import { describe, expect, it, vi } from "vitest";
import {
	installWorkManager,
	WORK_PANEL_FOCUS_KEY,
	WorkManager,
	type WorkSection,
	type WorkSectionComponent,
} from "../components/shared/src/work-manager.js";
import installSubagents from "../components/subagents/src/installer.js";
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

/** A section whose rows, selection, and draft live in its component, so tests can observe what survives. */
function listSection(key: string, label: string) {
	const created: WorkSectionComponent[] = [];
	const section: WorkSection = {
		key,
		label,
		create: (_ui, selectedId) => {
			const ids = [`${key}-1`, `${key}-2`, `${key}-3`];
			let selected = Math.max(0, ids.indexOf(selectedId ?? ids[0]!));
			let draft: string | undefined;
			let scroll = 0;
			const component: WorkSectionComponent = {
				focused: false,
				rowBudget: 0,
				render: (width) => {
					const row = (text: string) => `${text.padEnd(width - 1)}│`;
					return [
						row(`│ ${label} roster`),
						row(`│ > ${ids[selected]} scroll=${scroll}${draft === undefined ? "" : ` draft=${draft}`}`),
						`╰${"─".repeat(width - 2)}╯`,
					];
				},
				handleInput: (data) => {
					if (draft !== undefined) {
						if (data === "\r") draft = undefined;
						else draft += data;
						return;
					}
					if (data === "\t") selected = (selected + 1) % ids.length;
					else if (data === "\r") draft = "";
					else if (data === "j") scroll++;
				},
				handleMouse: (event) => {
					if (event.type === "wheel") scroll += event.wheelDelta ?? 0;
					return { handled: true };
				},
				isComposing: () => draft !== undefined,
				getSelectedId: () => ids[selected],
				title: () => `${label} · ${ids.length}`,
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
	const agents = listSection("agents", "Agents");
	const tasks = listSection("tasks", "Tasks");
	manager.registerSection(agents.section);
	manager.registerSection(tasks.section);
	const ctx = fakeCtx(screen);
	const panel = () => screen.stack[0]?.component;
	const text = () => screen.layout(screen.stack[0]!).lines.join("\n");
	const focus = () => shortcuts.get(WORK_PANEL_FOCUS_KEY)![0].handler(ctx);
	return { manager, pi, shortcuts, commands, agents, tasks, ctx, panel, text, focus };
}

describe("work panel entrypoints", () => {
	it("reuses one non-capturing panel for /work and the tab aliases without a picker", async () => {
		const { pi, commands, shortcuts, handlers } = fakePi();
		installWorkManager(pi as any);
		installSubagents(pi as any);
		installTasks(pi as any);
		const screen = fakeTui(160, 40);
		const ctx = fakeCtx(screen);

		expect(commands.get("work")).toHaveLength(1);
		expect(commands.get("agents")).toHaveLength(1);
		expect(commands.get("tasks")).toHaveLength(1);
		expect(shortcuts.get("ctrl+w")).toHaveLength(1);
		expect(shortcuts.get(WORK_PANEL_FOCUS_KEY)).toHaveLength(1);

		await commands.get("work")![0].handler("", ctx);
		expect(screen.stack).toHaveLength(1);
		const [entry] = screen.stack;
		expect(entry!.options.nonCapturing).toBe(true);
		// The editor keeps focus and its draft; nothing capturing was mounted.
		expect(screen.focused()).toBe(screen.editor);
		expect(screen.editor.text).toBe("draft to main agent");
		const text = () => screen.layout(entry!).lines.join("\n");
		expect(text()).toContain("[Agents");
		expect(text()).toContain("Tasks");

		await commands.get("tasks")![0].handler("", ctx);
		expect(text()).toContain("[Tasks");
		await commands.get("work")![0].handler("", ctx);
		expect(text()).toContain("[Tasks");
		await commands.get("agents")![0].handler("", ctx);
		expect(text()).toContain("[Agents");
		await commands.get("work")![0].handler("", ctx);
		expect(text()).toContain("[Agents");

		// Repeated commands reused the same overlay.
		expect(screen.tui.showOverlay).toHaveBeenCalledTimes(1);
		expect(screen.stack).toEqual([entry]);
		expect(screen.tui.showOverlay.mock.calls.every(([, options]) => options?.nonCapturing)).toBe(true);

		for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		expect(entry!.handle.hide).toHaveBeenCalled();
		expect(screen.stack).toHaveLength(0);
	});

	it("toggles with Ctrl+W and restores the last tab and selected record", async () => {
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
		const { manager, ctx, agents, panel, focus } = managerWithSections(screen);
		await manager.open(ctx);
		const [entry] = screen.stack;
		const component = panel();

		let placed = screen.layout(entry!);
		expect(placed.anchor).toBe("top-right");
		expect(placed.width).toBe(Math.floor(160 * 0.33));
		expect(placed.maxHeight).toBe(Math.floor(40 * 0.7));

		// Move selection and scroll, then shrink below 120 columns.
		focus();
		component.handleInput("\t");
		component.handleInput("j");
		screen.tui.terminal.columns = 100;
		placed = screen.layout(entry!);
		expect(placed.anchor).toBe("top-center");
		expect(placed.width).toBe(90);
		expect(placed.maxHeight).toBe(20);
		expect(placed.lines.length).toBeGreaterThan(0);
		expect(placed.lines.join("\n")).toContain("> agents-2 scroll=1");
		expect(entry!.options.visible?.(80, 40) ?? true).toBe(true);

		// Widening restores the wide placement with the same component and state.
		screen.tui.terminal.columns = 160;
		placed = screen.layout(entry!);
		expect(placed.anchor).toBe("top-right");
		expect(placed.lines.join("\n")).toContain("> agents-2 scroll=1");
		expect(screen.stack).toEqual([entry]);
		expect(screen.stack[0]!.component).toBe(component);
		expect(agents.created).toHaveLength(1);
		expect(screen.tui.showOverlay).toHaveBeenCalledTimes(1);
	});

	it("gives each tab a row budget matching the current placement height", async () => {
		const screen = fakeTui(160, 40);
		const { manager, ctx, agents, panel } = managerWithSections(screen);
		await manager.open(ctx);
		panel().render(52);
		const wideBudget = agents.created[0]!.rowBudget;
		expect(wideBudget).toBe(Math.floor(40 * 0.7) - 2);
		screen.tui.terminal.columns = 100;
		panel().render(90);
		expect(agents.created[0]!.rowBudget).toBe(Math.floor(40 * 0.5) - 2);
	});
});

describe("work panel focus and tabs", () => {
	it("moves focus with Alt+G, returns it with Esc, and closes with q only when not composing", async () => {
		const screen = fakeTui();
		const { manager, ctx, shortcuts, panel, agents } = managerWithSections(screen);
		const altG = () => shortcuts.get(WORK_PANEL_FOCUS_KEY)![0].handler(ctx);

		// Without a panel, Alt+G is a no-op.
		expect(() => altG()).not.toThrow();
		await manager.open(ctx);
		const [entry] = screen.stack;
		expect(screen.focused()).toBe(screen.editor);

		altG();
		expect(screen.focused()).toBe(panel());
		expect(agents.created[0]!.focused).toBe(true);
		panel().handleInput(ESC);
		expect(screen.focused()).toBe(screen.editor);
		expect(agents.created[0]!.focused).toBe(false);
		expect(screen.editor.text).toBe("draft to main agent");

		altG();
		panel().handleInput(ALT_G);
		expect(screen.focused()).toBe(screen.editor);
		altG();
		altG();
		expect(screen.focused()).toBe(screen.editor);

		// While composing, arrows, Esc, and q reach the composer.
		altG();
		panel().handleInput("\r");
		for (const key of [LEFT, RIGHT, "q", "\t"]) panel().handleInput(key);
		expect(screen.stack).toEqual([entry]);
		expect(screen.layout(entry!).lines.join("\n")).toContain("[Agents");
		expect(screen.focused()).toBe(panel());
		panel().handleInput("\r");

		panel().handleInput("q");
		expect(entry!.handle.hide).toHaveBeenCalled();
		expect(screen.stack).toHaveLength(0);
		expect(screen.focused()).toBe(screen.editor);
		expect(agents.created[0]!.dispose).toHaveBeenCalled();
		expect(() => altG()).not.toThrow();
	});

	it("switches tabs with left/right while each tab keeps its selection, scroll, and draft", async () => {
		const screen = fakeTui();
		const { manager, ctx, panel, text, focus } = managerWithSections(screen);
		await manager.open(ctx);
		focus();

		panel().handleInput("\t");
		panel().handleInput("j");
		panel().handleInput("\r");
		for (const ch of "kept") panel().handleInput(ch);
		expect(text()).toContain("> agents-2 scroll=1 draft=kept");
		// Composing keeps arrows in the composer; clicking a tab label still switches tabs.
		const tasksX = text().split("\n")[1]!.indexOf("Tasks");
		panel().handleMouse({ type: "press", button: "left", x: tasksX, y: 1 } as any);
		expect(text()).toContain("[Tasks");
		expect(text()).toContain("> tasks-1 scroll=0");
		panel().handleInput("\t");
		panel().handleInput(LEFT);
		expect(text()).toContain("[Agents");
		expect(text()).toContain("> agents-2 scroll=1 draft=kept");
		panel().handleInput("\r");
		panel().handleInput(RIGHT);
		expect(text()).toContain("> tasks-2 scroll=0");
	});

	it("focuses on a left press and forwards wheel scrolling to the active tab", async () => {
		const screen = fakeTui();
		const { manager, ctx, panel, text } = managerWithSections(screen);
		await manager.open(ctx);
		expect(panel().handleMouse({ type: "press", button: "left", x: 3, y: 4 } as any)).toMatchObject({
			focus: true,
		});
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
		expect(first.text()).toContain("[Tasks");
		expect(first.text()).toContain("> tasks-2");
		await first.manager.open(first.ctx, "agents");
		expect(first.text()).toContain("[Agents");
		first.panel().handleInput("q");
		await first.manager.open(first.ctx);
		expect(first.text()).toContain("[Agents");
		expect(first.pi.appendEntry).not.toHaveBeenCalled();
		first.panel().handleInput("q");

		const fresh = managerWithSections(screen);
		await fresh.manager.open(fresh.ctx);
		expect(fresh.text()).toContain("[Agents");
		expect(fresh.text()).toContain("> agents-1");
		expect(fresh.pi.appendEntry).not.toHaveBeenCalled();
	});
});
