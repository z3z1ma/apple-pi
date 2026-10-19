// The world as the backend reports it to the world UI. Shared by the backend, the preload bridge, and the renderer.

/** One awake top-level Pi session. */
export interface Character {
	id: string;
	name: string;
}

export interface WorldSnapshot {
	/** False while the session-state runtime or its database is gone; the characters are then the last known ones. */
	connected: boolean;
	characters: Character[];
}

/** What the preload bridge exposes to the world UI as `window.agentWorld`. */
export interface AgentWorldApi {
	snapshot(): Promise<WorldSnapshot>;
	/** Called with the whole new snapshot after every change; returns a function that stops the calls. */
	onUpdate(listener: (snapshot: WorldSnapshot) => void): () => void;
}
