import { truncateToWidth } from "@earendil-works/pi-tui";

export interface ActiveWorkTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

export interface ActiveWorkEntry {
	id: string;
	render(width: number, theme: ActiveWorkTheme, frame: string): string[];
}

export interface ActiveWorkSource {
	key: string;
	statusKey: string;
	countLabel: string;
	getEntries(): readonly ActiveWorkEntry[];
}

export interface ActiveWorkUI {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| undefined
			| ((
					tui: { terminal: { columns: number }; requestRender(): void },
					theme: ActiveWorkTheme,
			  ) => { render(): string[]; invalidate(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
}

const MAX_LINES = 12;
const TICK_MS = 500;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const surfaces = new WeakMap<object, ActiveWorkSurface>();

export function getActiveWorkSurface(owner: object): ActiveWorkSurface {
	let surface = surfaces.get(owner);
	if (!surface) {
		surface = new ActiveWorkSurface();
		surfaces.set(owner, surface);
	}
	return surface;
}

export class ActiveWorkSurface {
	private readonly sources = new Map<string, ActiveWorkSource>();
	private readonly lastStatuses = new Map<string, string>();
	private ui: ActiveWorkUI | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private tui: { requestRender(): void } | undefined;
	private frame = 0;
	private widgetCurrent = false;
	private widgetMounted = false;

	registerSource(source: ActiveWorkSource): () => void {
		this.sources.set(source.key, source);
		this.update();
		return () => {
			if (this.sources.get(source.key) !== source) return;
			this.sources.delete(source.key);
			if (this.ui && this.lastStatuses.has(source.statusKey)) this.ui.setStatus(source.statusKey, undefined);
			this.lastStatuses.delete(source.statusKey);
			this.update();
		};
	}

	setUICtx(ui: ActiveWorkUI): void {
		if (ui === this.ui) return;
		this.clearMountedUI();
		this.ui = ui;
		this.update();
	}

	update(): void {
		if (!this.ui) return;
		const groups = this.sourceEntries();
		for (const { source, entries } of groups) {
			const text = entries.length > 0 ? `${source.countLabel}:${entries.length}` : undefined;
			const previous = this.lastStatuses.get(source.statusKey);
			if (text === previous) continue;
			this.ui.setStatus(source.statusKey, text);
			if (text) this.lastStatuses.set(source.statusKey, text);
			else this.lastStatuses.delete(source.statusKey);
		}

		const count = groups.reduce((total, group) => total + group.entries.length, 0);
		if (count === 0) {
			if (this.widgetMounted) this.ui.setWidget("active-work", undefined);
			this.widgetMounted = false;
			this.widgetCurrent = false;
			this.tui = undefined;
			this.stopTimer();
			return;
		}

		this.frame++;
		this.ensureTimer();
		if (!this.widgetCurrent) {
			this.ui.setWidget(
				"active-work",
				(tui, theme) => {
					this.tui = tui;
					return {
						render: () => this.render(tui.terminal.columns, theme),
						invalidate: () => {
							this.widgetCurrent = false;
							this.tui = undefined;
						},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetCurrent = true;
			this.widgetMounted = true;
		} else {
			this.tui?.requestRender();
		}
	}

	clearUI(): void {
		this.clearMountedUI();
		this.ui = undefined;
		this.stopTimer();
	}

	private sourceEntries(): Array<{ source: ActiveWorkSource; entries: readonly ActiveWorkEntry[] }> {
		return [...this.sources.values()].map((source) => ({ source, entries: source.getEntries() }));
	}

	private interleavedEntries(): ActiveWorkEntry[] {
		const queues = this.sourceEntries().map(({ entries }) => [...entries]);
		const result: ActiveWorkEntry[] = [];
		while (queues.some((queue) => queue.length > 0)) {
			for (const queue of queues) {
				const entry = queue.shift();
				if (entry) result.push(entry);
			}
		}
		return result;
	}

	private render(width: number, theme: ActiveWorkTheme): string[] {
		const entries = this.interleavedEntries();
		if (entries.length === 0) return [];
		const frame = SPINNER[this.frame % SPINNER.length];
		const rendered = entries.map((entry) =>
			entry.render(width, theme, frame).map((line) => truncateToWidth(line, width)),
		);
		const totalBodyLines = rendered.reduce((total, entry) => total + entry.length, 0);
		const overflow = totalBodyLines > MAX_LINES - 1;
		let remaining = MAX_LINES - 1 - (overflow ? 1 : 0);
		let hidden = 0;
		const shown: string[][] = [];
		for (const entry of rendered) {
			if (entry.length <= remaining) {
				shown.push(entry);
				remaining -= entry.length;
			} else hidden++;
		}
		const lines = [truncateToWidth(theme.fg("accent", theme.bold("● Active work")), width)];
		for (const entry of shown) lines.push(...entry);
		if (hidden > 0) {
			lines.push(truncateToWidth(theme.fg("dim", `└─ +${hidden} more active`), width));
		} else if (shown.length > 0) {
			const last = shown.at(-1)!;
			const header = lines.length - last.length;
			lines[header] = lines[header].replace("├─", "└─");
			if (last.length > 1) lines[header + 1] = lines[header + 1].replace("│  ", "   ");
		}
		return lines;
	}

	private ensureTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.update(), TICK_MS);
		this.timer.unref();
	}

	private stopTimer(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}

	private clearMountedUI(): void {
		if (!this.ui) return;
		if (this.widgetMounted) this.ui.setWidget("active-work", undefined);
		for (const source of this.sources.values()) {
			if (this.lastStatuses.has(source.statusKey)) this.ui.setStatus(source.statusKey, undefined);
		}
		this.lastStatuses.clear();
		this.widgetMounted = false;
		this.widgetCurrent = false;
		this.tui = undefined;
	}
}
