import type { Theme as PiTheme } from "@earendil-works/pi-coding-agent";
export type Theme = Pick<PiTheme, "fg" | "bold">;

export function fgPreservingNestedStyles(theme: Theme, color: Parameters<Theme["fg"]>[0], text: string): string {
	const styleStart = theme.fg(color, "").replace(/\u001b\[(?:0|39)m/g, "");
	return theme.fg(
		color,
		text.replace(/\u001b\[(?:0|39)m/g, (reset) => `${reset}${styleStart}`),
	);
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

export function formatSessionTokens(tokens: number, percent: number | null, theme: Theme, compactions = 0): string {
	const tokenStr = formatTokens(tokens);
	const annot: string[] = [];
	if (percent !== null) {
		const color = percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim";
		annot.push(theme.fg(color, `${Math.round(percent)}%`));
	}
	if (compactions > 0) annot.push(theme.fg("dim", `⇊${compactions}`));
	return annot.length ? `${tokenStr} (${annot.join(" · ")})` : tokenStr;
}

export function formatDuration(startedAt: number, completedAt?: number): string {
	return `${(((completedAt ?? Date.now()) - startedAt) / 1000).toFixed(1)}s${completedAt ? "" : " (running)"}`;
}
