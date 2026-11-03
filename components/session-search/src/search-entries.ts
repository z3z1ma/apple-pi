import type { Message } from "@earendil-works/pi-ai";
import { contentBearingText, isContentBearing, textOf, thinkingOf, toolCallsOf } from "./content.js";
import { executionArgsText, executionOperationsOf, executionResultText } from "./execution-trace.js";
import type { RecallMode } from "./recall-scope.js";
import type { RenderedEntry } from "./render-entries.js";
import { extractPath } from "./tool-args.js";

export interface FileMatch {
	toolName: string;
	path: string;
	lineCount: number;
	snippet?: string;
}

export interface TouchedFile {
	path: string;
	entries: Array<{ index: number; toolName: string }>;
}

export interface SearchHit extends RenderedEntry {
	recallEcho?: boolean;
	turnId?: number | string;
	snippet?: string;
	matchCount?: number;
	fileMatches?: FileMatch[];
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SUFFIX_VARIANT_PAIRS: [RegExp, string][] = [
	[/isation$/i, "i[sz]ation"],
	[/ization$/i, "i[sz]ation"],
	[/yse$/i, "y[zs]e"],
	[/yze$/i, "y[zs]e"],
	[/our$/i, "(?:our|or)"],
	[/or$/i, "(?:our|or)"],
	[/ise$/i, "i[zs]e"],
	[/ize$/i, "i[zs]e"],
	[/ogue$/i, "og(?:ue)?"],
	[/mme$/i, "m(?:me)?"],
	[/ence$/i, "en[cs]e"],
	[/ense$/i, "en[cs]e"],
];

const expandSpellingVariants = (term: string): string => {
	if (/[|*+?{}()[\]\\^$.]/.test(term)) return term;
	if (term.length < 4) return term;

	for (const [suffix, replacement] of SUFFIX_VARIANT_PAIRS) {
		if (suffix.test(term)) {
			const base = term.replace(suffix, "");
			return escapeRegex(base) + replacement;
		}
	}
	return term;
};

const MAX_REGEX_SOURCE_LEN = 256;
const MAX_WILDCARD_CHARS = 256;

export class UnsafeSearchRegexError extends Error {
	constructor(reason: string) {
		super(`Unsafe regex query: ${reason}. Use literal terms or a simple pattern with at most one .* wildcard.`);
		this.name = "UnsafeSearchRegexError";
	}
}

const safeRegex = (pattern: string): RegExp => {
	if (pattern.length > MAX_REGEX_SOURCE_LEN) {
		throw new UnsafeSearchRegexError(`pattern exceeds ${MAX_REGEX_SOURCE_LEN} characters`);
	}
	try {
		new RegExp(pattern);
	} catch {
		return new RegExp(escapeRegex(pattern), "i");
	}
	if (/[()]/.test(pattern)) {
		throw new UnsafeSearchRegexError("grouped patterns are not supported");
	}

	let source = "";
	let wildcardCount = 0;
	let inClass = false;
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i]!;
		if (char === "\\") {
			source += char + (pattern[++i] ?? "");
			continue;
		}
		if (char === "[") inClass = true;
		if (char === "]") inClass = false;
		if (!inClass && (char === "+" || char === "?" || char === "{" || char === "}")) {
			throw new UnsafeSearchRegexError("quantifiers other than .* are not supported");
		}
		if (!inClass && char === "*") {
			if (pattern[i - 1] !== "." || ++wildcardCount > 1) {
				throw new UnsafeSearchRegexError("only one .* wildcard is supported");
			}
			source += `{0,${MAX_WILDCARD_CHARS}}`;
			continue;
		}
		source += char;
	}
	try {
		return new RegExp(source, "i");
	} catch {
		return new RegExp(escapeRegex(pattern), "i");
	}
};

export const looksLikeRegex = (query: string): boolean => /[|*+?{}()[\]\\^$.]/.test(query);

const compileTerms = (terms: string[]): Map<string, RegExp> => {
	const cache = new Map<string, RegExp>();
	for (const t of terms) {
		const expanded = expandSpellingVariants(t);
		const source = expanded.length > MAX_REGEX_SOURCE_LEN ? escapeRegex(expanded.slice(0, 64)) : expanded;
		try {
			cache.set(t, new RegExp(source, "gi"));
		} catch {
			cache.set(t, new RegExp(escapeRegex(t), "gi"));
		}
	}
	return cache;
};

const reTest = (re: RegExp, hay: string): boolean => {
	re.lastIndex = 0;
	return re.test(hay);
};

const snippetRegex = (terms: string[], termCache: Map<string, RegExp>): RegExp => {
	const alts = terms.map((t) => {
		const re = termCache.get(t);
		return re ? re.source : escapeRegex(t);
	});
	return new RegExp(alts.join("|"), "i");
};

const STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"can",
	"shall",
	"of",
	"in",
	"to",
	"for",
	"with",
	"on",
	"at",
	"from",
	"by",
	"as",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"between",
	"out",
	"off",
	"over",
	"under",
	"again",
	"further",
	"then",
	"once",
	"here",
	"there",
	"when",
	"where",
	"why",
	"how",
	"all",
	"both",
	"each",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"nor",
	"not",
	"only",
	"own",
	"same",
	"so",
	"than",
	"too",
	"very",
	"just",
	"about",
	"it",
	"its",
	"that",
	"this",
	"what",
	"which",
	"who",
	"whom",
	"these",
	"those",
]);

export const filterStopwords = (terms: string[]): string[] => {
	const meaningful = terms.filter((t) => !STOPWORDS.has(t.toLowerCase()) && t.length > 1);
	return meaningful.length > 0 ? meaningful : terms;
};

const countMatches = (hay: string, termCache: Map<string, RegExp>): number => {
	let count = 0;
	for (const re of termCache.values()) {
		if (reTest(re, hay)) count++;
	}
	return count;
};

const BM25_K = 1.2;
const BM25_B = 0.75;

const MAX_SEARCH_RESULTS = 50;

const MIN_SCORE_RATIO = 0.1;

const MIN_TERM_MATCH_FOR_MULTITERM = 2;

const termFreq = (text: string, pattern: RegExp): number => {
	let count = 0;
	for (const _ of text.matchAll(pattern)) count++;
	return count;
};

interface BM25Context {
	n: number;
	avgDl: number;
	df: Map<string, number>;
}

const buildBM25Context = (docs: string[], termCache: Map<string, RegExp>): BM25Context => {
	const n = docs.length;
	const df = new Map<string, number>();
	let totalLen = 0;

	for (const doc of docs) {
		totalLen += doc.split(/\s+/).length;
		for (const [t, re] of termCache) {
			if (reTest(re, doc)) {
				df.set(t, (df.get(t) ?? 0) + 1);
			}
		}
	}

	return { n, avgDl: totalLen / Math.max(n, 1), df };
};

const bm25Score = (doc: string, termCache: Map<string, RegExp>, ctx: BM25Context): number => {
	const dl = doc.split(/\s+/).length;
	let score = 0;

	for (const [t, re] of termCache) {
		const tf = termFreq(doc, re);
		if (tf === 0) continue;

		const docFreq = ctx.df.get(t) ?? 0;
		const idf = Math.log((ctx.n - docFreq + 0.5) / (docFreq + 0.5) + 1);
		const tfNorm = (tf * (BM25_K + 1)) / (tf + BM25_K * (1 - BM25_B + (BM25_B * dl) / ctx.avgDl));
		score += idf * tfNorm;
	}

	return score;
};

interface SearchText {
	text: string;
	sections: Array<{ line: number; label: string }>;
}

const lineSnippet = (
	document: SearchText,
	regex: RegExp,
	contextLines = 2,
	terms?: Map<string, RegExp>,
): string | undefined => {
	const lines = document.text.split("\n");
	let matchIdx = -1;
	let bestCoverage = -1;
	for (let i = 0; i < lines.length; i++) {
		if (!reTest(regex, lines[i]!)) continue;
		const window = lines.slice(Math.max(0, i - contextLines), i + contextLines + 1).join("\n");
		const coverage = terms ? countMatches(window, terms) : 1;
		if (coverage > bestCoverage) {
			matchIdx = i;
			bestCoverage = coverage;
		}
	}
	if (matchIdx === -1) return undefined;
	const start = Math.max(0, matchIdx - contextLines);
	const end = Math.min(lines.length, matchIdx + contextLines + 1);
	const parts: string[] = [];
	if (start > 0) {
		parts.push(`...(${start} lines above)`);
		const section = document.sections.findLast((section) => section.line < start);
		if (section) parts.push(section.label);
	}
	parts.push(...lines.slice(start, end));
	if (end < lines.length) parts.push(`...(${lines.length - end} lines below)`);
	return parts.join("\n");
};

interface FileOperation {
	toolName: string;
	path: string;
	args: Record<string, unknown>;
}

export const fileOperationsOf = (msg: Message): FileOperation[] => {
	const operations: FileOperation[] = [];
	if (Array.isArray(msg.content)) {
		for (const part of msg.content) {
			if (part.type !== "toolCall" || !isContentBearing(part.arguments)) continue;
			const path = extractPath(part.arguments);
			if (path) operations.push({ toolName: part.name, path, args: part.arguments });
		}
	}
	if (msg.role === "toolResult") {
		for (const operation of executionOperationsOf((msg as any).details)) {
			if (!isContentBearing(operation.args)) continue;
			const path = extractPath(operation.args);
			if (path) operations.push({ toolName: operation.name, path, args: operation.args });
		}
	}
	return operations;
};

export const getFileIndicators = (msg: Message): FileMatch[] =>
	fileOperationsOf(msg).map((operation) => ({
		toolName: operation.toolName,
		path: operation.path,
		lineCount: contentBearingText(operation.args)
			.split("\n")
			.filter((line) => line.trim().length > 0).length,
	}));

export const getTouchedFiles = (messages: Message[], rendered: RenderedEntry[]): TouchedFile[] => {
	const touched = new Map<string, TouchedFile>();
	for (let offset = 0; offset < messages.length; offset++) {
		for (const operation of fileOperationsOf(messages[offset]!)) {
			if (rendered[offset]?.index === undefined) continue;
			const entry = touched.get(operation.path) ?? { path: operation.path, entries: [] };
			entry.entries.push({
				index: rendered[offset]?.index ?? offset,
				toolName: operation.toolName,
			});
			touched.set(operation.path, entry);
		}
	}
	return [...touched.values()];
};

const matchingFiles = (msg: Message | undefined, regex: RegExp): FileMatch[] => {
	if (!msg) return [];
	const matches: FileMatch[] = [];
	for (const operation of fileOperationsOf(msg)) {
		const lines = contentBearingText(operation.args).split("\n");
		const matching = lines.filter((line) => regex.test(line));
		if (matching.length === 0) continue;
		matches.push({
			toolName: operation.toolName,
			path: operation.path,
			lineCount: matching.length,
			snippet: matching[0],
		});
	}
	return matches;
};

const fullText = (msg: Message, mode: RecallMode): SearchText => {
	if ((msg as any).role === "bashExecution") {
		return { text: mode === "file" ? "" : `${(msg as any).command ?? ""} ${(msg as any).output ?? ""}`, sections: [] };
	}
	const fileText = fileOperationsOf(msg)
		.flatMap((operation) => [operation.path, contentBearingText(operation.args)])
		.join("\n");
	if (mode === "file") return { text: fileText, sections: [] };

	const sections: SearchText["sections"] = [];
	const parts: string[] = [];
	let nextLine = 0;
	const append = (body: string, label?: string) => {
		if (label) sections.push({ line: nextLine, label });
		const part = label ? `${label}\n${body}` : body;
		parts.push(part);
		nextLine += part.split("\n").length;
	};
	if (Array.isArray(msg.content)) {
		for (const part of msg.content) {
			if (part.type === "toolCall") append(toolCallsOf([part]), `[attempted ${part.name} call:${part.id}]`);
		}
	}
	const thinking = thinkingOf(msg.content);
	if (thinking) append(thinking, "[thinking]");
	const text = textOf(msg.content);
	append(
		text,
		msg.role === "toolResult"
			? `[${msg.isError ? "failed" : "returned"} ${msg.toolName} call:${msg.toolCallId}]`
			: msg.role === "assistant" && text
				? "[assistant text]"
				: undefined,
	);
	if (msg.role === "toolResult") {
		for (const operation of executionOperationsOf((msg as any).details)) {
			append(
				[executionArgsText(operation), executionResultText(operation)].filter(Boolean).join("\n"),
				`[nested ${operation.ref} ${operation.outcome}]`,
			);
		}
	}
	return { text: parts.join("\n"), sections };
};

export const describeSearchHit = (
	entry: RenderedEntry,
	message: Message,
	query: string,
	indexedSnippet?: string,
): SearchHit => {
	const terms = filterStopwords(query.trim().split(/\s+/));
	const cache = compileTerms(terms);
	const regex = snippetRegex(terms, cache);
	const document = fullText(message, "history");
	let snippet = lineSnippet(document, regex, 2, cache);
	if (!snippet && indexedSnippet) {
		const matched = [...indexedSnippet.matchAll(/\u00ab([^\u00ab\u00bb]+)\u00bb/g)].map((match) => match[1]!);
		const matchedCache = compileTerms(matched);
		if (matched.length) snippet = lineSnippet(document, snippetRegex(matched, matchedCache), 2, matchedCache);
	}
	const fileMatches = matchingFiles(message, regex);
	return {
		...entry,
		snippet,
		...(fileMatches.length ? { fileMatches } : {}),
		...(message.role === "toolResult" && ["search_session", "revisit_note"].includes(message.toolName)
			? { recallEcho: true }
			: {}),
	};
};

export const searchEntries = (
	entries: RenderedEntry[],
	messages: Message[],
	query?: string,
	mode: RecallMode = "history",
): SearchHit[] => {
	if (!query?.trim()) return entries;

	let currentTurnId: number | string = entries[0]?.entryId ?? entries[0]?.index ?? 0;
	const turnIds = entries.map((entry) => {
		if (entry.role === "user" || entry.role === "bash" || (entry.sourceKind && entry.sourceKind !== "message"))
			currentTurnId = entry.entryId ?? entry.index ?? 0;
		return currentTurnId;
	});
	const withTurn = (entry: SearchHit, offset: number): SearchHit => {
		Object.defineProperty(entry, "turnId", { value: turnIds[offset], enumerable: false });
		const message = messages[offset];
		if (message?.role === "toolResult" && ["search_session", "revisit_note"].includes(message.toolName))
			entry.recallEcho = true;
		return entry;
	};

	const rawQuery = query.trim();

	if (looksLikeRegex(rawQuery)) {
		const regex = safeRegex(rawQuery);
		const hits: SearchHit[] = [];
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			const msg = messages[i];
			const document = msg ? fullText(msg, mode) : { text: e.summary, sections: [] };
			const filePart = e.files?.join(" ") ?? "";
			const hay = mode === "file" ? document.text : `${e.role} ${document.text} ${filePart}`;
			if (regex.test(hay)) {
				const snip = lineSnippet(document, regex);
				const fileMatches = matchingFiles(msg, regex);
				hits.push(
					withTurn({ ...e, snippet: snip, matchCount: 1, ...(fileMatches.length > 0 ? { fileMatches } : {}) }, i),
				);
				if (hits.length >= MAX_SEARCH_RESULTS) break;
			}
		}
		return hits;
	}

	const rawTerms = rawQuery.split(/\s+/);
	const terms = filterStopwords(rawTerms);
	const termCache = compileTerms(terms);
	const snipRe = snippetRegex(terms, termCache);

	const docs: string[] = [];
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		const msg = messages[i];
		const text = msg ? fullText(msg, mode).text : e.summary;
		const filePart = e.files?.join(" ") ?? "";
		docs.push(mode === "file" ? text : `${e.role} ${text} ${filePart}`);
	}

	const ctx = buildBM25Context(docs, termCache);

	const minMatchCount = terms.length >= 3 ? MIN_TERM_MATCH_FOR_MULTITERM : 1;

	const scored: Array<{ hit: SearchHit; score: number }> = [];
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		const hay = docs[i];
		const mc = countMatches(hay, termCache);
		if (mc < minMatchCount) continue;
		const score = bm25Score(hay, termCache, ctx);
		const msg = messages[i];
		const document = msg ? fullText(msg, mode) : { text: e.summary, sections: [] };
		const snip = lineSnippet(document, snipRe, 2, termCache);
		const fileMatches = matchingFiles(msg, snipRe);
		scored.push({
			hit: withTurn({ ...e, snippet: snip, matchCount: mc, ...(fileMatches.length > 0 ? { fileMatches } : {}) }, i),
			score,
		});
	}

	scored.sort((a, b) => b.score - a.score);

	if (scored.length > 1 && terms.length >= 2) {
		const topScore = scored[0].score;
		if (topScore > 0) {
			const threshold = topScore * MIN_SCORE_RATIO;
			const cutIdx = scored.findIndex((s) => s.score < threshold);
			if (cutIdx > 0) scored.length = cutIdx;
		}
	}

	scored.sort((a, b) => Number(Boolean(a.hit.recallEcho)) - Number(Boolean(b.hit.recallEcho)) || b.score - a.score);

	if (scored.length > MAX_SEARCH_RESULTS) {
		scored.length = MAX_SEARCH_RESULTS;
	}

	return scored.map((s) => s.hit);
};
