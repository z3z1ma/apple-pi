export const NOTEBOOK_OBSERVATIONS_RECORDED = "notebook.observations.recorded";
export const NOTEBOOK_REFLECTIONS_RECORDED = "notebook.reflections.recorded";
export const NOTEBOOK_OBSERVATIONS_DROPPED = "notebook.observations.dropped";
export const NOTEBOOK_REFLECTIONS_RETIRED = "notebook.reflections.retired";
export const NOTEBOOK_FOLDED = "notebook.folded";
/** One atomic record for a completed pair programmer maintenance review. */
export const NOTEBOOK_MAINTENANCE = "notebook.maintenance";

export const RELEVANCE_VALUES = ["low", "medium", "high", "critical"] as const;
export type Relevance = (typeof RELEVANCE_VALUES)[number];

export const NOTEBOOK_ID_PATTERN = /^[a-f0-9]{12}$/;

export type Entry = {
	type: string;
	id: string;
	timestamp?: string;
	message?: unknown;
	content?: unknown;
	customType?: string;
	summary?: unknown;
	fromId?: string;
	data?: unknown;
	details?: unknown;
	firstKeptEntryId?: string;
};

export type Observation = {
	id: string;
	content: string;
	timestamp: string;
	relevance: Relevance;
	sourceEntryIds: string[];
	tokenCount: number;
};

export type Reflection = {
	id: string;
	content: string;
	supportingObservationIds: string[];
	tokenCount: number;
};

export type ObservationsRecordedEntryData = {
	observations: Observation[];
	coversUpToId: string;
};

export type ReflectionsRecordedEntryData = {
	reflections: Reflection[];
	coversUpToId: string;
};

export type ObservationsDroppedEntryData = {
	observationIds: string[];
	coversUpToId: string;
};

export type ReflectionsRetiredEntryData = {
	reflectionIds: string[];
	coversUpToId: string;
	successorIds?: string[];
};

export type NotebookMaintenanceEntryData = {
	coversUpToId: string;
	observations: Observation[];
	reflections: Reflection[];
	retiredReflectionIds: string[];
	droppedObservationIds: string[];
};

export type NotebookDetails = {
	type: typeof NOTEBOOK_FOLDED;
	version: 1;
	fullFold: boolean;
	observations: Observation[];
	reflections: Reflection[];
};

export type NotebookCustomType =
	| typeof NOTEBOOK_OBSERVATIONS_RECORDED
	| typeof NOTEBOOK_REFLECTIONS_RECORDED
	| typeof NOTEBOOK_OBSERVATIONS_DROPPED
	| typeof NOTEBOOK_REFLECTIONS_RETIRED
	| typeof NOTEBOOK_MAINTENANCE;

export function isRelevance(value: unknown): value is Relevance {
	return typeof value === "string" && (RELEVANCE_VALUES as readonly string[]).includes(value);
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isNotebookId(value: unknown): value is string {
	return typeof value === "string" && NOTEBOOK_ID_PATTERN.test(value);
}

function isTokenCount(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

export function isObservation(value: unknown): value is Observation {
	if (!isPlainRecord(value)) return false;
	return (
		isNotebookId(value.id) &&
		isNonEmptyString(value.content) &&
		isNonEmptyString(value.timestamp) &&
		isRelevance(value.relevance) &&
		isNonEmptyStringArray(value.sourceEntryIds) &&
		isTokenCount(value.tokenCount)
	);
}

export function isReflection(value: unknown): value is Reflection {
	if (!isPlainRecord(value)) return false;
	return (
		isNotebookId(value.id) &&
		isNonEmptyString(value.content) &&
		!/\r|\n/.test(value.content) &&
		isNonEmptyStringArray(value.supportingObservationIds) &&
		isTokenCount(value.tokenCount)
	);
}

export function isObservationsRecordedData(value: unknown): value is ObservationsRecordedEntryData {
	if (!isPlainRecord(value)) return false;
	return (
		Array.isArray(value.observations) &&
		value.observations.length > 0 &&
		value.observations.every(isObservation) &&
		isNonEmptyString(value.coversUpToId)
	);
}

export function isReflectionsRecordedData(value: unknown): value is ReflectionsRecordedEntryData {
	if (!isPlainRecord(value)) return false;
	return (
		Array.isArray(value.reflections) &&
		value.reflections.length > 0 &&
		value.reflections.every(isReflection) &&
		isNonEmptyString(value.coversUpToId)
	);
}

export function isObservationsDroppedData(value: unknown): value is ObservationsDroppedEntryData {
	if (!isPlainRecord(value)) return false;
	return isNonEmptyStringArray(value.observationIds) && isNonEmptyString(value.coversUpToId);
}

export function isReflectionsRetiredData(value: unknown): value is ReflectionsRetiredEntryData {
	if (!isPlainRecord(value)) return false;
	if (!isNonEmptyStringArray(value.reflectionIds) || !isNonEmptyString(value.coversUpToId)) return false;
	if (value.successorIds === undefined) return true;
	return isNonEmptyStringArray(value.successorIds);
}

export function isNotebookMaintenanceData(value: unknown): value is NotebookMaintenanceEntryData {
	if (!isPlainRecord(value)) return false;
	return (
		isNonEmptyString(value.coversUpToId) &&
		Array.isArray(value.observations) &&
		value.observations.every(isObservation) &&
		Array.isArray(value.reflections) &&
		value.reflections.every(isReflection) &&
		Array.isArray(value.retiredReflectionIds) &&
		value.retiredReflectionIds.every(isNonEmptyString) &&
		Array.isArray(value.droppedObservationIds) &&
		value.droppedObservationIds.every(isNonEmptyString)
	);
}

export function isNotebookDetails(value: unknown): value is NotebookDetails {
	if (!isPlainRecord(value)) return false;
	return (
		value.type === NOTEBOOK_FOLDED &&
		value.version === 1 &&
		typeof value.fullFold === "boolean" &&
		Array.isArray(value.observations) &&
		value.observations.every(isObservation) &&
		Array.isArray(value.reflections) &&
		value.reflections.every(isReflection)
	);
}

export function isNotebookMaintenanceEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof NOTEBOOK_MAINTENANCE;
	data: NotebookMaintenanceEntryData;
} {
	return entry.type === "custom" && entry.customType === NOTEBOOK_MAINTENANCE && isNotebookMaintenanceData(entry.data);
}

export function isObservationsRecordedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof NOTEBOOK_OBSERVATIONS_RECORDED;
	data: ObservationsRecordedEntryData;
} {
	return (
		entry.type === "custom" &&
		entry.customType === NOTEBOOK_OBSERVATIONS_RECORDED &&
		isObservationsRecordedData(entry.data)
	);
}

export function isReflectionsRecordedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof NOTEBOOK_REFLECTIONS_RECORDED;
	data: ReflectionsRecordedEntryData;
} {
	return (
		entry.type === "custom" &&
		entry.customType === NOTEBOOK_REFLECTIONS_RECORDED &&
		isReflectionsRecordedData(entry.data)
	);
}

export function isObservationsDroppedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof NOTEBOOK_OBSERVATIONS_DROPPED;
	data: ObservationsDroppedEntryData;
} {
	return (
		entry.type === "custom" &&
		entry.customType === NOTEBOOK_OBSERVATIONS_DROPPED &&
		isObservationsDroppedData(entry.data)
	);
}

export function isReflectionsRetiredEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof NOTEBOOK_REFLECTIONS_RETIRED;
	data: ReflectionsRetiredEntryData;
} {
	return (
		entry.type === "custom" && entry.customType === NOTEBOOK_REFLECTIONS_RETIRED && isReflectionsRetiredData(entry.data)
	);
}

export function buildNotebookMaintenanceData(
	data: NotebookMaintenanceEntryData,
): NotebookMaintenanceEntryData | undefined {
	return isNotebookMaintenanceData(data) ? data : undefined;
}

export function buildObservationsRecordedData(
	observations: Observation[],
	coversUpToId: string,
): ObservationsRecordedEntryData | undefined {
	if (observations.length === 0 || !isNonEmptyString(coversUpToId)) return undefined;
	return { observations, coversUpToId };
}

export function buildReflectionsRecordedData(
	reflections: Reflection[],
	coversUpToId: string,
): ReflectionsRecordedEntryData | undefined {
	if (reflections.length === 0 || !isNonEmptyString(coversUpToId)) return undefined;
	return { reflections, coversUpToId };
}

export function buildObservationsDroppedData(
	observationIds: string[],
	coversUpToId: string,
): ObservationsDroppedEntryData | undefined {
	if (observationIds.length === 0 || !isNonEmptyString(coversUpToId)) return undefined;
	return { observationIds, coversUpToId };
}

export function buildReflectionsRetiredData(
	reflectionIds: string[],
	coversUpToId: string,
	successorIds?: string[],
): ReflectionsRetiredEntryData | undefined {
	if (reflectionIds.length === 0 || !isNonEmptyString(coversUpToId)) return undefined;
	if (successorIds && successorIds.length === 0) return undefined;
	return successorIds && successorIds.length > 0
		? { reflectionIds, coversUpToId, successorIds }
		: { reflectionIds, coversUpToId };
}
