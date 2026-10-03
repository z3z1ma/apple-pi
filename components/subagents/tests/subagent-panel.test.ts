import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { fakeCustom, fakeTui } from "../../../tests/helpers/fake-tui.js";
import { installWorkManager, WORK_PANEL_FOCUS_KEY } from "../../shared/src/work-manager.js";
import installTasks from "../../tasks/src/index.js";
import installSubagents from "../src/index.js";
import type { AgentRecord } from "../src/types.js";
import { AgentPanel } from "../src/ui/agent-panel.js";
import type { AgentActivity } from "../src/ui/agent-widget.js";

const ESC = "\x1b";
const ALT_G = "\x1bg";
const ENTER = "\r";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const PANEL_WIDTH = 60;

const temporaryDirectories: string[] = [];
const fauxProviders: Array<{ unregister(): void }> = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const isolatedAgentDir = mkdtempSync(join(tmpdir(), "apple-pi-panel-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;

afterEach(() => {
	for (const provider of fauxProviders.splice(0)) provider.unregister();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(isolatedAgentDir, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

function harness(cwd: string, model: any, modelRegistry: any) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const lifecycle = new Map<string, Array<(...args: any[]) => any>>();
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const pi = {
		registerMessageRenderer: () => {},
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerShortcut: (key: string, shortcut: any) => shortcuts.set(key, shortcut),
		on: (event: string, handler: (...args: any[]) => any) =>
			lifecycle.set(event, [...(lifecycle.get(event) ?? []), handler]),
		events: {
			emit: (name: string, payload: unknown) => {
				for (const listener of listeners.get(name) ?? []) listener(payload);
			},
			on: (name: string, listener: (payload: unknown) => void) => {
				const set = listeners.get(name) ?? new Set();
				set.add(listener);
				listeners.set(name, set);
				return () => set.delete(listener);
			},
		},
		sendMessage: () => {},
		appendEntry: vi.fn(),
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
	} as any;
	installWorkManager(pi);
	installSubagents(pi);
	installTasks(pi);

	const screen = fakeTui(160, 40);
	const { custom, modalScripts } = fakeCustom(screen);
	const ctx = {
		cwd,
		model,
		modelRegistry,
		getSystemPrompt: () => "parent",
		sessionManager: { getSessionFile: () => undefined },
		isProjectTrusted: () => true,
		hasUI: true,
		mode: "tui",
		ui: { custom, setWidget: vi.fn(), setStatus: vi.fn(), notify: vi.fn(), select: vi.fn() },
	} as any;

	const launch = async (id: string, description: string, background: boolean) => {
		const result = await tools.get("agent").execute(
			id,
			{
				prompt: `prompt for ${description}`,
				description,
				subagent_type: "panel-test",
				run_in_background: background,
			},
			undefined,
			undefined,
			ctx,
		);
		return (result.content[0].text as string).match(/Agent ID: ([^\s]+)/)?.[1] as string;
	};
	const shutdown = async () => {
		for (const handler of lifecycle.get("session_shutdown") ?? []) await handler({}, ctx);
	};
	const altG = () => shortcuts.get(WORK_PANEL_FOCUS_KEY).handler(ctx);
	return { tools, commands, shortcuts, ctx, custom, modalScripts, screen, launch, shutdown, altG, pi };
}

function setupProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-panel-"));
	temporaryDirectories.push(cwd);
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "agents", "panel-test.md"),
		"---\nname: panel-test\ndescription: panel test role\ntools: read\nextensions: false\nskills: false\npersist_session: false\n---\nAnswer the task.\n",
	);
	return cwd;
}

describe("Agents tab of the work panel", () => {
	it("opens directly from /agents and keeps steer, abort, focus, tabs, resize, and close", async () => {
		const cwd = setupProject();
		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-panel", contextWindow: 200_000 }] });
		fauxProviders.push(faux);
		let releaseLive!: () => void;
		const liveGate = new Promise<void>((resolve) => {
			releaseLive = resolve;
		});
		let releaseStop!: () => void;
		const stopGate = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		let liveStarted = false;
		let stopStarted = false;
		let steeredContext = "";
		faux.setResponses([
			() => fauxAssistantMessage([fauxText("FINISHED-OUTPUT")]),
			async () => {
				liveStarted = true;
				await liveGate;
				return fauxAssistantMessage([fauxText("LIVE-STEP")]);
			},
		]);
		const model = faux.getModel();
		const { modelRegistry } = fauxModelBackend(model);
		const previousCwd = process.cwd();
		process.chdir(cwd);
		const h = harness(cwd, model, modelRegistry);
		try {
			await h.launch("finished", "Finished task", false);
			const liveId = await h.launch("live", "Live task", true);
			await waitFor(() => liveStarted, "live agent request");
			faux.appendResponses([
				async () => {
					stopStarted = true;
					await stopGate;
					return fauxAssistantMessage([fauxText("MUST-NOT-FINISH")]);
				},
			]);
			const stopId = await h.launch("stoppable", "Stoppable task", true);
			await waitFor(() => stopStarted, "stoppable agent request");

			// Alt+G without an open panel is a no-op.
			expect(() => h.altG()).not.toThrow();
			expect(h.screen.stack).toHaveLength(0);

			await h.commands.get("agents").handler("", h.ctx);
			expect(h.screen.stack).toHaveLength(1);
			const [entry] = h.screen.stack;
			const panel = entry!.component;
			expect(entry!.options.nonCapturing).toBe(true);
			expect(h.screen.layout(entry!)).toMatchObject({ anchor: "top-right", width: Math.floor(160 * 0.33) });
			// No picker or pin step: the bootstrap mounted nothing capturing, and the editor kept its draft.
			expect(h.screen.focused()).toBe(h.screen.editor);
			expect(h.screen.editor.text).toBe("draft to main agent");
			expect(h.screen.tui.showOverlay).toHaveBeenCalledTimes(1);

			const rendered = () => h.screen.layout(entry!).lines.join("\n");
			expect(rendered()).toContain("[Agents · 3]");
			expect(rendered()).toContain("Finished task");
			expect(rendered()).toContain("Live task");
			expect(rendered()).toContain("Stoppable task");
			const select = (description: string) => {
				for (let index = 0; index < 4 && !rendered().includes(`prompt for ${description}`); index++) {
					panel.handleInput("\t");
				}
				expect(rendered()).toContain(`prompt for ${description}`);
			};

			// A modal opened and closed above the panel leaves it mounted.
			h.modalScripts.push((modal) => modal.handleInput("q"));
			await h.ctx.ui.custom(
				(_tui: any, _theme: any, _keybindings: any, done: (value: undefined) => void) => ({
					render: () => ["modal"],
					handleInput: () => done(undefined),
					invalidate: () => {},
				}),
				{ overlay: true },
			);
			expect(h.screen.stack).toEqual([entry]);

			// Unfocused, the header points at Alt+G; focused, it shows the tab's keys, including the types view.
			expect(rendered().split("\n")[1]).toContain("Alt+G focus");
			// Alt+G focuses; Esc returns focus with the draft unchanged.
			h.altG();
			expect(h.screen.focused()).toBe(panel);
			expect(rendered().split("\n")[1]).toContain("←/→ tabs · t types");
			select("Live task");
			panel.handleInput(ESC);
			expect(h.screen.focused()).toBe(h.screen.editor);
			expect(h.screen.editor.text).toBe("draft to main agent");
			h.altG();
			panel.handleInput(ALT_G);
			expect(h.screen.focused()).toBe(h.screen.editor);

			// Start a steering draft, then switch tabs by mouse and resize: the draft survives.
			h.altG();
			panel.handleInput(ENTER);
			for (const ch of "use the") panel.handleInput(ch);
			panel.handleInput(RIGHT);
			panel.handleInput("q");
			expect(h.screen.stack).toEqual([entry]);
			expect(rendered()).toContain("[Agents · 3]");
			expect(rendered()).toContain("use theq");
			panel.handleInput("\x7f");
			const tabRow = rendered().split("\n")[1]!;
			panel.handleMouse({ type: "press", button: "left", x: tabRow.indexOf("Tasks"), y: 1 });
			expect(rendered()).toContain("[Tasks · 0]");
			expect(rendered()).toContain("(no tasks)");
			h.screen.tui.terminal.columns = 100;
			expect(h.screen.layout(entry!)).toMatchObject({ anchor: "top-center", width: 90, maxHeight: 20 });
			panel.handleInput(LEFT);
			expect(rendered()).toContain("[Agents · 3]");
			expect(rendered()).toContain("prompt for Live task");
			expect(rendered()).toContain("use the");
			expect(h.screen.layout(entry!).lines.length).toBeLessThanOrEqual(20);
			h.screen.tui.terminal.columns = 160;
			expect(h.screen.layout(entry!).anchor).toBe("top-right");
			expect(h.screen.stack[0]!.component).toBe(panel);

			// Finishing the draft steers the selected agent; its new output appears live.
			faux.appendResponses([
				(context) => {
					steeredContext = JSON.stringify(context.messages);
					return fauxAssistantMessage([fauxText("STEER-ACK")]);
				},
			]);
			for (const ch of " cache") panel.handleInput(ch);
			panel.handleInput(ENTER);
			releaseLive();
			await waitFor(() => rendered().includes("STEER-ACK"), "steered output in the panel");
			expect(steeredContext).toContain("use the cache");
			const liveResult = await h.tools
				.get("get_subagent_result")
				.execute("live-check", { agent_id: liveId, yield_seconds: 0 }, undefined);
			expect(liveResult.content[0].text).toContain("STEER-ACK");

			// An armed abort does not survive giving focus away or a tab switch.
			select("Stoppable task");
			panel.handleInput("x");
			expect(rendered()).toContain("x again to STOP");
			panel.handleInput(ALT_G);
			h.altG();
			expect(rendered()).not.toContain("x again to STOP");
			panel.handleInput("x");
			panel.handleInput(RIGHT);
			panel.handleInput(LEFT);
			expect(rendered()).not.toContain("x again to STOP");
			expect(rendered()).toContain("running");

			// x twice aborts the selected agent.
			panel.handleInput("x");
			panel.handleInput("x");
			await waitFor(() => rendered().includes("stopped"), "stopped status in the panel");
			const stopResult = await h.tools
				.get("get_subagent_result")
				.execute("stop-check", { agent_id: stopId, yield_seconds: 0 }, undefined);
			expect(stopResult.content[0].text).toContain("STOPPED BY THE USER");

			// With nothing running, the panel stays mounted and lists finished agents.
			expect(h.screen.stack).toEqual([entry]);
			expect(rendered()).toContain("Finished task");

			// q closes through the panel's own handle and returns focus to the editor.
			panel.handleInput("q");
			expect(entry!.handle.hide).toHaveBeenCalled();
			expect(h.screen.stack).toHaveLength(0);
			expect(h.screen.focused()).toBe(h.screen.editor);
			expect(() => h.altG()).not.toThrow();

			// /work reopens on the last tab and agent; shutdown closes it.
			await h.commands.get("work").handler("", h.ctx);
			const reopened = h.screen.stack[0]!;
			expect(h.screen.layout(reopened).lines.join("\n")).toContain("[Agents · 3]");
			expect(h.screen.layout(reopened).lines.join("\n")).toContain("prompt for Stoppable task");
			expect(h.pi.appendEntry).not.toHaveBeenCalled();
			await h.shutdown();
			expect(reopened.handle.hide).toHaveBeenCalled();
			expect(h.screen.stack).toHaveLength(0);
		} finally {
			releaseLive();
			releaseStop();
			await h.shutdown();
			process.chdir(previousCwd);
		}
	}, 30_000);
});

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

describe("AgentPanel component", () => {
	function panelSession(messages: any[] = []) {
		return {
			messages,
			state: {},
			subscribe: vi.fn(() => vi.fn()),
			getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheWrite: 0 } }),
		} as any;
	}

	function panelRecord(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
		return {
			id,
			type: "panel-test",
			description: `Task ${id}`,
			status: "running",
			toolUses: 0,
			startedAt: Date.now(),
			session: panelSession([{ role: "user", content: `HELLO-${id}` }]),
			invocation: { modelName: "faux", runInBackground: true },
			...overrides,
		} as AgentRecord;
	}

	function activity(toolUses: number): AgentActivity {
		return {
			activeTools: new Map(),
			toolUses,
			responseText: "",
			turnCount: 1,
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		};
	}

	function makePanel(
		records: AgentRecord[],
		rows = 40,
		activities = new Map<string, AgentActivity>(),
		extra: Partial<ConstructorParameters<typeof AgentPanel>[0]> = {},
	) {
		const steer = vi.fn();
		const stop = vi.fn();
		const panel = new AgentPanel({
			tui: { terminal: { rows, columns: 160 }, requestRender: vi.fn() } as any,
			theme,
			listAgents: () => records,
			getActivity: (id) => activities.get(id),
			stop,
			steer,
			...extra,
		});
		// The work panel's budget: 70% of the terminal less its border and tab row.
		panel.rowBudget = Math.floor((rows * 70) / 100) - 2;
		if (records[0]) panel.select(records[0].id);
		return { panel, steer, stop };
	}

	const type = (panel: AgentPanel, text: string) => {
		for (const ch of text) panel.handleInput(ch);
	};

	it("scrolls the conversation with the mouse wheel", () => {
		const lines = Array.from({ length: 80 }, (_, index) => `LINE-${index}`).join("\n");
		const record = panelRecord("a", {
			session: panelSession([
				{ role: "user", content: "HELLO-a" },
				{ role: "assistant", content: [{ type: "text", text: lines }] },
			]),
		});
		const { panel } = makePanel([record]);
		const mouse = (type: string, extra: object = {}) =>
			panel.handleMouse({
				type,
				button: "left",
				x: 1,
				y: 1,
				screenX: 1,
				screenY: 1,
				width: PANEL_WIDTH,
				height: 20,
				shift: false,
				alt: false,
				ctrl: false,
				...extra,
			} as any);

		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("LINE-79");

		expect(mouse("wheel", { button: "none", wheelDelta: -40 })).toMatchObject({ handled: true });
		const scrolled = panel.render(PANEL_WIDTH).join("\n");
		expect(scrolled).not.toContain("LINE-79");

		mouse("wheel", { button: "none", wheelDelta: 40 });
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("LINE-79");
		panel.dispose();
	});

	it("emits the composer cursor only while the panel holds focus", () => {
		const { panel } = makePanel([panelRecord("a"), panelRecord("b")]);
		panel.focused = true;
		panel.handleInput(ENTER);
		type(panel, "draft");
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain(CURSOR_MARKER);

		// Focus moves elsewhere (e.g. /btw opens): no cursor marker, draft kept.
		panel.focused = false;
		const unfocused = panel.render(PANEL_WIDTH).join("\n");
		expect(unfocused).not.toContain(CURSOR_MARKER);
		expect(unfocused).toContain("draft");

		panel.focused = true;
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain(CURSOR_MARKER);

		// A viewer created for another agent inherits the panel's focus.
		panel.handleInput(ESC); // cancel the composer
		panel.handleInput("\t");
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("HELLO-b");
		panel.handleInput(ENTER);
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain(CURSOR_MARKER);
		panel.focused = false;
		expect(panel.render(PANEL_WIDTH).join("\n")).not.toContain(CURSOR_MARKER);
		panel.dispose();
	});

	it("keeps the steering input and a conversation row visible on a short terminal with many agents", () => {
		const records = ["a", "b", "c", "d", "e"].map((id) => panelRecord(id));
		const { panel, steer } = makePanel(records, 20);
		const budget = panel.rowBudget;
		panel.focused = true;
		expect(panel.render(PANEL_WIDTH).length).toBeLessThanOrEqual(budget);

		panel.handleInput(ENTER);
		type(panel, "VISIBLE-DRAFT");
		const lines = panel.render(PANEL_WIDTH);
		const out = lines.join("\n");
		expect(lines.length).toBeLessThanOrEqual(budget);
		expect(out).toContain("VISIBLE-DRAFT");
		expect(out).toContain("Enter send");
		expect(out).toContain("HELLO-a");
		expect(out).toContain("› ");

		panel.handleInput(ENTER);
		expect(steer).toHaveBeenCalledWith("a", "VISIBLE-DRAFT");
		panel.dispose();
	});

	it("follows a replaced activity tracker for the same agent without losing the draft", () => {
		const activities = new Map([["a", activity(3)]]);
		const { panel } = makePanel([panelRecord("a")], 40, activities);
		panel.focused = true;
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("3 tools");
		panel.handleInput(ENTER);
		type(panel, "kept");

		// A resume installs a fresh tracker under the same id.
		activities.set("a", activity(7));
		const out = panel.render(PANEL_WIDTH).join("\n");
		expect(out).toContain("7 tools");
		expect(out).toContain("kept");
		panel.dispose();
	});

	it("drops an armed abort when focus leaves but keeps a steering draft", () => {
		const { panel, stop } = makePanel([panelRecord("a")]);
		panel.focused = true;
		panel.handleInput("x");
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("x again to STOP");
		panel.focused = false;
		panel.focused = true;
		expect(panel.render(PANEL_WIDTH).join("\n")).not.toContain("x again to STOP");
		panel.handleInput("x");
		expect(stop).not.toHaveBeenCalled();

		panel.handleInput(ESC); // disarm + (fake) unfocus request
		panel.handleInput(ENTER);
		type(panel, "still here");
		panel.focused = false;
		panel.focused = true;
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("still here");
		panel.dispose();
	});

	it("keeps the former roster's live stats on each agent row", () => {
		const running = panelRecord("a", { description: "Scout repo", toolUses: 2 });
		const queued = panelRecord("b", { description: "Queued job\nsecond line", status: "queued" });
		const done = panelRecord("c", { description: "Settled job", status: "completed", completedAt: Date.now() });
		const activities = new Map<string, AgentActivity>([
			[
				"a",
				{
					activeTools: new Map([["tool", "read"]]),
					toolUses: 2,
					responseText: "",
					turnCount: 3,
					maxTurns: 12,
					lifetimeUsage: { input: 800, output: 200, cacheWrite: 0 },
				} as any,
			],
		]);
		const { panel } = makePanel([running, queued, done], 40, activities);
		const lines = panel.render(200);
		const row = (text: string) => lines.find((line) => line.includes(text)) ?? "";
		expect(row("Scout repo")).toContain("running");
		expect(row("Scout repo")).toContain("reading");
		expect(row("Scout repo")).toContain("↻3≤12");
		expect(row("Scout repo")).toContain("2 tools");
		expect(row("Queued job")).toContain("queued");
		expect(row("Queued job")).not.toContain("second line");
		expect(row("Settled job")).toContain("completed");
		expect(panel.title()).toBe("Agents · 3");
		panel.dispose();
	});

	it("shows discovered agent types inline with configured selection keys", () => {
		const keybindings = {
			matches: (data: string, binding: string) => data === "D" && binding === "tui.select.down",
			getKeys: (binding: string) =>
				binding === "tui.select.up" ? ["ctrl+p"] : binding === "tui.select.down" ? ["ctrl+n"] : [],
		} as any;
		const { panel } = makePanel([], 40, new Map(), {
			keybindings,
			types: [
				{ name: "explorer", description: "Quick repository scout" },
				{ name: "release", description: "Project release agent", sourcePath: "/project/.pi/agents/release.md" },
			],
		});
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("(no agents)");
		panel.handleInput("t");
		panel.handleInput("D");
		const text = panel.render(PANEL_WIDTH).join("\n");
		expect(text).toContain("> release");
		expect(text).toContain("Project release agent");
		expect(text).toContain("/project/.pi/agents/release.md");
		expect(text).toContain("ctrl+p/ctrl+n select · t agents");
		panel.handleInput("t");
		expect(panel.render(PANEL_WIDTH).join("\n")).toContain("(no agents)");
		panel.dispose();
	});
});
