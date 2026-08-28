import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";

import { hashId } from "./ids.js";
import { resolveNotebookSourceMaxTokens, type Config } from "./config.js";
import { nowTimestamp, serializeSourceAddressedBranchEntries, truncateRecordContent } from "./serialize.js";
import {
	buildObservationsDroppedData,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRetiredData,
	foldLedger,
	isSourceEntry,
	latestCoverageIndex,
	latestCoverageMarkerId,
	NOTEBOOK_OBSERVATIONS_DROPPED,
	NOTEBOOK_OBSERVATIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RETIRED,
	observationToSummaryLine,
	reflectionToSummaryLine,
	type Entry,
	type Observation,
	type Reflection,
	type Relevance,
} from "./session-ledger/index.js";
import { estimateStringTokens, observationLineTokenCount } from "./tokens.js";
import { resolveDropGuardrails, selectDropCandidates } from "./maintenance/drop.js";
import {
	normalizeRetiredReflectionIds,
	normalizeSourceEntryIds,
	normalizeSupportingObservationIds,
	OBSERVATION_TIMESTAMP_PATTERN,
} from "./maintenance/validation.js";
import type { Runtime } from "./runtime.js";

const RelevanceSchema = Type.Union([
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("critical"),
]);

const UpdateNotebookSchema = Type.Object({
	observations: Type.Array(
		Type.Object({
			timestamp: Type.String({ pattern: OBSERVATION_TIMESTAMP_PATTERN }),
			content: Type.String({ minLength: 1 }),
			relevance: RelevanceSchema,
			sourceEntryIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
		}),
	),
	reflections: Type.Array(
		Type.Object({
			content: Type.String({ minLength: 1 }),
			supportingObservationIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			supersedes: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
		}),
	),
	retireReflectionIds: Type.Array(Type.String({ minLength: 1 })),
	dropObservationIds: Type.Array(Type.String({ minLength: 1 })),
});

type UpdateNotebookArgs = Static<typeof UpdateNotebookSchema>;

export type PairNotebookBatch = {
	id: string;
	coversUpToId: string;
	allowedSourceEntryIds: string[];
	observations: Observation[];
	reflections: Reflection[];
	targetTokens: number;
	fullMaintenanceDue: boolean;
	sourceTokens: number;
	priorCoverageId?: string;
	sessionIdentity?: string;
	prompt: string;
	unresolvedSource: string;
};

export type PairNotebookUpdate = {
	batchId: string;
	coversUpToId: string;
	observations: Observation[];
	reflections: Reflection[];
	retiredIds: string[];
	droppedIds: string[];
	fullMaintenanceDue: boolean;
	sourceTokens: number;
	priorCoverageId?: string;
	sessionIdentity?: string;
};

function normalizeReflectionContent(content: string): string | undefined {
	const normalized = truncateRecordContent(content.trim());
	if (!normalized || /\r|\n/.test(normalized)) return undefined;
	return normalized;
}

function joinOrEmpty(items: string[]): string {
	return items.length > 0 ? items.join("\n") : "(none yet)";
}

function sourceEntriesAfter(entries: Entry[], index: number): Entry[] {
	return entries.slice(index + 1).filter(isSourceEntry);
}

export function preparePairNotebookBatch(args: {
	entries: Entry[];
	config: Config;
	contextWindow?: number;
	fullMaintenanceDue: boolean;
	sourceTokens: number;
	sessionIdentity?: string;
}): PairNotebookBatch | undefined {
	const lastCoverage = latestCoverageIndex(args.entries, NOTEBOOK_OBSERVATIONS_RECORDED);
	const backlog = sourceEntriesAfter(args.entries, lastCoverage);
	const maxTokens = resolveNotebookSourceMaxTokens(args.config, args.contextWindow);
	const serialized = serializeSourceAddressedBranchEntries(backlog, { maxTokens });
	const coversUpToId = serialized.sourceEntryIds.at(-1);
	if (!coversUpToId || serialized.sourceEntryIds.length === 0) return undefined;

	const folded = foldLedger(args.entries);
	const prompt = args.fullMaintenanceDue
		? [
				"### Time to update the shared notebook",
				"Review this sourced span and call `update_notebook` exactly once. Preserve every durable new fact your partner may need later, revise the current shared understanding, retire reflections that no longer apply, and propose only safe drops. This is quiet note-taking, not something to announce with `share_note`. Arrays may be empty.",
				`Current local time: ${nowTimestamp()}`,
				`Allowed source entry ids, oldest to newest: ${serialized.sourceEntryIds.join(", ")}`,
				`Coverage endpoint: ${coversUpToId}`,
				`Current law:\n${joinOrEmpty(folded.currentReflections.map(reflectionToSummaryLine))}`,
				`Current working evidence:\n${joinOrEmpty(folded.activeObservations.map(observationToSummaryLine))}`,
			].join("\n\n")
		: "";

	return {
		id: `${coversUpToId}:${serialized.sourceEntryIds.length}`,
		coversUpToId,
		allowedSourceEntryIds: serialized.sourceEntryIds,
		observations: folded.activeObservations,
		reflections: folded.currentReflections,
		targetTokens: args.config.observationsPoolTargetTokens,
		fullMaintenanceDue: args.fullMaintenanceDue,
		sourceTokens: args.sourceTokens,
		priorCoverageId: latestCoverageMarkerId(args.entries, NOTEBOOK_OBSERVATIONS_RECORDED),
		...(args.sessionIdentity ? { sessionIdentity: args.sessionIdentity } : {}),
		prompt,
		unresolvedSource: serialized.text,
	};
}

/** Private pairing capability. Calls stage data only; the root host commits it after a successful Pair turn. */
export class UpdateNotebookTool {
	readonly name = "update_notebook";
	readonly label = "Update Pair notebook";
	readonly description =
		"Update the sourced notebook you keep for this pair programming session. Add durable observations, revise the current shared understanding, retire reflections that no longer apply, and drop only safely covered detail. This never edits repository files or arbitrary session state. When a full notebook update is requested, call exactly once even if every array is empty.";
	readonly parameters = UpdateNotebookSchema as any;

	#batch: PairNotebookBatch | undefined;
	#staged: PairNotebookUpdate | undefined;
	#called = false;

	begin(batch: PairNotebookBatch | undefined): void {
		this.#batch = batch;
		this.#staged = undefined;
		this.#called = false;
	}

	clear(): void {
		this.#batch = undefined;
		this.#staged = undefined;
		this.#called = false;
	}

	takeStaged(): PairNotebookUpdate | undefined {
		const staged = this.#staged;
		this.clear();
		return staged;
	}

	async execute(_id: string, params: UpdateNotebookArgs): Promise<AgentToolResult<unknown>> {
		const batch = this.#batch;
		if (!batch) {
			return {
				content: [{ type: "text", text: "No primary-session notebook span is active." }],
				details: { accepted: false },
			};
		}
		if (this.#called) {
			return {
				content: [{ type: "text", text: "Notebook was already staged for this review." }],
				details: { accepted: false },
			};
		}
		this.#called = true;

		const existingObservationIds = new Set(batch.observations.map((observation) => observation.id));
		const observations = new Map<string, Observation>();
		let rejected = 0;
		for (const proposal of params.observations) {
			const sourceEntryIds = normalizeSourceEntryIds(proposal.sourceEntryIds, batch.allowedSourceEntryIds);
			const content = truncateRecordContent(proposal.content.trim());
			if (!sourceEntryIds || !content || /\r|\n/.test(content)) {
				rejected++;
				continue;
			}
			const id = hashId(content);
			if (existingObservationIds.has(id) || observations.has(id)) continue;
			observations.set(id, {
				id,
				content,
				timestamp: proposal.timestamp,
				relevance: proposal.relevance as Relevance,
				sourceEntryIds,
				tokenCount: observationLineTokenCount({
					id,
					timestamp: proposal.timestamp,
					relevance: proposal.relevance,
					content,
				}),
			});
		}

		const liveObservations = [...batch.observations, ...observations.values()];
		const allowedObservationIds = liveObservations.map((observation) => observation.id);
		const existingReflectionIds = new Set(batch.reflections.map((reflection) => reflection.id));
		const currentReflectionIds = new Set(existingReflectionIds);
		const retired = new Set<string>();
		const retiredIds: string[] = [];
		const reflections = new Map<string, Reflection>();
		for (const proposal of params.reflections) {
			const content = normalizeReflectionContent(proposal.content);
			const support = normalizeSupportingObservationIds(proposal.supportingObservationIds, allowedObservationIds);
			const supersedesInvalid = proposal.supersedes?.some((id) => !currentReflectionIds.has(id));
			const supersedes = proposal.supersedes
				? (normalizeRetiredReflectionIds(proposal.supersedes, currentReflectionIds, retired) ?? [])
				: [];
			if (!content || !support || supersedesInvalid) {
				rejected++;
				continue;
			}
			const id = hashId(content);
			if (existingReflectionIds.has(id) || reflections.has(id)) continue;
			reflections.set(id, {
				id,
				content,
				supportingObservationIds: support,
				tokenCount: estimateStringTokens(content),
			});
			for (const reflectionId of supersedes) {
				retired.add(reflectionId);
				retiredIds.push(reflectionId);
			}
		}

		const explicitRetirements = normalizeRetiredReflectionIds(
			params.retireReflectionIds,
			currentReflectionIds,
			retired,
		);
		for (const reflectionId of explicitRetirements ?? []) {
			retired.add(reflectionId);
			retiredIds.push(reflectionId);
		}

		const liveReflections = [
			...batch.reflections.filter((reflection) => !retired.has(reflection.id)),
			...reflections.values(),
		];
		const guardrails = resolveDropGuardrails({
			observations: liveObservations,
			reflections: liveReflections,
			targetTokens: batch.targetTokens,
			maintenanceEligibleObservationIds: Array.from(reflections.values()).flatMap(
				(reflection) => reflection.supportingObservationIds,
			),
		});
		const eligibleDrops = params.dropObservationIds.filter((id) => guardrails.allowedIds.has(id));
		const droppedIds = selectDropCandidates(
			eligibleDrops,
			liveObservations,
			guardrails.maxDropsAllowed,
			liveReflections,
		);

		this.#staged = {
			batchId: batch.id,
			coversUpToId: batch.coversUpToId,
			observations: [...observations.values()],
			reflections: [...reflections.values()],
			retiredIds,
			droppedIds,
			fullMaintenanceDue: batch.fullMaintenanceDue,
			sourceTokens: batch.sourceTokens,
			...(batch.priorCoverageId ? { priorCoverageId: batch.priorCoverageId } : {}),
			...(batch.sessionIdentity ? { sessionIdentity: batch.sessionIdentity } : {}),
		};
		return {
			content: [
				{
					type: "text",
					text: `Notebook update ready: ${observations.size} observation${observations.size === 1 ? "" : "s"}, ${reflections.size} reflection${reflections.size === 1 ? "" : "s"}, ${retiredIds.length} retirement${retiredIds.length === 1 ? "" : "s"}, and ${droppedIds.length} drop${droppedIds.length === 1 ? "" : "s"}${rejected > 0 ? `; rejected ${rejected} invalid proposal${rejected === 1 ? "" : "s"}` : ""}. It will be saved when this turn finishes successfully.`,
				},
			],
			details: {
				accepted: true,
				observations: observations.size,
				reflections: reflections.size,
				retired: retiredIds.length,
				dropped: droppedIds.length,
				rejected,
			},
		};
	}
}

export function commitPairNotebookUpdate(
	pi: ExtensionAPI,
	runtime: Runtime,
	entries: Entry[],
	update: PairNotebookUpdate,
): boolean {
	if (runtime.disposed || !entries.some((entry) => entry.id === update.coversUpToId)) return false;
	const existing = foldLedger(entries);
	const coverageId =
		update.observations.length > 0
			? update.coversUpToId
			: latestCoverageMarkerId(entries, NOTEBOOK_OBSERVATIONS_RECORDED);

	if (update.observations.length > 0) {
		const data = buildObservationsRecordedData(update.observations, update.coversUpToId);
		if (data) pi.appendEntry(NOTEBOOK_OBSERVATIONS_RECORDED, data);
	}
	if (!coverageId) return update.observations.length === 0;

	const reflectionData = buildReflectionsRecordedData(update.reflections, coverageId);
	if (reflectionData) pi.appendEntry(NOTEBOOK_REFLECTIONS_RECORDED, reflectionData);

	const currentIds = new Set(existing.currentReflections.map((reflection) => reflection.id));
	const retiredIds = update.retiredIds.filter((id) => currentIds.has(id));
	const retirementData = buildReflectionsRetiredData(
		retiredIds,
		coverageId,
		update.reflections.length > 0 ? update.reflections.map((reflection) => reflection.id) : undefined,
	);
	if (retirementData) pi.appendEntry(NOTEBOOK_REFLECTIONS_RETIRED, retirementData);

	const dropData = buildObservationsDroppedData(update.droppedIds, coverageId);
	if (dropData) pi.appendEntry(NOTEBOOK_OBSERVATIONS_DROPPED, dropData);
	return true;
}
