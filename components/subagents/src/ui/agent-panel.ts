/**
 * agent-panel.ts — Agents tab of the shared work panel.
 *
 * A compact roster of the session's public agents, running and finished, with
 * the selected agent's live conversation below it, plus an inline view of the
 * discovered agent types. The shared work panel owns mounting, focus, tabs,
 * Esc, and q; this tab owns agent selection, steering, stopping, and scroll.
 */

import {
	isKeyRelease,
	Key,
	matchesKey,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { createViewerKeys, formatViewerKey, type ViewerKeybindings } from "../../../shared/src/viewer-keys.js";
import type { WorkSectionComponent } from "../../../shared/src/work-manager.js";
import { renderAgentName } from "../agent-color.js";
import type { AgentRecord } from "../types.js";
import { getLifetimeTotal } from "../usage.js";
import {
	type AgentActivity,
	describeActivity,
	firstNonEmptyLine,
	formatDuration,
	formatMs,
	formatSessionTokens,
	formatTurns,
	type Theme,
} from "./agent-widget.js";
import { ConversationViewer } from "./conversation-viewer.js";

/**
 * Most agent rows shown above the conversation; longer lists scroll around the
 * selection. Short terminals get fewer rows, so the conversation keeps its chrome.
 */
const MAX_LIST_ROWS = 5;

export interface AgentTypeSummary {
	name: string;
	description: string;
	sourcePath?: string;
}

export interface AgentPanelDeps {
	tui: TUI;
	theme: Theme;
	keybindings?: ViewerKeybindings;
	/** Public agents of the session, newest first. */
	listAgents(): readonly AgentRecord[];
	getActivity(id: string): AgentActivity | undefined;
	stop(id: string): void;
	steer(id: string, message: string): void;
	/** Discovered agent types for the inline types view. */
	types?: readonly AgentTypeSummary[];
}

export class AgentPanel implements WorkSectionComponent {
	rowBudget = 0;
	private hasFocus = false;
	private selectedId: string | undefined;
	private viewer: ConversationViewer | undefined;
	private viewerId: string | undefined;
	private mode: "agents" | "types" = "agents";
	private selectedType = 0;

	constructor(private readonly deps: AgentPanelDeps) {
		this.rowBudget = Math.floor(deps.tui.terminal.rows * 0.7);
	}

	/** Set by the work panel while this tab is active and focused; forwarded to the conversation. */
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

	getSelectedId(): string | undefined {
		return this.selectedId;
	}

	title(): string {
		return `Agents · ${this.deps.listAgents().length}`;
	}

	hints(): string[] {
		return [this.mode === "agents" ? "t types" : "t agents"];
	}

	isComposing(): boolean {
		return this.viewer?.isComposing() ?? false;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		const viewer = this.mode === "agents" ? this.syncViewer() : undefined;
		if (viewer?.isComposing()) {
			viewer.handleInput(data);
			this.deps.tui.requestRender();
			return;
		}
		if (matchesKey(data, "t")) {
			this.mode = this.mode === "agents" ? "types" : "agents";
			if (this.viewer) this.viewer.focused = this.mode === "agents" && this.hasFocus;
			this.deps.tui.requestRender();
			return;
		}
		if (this.mode === "types") {
			this.handleTypesInput(data);
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
			this.cycle(matchesKey(data, Key.tab) ? 1 : -1);
			return;
		}
		viewer?.handleInput(data);
		this.deps.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			if (this.mode === "agents") this.viewer?.scrollBy(event.wheelDelta ?? 0);
			return { handled: true };
		}
		return undefined;
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
		const bottom = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		if (this.mode === "types") return [...this.renderTypes(row), bottom];

		const records = this.deps.listAgents();
		const viewer = this.syncViewer();
		if (!viewer) return [row(th.fg("muted", "(no agents)")), row(th.fg("dim", "t types")), bottom];

		const selectedIndex = Math.max(
			0,
			records.findIndex((record) => record.id === this.selectedId),
		);
		// The roster gets what the row budget leaves after the conversation's chrome,
		// any open composer, and one conversation row.
		const listRows = Math.max(0, Math.min(MAX_LIST_ROWS, this.rowBudget - viewer.minimumRows()));
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(listRows / 2), records.length - listRows));
		const lines = records.slice(start, start + listRows).map((record) => row(this.rosterLine(record)));
		viewer.rowBudget = this.rowBudget;
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

	private rosterLine(record: AgentRecord): string {
		const th = this.deps.theme;
		const marker = record.id === this.selectedId ? th.fg("accent", "›") : " ";
		const activity = this.deps.getActivity(record.id);
		const tokens = getLifetimeTotal(activity?.lifetimeUsage ?? record.lifetimeUsage);
		const stats = [
			record.status,
			record.status === "running" && activity ? describeActivity(activity.activeTools, activity.responseText) : "",
			activity ? formatTurns(activity.turnCount, activity.maxTurns) : "",
			record.toolUses > 0 ? `${record.toolUses} tools` : "",
			tokens > 0 ? formatSessionTokens(tokens, null, th) : "",
			record.status === "queued"
				? formatMs(Date.now() - record.startedAt)
				: formatDuration(record.startedAt, record.completedAt),
		]
			.filter(Boolean)
			.join(" · ");
		return `${marker} ${statusIcon(record, th)} ${renderAgentName(record.type, th)} ${th.fg("text", firstNonEmptyLine(record.description))} ${th.fg("dim", `· ${stats}`)}`;
	}

	private renderTypes(row: (content: string) => string): string[] {
		const th = this.deps.theme;
		const types = this.deps.types ?? [];
		const keys = createViewerKeys(this.deps.keybindings);
		const budget = Math.max(1, this.rowBudget - 1);
		const header = row(th.fg("accent", th.bold(`Agent types · ${types.length}`)));
		if (budget === 1) return [header];
		const selected = types[this.selectedType];
		const details = selected
			? [
					row(th.fg("muted", firstNonEmptyLine(selected.description))),
					...(selected.sourcePath ? [row(th.fg("dim", selected.sourcePath))] : []),
				]
			: [];
		const shownDetails = details.slice(0, Math.max(0, budget - 3));
		const slots = Math.max(0, budget - 2 - shownDetails.length);
		const start = Math.max(0, Math.min(this.selectedType - Math.floor(slots / 2), types.length - slots));
		return [
			header,
			...types.slice(start, start + slots).map((type) => row(`${type === selected ? ">" : " "} ${type.name}`)),
			...shownDetails,
			row(th.fg("dim", `${formatViewerKey(keys.upKey)}/${formatViewerKey(keys.downKey)} select · t agents`)),
		];
	}

	private handleTypesInput(data: string): void {
		const types = this.deps.types ?? [];
		if (types.length === 0) return;
		const keys = createViewerKeys(this.deps.keybindings);
		if (keys.scrollUp(data) || matchesKey(data, Key.shift("tab"))) {
			this.selectedType = Math.max(0, this.selectedType - 1);
		} else if (keys.scrollDown(data) || matchesKey(data, Key.tab)) {
			this.selectedType = Math.min(types.length - 1, this.selectedType + 1);
		} else return;
		this.deps.tui.requestRender();
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
			// The work panel handles Esc and q before keys reach this view.
			() => {},
			() => this.deps.stop(record.id),
			keybindings,
			(message) => this.deps.steer(record.id, message),
		);
		this.viewer.joinTop = true;
		this.viewer.focused = this.hasFocus && this.mode === "agents";
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
