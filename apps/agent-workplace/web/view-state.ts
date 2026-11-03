import type { PlaceRef } from "../src/world.js";
import type { AvatarLook } from "./looks.js";

export interface Choice {
	label: string;
	detail?: string;
	choose(): void;
}

export interface MinimapDot {
	id: string;
	kind: "agent" | "townsfolk" | "avatar";
	x: number;
	y: number;
}

export interface MinimapView {
	place: string;

	painting: string;

	cols: number;
	rows: number;

	paintingCols: number;
	strips?: { from: number; to: number; at: number }[];
	dots: MinimapDot[];

	view?: { x: number; y: number; w: number; h: number };

	exits?: { name: string; x: number; y: number; edge: "left" | "right" | "top" | "bottom" }[];
}

export type WorldIntent =
	| { kind: "walk-to"; place: string; at: [x: number, y: number] }
	| { kind: "travel"; place: PlaceRef }
	| { kind: "go-to"; character: string }
	| { kind: "talk-to"; character: string }
	| { kind: "examine"; character: string }
	| { kind: "terminal"; character: string }
	| { kind: "walk-grid"; shown: boolean }
	| { kind: "choose-theme"; theme: string }
	| { kind: "open-tab"; tab: "agents" | "needs-you" | "work" | "mail" | "slack" | "places" | "settings" };

export interface ThemeOption {
	id: string;
	name: string;
	description: string | null;
	broken?: string;
}

export interface ViewState {
	title?: string;
	subtitle?: string;
	notice?: { id: number; text: string };
	chooser?: { title: string; choices: Choice[] };

	minimap?: MinimapView;

	walkGrid?: boolean;

	labels?: Record<string, string>;

	avatarLooks?: AvatarLook[];

	themeProblem?: { theme: string; showing: string; problems: string[]; switching?: boolean };

	themes?: ThemeOption[];
	theme?: string;
}

export interface ViewStore {
	get(): ViewState;
	subscribe(listener: () => void): () => void;
	update(change: Partial<ViewState>): void;
	notify(text: string): void;

	intend(intent: WorldIntent): void;

	onIntent(listener: (intent: WorldIntent) => void): () => void;
}

export function viewStore(): ViewStore {
	let state: ViewState = {};
	let notices = 0;
	const listeners = new Set<() => void>();
	const intentListeners = new Set<(intent: WorldIntent) => void>();
	const update = (change: Partial<ViewState>) => {
		state = { ...state, ...change };
		for (const listener of listeners) listener();
	};
	return {
		get: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		update,
		notify: (text) => update({ notice: { id: ++notices, text } }),
		intend(intent) {
			for (const listener of intentListeners) listener(intent);
		},
		onIntent(listener) {
			intentListeners.add(listener);
			return () => intentListeners.delete(listener);
		},
	};
}
