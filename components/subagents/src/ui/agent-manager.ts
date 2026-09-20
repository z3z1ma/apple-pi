import { type Component, isKeyRelease, matchesKey, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
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
	getDisplayName,
	type Theme,
} from "./agent-widget.js";
import {
	createViewerKeys,
	formatViewerKey,
	type ViewerKeybindings,
	type ViewerKeys,
} from "../../../shared/src/viewer-keys.js";

export interface AgentTypeSummary {
	name: string;
	description: string;
	sourcePath?: string;
}

export type AgentManagerAction = { type: "close" } | { type: "inspect"; id: string };

const isPublic = (record: AgentRecord): boolean => !record.parentAgentId && !record.internalOwner;

export interface AgentManagerUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: ViewerKeybindings, done: (result: T) => void) => Component,
		options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
	): Promise<T>;
}

export interface OpenAgentManagerOptions {
	getRecords(): readonly AgentRecord[];
	getActivity(id: string): AgentActivity | undefined;
	types: readonly AgentTypeSummary[];
	inspect(record: AgentRecord): Promise<void>;
}

export async function openAgentManager(ui: AgentManagerUI, options: OpenAgentManagerOptions): Promise<void> {
	let selectedId: string | undefined;
	while (true) {
		const action = await ui.custom<AgentManagerAction>(
			(tui, theme, keybindings, done) =>
				new AgentManagerComponent(
					tui,
					theme,
					options.getRecords,
					options.getActivity,
					options.types,
					selectedId,
					done,
					keybindings,
				),
			{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%" } },
		);
		if (action.type === "close") return;
		selectedId = action.id;
		const record = options.getRecords().find((candidate) => isPublic(candidate) && candidate.id === action.id);
		if (record) await options.inspect(record);
	}
}

export class AgentManagerComponent implements Component {
	private selectedId: string | undefined;
	private readonly keys: ViewerKeys;
	private mode: "agents" | "types" = "agents";
	private selectedType = 0;
	private readonly refreshTimer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly getRecords: () => readonly AgentRecord[],
		private readonly getActivity: (id: string) => AgentActivity | undefined,
		private readonly types: readonly AgentTypeSummary[],
		selectedId: string | undefined,
		private readonly done: (action: AgentManagerAction) => void,
		keybindings?: ViewerKeybindings,
	) {
		this.selectedId = selectedId;
		this.keys = createViewerKeys(keybindings);
		this.refreshTimer = setInterval(() => this.tui.requestRender(), 500);
		this.refreshTimer.unref();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done({ type: "close" });
			return;
		}
		if (matchesKey(data, "t")) {
			this.mode = this.mode === "agents" ? "types" : "agents";
			this.tui.requestRender();
			return;
		}
		if (this.mode === "types") {
			if (this.types.length === 0) return;
			if (this.keys.scrollUp(data)) this.selectedType = Math.max(0, this.selectedType - 1);
			else if (this.keys.scrollDown(data)) this.selectedType = Math.min(this.types.length - 1, this.selectedType + 1);
			else return;
			this.tui.requestRender();
			return;
		}

		const records = this.publicRecords();
		if (records.length === 0) return;
		let index = Math.max(
			0,
			records.findIndex((record) => record.id === this.selectedId),
		);
		if (this.keys.scrollUp(data)) index = Math.max(0, index - 1);
		else if (this.keys.scrollDown(data)) index = Math.min(records.length - 1, index + 1);
		else if (matchesKey(data, "enter")) {
			this.done({ type: "inspect", id: records[index].id });
			return;
		} else return;
		this.selectedId = records[index].id;
		this.tui.requestRender();
	}

	private publicRecords(): AgentRecord[] {
		return this.getRecords().filter(isPublic);
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const line = (text: string) => truncateToWidth(text, renderWidth, "");
		const maxLines = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8));
		if (this.mode === "types") {
			const header = line(this.theme.fg("accent", this.theme.bold(`Agent types · ${this.types.length}`)));
			if (maxLines === 1) return [header];
			const selected = this.types[this.selectedType];
			const details = selected
				? [
						line(this.theme.fg("muted", firstNonEmptyLine(selected.description))),
						...(selected.sourcePath ? [line(this.theme.fg("dim", selected.sourcePath))] : []),
					]
				: [];
			const shownDetails = details.slice(0, Math.max(0, maxLines - 3));
			const listSlots = Math.max(0, maxLines - 2 - shownDetails.length);
			const start = Math.max(0, Math.min(this.selectedType - Math.floor(listSlots / 2), this.types.length - listSlots));
			const visibleTypes = this.types.slice(start, start + listSlots);
			return [
				header,
				...visibleTypes.map((type) => line(`${type === selected ? ">" : " "} ${type.name}`)),
				...shownDetails,
				line(
					this.theme.fg(
						"dim",
						`${formatViewerKey(this.keys.upKey)}/${formatViewerKey(this.keys.downKey)} select · t agents · Esc close`,
					),
				),
			];
		}
		const records = this.publicRecords();
		if (!this.selectedId || !records.some((record) => record.id === this.selectedId)) {
			this.selectedId = records[0]?.id;
		}
		const lines = [line(this.theme.fg("accent", this.theme.bold(`Agents · ${records.length}`)))];
		if (maxLines === 1) return lines;
		const selectedIndex = Math.max(
			0,
			records.findIndex((record) => record.id === this.selectedId),
		);
		const bodySlots = Math.max(0, maxLines - 2);
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(bodySlots / 2), records.length - bodySlots));
		for (const record of records.slice(start, start + bodySlots)) {
			const selected = record.id === this.selectedId;
			const activity = this.getActivity(record.id);
			const tokens = getLifetimeTotal(activity?.lifetimeUsage ?? record.lifetimeUsage);
			const stats = [
				record.status,
				record.status === "running" && activity ? describeActivity(activity.activeTools, activity.responseText) : "",
				activity ? formatTurns(activity.turnCount, activity.maxTurns) : "",
				record.toolUses > 0 ? `${record.toolUses} tools` : "",
				tokens > 0 ? formatSessionTokens(tokens, null, this.theme) : "",
				record.status === "queued"
					? formatMs(Date.now() - record.startedAt)
					: formatDuration(record.startedAt, record.completedAt),
			]
				.filter(Boolean)
				.join(" · ");
			lines.push(
				line(
					`${selected ? ">" : " "} ${getDisplayName(record.type)} · ${firstNonEmptyLine(record.description)} · ${stats}`,
				),
			);
		}
		lines.push(
			line(
				this.theme.fg(
					"dim",
					`${formatViewerKey(this.keys.upKey)}/${formatViewerKey(this.keys.downKey)} select · Enter inspect · t types · Esc close`,
				),
			),
		);
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}
}
