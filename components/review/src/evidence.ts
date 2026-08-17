import { fileLinesAt, sealedSideLines } from "./location.js";
import type { ReviewAnchorSide, ReviewFinding, ReviewItem } from "./types.js";

const CLUSTER_NEAR_LINES = 8;
const HUNK_CONTEXT_LINES = 8;
const UNLINED_HUNK_LINES = 40;

export interface ReviewFindingCluster {
	id: string;
	path: string;
	side?: ReviewAnchorSide;
	startLine?: number;
	endLine?: number;
	findingIds: string[];
}

function formatSealedLines(
	byLine: Map<number, string>,
	startLine?: number,
	endLine?: number,
	context = HUNK_CONTEXT_LINES,
): string {
	const numbers = [...byLine.keys()].sort((left, right) => left - right);
	if (numbers.length === 0) return "";
	if (startLine === undefined) {
		return numbers
			.slice(0, UNLINED_HUNK_LINES)
			.map((line) => `${line}| ${byLine.get(line)}`)
			.join("\n");
	}
	const end = endLine ?? startLine;
	const from = startLine - context;
	const to = end + context;
	return numbers
		.filter((line) => line >= from && line <= to)
		.map((line) => `${line}| ${byLine.get(line)}`)
		.join("\n");
}

/** New-side windows use the current file so line numbers match the reviewer. Old/deleted windows use the sealed diff map. */
export function extractSealedHunk(
	root: string,
	item: Pick<ReviewItem, "path" | "diff">,
	side: ReviewAnchorSide,
	startLine?: number,
	endLine?: number,
	context = HUNK_CONTEXT_LINES,
): string {
	if (side === "new") {
		const lines = fileLinesAt(root, item.path);
		if (lines?.length) {
			const byLine = new Map(lines.map((text, index) => [index + 1, text]));
			return formatSealedLines(byLine, startLine, endLine, context);
		}
	}
	return formatSealedLines(sealedSideLines(item, side), startLine, endLine, context);
}

export function clusterFindings(
	findings: Array<Pick<ReviewFinding, "id" | "path" | "side" | "startLine" | "endLine">>,
): ReviewFindingCluster[] {
	const byKey = new Map<string, Array<Pick<ReviewFinding, "id" | "path" | "side" | "startLine" | "endLine">>>();
	for (const finding of findings) {
		const key = `${finding.path}\0${finding.side ?? ""}`;
		const group = byKey.get(key) ?? [];
		group.push(finding);
		byKey.set(key, group);
	}
	const clusters: ReviewFindingCluster[] = [];
	let index = 0;
	for (const group of [...byKey.values()].sort((left, right) => {
		const path = left[0].path.localeCompare(right[0].path);
		return path !== 0 ? path : (left[0].side ?? "").localeCompare(right[0].side ?? "");
	})) {
		const path = group[0].path;
		const side = group[0].side;
		const lined = group
			.filter((finding) => finding.startLine !== undefined)
			.sort((left, right) => (left.startLine ?? 0) - (right.startLine ?? 0));
		const unlined = group.filter((finding) => finding.startLine === undefined);
		let current: { start: number; end: number; ids: string[] } | undefined;
		const flush = (): void => {
			if (!current) return;
			index += 1;
			clusters.push({
				id: `k${index}`,
				path,
				...(side && { side }),
				startLine: current.start,
				endLine: current.end,
				findingIds: current.ids,
			});
			current = undefined;
		};
		for (const finding of lined) {
			const start = finding.startLine!;
			const end = finding.endLine ?? start;
			if (!current || start > current.end + CLUSTER_NEAR_LINES) {
				flush();
				current = { start, end, ids: [finding.id] };
			} else {
				current.end = Math.max(current.end, end);
				current.ids.push(finding.id);
			}
		}
		flush();
		if (unlined.length > 0) {
			index += 1;
			clusters.push({
				id: `k${index}`,
				path,
				...(side && { side }),
				findingIds: unlined.map((finding) => finding.id),
			});
		}
	}
	return clusters;
}
