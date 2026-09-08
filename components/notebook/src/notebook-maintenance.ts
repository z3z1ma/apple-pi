import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { type Config, resolveNotebookSourceMaxTokens } from "./config.js";
import { hashId } from "./ids.js";
import { normalizeRetiredReflectionIds, normalizeSourceEntryIds } from "./maintenance/validation.js";
import type { Runtime } from "./runtime.js";
import { nowTimestamp, serializeSourceAddressedBranchEntries, truncateRecordContent } from "./serialize.js";
import {
	buildNotebookMaintenanceData,
	type Entry,
	foldLedger,
	isSourceEntry,
	latestCoverageIndex,
	latestCoverageMarkerId,
	NOTEBOOK_MAINTENANCE,
	NOTEBOOK_OBSERVATIONS_RECORDED,
	type Reflection,
	reflectionToSummaryLine,
} from "./session-ledger/index.js";
import { estimateStringTokens } from "./tokens.js";

export const UPDATE_NOTEBOOK_TOOL_NAME = "update_notebook";

const UpdateNotebookSchema = Type.Object({
	reflections: Type.Array(
		Type.Object({
			content: Type.String({ minLength: 1 }),
			sourceEntryIds: Type.Optional(
				Type.Array(Type.String({ minLength: 1 }), {
					minItems: 1,
					description:
						"Primary source entry ids. The main agent may omit these to cite the current user turn; the pair supplies explicit ids.",
				}),
			),
			supersedes: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
		}),
	),
	retireReflectionIds: Type.Array(Type.String({ minLength: 1 })),
	retainReflectionIds: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			description:
				"Required for a full pair review: explicitly select existing conclusions to keep. An empty array deliberately retires all existing conclusions. Omit for targeted updates.",
		}),
	),
});

export type UpdateNotebookArgs = Static<typeof UpdateNotebookSchema>;

export type PairNotebookBatch = {
	id: string;
	coversUpToId: string;
	allowedSourceEntryIds: string[];
	reflections: Reflection[];
	expectedReflectionIds: string[];
	fullMaintenanceDue: boolean;
	sourceTokens: number;
	priorCoverageId?: string;
	sessionIdentity?: string;
	prompt: string;
	unresolvedSource: string;
};

export type NotebookUpdate = {
	coversUpToId: string;
	reflections: Reflection[];
	retiredIds: string[];
	expectedReflectionIds: string[];
	fullMaintenanceDue: boolean;
	rejected: number;
	batchId?: string;
	sourceTokens?: number;
	priorCoverageId?: string;
	sessionIdentity?: string;
};

export type PairNotebookUpdate = NotebookUpdate & {
	batchId: string;
	sourceTokens: number;
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

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const expected = new Set(right);
	return left.every((id) => expected.has(id));
}

function coverageIdForUpdate(args: {
	fullMaintenanceDue: boolean;
	coversUpToId: string;
	priorCoverageId?: string;
	allowedSourceEntryIds: readonly string[];
}): string {
	if (args.fullMaintenanceDue) return args.coversUpToId;
	return args.priorCoverageId ?? args.allowedSourceEntryIds[0] ?? args.coversUpToId;
}

export function applyNotebookUpdate(
	input: {
		allowedSourceEntryIds: readonly string[];
		currentReflections: readonly Reflection[];
		expectedReflectionIds: readonly string[];
		fullMaintenanceDue: boolean;
		coversUpToId: string;
	},
	args: UpdateNotebookArgs,
): NotebookUpdate {
	if (input.fullMaintenanceDue && args.retainReflectionIds === undefined) {
		throw new Error(
			"A full notebook review must explicitly select retainReflectionIds; [] retires all existing conclusions.",
		);
	}
	const currentIds = new Set(input.currentReflections.map((reflection) => reflection.id));
	for (const id of [...args.retireReflectionIds, ...(args.retainReflectionIds ?? [])]) {
		if (!currentIds.has(id)) throw new Error(`Unknown current conclusion: ${id}`);
	}
	const retired = new Set<string>();
	const retiredIds: string[] = [];
	const reflections = new Map<string, Reflection>();
	let rejected = 0;

	for (const proposal of args.reflections) {
		const content = normalizeReflectionContent(proposal.content);
		const sourceEntryIds = normalizeSourceEntryIds(proposal.sourceEntryIds ?? [], input.allowedSourceEntryIds);
		const supersedesInvalid = proposal.supersedes?.some((id) => !currentIds.has(id));
		const supersedes = proposal.supersedes
			? (normalizeRetiredReflectionIds(proposal.supersedes, currentIds, retired) ?? [])
			: [];
		if (!content || !sourceEntryIds || supersedesInvalid) {
			rejected++;
			continue;
		}
		if ([...input.currentReflections, ...reflections.values()].some((reflection) => reflection.content === content))
			continue;
		const id = hashId(randomUUID());
		reflections.set(id, {
			id,
			content,
			supportingObservationIds: [],
			sourceEntryIds,
			tokenCount: estimateStringTokens(content),
		});
		for (const reflectionId of supersedes) {
			retired.add(reflectionId);
			retiredIds.push(reflectionId);
		}
	}

	const explicitRetirements = normalizeRetiredReflectionIds(args.retireReflectionIds, currentIds, retired);
	for (const reflectionId of explicitRetirements ?? []) {
		retired.add(reflectionId);
		retiredIds.push(reflectionId);
	}

	if (input.fullMaintenanceDue) {
		if (rejected > 0)
			throw new Error(
				"Full notebook review contains invalid conclusions; correct their content and source ids before retiring existing conclusions.",
			);
		const retain = new Set(args.retainReflectionIds);
		for (const reflection of input.currentReflections) {
			if (retired.has(reflection.id) || retain.has(reflection.id)) continue;
			retired.add(reflection.id);
			retiredIds.push(reflection.id);
		}
	}

	return {
		coversUpToId: input.coversUpToId,
		reflections: [...reflections.values()],
		retiredIds,
		expectedReflectionIds: [...input.expectedReflectionIds],
		fullMaintenanceDue: input.fullMaintenanceDue,
		rejected,
	};
}

export function preparePairNotebookBatch(args: {
	entries: Entry[];
	config: Config;
	contextWindow?: number;
	fullMaintenanceDue: boolean;
	sourceTokens: number;
	sessionIdentity?: string;
}): PairNotebookBatch | undefined {
	const allSourceIds = args.entries.filter(isSourceEntry).map((entry) => entry.id);
	if (allSourceIds.length === 0) return undefined;

	const lastCoverage = latestCoverageIndex(args.entries, NOTEBOOK_OBSERVATIONS_RECORDED);
	const backlog = sourceEntriesAfter(args.entries, lastCoverage);
	const maxTokens = resolveNotebookSourceMaxTokens(args.config, args.contextWindow);
	const serialized = serializeSourceAddressedBranchEntries(backlog, { maxTokens });
	const priorCoverageId = latestCoverageMarkerId(args.entries, NOTEBOOK_OBSERVATIONS_RECORDED);
	const coversUpToId = serialized.sourceEntryIds.at(-1) ?? priorCoverageId ?? allSourceIds[0];
	if (!coversUpToId) return undefined;

	const folded = foldLedger(args.entries);
	const expectedReflectionIds = folded.currentReflections.map((reflection) => reflection.id);
	const prompt = args.fullMaintenanceDue
		? [
				"### Time to update the shared notebook",
				"Review this sourced span and call `update_notebook` exactly once. Keep only working conclusions that should still change how we proceed. Each conclusion needs source entry ids. These are revisable, scoped working conclusions. Explicitly select retainReflectionIds: omitted current conclusions will be retired; [] deliberately retires all existing conclusions. Keep only conclusions that add value beyond ordinary compaction. Review scope, contrary evidence, and resolved work before selecting.",
				`Current local time: ${nowTimestamp()}`,
				`Source entry ids in this review span, oldest to newest: ${serialized.sourceEntryIds.join(", ")}. Earlier ids are usable when recovered through revisit_note or already present in your trajectory.`,
				`Coverage endpoint: ${coversUpToId}`,
				`Current working conclusions:\n${joinOrEmpty(folded.currentReflections.map(reflectionToSummaryLine))}`,
			].join("\n\n")
		: "";

	return {
		id: `${coversUpToId}:${serialized.sourceEntryIds.length}:${expectedReflectionIds.join(",")}`,
		coversUpToId,
		allowedSourceEntryIds: allSourceIds,
		reflections: folded.currentReflections,
		expectedReflectionIds,
		fullMaintenanceDue: args.fullMaintenanceDue,
		sourceTokens: args.sourceTokens,
		priorCoverageId,
		...(args.sessionIdentity ? { sessionIdentity: args.sessionIdentity } : {}),
		prompt,
		unresolvedSource: serialized.text,
	};
}

function notebookUpdateHasEffect(update: NotebookUpdate): boolean {
	return update.fullMaintenanceDue || update.reflections.length > 0 || update.retiredIds.length > 0;
}

export function commitNotebookUpdate(
	pi: ExtensionAPI,
	runtime: Runtime,
	entries: Entry[],
	update: NotebookUpdate,
): boolean {
	if (runtime.disposed || !entries.some((entry) => entry.id === update.coversUpToId)) return false;
	const existing = foldLedger(entries);
	const currentIds = existing.currentReflections.map((reflection) => reflection.id);
	if (!sameIdSet(currentIds, update.expectedReflectionIds)) return false;
	if (!notebookUpdateHasEffect(update)) return true;
	const data = buildNotebookMaintenanceData({
		coversUpToId: update.coversUpToId,
		observations: [],
		reflections: update.reflections,
		retiredReflectionIds: update.retiredIds.filter((id) => currentIds.includes(id)),
		droppedObservationIds: [],
	});
	if (!data) return false;
	pi.appendEntry(NOTEBOOK_MAINTENANCE, data);
	return true;
}

/** Private pairing capability. Calls stage data only; the root host commits it after a successful pair programmer turn. */
export class UpdateNotebookTool {
	readonly name = UPDATE_NOTEBOOK_TOOL_NAME;
	readonly label = "Update pair programmer notebook";
	readonly description =
		"Update the shared notebook of working conclusions for this pair programming session. Add or supersede conclusions that should still change how you proceed, citing source entry ids. Retire conclusions that no longer apply. During a full update, current conclusions omitted from retainReflectionIds are retired. This never edits repository files. When a full notebook update is requested, call exactly once even if every array is empty.";
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

		const applied = applyNotebookUpdate(
			{
				allowedSourceEntryIds: batch.allowedSourceEntryIds,
				currentReflections: batch.reflections,
				expectedReflectionIds: batch.expectedReflectionIds,
				fullMaintenanceDue: batch.fullMaintenanceDue,
				coversUpToId: coverageIdForUpdate(batch),
			},
			params,
		);
		this.#staged = {
			...applied,
			batchId: batch.id,
			sourceTokens: batch.sourceTokens,
			...(batch.priorCoverageId ? { priorCoverageId: batch.priorCoverageId } : {}),
			...(batch.sessionIdentity ? { sessionIdentity: batch.sessionIdentity } : {}),
		};
		return {
			content: [
				{
					type: "text",
					text: `Notebook update ready: ${applied.reflections.length} conclusion${applied.reflections.length === 1 ? "" : "s"} and ${applied.retiredIds.length} retirement${applied.retiredIds.length === 1 ? "" : "s"}${applied.rejected > 0 ? `; rejected ${applied.rejected} invalid proposal${applied.rejected === 1 ? "" : "s"}` : ""}. It will be saved when this turn finishes successfully.`,
				},
			],
			details: {
				accepted: true,
				reflections: applied.reflections.length,
				retired: applied.retiredIds.length,
				rejected: applied.rejected,
			},
		};
	}
}

function applyLiveNotebookUpdate(
	entries: Entry[],
	params: UpdateNotebookArgs,
	fullMaintenanceDue: boolean,
): NotebookUpdate | undefined {
	const sources = entries.filter(isSourceEntry);
	const allowedSourceEntryIds = sources.map((entry) => entry.id);
	const userIndex = sources.findLastIndex((entry) => (entry.message as { role?: string } | undefined)?.role === "user");
	const currentTurnIds = sources.slice(Math.max(0, userIndex)).map((entry) => entry.id);
	params = {
		...params,
		reflections: params.reflections.map((reflection) => ({
			...reflection,
			sourceEntryIds: reflection.sourceEntryIds ?? currentTurnIds,
		})),
	};
	const folded = foldLedger(entries);
	const expectedReflectionIds = folded.currentReflections.map((reflection) => reflection.id);
	const priorCoverageId = latestCoverageMarkerId(entries, NOTEBOOK_OBSERVATIONS_RECORDED);
	const coversUpToId = coverageIdForUpdate({
		fullMaintenanceDue,
		coversUpToId: priorCoverageId ?? allowedSourceEntryIds[0] ?? entries.at(-1)?.id ?? "",
		priorCoverageId,
		allowedSourceEntryIds,
	});
	if (!coversUpToId) return undefined;
	return applyNotebookUpdate(
		{
			allowedSourceEntryIds,
			currentReflections: folded.currentReflections,
			expectedReflectionIds,
			fullMaintenanceDue,
			coversUpToId,
		},
		params,
	);
}

export function registerMainNotebookTool(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerTool(
		defineTool({
			name: UPDATE_NOTEBOOK_TOOL_NAME,
			label: "Update pair programmer notebook",
			description:
				"Add, supersede, or retire working conclusions in the shared session notebook. New conclusions cite source entry ids, or omit sourceEntryIds to cite the current user turn. These are revisable, scoped working conclusions. Ordinary calls ignore retainReflectionIds; use retireReflectionIds or supersedes to remove a conclusion. Changes take effect on the next context rebuild.",
			promptSnippet:
				"Use update_notebook to add, supersede, or retire a working conclusion that should still change later work.",
			promptGuidelines: [
				"Use update_notebook for conclusions that change later decisions beyond what ordinary compaction preserves. Omit sourceEntryIds to cite the current user turn, or supply exact primary source ids recovered through revisit_note.",
				"Use update_notebook to supersede or retire conclusions as soon as contrary evidence, resolved work, or a scope change makes them obsolete. An empty notebook is a successful outcome.",
			],
			parameters: UpdateNotebookSchema,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (runtime.disposed) {
					return {
						content: [{ type: "text" as const, text: "Notebook updates are unavailable in this session." }],
						details: { accepted: false },
					};
				}
				const entries = ctx.sessionManager.getBranch() as Entry[];
				runtime.ensureConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
				const applied = applyLiveNotebookUpdate(entries, params as UpdateNotebookArgs, false);
				if (!applied) {
					return {
						content: [{ type: "text" as const, text: "No session entries to attach notebook changes to." }],
						details: { accepted: false },
					};
				}
				if (!commitNotebookUpdate(pi, runtime, entries, applied)) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Notebook update was rejected because the current conclusions changed. Retry against the latest notebook.",
							},
						],
						details: { accepted: false, rejected: applied.rejected },
					};
				}
				if (!notebookUpdateHasEffect(applied)) {
					return {
						content: [
							{
								type: "text" as const,
								text: applied.rejected
									? `No notebook changes. Rejected ${applied.rejected} invalid proposal${applied.rejected === 1 ? "" : "s"}.`
									: "No notebook changes.",
							},
						],
						details: { accepted: true, reflections: 0, retired: 0, rejected: applied.rejected },
					};
				}
				return {
					content: [
						{
							type: "text" as const,
							text: `Notebook updated: ${applied.reflections.length} conclusion${applied.reflections.length === 1 ? "" : "s"} and ${applied.retiredIds.length} retirement${applied.retiredIds.length === 1 ? "" : "s"}${applied.rejected > 0 ? `; rejected ${applied.rejected} invalid proposal${applied.rejected === 1 ? "" : "s"}` : ""}.`,
						},
					],
					details: {
						accepted: true,
						reflections: applied.reflections.length,
						retired: applied.retiredIds.length,
						rejected: applied.rejected,
					},
				};
			},
		}),
	);
}
