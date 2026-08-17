import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ReviewAnchorProvenance, ReviewAnchorSide, ReviewItem } from "./types.js";

export interface ResolvedReviewAnchor {
	startLine?: number;
	endLine?: number;
	provenance: ReviewAnchorProvenance;
	matchCount: number;
}

interface DiffLine {
	text: string;
	line: number;
	changed: boolean;
}

function anchorLines(anchor: string): string[] {
	const lines = anchor.replace(/\r\n/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function sideLines(diff: string, side: ReviewAnchorSide): DiffLine[][] {
	const hunks: DiffLine[][] = [];
	let current: DiffLine[] | undefined;
	let oldLine = 0;
	let newLine = 0;
	for (const raw of diff.replace(/\r\n/g, "\n").split("\n")) {
		const header = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
			current = [];
			hunks.push(current);
			continue;
		}
		if (!current || raw.startsWith("\\ No newline")) continue;
		const marker = raw[0];
		const text = raw.slice(1);
		if (marker === " ") {
			current.push({ text, line: side === "new" ? newLine : oldLine, changed: false });
			oldLine++;
			newLine++;
		} else if (marker === "+") {
			if (side === "new") current.push({ text, line: newLine, changed: true });
			newLine++;
		} else if (marker === "-") {
			if (side === "old") current.push({ text, line: oldLine, changed: true });
			oldLine++;
		}
	}
	return hunks;
}

function findInHunks(diff: string, anchor: string[], side: ReviewAnchorSide): Array<{ start: number; end: number }> {
	const matches: Array<{ start: number; end: number }> = [];
	if (anchor.length === 0) return matches;
	for (const hunk of sideLines(diff, side)) {
		for (let start = 0; start + anchor.length <= hunk.length; start++) {
			const slice = hunk.slice(start, start + anchor.length);
			if (!slice.some((line) => line.changed)) continue;
			if (slice.every((line, index) => line.text === anchor[index])) {
				matches.push({ start: slice[0].line, end: slice[slice.length - 1].line });
			}
		}
	}
	return matches;
}

function safeCurrentFile(projectRoot: string, path: string): string | undefined {
	const absolute = resolve(projectRoot, path);
	const rel = relative(projectRoot, absolute).split(sep).join("/");
	if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel) || !existsSync(absolute)) return undefined;
	const stat = lstatSync(absolute);
	if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
	return absolute;
}

function changedNewLines(diff: string): Set<number> {
	const lines = new Set<number>();
	for (const hunk of sideLines(diff, "new")) for (const line of hunk) if (line.changed) lines.add(line.line);
	return lines;
}

function findInCurrentFile(
	projectRoot: string,
	item: ReviewItem,
	anchor: string[],
): Array<{ start: number; end: number }> {
	const path = safeCurrentFile(projectRoot, item.path);
	if (!path || anchor.length === 0) return [];
	const content = readFileSync(path);
	if (content.includes(0)) return [];
	const lines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	const changed = changedNewLines(item.diff);
	const matches: Array<{ start: number; end: number }> = [];
	for (let index = 0; index + anchor.length <= lines.length; index++) {
		if (!anchor.every((line, offset) => lines[index + offset] === line)) continue;
		const start = index + 1;
		const end = start + anchor.length - 1;
		let overlaps = false;
		for (let line = start; line <= end; line++) if (changed.has(line)) overlaps = true;
		if (overlaps) matches.push({ start, end });
	}
	return matches;
}

export function fileLinesAt(projectRoot: string, path: string): string[] | undefined {
	const file = safeCurrentFile(projectRoot, path);
	if (!file) return undefined;
	const content = readFileSync(file);
	if (content.includes(0)) return undefined;
	const lines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

export function sealedSideLines(item: Pick<ReviewItem, "diff">, side: ReviewAnchorSide): Map<number, string> {
	const byLine = new Map<number, string>();
	for (const hunk of sideLines(item.diff, side)) {
		for (const line of hunk) byLine.set(line.line, line.text);
	}
	return byLine;
}

function claimedDiffWindow(
	item: ReviewItem,
	side: ReviewAnchorSide,
	startLine: number,
	endLine: number,
): string[] | undefined {
	const byLine = sealedSideLines(item, side);
	const window: string[] = [];
	for (let line = startLine; line <= endLine; line++) {
		if (!byLine.has(line)) return undefined;
		window.push(byLine.get(line)!);
	}
	return window;
}

/** Lined reports are exact when those line numbers exist. The controller attaches the text; the verifier screens the claim. */
export function groundReportedAnchor(
	projectRoot: string,
	item: ReviewItem,
	anchor: string,
	side: ReviewAnchorSide,
	claimed: { startLine?: number; endLine?: number } = {},
	options: { allowCurrentFile?: boolean } = {},
): ResolvedReviewAnchor {
	if (claimed.startLine === undefined) {
		return anchor.trim()
			? resolveReviewAnchor(projectRoot, item, anchor, side, options)
			: { provenance: "unresolved", matchCount: 0 };
	}
	const startLine = claimed.startLine;
	const endLine = claimed.endLine ?? claimed.startLine;
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
		return { provenance: "unresolved", matchCount: 0 };
	}
	if (side === "new") {
		const lines = fileLinesAt(projectRoot, item.path);
		if (lines && endLine <= lines.length) {
			return { startLine, endLine, provenance: "exact_file", matchCount: 1 };
		}
	}
	if (claimedDiffWindow(item, side, startLine, endLine)) {
		return { startLine, endLine, provenance: "exact_hunk", matchCount: 1 };
	}
	return { startLine, endLine, provenance: "unresolved", matchCount: 0 };
}

export function resolveReviewAnchor(
	projectRoot: string,
	item: ReviewItem,
	anchor: string,
	side: ReviewAnchorSide,
	options: { allowCurrentFile?: boolean } = {},
): ResolvedReviewAnchor {
	const lines = anchorLines(anchor);
	if (lines.length === 0) return { provenance: "unresolved", matchCount: 0 };
	const hunkMatches = findInHunks(item.diff, lines, side);
	if (hunkMatches.length === 1) {
		return { startLine: hunkMatches[0].start, endLine: hunkMatches[0].end, provenance: "exact_hunk", matchCount: 1 };
	}
	if (hunkMatches.length > 1) return { provenance: "ambiguous", matchCount: hunkMatches.length };
	if (side === "new" && options.allowCurrentFile !== false) {
		const fileMatches = findInCurrentFile(projectRoot, item, lines);
		if (fileMatches.length === 1) {
			return { startLine: fileMatches[0].start, endLine: fileMatches[0].end, provenance: "exact_file", matchCount: 1 };
		}
		if (fileMatches.length > 1) return { provenance: "ambiguous", matchCount: fileMatches.length };
	}
	return { provenance: "unresolved", matchCount: 0 };
}
