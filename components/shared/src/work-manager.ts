import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	isKeyRelease,
	Key,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ViewerKeybindings } from "./viewer-keys.js";

type ManagedComponent = Component & { dispose?(): void };

export type WorkSectionAction = { type: "close" } | { type: "inspect"; id: string };

export interface WorkTheme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

export interface WorkSection {
	key: string;
	label: string;
	prepare?(ctx: ExtensionContext): void;
	create(
		tui: TUI,
		theme: WorkTheme,
		keybindings: ViewerKeybindings | undefined,
		selectedId: string | undefined,
		done: (action: WorkSectionAction) => void,
		reservedLines: number,
	): Component;
	inspect(ctx: ExtensionContext, id: string): Promise<void>;
}

export interface WorkManagerUI {
	custom<T>(
		factory: (
			tui: TUI,
			theme: WorkTheme,
			keybindings: ViewerKeybindings | undefined,
			done: (result: T) => void,
		) => Component,
		options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
	): Promise<T>;
}

export class WorkManagerComponent implements Component {
	private activeIndex: number;
	private readonly children: ManagedComponent[];

	constructor(
		private readonly tui: TUI,
		private readonly theme: WorkTheme,
		private readonly sections: readonly WorkSection[],
		initialSection: string | undefined,
		selectedIds: ReadonlyMap<string, string>,
		private readonly done: (action: { type: "close" } | { type: "inspect"; section: string; id: string }) => void,
		private readonly keybindings: ViewerKeybindings | undefined,
	) {
		this.activeIndex = Math.max(
			0,
			this.sections.findIndex((section) => section.key === initialSection),
		);
		this.children = this.sections.map((section) =>
			section.create(
				tui,
				theme,
				keybindings,
				selectedIds.get(section.key),
				(action) => {
					if (action.type === "close") this.done({ type: "close" });
					else this.done({ type: "inspect", section: section.key, id: action.id });
				},
				4,
			),
		);
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (this.sections.length > 1) {
			if (
				(this.keybindings?.matches(data, "tui.input.tab") ?? matchesKey(data, Key.tab)) ||
				matchesKey(data, Key.right)
			) {
				this.activeIndex = (this.activeIndex + 1) % this.sections.length;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
				this.activeIndex = (this.activeIndex - 1 + this.sections.length) % this.sections.length;
				this.tui.requestRender();
				return;
			}
		}
		this.children[this.activeIndex]?.handleInput?.(data);
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const maxLines = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8));
		const edge = (left: string, right: string): string => {
			if (renderWidth === 1) return this.theme.fg("border", left);
			return this.theme.fg("border", `${left}${"─".repeat(renderWidth - 2)}${right}`);
		};
		const middleWidth = Math.max(0, renderWidth - 2);
		const horizontalPadding = renderWidth >= 4 ? 1 : 0;
		const contentWidth = Math.max(0, middleWidth - horizontalPadding * 2);
		const row = (text: string): string => {
			if (renderWidth === 1) return this.theme.fg("border", "│");
			const clipped = truncateToWidth(text, contentWidth, "");
			const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
			const sidePadding = " ".repeat(horizontalPadding);
			return `${this.theme.fg("border", "│")}${sidePadding}${clipped}${padding}${sidePadding}${this.theme.fg("border", "│")}`;
		};
		const top = edge("╭", "╮");
		const bottom = edge("╰", "╯");
		if (maxLines === 1) return [top];
		if (maxLines === 2) return [top, bottom];

		const tabs = this.sections.map((section, index) => {
			const text = ` ${section.label} `;
			return index === this.activeIndex
				? this.theme.bg("selectedBg", this.theme.fg("text", text))
				: this.theme.fg("muted", text);
		});
		const header = `${this.theme.fg("accent", this.theme.bold("Work"))}  ${tabs.join(" ")}  ${this.theme.fg("dim", "Tab/←→ switch")}`;
		if (maxLines === 3) return [top, row(header), bottom];

		const separator = row(this.theme.fg("dim", "─".repeat(contentWidth)));
		const body = this.children[this.activeIndex]?.render(Math.max(1, contentWidth)) ?? [];
		const available = maxLines - 4;
		const visibleBody =
			body.length <= available
				? body
				: available === 0
					? []
					: available === 1
						? [body[0]!]
						: [body[0]!, ...body.slice(1, available - 1), body.at(-1)!];
		return [top, row(header), separator, ...visibleBody.map(row), bottom];
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
	}

	dispose(): void {
		for (const child of this.children) child.dispose?.();
	}
}

export const WORK_SECTION_CHANNEL = "apple-pi:work:register-section";

export class WorkManager {
	private readonly sections = new Map<string, WorkSection>();

	constructor(private readonly pi: ExtensionAPI) {
		this.pi.registerCommand("work", {
			description: "Inspect and manage active subagents and managed tasks",
			handler: async (_args, ctx) => this.open(ctx),
		});
		this.pi.registerCommand("agents", {
			description: "Open the agent tab in the active work manager",
			handler: async (_args, ctx) => this.open(ctx, "agents"),
		});
		this.pi.registerCommand("tasks", {
			description: "Open the task tab in the active work manager",
			handler: async (_args, ctx) => this.open(ctx, "tasks"),
		});
		this.pi.registerShortcut("ctrl+w", {
			description: "Open active work manager",
			handler: async (ctx) => this.open(ctx),
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

		let activeSection = sections.some((section) => section.key === initialSection) ? initialSection : sections[0]?.key;
		const selectedIds = new Map<string, string>();
		while (activeSection) {
			const action = await (ctx.ui as WorkManagerUI).custom<
				{ type: "close" } | { type: "inspect"; section: string; id: string }
			>(
				(tui, theme, keybindings, done) =>
					new WorkManagerComponent(tui, theme, sections, activeSection, selectedIds, done, keybindings),
				{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%" } },
			);
			if (!action || action.type === "close") return;
			activeSection = action.section;
			selectedIds.set(action.section, action.id);
			const section = sections.find((candidate) => candidate.key === action.section);
			if (section) await section.inspect(ctx, action.id);
		}
	}
}

export function installWorkManager(pi: ExtensionAPI): void {
	const manager = new WorkManager(pi);
	const unsubscribe = pi.events.on(WORK_SECTION_CHANNEL, (data) => manager.registerSection(data as WorkSection));
	pi.on("session_shutdown", () => unsubscribe());
}

export function registerWorkSection(pi: ExtensionAPI, section: WorkSection): void {
	pi.events.emit(WORK_SECTION_CHANNEL, section);
}
