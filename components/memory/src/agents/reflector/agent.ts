import { type AgentContext, type AgentLoopConfig, type AgentTool, agentLoop } from "@earendil-works/pi-agent-core";
import type { Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Static } from "typebox";
import { debugLog } from "../../debug-log.js";
import { hashId } from "../../ids.js";
import { AGENT_LOOP_MAX_TOKENS, boundedMaxTokens } from "../../model-budget.js";
import { truncateRecordContent } from "../../serialize.js";
import { type Observation, type Reflection, reflectionToSummaryLine } from "../../session-ledger/index.js";
import { estimateStringTokens } from "../../tokens.js";
import { drainAgentStream } from "../drain.js";
import {
	coverageTierForObservation,
	type ReflectionCoverageTier,
	reflectionCoverageMap,
	summarizeCoverageByRelevance,
	summarizeCoverageTransitionsByRelevance,
} from "../dropper/coverage.js";
import { logAgentStreamError } from "../stream-errors.js";
import { REFLECTOR_SYSTEM } from "./prompts.js";

interface RunReflectorArgs {
	model: Model<any>;
	apiKey?: string;
	headers?: Record<string, string>;
	reflections: Reflection[];
	observations: Observation[];
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
}

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

type RecordReflectionsArgs = Static<typeof RecordReflectionsSchema>;
type RetireReflectionsArgs = Static<typeof RetireReflectionsSchema>;

export type ReflectorPassResult = {
	reflections: Reflection[];
	retiredIds: string[];
};

function joinOrEmpty(items: string[]): string {
	return items.length ? items.join("\n") : "(none yet)";
}

export function observationToReflectorLine(observation: Observation, coverage: ReflectionCoverageTier): string {
	return `[${observation.id}] ${observation.timestamp} [${observation.relevance}] [coverage: ${coverage}] ${observation.content}`;
}

export function summarizeSupportIdCounts(reflections: readonly Reflection[]): {
	reflectionCount: number;
	totalSupportIds: number;
	minSupportIds: number;
	maxSupportIds: number;
	averageSupportIds: number;
	histogram: Record<string, number>;
} {
	if (reflections.length === 0) {
		return {
			reflectionCount: 0,
			totalSupportIds: 0,
			minSupportIds: 0,
			maxSupportIds: 0,
			averageSupportIds: 0,
			histogram: {},
		};
	}
	const counts = reflections.map((reflection) => reflection.supportingObservationIds.length);
	const totalSupportIds = counts.reduce((sum, count) => sum + count, 0);
	const histogram: Record<string, number> = {};
	for (const count of counts) histogram[String(count)] = (histogram[String(count)] ?? 0) + 1;
	return {
		reflectionCount: reflections.length,
		totalSupportIds,
		minSupportIds: Math.min(...counts),
		maxSupportIds: Math.max(...counts),
		averageSupportIds: totalSupportIds / reflections.length,
		histogram,
	};
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
	for (let i = 0; i < allowedObservationIds.length; i++) {
		if (!allowedOrder.has(allowedObservationIds[i])) allowedOrder.set(allowedObservationIds[i], i);
	}

	const seen = new Set<string>();
	for (const id of supportingObservationIds) {
		if (!allowedOrder.has(id)) return undefined;
		seen.add(id);
	}
	if (seen.size === 0) return undefined;
	return Array.from(seen).sort((a, b) => (allowedOrder.get(a) ?? 0) - (allowedOrder.get(b) ?? 0));
}

function normalizeReflectionContent(content: string): string | undefined {
	const normalized = truncateRecordContent(content.trim());
	if (!normalized || /\r|\n/.test(normalized)) return undefined;
	return normalized;
}

export async function runReflector(args: RunReflectorArgs): Promise<ReflectorPassResult | undefined> {
	const { model, apiKey, headers, reflections, observations, signal } = args;
	if (observations.length === 0) return undefined;

	const coverageById = reflectionCoverageMap(observations, reflections);
	debugLog("reflector.agent_start", {
		activeObservationCount: observations.length,
		reflectionCount: reflections.length,
		coverageSummaryByRelevance: summarizeCoverageByRelevance(observations, coverageById),
	});

	const allowedObservationIds = observations.map((observation) => observation.id);
	const currentReflectionIds = new Set(reflections.map((reflection) => reflection.id));
	const existingReflectionIds = new Set(currentReflectionIds);
	const accumulated = new Map<string, Reflection>();
	const retiredIds: string[] = [];
	const retired = new Set<string>();
	let toolCallCount = 0;
	let rawProposedReflectionCount = 0;
	let acceptedReflectionCount = 0;
	let duplicateReflectionCount = 0;
	let rejectedReflectionCount = 0;
	let acceptedRetirementCount = 0;
	let rejectedRetirementCount = 0;

	const recordReflections: AgentTool<typeof RecordReflectionsSchema> = {
		name: "record_reflections",
		label: "Record reflections",
		description:
			"Record new durable current-law reflections with supporting observation ids. Optionally supersede current reflection ids.",
		parameters: RecordReflectionsSchema,
		execute: async (_id, params: RecordReflectionsArgs) => {
			toolCallCount++;
			rawProposedReflectionCount += params.reflections.length;
			let added = 0;
			let duplicates = 0;
			let rejected = 0;
			let retiredNow = 0;
			for (const proposal of params.reflections) {
				const content = normalizeReflectionContent(proposal.content);
				const supportingObservationIds = normalizeSupportingObservationIds(
					proposal.supportingObservationIds,
					allowedObservationIds,
				);
				const supersedesInvalid = proposal.supersedes?.some((id) => !currentReflectionIds.has(id));
				const supersedes = proposal.supersedes
					? (normalizeRetiredReflectionIds(proposal.supersedes, currentReflectionIds, retired) ?? [])
					: [];
				if (!content || !supportingObservationIds || supersedesInvalid) {
					rejected++;
					continue;
				}
				const id = hashId(content);
				if (existingReflectionIds.has(id) || accumulated.has(id)) {
					duplicates++;
					continue;
				}
				accumulated.set(id, {
					id,
					content,
					supportingObservationIds,
					tokenCount: estimateStringTokens(content),
				});
				added++;
				if (supersedes) {
					for (const retiredId of supersedes) {
						retired.add(retiredId);
						retiredIds.push(retiredId);
						retiredNow++;
					}
				}
			}
			acceptedReflectionCount += added;
			duplicateReflectionCount += duplicates;
			rejectedReflectionCount += rejected;
			acceptedRetirementCount += retiredNow;
			return {
				content: [
					{
						type: "text",
						text: `Recorded ${added} reflection${added === 1 ? "" : "s"}; ${duplicates} duplicate${duplicates === 1 ? "" : "s"}; ${rejected} rejected; retired ${retiredNow}. Total this run: ${accumulated.size} new, ${retired.size} retired.`,
					},
				],
				details: { added, duplicates, rejected, retired: retiredNow, total: accumulated.size },
			};
		},
	};

	const retireReflections: AgentTool<typeof RetireReflectionsSchema> = {
		name: "retire_reflections",
		label: "Retire reflections",
		description: "Retire current-law reflection ids that are no longer current. Does not erase ledger history.",
		parameters: RetireReflectionsSchema,
		execute: async (_id, params: RetireReflectionsArgs) => {
			toolCallCount++;
			const normalized = normalizeRetiredReflectionIds(params.reflectionIds, currentReflectionIds, retired);
			if (!normalized) {
				rejectedRetirementCount += params.reflectionIds.length;
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
			acceptedRetirementCount += normalized.length;
			return {
				content: [
					{
						type: "text",
						text: `Retired ${normalized.length} reflection${normalized.length === 1 ? "" : "s"}. Total retired this run: ${retired.size}.`,
					},
				],
				details: { added: normalized.length, rejected: 0, total: retired.size },
			};
		},
	};

	const userText = `CURRENT LAW:\n${joinOrEmpty(reflections.map(reflectionToSummaryLine))}\n\nCURRENT WORKING EVIDENCE:\n${joinOrEmpty(observations.map((observation) => observationToReflectorLine(observation, coverageTierForObservation(observation, coverageById))))}\n\nMaintain current law in this one pass: emit missing durable facts, supersede outdated law, or retire law that is no longer current. If a pivot still constrains later work, leave that residue on the successor. If nothing should change, do not call a tool.`;
	const prompts: Message[] = [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }];
	const context: AgentContext = {
		systemPrompt: REFLECTOR_SYSTEM,
		messages: [],
		tools: [recordReflections as AgentTool<any>, retireReflections as AgentTool<any>],
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
		...(effectiveMaxTurns !== undefined ? { shouldStopAfterTurn: () => ++turnCount >= effectiveMaxTurns } : {}),
	};

	const loop = args.agentLoop ?? agentLoop;
	const stream = loop(prompts, context, config, signal, streamSimple);
	await drainAgentStream(
		stream,
		(event) => {
			// Tool execution collects records.
			logAgentStreamError("reflector", event);
		},
		signal,
	);
	const acceptedReflections = Array.from(accumulated.values());
	const currentLaw = [...reflections.filter((reflection) => !retired.has(reflection.id)), ...acceptedReflections];
	const afterCoverageById = reflectionCoverageMap(observations, currentLaw);
	debugLog("reflector.result", {
		reason:
			acceptedReflections.length > 0 || retiredIds.length > 0
				? "accepted_nonempty"
				: toolCallCount === 0
					? "no_tool_call"
					: "all_filtered",
		toolCallCount,
		rawProposedReflectionCount,
		acceptedReflectionCount,
		duplicateReflectionCount,
		rejectedReflectionCount,
		acceptedRetirementCount,
		rejectedRetirementCount,
		acceptedSupportIdCounts: summarizeSupportIdCounts(acceptedReflections),
		coverageTransitionsByRelevance: summarizeCoverageTransitionsByRelevance(
			observations,
			coverageById,
			afterCoverageById,
		),
	});
	if (acceptedReflections.length === 0 && retiredIds.length === 0) return undefined;
	return { reflections: acceptedReflections, retiredIds };
}
