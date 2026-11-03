import type { Action } from "../../game/actions.js";

export interface PointerState {
	hover?: Action[];

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
