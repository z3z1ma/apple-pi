import type { RalphRunOwnership } from "../../../ralph/src/operations-service.js";
import type { RalphReceiptRow } from "../../../ralph/src/receipts.js";
import type { RalphProgressSnapshot } from "../../../ralph/src/types.js";
import { clampLine } from "./bounded-lines.js";
import { formatDuration, formatTokens, isLiveState, oneLine, type Theme, terminalGlyph } from "./format.js";

export interface RalphViewRow {
	runId: string;
	workspaceRoot: string;
	live?: RalphProgressSnapshot;
	receipt?: RalphReceiptRow;
	ownership: RalphRunOwnership;
}

export function renderRalphView(
	rows: RalphViewRow[],
	selectedId: string | undefined,
	theme: Theme,
	width: number,
	height = 16,
): string[] {
	const lines = [clampLine(`${theme.fg("accent", "Ralph")}  ${theme.fg("dim", `${rows.length} runs`)}`, width)];
	if (rows.length === 0) lines.push(clampLine(theme.fg("dim", "No Ralph runs for known roots."), width));
	const budget = Math.max(3, height - 3);
	for (const row of rows.slice(0, budget)) {
		const marker = row.runId === selectedId ? theme.fg("accent", "●") : theme.fg("dim", "○");
		if (row.receipt?.kind === "load_error") {
			lines.push(
				clampLine(
					`${marker} ${theme.fg("error", "load error")} ${row.runId} ${oneLine(row.receipt.reason, 40)}`,
					width,
				),
			);
			continue;
		}
		if (row.receipt?.kind === "legacy_audit") {
			lines.push(clampLine(`${marker} ${theme.fg("dim", "legacy audit")} ${row.runId}`, width));
			continue;
		}
		const snap = row.live;
		const summary = row.receipt?.kind === "summary" ? row.receipt.summary : undefined;
		const state = snap?.state ?? summary?.state ?? "unknown";
		const glyph = terminalGlyph(theme, state);
		const iteration = snap?.iteration ?? summary?.iteration ?? 0;
		const task = snap?.taskPath ?? summary?.taskPath ?? "";
		const wi = snap ? `WI ${snap.workItems.complete}/${snap.workItems.total}` : "";
		const owner = row.ownership.kind === "foreign" ? theme.fg("warning", `pid ${row.ownership.pid}`) : "";
		const live = isLiveState(state) ? " " : "";
		lines.push(
			clampLine(
				`${marker} ${glyph}${live}${state} iter ${iteration} ${owner} ${wi} ${oneLine(task, 24)} ${formatTokens(snap?.usage.totalTokens ?? summary?.totalTokens ?? 0)}`,
				width,
			),
		);
	}
	lines.push(clampLine(theme.fg("dim", "Enter detail · s stop (owned) · Esc back"), width));
	return lines;
}

export function renderRalphDetail(snapshot: RalphProgressSnapshot, theme: Theme, width: number): string[] {
	const lines = [
		`${theme.bold("Ralph")} ${snapshot.runId}`,
		`task ${snapshot.taskPath}`,
		`workspace ${snapshot.projectRoot}`,
		`ledger ${snapshot.ledgerRoot}`,
		`${snapshot.state}  iter ${snapshot.iteration}  ${snapshot.mode}`,
		`tokens ${formatTokens(snapshot.usage.totalTokens)}  elapsed ${formatDuration(snapshot.startedAt, snapshot.terminalOutcome ? snapshot.updatedAt : undefined)}`,
		`WI ${snapshot.workItems.complete}/${snapshot.workItems.total} open ${snapshot.workItems.open} cancelled ${snapshot.workItems.cancelled}`,
	];
	for (const item of snapshot.workItems.items) lines.push(`  ${item.id} ${item.state} ${item.description}`);
	if (snapshot.activity) lines.push(`activity ${snapshot.activity.label}`);
	if (snapshot.nextObjective) lines.push(`next ${snapshot.nextObjective}`);
	if (snapshot.gate) lines.push(`gate ${snapshot.gate.kind}: ${snapshot.gate.reason}`);
	if (snapshot.terminalOutcome?.lastOutcome) lines.push(`outcome ${snapshot.terminalOutcome.lastOutcome}`);
	return lines.map((line) => clampLine(oneLine(line, 400), width));
}
