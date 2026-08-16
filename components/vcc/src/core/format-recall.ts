import type { FileMatch, SearchHit, TouchedFile } from "./search-entries.js";

// Roles that start a new conversation segment (turn).
// A segment begins at a user or bashExecution (user-initiated action)
// and continues through assistant responses, tool calls, and tool results
// until the next user/bash boundary.
const SEGMENT_START_ROLES = new Set(["user", "bash"]);

/**
 * A segment is a contiguous group of entries forming one conversational turn:
 * a user/assistant message followed by its associated tool calls, tool results,
 * and bash executions. The next user/assistant message starts a new segment.
 */
interface RecallSegment {
	/** Entry indices covered by this segment (e.g. "#42-#47") */
	range: string;
	/** All entries in this segment, in order */
	entries: SearchHit[];
	/** Which entries within this segment matched the query */
	matchedIndices: Set<number>;
}

/**
 * Group entries into conversation segments (turns).
 *
 * A segment starts at a user or assistant message and includes all
 * subsequent tool calls, tool results, and bash executions until
 * the next user/assistant boundary.
 *
 * When entries lack explicit `snippet` markers (e.g. called from
 * external code or tests), all entries in query mode are treated
 * as matched.
 */
const groupSegments = (entries: SearchHit[], hasQuery: boolean): RecallSegment[] => {
	if (entries.length === 0) return [];

	// Detect whether entries have snippet markers set.
	// If none do but we have a query, treat the entire set as matched.
	const anySnippet = entries.some((e) => e.snippet !== undefined);
	const assumeAllMatched = hasQuery && !anySnippet;

	const segments: RecallSegment[] = [];
	let start = 0;

	for (let i = 1; i < entries.length; i++) {
		const role = entries[i].role;
		if (SEGMENT_START_ROLES.has(role)) {
			const slice = entries.slice(start, i);
			const matched = new Set<number>();
			for (let j = 0; j < slice.length; j++) {
				if (assumeAllMatched || slice[j].snippet) matched.add(j);
			}
			segments.push({
				range: `#${slice[0].index}` + (slice.length > 1 ? `-#${slice[slice.length - 1].index}` : ""),
				entries: slice,
				matchedIndices: matched,
			});
			start = i;
		}
	}

	// Last segment
	const slice = entries.slice(start);
	if (slice.length > 0) {
		const matched = new Set<number>();
		for (let j = 0; j < slice.length; j++) {
			if (assumeAllMatched || slice[j].snippet) matched.add(j);
		}
		segments.push({
			range: `#${slice[0].index}` + (slice.length > 1 ? `-#${slice[slice.length - 1].index}` : ""),
			entries: slice,
			matchedIndices: matched,
		});
	}

	return segments;
};

const shortPath = (path: string): string => {
	const normalized = path.replace(/\\/g, "/");
	const cwd = process.cwd().replace(/\\/g, "/");
	if (normalized.startsWith(cwd + "/")) return "." + normalized.slice(cwd.length);
	const parts = normalized.split("/");
	return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : normalized;
};

const formatFileMatch = (match: FileMatch, index: number, query: boolean): string => {
	const unit = query ? (match.lineCount === 1 ? "match" : "matches") : match.lineCount === 1 ? "line" : "lines";
	const snippet = match.snippet ? `\n    | ${match.snippet}` : "";
	return `  [${match.toolName}] ${shortPath(match.path)} — ${match.lineCount} ${unit}    use #${index}:${match.path}${snippet}`;
};

/** Format a single entry line with optional match indicator. */
const formatEntry = (e: SearchHit, matched: boolean): string => {
	const prefix = matched ? ">" : " ";
	const fileSuffix = e.files?.length ? ` files:[${e.files.join(", ")}]` : "";
	const body = matched && e.snippet ? e.snippet : e.summary;
	const fileMatches = e.fileMatches?.slice(0, 3) ?? [];
	const indicators = fileMatches.map((match) => formatFileMatch(match, e.index, matched)).join("\n");
	const omitted = (e.fileMatches?.length ?? 0) - fileMatches.length;
	return (
		`${prefix} #${e.index} [${e.role}]${fileSuffix} ${body}` +
		(indicators ? `\n${indicators}` : "") +
		(omitted > 0 ? `\n  ...(${omitted} more file matches)` : "")
	);
};

/** Format a segment with its entries. */
const formatSegment = (seg: RecallSegment): string => {
	const lines: string[] = [];

	// Segment header with match count
	const matchCount = seg.matchedIndices.size;
	if (matchCount > 0 && matchCount < seg.entries.length) {
		lines.push(`--- ${seg.range} (${matchCount}/${seg.entries.length} entries match) ---`);
	} else if (matchCount > 0) {
		lines.push(`--- ${seg.range} ---`);
	} else {
		lines.push(`--- ${seg.range} (context) ---`);
	}

	for (let i = 0; i < seg.entries.length; i++) {
		const matched = seg.matchedIndices.has(i);
		lines.push(formatEntry(seg.entries[i], matched));
	}

	return lines.join("\n");
};

/** Count total unique matches across all segments. */
const countMatches = (segments: RecallSegment[]): number => {
	let total = 0;
	for (const seg of segments) {
		total += seg.matchedIndices.size;
	}
	return total;
};

export const formatTouchedOutput = (touched: TouchedFile[], page = 1, pageSize = 5): string => {
	if (touched.length === 0) return "No file operations found in session history.";
	const currentPage = Math.max(1, page);
	const totalPages = Math.ceil(touched.length / pageSize);
	const files = touched.slice((currentPage - 1) * pageSize, currentPage * pageSize);
	const header =
		totalPages > 1
			? `Page ${currentPage}/${totalPages} (${touched.length} total files)`
			: `${touched.length} files touched`;
	const rows = files.map(
		(file) =>
			`  ${shortPath(file.path)}    ${file.entries.map((entry) => `#${entry.index} (${entry.toolName})`).join(", ")}`,
	);
	const next =
		currentPage < totalPages ? `\n\n--- Use mode:'touched', page:${currentPage + 1} for more results ---` : "";
	return `${header}:\n\n${rows.join("\n")}${next}`;
};

export const formatRecallOutput = (entries: SearchHit[], query?: string, headerOverride?: string): string => {
	if (entries.length === 0) {
		return query ? `No matches for "${query}" in session history.` : "No entries in session history.";
	}

	// Browse mode (no query): keep flat format, no structure needed
	if (!query) {
		const header = headerOverride || `Session history (${entries.length} entries):`;
		const lines = entries.map((entry) => formatEntry(entry, false).trimStart());
		return `${header}\n\n${lines.join("\n\n")}`;
	}

	// Search mode: group into structure-preserving segments
	const header = headerOverride
		? `${headerOverride} for "${query}":`
		: `Found ${entries.length} matches for "${query}":`;

	const segments = groupSegments(entries, true);
	const matchedCount = countMatches(segments);

	const prefix =
		segments.length > 1
			? `${matchedCount} matches across ${segments.length} segments`
			: `${matchedCount} matches in 1 segment`;

	const formatted = segments.filter((seg) => seg.matchedIndices.size > 0).map(formatSegment);

	// Add adjacent non-matching segments as context around the first
	// matched segment (so the agent sees the conversation flow).
	if (segments.length > 1) {
		const firstMatchIdx = segments.findIndex((s) => s.matchedIndices.size > 0);
		if (firstMatchIdx >= 0) {
			// Show the segment before for context (only if it has no matches itself)
			if (firstMatchIdx > 0 && segments[firstMatchIdx - 1].matchedIndices.size === 0) {
				formatted.unshift(formatSegment(segments[firstMatchIdx - 1]));
			}
			// Show the segment after for context (only if not already shown)
			if (firstMatchIdx < segments.length - 1) {
				const next = segments[firstMatchIdx + 1];
				if (next.matchedIndices.size === 0) {
					formatted.push(formatSegment(next));
				}
			}
		}
	}

	return `${header} \u2014 ${prefix}\n\n${formatted.join("\n\n")}`;
};
