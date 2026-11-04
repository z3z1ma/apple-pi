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
import { RecallRefusal, readQualifiedEntry, searchIndexedHistory } from "./indexed-recall.js";
import { getActiveLineageEntryIds } from "./lineage.js";
import { loadAllMessages } from "./load-messages.js";
import { normalizeRecallMode, normalizeRecallScope } from "./recall-scope.js";
import { renderMessage } from "./render-entries.js";
import { getFileIndicators, getTouchedFiles, looksLikeRegex, type SearchHit, searchEntries } from "./search-entries.js";

const DEFAULT_RECENT = 25;
const PAGE_SIZE = 5;
const MAX_PAGES = 5;

export const invalidExpandIndices = (requested: number[], available: Set<number>): number[] =>
	requested.filter((i) => !Number.isSafeInteger(i) || i < 0 || !available.has(i));

const invalidPositiveInteger = (value: unknown): boolean =>
	typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0;

const loadDiscoveryMessages = (
	sessionFile: string,
	lineageEntryIds: Set<string> | undefined,
	activeEntryIds: Set<string>,
	toolCallId: string,
) => {
	const loaded = loadAllMessages(sessionFile, false, lineageEntryIds, undefined, activeEntryIds);
	const eligible = loaded.rendered
		.map((entry, offset) => ({ entry, message: loaded.rawMessages[offset]! }))
		.filter(
			({ message }) =>
				message.role !== "assistant" ||
				!Array.isArray(message.content) ||
				!message.content.some(
					(part) => part.type === "toolCall" && (part.id === toolCallId || toolCallId.startsWith(`${part.id}/`)),
				),
		);
	return {
		rendered: eligible.map(({ entry }) => entry),
		rawMessages: eligible.map(({ message }) => message),
	};
};

export const SESSION_SEARCH_TOOL_NAME = "search_session";

export const sessionSearchTool = defineTool({
	name: SESSION_SEARCH_TOOL_NAME,
	label: "Session search",
	description:
		"Search this session's earlier conversation, tool calls and write/edit payloads (not git history or the repository), including before compaction. " +
		"Search text or regex, list touched files, or search only write/edit payloads. " +
		"Recover exactly with query:'#N:path' (a written file), 'call:<id>' (an omitted tool result) or 'entry:<id>[:offset[:limit]]' (any source; zero-based lines; another person's as entry:<session>/<id>). " +
		"scope:'all' includes other branches; tasks:[id] searches what people wrote while focused on those tasks (words, not regex).",
	parameters: Type.Object({
		tasks: Type.Optional(
			Type.Array(Type.String({ minLength: 1 }), {
				description:
					"Search these tasks' focus spans across their workers. Requires task access. History queries match words, not regex patterns; punctuation is ignored. A span means written while focused, not necessarily about the task.",
			}),
		),
		fields: Type.Optional(
			Type.Union([Type.Literal("words"), Type.Literal("all")], {
				description:
					"Indexed discovery: words searches written text, thinking, mail and summaries; all (default) also searches tool calls and results.",
			}),
		),
		query: Type.Optional(
			Type.String({
				description:
					"Search text or regex (e.g. 'hook|inject'); multi-word terms are OR-ranked. Recover written content with '#N:path[:offset[:limit]|:full]', or an omitted tool result with 'call:<toolCallId>' from a pair receipt.",
			}),
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
		const callId = params.query ? parseCallQuery(params.query) : undefined;
		const drillDown = params.query ? parseDrillDown(params.query) : undefined;
		if (entryRequest?.id.includes("/")) {
			try {
				const caller = ctx.sessionManager.getSessionId();
				const slash = entryRequest.id.indexOf("/");
				if (
					entryRequest.id.slice(0, slash) === caller &&
					rawScope === "lineage" &&
					!activeEntryIds.has(entryRequest.id.slice(slash + 1))
				)
					return { content: [{ type: "text", text: expandSourceEntry([], entryRequest) }], details: undefined };
				return {
					content: [{ type: "text", text: await readQualifiedEntry(entryRequest, caller, signal) }],
					details: undefined,
				};
			} catch (error) {
				const message = `Cannot read qualified transcript source: ${error instanceof Error ? error.message : String(error)}`;
				if (error instanceof RecallRefusal) return { content: [{ type: "text", text: message }], details: undefined };
				throw new Error(message, { cause: error });
			}
		}
		const indexedQuery =
			params.query?.trim() &&
			mode === "history" &&
			params.expand === undefined &&
			!entryRequest &&
			!callId &&
			!drillDown &&
			(params.tasks?.length || !looksLikeRegex(params.query.trim()));
		if (params.tasks?.length && !indexedQuery) {
			return {
				content: [
					{
						type: "text",
						text: "Task search matches words through the index. Supply a history query or a qualified entry:<session>/<id> source; file, touched, local exact addresses and numeric expansion keep the personal engine.",
					},
				],
				details: undefined,
			};
		}
		if (indexedQuery) {
			try {
				const result = await searchIndexedHistory({
					query: params.query!.trim(),
					toolCallId,
					caller: ctx.sessionManager.getSessionId(),
					entries: ctx.sessionManager.getEntries(),
					activeEntryIds,
					scope: rawScope,
					tasks: params.tasks,
					fields: params.fields,
					page: params.page ?? 1,
					pageSize: PAGE_SIZE,
					maxPages: MAX_PAGES,
					signal,
				});
				return { content: [{ type: "text", text: result.text }], details: { sources: result.sources } };
			} catch (error) {
				if (error instanceof RecallRefusal)
					return { content: [{ type: "text", text: error.message }], details: undefined };
				throw new Error(
					`Indexed session search failed: ${error instanceof Error ? error.message : String(error)}. No personal-engine fallback was used.`,
					{ cause: error },
				);
			}
		}
		if (entryRequest) {
			const { rendered } = loadAllMessages(sessionFile, true, lineageEntryIds);
			return { content: [{ type: "text", text: expandSourceEntry(rendered, entryRequest) }], details: undefined };
		}
		const expandSet = new Set(params.expand ?? []);
		const hasExpand = expandSet.size > 0;
		if (callId) {
			const { rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
			return {
				content: [{ type: "text", text: expandToolCall(rawMessages, callId) }],
				details: undefined,
			};
		}

		if (drillDown) {
			const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
			return {
				content: [{ type: "text", text: expandEntryFile(rendered, rawMessages, drillDown) }],
				details: undefined,
			};
		}

		if (mode === "touched") {
			const { rendered, rawMessages } = loadDiscoveryMessages(sessionFile, lineageEntryIds, activeEntryIds, toolCallId);
			return {
				content: [
					{
						type: "text",
						text: formatTouchedOutput(getTouchedFiles(rawMessages, rendered), params.page),
					},
				],
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

		const { rendered: msgs, rawMessages } = loadDiscoveryMessages(
			sessionFile,
			lineageEntryIds,
			activeEntryIds,
			toolCallId,
		);
		let allResults: SearchHit[];
		try {
			allResults = params.query?.trim()
				? searchEntries(msgs, rawMessages, params.query, mode)
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
			if (allResults.length > 0 && page > Math.min(totalPages, MAX_PAGES)) {
				return {
					content: [
						{
							type: "text",
							text: `Too many results to page through (${allResults.length} matches across ${totalPages} pages). Try a more specific query${scopeLabel}.`,
						},
					],
					details: undefined,
				};
			}
			const start = (page - 1) * PAGE_SIZE;
			const pageResults = allResults.slice(start, start + PAGE_SIZE) as SearchHit[];
			const header =
				totalPages > 1
					? `Page ${page}/${totalPages} (${allResults.length} total matches${scopeLabel})`
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
			if (page < totalPages && page < MAX_PAGES) {
				footerParts.push(`--- Use page:${page + 1} for more results ---`);
			} else if (totalPages > MAX_PAGES) {
				footerParts.push(
					`--- Results truncated at ${MAX_PAGES} pages. Use a more specific query or scope to narrow results. ---`,
				);
			}
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
				content: [{ type: "text", text: formatRecallOutput(pageResults, params.query, header) + footer }],
				details: {
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

		const output = `${rawScope === "all" ? "Scope: all\n" : ""}${formatRecallOutput(allResults, params.query)}`;
		return {
			content: [{ type: "text", text: output }],
			details: undefined,
		};
	},
});

export const registerRecallTool = (pi: ExtensionAPI) => {
	pi.registerTool(sessionSearchTool);
};
