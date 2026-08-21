import type { ReadonlyFooterDataProvider, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export interface FooterUsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	latestCacheHitRate?: number;
}

export interface FooterStatus {
	key: string;
	text: string;
}

export interface FooterSnapshot {
	cwd?: string;
	sessionName?: string;
	branch?: string | null;
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
		contextWindow: number;
	};
	usage?: FooterUsageTotals;
	usingSubscription?: boolean;
	autoCompactionEnabled?: boolean;
	availableProviderCount?: number;
	statuses: readonly FooterStatus[];
}

/**
 * The deliberately narrow private runtime shape captured by the Pi 0.84.x
 * bridge. It is kept local to an input-card instance and never stored globally.
 */
export interface TelemetrySession {
	readonly sessionManager: {
		getEntries(): readonly SessionEntry[];
	};
	readonly modelRuntime: {
		isUsingSubscription(providerId: string): boolean;
	};
	readonly autoCompactionEnabled: boolean;
}

export type StatusFooterFactory = (
	tui: TUI,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void };

export interface InteractiveModePrototype {
	setExtensionFooter(factory: unknown): unknown;
}

export interface InteractiveModeConstructor {
	prototype: InteractiveModePrototype;
}
