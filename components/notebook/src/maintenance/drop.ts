import type { Observation, Reflection } from "../session-ledger/index.js";
import { coverageTierForObservation, REFLECTION_COVERAGE_DROP_RANK, reflectionCoverageMap } from "./coverage.js";
import { observationPoolMetrics } from "./pool.js";

const RELEVANCE_DROP_RANK: Record<Observation["relevance"], number> = {
	low: 0,
	medium: 1,
	high: 2,
	critical: 3,
};

export type DropGuardrails = {
	metrics: ReturnType<typeof observationPoolMetrics>;
	maintenanceMode: boolean;
	maintenanceEligibleIds: string[];
	maxDropsAllowed: number;
	allowedIds: Set<string>;
	coverageById: ReturnType<typeof reflectionCoverageMap>;
};

export function resolveDropGuardrails(args: {
	observations: readonly Observation[];
	reflections: readonly Reflection[];
	targetTokens: number;
	maintenanceEligibleObservationIds?: readonly string[];
}): DropGuardrails {
	const metrics = observationPoolMetrics(args.observations, args.targetTokens);
	const activeIds = new Set(args.observations.map((observation) => observation.id));
	const maintenanceEligibleIds = [...new Set(args.maintenanceEligibleObservationIds ?? [])].filter((id) =>
		activeIds.has(id),
	);
	const maintenanceMode = !metrics.ready && maintenanceEligibleIds.length > 0;
	const maxDropsAllowed = maintenanceMode ? 1 : metrics.maxDropsAllowed;
	const allowedIds = new Set(
		args.observations
			.filter((observation) => !maintenanceMode || maintenanceEligibleIds.includes(observation.id))
			.map((observation) => observation.id),
	);
	return {
		metrics,
		maintenanceMode,
		maintenanceEligibleIds,
		maxDropsAllowed,
		allowedIds,
		coverageById: reflectionCoverageMap(args.observations, args.reflections),
	};
}

function timestampRank(timestamp: string): number {
	const parsed = Date.parse(timestamp);
	return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function selectDropCandidates(
	ids: readonly string[],
	observations: readonly Observation[],
	maxDrops: number,
	reflections: readonly Reflection[] = [],
): string[] {
	if (maxDrops <= 0 || ids.length === 0) return [];
	const byId = new Map(observations.map((observation) => [observation.id, observation]));
	const coverageById = reflectionCoverageMap(observations, reflections);
	const firstProposalIndex = new Map<string, number>();
	for (let index = 0; index < ids.length; index++) {
		const id = ids[index];
		if (!firstProposalIndex.has(id)) firstProposalIndex.set(id, index);
	}
	return Array.from(firstProposalIndex.entries())
		.map(([id, index]) => ({ id, index, observation: byId.get(id) }))
		.filter(
			(candidate): candidate is { id: string; index: number; observation: Observation } =>
				candidate.observation !== undefined,
		)
		.sort((left, right) => {
			const coverageDelta =
				REFLECTION_COVERAGE_DROP_RANK[coverageTierForObservation(left.observation, coverageById)] -
				REFLECTION_COVERAGE_DROP_RANK[coverageTierForObservation(right.observation, coverageById)];
			const relevanceDelta =
				RELEVANCE_DROP_RANK[left.observation.relevance] - RELEVANCE_DROP_RANK[right.observation.relevance];
			const ageDelta = timestampRank(left.observation.timestamp) - timestampRank(right.observation.timestamp);
			return coverageDelta || relevanceDelta || ageDelta || left.index - right.index;
		})
		.slice(0, maxDrops)
		.map((candidate) => candidate.id);
}
