import { extractCommits, formatCommits } from "../extract/commits.js";
import { extractGoals } from "../extract/goals.js";
import { dedupPreferencesAgainstGoals, extractPreferences } from "../extract/preferences.js";
import { extractFileAndSymbolData } from "../extract/shared-symbols.js";
import type { SectionData } from "../sections.js";
import type { NormalizedBlock, ToolResultIndex } from "../types.js";
import { buildBriefSections, identifyTurns, sectionsToTranscript, stringifyBrief } from "./brief.js";
import { clip, clipSentence, firstLine, nonEmptyLines } from "./content.js";
import { extractPath } from "./tool-args.js";

/**
 * Build a one-time look-ahead index: for each tool_call block, find the
 * nearest tool_result block that follows it (within +3 positions).
 *
 * Without this, files.ts / symbol-changes.ts / type-catalog.ts each scan
 * forward independently — tripling the look-ahead cost and the regex parsing
 * of tool results. The index collapses that to a single O(n) pre-scan.
 */
const buildToolResultIndex = (blocks: NormalizedBlock[]): ToolResultIndex => {
	const map = new Map<number, Extract<NormalizedBlock, { kind: "tool_result" }>>();
	for (let i = 0; i < blocks.length; i++) {
		if (blocks[i].kind !== "tool_call") continue;
		for (let j = i + 1; j < Math.min(blocks.length, i + 4); j++) {
			if (blocks[j].kind === "tool_result") {
				map.set(i, blocks[j] as Extract<NormalizedBlock, { kind: "tool_result" }>);
				break;
			}
		}
	}
	return {
		get: (callIndex: number) => map.get(callIndex) ?? null,
	};
};

interface BuildSectionsInput {
	blocks: NormalizedBlock[];
	/** Pre-built tool-call → tool-result look-ahead index. Built once, shared across extractors. */
	toolResultIndex?: ToolResultIndex;
}

const BLOCKER_RE =
	/\b(fail(ed|s|ure|ing)?|broken|cannot|can't|won't work|does not work|doesn't work|still (broken|failing|wrong)|blocked|blocker|not (fixed|resolved|working)|crash(es|ed|ing)?)\b/i;

// TypeScript compiler error pattern
const TSC_ERROR_RE = /error TS\d+:.+/;

// Test failure indicators
const TEST_FAIL_RE = /(?:FAIL|✗|✘|×)\s|(\d+)\s+(?:failed|failure|failing)/i;

// Maximum characters of bash output to scan for error patterns.
// Compiler/test errors almost always appear near the start of output;
// scanning the full output (potentially megabytes) is unnecessary.
const BASH_OUTPUT_SCAN_LIMIT = 8_000;

// Priority tags for outstanding context items
const PRIORITY_ERROR = "[ERROR]";
const PRIORITY_WARN = "[WARN]";

/** Prepend a priority tag based on the error type and exit code. */
const priorityTag = (item: string): string => {
	if (/^\[tsc\]/.test(item)) return `${PRIORITY_ERROR} ${item}`;
	if (/^\[bash:exit [1-9]\d*\]/.test(item)) return `${PRIORITY_ERROR} ${item}`;
	if (/^\[tests\]/.test(item)) return `${PRIORITY_WARN} ${item}`;
	if (/^\[user\]/.test(item)) return `${PRIORITY_WARN} ${item}`;
	// Generic tool errors
	if (/^\[\w+\]/.test(item)) return `${PRIORITY_ERROR} ${item}`;
	return `${PRIORITY_WARN} ${item}`;
};

// Write-tool names used for resolution detection
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "edit", "write", "MultiEdit"]);

/** Extract file path from a [tsc] error line like "src/auth.ts(5,18): error TS2304: ..." */
const extractTscFile = (item: string): string | null => {
	const m = item.match(/^\[tsc\]\s+(\S+)\(\d+,\d+\)/);
	return m ? m[1] : null;
};

/** Check if a tsc error's file was edited at a position after the error. */
const isTscResolved = (file: string, tailIdx: number, editPositions: Map<number, Set<string>>): boolean => {
	for (const [pos, files] of editPositions) {
		if (pos > tailIdx && files.has(file)) return true;
	}
	return false;
};

const isBashToolName = (name: string | undefined): boolean => !!name && name.toLowerCase() === "bash";

const commandKeyOf = (cmd: string): string => {
	const lines = cmd
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	let i = 0;
	// Bare `cd dir` lines are wrappers, not the command being compared.
	while (i < lines.length && /^cd\s+\S+$/.test(lines[i])) i++;
	const first = lines[i] ?? lines[0] ?? cmd;
	return first
		.replace(/^cd\s+\S+\s*&&\s*/, "")
		.replace(/\s+/g, " ")
		.trim();
};

interface CommandEvent {
	idx: number;
	key: string;
	ok: boolean;
	hasTscError: boolean;
}

interface OutstandingItem {
	text: string;
	tailIdx: number;
	commandKey?: string;
	kind: "bash" | "tests" | "tsc" | "other";
}

const collectCommandEvents = (tail: NormalizedBlock[]): CommandEvent[] => {
	const events: CommandEvent[] = [];
	let lastBashCall: { key: string } | null = null;
	for (let i = 0; i < tail.length; i++) {
		const b = tail[i];
		if (b.kind === "bash") {
			const key = commandKeyOf(b.command);
			if (!key) continue;
			const outputHead = (b.output ?? "").slice(0, BASH_OUTPUT_SCAN_LIMIT);
			events.push({
				idx: i,
				key,
				ok: b.exitCode === 0,
				hasTscError: TSC_ERROR_RE.test(outputHead),
			});
			continue;
		}
		if (b.kind === "tool_call" && isBashToolName(b.name)) {
			const cmd = typeof b.args.command === "string" ? b.args.command : "";
			const key = commandKeyOf(cmd);
			lastBashCall = key ? { key } : null;
			continue;
		}
		if (b.kind === "tool_result" && isBashToolName(b.name) && lastBashCall) {
			const outputHead = b.text.slice(0, BASH_OUTPUT_SCAN_LIMIT);
			events.push({
				idx: i,
				key: lastBashCall.key,
				ok: !b.isError,
				hasTscError: TSC_ERROR_RE.test(outputHead),
			});
			lastBashCall = null;
		}
	}
	return events;
};

const laterCommandCleared = (
	events: CommandEvent[],
	key: string | undefined,
	afterIdx: number,
	requireNoTsc = false,
): boolean => {
	if (!key) return false;
	const later = events.filter((e) => e.idx > afterIdx && e.key === key);
	if (later.length === 0) return false;
	const last = later[later.length - 1];
	return last.ok && (!requireNoTsc || !last.hasTscError);
};

const precedingBashCommandKey = (tail: NormalizedBlock[], before: number): string | undefined => {
	for (let i = before - 1; i >= 0; i--) {
		const b = tail[i];
		if (b.kind === "tool_call" && isBashToolName(b.name)) {
			const cmd = typeof b.args.command === "string" ? b.args.command : "";
			const key = commandKeyOf(cmd);
			return key || undefined;
		}
		if (b.kind === "bash") return commandKeyOf(b.command) || undefined;
	}
	return undefined;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: VCC's extraction pass intentionally preserves all ordered context cases.
const extractOutstandingContext = (blocks: NormalizedBlock[]): string[] => {
	const items: OutstandingItem[] = [];
	const tail = blocks.slice(-25);
	const commandEvents = collectCommandEvents(tail);

	const push = (item: Omit<OutstandingItem, "tailIdx"> & { tailIdx?: number }) => {
		const next: OutstandingItem = {
			text: item.text,
			tailIdx: item.tailIdx ?? -1,
			commandKey: item.commandKey,
			kind: item.kind,
		};
		const existing = items.findIndex((it) => it.text === item.text);
		if (existing >= 0) {
			items[existing] = next;
			return;
		}
		items.push(next);
	};

	for (let bi = 0; bi < tail.length; bi++) {
		const b = tail[bi];

		// 1. TypeScript compiler errors in bash output (including nonzero exits).
		// Real tsc failures usually exit 1; those must still be tsc items so a
		// later edit can mark them [RESOLVED] instead of a generic bash:exit.
		if (b.kind === "bash" && b.output) {
			const outputHead = b.output.slice(0, BASH_OUTPUT_SCAN_LIMIT);
			if (TSC_ERROR_RE.test(outputHead)) {
				const tsLines = outputHead
					.split("\n")
					.filter((l) => TSC_ERROR_RE.test(l.trim()))
					.slice(0, 3);
				const key = commandKeyOf(b.command);
				for (const line of tsLines) {
					push({ text: `[tsc] ${clip(line.trim(), 150)}`, kind: "tsc", commandKey: key, tailIdx: bi });
				}
				continue;
			}
		}

		// 2. Bash non-zero exit codes (after tsc so compiler failures stay typed)
		if (b.kind === "bash" && b.exitCode !== undefined && b.exitCode !== 0) {
			const cmd = commandKeyOf(b.command) || b.command;
			const cmdDisplay = cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
			const outLine = firstLine(b.output, 120);
			const errTag = `exit ${b.exitCode}`;
			push({
				text: `[bash:${errTag}] ${cmdDisplay}${outLine && outLine !== cmdDisplay ? ` → ${outLine}` : ""}`,
				kind: "bash",
				commandKey: cmd,
				tailIdx: bi,
			});
			continue;
		}

		// 3. Test failures in bash output
		if (b.kind === "bash" && b.output && TEST_FAIL_RE.test(b.output.slice(0, BASH_OUTPUT_SCAN_LIMIT))) {
			push({
				text: `[tests] ${firstLine(b.output, 150)}`,
				kind: "tests",
				commandKey: commandKeyOf(b.command),
				tailIdx: bi,
			});
			continue;
		}

		// 4. Tool errors — classify tsc/test failures before generic catch.
		// Empty grep/glob results are exploration, not outstanding work.
		if (b.kind === "tool_result" && b.isError) {
			const bashKey = isBashToolName(b.name) ? precedingBashCommandKey(tail, bi) : undefined;
			if (TSC_ERROR_RE.test(b.text)) {
				const tsLines = b.text
					.split("\n")
					.filter((l) => TSC_ERROR_RE.test(l.trim()))
					.slice(0, 3);
				for (const line of tsLines) {
					push({ text: `[tsc] ${clip(line.trim(), 150)}`, kind: "tsc", commandKey: bashKey, tailIdx: bi });
				}
				continue;
			}
			if (TEST_FAIL_RE.test(b.text)) {
				push({
					text: `[tests] ${firstLine(b.text, 150)}`,
					kind: "tests",
					commandKey: bashKey,
					tailIdx: bi,
				});
				continue;
			}
			push({
				text: `[${b.name}] ${firstLine(b.text, 150)}`,
				kind: bashKey ? "bash" : "other",
				commandKey: bashKey,
				tailIdx: bi,
			});
			continue;
		}

		// 5. BLOCKER_RE text matching (user/assistant mentions of problems)
		if (b.kind === "assistant" || b.kind === "user") {
			for (const line of nonEmptyLines(b.text)) {
				if (!BLOCKER_RE.test(line)) continue;
				if (line.length < 15) continue;
				if (/^\s*[-*+>]\s/.test(line)) continue;
				if (/^\s*\(/.test(line)) continue;
				if (!/^\s*["'`*_]?[A-Z`]/.test(line)) continue;
				const clipped = b.kind === "user" ? `[user] ${clipSentence(line, 150)}` : clipSentence(line, 150);
				push({ text: clipped, kind: "other", tailIdx: bi });
				break;
			}
		}
	}

	const live = items.filter((item) => {
		if (item.kind === "bash" || item.kind === "tests") {
			return !laterCommandCleared(commandEvents, item.commandKey, item.tailIdx);
		}
		if (item.kind === "tsc") {
			return !laterCommandCleared(commandEvents, item.commandKey, item.tailIdx, true);
		}
		return true;
	});

	// Resolution detection: pre-compute edit positions in the tail so we can
	// check whether tsc errors were subsequently fixed by an edit to the same file.
	const editPositions = new Map<number, Set<string>>();
	for (let i = 0; i < tail.length; i++) {
		const b = tail[i];
		if (b.kind === "tool_call" && FILE_EDIT_TOOLS.has(b.name)) {
			const path = extractPath(b.args);
			if (path) {
				if (!editPositions.has(i)) editPositions.set(i, new Set());
				editPositions.get(i)!.add(path);
			}
		}
	}

	return live.slice(0, 8).map((item) => {
		const file = extractTscFile(item.text);
		const resolved = item.tailIdx >= 0 && file !== null && isTscResolved(file, item.tailIdx, editPositions);
		if (!resolved) return priorityTag(item.text);
		return priorityTag(item.text).replace(/^\[(ERROR|WARN)\]/, "[RESOLVED]");
	});
};

const formatFileActivityFromUnified = (data: import("../extract/shared-symbols.js").UnifiedExtractResult): string[] => {
	const act = data.fileActivity;
	const formatCategory = (label: string, set: Set<string>): string | null => {
		if (set.size === 0) return null;
		const arr = [...set];
		const kept = arr.slice(0, 10);

		if (arr.length > 10) {
			const omitted = arr.slice(10);
			return `${label}: ${kept.join(", ")}, +recall: ${omitted.join(", ")}`;
		}
		return `${label}: ${kept.join(", ")}`;
	};

	const lines: string[] = [];
	const modLine = formatCategory("Modified", act.modified);
	if (modLine) lines.push(modLine);
	const createLine = formatCategory("Created", act.created);
	if (createLine) lines.push(createLine);
	const readLine = formatCategory("Read", act.read);
	if (readLine) lines.push(readLine);
	return lines;
};

const formatTypeCatalogFromUnified = (data: import("../extract/shared-symbols.js").UnifiedExtractResult): string[] => {
	const catalog = data.typeCatalog;
	if (catalog.length === 0) return [];
	const lines: string[] = [];
	let totalSigs = 0;
	const MAX_TOTAL_SIGS = 30;

	const omittedFiles: string[] = [];
	for (let i = 0; i < catalog.length; i++) {
		const entry = catalog[i];
		if (totalSigs >= MAX_TOTAL_SIGS) {
			omittedFiles.push(entry.file);
			continue;
		}
		lines.push(`${entry.file}:`);
		for (const sig of entry.signatures) {
			if (totalSigs >= MAX_TOTAL_SIGS) break;
			lines.push(`  ${sig}`);
			totalSigs++;
		}
	}
	if (omittedFiles.length > 0) {
		lines.push(`(${omittedFiles.length} more files with signatures omitted)`);
	}

	return lines;
};

export const buildSections = (input: BuildSectionsInput): SectionData => {
	const { blocks } = input;
	// Build tool-call → tool-result look-ahead index once, share across extractors.
	const tri = input.toolResultIndex ?? buildToolResultIndex(blocks);

	// Single-pass file and symbol extraction — replaces the triple-redundant
	// scan that extractFiles / extractSymbolChanges / extractTypeCatalog each
	// performed independently, each re-scanning the same tool results with
	// overlapping regex patterns.
	const fileAndSymbols = extractFileAndSymbolData(blocks, tri);

	const briefSections = buildBriefSections(blocks);
	const sessionGoal = extractGoals(blocks);
	const userPreferences = dedupPreferencesAgainstGoals(extractPreferences(blocks), sessionGoal);

	const turnSummaries = identifyTurns(blocks).map((t) => t.summary);
	const outstandingContext = extractOutstandingContext(blocks);

	const result: SectionData = {
		sessionGoal,
		outstandingContext,
		filesAndChanges: formatFileActivityFromUnified(fileAndSymbols),
		commits: formatCommits(extractCommits(blocks)),
		userPreferences,
		typeCatalog: formatTypeCatalogFromUnified(fileAndSymbols),
		symbolChanges: fileAndSymbols.symbolChanges,
		turnSummaries,
		briefTranscript: stringifyBrief(briefSections),
		transcriptEntries: sectionsToTranscript(briefSections),
	};

	return result;
};
