import type { AgentWorldApi, CommandResult, FeedLine, TerminalResult, WorldSnapshot } from "../src/world.js";

/** Feed lines the world UI keeps for the chatbox. */
const FEED_KEPT = 200;

/** The latest snapshot and feed from the backend, shared by the Phaser scenes and the React overlay. */
export interface WorldStore {
	get(): WorldSnapshot | undefined;
	subscribe(listener: () => void): () => void;
	/** The latest runtime feed lines, oldest first; a new array after each change. */
	feed(): FeedLine[];
	subscribeFeed(listener: () => void): () => void;
	goToTerminal(characterId: string): Promise<TerminalResult>;
	/** Choose the avatar's look: the snapshot wears it at once, and the backend keeps it across restarts. */
	setAvatarLook(look: string): Promise<CommandResult>;
	/** Choose the theme: the snapshot names it at once (the world switches), and the backend keeps it across restarts. */
	setTheme(id: string): Promise<CommandResult>;
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

	let lines: FeedLine[] = [];
	const feedListeners = new Set<() => void>();
	const add = (batch: FeedLine[]) => {
		const last = lines.at(-1)?.seq ?? -1;
		const fresh = batch.filter((line) => line.seq > last);
		if (!fresh.length) return;
		lines = [...lines, ...fresh].slice(-FEED_KEPT);
		for (const listener of feedListeners) listener();
	};
	api.onFeed(add);
	// The backlog comes before any line pushed meanwhile; lines are kept in sequence order.
	void api.feed().then((backlog) => {
		const first = lines[0]?.seq ?? Number.POSITIVE_INFINITY;
		const older = backlog.filter((line) => line.seq < first);
		if (!older.length) return;
		lines = [...older, ...lines].slice(-FEED_KEPT);
		for (const listener of feedListeners) listener();
	});

	return {
		get: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		feed: () => lines,
		subscribeFeed(listener) {
			feedListeners.add(listener);
			return () => feedListeners.delete(listener);
		},
		goToTerminal: (characterId) => api.goToTerminal(characterId),
		setAvatarLook(look) {
			if (snapshot && snapshot.avatarLook !== look) set({ ...snapshot, avatarLook: look });
			return api.setAvatarLook(look);
		},
		setTheme(id) {
			if (snapshot && snapshot.theme !== id) set({ ...snapshot, theme: id });
			return typeof api.setTheme === "function"
				? api.setTheme(id)
				: Promise.resolve({ ok: false, reason: "This window cannot keep the theme." });
		},
	};
}
