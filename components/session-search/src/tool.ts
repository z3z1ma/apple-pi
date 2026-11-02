import type { Message } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	expandEntryFile,
	expandSourceEntry,
	expandToolCall,
	parseCallQuery,
	parseDrillDown,
	parseEntryQuery,
} from "./drill-down.js";
import { formatRecallOutput, formatTouchedOutput } from "./format-recall.js";
import { getActiveLineageEntryIds } from "./lineage.js";
import { loadAllMessages } from "./load-messages.js";
import { matchesRecallFilter, validateRecallFilter } from "./query-filter.js";
import { normalizeRecallMode, normalizeRecallScope } from "./recall-scope.js";
import { renderMessage } from "./render-entries.js";
import { getFileIndicators, getTouchedFiles, type SearchHit, searchEntries } from "./search-entries.js";

const DEFAULT_RECENT = 25;
const PAGE_SIZE = 5;

export const invalidExpandIndices = (requested: number[], available: Set<number>): number[] =>
	requested.filter((i) => !Number.isSafeInteger(i) || i < 0 || !available.has(i));

const invalidPositiveInteger = (value: unknown): boolean =>
	typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0;

export const SESSION_SEARCH_TOOL_NAME = "search_session";

export const sessionSearchTool = defineTool({
	name: SESSION_SEARCH_TOOL_NAME,
	label: "Session search",
	description:
		"Search this session's earlier conversation, tool calls, and write/edit payloads. " +
		"Use it after compaction when you need to remember a prior decision, recover earlier tool output, or revisit a file version written during the session. " +
		"This looks through session history, not git history or the current repository. " +
		"Search literal text (default) or explicit 'regex:<pattern>', list touched files, inspect only write/edit payloads, expand entries, recover a written file with query:'#N:path', or recover an omitted tool result with query:'call:<id>'. " +
		"Expand any source by query:'entry:<id>[:offset[:limit]]' (zero-based lines). New custom, summary and notebook records use stable IDs, not message ordinals. " +
		"It follows the active lineage by default; scope:'all' includes other branches.",
	promptSnippet: "Recover earlier conversation, tool results, and file operations from this session.",
	promptGuidelines: [
		"Use search_session for earlier work or evidence missing from context, including after compaction. Use grep, find, or read for current repository files; use revisit_note for a known notebook id.",
	],
	parameters: Type.Object({
		query: Type.Optional(
			Type.String({
				description:
					"Literal text/path terms by default (case-insensitive, spelling variants); multi-word terms are relevance-ranked, with at least two meaningful terms required for queries of three or more terms. Explicit safe regex: 'regex:hook|inject'. Recover a source with 'entry:<id>[:offset[:limit]]', written content with '#N:path[:offset[:limit]|:full]', or a result with 'call:<toolCallId>'.",
			}),
		),
		filter: Type.Optional(
			Type.Object(
				{
					after: Type.Optional(
						Type.String({ description: "Inclusive ISO date or timestamp (timezone required for timestamps)." }),
					),
					before: Type.Optional(
						Type.String({ description: "Exclusive ISO date or timestamp (timezone required for timestamps)." }),
					),
					role: Type.Optional(
						Type.String({
							description:
								"Exact role: user, assistant, tool_result, bash, custom_message, compaction, branch_summary, notebook.",
						}),
					),
					tool: Type.Optional(
						Type.String({
							description: "Exact tool name in a direct attempted call, result, or nested execution operation.",
						}),
					),
					source: Type.Optional(
						Type.String({
							description: "Exact source kind: message, custom_message, compaction, branch_summary, notebook.",
						}),
					),
				},
				{
					description: "Narrow discovery/browse/touched results; exact source recovery uses scope, not these filters.",
				},
			),
		),
		expand: Type.Optional(
			Type.Array(Type.Integer({ minimum: 0 }), {
				description:
					"Non-negative entry indices to return full untruncated content for. Works alone (any index in scope) or alongside query (expands matching entries on the current page).",
			}),
		),
		page: Type.Optional(
			Type.Integer({
				minimum: 1,
				description: "Positive page number (1-based) for paginated search results. Default: 1.",
			}),
		),
		mode: Type.Optional(
			Type.Union([Type.Literal("history"), Type.Literal("file"), Type.Literal("touched")], {
				description: "history (default), file (write/edit payload search only), or touched (files grouped by path).",
			}),
		),
		scope: Type.Optional(
			Type.String({
				description: "Search scope. Options: 'lineage' (default) or 'all' (entire session, including branches).",
			}),
		),
	}),
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recall resolution owns the complete request-validation and scope-selection flow.
	async execute(toolCallId, params, signal, _onUpdate, ctx) {
		signal?.throwIfAborted();
		try {
			validateRecallFilter(params.filter);
			if (
				params.filter &&
				((params.expand?.length && !params.query) ||
					(params.query &&
						(parseEntryQuery(params.query) || parseCallQuery(params.query) || parseDrillDown(params.query))))
			)
				throw new Error(
					"Discovery filters do not apply to exact recovery; omit filter and use scope to select the source.",
				);
		} catch (error) {
			return {
				content: [{ type: "text", text: error instanceof Error ? error.message : "Invalid filter." }],
				details: undefined,
			};
		}
		if (params.page !== undefined && invalidPositiveInteger(params.page)) {
			return {
				content: [{ type: "text", text: "Invalid page: page must be a positive integer." }],
				details: undefined,
			};
		}
		if (
			params.expand !== undefined &&
			(!Array.isArray(params.expand) || params.expand.some((value) => !Number.isSafeInteger(value) || value < 0))
		) {
			return {
				content: [{ type: "text", text: "Invalid expand: every entry index must be a non-negative integer." }],
				details: undefined,
			};
		}

		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) {
			return {
				content: [{ type: "text", text: "No session file available." }],
				details: undefined,
			};
		}

		const rawScope = normalizeRecallScope(params.scope);
		const mode = normalizeRecallMode(params.mode);
		const scopeLabel = rawScope === "all" ? " (scope: all)" : "";
		const activeEntryIds = getActiveLineageEntryIds(ctx.sessionManager);
		const lineageEntryIds = rawScope === "lineage" ? activeEntryIds : undefined;
		const entryRequest = params.query ? parseEntryQuery(params.query) : undefined;
		if (entryRequest) {
			const { rendered, rawMessages } = loadAllMessages(sessionFile, true, lineageEntryIds);
			return {
				content: [{ type: "text", text: expandSourceEntry(rendered, entryRequest, rawMessages) }],
				details: undefined,
			};
		}
		const expandSet = new Set(params.expand ?? []);
		const hasExpand = expandSet.size > 0;
		const callId = params.query ? parseCallQuery(params.query) : undefined;
		if (callId) {
			const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
			return {
				content: [{ type: "text", text: expandToolCall(rawMessages, callId, rendered) }],
				details: undefined,
			};
		}

		const drillDown = params.query ? parseDrillDown(params.query) : undefined;
		if (drillDown) {
			const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
			return {
				content: [{ type: "text", text: expandEntryFile(rendered, rawMessages, drillDown) }],
				details: undefined,
			};
		}

		if (hasExpand && !params.query) {
			const { rendered: fullMsgs } = loadAllMessages(sessionFile, true, lineageEntryIds);
			const requested = [...expandSet];
			const byIndex = new Map(fullMsgs.filter((m) => m.index !== undefined).map((m) => [m.index!, m]));
			const invalid = invalidExpandIndices(requested, new Set(byIndex.keys()));
			if (invalid.length > 0) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot expand indices outside ${rawScope === "all" ? "session history" : "active lineage"}: ${invalid.join(", ")}`,
						},
					],
					details: undefined,
				};
			}

			const expanded = requested.map((i) => byIndex.get(i)).filter((m): m is NonNullable<typeof m> => Boolean(m));
			const output = `${rawScope === "all" ? "Scope: all\n" : ""}${formatRecallOutput(expanded)}`;
			return {
				content: [{ type: "text", text: output }],
				details: undefined,
			};
		}

		const loaded = loadAllMessages(sessionFile, false, lineageEntryIds, undefined, activeEntryIds);
		const eligible = loaded.rendered
			.map((entry, offset) => ({ entry, message: loaded.rawMessages[offset]! }))
			.filter(
				({ entry, message }) =>
					matchesRecallFilter(entry, message, params.filter) &&
					(!Array.isArray(message.content) ||
						!message.content.some((part) => part.type === "toolCall" && part.id === toolCallId)),
			);
		const msgs = eligible.map(({ entry }) => entry);
		const rawMessages = eligible.map(({ message }) => message);
		const interpretation = `Interpretation: ${params.query?.trim().startsWith("regex:") ? "explicit safe regex" : "literal terms (spelling variants; relevance-ranked)"}; scope:${rawScope}${params.filter ? `; filter:${JSON.stringify(params.filter)}` : ""}`;
		if (mode === "touched")
			return {
				content: [
					{
						type: "text",
						text: `${interpretation}\n${formatTouchedOutput(getTouchedFiles(rawMessages, msgs), params.page)}`,
					},
				],
				details: undefined,
			};
		let allResults: SearchHit[];
		try {
			allResults = params.query?.trim()
				? searchEntries(msgs, rawMessages, params.query, mode, signal)
				: msgs.slice(-DEFAULT_RECENT).map((entry, offset) => {
						const rawOffset = Math.max(0, rawMessages.length - DEFAULT_RECENT) + offset;
						const fileMatches = getFileIndicators(rawMessages[rawOffset]!);
						return fileMatches.length > 0 ? { ...entry, fileMatches } : entry;
					});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to evaluate search query.";
			return { content: [{ type: "text", text: message }], details: undefined };
		}

		if (params.query?.trim()) {
			const page = Math.max(1, params.page ?? 1);
			const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
			if (allResults.length > 0 && page > totalPages) {
				return {
					content: [
						{
							type: "text",
							text: `${interpretation}\nPage ${page} is beyond ${totalPages} pages (${allResults.length} ranked matches${scopeLabel}).`,
						},
					],
					details: undefined,
				};
			}
			const start = (page - 1) * PAGE_SIZE;
			const pageResults = allResults.slice(start, start + PAGE_SIZE) as SearchHit[];
			const header =
				totalPages > 1
					? `Page ${page}/${totalPages} (${allResults.length} total matches retained by relevance${scopeLabel})`
					: `${allResults.length} matches${scopeLabel}`;

			const expanded: number[] = [];
			if (hasExpand) {
				const msgByIndex = new Map<number, Message>();
				for (let i = 0; i < msgs.length; i++) {
					if (msgs[i].index !== undefined) msgByIndex.set(msgs[i].index!, rawMessages[i]);
				}
				for (const r of pageResults) {
					if (r.index === undefined || !expandSet.has(r.index)) continue;
					const raw = msgByIndex.get(r.index);
					if (!raw) continue;
					const full = renderMessage(raw, r.index, true);
					r.snippet = full.summary;
					r.summary = full.summary;
					expanded.push(r.index);
				}
			}

			const footerParts: string[] = [];
			if (page < totalPages) footerParts.push(`--- Use page:${page + 1} for more results ---`);
			if (hasExpand) {
				const notExpanded = [...expandSet].filter((i) => !expanded.includes(i));
				const noun = expanded.length === 1 ? "entry" : "entries";
				if (expanded.length > 0 && notExpanded.length === 0) {
					footerParts.push(`--- expanded ${expanded.length} ${noun} to full content ---`);
				} else if (expanded.length > 0) {
					footerParts.push(
						`--- expanded ${expanded.length} ${noun} to full content; not on this page: ${notExpanded.join(", ")} ---`,
					);
				} else if (notExpanded.length > 0) {
					footerParts.push(`--- no expand indices on this page: ${notExpanded.join(", ")} ---`);
				}
			}
			const footer = footerParts.length ? `\n${footerParts.join("\n")}` : "";
			return {
				content: [
					{
						type: "text",
						text: `${interpretation}\n${formatRecallOutput(pageResults, params.query, header)}${footer}`,
					},
				],
				details: {
					interpretation,
					total: allResults.length,
					totalPages,
					sources: pageResults.map(({ entryId, index, timestamp, sourceKind, lineage }) => ({
						entryId,
						index,
						timestamp,
						sourceKind,
						lineage,
					})),
				},
			};
		}

		const output = `${interpretation}\n${rawScope === "all" ? "Scope: all\n" : ""}${formatRecallOutput(allResults, params.query)}`;
		return {
			content: [{ type: "text", text: output }],
			details: undefined,
		};
	},
});

export const registerRecallTool = (pi: ExtensionAPI) => {
	pi.registerTool(sessionSearchTool);
};
