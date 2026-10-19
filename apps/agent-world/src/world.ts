// The world as the backend reports it to the world UI. Shared by the backend, the preload bridge, and the renderer.

/**
 * A coordinator keeps a headquarters; a worker reports to a coordinator; an independent session reports to none
 * (`.wiki/pages/agent-world-language.md`).
 */
export type Role = "coordinator" | "worker" | "independent";

/** Where an awake character is. Headquarters, and the places inside them, are keyed by their coordinator's id. */
export type PlaceRef =
	| { kind: "headquarters" | "common-room" | "gallery"; headquarters: string }
	| { kind: "wing"; headquarters: string; repository: string }
	| { kind: "square" };

/** One awake top-level Pi session. */
export interface Character {
	id: string;
	name: string;
	role: Role;
	place: PlaceRef;
	/** When the session first started (ms); characters are listed in this order, so nobody moves when another leaves. */
	startedAt: number;
}

/** One repository's wing. It stays once seen, boarded up while nobody works in it. */
export interface Wing {
	/** The repository's directory (the main checkout, shared by its worktrees). */
	repository: string;
	/** What its banner says. */
	name: string;
	/** Awake workers in it; 0 means boarded up. */
	headcount: number;
}

/** A coordinator's headquarters: its hall, common room, and gallery of wings. */
export interface Headquarters {
	/** The coordinator's session id. */
	id: string;
	name: string;
	/** In the order they were first seen. */
	wings: Wing[];
}

export interface WorldSnapshot {
	/** False while the session-state runtime or its database is gone; everything else is then the last known state. */
	connected: boolean;
	/** In a stable order: the first is where the world opens. */
	headquarters: Headquarters[];
	characters: Character[];
}

/** One string per place, for maps and scene data. */
export function placeKey(place: PlaceRef): string {
	if (place.kind === "square") return "square";
	if (place.kind === "wing") return `wing:${place.headquarters}:${place.repository}`;
	return `${place.kind}:${place.headquarters}`;
}

/** What the preload bridge exposes to the world UI as `window.agentWorld`. */
export interface AgentWorldApi {
	snapshot(): Promise<WorldSnapshot>;
	/** Called with the whole new snapshot after every change; returns a function that stops the calls. */
	onUpdate(listener: (snapshot: WorldSnapshot) => void): () => void;
}
