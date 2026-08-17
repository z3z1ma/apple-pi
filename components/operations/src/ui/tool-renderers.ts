import { truncateToWidth } from "@earendil-works/pi-tui";
import type { RalphProgressSnapshot } from "../../../ralph/src/types.js";
import { formatDuration, formatTokens, oneLine, type Theme, terminalGlyph } from "./format.js";

class LineList {
	constructor(private readonly lines: string[]) {}
	invalidate(): void {}
	render(width: number): string[] {
		return this.lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
	}
}

export function renderRalphProgressCard(
	snapshot: RalphProgressSnapshot,
	theme: Theme,
	partial: boolean,
): { render(width: number): string[] } {
	const glyph = partial ? theme.fg("warning", "◆") : terminalGlyph(theme, snapshot.state);
	const open = snapshot.workItems.items.find((item) => item.state === "open");
	const lines = [
		`${glyph} ${theme.fg("accent", "Ralph")} ${theme.fg("muted", snapshot.state)} ${theme.fg("dim", `· iter ${snapshot.iteration} · WI ${snapshot.workItems.complete}/${snapshot.workItems.total} · ${formatTokens(snapshot.usage.totalTokens)} · ${formatDuration(snapshot.startedAt, snapshot.terminalOutcome ? snapshot.updatedAt : undefined)}`)}`,
	];
	if (open) lines.push(theme.fg("dim", `  ⎿  ${open.id} ${oneLine(open.description, 72)}`));
	if (snapshot.activity) lines.push(theme.fg("dim", `  ⎿  ${snapshot.activity.label}`));
	if (snapshot.nextObjective) lines.push(theme.fg("dim", `  ⎿  next: ${oneLine(snapshot.nextObjective, 80)}`));
	if (snapshot.gate)
		lines.push(theme.fg("warning", `  ⎿  ${snapshot.gate.kind}: ${oneLine(snapshot.gate.reason, 80)}`));
	if (snapshot.terminalOutcome?.lastOutcome)
		lines.push(theme.fg("dim", `  ⎿  ${oneLine(snapshot.terminalOutcome.lastOutcome, 100)}`));
	return new LineList(lines);
}

export function throttleUpdates<T>(send: (value: T) => void, ms = 200): (value: T) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: T | undefined;
	return (value: T) => {
		pending = value;
		if (timer) return;
		send(value);
		timer = setTimeout(() => {
			timer = undefined;
			if (pending !== value && pending !== undefined) send(pending);
		}, ms);
	};
}
