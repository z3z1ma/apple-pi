import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { loadAllMessages } from "../core/load-messages.js";
import { getFileIndicators, getTouchedFiles, searchEntries, type SearchHit } from "../core/search-entries.js";
import { formatRecallOutput, formatTouchedOutput } from "../core/format-recall.js";
import { getActiveLineageEntryIds } from "../core/lineage.js";
import { normalizeRecallMode, normalizeRecallScope } from "../core/recall-scope.js";
import { expandEntryFile, parseDrillDown } from "../core/drill-down.js";
import { renderMessage } from "../core/render-entries.js";
import type { Message } from "@earendil-works/pi-ai";

const DEFAULT_RECENT = 25;
const PAGE_SIZE = 5;

export const invalidExpandIndices = (requested: number[], available: Set<number>): number[] =>
	requested.filter((i) => !Number.isInteger(i) || !available.has(i));

/**
 * Read the session file, find compaction entries, and resolve the
 * message range for a given compaction index (0-based).
 *
 * The stored messageRange uses entry IDs ([firstId, lastId]).
 * This function resolves those IDs to global message indices
 * by scanning the session file.
 *
 * Returns [startIndex, endIndex] or undefined if not found.
 */
const resolveCompactionMessageRange = (sessionFile: string, scopeStr: string): [number, number] | undefined => {
	const isLatest = scopeStr === "compaction:latest";
	const targetIndex = isLatest ? -1 : parseInt(scopeStr.replace("compaction:", ""), 10);
	if (Number.isNaN(targetIndex) && !isLatest) return undefined;

	const content = readFileSync(sessionFile, "utf-8");
	const entries: any[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			/* skip malformed lines */
		}
	}

	// Collect pi-vcc compaction entries in order
	const compactions = entries.filter((e: any) => e.type === "compaction" && e.details?.compactor === "pi-vcc");

	if (compactions.length === 0) return undefined;

	const target = isLatest ? compactions[compactions.length - 1] : compactions[targetIndex];

	const msgRange = target?.details?.messageRange as [string, string] | undefined;
	if (!msgRange) return undefined;

	// Build entry-id → global-index map from the full session file
	const idToGlobal = new Map<string, number>();
	let globalIdx = 0;
	for (const e of entries) {
		if (e.type === "message" && e.message) {
			if (e.id) idToGlobal.set(e.id, globalIdx);
			globalIdx++;
		}
	}

	const firstIdx = idToGlobal.get(msgRange[0]);
	const lastIdx = idToGlobal.get(msgRange[1]);
	if (firstIdx === undefined || lastIdx === undefined) return undefined;

	return [firstIdx, lastIdx];
};

export const SESSION_SEARCH_TOOL_NAME = "session_search";

export const registerRecallTool = (pi: ExtensionAPI) => {
	pi.registerTool({
		name: SESSION_SEARCH_TOOL_NAME,
		label: "Session search",
		description:
			"Search this session's compacted conversation, tool calls, and write/edit payloads. " +
			"Use after compaction when you need prior decisions, earlier tool output, or a file version written in this session. " +
			"This is not git history and not a repository search. " +
			"Search text or regex, list files with mode:'touched', search only write/edit payloads with mode:'file', expand entries, or use query:'#N:path' to recover a written file. " +
			"Defaults to the active lineage; scope:'all' includes branches and scope:'compaction:N' targets one compacted segment.",
		promptSnippet:
			"session_search: Search this session's compacted transcript and file operations. " +
			"Use mode:'touched' for a file inventory, mode:'file' for payload-only search, query:'#N:path[:offset[:limit]|:full]' for write/edit content, scope:'all' for branches, and expand:[indices] for full entries.",
		promptGuidelines: [
			"Use session_search after compaction when you need prior work, decisions, tool output, or a file version from this session that is no longer in context.",
			"Use session_search with mode:'touched' to list files written or edited in this session, and query:'#N:path' to recover a specific write/edit payload.",
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
					description:
						"Search scope. Options: 'lineage' (default), 'all' (entire session), 'compaction:N' (within compaction #N), 'compaction:latest' (most recent compaction segment).",
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
			const scopeStr = String(params.scope ?? "").toLowerCase();
			const isCompactionScope = scopeStr.startsWith("compaction:");

			// Resolve compaction-scoped message range
			let entryFilter: ((idx: number) => boolean) | undefined;
			let scopeLabel = "";

			if (isCompactionScope) {
				const range = resolveCompactionMessageRange(sessionFile, scopeStr);
				if (!range) {
					return {
						content: [
							{
								type: "text",
								text: `No compaction found for scope: ${scopeStr}. Use scope:'lineage' (default) or scope:'all'.`,
							},
						],
						details: undefined,
					};
				}
				const [start, end] = range;
				entryFilter = (idx: number) => idx >= start && idx <= end;
				scopeLabel = ` (scope: ${scopeStr}, messages [#${start}, #${end}])`;
			}

			const lineageEntryIds = rawScope === "lineage" ? getActiveLineageEntryIds(ctx.sessionManager) : undefined;
			const expandSet = new Set(params.expand ?? []);
			const hasExpand = expandSet.size > 0;
			const drillDown = params.query ? parseDrillDown(params.query) : undefined;

			if (drillDown) {
				const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds, entryFilter);
				return {
					content: [{ type: "text", text: expandEntryFile(rendered, rawMessages, drillDown) }],
					details: undefined,
				};
			}

			if (mode === "touched") {
				const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds, entryFilter);
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
				const { rendered: fullMsgs } = loadAllMessages(sessionFile, true, lineageEntryIds, entryFilter);
				const requested = [...expandSet];
				const byIndex = new Map(fullMsgs.map((m) => [m.index, m]));
				const invalid = invalidExpandIndices(requested, new Set(byIndex.keys()));
				if (invalid.length > 0) {
					return {
						content: [
							{
								type: "text",
								text: `Cannot expand indices outside ${rawScope === "all" ? "session history" : "active lineage"}${scopeLabel}: ${invalid.join(", ")}`,
							},
						],
						details: undefined,
					};
				}

				const expanded = requested.map((i) => byIndex.get(i)).filter((m): m is NonNullable<typeof m> => Boolean(m));
				const output = `${scopeLabel || (rawScope === "all" ? "Scope: all" : "")}\n${formatRecallOutput(expanded)}`;
				return {
					content: [{ type: "text", text: output }],
					details: undefined,
				};
			}

			const { rendered: msgs, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds, entryFilter);
			const allResults = params.query?.trim()
				? searchEntries(msgs, rawMessages, params.query, mode)
				: msgs.slice(-DEFAULT_RECENT).map((entry, offset) => {
						const rawOffset = Math.max(0, rawMessages.length - DEFAULT_RECENT) + offset;
						const fileMatches = getFileIndicators(rawMessages[rawOffset]!);
						return fileMatches.length > 0 ? { ...entry, fileMatches } : entry;
					});

			if (params.query?.trim()) {
				const searchScopeLabel = scopeLabel || (rawScope === "all" ? " (scope: all)" : "");
				const page = Math.max(1, params.page ?? 1);
				const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
				// Cap pages: don't let the agent page through hundreds of results.
				// If totalPages is too large, suggest narrowing the query instead.
				const MAX_PAGES = 5;
				if (allResults.length > 0 && page > Math.min(totalPages, MAX_PAGES)) {
					return {
						content: [
							{
								type: "text",
								text: `Too many results to page through (${allResults.length} matches across ${totalPages} pages). Try a more specific query or use scope:'compaction:N' to narrow the range${searchScopeLabel}.`,
							},
						],
						details: undefined,
					};
				}
				const start = (page - 1) * PAGE_SIZE;
				const pageResults = allResults.slice(start, start + PAGE_SIZE) as SearchHit[];
				const header =
					totalPages > 1
						? `Page ${page}/${totalPages} (${allResults.length} total matches${searchScopeLabel})`
						: `${allResults.length} matches${searchScopeLabel}`;

				// Compose: when expand indices accompany a query, swap the truncated
				// snippet for full untruncated content on any paged result whose
				// index is in expandSet. rawMessages (loaded above with full=false)
				// are parallel to `msgs`, so we re-render only the requested
				// indices at full=true instead of re-reading the session file.
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
						// formatEntry prefers `snippet` for matched entries; set both
						// so the full content renders regardless of match state.
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
				const output = formatRecallOutput(pageResults, params.query, header) + footer;
				return {
					content: [{ type: "text", text: output }],
					details: undefined,
				};
			}

			const output = `${scopeLabel || (rawScope === "all" ? "Scope: all" : "")}\n${formatRecallOutput(allResults, params.query)}`;
			return {
				content: [{ type: "text", text: output }],
				details: undefined,
			};
		},
	});
};
