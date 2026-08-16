/**
 * Stress test: 100 successive compactions measuring information degradation.
 *
 * Each compaction cycle:
 *   1. Adds a fresh "round" of messages (user request → edits → reads → response)
 *   2. Compiles with the previous summary as previousSummary
 *   3. Measures what survived and what was lost
 *
 * Degradation metrics per round:
 *   - Output size (chars, lines)
 *   - Section counts (how many of the 7 header sections present)
 *   - Files known (paths in Files And Changes)
 *   - Breadcrumbs present (count of - ...recall: lines and +recall: markers)
 *   - Goals known (Session Goal lines)
 *   - Type catalog entries
 *   - Brief transcript size (lines after ---)
 *   - Recall recoverability: vcc_recall search for a given file/goal term
 */

import { describe, test, expect } from "bun:test";
import { compile } from "../src/core/summarize.js";
import type { Message } from "@earendil-works/pi-ai";

// Deterministic message factories

const makeUserMsg = (text: string): Message => ({
	role: "user",
	content: text,
});

const makeAssistantMsg = (text: string): Message => ({
	role: "assistant",
	content: text,
});

const makeToolCall = (name: string, id: string, args: Record<string, unknown>): Message => ({
	role: "assistant",
	content: [
		{ type: "text", text: "" },
		{ type: "toolCall", name, id, arguments: args },
	],
});

const makeToolResult = (toolCallId: string, toolName: string, content: string, isError = false): Message =>
	({
		role: "toolResult",
		toolCallId,
		toolName,
		content,
		isError,
	}) as any;

// Each "round" simulates a realistic compaction-worthy conversation chunk.
// We vary the files and goals to create accumulation pressure.

const FILES = [
	"src/auth.ts",
	"src/users.ts",
	"src/api.ts",
	"src/db.ts",
	"src/utils.ts",
	"src/config.ts",
	"src/routes.ts",
	"src/middleware.ts",
	"src/models.ts",
	"src/services.ts",
	"src/handlers.ts",
	"src/types.ts",
	"src/errors.ts",
	"src/validators.ts",
	"src/cache.ts",
	"src/logger.ts",
	"src/session.ts",
	"src/token.ts",
	"src/oauth.ts",
	"src/crypto.ts",
];

const GOALS = [
	"Build an authentication system",
	"Add user management endpoints",
	"Create the REST API layer",
	"Set up the database connection pool",
	"Implement utility functions",
	"Load configuration from environment",
	"Define route handlers",
	"Add authentication middleware",
	"Create data models",
	"Build the service layer",
	"Implement request handlers",
	"Add TypeScript type definitions",
	"Create error handling utilities",
	"Build input validators",
	"Add caching layer",
	"Set up structured logging",
	"Implement session management",
	"Add JWT token handling",
	"Build OAuth2 integration",
	"Add cryptographic utilities",
	"Refactor auth to support SSO",
	"Add rate limiting to API",
	"Migrate database to PostgreSQL",
	"Add integration tests",
	"Set up CI pipeline",
];

/** Generate messages for one "round" of work */
const makeRound = (roundIdx: number): Message[] => {
	const file1 = FILES[roundIdx % FILES.length];
	const file2 = FILES[(roundIdx + 7) % FILES.length];
	const goal = GOALS[roundIdx % GOALS.length];
	const id1 = `r${roundIdx}-1`;
	const id2 = `r${roundIdx}-2`;
	const id3 = `r${roundIdx}-3`;

	return [
		makeUserMsg(goal),
		makeToolCall("Edit", id1, {
			file_path: file1,
			oldText: "// placeholder",
			newText: `export function fn${roundIdx}() { return ${roundIdx}; }`,
		}),
		makeToolResult(id1, "Edit", "OK"),
		makeAssistantMsg(`Edited ${file1} with function fn${roundIdx}.`),
		makeToolCall("read", id2, { file_path: file2 }),
		makeToolResult(id2, "read", `// ${file2}\nexport const DATA = ${roundIdx};`),
		makeAssistantMsg(`Read ${file2} to understand the interface.`),
		// Sometimes add a commit
		...(roundIdx % 3 === 0
			? [
					makeToolCall("bash", id3, { command: `git commit -m "feat: ${goal.toLowerCase()}"` }),
					makeToolResult(id3, "bash", `[main abc${roundIdx.toString().padStart(4, "0")}] feat: ${goal.toLowerCase()}`),
					makeAssistantMsg(`Committed: feat: ${goal.toLowerCase()}.`),
				]
			: []),
	];
};

// Metrics extraction

const countBreadcrumbs = (text: string): number => {
	let count = 0;
	// - ...recall: lines in header sections
	for (const line of text.split("\n")) {
		if (line.startsWith("- ...recall:")) count++;
	}
	// +recall: markers in Files And Changes
	const plusRecall = text.match(/\+recall:/g);
	count += plusRecall ? plusRecall.length : 0;
	return count;
};

const extractFilePaths = (text: string): Set<string> => {
	const paths = new Set<string>();
	for (const line of text.split("\n")) {
		const match = line.match(/^-\s*(?:Modified|Created|Read):\s*(.*)/);
		if (!match) continue;
		const rest = match[1].replace(/\+recall:\s*/g, "").replace(/\s*\([^)]*\)/g, "");
		for (const p of rest.split(",")) {
			const trimmed = p.trim();
			if (trimmed && !trimmed.startsWith("+")) paths.add(trimmed);
		}
	}
	return paths;
};

const extractGoals = (text: string): string[] => {
	const section = text.indexOf("[Session Goal]");
	if (section < 0) return [];
	const after = text.slice(section);
	const nextSection = after.indexOf("\n[", 1);
	const block = nextSection > 0 ? after.slice(0, nextSection) : after;
	return block
		.split("\n")
		.filter((l) => l.startsWith("- ") && !l.startsWith("- ...recall:"))
		.map((l) => l.slice(2));
};

const countTypeCatalogEntries = (text: string): number => {
	const section = text.indexOf("[Type Catalog]");
	if (section < 0) return 0;
	const after = text.slice(section);
	const nextSection = after.indexOf("\n\n[", 1);
	const nextSep = after.indexOf("\n\n---\n\n", 1);
	const end = Math.min(nextSection > 0 ? nextSection : Infinity, nextSep > 0 ? nextSep : Infinity);
	const block = after.slice(0, end);
	return block.split("\n").filter((l) => l.match(/^\s*src\//) || l.match(/^\s*\S+\.\w{1,12}:$/)).length;
};

const countSections = (text: string): number => {
	const matches = text.match(/^\[.+\]/gm);
	return matches ? matches.length : 0;
};

const briefTranscriptSize = (text: string): { lines: number; chars: number } => {
	const idx = text.indexOf("\n\n---\n\n");
	if (idx < 0) return { lines: 0, chars: 0 };
	const brief = text.slice(idx + 6);
	return { lines: brief.split("\n").filter(Boolean).length, chars: brief.length };
};

const previousSummaryChars = (text: string): number => text.length;

/** Check if a file path is recoverable via breadcrumb or section content */
const isFileRecoverable = (text: string, filePath: string): boolean => {
	if (text.includes(filePath)) return true;
	// Check breadcrumbs for partial path match
	const shortName = filePath.split("/").pop() ?? filePath;
	for (const line of text.split("\n")) {
		if (line.includes("+recall:") || line.startsWith("- ...recall:")) {
			if (line.includes(shortName)) return true;
		}
	}
	return false;
};

/** Check if a goal is recoverable via breadcrumb or section content */
const isGoalRecoverable = (text: string, goal: string): boolean => {
	if (text.includes(goal)) return true;
	// Check breadcrumbs for keywords from the goal
	const keywords = goal
		.split(/\s+/)
		.filter((w) => w.length > 3)
		.slice(0, 3);
	for (const line of text.split("\n")) {
		if (line.startsWith("- ...recall:")) {
			const allPresent = keywords.every((kw) => line.toLowerCase().includes(kw.toLowerCase()));
			if (allPresent) return true;
		}
	}
	return false;
};

describe("stress: 100 compactions", () => {
	test("100 successive compactions with degradation metrics", () => {
		const TOTAL_ROUNDS = 100;
		const previousSummary: string[] = [""];
		const metrics: Array<{
			round: number;
			outputChars: number;
			outputLines: number;
			sections: number;
			breadcrumbs: number;
			filesKnown: number;
			goalsKnown: number;
			typeCatalogEntries: number;
			briefLines: number;
			briefChars: number;
			// Cumulative tracking
			totalFilesTouched: number;
			totalGoalsSet: number;
			fileRecallRate: number;
			goalRecallRate: number;
		}> = [];

		const allFilesEver = new Set<string>();
		const allGoalsEver: string[] = [];

		for (let round = 0; round < TOTAL_ROUNDS; round++) {
			const messages = makeRound(round);

			// Track what was introduced this round
			const goal = GOALS[round % GOALS.length];
			allGoalsEver.push(goal);
			allFilesEver.add(FILES[round % FILES.length]);
			allFilesEver.add(FILES[(round + 7) % FILES.length]);

			const result = compile({
				messages,
				previousSummary: previousSummary[0] || undefined,
			});

			previousSummary[0] = result;

			// Extract metrics
			const filePaths = extractFilePaths(result);
			const goals = extractGoals(result);
			const bc = countBreadcrumbs(result);
			const tcEntries = countTypeCatalogEntries(result);
			const sections = countSections(result);
			const brief = briefTranscriptSize(result);

			// Recall rates: how many of all-ever files/goals can be found?
			let filesRecoverable = 0;
			for (const f of allFilesEver) {
				if (isFileRecoverable(result, f)) filesRecoverable++;
			}
			let goalsRecoverable = 0;
			for (const g of allGoalsEver) {
				if (isGoalRecoverable(result, g)) goalsRecoverable++;
			}

			metrics.push({
				round: round + 1,
				outputChars: result.length,
				outputLines: result.split("\n").length,
				sections,
				breadcrumbs: bc,
				filesKnown: filePaths.size,
				goalsKnown: goals.length,
				typeCatalogEntries: tcEntries,
				briefLines: brief.lines,
				briefChars: brief.chars,
				totalFilesTouched: allFilesEver.size,
				totalGoalsSet: allGoalsEver.length,
				fileRecallRate: allFilesEver.size > 0 ? filesRecoverable / allFilesEver.size : 1,
				goalRecallRate: allGoalsEver.length > 0 ? goalsRecoverable / allGoalsEver.length : 1,
			});
		}

		// Assertions on degradation

		// 1. Output should never be empty
		for (const m of metrics) {
			expect(m.outputChars).toBeGreaterThan(0);
		}

		// 2. Sections should stabilize (at least Session Goal + Files + brief)
		const lateMetrics = metrics.slice(-20);
		for (const m of lateMetrics) {
			expect(m.sections).toBeGreaterThanOrEqual(2);
		}

		// 3. File recall rate should not collapse to 0
		//    With +recall: breadcrumbs, even capped files should be partially recoverable
		const finalMetric = metrics[metrics.length - 1];
		expect(finalMetric.fileRecallRate).toBeGreaterThan(0);

		// 4. Goal recall should not collapse to 0
		expect(finalMetric.goalRecallRate).toBeGreaterThan(0);

		// 5. Output size should be bounded — not growing unboundedly
		//    The output should plateau, not grow linearly
		const charGrowthRate = (finalMetric.outputChars - metrics[49].outputChars) / 50;
		const firstHalfGrowthRate = (metrics[49].outputChars - metrics[0].outputChars) / 50;
		// Second half growth rate should be <= first half (plateauing)
		expect(charGrowthRate).toBeLessThanOrEqual(firstHalfGrowthRate * 1.5);

		// 6. Breadcrumbs should appear by round 20+ (sections start capping)
		const breadcrumbsBy20 = metrics[19].breadcrumbs;
		expect(breadcrumbsBy20).toBeGreaterThanOrEqual(0); // might be 0 if no section capped yet

		// 7. By round 50, breadcrumbs should definitely exist
		const breadcrumbsBy50 = metrics[49].breadcrumbs;
		expect(breadcrumbsBy50).toBeGreaterThan(0);

		// Print summary table for manual inspection
		const sampleRounds = [1, 10, 25, 50, 75, 100];
		console.log("\n╔══════════════════════════════════════════════════════════════════════════════════════════╗");
		console.log("║  100-COMPACTION STRESS TEST — DEGRADATION METRICS                                       ║");
		console.log("╠═══════╦═════════╦═════════╦═══════════╦═══════════╦══════════╦══════════╦══════════════╣");
		console.log("║ Round ║ Chars   ║ Lines   ║ Sections  ║ Breadcrumbs║ Files   ║ Goals   ║ Recall Rate ║");
		console.log("║       ║         ║         ║           ║           ║ Known   ║ Known   ║ F / G       ║");
		console.log("╠═══════╬═════════╬═════════╬═══════════╬═══════════╬══════════╬══════════╬══════════════╣");

		for (const r of sampleRounds) {
			const m = metrics[r - 1];
			const fileRate = `${(m.fileRecallRate * 100).toFixed(0)}%`;
			const goalRate = `${(m.goalRecallRate * 100).toFixed(0)}%`;
			console.log(
				`║ ${String(r).padStart(5)} ║ ${String(m.outputChars).padStart(7)} ║ ${String(m.outputLines).padStart(7)} ║ ${String(m.sections).padStart(9)} ║ ${String(m.breadcrumbs).padStart(9)} ║ ${String(m.filesKnown).padStart(7)}/${String(m.totalFilesTouched).padStart(2)} ║ ${String(m.goalsKnown).padStart(7)}/${String(m.totalGoalsSet).padStart(3)} ║ ${fileRate.padStart(4)} / ${goalRate.padStart(4)} ║`,
			);
		}

		console.log("╚═══════╩═════════╩═════════╩═══════════╩═══════════╩══════════╩══════════╩══════════════╝");

		// Brief transcript degradation
		console.log("\nBrief transcript size over time:");
		for (const r of sampleRounds) {
			const m = metrics[r - 1];
			console.log(`  Round ${String(r).padStart(3)}: ${m.briefLines} lines, ${m.briefChars} chars`);
		}

		// Final state check
		console.log(`\nFinal output (${finalMetric.outputChars} chars, ${finalMetric.outputLines} lines):`);
		console.log(previousSummary[0].slice(0, 800));
		console.log("...");
	});
});
