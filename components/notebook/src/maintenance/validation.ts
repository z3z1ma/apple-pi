export const OBSERVATION_TIMESTAMP_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$";

export function normalizeSourceEntryIds(
	sourceEntryIds: readonly string[] | undefined,
	allowedSourceEntryIds: readonly string[],
): string[] | undefined {
	if (!sourceEntryIds || sourceEntryIds.length === 0) return undefined;
	const allowedOrder = new Map<string, number>();
	for (let index = 0; index < allowedSourceEntryIds.length; index++) {
		allowedOrder.set(allowedSourceEntryIds[index], index);
	}
	const seen = new Set<string>();
	for (const id of sourceEntryIds) {
		if (!allowedOrder.has(id)) return undefined;
		seen.add(id);
	}
	return seen.size > 0
		? Array.from(seen).sort((left, right) => (allowedOrder.get(left) ?? 0) - (allowedOrder.get(right) ?? 0))
		: undefined;
}

export function normalizeRetiredReflectionIds(
	reflectionIds: readonly string[] | undefined,
	currentReflectionIds: ReadonlySet<string>,
	alreadyRetiredIds: ReadonlySet<string> = new Set(),
): string[] | undefined {
	if (!reflectionIds || reflectionIds.length === 0) return undefined;
	const result: string[] = [];
	const seen = new Set<string>();
	for (const id of reflectionIds) {
		if (!currentReflectionIds.has(id)) return undefined;
		if (alreadyRetiredIds.has(id) || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result.length > 0 ? result : undefined;
}

export function normalizeSupportingObservationIds(
	supportingObservationIds: readonly string[] | undefined,
	allowedObservationIds: readonly string[],
): string[] | undefined {
	if (!supportingObservationIds || supportingObservationIds.length === 0) return undefined;
	const allowedOrder = new Map<string, number>();
	for (let index = 0; index < allowedObservationIds.length; index++) {
		if (!allowedOrder.has(allowedObservationIds[index])) allowedOrder.set(allowedObservationIds[index], index);
	}
	const seen = new Set<string>();
	for (const id of supportingObservationIds) {
		if (!allowedOrder.has(id)) return undefined;
		seen.add(id);
	}
	return seen.size > 0
		? Array.from(seen).sort((left, right) => (allowedOrder.get(left) ?? 0) - (allowedOrder.get(right) ?? 0))
		: undefined;
}
