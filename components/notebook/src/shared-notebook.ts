import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
	EventBus,
	ExtensionAPI,
	ExtensionContext,
	SessionManager,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { applyNotebookUpdate, commitNotebookUpdate } from "./notebook-maintenance.js";
import type { Runtime } from "./runtime.js";
import { foldLedger, isSourceEntry, renderSummary } from "./session-ledger/index.js";
import { childSourceId, notebookSourceEntries } from "./session-ledger/sources.js";
import type { ChildSourceOrigin, Entry } from "./session-ledger/types.js";
import { recallObservationTool } from "./tools/notebook-source.js";

const OWNER_REQUEST = "apple-pi:notebook-owner:request";
const AddLearningSchema = Type.Object(
	{
		reflections: Type.Array(
			Type.Object(
				{
					content: Type.String({ minLength: 1 }),
					sourceEntryIds: Type.Optional(
						Type.Array(Type.String({ minLength: 1 }), {
							minItems: 1,
							description: "Original source ids from your own child session. Omit to cite your current user turn.",
						}),
					),
				},
				{ additionalProperties: false },
			),
			{ minItems: 1 },
		),
	},
	{ additionalProperties: false },
);
type AddLearningArgs = Static<typeof AddLearningSchema>;

export interface SharedNotebook {
	entries(signal?: AbortSignal): Entry[];
	add(origin: ChildSourceOrigin, sources: Entry[], args: AddLearningArgs, signal?: AbortSignal): AgentToolResult;
}

function currentTurnSources(entries: Entry[]): Entry[] {
	const sources = entries.filter(isSourceEntry);
	const userIndex = sources.findLastIndex((entry) => (entry.message as { role?: string })?.role === "user");
	return sources.slice(Math.max(0, userIndex));
}

function sourceAddress(entry: Entry): string {
	const message = entry.message as { role?: string; toolCallId?: string; content?: unknown } | undefined;
	const calls = Array.isArray(message?.content)
		? message.content.filter((part) => part.type === "toolCall").map((part) => part.id)
		: [];
	return `[${entry.id}] ${message?.role ?? entry.type}${[message?.toolCallId, ...calls]
		.filter(Boolean)
		.map((id) => ` ${id}`)
		.join("")}`;
}

/** A capability is tied to the primary branch that issued it, never a later current session. */
export function registerSharedNotebook(pi: ExtensionAPI, runtime: Runtime): void {
	let context: ExtensionContext | undefined;
	let epoch = 0;
	const invalidate = () => {
		epoch++;
		context = undefined;
	};
	pi.on("session_start", (_event, ctx) => {
		invalidate();
		context = ctx;
	});
	pi.on("before_agent_start", (_event, ctx) => {
		context = ctx;
	});
	pi.on("session_tree", (_event, ctx) => {
		context = ctx;
	});
	pi.on("session_before_switch", invalidate);
	pi.on("session_before_fork", invalidate);
	pi.on("session_before_tree", invalidate);
	const unsubscribe = pi.events.on(OWNER_REQUEST, (reply) => {
		if (typeof reply !== "function" || !context || runtime.disposed) return;
		const owner = context;
		const generation = epoch;
		const sessionId = owner.sessionManager.getSessionId();
		const anchor = owner.sessionManager.getLeafId();
		const entries = (signal?: AbortSignal): Entry[] => {
			signal?.throwIfAborted();
			if (runtime.disposed || generation !== epoch || !context)
				throw new Error("The primary notebook owner is no longer available.");
			const branch = owner.sessionManager.getBranch() as Entry[];
			if (owner.sessionManager.getSessionId() !== sessionId || (anchor && !branch.some((entry) => entry.id === anchor)))
				throw new Error("The primary notebook branch changed.");
			return branch;
		};
		const capability: SharedNotebook = {
			entries,
			add(origin, childEntries, args, signal) {
				const branch = entries(signal);
				if (
					"retireReflectionIds" in args ||
					"retainReflectionIds" in args ||
					args.reflections.some((reflection) => "supersedes" in reflection)
				)
					throw new Error("Child notebook access is add-only; shared curation belongs to the primary.");
				const sources = childEntries.filter(isSourceEntry);
				const currentTurnIds = currentTurnSources(childEntries).map((entry) => entry.id);
				const folded = foldLedger(branch);
				const applied = applyNotebookUpdate(
					{
						allowedSourceEntryIds: sources.map((entry) => entry.id),
						currentReflections: folded.currentReflections,
						expectedReflectionIds: folded.currentReflections.map((reflection) => reflection.id),
						fullMaintenanceDue: false,
						coversUpToId: branch.find(isSourceEntry)?.id ?? "",
					},
					{
						reflections: args.reflections.map((reflection) => ({
							...reflection,
							sourceEntryIds: reflection.sourceEntryIds ?? currentTurnIds,
						})),
						retireReflectionIds: [],
					},
				);
				if (applied.rejected)
					throw new Error("Notebook addition rejected: invalid learning content or child source ids.");
				const cited = new Set(applied.reflections.flatMap((reflection) => reflection.sourceEntryIds ?? []));
				const archived = new Set(notebookSourceEntries(branch).map((entry) => entry.id));
				const retained = sources.filter(
					(source) => cited.has(source.id) && !archived.has(childSourceId(origin.sessionId, source.id)),
				);
				applied.reflections = applied.reflections.map((reflection) => ({
					...reflection,
					sourceEntryIds: reflection.sourceEntryIds?.map((id) => childSourceId(origin.sessionId, id)),
				}));
				if (retained.length) applied.childSources = structuredClone({ origin, entries: retained });
				// Sources and learnings share one validated append; no await can interleave another writer.
				if (!commitNotebookUpdate(pi, runtime, branch, applied))
					throw new Error("Primary notebook could not accept this addition.");
				return {
					content: [
						{
							type: "text",
							text: `Notebook updated: ${applied.reflections.length} learning(s).${applied.reflections.map((reflection) => `\n- ${reflection.id}: ${reflection.content}`).join("")}`,
						},
					],
					details: { accepted: true, reflections: applied.reflections },
				};
			},
		};
		(reply as (value: SharedNotebook) => void)(capability);
	});
	pi.on("session_shutdown", () => {
		invalidate();
		unsubscribe();
	});
}

export function getSharedNotebook(events: EventBus): SharedNotebook | undefined {
	let notebook: SharedNotebook | undefined;
	events.emit(OWNER_REQUEST, (value: SharedNotebook) => {
		notebook ??= value;
	});
	return notebook;
}

export const SHARED_SNAPSHOT_CUSTOM_TYPE = "notebook.shared-snapshot";

/**
 * A coding child sees the shared learnings at launch and again right after each compaction,
 * appended as a persisted message so later requests keep an identical prefix. Sibling additions
 * are not broadcast; read_notebook is the fresh read between those boundaries.
 */
export function registerSharedLearningSnapshots(
	pi: ExtensionAPI,
	notebook: SharedNotebook,
	childJournal: () => SessionManager,
): void {
	const append = () => {
		const summary = renderSummary(foldLedger(notebook.entries()).currentReflections);
		if (!summary.trim()) return;
		// At compaction, sendMessage would defer until after the next response. Pi builds that
		// request from this journal, so append here without queuing a steer or an extra turn.
		childJournal().appendCustomMessageEntry(
			SHARED_SNAPSHOT_CUSTOM_TYPE,
			[
				{
					type: "text",
					text: `## Shared learnings snapshot\n\nOpen learnings in the primary notebook at this boundary. Between snapshots, use read_notebook for current learnings.\n\n${summary}`,
				},
			],
			false,
		);
	};
	pi.on("session_start", append);
	pi.on("session_compact", append);
}

export function createChildNotebookTools(
	notebook: SharedNotebook,
	origin: Pick<ChildSourceOrigin, "agentType" | "agentId">,
): ToolDefinition[] {
	return [
		defineTool({
			name: "read_notebook",
			label: "Read shared learnings",
			description:
				"Read the current open learnings in the primary notebook shared by your delegation tree. Follow a learning id with revisit_note for original evidence. This also lists your own current-turn source ids, matched to message roles and tool call ids, for selective update_notebook citations.",
			promptSnippet: "Read fresh shared learnings from the primary notebook.",
			promptGuidelines: [
				"Open shared learnings arrive automatically as a snapshot at launch and after compaction; the snapshot does not update as others add learnings. Use read_notebook when you need the current shared learnings, and revisit_note when a known learning's exact sources matter.",
			],
			parameters: Type.Object({}),
			async execute(_id, _args, signal, _update, ctx) {
				const reflections = foldLedger(notebook.entries(signal)).currentReflections;
				const sources = currentTurnSources(ctx.sessionManager.getBranch() as Entry[]);
				const text = `${renderSummary(reflections) || "No open shared learnings."}\n\nYour current-turn source ids for selective citations:\n${sources.map(sourceAddress).join("\n")}`;
				return { content: [{ type: "text", text }], details: { reflections } };
			},
		}),
		defineTool({
			name: "update_notebook",
			label: "Add shared learning",
			description:
				"Immediately add a sourced learning to your primary session's shared notebook. Record a discovery and what to do differently, not task status or plans. Cite original entries from your own session, or omit ids to cite your current user turn. Your access is add-only; primary programmers curate existing learnings.",
			promptSnippet: "Add a sourced learning to the primary notebook during work.",
			promptGuidelines: [
				"When surprised, record the discovery and what worked instead with update_notebook. Accepted additions survive later failure or cancellation; report any rejected capture honestly.",
			],
			parameters: AddLearningSchema,
			async execute(_id, args, signal, _update, ctx) {
				return notebook.add(
					{ ...origin, sessionId: ctx.sessionManager.getSessionId() },
					ctx.sessionManager.getBranch() as Entry[],
					args,
					signal,
				);
			},
		}),
		{
			...recallObservationTool,
			description: `${recallObservationTool.description} This follows the primary notebook shared by your delegation tree, including archived child evidence.`,
			execute(id, args, signal, update, ctx) {
				return recallObservationTool.execute(id, args, signal, update, {
					...ctx,
					sessionManager: {
						...ctx.sessionManager,
						getBranch: () => notebook.entries(signal),
					} as ExtensionContext["sessionManager"],
				});
			},
		},
	];
}
