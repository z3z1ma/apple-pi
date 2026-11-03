
export interface AttentionRow {
	paneId: string;
	runState: string;
	prompt: boolean;
	needsYouSince: number | null;
}

type Display = "waiting" | "done" | "working" | "quiet";

const STYLE: Record<Display, string> = { waiting: "#FAE3B0", done: "#ABE9B3", working: "#F5C2E7", quiet: "#7f849c" };
const GLYPH: Record<Display, string> = { waiting: "?", done: "\u2713", working: "\u283f", quiet: "\u00b7" };

function display(row: AttentionRow): Display {
	if (row.prompt) return "waiting";
	if (row.runState !== "idle") return "working";
	return row.needsYouSince !== null ? "done" : "quiet";
}

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

export function jumpTarget(rows: AttentionRow[]): string {
	const working = (row: AttentionRow) => Number(display(row) === "working");
	const waiting = rows.filter((row) => row.needsYouSince !== null);
	waiting.sort((a, b) => working(a) - working(b) || (a.needsYouSince as number) - (b.needsYouSince as number));
	return waiting[0]?.paneId ?? "";
}
