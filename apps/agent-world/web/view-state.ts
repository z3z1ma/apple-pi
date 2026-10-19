// What the HTML overlay shows about the view itself, set by the Phaser scene: the place's name, short notices, and a
// choice to make (which headquarters to enter). Each change replaces the state object, as useSyncExternalStore needs.
//
// It also carries what the interface and the world say to each other: the minimap the world publishes, and intents
// the interface sends (travel, go to, talk to, walk to a point) for the world to carry out.
import type { PlaceRef } from "../src/world.js";
import type { AvatarLook } from "./looks.js";

export interface Choice {
	label: string;
	detail?: string;
	choose(): void;
}

/** A dot on the minimap, in the place's tiles. */
export interface MinimapDot {
	id: string;
	kind: "agent" | "townsfolk" | "avatar";
	x: number;
	y: number;
}

/** The current place as the minimap draws it: its painting scaled to fit, and who is where. */
export interface MinimapView {
	/** The place's key (`placeKey`). */
	place: string;
	/** The painting's URL. */
	painting: string;
	/** The place's size in tiles. */
	cols: number;
	rows: number;
	/** The painting's own width in tiles; a growing place lays `strips` of it side by side. */
	paintingCols: number;
	strips?: { from: number; to: number; at: number }[];
	dots: MinimapDot[];
	/** The part of the place on screen, in tiles. */
	view?: { x: number; y: number; w: number; h: number };
}

/**
 * What the interface asks of the world. Every action on a character works from the side panel wherever the avatar is:
 * the world carries out walking and travel; the interface itself handles examining and the terminal.
 */
export type WorldIntent =
	/** A click on the minimap: walk to that point (tiles) of the current place. */
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
	| { kind: "choose-theme"; theme: string };

/** A theme in Settings: its name and line, and why it cannot be worn when its pack is broken. */
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
	/** Set by the world as the view or the people in it change. */
	minimap?: MinimapView;
	/** Whether the world draws its walk grid. */
	walkGrid?: boolean;
	/** What the theme calls each kind of place (`Theme.labels`), once the theme has loaded. */
	labels?: Record<string, string>;
	/** The theme's avatar looks to choose from in Settings, once the theme has loaded. */
	avatarLooks?: AvatarLook[];
	/**
	 * A theme the world could not wear, shown until dismissed: which, what it wears instead, and why (each problem as
	 * `file: fault`).
	 */
	themeProblem?: { theme: string; showing: string; problems: string[]; switching?: boolean };
	/** The themes to choose from in Settings, and the one worn. */
	themes?: ThemeOption[];
	theme?: string;
}

export interface ViewStore {
	get(): ViewState;
	subscribe(listener: () => void): () => void;
	update(change: Partial<ViewState>): void;
	notify(text: string): void;
	/** Send an intent to every intent listener. */
	intend(intent: WorldIntent): void;
	/** Calls `listener` with each intent; returns a function that stops the calls. */
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
