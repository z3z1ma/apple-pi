// What the HTML overlay shows about the view itself, set by the Phaser scene: the place's name, short notices, and a
// choice to make (which headquarters to enter). Each change replaces the state object, as useSyncExternalStore needs.

export interface Choice {
	label: string;
	detail?: string;
	choose(): void;
}

export interface ViewState {
	title?: string;
	subtitle?: string;
	notice?: { id: number; text: string };
	chooser?: { title: string; choices: Choice[] };
}

export interface ViewStore {
	get(): ViewState;
	subscribe(listener: () => void): () => void;
	update(change: Partial<ViewState>): void;
	notify(text: string): void;
}

export function viewStore(): ViewStore {
	let state: ViewState = {};
	let notices = 0;
	const listeners = new Set<() => void>();
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
	};
}
