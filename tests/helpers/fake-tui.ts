import { vi } from "vitest";

export interface FakeOverlayEntry {
	component: any;
	options: any;
	handle: any;
}

function parseSize(value: number | string | undefined, total: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	const match = value.match(/^(\d+(?:\.\d+)?)%$/);
	return match ? Math.floor((total * Number.parseFloat(match[1]!)) / 100) : undefined;
}

/**
 * A fake TUI that models the parts of Pi's overlay stack the work panel relies on:
 * overlay options are read on every render, `hideOverlay()` pops the topmost
 * entry, and `custom()` follows Pi's `showExtensionCustom`, including a factory
 * that completes synchronously (the editor is restored and nothing is mounted).
 */
export function fakeTui(columns = 160, rows = 40) {
	const editor = { name: "editor", text: "draft to main agent" };
	const stack: FakeOverlayEntry[] = [];
	let focused: unknown = editor;
	const setFocus = (target: unknown) => {
		if (focused && typeof focused === "object" && "focused" in focused) (focused as any).focused = false;
		focused = target;
		if (target && typeof target === "object" && "focused" in target) (target as any).focused = true;
	};
	const tui = {
		terminal: { rows, columns },
		requestRender: vi.fn(),
		showOverlay: vi.fn((component: any, options: any): any => {
			const preFocus = focused;
			const entry: FakeOverlayEntry = { component, options, handle: undefined };
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

	/** Lay out an overlay the way pi-tui does on each render: options are resolved against the current terminal. */
	const layout = (entry: FakeOverlayEntry) => {
		const { columns: termWidth, rows: termHeight } = tui.terminal;
		const options = entry.options ?? {};
		const width = Math.max(1, Math.min(parseSize(options.width, termWidth) ?? Math.min(80, termWidth), termWidth));
		const maxHeight = parseSize(options.maxHeight, termHeight);
		let lines: string[] = entry.component.render(width);
		if (maxHeight !== undefined) lines = lines.slice(0, maxHeight);
		const anchor: string = options.anchor ?? "center";
		const col = anchor.endsWith("right")
			? termWidth - width
			: anchor.endsWith("left")
				? 0
				: Math.floor((termWidth - width) / 2);
		return { anchor, width, maxHeight, col, lines };
	};

	return {
		tui,
		stack,
		editor,
		focused: () => focused,
		setFocus,
		layout,
	};
}

export type FakeScreen = ReturnType<typeof fakeTui>;

export const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => `[${text.trim()}]`,
	bold: (text: string) => text,
};

/**
 * `ctx.ui.custom()` as Pi implements it. Modal scripts run against capturing
 * overlays that stay open; a factory may also call `done` synchronously.
 */
export function fakeCustom(screen: FakeScreen, theme: any = plainTheme, keybindings: any = undefined) {
	const modalScripts: Array<(component: any) => void> = [];
	const custom = vi.fn(async (factory: any, options?: any) => {
		const isOverlay = options?.overlay ?? false;
		const savedText = screen.editor.text;
		return await new Promise((resolve) => {
			let closed = false;
			let component: any;
			const close = (result: unknown) => {
				if (closed) return;
				closed = true;
				if (isOverlay) screen.tui.hideOverlay();
				else {
					screen.editor.text = savedText;
					screen.setFocus(screen.editor);
				}
				resolve(result);
				component?.dispose?.();
			};
			const created = factory(screen.tui, theme, keybindings, close);
			if (closed) return;
			component = created;
			if (isOverlay) screen.tui.showOverlay(component, options?.overlayOptions);
			else screen.setFocus(component);
			const script = modalScripts.shift();
			script?.(component);
		});
	});
	return { custom, modalScripts };
}
