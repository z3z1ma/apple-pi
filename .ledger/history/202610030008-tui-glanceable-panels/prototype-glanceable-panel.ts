// PROTOTYPE — throwaway. Answers: can a non-capturing overlay stay mounted as a
// glanceable panel through agent turns and stacked modals, with focus moving
// cleanly between it and the editor? Run: pi -e <this file>
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	matchesKey,
	type OverlayHandle,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@earendil-works/pi-tui";

const TOGGLE_KEY = "alt+g";

let tui: TUI | undefined;
let handle: OverlayHandle | undefined;
let minWidth = 120;
let timer: ReturnType<typeof setInterval> | undefined;
const lines: string[] = [];
let step = 0;

class Panel implements Component {
	focused = false;
	scroll = 0;

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		const height = 14;
		const visible = lines.slice(Math.max(0, lines.length - height - this.scroll), lines.length - this.scroll);
		const state = `${this.focused ? "FOCUSED" : "glance"} w=${width} term=${tui?.terminal.columns} min=${minWidth} scroll=${this.scroll}`;
		const body = [state, "─".repeat(inner), ...visible];
		while (body.length < height + 2) body.push("");
		return [
			`┌${"─".repeat(inner)}┐`,
			...body.map((l) => {
				const t = truncateToWidth(l, inner);
				return `│${t}${" ".repeat(Math.max(0, inner - t.length))}│`;
			}),
			`└${"─".repeat(inner)}┘`,
		];
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, TOGGLE_KEY)) {
			handle?.unfocus();
		} else if (matchesKey(data, "up")) {
			this.scroll = Math.min(this.scroll + 1, Math.max(0, lines.length - 1));
		} else if (matchesKey(data, "down")) {
			this.scroll = Math.max(0, this.scroll - 1);
		}
		tui?.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			this.scroll = Math.min(Math.max(0, this.scroll - (event.wheelDelta ?? 0)), Math.max(0, lines.length - 1));
			return { handled: true };
		}
		if (event.type === "press" && event.button === "left") return { focus: true };
		return undefined;
	}

	invalidate(): void {}
}

function captureTui(ctx: ExtensionContext): void {
	ctx.ui.setWidget("proto-tui-probe", (t) => {
		tui = t;
		return { render: () => [], invalidate: () => {} };
	});
}

export default function prototype(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => captureTui(ctx));

	pi.registerCommand("proto-pin", {
		description: "PROTOTYPE: pin a non-capturing glanceable panel",
		handler: async (_args, ctx) => {
			if (!tui) captureTui(ctx);
			if (!tui || handle) return;
			handle = tui.showOverlay(new Panel(), {
				nonCapturing: true,
				anchor: "top-right",
				width: "33%",
				maxHeight: "70%",
				margin: { top: 1, right: 1 },
				visible: (w) => w >= minWidth,
			});
			timer = setInterval(() => {
				lines.push(`agent: step ${++step} reading components/…/file-${step}.ts`);
				tui?.requestRender();
			}, 700);
		},
	});

	pi.registerCommand("proto-unpin", {
		description: "PROTOTYPE: remove the panel",
		handler: async () => {
			handle?.hide();
			handle = undefined;
			if (timer) clearInterval(timer);
			timer = undefined;
		},
	});

	pi.registerCommand("proto-min", {
		description: "PROTOTYPE: set the width below which the panel hides",
		handler: async (args) => {
			minWidth = Number(args) || minWidth;
			tui?.requestRender();
		},
	});

	pi.registerCommand("proto-modal", {
		description: "PROTOTYPE: open a capturing modal above the panel (Esc closes)",
		handler: async (_args, ctx) => {
			await ctx.ui.custom<void>(
				(_t, _theme, _kb, done) => ({
					render: (w: number) => ["MODAL — Esc closes", "x".repeat(Math.max(1, w - 2))],
					handleInput: (d: string) => {
						if (matchesKey(d, "escape")) done();
					},
					invalidate: () => {},
				}),
				{ overlay: true, overlayOptions: { anchor: "center", width: "50%" } },
			);
		},
	});

	pi.registerShortcut(TOGGLE_KEY, {
		description: "PROTOTYPE: move focus into the glanceable panel",
		handler: () => {
			if (!handle) return;
			if (handle.isFocused()) handle.unfocus();
			else handle.focus();
			tui?.requestRender();
		},
	});
}
