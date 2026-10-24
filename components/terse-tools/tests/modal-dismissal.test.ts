import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	KeybindingsManager,
	type OverlayOptions,
	type Terminal,
	TUI_KEYBINDINGS,
	TuiAltScreen,
} from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installModalDismissal } from "../src/modal-dismissal.js";
import { ToolViewer } from "../src/tool-viewer.js";

beforeAll(installModalDismissal);
const running: TuiAltScreen[] = [];
afterEach(() => {
	for (const tui of running.splice(0)) tui.stop();
});

function fixture() {
	let input = (_data: string) => {};
	const terminal = {
		columns: 100,
		rows: 30,
		kittyProtocolActive: false,
		start(onInput) {
			input = onInput;
		},
		stop() {},
		async drainInput() {},
		write() {},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
		setProgramStatus() {},
	} satisfies Terminal;
	const tui = new TuiAltScreen(terminal);
	running.push(tui);
	const backgroundClick = vi.fn();
	const background: Component = {
		render: () => Array.from({ length: 30 }, () => "Transcript"),
		invalidate() {},
		handleMouse(event) {
			if (event.type === "click") backgroundClick();
			return { handled: true };
		},
	};
	tui.addChild(background);
	tui.setFocus(background);
	tui.start();
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
	const open = (options: OverlayOptions = {}) => {
		const viewer = new ToolViewer(
			tui,
			theme,
			new KeybindingsManager(TUI_KEYBINDINGS, {}),
			() => {
				viewer.dispose();
				handle.hide();
			},
			() => ({
				toolName: "bash",
				toolCallId: "call",
				args: { command: "echo input" },
				result: { content: [{ type: "text", text: "Output result" }] },
				isPartial: false,
			}),
		);
		const handle = tui.showOverlay(viewer, { width: 80, anchor: "center", ...options });
		tui.renderNow();
		return { viewer, handle };
	};
	const send = (x: number, y: number, code = 0, release = false) =>
		input(`\x1b[<${code};${x + 1};${y + 1}${release ? "m" : "M"}`);
	const click = (x: number, y: number) => {
		send(x, y);
		send(x, y, 0, true);
		tui.renderNow();
	};
	return { tui, terminal, background, backgroundClick, open, click, send, key: (data: string) => input(data) };
}

describe("modal outside-click dismissal", () => {
	it.each(["left", "right", "above", "below"] as const)(
		"closes the inspector from %s without clicking the transcript",
		(side) => {
			const f = fixture();
			const { handle } = f.open();
			const b = handle.getBounds()!;
			const x = side === "left" ? b.col - 1 : side === "right" ? b.col + b.width : b.col + 2;
			const y = side === "above" ? b.row - 1 : side === "below" ? b.row + b.height : b.row + 2;
			f.click(x, y);
			expect(handle.getBounds()).toBeUndefined();
			expect(f.tui.getFocusedComponent()).toBe(f.background);
			expect(f.backgroundClick).not.toHaveBeenCalled();
			f.click(0, 0);
			expect(f.backgroundClick).toHaveBeenCalledOnce();
		},
	);

	it("keeps the inspector open for inside clicks and lets its Output tab work", () => {
		const f = fixture();
		const { viewer, handle } = f.open();
		const b = handle.getBounds()!;
		f.click(b.col, b.row);
		expect(handle.getBounds()).toBeDefined();
		f.click(b.col + 15, b.row + 1);
		expect(viewer.render(80).join("\n")).toContain("Output result");
		expect(handle.getBounds()).toBeDefined();
	});

	it("dismisses only the top modal, leaving the underlying inspector open", () => {
		const f = fixture();
		const lower = f.open();
		const upper = f.open({ width: 60 });
		f.click(0, 0);
		expect(upper.handle.getBounds()).toBeUndefined();
		expect(lower.handle.getBounds()).toBeDefined();
		expect(f.tui.getFocusedComponent()).toBe(lower.viewer);
		expect(f.backgroundClick).not.toHaveBeenCalled();
	});

	it("uses the new modal position after a terminal resize", () => {
		const f = fixture();
		const { handle } = f.open({ width: "80%" });
		f.terminal.columns = 60;
		f.terminal.rows = 20;
		f.tui.renderNow(true);
		const b = handle.getBounds()!;
		f.click(b.col + 1, b.row);
		expect(handle.getBounds()).toBeDefined();
		f.click(b.col - 1, b.row);
		expect(handle.getBounds()).toBeUndefined();
	});

	it("keeps non-modal work panels open when clicking the transcript", () => {
		const f = fixture();
		const { handle } = f.open({ nonCapturing: true });
		f.click(0, 0);
		expect(handle.getBounds()).toBeDefined();
		expect(f.backgroundClick).toHaveBeenCalledOnce();
	});

	it("keeps Escape dismissal working", () => {
		const f = fixture();
		const { handle } = f.open();
		f.key("\x1b");
		expect(handle.getBounds()).toBeUndefined();
	});
});
