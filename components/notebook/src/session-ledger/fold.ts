import {
	type Entry,
	isNotebookMaintenanceEntry,
	isObservationsDroppedData,
	isObservationsRecordedData,
	isReflectionsRecordedData,
	isReflectionsRetiredData,
	NOTEBOOK_OBSERVATIONS_DROPPED,
	NOTEBOOK_OBSERVATIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RETIRED,
	type Observation,
	type Reflection,
} from "./types.js";

export type FoldLedgerOptions = {
	upToEntryId?: string;
};

export type FoldedLedger = {
	observations: Observation[];
	activeObservations: Observation[];
	droppedObservationIds: Set<string>;
	reflections: Reflection[];
	currentReflections: Reflection[];
	retiredReflectionIds: Set<string>;
	observationsById: Map<string, Observation>;
	reflectionsById: Map<string, Reflection>;
};

function foldEndIndex(entries: Entry[], upToEntryId: string | undefined): number {
	if (!upToEntryId) return entries.length - 1;
	const idx = entries.findIndex((entry) => entry.id === upToEntryId);
	return idx === -1 ? entries.length - 1 : idx;
}

function isCustomEntry(entry: Entry, customType: string): boolean {
	return entry.type === "custom" && entry.customType === customType;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one ordered reducer owns the notebook ledger's first-record and tombstone semantics.
export function foldLedger(entries: Entry[], options: FoldLedgerOptions = {}): FoldedLedger {
	const observationsById = new Map<string, Observation>();
	const reflectionsById = new Map<string, Reflection>();
	const droppedObservationIds = new Set<string>();
	const retiredReflectionIds = new Set<string>();
	const endIdx = foldEndIndex(entries, options.upToEntryId);

	for (let i = 0; i <= endIdx; i++) {
		const entry = entries[i];
		if (!entry) continue;

		if (isNotebookMaintenanceEntry(entry)) {
			for (const observation of entry.data.observations) {
				if (!observationsById.has(observation.id)) observationsById.set(observation.id, observation);
			}
			for (const reflection of entry.data.reflections) {
				if (!reflectionsById.has(reflection.id)) reflectionsById.set(reflection.id, reflection);
			}
			for (const observationId of entry.data.droppedObservationIds) droppedObservationIds.add(observationId);
			for (const reflectionId of entry.data.retiredReflectionIds) retiredReflectionIds.add(reflectionId);
			continue;
		}

		if (isCustomEntry(entry, NOTEBOOK_OBSERVATIONS_RECORDED)) {
			if (!isObservationsRecordedData(entry.data)) continue;
			for (const observation of entry.data.observations) {
				if (!observationsById.has(observation.id)) {
					observationsById.set(observation.id, observation);
				}
			}
			continue;
		}

		if (isCustomEntry(entry, NOTEBOOK_REFLECTIONS_RECORDED)) {
			if (!isReflectionsRecordedData(entry.data)) continue;
			for (const reflection of entry.data.reflections) {
				if (!reflectionsById.has(reflection.id)) {
					reflectionsById.set(reflection.id, reflection);
				}
			}
			continue;
		}

		if (isCustomEntry(entry, NOTEBOOK_OBSERVATIONS_DROPPED)) {
			if (!isObservationsDroppedData(entry.data)) continue;
			for (const observationId of entry.data.observationIds) {
				droppedObservationIds.add(observationId);
			}
			continue;
		}

		if (isCustomEntry(entry, NOTEBOOK_REFLECTIONS_RETIRED)) {
			if (!isReflectionsRetiredData(entry.data)) continue;
			for (const reflectionId of entry.data.reflectionIds) {
				retiredReflectionIds.add(reflectionId);
			}
		}
	}

	const observations = Array.from(observationsById.values());
	const activeObservations = observations.filter((observation) => !droppedObservationIds.has(observation.id));
	const reflections = Array.from(reflectionsById.values());
	const currentReflections = reflections.filter((reflection) => !retiredReflectionIds.has(reflection.id));

	return {
		observations,
		activeObservations,
		droppedObservationIds,
		reflections,
		currentReflections,
		retiredReflectionIds,
		observationsById,
		reflectionsById,
	};
}
