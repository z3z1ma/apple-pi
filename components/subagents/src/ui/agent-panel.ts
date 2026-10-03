/**
 * agent-panel.ts — Glanceable subagent panel.
 *
 * A compact list of the session's public agents, running and finished, with
 * the selected agent's live conversation below it. The installer mounts it as
 * a non-capturing overlay, so the editor keeps keyboard input until the
 * operator focuses the panel.
 */

import {
	type Component,
	isKeyRelease,
	Key,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ViewerKeybindings } from "../../../shared/src/viewer-keys.js";
import { renderAgentName } from "../agent-color.js";
import type { AgentRecord } from "../types.js";
import { type AgentActivity, firstNonEmptyLine, type Theme } from "./agent-widget.js";
import { ConversationViewer, VIEWPORT_HEIGHT_PCT } from "./conversation-viewer.js";

/** Key that moves focus between the editor and the panel. */
export const AGENT_PANEL_FOCUS_KEY = "alt+g";
/** The panel hides on terminals narrower than this many columns. */
export const AGENT_PANEL_MIN_COLUMNS = 120;
/**
 * Most agent rows shown above the conversation; longer lists scroll around the
 * selection. Short terminals get fewer rows, so the conversation keeps its chrome.
 */
const MAX_LIST_ROWS = 5;
/** Panel rows above the agent list: top border and title. */
const PANEL_HEADER_ROWS = 2;

export interface AgentPanelDeps {
	tui: TUI;
	theme: Theme;
	keybindings?: ViewerKeybindings;
	/** Public agents of the session, newest first. */
	listAgents(): readonly AgentRecord[];
	getActivity(id: string): AgentActivity | undefined;
	stop(id: string): void;
	steer(id: string, message: string): void;
	/** Return keyboard focus to the editor. */
	unfocus(): void;
	/** Remove the panel. */
	unpin(): void;
}

export class AgentPanel implements Component {
	private hasFocus = false;
	private selectedId: string | undefined;
	private viewer: ConversationViewer | undefined;
	private viewerId: string | undefined;

	constructor(private readonly deps: AgentPanelDeps) {}

	/** Set by the TUI when the panel gains or loses keyboard focus; forwarded to the conversation. */
	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(value: boolean) {
		this.hasFocus = value;
		if (this.viewer) this.viewer.focused = value;
	}

	select(id: string): void {
		this.selectedId = id;
		this.syncViewer();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, AGENT_PANEL_FOCUS_KEY)) {
			this.deps.unfocus();
			return;
		}
		const viewer = this.syncViewer();
		if (!viewer?.isComposing()) {
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
				this.cycle(matchesKey(data, Key.tab) ? 1 : -1);
				return;
			}
			if (!viewer) {
				if (matchesKey(data, "escape")) this.deps.unfocus();
				else if (matchesKey(data, "q")) this.deps.unpin();
				return;
			}
		}
		viewer?.handleInput(data);
		this.deps.tui.requestRender();
	}

	render(width: number): string[] {
		if (width < 6) return [];
		const th = this.deps.theme;
		const innerW = width - 4;
		const row = (content: string) => {
			const clipped = truncateToWidth(content, innerW, "...", true);
			const pad = " ".repeat(Math.max(0, innerW - visibleWidth(clipped)));
			return `${th.fg("border", "│")} ${clipped}${pad} ${th.fg("border", "│")}`;
		};
		const records = this.deps.listAgents();
		const viewer = this.syncViewer();

		const title = th.fg("accent", th.bold(`Agents · ${records.length}`));
		const hint = th.fg("dim", this.focused ? "Tab next · Esc editor" : "Alt+G focus");
		const gap = Math.max(1, innerW - visibleWidth(title) - visibleWidth(hint));
		const lines = [th.fg("border", `╭${"─".repeat(width - 2)}╮`), row(title + " ".repeat(gap) + hint)];

		const selectedIndex = Math.max(
			0,
			records.findIndex((record) => record.id === this.selectedId),
		);
		// The list gets what the height ceiling leaves after the conversation's chrome,
		// any open composer, and one conversation row.
		const ceiling = Math.floor((this.deps.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
		const listRows = viewer
			? Math.max(0, Math.min(MAX_LIST_ROWS, ceiling - PANEL_HEADER_ROWS - viewer.minimumRows()))
			: MAX_LIST_ROWS;
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(listRows / 2), records.length - listRows));
		for (const record of records.slice(start, start + listRows)) {
			const marker = record.id === this.selectedId ? th.fg("accent", "›") : " ";
			lines.push(
				row(
					`${marker} ${statusIcon(record, th)} ${renderAgentName(record.type, th)} ${th.fg("text", firstNonEmptyLine(record.description))} ${th.fg("dim", `· ${record.status}`)}`,
				),
			);
		}

		if (!viewer) {
			lines.push(row(th.fg("muted", "(no agents)")));
			lines.push(th.fg("border", `╰${"─".repeat(width - 2)}╯`));
			return lines;
		}
		viewer.reservedRows = lines.length;
		return [...lines, ...viewer.render(width)];
	}

	invalidate(): void {
		this.viewer?.invalidate();
	}

	dispose(): void {
		this.viewer?.dispose();
		this.viewer = undefined;
		this.viewerId = undefined;
	}

	private cycle(step: number): void {
		const records = this.deps.listAgents();
		if (records.length === 0) return;
		const index = records.findIndex((record) => record.id === this.selectedId);
		const next = records[(Math.max(0, index) + step + records.length) % records.length];
		if (next) this.select(next.id);
		this.deps.tui.requestRender();
	}

	/** Keep one conversation view bound to the selected agent, falling back to the newest. */
	private syncViewer(): ConversationViewer | undefined {
		const records = this.deps.listAgents();
		const record = records.find((candidate) => candidate.id === this.selectedId) ?? records[0];
		this.selectedId = record?.id;
		if (record && record.id === this.viewerId && this.viewer) {
			this.viewer.setActivity(this.deps.getActivity(record.id));
			return this.viewer;
		}
		this.viewer?.dispose();
		this.viewer = undefined;
		this.viewerId = record?.id;
		if (!record) return undefined;
		const { tui, theme, keybindings } = this.deps;
		this.viewer = new ConversationViewer(
			tui,
			record.session,
			record,
			this.deps.getActivity(record.id),
			theme,
			(action) => (action === "unpin" ? this.deps.unpin() : this.deps.unfocus()),
			() => this.deps.stop(record.id),
			keybindings,
			(message) => this.deps.steer(record.id, message),
		);
		this.viewer.joinTop = true;
		this.viewer.focused = this.hasFocus;
		return this.viewer;
	}
}

function statusIcon(record: AgentRecord, th: Theme): string {
	switch (record.status) {
		case "running":
			return th.fg("accent", "●");
		case "completed":
			return th.fg("success", "✓");
		case "error":
			return th.fg("error", "✗");
		default:
			return th.fg("dim", "○");
	}
}
