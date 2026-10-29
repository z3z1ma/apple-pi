import type { AgentWorldApi } from "../src/world.js";

export function createReplyWatches(api: Pick<AgentWorldApi, "watchReplies">) {
	const readers = new Map<object, string>();
	return (reader: object, characterId?: string): Promise<void> => {
		if (characterId) readers.set(reader, characterId);
		else readers.delete(reader);
		return Promise.resolve().then(() => api.watchReplies([...new Set(readers.values())]));
	};
}

declare global {
	interface Window {
		agentWorldReplyWatches: ReturnType<typeof createReplyWatches>;
	}
}
