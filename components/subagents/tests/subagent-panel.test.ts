import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { installWorkManager } from "../../shared/src/work-manager.js";
import installSubagents from "../src/index.js";
import type { AgentRecord } from "../src/types.js";
import { AgentPanel } from "../src/ui/agent-panel.js";
import type { AgentActivity } from "../src/ui/agent-widget.js";

const ESC = "\x1b";
const ALT_G = "\x1bg";
const ENTER = "\r";
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

interface OverlayEntry {
	component: any;
	options: any;
	handle: any;
}

/**
 * A fake TUI that models Pi's overlay stack: `custom()` overlays close through
 * `hideOverlay()`, which pops the topmost entry, exactly like Pi's
 * `showExtensionCustom`. A panel mounted any other way than its own handle
 * would be removed by a closing modal.
 */
function fakeTui() {
	const editor = { name: "editor", text: "draft to main agent" };
	const stack: OverlayEntry[] = [];
	let focused: unknown = editor;
	const setFocus = (target: unknown) => {
		if (focused && typeof focused === "object" && "focused" in focused) (focused as any).focused = false;
		focused = target;
		if (target && typeof target === "object" && "focused" in target) (target as any).focused = true;
	};
	const tui = {
		terminal: { rows: 40, columns: 160 },
		requestRender: vi.fn(),
		showOverlay: vi.fn((component: any, options: any): any => {
			const preFocus = focused;
			const entry: OverlayEntry = { component, options, handle: undefined };
			entry.handle = {
				hide: vi.fn(() => {
					const index = stack.indexOf(entry);
					if (index === -1) return;
					stack.splice(index, 1);
					if (focused === component) setFocus(preFocus);
				}),
				setHidden: vi.fn(),
				isHidden: () => false,
				focus: vi.fn(() => {
					if (stack.includes(entry)) setFocus(component);
				}),
				unfocus: vi.fn(() => {
					if (focused === component) setFocus(preFocus);
				}),
				isFocused: () => focused === component,
				getBounds: () => undefined,
			};
			stack.push(entry);
			if (!options?.nonCapturing) setFocus(component);
			return entry.handle;
		}),
		hideOverlay: vi.fn(() => {
			const entry = stack.pop();
			if (entry && focused === entry.component) setFocus(editor);
		}),
	};
	return { tui, stack, editor, focused: () => focused };
}

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

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
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
	} as any;
	installWorkManager(pi);
	installSubagents(pi);

	const screen = fakeTui();
	/** Scripts for successive `ctx.ui.custom()` modals; each receives the mounted component. */
	const modalScripts: Array<(component: any) => void> = [];
	const modalRenders: string[] = [];
	const custom = vi.fn(async (factory: any, options: any) => {
		return await new Promise((resolve) => {
			let closed = false;
			const component = factory(screen.tui, theme, undefined, (result: unknown) => {
				if (closed) return;
				closed = true;
				screen.tui.hideOverlay();
				component.dispose?.();
				resolve(result);
			});
			screen.tui.showOverlay(component, options?.overlayOptions);
			modalRenders.push(component.render(100).join("\n"));
			const script = modalScripts.shift() ?? ((modal: any) => modal.handleInput("q"));
			script(component);
		});
	});
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
	/** Open /work and choose the agent row whose description matches. */
	const chooseInWork = async (description: string) => {
		modalScripts.push((modal) => {
			// /work may restore an earlier selection, so start from the top.
			for (let index = 0; index < 20; index++) modal.handleInput("k");
			for (let index = 0; index < 20; index++) {
				if (modal.render(100).some((line: string) => line.includes(">") && line.includes(description))) break;
				modal.handleInput("j");
			}
			modal.handleInput(ENTER);
		});
		await commands.get("work").handler("", ctx);
	};
	const shutdown = async () => {
		for (const handler of lifecycle.get("session_shutdown") ?? []) await handler({}, ctx);
	};
	return { tools, commands, shortcuts, ctx, custom, screen, modalRenders, launch, chooseInWork, shutdown };
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

describe("glanceable subagent panel", () => {
	it("pins from /work as a non-capturing top-right overlay that keeps steer, abort, focus, and unpin", async () => {
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

			// Alt+G without a pinned panel is a no-op.
			expect(() => h.shortcuts.get("alt+g").handler(h.ctx)).not.toThrow();
			expect(h.screen.tui.showOverlay.mock.calls.every(([, options]) => !options?.nonCapturing)).toBe(true);

			await h.chooseInWork("Live task");

			const panelCalls = h.screen.tui.showOverlay.mock.calls.filter(([, options]) => options?.nonCapturing);
			expect(panelCalls).toHaveLength(1);
			const [panel, options] = panelCalls[0]!;
			expect(options).toMatchObject({ nonCapturing: true, anchor: "top-right", width: "33%", maxHeight: "70%" });
			expect(options.visible(119)).toBe(false);
			expect(options.visible(120)).toBe(true);
			// Every ctx.ui.custom() modal was /work; no modal agent viewer opened.
			expect(h.modalRenders.every((render) => render.includes("Work"))).toBe(true);
			// Pinning closes /work instead of reopening it.
			expect(h.custom).toHaveBeenCalledTimes(1);
			expect(h.screen.stack.map((entry) => entry.component)).toEqual([panel]);
			// A modal opened and closed above the panel leaves it mounted.
			await h.commands.get("work").handler("", h.ctx);
			expect(h.custom).toHaveBeenCalledTimes(2);
			expect(h.screen.stack.map((entry) => entry.component)).toEqual([panel]);
			const panelHandle = h.screen.stack[0]!.handle;
			// Unfocused: typed keys still reach the editor.
			expect(h.screen.focused()).toBe(h.screen.editor);

			const rendered = () => panel.render(PANEL_WIDTH).join("\n");
			expect(rendered()).toContain("Finished task");
			expect(rendered()).toContain("Live task");
			expect(rendered()).toContain("Stoppable task");
			expect(rendered()).toContain("prompt for Live task");

			// Alt+G focuses; Esc returns focus with the draft unchanged.
			h.shortcuts.get("alt+g").handler(h.ctx);
			expect(h.screen.focused()).toBe(panel);
			panel.handleInput(ESC);
			expect(h.screen.focused()).toBe(h.screen.editor);
			expect(h.screen.editor.text).toBe("draft to main agent");
			expect(h.screen.stack.map((entry) => entry.component)).toEqual([panel]);
			// Alt+G inside the focused panel also returns focus; the shortcut toggles.
			h.shortcuts.get("alt+g").handler(h.ctx);
			expect(h.screen.focused()).toBe(panel);
			panel.handleInput(ALT_G);
			expect(h.screen.focused()).toBe(h.screen.editor);
			h.shortcuts.get("alt+g").handler(h.ctx);
			h.shortcuts.get("alt+g").handler(h.ctx);
			expect(h.screen.focused()).toBe(h.screen.editor);

			// Enter then text steers the selected agent; its new output appears live.
			faux.appendResponses([
				(context) => {
					steeredContext = JSON.stringify(context.messages);
					return fauxAssistantMessage([fauxText("STEER-ACK")]);
				},
			]);
			h.shortcuts.get("alt+g").handler(h.ctx);
			panel.handleInput(ENTER);
			for (const ch of "use the cache") panel.handleInput(ch);
			panel.handleInput(ENTER);
			releaseLive();
			await waitFor(() => rendered().includes("STEER-ACK"), "steered output in the panel");
			expect(steeredContext).toContain("use the cache");
			const liveResult = await h.tools
				.get("get_subagent_result")
				.execute("live-check", { agent_id: liveId, yield_seconds: 0 }, undefined);
			expect(liveResult.content[0].text).toContain("STEER-ACK");

			// Choosing another agent in /work selects it in the already pinned panel.
			panel.handleInput(ESC);
			await h.chooseInWork("Stoppable task");
			expect(h.screen.tui.showOverlay.mock.calls.filter(([, o]) => o?.nonCapturing)).toHaveLength(1);
			expect(rendered()).toContain("prompt for Stoppable task");

			// An armed abort does not survive giving focus away: x, Alt+G, refocus, x only re-arms.
			h.shortcuts.get("alt+g").handler(h.ctx);
			panel.handleInput("x");
			expect(rendered()).toContain("x again to STOP");
			panel.handleInput(ALT_G);
			expect(h.screen.focused()).toBe(h.screen.editor);
			h.shortcuts.get("alt+g").handler(h.ctx);
			expect(rendered()).not.toContain("x again to STOP");
			panel.handleInput("x");
			expect(rendered()).toContain("x again to STOP");
			expect(rendered()).toContain("· running");
			panel.handleInput(ALT_G);
			h.shortcuts.get("alt+g").handler(h.ctx);

			// x twice aborts the selected agent.
			panel.handleInput("x");
			panel.handleInput("x");
			await waitFor(() => rendered().includes("stopped"), "stopped status in the panel");
			const stopResult = await h.tools
				.get("get_subagent_result")
				.execute("stop-check", { agent_id: stopId, yield_seconds: 0 }, undefined);
			expect(stopResult.content[0].text).toContain("STOPPED BY THE USER");

			// With nothing running, the panel stays mounted and lists finished agents.
			expect(h.screen.stack.map((entry) => entry.component)).toEqual([panel]);
			expect(rendered()).toContain("Finished task");
			expect(rendered()).toContain("Live task");

			// q unpins.
			panel.handleInput("q");
			expect(panelHandle.hide).toHaveBeenCalled();
			expect(h.screen.stack).toHaveLength(0);
			expect(h.screen.focused()).toBe(h.screen.editor);
			expect(() => h.shortcuts.get("alt+g").handler(h.ctx)).not.toThrow();

			// A later pin mounts a fresh panel; session shutdown removes it.
			await h.chooseInWork("Finished task");
			expect(h.screen.stack).toHaveLength(1);
			const repinned = h.screen.stack[0]!;
			expect(repinned.options.nonCapturing).toBe(true);
			await h.shutdown();
			expect(repinned.handle.hide).toHaveBeenCalled();
			expect(h.screen.stack).toHaveLength(0);
		} finally {
			releaseLive();
			releaseStop();
			await h.shutdown();
			process.chdir(previousCwd);
		}
	}, 30_000);
});

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

	function makePanel(records: AgentRecord[], rows = 40, activities = new Map<string, AgentActivity>()) {
		const steer = vi.fn();
		const stop = vi.fn();
		const panel = new AgentPanel({
			tui: { terminal: { rows, columns: 160 }, requestRender: vi.fn() } as any,
			theme,
			listAgents: () => records,
			getActivity: (id) => activities.get(id),
			stop,
			steer,
			unfocus: vi.fn(),
			unpin: vi.fn(),
		});
		panel.select(records[0]!.id);
		return { panel, steer, stop };
	}

	const type = (panel: AgentPanel, text: string) => {
		for (const ch of text) panel.handleInput(ch);
	};

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
		const budget = Math.floor((20 * 70) / 100);
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
});
