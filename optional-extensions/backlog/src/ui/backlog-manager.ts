import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	isKeyRelease,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { BacklogItem } from "../state.js";

export type BacklogManagerAction =
	| { type: "close" }
	| { type: "create" }
	| { type: "edit"; id: number }
	| { type: "delete"; id: number }
	| { type: "move"; id: number; direction: "up" | "down" };

export class BacklogManagerComponent implements Component {
	private selectedIndex = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly items: readonly BacklogItem[],
		selectedId: number | undefined,
		private readonly done: (action: BacklogManagerAction) => void,
	) {
		if (this.items.length > 0) {
			if (selectedId !== undefined) {
				const foundIndex = this.items.findIndex((item) => item.id === selectedId);
				this.selectedIndex = foundIndex >= 0 ? foundIndex : 0;
			} else {
				this.selectedIndex = 0;
			}
		} else {
			this.selectedIndex = 0;
		}
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;

		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done({ type: "close" });
			return;
		}

		if (matchesKey(data, "c")) {
			this.done({ type: "create" });
			return;
		}

		if (this.items.length === 0) {
			return;
		}

		const currentItem = this.items[this.selectedIndex];
		if (!currentItem) return;

		if (matchesKey(data, "shift+up")) {
			this.done({ type: "move", id: currentItem.id, direction: "up" });
			return;
		}

		if (matchesKey(data, "shift+down")) {
			this.done({ type: "move", id: currentItem.id, direction: "down" });
			return;
		}

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			if (this.selectedIndex < this.items.length - 1) {
				this.selectedIndex++;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		if (matchesKey(data, "e")) {
			this.done({ type: "edit", id: currentItem.id });
			return;
		}

		if (matchesKey(data, "d")) {
			this.done({ type: "delete", id: currentItem.id });
			return;
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		if (this.cachedLines && this.cachedWidth === renderWidth) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const safeLine = (line: string): string =>
			visibleWidth(line) > renderWidth ? truncateToWidth(line, renderWidth, "") : line;
		const add = (text: string) => {
			for (const line of wrapTextWithAnsi(text, renderWidth)) {
				lines.push(safeLine(line));
			}
		};
		const addPrefixed = (prefix: string, text: string) => {
			const prefixW = visibleWidth(prefix);
			if (prefixW >= renderWidth) {
				add(prefix + text);
				return;
			}
			const available = Math.max(1, renderWidth - prefixW);
			const wrapped = wrapTextWithAnsi(text, available);
			const continuation = " ".repeat(prefixW);
			for (let i = 0; i < wrapped.length; i++) {
				const line = (i === 0 ? prefix : continuation) + wrapped[i];
				lines.push(safeLine(line));
			}
		};

		lines.push(safeLine(this.theme.fg("accent", "─".repeat(renderWidth))));

		const countText =
			this.items.length === 0 ? "empty" : `${this.items.length} ${this.items.length === 1 ? "item" : "items"}`;
		const headerTitle = ` ${this.theme.fg("accent", this.theme.bold("Backlog"))} ${this.theme.fg("muted", `(${countText})`)}`;
		add(headerTitle);
		lines.push(safeLine(this.theme.fg("borderMuted", "─".repeat(renderWidth))));

		if (this.items.length === 0) {
			lines.push("");
			addPrefixed("  ", this.theme.fg("muted", "No items in session backlog."));
			addPrefixed("  ", this.theme.fg("dim", "Press c to create one, or use backlog_add while working."));
			lines.push("");
		} else {
			lines.push("");
			for (let i = 0; i < this.items.length; i++) {
				const item = this.items[i];
				const isSelected = i === this.selectedIndex;
				const cursor = isSelected ? this.theme.fg("accent", "> ") : "  ";
				const num = `${i + 1}. `;
				const idTag = `#${item.id} `;
				const titleText = item.title;

				if (isSelected) {
					const label = `${num}${idTag}${titleText}`;
					addPrefixed(cursor, this.theme.fg("accent", this.theme.bold(label)));
				} else {
					const prefix = `${cursor}${this.theme.fg("dim", num)}${this.theme.fg("muted", idTag)}`;
					const styledTitle = this.theme.fg("text", titleText);
					addPrefixed(prefix, styledTitle);
				}
			}

			const selected = this.items[this.selectedIndex];
			if (selected) {
				lines.push("");
				lines.push(safeLine(this.theme.fg("borderMuted", "─".repeat(renderWidth))));
				lines.push("");

				const detailHeader = ` ${this.theme.fg("dim", "Selected:")} ${this.theme.fg("accent", this.theme.bold(`#${selected.id} ${selected.title}`))}`;
				add(detailHeader);

				if (selected.description && selected.description.trim().length > 0) {
					lines.push("");
					const descPrefix = "   ";
					const descAvailable = Math.max(1, renderWidth - visibleWidth(descPrefix));
					const descLines = wrapTextWithAnsi(selected.description, descAvailable);
					for (const dLine of descLines) {
						lines.push(safeLine(descPrefix + this.theme.fg("muted", dLine)));
					}
				} else {
					lines.push("");
					addPrefixed("   ", this.theme.fg("dim", "(No description provided)"));
				}
			}
			lines.push("");
		}

		lines.push(safeLine(this.theme.fg("borderMuted", "─".repeat(renderWidth))));

		const footerHelp =
			this.items.length === 0
				? " c Create  ·  Esc / Ctrl+C Close"
				: " c Create  ·  ↑/↓ Select  ·  Shift+↑/↓ Move  ·  e Edit  ·  d Delete  ·  Esc Close";
		addPrefixed(" ", this.theme.fg("dim", footerHelp));
		lines.push(safeLine(this.theme.fg("accent", "─".repeat(renderWidth))));

		const result = lines.map((l) => safeLine(l));
		this.cachedWidth = renderWidth;
		this.cachedLines = result;
		return result;
	}
}
