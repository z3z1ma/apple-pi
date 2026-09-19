import type { ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export interface FooterStatus {
	key: string;
	text: string;
}

export interface FooterSnapshot {
	model?: {
		provider: string;
		providerName?: string;
		id: string;
		name?: string;
		reasoning: boolean;
		thinkingLevel?: string;
	};
	context?: {
		percent: number | null;
	};
	cacheHitRate?: number;
	fastModeEnabled?: boolean;
	statuses: readonly FooterStatus[];
}

export type EmptyFooterFactory = (
	tui: TUI,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void };
