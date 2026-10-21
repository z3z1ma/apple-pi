// What the operator's attention needs, as tmux shows it: the status-line summary and the jump target.

export interface AttentionRow {
	paneId: string;
	runState: string;
	prompt: boolean;
	/** Since when the session has needed the operator: an open prompt, or a settle not seen yet (kept while it works). */
	needsYouSince: number | null;
}

type Display = "waiting" | "done" | "working" | "quiet";

// The sidebar's Catppuccin Mocha warning, success, primary, and muted text.
const STYLE: Record<Display, string> = { waiting: "#FAE3B0", done: "#ABE9B3", working: "#F5C2E7", quiet: "#7f849c" };
const GLYPH: Record<Display, string> = { waiting: "?", done: "\u2713", working: "\u283f", quiet: "\u00b7" };

/** What the session does now: a run in progress shows as working even when an earlier result is still unseen. */
function display(row: AttentionRow): Display {
	if (row.prompt) return "waiting";
	if (row.runState !== "idle") return "working";
	return row.needsYouSince !== null ? "done" : "quiet";
}

/** A status-line segment counting sessions by state, or nothing when there are none. */
export function statusSummary(rows: AttentionRow[]): string {
	if (rows.length === 0) return "";
	const parts = (Object.keys(STYLE) as Display[]).flatMap((state) => {
		const count = rows.filter((row) => display(row) === state).length;
		if (!count) return [];
		const bold = state === "waiting" || state === "done" ? ",bold" : "";
		return [`#[fg=${STYLE[state]}${bold}]${GLYPH[state]} ${count}`];
	});
	return `#[fg=${STYLE.quiet}]\u03c0 ${parts.join(" ")}#[default] `;
}

/**
 * The pane of the session that has needed the operator longest, or nothing. Sessions that wait now (asking, or done)
 * come before working ones whose earlier result is unseen.
 */
export function jumpTarget(rows: AttentionRow[]): string {
	const working = (row: AttentionRow) => Number(display(row) === "working");
	const waiting = rows.filter((row) => row.needsYouSince !== null);
	waiting.sort((a, b) => working(a) - working(b) || (a.needsYouSince as number) - (b.needsYouSince as number));
	return waiting[0]?.paneId ?? "";
}
