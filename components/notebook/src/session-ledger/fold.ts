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
	/** Fold entries from branch root through this entry id, inclusive. Omit to fold through branch tip. */
	upToEntryId?: string;
};

export type FoldedLedger = {
	/** All first-valid observation records encountered through the fold boundary, including dropped observations. */
	observations: Observation[];
	/** Observation records not tombstoned by a folded drop entry. */
	activeObservations: Observation[];
	/** Tombstoned observation ids, including ids that may not have a corresponding folded observation. */
	droppedObservationIds: Set<string>;
	/** All first-valid reflection records encountered through the fold boundary, including retired reflections. */
	reflections: Reflection[];
	/** Reflection records not tombstoned by a folded retirement entry. */
	currentReflections: Reflection[];
	/** Tombstoned reflection ids, including ids that may not have a corresponding folded reflection. */
	retiredReflectionIds: Set<string>;
	/** All first-valid observation records by id, including dropped observations. */
	observationsById: Map<string, Observation>;
	/** All first-valid reflection records by id. */
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

/**
 * Fold valid notebook ledger entries from the branch root through the target entry.
 *
 * Unknown custom entries, malformed notebook data, and compaction details are ignored.
 * Observations and reflections use first-valid-record-wins semantics. Drops and retirements are
 * tombstones and are retained even when the id is unknown at the time of folding.
 */
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
