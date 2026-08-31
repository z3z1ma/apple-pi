import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, extname, join, parse, relative, resolve, sep } from "node:path";

export type WikiDirection = "inbound" | "outbound" | "both";
export type WikiDepth = 1 | 2;
export type WikiFindingKind =
	| "duplicate-slug"
	| "ambiguous-link"
	| "unresolved-link"
	| "missing-heading"
	| "unsafe-path";

export interface WikiFinding {
	kind: WikiFindingKind;
	message: string;
	slug?: string;
	paths?: string[];
	path?: string;
	line?: number;
	column?: number;
	target?: string;
	fragment?: string;
	raw?: string;
}

export interface WikiEdge {
	from: string;
	to: string;
	line: number;
	column: number;
	raw: string;
	target: string;
	fragment?: string;
	alias?: string;
}

export interface WikiLintResult {
	projectRoot: string;
	wikiRoot: string;
	pageCount: number;
	linkCount: number;
	ok: boolean;
	findings: WikiFinding[];
}

export interface WikiReferenceNode {
	slug: string;
	path: string;
	distance: number;
}

export interface WikiReferencesResult {
	projectRoot: string;
	wikiRoot: string;
	target: WikiReferenceNode;
	direction: WikiDirection;
	depth: WikiDepth;
	nodes: WikiReferenceNode[];
	edges: WikiEdge[];
}

interface ParsedLink {
	path: string;
	line: number;
	column: number;
	raw: string;
	target: string;
	hasFragment: boolean;
	fragment?: string;
	alias?: string;
}

interface WikiPage {
	slug: string;
	key: string;
	path: string;
	headings: Set<string>;
	links: ParsedLink[];
}

interface WikiGraph {
	projectRoot: string;
	wikiRoot: string;
	pages: WikiPage[];
	edges: WikiEdge[];
	linkCount: number;
	findings: WikiFinding[];
}

function slugKey(value: string): string {
	return value.normalize("NFKC").toLowerCase();
}

function portablePath(value: string): string {
	return value.split(sep).join("/");
}

async function lstatIfPresent(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function sameFile(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

async function readNonSymlinkFile(path: string, expected: { dev: number; ino: number }): Promise<string> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || !sameFile(expected, stat)) throw new Error(".wiki changed while scanning");
		return await handle.readFile({ encoding: "utf8" });
	} finally {
		await handle.close();
	}
}

/** Resolve the nearest Git worktree root, or retain the current project directory outside Git. */
export async function findWikiProjectRoot(start: string): Promise<string> {
	const initial = await realpath(resolve(start));
	let current = initial;
	while (true) {
		if (await lstatIfPresent(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return initial;
		current = parent;
	}
}

const INLINE_CODE_PLACEHOLDER = "\uFFFC";

function maskInlineCode(
	line: string,
	delimiterLength = 0,
): { line: string; visibleLine: string; delimiterLength: number } {
	// split("") retains UTF-16 width, so RegExp match indices remain source columns.
	const chars = line.split("");
	const visibleChars = line.split("");
	let index = 0;
	while (index < chars.length) {
		if (chars[index] !== "`") {
			if (delimiterLength > 0) chars[index] = INLINE_CODE_PLACEHOLDER;
			index += 1;
			continue;
		}

		let end = index;
		while (chars[end] === "`") end += 1;
		const runLength = end - index;
		const delimiterRun = delimiterLength === 0 || runLength === delimiterLength;
		if (delimiterLength === 0) delimiterLength = runLength;
		else if (runLength === delimiterLength) delimiterLength = 0;
		for (let cursor = index; cursor < end; cursor += 1) {
			chars[cursor] = INLINE_CODE_PLACEHOLDER;
			if (delimiterRun) visibleChars[cursor] = " ";
		}
		index = end;
	}
	return { line: chars.join(""), visibleLine: visibleChars.join(""), delimiterLength };
}

function normalizeHeadingText(value: string): string {
	return value.replace(/[ \t]+/g, " ").trim();
}

function fenceMatch(line: string): RegExpExecArray | null {
	// Obsidian accepts fenced code in blockquotes and immediately after list markers.
	const container = "(?: {0,3}>[ \\t]?| {0,3}(?:[-+*]|\\d+[.)])[ \\t]+)*";
	return new RegExp(`^${container} {0,3}(\`{3,}|~{3,})`).exec(line);
}

function closesFence(line: string, marker: string, length: number): boolean {
	const match = fenceMatch(line);
	return (
		!!match && match[1]?.[0] === marker && match[1].length >= length && /^[ \t]*$/.test(line.slice(match[0].length))
	);
}

function isIndentedCode(line: string): boolean {
	return /^(?: {4}|\t)/.test(line);
}

function parseLinkTarget(rawBody: string): {
	target: string;
	hasFragment: boolean;
	fragment?: string;
	alias?: string;
} {
	const aliasSeparator = rawBody.indexOf("|");
	const targetAndFragment = (aliasSeparator >= 0 ? rawBody.slice(0, aliasSeparator) : rawBody).trim();
	const alias = aliasSeparator >= 0 ? rawBody.slice(aliasSeparator + 1).trim() || undefined : undefined;
	const fragmentSeparator = targetAndFragment.indexOf("#");
	if (fragmentSeparator < 0) return { target: targetAndFragment, hasFragment: false, alias };
	return {
		target: targetAndFragment.slice(0, fragmentSeparator).trim(),
		hasFragment: true,
		fragment: targetAndFragment.slice(fragmentSeparator + 1).trim() || undefined,
		alias,
	};
}

function extractPageLinks(content: string, path: string): ParsedLink[] {
	const links: ParsedLink[] = [];
	const lines = content.split(/\r?\n/);
	let fence: { marker: string; length: number } | undefined;
	let inlineDelimiterLength = 0;

	for (const [lineIndex, line] of lines.entries()) {
		const matchedFence = fenceMatch(line);
		if (fence) {
			inlineDelimiterLength = 0;
			if (closesFence(line, fence.marker, fence.length)) fence = undefined;
			continue;
		}
		if (isIndentedCode(line)) {
			inlineDelimiterLength = 0;
			continue;
		}
		if (matchedFence?.[1]) {
			inlineDelimiterLength = 0;
			fence = { marker: matchedFence[1][0]!, length: matchedFence[1].length };
			continue;
		}

		const masked = maskInlineCode(line, inlineDelimiterLength);
		inlineDelimiterLength = masked.delimiterLength;
		const pattern = /\[\[([^\]]+)\]\]/g;
		for (let match = pattern.exec(masked.line); match; match = pattern.exec(masked.line)) {
			const embedded = match.index > 0 && masked.line[match.index - 1] === "!";
			const start = embedded ? match.index - 1 : match.index;
			if (start > 0 && masked.line[start - 1] === "\\") continue;
			const body = match[1] ?? "";
			const parsed = parseLinkTarget(body);
			links.push({
				path,
				line: lineIndex + 1,
				column: start + 1,
				raw: line.slice(start, match.index + match[0].length),
				...parsed,
			});
		}
	}
	return links;
}

function extractHeadings(content: string): Set<string> {
	const headings = new Set<string>();
	const lines = content.split(/\r?\n/);
	let contentStart = 0;
	if ((lines[0] ?? "").replace(/^\uFEFF/, "").trim() === "---") {
		const closing = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
		contentStart = closing >= 0 ? closing + 1 : lines.length;
	}
	let fence: { marker: string; length: number } | undefined;
	let previousVisibleLine: string | undefined;
	let inlineDelimiterLength = 0;

	for (const line of lines.slice(contentStart)) {
		const matchedFence = fenceMatch(line);
		if (fence) {
			inlineDelimiterLength = 0;
			if (closesFence(line, fence.marker, fence.length)) fence = undefined;
			previousVisibleLine = undefined;
			continue;
		}
		if (isIndentedCode(line)) {
			inlineDelimiterLength = 0;
			previousVisibleLine = undefined;
			continue;
		}
		if (matchedFence?.[1]) {
			inlineDelimiterLength = 0;
			fence = { marker: matchedFence[1][0]!, length: matchedFence[1].length };
			previousVisibleLine = undefined;
			continue;
		}

		const inlineStateBefore = inlineDelimiterLength;
		const masked = maskInlineCode(line, inlineDelimiterLength);
		inlineDelimiterLength = masked.delimiterLength;
		const atx = /^(\s{0,3}#{1,6})(?=[ \t]|$)/.exec(masked.line);
		if (atx) {
			const headingStart = atx[1]?.length ?? 0;
			const closing = /[ \t]+#+[ \t]*$/.exec(masked.line);
			const headingEnd = closing && closing.index >= headingStart ? closing.index : masked.visibleLine.length;
			const heading = normalizeHeadingText(masked.visibleLine.slice(headingStart, headingEnd));
			if (heading) headings.add(slugKey(heading));
			previousVisibleLine = inlineStateBefore === 0 && inlineDelimiterLength === 0 ? masked.visibleLine : undefined;
			continue;
		}
		if (/^\s{0,3}(?:=+|-+)\s*$/.test(masked.line) && previousVisibleLine?.trim()) {
			headings.add(slugKey(normalizeHeadingText(previousVisibleLine)));
		}
		previousVisibleLine = inlineStateBefore === 0 && inlineDelimiterLength === 0 ? masked.visibleLine : undefined;
	}
	return headings;
}

function findingRank(kind: WikiFindingKind): number {
	return {
		"duplicate-slug": 0,
		"ambiguous-link": 1,
		"unresolved-link": 2,
		"missing-heading": 3,
		"unsafe-path": 4,
	}[kind];
}

function sortFindings(findings: WikiFinding[]): WikiFinding[] {
	return findings.sort(
		(left, right) =>
			findingRank(left.kind) - findingRank(right.kind) ||
			(left.slug ?? left.path ?? "").localeCompare(right.slug ?? right.path ?? "") ||
			(left.line ?? 0) - (right.line ?? 0) ||
			(left.column ?? 0) - (right.column ?? 0) ||
			(left.target ?? "").localeCompare(right.target ?? ""),
	);
}

async function loadWikiGraph(start: string): Promise<WikiGraph> {
	const projectRoot = await findWikiProjectRoot(start);
	const wikiRoot = join(projectRoot, ".wiki");
	const wikiStat = await lstatIfPresent(wikiRoot);
	if (!wikiStat) throw new Error(`No project wiki found at ${portablePath(relative(projectRoot, wikiRoot))}`);
	if (wikiStat.isSymbolicLink() || !wikiStat.isDirectory()) {
		throw new Error(".wiki must be a non-symlink directory inside the project root");
	}
	const canonicalWikiRoot = await realpath(wikiRoot);
	if (canonicalWikiRoot !== wikiRoot && !canonicalWikiRoot.startsWith(`${projectRoot}${sep}`)) {
		throw new Error(".wiki resolves outside the project root");
	}

	const pages: WikiPage[] = [];
	const findings: WikiFinding[] = [];
	async function visit(directory: string): Promise<void> {
		const before = await lstat(directory);
		if (before.isSymbolicLink() || !before.isDirectory()) throw new Error(".wiki changed while scanning");
		const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
			left.name.localeCompare(right.name),
		);
		for (const entry of entries) {
			const absolute = join(directory, entry.name);
			const path = portablePath(relative(projectRoot, absolute));
			const stat = await lstat(absolute);
			if (stat.isSymbolicLink()) {
				findings.push({
					kind: "unsafe-path",
					path,
					message: `${path} is a symlink and was not followed`,
				});
				continue;
			}
			if (stat.isDirectory()) {
				await visit(absolute);
				continue;
			}
			if (!stat.isFile() || extname(entry.name).toLowerCase() !== ".md") continue;
			const slug = parse(entry.name).name;
			const content = await readNonSymlinkFile(absolute, stat);
			const after = await lstat(absolute);
			if (!sameFile(stat, after) || after.isSymbolicLink()) throw new Error(".wiki changed while scanning");
			pages.push({
				slug,
				key: slugKey(slug),
				path,
				headings: extractHeadings(content),
				links: extractPageLinks(content, path),
			});
		}
		const after = await lstat(directory);
		if (!sameFile(before, after) || after.isSymbolicLink() || !after.isDirectory()) {
			throw new Error(".wiki changed while scanning");
		}
	}
	await visit(wikiRoot);
	pages.sort((left, right) => left.path.localeCompare(right.path));

	const pagesBySlug = new Map<string, WikiPage[]>();
	for (const page of pages) {
		const matches = pagesBySlug.get(page.key) ?? [];
		matches.push(page);
		pagesBySlug.set(page.key, matches);
	}
	for (const [key, matches] of pagesBySlug) {
		if (matches.length < 2) continue;
		const paths = matches.map((page) => page.path).sort();
		findings.push({
			kind: "duplicate-slug",
			slug: key,
			paths,
			message: `Slug ${JSON.stringify(key)} is shared by ${paths.join(", ")}`,
		});
	}

	const edges: WikiEdge[] = [];
	let linkCount = 0;
	for (const page of pages) {
		for (const link of page.links) {
			const slugMatches = pagesBySlug.get(slugKey(link.target)) ?? [];
			// A dotted Obsidian target is an attachment only when it cannot name a real page.
			if (slugMatches.length === 0 && extname(link.target) && extname(link.target).toLowerCase() !== ".md") continue;
			linkCount += 1;
			const matches = !link.target && link.hasFragment && link.fragment ? [page] : slugMatches;
			if (matches.length === 0) {
				findings.push({
					kind: "unresolved-link",
					path: link.path,
					line: link.line,
					column: link.column,
					target: link.target,
					raw: link.raw,
					message: `${link.path}:${link.line}:${link.column} cannot resolve ${link.raw}`,
				});
				continue;
			}
			if (matches.length > 1) {
				findings.push({
					kind: "ambiguous-link",
					path: link.path,
					line: link.line,
					column: link.column,
					target: link.target,
					raw: link.raw,
					paths: matches.map((match) => match.path).sort(),
					message: `${link.path}:${link.line}:${link.column} resolves ${link.raw} to multiple pages`,
				});
				continue;
			}
			const destination = matches[0]!;
			if (link.hasFragment && (!link.fragment || !destination.headings.has(slugKey(link.fragment)))) {
				findings.push({
					kind: "missing-heading",
					path: link.path,
					line: link.line,
					column: link.column,
					target: link.target,
					fragment: link.fragment,
					raw: link.raw,
					paths: [destination.path],
					message: `${link.path}:${link.line}:${link.column} cannot find heading ${JSON.stringify(link.fragment ?? "")} in ${destination.path}`,
				});
			}
			edges.push({
				from: page.path,
				to: destination.path,
				line: link.line,
				column: link.column,
				raw: link.raw,
				target: link.target,
				fragment: link.fragment,
				alias: link.alias,
			});
		}
	}
	edges.sort(
		(left, right) => left.from.localeCompare(right.from) || left.line - right.line || left.column - right.column,
	);

	return {
		projectRoot,
		wikiRoot,
		pages,
		edges,
		linkCount,
		findings: sortFindings(findings),
	};
}

export async function lintWiki(start: string): Promise<WikiLintResult> {
	const graph = await loadWikiGraph(start);
	return {
		projectRoot: graph.projectRoot,
		wikiRoot: graph.wikiRoot,
		pageCount: graph.pages.length,
		linkCount: graph.linkCount,
		ok: graph.findings.length === 0,
		findings: graph.findings,
	};
}

function normalizeTargetPath(target: string): string {
	const normalized = target.replace(/^@/, "").replaceAll("\\", "/").replace(/^\.\//, "");
	if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
		throw new Error("wiki_references target paths must stay inside .wiki");
	}
	const wikiRelative = normalized.startsWith(".wiki/") ? normalized : `.wiki/${normalized}`;
	if (!wikiRelative.toLowerCase().endsWith(".md")) {
		throw new Error("wiki_references target paths must identify a Markdown page inside .wiki");
	}
	return wikiRelative;
}

function resolveTarget(graph: WikiGraph, rawTarget: string): WikiPage {
	const target = rawTarget.trim();
	if (!target) throw new Error("wiki_references target must not be empty");
	const isPath = target.includes("/") || target.includes("\\") || target.toLowerCase().endsWith(".md");
	if (isPath) {
		const path = normalizeTargetPath(target);
		const exact = graph.pages.filter((page) => page.path === path);
		if (exact.length === 1) return exact[0]!;
		const folded = graph.pages.filter((page) => slugKey(page.path) === slugKey(path));
		if (folded.length === 1) return folded[0]!;
		if (folded.length > 1) throw new Error(`wiki_references path is ambiguous: ${path}`);
		throw new Error(`Wiki page not found: ${path}`);
	}

	const matches = graph.pages.filter((page) => page.key === slugKey(target));
	if (matches.length === 0) throw new Error(`Wiki slug not found: ${target}`);
	if (matches.length > 1) {
		throw new Error(`Wiki slug is ambiguous: ${target} (${matches.map((page) => page.path).join(", ")})`);
	}
	return matches[0]!;
}

function traversedNeighbor(edge: WikiEdge, current: string, direction: WikiDirection): string | undefined {
	if ((direction === "outbound" || direction === "both") && edge.from === current) return edge.to;
	if ((direction === "inbound" || direction === "both") && edge.to === current) return edge.from;
	return undefined;
}

export async function getWikiReferences(
	start: string,
	targetInput: string,
	direction: WikiDirection,
	depth: WikiDepth,
): Promise<WikiReferencesResult> {
	if (!(["inbound", "outbound", "both"] as const).includes(direction)) {
		throw new Error("wiki_references direction must be inbound, outbound, or both");
	}
	if (depth !== 1 && depth !== 2) throw new Error("wiki_references depth must be 1 or 2");
	const graph = await loadWikiGraph(start);
	const target = resolveTarget(graph, targetInput);
	const distances = new Map<string, number>([[target.path, 0]]);
	const queue = [target.path];
	const traversedEdges = new Map<string, WikiEdge>();

	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const current = queue[queueIndex]!;
		const currentDistance = distances.get(current)!;
		if (currentDistance >= depth) continue;
		for (const edge of graph.edges) {
			const neighbor = traversedNeighbor(edge, current, direction);
			if (!neighbor) continue;
			const edgeKey = `${edge.from}\0${edge.to}\0${edge.line}\0${edge.column}`;
			traversedEdges.set(edgeKey, edge);
			if (neighbor === current || distances.has(neighbor)) continue;
			distances.set(neighbor, currentDistance + 1);
			queue.push(neighbor);
		}
	}

	const pagesByPath = new Map(graph.pages.map((page) => [page.path, page]));
	const nodes = [...distances.entries()]
		.map(([path, distance]) => {
			const page = pagesByPath.get(path)!;
			return { slug: page.slug, path, distance };
		})
		.sort((left, right) => left.distance - right.distance || left.path.localeCompare(right.path));
	const edges = [...traversedEdges.values()].sort(
		(left, right) =>
			left.from.localeCompare(right.from) ||
			left.line - right.line ||
			left.column - right.column ||
			left.to.localeCompare(right.to),
	);

	return {
		projectRoot: graph.projectRoot,
		wikiRoot: graph.wikiRoot,
		target: { slug: target.slug, path: target.path, distance: 0 },
		direction,
		depth,
		nodes,
		edges,
	};
}
