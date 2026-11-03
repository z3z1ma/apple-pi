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
	/** The Places tab: go to a place at once. */
	| { kind: "travel"; place: PlaceRef }
	/** Go to a character: travel to its place and walk up to it. */
	| { kind: "go-to"; character: string }
	/** Talk to a character from anywhere, without walking: open its conversation. */
	| { kind: "talk-to"; character: string }
	/** Show a character's observed facts (the interface's character card). */
	| { kind: "examine"; character: string }
	/** Switch the operator's tmux client to the character's pane (the interface asks the backend). */
	| { kind: "terminal"; character: string }
	/** Settings: show or hide the walk grid. */
	| { kind: "walk-grid"; shown: boolean }
	/** Settings: wear another theme (`main.tsx` checks its pack, switches, and keeps the choice). */
	| { kind: "choose-theme"; theme: string }
	/** Open a tab of the side panel (a place sends the operator to Settings to sign in). */
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
