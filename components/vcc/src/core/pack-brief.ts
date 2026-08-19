import type { BriefLine } from "./brief.js";
import { stringifyBrief } from "./brief.js";
import { estimateTextTokens } from "./content.js";

const SEPARATOR = "\n\n---\n\n";
const MIN_CLIP_TOKENS = 32;

export type PackedKind = "user" | "error" | "prose" | "result" | "tool";

export interface PackedItem {
	header: string;
	line: string;
	kind: PackedKind;
	tokens: number;
}

export const isBriefHeader = (line: string): boolean =>
	line === "[user]" || line === "[assistant]" || line.startsWith("[tool_error]") || line.startsWith("[tool_result]");

export const parseBrief = (text: string): BriefLine[] => {
	const sections: BriefLine[] = [];
	for (const line of text.split("\n")) {
		if (isBriefHeader(line)) {
			sections.push({ header: line, lines: [] });
			continue;
		}
		if (sections.length === 0 || line === "") continue;
		sections[sections.length - 1].lines.push(line);
	}
	return sections;
};

export const kindOf = (header: string, line: string): PackedKind => {
	if (header === "[user]") return "user";
	if (header.startsWith("[tool_error]")) return "error";
	if (header.startsWith("[tool_result]")) return "result";
	if (line.startsWith("* ")) return "tool";
	return "prose";
};

const flatten = (sections: BriefLine[]): PackedItem[] => {
	const items: PackedItem[] = [];
	const push = (header: string, line: string, kind: PackedKind) => {
		items.push({
			header,
			line,
			kind,
			tokens: Math.max(1, estimateTextTokens(line ? `${header}\n${line}` : header)),
		});
	};

	for (const sec of sections) {
		if (sec.header === "[user]" || sec.header.startsWith("[tool_")) {
			const line = sec.lines.join("\n");
			push(sec.header, line, kindOf(sec.header, line));
			continue;
		}
		let prose: string[] = [];
		const flushProse = () => {
			if (prose.length === 0) return;
			push(sec.header, prose.join("\n"), "prose");
			prose = [];
		};
		for (const line of sec.lines) {
			if (line.startsWith("* ")) {
				flushProse();
				push(sec.header, line, "tool");
			} else {
				prose.push(line);
			}
		}
		flushProse();
		if (sec.lines.length === 0) push(sec.header, "", "prose");
	}
	return items;
};

const clipHeadChars = (text: string, maxChars: number): string => {
	if (text.length <= maxChars) return text;
	const marker = "...(truncated)";
	const keep = Math.max(0, maxChars - marker.length);
	return `${text.slice(0, keep).trimEnd()}${marker}`;
};

const clipTailChars = (text: string, maxChars: number): string => {
	if (text.length <= maxChars) return text;
	const marker = "...(truncated) ";
	const keep = Math.max(0, maxChars - marker.length);
	return `${marker}${text.slice(-keep).trimStart()}`;
};

const itemTokens = (header: string, line: string): number => Math.max(1, estimateTextTokens(`${header}\n${line}`));

const rebuild = (selected: Array<PackedItem | null>): BriefLine[] => {
	const out: BriefLine[] = [];
	for (const item of selected) {
		if (!item) continue;
		const last = out[out.length - 1];
		if (last && last.header === item.header) {
			if (item.line) last.lines.push(item.line);
		} else {
			out.push({ header: item.header, lines: item.line ? [item.line] : [] });
		}
	}
	return out;
};

const tryTakeClipped = (
	selected: Array<PackedItem | null>,
	index: number,
	item: PackedItem,
	used: number,
	budgetTokens: number,
	clip: (text: string, maxChars: number) => string,
): number => {
	const leftover = budgetTokens - used;
	if (leftover < MIN_CLIP_TOKENS) return used;
	const prefix = `${item.header}\n`;
	const maxChars = leftover * 4 - prefix.length;
	if (maxChars < 16) return used;
	const clipped = clip(item.line, maxChars);
	if (!clipped) return used;
	const tokens = itemTokens(item.header, clipped);
	if (used + tokens > budgetTokens) return used;
	selected[index] = { ...item, line: clipped, tokens };
	return used + tokens;
};

/**
 * Pack a lossless brief into one token budget.
 * Pin errors, the first user, then newer users. Fill the rest backward:
 * prose may clip to a tail; results and tool one-liners are all-or-nothing.
 */
export const packBriefSections = (
	sections: BriefLine[],
	budgetTokens: number,
): { sections: BriefLine[]; omitted: number } => {
	if (budgetTokens <= 0) return { sections: [], omitted: flatten(sections).length };
	const items = flatten(sections);
	const total = items.reduce((sum, item) => sum + item.tokens, 0);
	if (total <= budgetTokens) return { sections, omitted: 0 };

	const selected: Array<PackedItem | null> = items.map(() => null);
	let used = 0;

	const take = (index: number, item: PackedItem): boolean => {
		if (used + item.tokens > budgetTokens) return false;
		selected[index] = item;
		used += item.tokens;
		return true;
	};

	const errors: number[] = [];
	const users: number[] = [];
	for (let i = 0; i < items.length; i++) {
		if (items[i].kind === "error") errors.push(i);
		else if (items[i].kind === "user") users.push(i);
	}

	for (const i of [...errors].reverse()) {
		if (!take(i, items[i])) used = tryTakeClipped(selected, i, items[i], used, budgetTokens, clipHeadChars);
	}

	if (users.length > 0) {
		const first = users[0];
		if (!selected[first] && !take(first, items[first])) {
			used = tryTakeClipped(selected, first, items[first], used, budgetTokens, clipHeadChars);
		}
		for (const i of [...users.slice(1)].reverse()) {
			if (selected[i]) continue;
			if (!take(i, items[i])) used = tryTakeClipped(selected, i, items[i], used, budgetTokens, clipHeadChars);
		}
	}

	for (let i = items.length - 1; i >= 0; i--) {
		if (selected[i]) continue;
		const item = items[i];
		if (take(i, item)) continue;
		if (item.kind === "prose") {
			used = tryTakeClipped(selected, i, item, used, budgetTokens, clipTailChars);
		}
	}

	const omitted = selected.filter((item) => item == null).length;
	return { sections: rebuild(selected), omitted };
};

export const packCompiledArtifact = (text: string, budgetTokens: number): string => {
	if (!text) return "";
	if (estimateTextTokens(text) <= budgetTokens) return text;

	const sep = text.indexOf(SEPARATOR);
	const headers = sep >= 0 ? text.slice(0, sep).trimEnd() : "";
	const brief = sep >= 0 ? text.slice(sep + SEPARATOR.length).trim() : text;
	const headerTokens = headers ? estimateTextTokens(headers) : 0;
	const briefBudget = Math.max(0, budgetTokens - headerTokens);
	const packed = packBriefSections(parseBrief(brief), briefBudget);
	let body = stringifyBrief(packed.sections);
	if (packed.omitted > 0) {
		const crumb = `...(${packed.omitted} earlier entries omitted)`;
		body = body ? `${crumb}\n\n${body}` : crumb;
	}
	if (!headers) return body;
	if (!body) return headers;
	return `${headers}${SEPARATOR}${body}`;
};
