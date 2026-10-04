import { initTheme, type SessionEntry, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import installTerseTools from "../src/installer.js";
import { setToolInspector } from "../src/patch.js";

beforeAll(() => initTheme());
afterEach(() => setToolInspector());

function branch(): SessionEntry[] {
	return [
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "first", name: "bash", arguments: { command: "echo hello" } },
					{ type: "toolCall", id: "second", name: "read", arguments: { path: "README.md" } },
				],
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "first",
				content: [{ type: "text", text: "hello" }],
				details: { exitCode: 0 },
				isError: false,
			},
		},
	] as unknown as SessionEntry[];
}

function fixture() {
	const handlers = new Map<string, ((event: unknown, ctx: any) => void)[]>();
	const commands = new Map<string, any>();
	const pi = {
		on(name: string, handler: any) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand: (name: string, command: any) => commands.set(name, command),
	};
	const mounted: (Component & { dispose?(): void })[] = [];
	const complete = vi.fn();
	const ctx: any = {
		hasUI: true,
		mode: "tui",
		sessionManager: { getBranch: () => branch() },
		ui: {
			notify: vi.fn(),
			select: vi.fn(async (_title: string, choices: string[]) => choices[0]),
			custom: vi.fn(
				(factory: any) =>
					new Promise<void>((resolve) => {
						let component: (Component & { dispose?(): void }) | undefined;
						component = factory(
							{ terminal: { rows: 30 }, requestRender() {} },
							{ fg: (_c: string, s: string) => s, bold: (s: string) => s },
							undefined,
							() => {
								component?.dispose?.();
								complete();
								resolve();
							},
						);
						mounted.push(component!);
					}),
			),
		},
	};
	installTerseTools(pi as any);
	const tool = new ToolExecutionComponent(
		"bash",
		"clicked",
		{ command: "echo live" },
		{},
		undefined,
		{} as any,
		process.cwd(),
	);
	tool.render(100);
	const click = () =>
		tool.handleMouse({
			type: "click",
			button: "left",
			x: 3,
			y: 0,
			screenX: 3,
			screenY: 0,
			width: 100,
			height: 1,
		} as any);
	const emit = (event: string) => {
		for (const handler of handlers.get(event) ?? []) handler({}, ctx);
	};
	const frame = (index = mounted.length - 1) => mounted[index].render(90).map(stripTerminalSequences).join("\n");
	const command = () => commands.get("inspect-tool").handler("", ctx);
	return { emit, command, ctx, mounted, tool, click, complete, frame };
}

describe("tool inspector integration", () => {
	it("opens the clicked call, shows live output, and can reopen after closing", async () => {
		const f = fixture();
		f.emit("session_start");
		f.click();
		f.click();
		expect(f.mounted).toHaveLength(1);
		expect(f.frame()).toContain("echo live");
		f.tool.updateResult({ content: [{ type: "text", text: "live output" }], isError: false });
		f.mounted[0].handleInput?.("\t");
		expect(f.frame()).toContain("live output");
		f.mounted[0].handleInput?.("\x1b");
		expect(f.complete).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		f.click();
		expect(f.mounted).toHaveLength(2);
		expect(f.frame()).toContain("echo live");
		f.emit("session_shutdown");
		expect(f.complete).toHaveBeenCalledTimes(2);
	});

	it("lists newest calls first and shows the chosen call's matching result", async () => {
		const f = fixture();
		f.ctx.ui.select.mockImplementation(async (_title: string, choices: string[]) => {
			expect(choices[0]).toContain("README.md");
			expect(choices[1]).toContain("echo hello");
			return choices[1];
		});
		const pending = f.command();
		await Promise.resolve();
		expect(f.frame()).toContain("echo hello");
		f.mounted[0].handleInput?.("\t");
		expect(f.frame()).toContain("hello");
		expect(f.frame()).toContain("exitCode");
		f.mounted[0].handleInput?.("q");
		await pending;
	});

	it.each(["session_tree", "session_shutdown"])("closes the inspector on %s", async (event) => {
		const f = fixture();
		f.emit("session_start");
		f.click();
		f.emit(event);
		expect(f.complete).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		f.emit("session_start");
		f.click();
		expect(f.mounted).toHaveLength(2);
		f.emit("session_shutdown");
	});

	it("discards an old picker selection when the session is replaced", async () => {
		const f = fixture();
		let select: (() => void) | undefined;
		f.ctx.ui.select.mockImplementation(
			(_title: string, choices: string[]) =>
				new Promise<string>((resolve) => {
					select = () => resolve(choices[0]);
				}),
		);
		const pending = f.command();
		f.emit("session_shutdown");
		select?.();
		await pending;
		expect(f.mounted).toHaveLength(0);
	});

	it("keeps the terminal-only inspector out of RPC sessions", async () => {
		const f = fixture();
		f.ctx.mode = "rpc";
		f.emit("session_start");
		await f.command();
		expect(f.ctx.ui.select).not.toHaveBeenCalled();
		expect(f.mounted).toHaveLength(0);
	});
});
