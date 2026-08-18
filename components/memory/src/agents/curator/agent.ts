import { type AgentContext, type AgentLoopConfig, type AgentTool, agentLoop } from "@earendil-works/pi-agent-core";
import type { Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Static } from "typebox";
import { startSidecarUsageTracker } from "../../../../shared/src/sidecar-usage.js";
import { hashId } from "../../ids.js";
import { AGENT_LOOP_MAX_TOKENS, boundedMaxTokens } from "../../model-budget.js";
import { nowTimestamp, truncateRecordContent } from "../../serialize.js";
import {
	type Observation,
	observationToSummaryLine,
	type Reflection,
	type Relevance,
	reflectionToSummaryLine,
} from "../../session-ledger/index.js";
import { estimateStringTokens, observationLineTokenCount } from "../../tokens.js";
import { drainAgentStream } from "../drain.js";
import { observationToDropperLine, resolveDropGuardrails, selectDropCandidates } from "../dropper/agent.js";
import { coverageTierForObservation } from "../dropper/coverage.js";
import { normalizeSourceEntryIds, OBSERVATION_TIMESTAMP_PATTERN } from "../observer/agent.js";
import { normalizeRetiredReflectionIds, normalizeSupportingObservationIds } from "../reflector/agent.js";
import { logAgentStreamError } from "../stream-errors.js";
import { CURATOR_SYSTEM } from "./prompts.js";

export type CuratorPassResult = {
	observations: Observation[];
	reflections: Reflection[];
	retiredIds: string[];
	droppedIds: string[];
};

interface RunCuratorArgs {
	model: Model<any>;
	apiKey?: string;
	headers?: Record<string, string>;
	reflections: Reflection[];
	observations: Observation[];
	chunk: string;
	allowedSourceEntryIds: string[];
	targetTokens: number;
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
}

const RelevanceSchema = Type.Union([
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("critical"),
]);

const RecordObservationsSchema = Type.Object({
	observations: Type.Array(
		Type.Object({
			timestamp: Type.String({
				pattern: OBSERVATION_TIMESTAMP_PATTERN,
				description: "Observation time in local 'YYYY-MM-DD HH:MM' format.",
			}),
			content: Type.String({
				minLength: 1,
				description: "Single-line plain prose. No markdown, no tags, no embedded timestamp.",
			}),
			relevance: RelevanceSchema,
			sourceEntryIds: Type.Array(Type.String({ minLength: 1 }), {
				minItems: 1,
				description:
					"Exact source entry ids from the chunk that directly support this observation. " +
					"Use only ids shown in '[Source entry id: ...]' labels; never invent ids.",
			}),
		}),
	),
});

const RecordReflectionsSchema = Type.Object({
	reflections: Type.Array(
		Type.Object({
			content: Type.String({ minLength: 1 }),
			supportingObservationIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			supersedes: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
		}),
		{ minItems: 1 },
	),
});

const RetireReflectionsSchema = Type.Object({
	reflectionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

const DropObservationsSchema = Type.Object({
	ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	reason: Type.Optional(Type.String()),
});

type RecordObservationsArgs = Static<typeof RecordObservationsSchema>;
type RecordReflectionsArgs = Static<typeof RecordReflectionsSchema>;
type RetireReflectionsArgs = Static<typeof RetireReflectionsSchema>;
type DropObservationsArgs = Static<typeof DropObservationsSchema>;

export class CuratorStreamError extends Error {
	readonly stopReason: string;
	constructor(stopReason: string, errorMessage?: string) {
		super(`curator stream ended with stopReason "${stopReason}"${errorMessage ? `: ${errorMessage}` : ""}`);
		this.name = "CuratorStreamError";
		this.stopReason = stopReason;
	}
}

function joinOrEmpty(items: string[]): string {
	return items.length ? items.join("\n") : "(none yet)";
}

function normalizeReflectionContent(content: string): string | undefined {
	const normalized = truncateRecordContent(content.trim());
	if (!normalized || /\r|\n/.test(normalized)) return undefined;
	return normalized;
}

export async function runCurator(args: RunCuratorArgs): Promise<CuratorPassResult | undefined> {
	const { model, apiKey, headers, reflections, observations, chunk, allowedSourceEntryIds, targetTokens, signal } =
		args;
	const conversation = chunk.trim();
	if (!conversation) return undefined;

	const recordedObservations = new Map<string, Observation>();
	const recordedReflections = new Map<string, Reflection>();
	const existingReflectionIds = new Set(reflections.map((reflection) => reflection.id));
	const currentLawIds = new Set(existingReflectionIds);
	const retired = new Set<string>();
	const retiredIds: string[] = [];
	const proposedDropIds: string[] = [];
	const proposedDrops = new Set<string>();

	const liveObservations = (): Observation[] => [...observations, ...recordedObservations.values()];
	const liveReflections = (): Reflection[] => [
		...reflections.filter((reflection) => !retired.has(reflection.id)),
		...recordedReflections.values(),
	];
	const liveObservationIds = (): string[] => liveObservations().map((observation) => observation.id);
	const liveGuardrails = () =>
		resolveDropGuardrails({
			observations: liveObservations(),
			reflections: liveReflections(),
			targetTokens,
			maintenanceEligibleObservationIds: Array.from(recordedReflections.values()).flatMap(
				(reflection) => reflection.supportingObservationIds,
			),
		});

	const recordObservations: AgentTool<typeof RecordObservationsSchema> = {
		name: "record_observations",
		label: "Record observations",
		description:
			"Record a batch of new observations distilled from the conversation chunk. " +
			"Call this multiple times as you work through the chunk. When the chunk is covered, " +
			"stop calling this tool and continue to law maintenance.",
		parameters: RecordObservationsSchema,
		execute: async (_id, params: RecordObservationsArgs) => {
			let added = 0;
			let duplicates = 0;
			let rejected = 0;
			for (const obs of params.observations) {
				const sourceEntryIds = normalizeSourceEntryIds(obs.sourceEntryIds, allowedSourceEntryIds);
				if (!sourceEntryIds) {
					rejected++;
					continue;
				}
				const content = truncateRecordContent(obs.content);
				const id = hashId(content);
				if (recordedObservations.has(id)) {
					duplicates++;
					continue;
				}
				recordedObservations.set(id, {
					id,
					content,
					timestamp: obs.timestamp,
					relevance: obs.relevance as Relevance,
					sourceEntryIds,
					tokenCount: observationLineTokenCount({
						id,
						timestamp: obs.timestamp,
						relevance: obs.relevance,
						content,
					}),
				});
				added++;
			}
			const rejectedPart =
				rejected > 0
					? ` ${rejected} observation${rejected === 1 ? "" : "s"} rejected for missing or invalid sourceEntryIds.`
					: "";
			return {
				content: [
					{
						type: "text",
						text:
							`Recorded ${added} new observation${added === 1 ? "" : "s"} ` +
							(duplicates > 0 ? `(${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped).` : ".") +
							rejectedPart +
							` Total so far this run: ${recordedObservations.size}. ` +
							`If the chunk is covered, continue to record_reflections / retire_reflections; do not end the pass.`,
					},
				],
				details: { added, duplicates, rejected, total: recordedObservations.size },
			};
		},
	};

	const recordReflections: AgentTool<typeof RecordReflectionsSchema> = {
		name: "record_reflections",
		label: "Record reflections",
		description:
			"Record new durable current-law reflections with supporting observation ids. " +
			"Supporting ids may include observations recorded earlier in this pass.",
		parameters: RecordReflectionsSchema,
		execute: async (_id, params: RecordReflectionsArgs) => {
			const allowed = liveObservationIds();
			let added = 0;
			let duplicates = 0;
			let rejected = 0;
			let retiredNow = 0;
			for (const proposal of params.reflections) {
				const content = normalizeReflectionContent(proposal.content);
				const supportingObservationIds = normalizeSupportingObservationIds(proposal.supportingObservationIds, allowed);
				const supersedesInvalid = proposal.supersedes?.some((id) => !currentLawIds.has(id));
				const supersedes = proposal.supersedes
					? (normalizeRetiredReflectionIds(proposal.supersedes, currentLawIds, retired) ?? [])
					: [];
				if (!content || !supportingObservationIds || supersedesInvalid) {
					rejected++;
					continue;
				}
				const id = hashId(content);
				if (existingReflectionIds.has(id) || recordedReflections.has(id)) {
					duplicates++;
					continue;
				}
				recordedReflections.set(id, {
					id,
					content,
					supportingObservationIds,
					tokenCount: estimateStringTokens(content),
				});
				added++;
				for (const retiredId of supersedes) {
					retired.add(retiredId);
					retiredIds.push(retiredId);
					retiredNow++;
				}
			}
			return {
				content: [
					{
						type: "text",
						text: `Recorded ${added} reflection${added === 1 ? "" : "s"}; ${duplicates} duplicate${duplicates === 1 ? "" : "s"}; ${rejected} rejected; retired ${retiredNow}. Total this run: ${recordedReflections.size} new, ${retired.size} retired. Continue to drop_observations after law is current.`,
					},
				],
				details: { added, duplicates, rejected, retired: retiredNow, total: recordedReflections.size },
			};
		},
	};

	const retireReflections: AgentTool<typeof RetireReflectionsSchema> = {
		name: "retire_reflections",
		label: "Retire reflections",
		description: "Retire current-law reflection ids that are no longer current. Does not erase ledger history.",
		parameters: RetireReflectionsSchema,
		execute: async (_id, params: RetireReflectionsArgs) => {
			const normalized = normalizeRetiredReflectionIds(params.reflectionIds, currentLawIds, retired);
			if (!normalized) {
				return {
					content: [
						{
							type: "text",
							text: "Rejected retirement batch. Every id must be current law and the batch must not be empty.",
						},
					],
					details: { added: 0, rejected: params.reflectionIds.length, total: retired.size },
				};
			}
			for (const retiredId of normalized) {
				retired.add(retiredId);
				retiredIds.push(retiredId);
			}
			return {
				content: [
					{
						type: "text",
						text: `Retired ${normalized.length} reflection${normalized.length === 1 ? "" : "s"}. Total retired this run: ${retired.size}. Continue to drop_observations after law is current.`,
					},
				],
				details: { added: normalized.length, rejected: 0, total: retired.size },
			};
		},
	};

	const dropObservations: AgentTool<typeof DropObservationsSchema> = {
		name: "drop_observations",
		label: "Drop observations",
		description: "Propose active observation ids that are safe to remove from compacted memory.",
		parameters: DropObservationsSchema,
		execute: async (_id, params: DropObservationsArgs) => {
			const guardrails = liveGuardrails();
			let added = 0;
			let rejected = 0;
			for (const id of params.ids) {
				if (guardrails.maxDropsAllowed <= 0 || !guardrails.allowedIds.has(id) || proposedDrops.has(id)) {
					rejected++;
					continue;
				}
				proposedDrops.add(id);
				proposedDropIds.push(id);
				added++;
			}
			return {
				content: [
					{
						type: "text",
						text: `Queued ${added} drop candidate${added === 1 ? "" : "s"} (${rejected} rejected). Candidates this run: ${proposedDropIds.length}. Live maximum drops allowed: ${guardrails.maxDropsAllowed}${guardrails.maintenanceMode ? " (maintenance)" : ""}.`,
					},
				],
				details: {
					added,
					rejected,
					totalCandidates: proposedDropIds.length,
					maxDropsAllowed: guardrails.maxDropsAllowed,
					maintenanceMode: guardrails.maintenanceMode,
				},
			};
		},
	};

	const startCoverage = resolveDropGuardrails({
		observations,
		reflections,
		targetTokens,
	});
	const now = nowTimestamp();
	const userText = `Current local time: ${now}

CURRENT LAW:
${joinOrEmpty(reflections.map(reflectionToSummaryLine))}

CURRENT WORKING EVIDENCE:
${joinOrEmpty(observations.map((observation) => observationToDropperLine(observation, coverageTierForObservation(observation, startCoverage.coverageById))))}

Active observation pool at start of pass: ~${startCoverage.metrics.observationTokens.toLocaleString()} tokens; target: ~${targetTokens.toLocaleString()} tokens. drop_observations reports the live drop cap after this pass's new observations and reflections. Prior observations (no coverage tag):
${joinOrEmpty(observations.map(observationToSummaryLine))}

Do jobs in order: observe the chunk, then maintain law, then consider drops. An empty observe job still continues. A confirmation does not end the pass.

NEW CONVERSATION CHUNK:
${conversation}`;

	const prompts: Message[] = [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }];
	const context: AgentContext = {
		systemPrompt: CURATOR_SYSTEM,
		messages: [],
		tools: [
			recordObservations as AgentTool<any>,
			recordReflections as AgentTool<any>,
			retireReflections as AgentTool<any>,
			dropObservations as AgentTool<any>,
		],
	};
	const reasoning = (model as { reasoning?: unknown }).reasoning;
	const thinkingLevel = args.thinkingLevel ?? "low";
	const effectiveMaxTurns = args.maxTurns && args.maxTurns > 0 ? args.maxTurns : undefined;
	let turnCount = 0;
	const config: AgentLoopConfig = {
		model,
		apiKey,
		headers,
		maxTokens: boundedMaxTokens(model, AGENT_LOOP_MAX_TOKENS),
		convertToLlm: (msgs) => msgs as Message[],
		toolExecution: "sequential",
		...(reasoning && thinkingLevel !== "off" ? { reasoning: thinkingLevel } : {}),
		...(effectiveMaxTurns !== undefined
			? {
					shouldStopAfterTurn: () => {
						turnCount++;
						return turnCount >= effectiveMaxTurns;
					},
				}
			: {}),
	};

	const loop = args.agentLoop ?? agentLoop;
	const stream = loop(prompts, context, config, signal, streamSimple);
	let streamError: { stopReason: string; errorMessage?: string } | undefined;
	const usage = startSidecarUsageTracker({
		agent: "curator",
		trigger: "observeAfterTokens",
		provider: (model as { provider?: string }).provider,
		model: (model as { id?: string }).id,
	});
	try {
		await drainAgentStream(
			stream,
			(event) => {
				logAgentStreamError("curator", event);
				usage.observeEvent(event);
				const message = (event as { message?: { role?: string; stopReason?: string; errorMessage?: string } }).message;
				if (message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
					streamError = { stopReason: message.stopReason, errorMessage: message.errorMessage };
				}
			},
			signal,
		);
		usage.finish(streamError?.stopReason ?? "ok");
	} catch (error) {
		usage.finish(signal?.aborted ? "aborted" : "error");
		throw error;
	}

	const acceptedObservations = Array.from(recordedObservations.values());
	const acceptedReflections = Array.from(recordedReflections.values());
	const finalGuardrails = liveGuardrails();
	const eligibleProposed = proposedDropIds.filter((id) => finalGuardrails.allowedIds.has(id));
	const droppedIds = selectDropCandidates(
		eligibleProposed,
		liveObservations(),
		finalGuardrails.maxDropsAllowed,
		liveReflections(),
	);
	const empty =
		acceptedObservations.length === 0 &&
		acceptedReflections.length === 0 &&
		retiredIds.length === 0 &&
		droppedIds.length === 0;
	if (empty) {
		if (streamError) throw new CuratorStreamError(streamError.stopReason, streamError.errorMessage);
		return undefined;
	}
	return {
		observations: acceptedObservations,
		reflections: acceptedReflections,
		retiredIds,
		droppedIds,
	};
}
