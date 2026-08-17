export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerFrame(now = Date.now()): string {
	return SPINNER[Math.floor(now / 120) % SPINNER.length]!;
}

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

export function formatDuration(startedAt: string | number, endedAt?: string | number, now = Date.now()): string {
	const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
	const end = endedAt === undefined ? now : typeof endedAt === "number" ? endedAt : Date.parse(endedAt);
	const ms = Math.max(0, end - (Number.isFinite(start) ? start : now));
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function terminalGlyph(theme: Theme, state: string): string {
	if (state === "complete" || state === "done" || state === "skipped") return theme.fg("success", "✓");
	if (state === "stopped" || state === "interrupted") return theme.fg("dim", "■");
	if (
		state === "failed" ||
		state === "error" ||
		state === "review_failed" ||
		state === "evidence_failed" ||
		state === "workspace_conflict"
	) {
		return theme.fg("error", "✗");
	}
	if (state === "blocked" || state === "authority_required" || state === "partial") return theme.fg("warning", "!");
	return theme.fg("accent", spinnerFrame());
}

export function isLiveState(state: string): boolean {
	return ["planning", "reviewing", "verifying", "ready", "executing", "judging", "iterating"].includes(state);
}

export function oneLine(value: string, max = 80): string {
	const clean = value
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return clean.length <= max ? clean : `${clean.slice(0, Math.max(1, max - 1))}…`;
}
