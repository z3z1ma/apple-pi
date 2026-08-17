import { clampLine, clampLines } from "./bounded-lines.js";
import type { Theme } from "./format.js";

export interface DetailViewState {
	lines: string[];
	offset: number;
	confirmingStop: boolean;
	canStop: boolean;
	stopBlockedReason?: string;
}

export function scrollDetail(state: DetailViewState, delta: number, height: number): DetailViewState {
	const max = Math.max(0, state.lines.length - Math.max(1, height - 2));
	return { ...state, offset: Math.min(max, Math.max(0, state.offset + delta)) };
}

export function renderDetailView(state: DetailViewState, theme: Theme, width: number, height: number): string[] {
	const footer = state.confirmingStop
		? theme.fg("warning", "Stop this owned run? Press stop again to confirm, Esc to cancel.")
		: state.canStop
			? theme.fg("dim", "s stop · Esc back · arrows scroll")
			: theme.fg("dim", `${state.stopBlockedReason ?? "Read only"} · Esc back · arrows scroll`);
	const body = state.lines.slice(state.offset, state.offset + Math.max(1, height - 2));
	return clampLines([...body, "", clampLine(footer, width)], width, height);
}
