import type { ReviewRunOwnership } from "../../../review/src/operations-service.js";
import type { ReviewReceiptRow } from "../../../review/src/receipts.js";
import type { ReviewProgressSnapshot } from "../../../review/src/types.js";
import { clampLine } from "./bounded-lines.js";
import { formatDuration, formatTokens, isLiveState, oneLine, type Theme, terminalGlyph } from "./format.js";

export interface ReviewViewRow {
	runId: string;
	live?: ReviewProgressSnapshot;
	receipt?: ReviewReceiptRow;
	ownership: ReviewRunOwnership | { kind: "nested"; parentRunId: string };
}

export function renderReviewView(
	rows: ReviewViewRow[],
	selectedId: string | undefined,
	theme: Theme,
	width: number,
	height = 16,
): string[] {
	const lines = [clampLine(`${theme.fg("accent", "Review")}  ${theme.fg("dim", `${rows.length} runs`)}`, width)];
	if (rows.length === 0) lines.push(clampLine(theme.fg("dim", "No review runs for known roots."), width));
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
		const snap = row.live;
		const summary = row.receipt?.kind === "summary" ? row.receipt.summary : undefined;
		const state = snap?.state ?? summary?.state ?? "unknown";
		const glyph = isLiveState(state) ? terminalGlyph(theme, state) : terminalGlyph(theme, state);
		const coverage = snap
			? `${snap.coverage.completed}/${snap.coverage.selected}`
			: summary
				? `${summary.completed}/${summary.selected}`
				: "";
		const owner =
			row.ownership.kind === "foreign"
				? theme.fg("warning", ` pid ${row.ownership.pid}`)
				: row.ownership.kind === "nested"
					? theme.fg("dim", " nested")
					: "";
		lines.push(
			clampLine(
				`${marker} ${glyph} ${state} ${snap ? `c${snap.cycleIndex}/${snap.cycleCap}` : ""} ${coverage} ${formatTokens(snap?.usage.totalTokens ?? summary?.totalTokens ?? 0)}${owner}`,
				width,
			),
		);
	}
	lines.push(clampLine(theme.fg("dim", "Enter detail · s stop (owned) · Esc back"), width));
	return lines;
}

export function renderReviewDetail(snapshot: ReviewProgressSnapshot, theme: Theme, width: number): string[] {
	const lines = [
		`${theme.bold("Review")} ${snapshot.runId}`,
		`${snapshot.source.mode}/${snapshot.profile}  ${snapshot.state}  cycle ${snapshot.cycleIndex}/${snapshot.cycleCap}`,
		`coverage ${snapshot.coverage.completed}/${snapshot.coverage.selected} failed ${snapshot.coverage.failed} waived ${snapshot.coverage.waived}`,
		`tokens ${formatTokens(snapshot.usage.totalTokens)}  elapsed ${formatDuration(snapshot.startedAt, snapshot.terminalOutcome ? snapshot.updatedAt : undefined)}`,
		`planner ${snapshot.planner.status}${snapshot.planner.activity ? ` · ${snapshot.planner.activity.label}` : ""}`,
		`verifier ${snapshot.verifier.status}${snapshot.verifier.activity ? ` · ${snapshot.verifier.activity.label}` : ""}`,
	];
	for (const partition of snapshot.partitions) {
		lines.push(`partition ${partition.title} ${partition.completedItemCount}/${partition.itemCount}`);
	}
	for (const focus of snapshot.focuses) {
		lines.push(
			`focus ${focus.state} ${focus.title} findings ${focus.findingCount}${focus.activity ? ` · ${focus.activity.label}` : ""}`,
		);
	}
	for (const finding of snapshot.findings) {
		lines.push(`finding [${finding.severity}/${finding.validation}] ${finding.path}: ${finding.summary}`);
	}
	if (snapshot.metaReview) {
		lines.push(`meta ${snapshot.metaReview.sentiment}`);
		for (const residual of snapshot.metaReview.residuals) lines.push(`residual ${residual}`);
	}
	for (const failure of snapshot.failures) lines.push(`failure ${failure.path}: ${failure.reason}`);
	if (snapshot.terminalOutcome?.lastOutcome) lines.push(`outcome ${snapshot.terminalOutcome.lastOutcome}`);
	return lines.map((line) => clampLine(oneLine(line, 400), width));
}
