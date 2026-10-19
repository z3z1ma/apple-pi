import type { AgentWorldApi, WorldSnapshot } from "../src/world.js";

/** The latest snapshot from the backend, shared by the Phaser scenes and the React overlay. */
export interface WorldStore {
	get(): WorldSnapshot | undefined;
	subscribe(listener: () => void): () => void;
}

export function worldStore(api: AgentWorldApi): WorldStore {
	let snapshot: WorldSnapshot | undefined;
	const listeners = new Set<() => void>();
	const set = (next: WorldSnapshot) => {
		snapshot = next;
		for (const listener of listeners) listener();
	};
	api.onUpdate(set);
	// An update that arrives first is newer than the snapshot asked for.
	void api.snapshot().then((first) => snapshot ?? set(first));
	return {
		get: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
