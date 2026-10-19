// What the pointer layer shows over the world, set by the Phaser scene: the hover text for what is under the pointer,
// and the right-click menu. One store for the whole page; each change replaces the state object, as
// useSyncExternalStore needs.
import type { Action } from "../../game/actions.js";

export interface PointerState {
	/** The actions on what is under the pointer, default first; undefined when the pointer is off the world. */
	hover?: Action[];
	/** The right-click menu, at screen px. */
	menu?: { x: number; y: number; actions: Action[] };
}

let state: PointerState = {};
const listeners = new Set<() => void>();

function update(change: Partial<PointerState>) {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
}

const sameActions = (a: Action[] | undefined, b: Action[] | undefined) =>
	a === b || (!!a && !!b && a.length === b.length && a.every((action, i) => action.label === b[i].label));

export const pointer = {
	get: (): PointerState => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	/** Set the hover actions (shown, never run); the same labels again change nothing, so React does not redraw every frame. */
	hover(actions: Action[] | undefined) {
		if (!sameActions(actions, state.hover)) update({ hover: actions });
	},
	openMenu(x: number, y: number, actions: Action[]) {
		update({ menu: { x, y, actions } });
	},
	closeMenu() {
		if (state.menu) update({ menu: undefined });
	},
	menuOpen: () => state.menu !== undefined,
};
