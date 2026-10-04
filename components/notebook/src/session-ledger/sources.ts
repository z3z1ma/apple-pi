import { isSourceEntry } from "./progress.js";
import { type Entry, isNotebookMaintenanceEntry } from "./types.js";

export function childSourceId(sessionId: string, entryId: string): string {
	return `child:${sessionId}:${entryId}`;
}

/** Archived child sources are recallable without becoming primary context or coverage. */
export function notebookSourceEntries(entries: Entry[]): Entry[] {
	return entries.flatMap((entry) => {
		if (isSourceEntry(entry)) return [entry];
		if (!isNotebookMaintenanceEntry(entry) || !entry.data.childSources) return [];
		const { origin, entries: sources } = entry.data.childSources;
		return sources.filter(isSourceEntry).map((source) => ({
			...source,
			id: childSourceId(origin.sessionId, source.id),
			sourceOrigin: { ...origin, entryId: source.id },
		}));
	});
}
