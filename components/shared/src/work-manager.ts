import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	isKeyRelease,
	Key,
	matchesKey,
	type OverlayHandle,
	type OverlayOptions,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ViewerKeybindings } from "./viewer-keys.js";

/** Key that moves keyboard focus between the editor and the work panel. */
export const WORK_PANEL_FOCUS_KEY = "alt+g";
/** At or above this many columns the panel docks top-right; below it drops down top-center. */
export const WORK_PANEL_WIDE_COLUMNS = 120;
/** Rows the panel draws above the active tab: top border and tab row. */
const PANEL_HEADER_ROWS = 2;

export interface WorkPanelPlacement {
	anchor: "top-right" | "top-center";
	width: string;
	heightPct: number;
}

/** Responsive placement: a third of a wide terminal, or a `/btw`-like drop-down on a narrow one. */
export function workPanelPlacement(columns: number): WorkPanelPlacement {
	return columns >= WORK_PANEL_WIDE_COLUMNS
		? { anchor: "top-right", width: "33%", heightPct: 70 }
		: { anchor: "top-center", width: "90%", heightPct: 50 };
}

export interface WorkTheme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

export interface WorkSectionUI {
	tui: TUI;
	theme: WorkTheme;
	keybindings: ViewerKeybindings | undefined;
}

/**
 * One tab's body inside the work panel. It renders the rest of the panel box
 * below the tab row: bordered rows ending with the bottom border.
 */
export interface WorkSectionComponent extends Component {
	/** Keyboard focus, forwarded only while this tab is active. Losing it should drop armed confirmations. */
	focused: boolean;
	/** Rows available below the panel header, set before each render. */
	rowBudget: number;
	/** True while a text input owns the keyboard; the panel then forwards every key. */
	isComposing?(): boolean;
	/** Current record, restored when the panel reopens. */
	getSelectedId?(): string | undefined;
	/** Tab label with live counts. */
	title?(): string;
	/** Tab-specific keys shown in the panel header while focused, most important first. */
	hints?(): string[];
	handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;
	dispose?(): void;
}

export interface WorkSection {
	key: string;
	label: string;
	prepare?(ctx: ExtensionContext): void;
	create(ui: WorkSectionUI, selectedId: string | undefined): WorkSectionComponent;
}

export interface WorkPanelCallbacks {
	unfocus(): void;
	close(): void;
	onTabChange(key: string): void;
}

/** The one non-capturing Agents/Tasks panel. Tabs keep their components, and so their state, until it closes. */
export class WorkPanel implements Component {
	private activeIndex: number;
	private readonly children: WorkSectionComponent[];
	private hasFocus = false;
	/** Column ranges of the tab labels in the last render, relative to the panel. */
	private tabRanges: Array<{ start: number; end: number }> = [];

	constructor(
		private readonly ui: WorkSectionUI,
		private readonly sections: readonly WorkSection[],
		initialSection: string | undefined,
		selectedIds: ReadonlyMap<string, string>,
		private readonly callbacks: WorkPanelCallbacks,
	) {
		this.activeIndex = Math.max(
			0,
			sections.findIndex((section) => section.key === initialSection),
		);
		this.children = sections.map((section) => section.create(ui, selectedIds.get(section.key)));
	}

	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(value: boolean) {
		this.hasFocus = value;
		const active = this.children[this.activeIndex];
		if (active) active.focused = value;
	}

	get activeSection(): string | undefined {
		return this.sections[this.activeIndex]?.key;
	}

	selectSection(key: string): void {
		const index = this.sections.findIndex((section) => section.key === key);
		if (index === -1 || index === this.activeIndex) return;
		const previous = this.children[this.activeIndex];
		if (previous) previous.focused = false;
		this.activeIndex = index;
		const next = this.children[index];
		if (next) next.focused = this.hasFocus;
		this.callbacks.onTabChange(key);
		this.ui.tui.requestRender();
	}

	/** Current record per tab, for tabs that report one. */
	selectedIds(): Map<string, string> {
		const selected = new Map<string, string>();
		this.sections.forEach((section, index) => {
			const id = this.children[index]?.getSelectedId?.();
			if (id !== undefined) selected.set(section.key, id);
		});
		return selected;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, WORK_PANEL_FOCUS_KEY)) {
			this.callbacks.unfocus();
			return;
		}
		const active = this.children[this.activeIndex];
		if (!active?.isComposing?.()) {
			if (matchesKey(data, Key.escape)) {
				this.callbacks.unfocus();
				return;
			}
			if (matchesKey(data, "q")) {
				this.callbacks.close();
				return;
			}
			if (this.sections.length > 1 && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
				const step = matchesKey(data, Key.right) ? 1 : -1;
				const next = this.sections[(this.activeIndex + step + this.sections.length) % this.sections.length];
				if (next) this.selectSection(next.key);
				return;
			}
		}
		active?.handleInput?.(data);
		this.ui.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "press" && event.button === "left") {
			if (event.y === 1) {
				const index = this.tabRanges.findIndex((range) => event.x >= range.start && event.x < range.end);
				const section = this.sections[index];
				if (section) this.selectSection(section.key);
			}
			return { focus: true };
		}
		return this.children[this.activeIndex]?.handleMouse?.(event);
	}

	render(width: number): string[] {
		if (width < 6) return [];
		const { theme, tui } = this.ui;
		const innerWidth = width - 4;
		const ceiling = Math.max(
			1,
			Math.floor((tui.terminal.rows * workPanelPlacement(tui.terminal.columns).heightPct) / 100),
		);

		const tabs: string[] = [];
		this.tabRanges = [];
		let column = 2;
		this.sections.forEach((section, index) => {
			const text = ` ${this.children[index]?.title?.() ?? section.label} `;
			const label =
				index === this.activeIndex ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg("muted", text);
			if (tabs.length > 0) column += 1;
			this.tabRanges.push({ start: column, end: column + visibleWidth(text) });
			column += visibleWidth(text);
			tabs.push(label);
		});
		const tabText = tabs.join(" ");
		// Keep as many hints as fit, dropping the least important from the end.
		const parts = this.hasFocus
			? ["←/→ tabs", ...(this.children[this.activeIndex]?.hints?.() ?? []), "Tab next", "Esc editor"]
			: ["Alt+G focus"];
		while (parts.length > 0 && visibleWidth(tabText) + 1 + visibleWidth(parts.join(" · ")) > innerWidth) parts.pop();
		const hint = theme.fg("dim", parts.join(" · "));
		const header =
			parts.length > 0 ? tabText + " ".repeat(innerWidth - visibleWidth(tabText) - visibleWidth(hint)) + hint : tabText;
		const clipped = truncateToWidth(header, innerWidth, "");
		const tabRow = `${theme.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${theme.fg("border", "│")}`;

		const active = this.children[this.activeIndex];
		if (!active) return [theme.fg("border", `╭${"─".repeat(width - 2)}╮`), tabRow];
		active.rowBudget = Math.max(1, ceiling - PANEL_HEADER_ROWS);
		const lines = [theme.fg("border", `╭${"─".repeat(width - 2)}╮`), tabRow, ...active.render(width)];
		return lines.slice(0, ceiling);
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
	}

	dispose(): void {
		for (const child of this.children) child.dispose?.();
	}
}

export const WORK_SECTION_CHANNEL = "apple-pi:work:register-section";

/**
 * Overlay options whose placement follows the terminal on every render. pi-tui
 * resolves an overlay's options each frame, so one mounted component (and its
 * tab, selection, scroll, and draft) survives resizes across the breakpoint.
 */
function responsiveOptions(tui: TUI): OverlayOptions {
	return {
		nonCapturing: true,
		get anchor() {
			return workPanelPlacement(tui.terminal.columns).anchor;
		},
		get width() {
			return workPanelPlacement(tui.terminal.columns).width;
		},
		get maxHeight() {
			return `${workPanelPlacement(tui.terminal.columns).heightPct}%`;
		},
	} as OverlayOptions;
}

export class WorkManager {
	private readonly sections = new Map<string, WorkSection>();
	// Restored on reopen for this process only; never written to the session.
	private lastSection: string | undefined;
	private readonly selectedIds = new Map<string, string>();
	private mounted: { handle: OverlayHandle; panel: WorkPanel; tui: TUI } | undefined;

	constructor(private readonly pi: ExtensionAPI) {
		this.pi.registerCommand("work", {
			description: "Open the Agents and Tasks work panel",
			handler: async (_args, ctx) => this.open(ctx),
		});
		this.pi.registerCommand("agents", {
			description: "Open the work panel on its Agents tab",
			handler: async (_args, ctx) => this.open(ctx, "agents"),
		});
		this.pi.registerCommand("tasks", {
			description: "Open the work panel on its Tasks tab",
			handler: async (_args, ctx) => this.open(ctx, "tasks"),
		});
		this.pi.registerShortcut("ctrl+w", {
			description: "Open the work panel",
			handler: async (ctx) => this.open(ctx),
		});
		this.pi.registerShortcut(WORK_PANEL_FOCUS_KEY, {
			description: "Move focus between the editor and the work panel",
			handler: () => {
				const current = this.mounted;
				if (!current) return;
				if (current.handle.isFocused()) current.handle.unfocus();
				else current.handle.focus();
				current.tui.requestRender();
			},
		});
	}

	registerSection(section: WorkSection): void {
		this.sections.set(section.key, section);
	}

	async open(ctx: ExtensionContext, initialSection?: string): Promise<void> {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		const sections = [...this.sections.values()];
		if (sections.length === 0) return;
		for (const section of sections) section.prepare?.(ctx);
		const known = (key: string | undefined) => sections.some((section) => section.key === key);
		const target = known(initialSection)
			? initialSection
			: known(this.lastSection)
				? this.lastSection
				: sections[0]?.key;
		if (!target) return;
		this.lastSection = target;

		if (this.mounted) {
			this.mounted.panel.selectSection(target);
			this.mounted.tui.requestRender();
			return;
		}
		// Pi exposes the TUI, theme, and keybindings only to UI factories. This
		// non-overlay factory completes synchronously: Pi restores the editor (and
		// its draft) without mounting anything, and the panel is mounted with its
		// own handle so a closing modal can never remove it.
		await ctx.ui.custom<undefined>((tui, theme, keybindings, done) => {
			this.mount({ tui, theme, keybindings }, sections, target);
			done(undefined);
			return { render: () => [], invalidate: () => {} };
		});
	}

	close(): void {
		const current = this.mounted;
		this.mounted = undefined;
		if (!current) return;
		for (const [key, id] of current.panel.selectedIds()) this.selectedIds.set(key, id);
		current.handle.hide();
		current.panel.dispose();
	}

	private mount(ui: WorkSectionUI, sections: readonly WorkSection[], target: string): void {
		if (this.mounted) return;
		const panel = new WorkPanel(ui, sections, target, this.selectedIds, {
			unfocus: () => this.mounted?.handle.unfocus(),
			close: () => this.close(),
			onTabChange: (key) => {
				this.lastSection = key;
			},
		});
		const handle = ui.tui.showOverlay(panel, responsiveOptions(ui.tui));
		this.mounted = { handle, panel, tui: ui.tui };
	}
}

export function installWorkManager(pi: ExtensionAPI): void {
	const manager = new WorkManager(pi);
	const unsubscribe = pi.events.on(WORK_SECTION_CHANNEL, (data) => manager.registerSection(data as WorkSection));
	pi.on("session_shutdown", () => {
		manager.close();
		unsubscribe();
	});
}

export function registerWorkSection(pi: ExtensionAPI, section: WorkSection): void {
	pi.events.emit(WORK_SECTION_CHANNEL, section);
}
