import {
	NOTEBOOK_FOLDED,
	isNotebookDetails,
	isObservationsDroppedEntry,
	isObservationsRecordedEntry,
	isReflectionsRecordedEntry,
	isReflectionsRetiredEntry,
	type Entry,
	type NotebookDetails,
	type Observation,
	type Reflection,
} from "./types.js";

export type Projection = {
	observations: Observation[];
	reflections: Reflection[];
};

export type ProjectionDiff = {
	observationsOnlyInFull: Observation[];
	reflectionsOnlyInFull: Reflection[];
	droppedOnlyInFull: Observation[];
};

export type CompactionProjectionConfig = {
	observationsPoolMaxTokens: number;
};

export type CompactionProjection = Projection & {
	fullFold: boolean;
	details: NotebookDetails;
};

type ProjectionBoundary = { kind: "entry"; entryId: string } | { kind: "tip" };

function entryIndexById(entries: Entry[]): Map<string, number> {
	const indexes = new Map<string, number>();
	for (let i = 0; i < entries.length; i++) indexes.set(entries[i].id, i);
	return indexes;
}

function entryBoundary(entryId: string): ProjectionBoundary {
	return { kind: "entry", entryId };
}

function tipBoundary(): ProjectionBoundary {
	return { kind: "tip" };
}

function boundaryIndex(entries: Entry[], indexes: Map<string, number>, boundary: ProjectionBoundary): number {
	if (boundary.kind === "tip") return entries.length - 1;
	return indexes.get(boundary.entryId) ?? -1;
}

function coverageIndex(entry: Entry & { data: { coversUpToId: string } }, indexes: Map<string, number>): number {
	return indexes.get(entry.data.coversUpToId) ?? -1;
}

function isAtOrBefore(index: number, boundaryIndex: number): boolean {
	return index >= 0 && boundaryIndex >= 0 && index <= boundaryIndex;
}

function isCoveredAtOrBefore(
	entry: Entry & { data: { coversUpToId: string } },
	indexes: Map<string, number>,
	boundaryIndex: number,
): boolean {
	return isAtOrBefore(coverageIndex(entry, indexes), boundaryIndex);
}

function foldProjection(entries: Entry[], boundary: ProjectionBoundary): Projection {
	const indexes = entryIndexById(entries);
	const cut = boundaryIndex(entries, indexes, boundary);
	const observations: Observation[] = [];
	const reflections: Reflection[] = [];
	const observationsById = new Set<string>();
	const reflectionsById = new Set<string>();
	const droppedObservationIds = new Set<string>();
	const retiredReflectionIds = new Set<string>();

	for (const entry of entries) {
		if (isObservationsRecordedEntry(entry) && isCoveredAtOrBefore(entry, indexes, cut)) {
			for (const observation of entry.data.observations) {
				if (observationsById.has(observation.id)) continue;
				observationsById.add(observation.id);
				observations.push(observation);
			}
			continue;
		}

		if (isReflectionsRecordedEntry(entry) && isCoveredAtOrBefore(entry, indexes, cut)) {
			for (const reflection of entry.data.reflections) {
				if (reflectionsById.has(reflection.id)) continue;
				reflectionsById.add(reflection.id);
				reflections.push(reflection);
			}
			continue;
		}

		if (isObservationsDroppedEntry(entry) && isCoveredAtOrBefore(entry, indexes, cut)) {
			for (const observationId of entry.data.observationIds) droppedObservationIds.add(observationId);
			continue;
		}

		if (isReflectionsRetiredEntry(entry) && isCoveredAtOrBefore(entry, indexes, cut)) {
			for (const reflectionId of entry.data.reflectionIds) retiredReflectionIds.add(reflectionId);
		}
	}

	return {
		observations: observations.filter((observation) => !droppedObservationIds.has(observation.id)),
		reflections: reflections.filter((reflection) => !retiredReflectionIds.has(reflection.id)),
	};
}

function projectionFromNotebookDetails(details: NotebookDetails): Projection {
	return {
		observations: [...details.observations],
		reflections: [...details.reflections],
	};
}

function latestNotebookCompactionDetails(entries: Entry[]): NotebookDetails | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "compaction") continue;
		if (isNotebookDetails(entry.details)) return entry.details;
	}
	return undefined;
}

export function fullProjection(entries: Entry[], upToEntryId?: string): Projection {
	return foldProjection(entries, upToEntryId ? entryBoundary(upToEntryId) : tipBoundary());
}

export function visibleProjection(entries: Entry[], upToEntryId?: string): Projection {
	if (!upToEntryId) {
		const details = latestNotebookCompactionDetails(entries);
		return details ? projectionFromNotebookDetails(details) : { observations: [], reflections: [] };
	}

	return fullProjection(entries, upToEntryId);
}

export function latestFullFoldBoundaryId(entries: Entry[]): string | undefined {
	const indexes = entryIndexById(entries);
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "compaction") continue;
		if (!isNotebookDetails(entry.details)) continue;
		if (!entry.details.fullFold) continue;
		if (!entry.firstKeptEntryId) continue;
		if (!indexes.has(entry.firstKeptEntryId)) continue;
		return entry.firstKeptEntryId;
	}
	return undefined;
}

export function buildCompactionProjection(
	entries: Entry[],
	firstKeptEntryId: string,
	config: CompactionProjectionConfig,
): CompactionProjection {
	const projection = fullProjection(entries, firstKeptEntryId);
	const observationTokens = projection.observations.reduce((total, observation) => total + observation.tokenCount, 0);
	const fullFold = observationTokens >= config.observationsPoolMaxTokens;

	const details: NotebookDetails = {
		type: NOTEBOOK_FOLDED,
		version: 1,
		fullFold,
		observations: projection.observations,
		reflections: projection.reflections,
	};

	return {
		fullFold,
		observations: projection.observations,
		reflections: projection.reflections,
		details,
	};
}

export function diffProjection(visible: Projection, full: Projection): ProjectionDiff {
	const visibleObservationIds = new Set(visible.observations.map((observation) => observation.id));
	const fullObservationIds = new Set(full.observations.map((observation) => observation.id));
	const visibleReflectionIds = new Set(visible.reflections.map((reflection) => reflection.id));

	return {
		observationsOnlyInFull: full.observations.filter((observation) => !visibleObservationIds.has(observation.id)),
		reflectionsOnlyInFull: full.reflections.filter((reflection) => !visibleReflectionIds.has(reflection.id)),
		droppedOnlyInFull: visible.observations.filter((observation) => !fullObservationIds.has(observation.id)),
	};
}
