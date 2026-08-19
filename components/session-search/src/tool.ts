import type { Message } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expandEntryFile, expandToolCall, parseCallQuery, parseDrillDown } from "./drill-down.js";
import { formatRecallOutput, formatTouchedOutput } from "./format-recall.js";
import { getActiveLineageEntryIds } from "./lineage.js";
import { loadAllMessages } from "./load-messages.js";
import { normalizeRecallMode, normalizeRecallScope } from "./recall-scope.js";
import { renderMessage } from "./render-entries.js";
import { getFileIndicators, getTouchedFiles, type SearchHit, searchEntries } from "./search-entries.js";

const DEFAULT_RECENT = 25;
const PAGE_SIZE = 5;
const MAX_PAGES = 5;

export const invalidExpandIndices = (requested: number[], available: Set<number>): number[] =>
	requested.filter((i) => !Number.isInteger(i) || !available.has(i));

export const SESSION_SEARCH_TOOL_NAME = "session_search";

export const sessionSearchTool = defineTool({
	name: SESSION_SEARCH_TOOL_NAME,
	label: "Session search",
	description:
		"Search this session's compacted conversation, tool calls, and write/edit payloads. " +
		"Use after compaction when you need prior decisions, earlier tool output, or a file version written in this session. " +
		"This is not git history and not a repository search. " +
		"Search text or regex, list files with mode:'touched', search only write/edit payloads with mode:'file', expand entries, use query:'#N:path' to recover a written file, or query:'call:<id>' to recover a persisted tool-result body. " +
		"Defaults to the active lineage; scope:'all' includes branches.",
	promptSnippet:
		"session_search: Search this session's compacted transcript and file operations. " +
		"Use mode:'touched' for a file inventory, mode:'file' for payload-only search, query:'#N:path[:offset[:limit]|:full]' for write/edit content, query:'call:<toolCallId>' for an omitted tool-result body, scope:'all' for branches, and expand:[indices] for full entries.",
	promptGuidelines: [
		"Use session_search after compaction when you need prior work, decisions, tool output, or a file version from this session that is no longer in context.",
		"Use session_search with mode:'touched' to list files written or edited in this session, and query:'#N:path' to recover a specific write/edit payload.",
		"Use session_search query 'call:<toolCallId>' to recover a persisted tool-result body by the call: address on advisor receipts.",
		"Use session_search with a text or regex query to find earlier conversation or tool results; multi-word queries are OR-ranked.",
		"Do not use session_search to search the repository — use grep, find, or read for current files.",
		"Do not use session_search as a memory-id lookup. It searches the session transcript, not compacted observation or reflection ids.",
	],
	parameters: Type.Object({
		query: Type.Optional(
			Type.String({
				description:
					"Search terms or regex pattern (e.g. 'hook|inject', 'fail.*build'). Multi-word = OR ranked by relevance.",
			}),
		),
		expand: Type.Optional(
			Type.Array(Type.Number(), {
				description:
					"Entry indices to return full untruncated content for. Works alone (any index in scope) or alongside query (expands matching entries on the current page).",
			}),
		),
		page: Type.Optional(
			Type.Number({ description: "Page number (1-based) for paginated search results. Default: 1." }),
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
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
		const lineageEntryIds = rawScope === "lineage" ? getActiveLineageEntryIds(ctx.sessionManager) : undefined;
		const expandSet = new Set(params.expand ?? []);
		const hasExpand = expandSet.size > 0;
		const callId = params.query ? parseCallQuery(params.query) : undefined;
		if (callId) {
			const { rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
			return {
				content: [{ type: "text", text: expandToolCall(rawMessages, callId) }],
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

		if (mode === "touched") {
			const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
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
			const byIndex = new Map(fullMsgs.map((m) => [m.index, m]));
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

		const { rendered: msgs, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);
		const allResults = params.query?.trim()
			? searchEntries(msgs, rawMessages, params.query, mode)
			: msgs.slice(-DEFAULT_RECENT).map((entry, offset) => {
					const rawOffset = Math.max(0, rawMessages.length - DEFAULT_RECENT) + offset;
					const fileMatches = getFileIndicators(rawMessages[rawOffset]!);
					return fileMatches.length > 0 ? { ...entry, fileMatches } : entry;
				});

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
					msgByIndex.set(msgs[i].index, rawMessages[i]);
				}
				for (const r of pageResults) {
					if (!expandSet.has(r.index)) continue;
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
				details: undefined,
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
