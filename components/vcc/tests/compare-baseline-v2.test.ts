/**
 * Baseline vs (1) context-drop + (2) causal-breadcrumbs comparison test.
 *
 * Produces concrete deterministic metrics for three configurations:
 *   BASELINE — current pi-vcc as-is
 *   V2       — causal turn summaries + causal breadcrumbs
 *
 * Both run identical message sequences through 20 compactions.
 * Metrics: goal recovery, file recovery, goal→file linkage,
 * causal-chain preservation, output size, breadcrumb quality.
 *
 * Run: bun test tests/compare-baseline-v2.test.ts
 */

import { describe, test, expect } from "bun:test";
import { compile } from "../src/core/summarize.js";
import type { Message } from "@earendil-works/pi-ai";

// ── Deterministic message factories ──

const ts = Date.now();
const assistBase = {
	api: "messages" as any,
	provider: "anthropic" as any,
	model: "test",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	timestamp: ts,
};

const makeUserMsg = (text: string): Message => ({
	role: "user",
	content: text,
	timestamp: ts,
});

const makeAssistantMsg = (text: string): Message => ({
	role: "assistant",
	content: [{ type: "text", text }],
	...assistBase,
	stopReason: "stop",
});

const makeToolCall = (name: string, id: string, args: Record<string, unknown>): Message => ({
	role: "assistant",
	content: [
		{ type: "text", text: "" },
		{ type: "toolCall", name, id, arguments: args },
	],
	...assistBase,
	stopReason: "toolUse",
});

const makeToolResult = (toolCallId: string, toolName: string, content: string, isError = false): Message =>
	({
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: content }],
		isError,
		timestamp: ts,
	}) as any;

// ── Realistic conversation rounds ──
// Each round simulates a full debug/implement cycle with causal chains.

interface RoundSpec {
	goal: string;
	cause: string; // what's wrong / why the work is needed
	resolution: string; // what was done to fix it
	file1: string;
	file2: string;
	hasCommit: boolean;
	testPasses: boolean;
	errorInOutput: boolean;
}

const ROUNDS: RoundSpec[] = [
	{
		goal: "Fix login bug",
		cause: "refreshToken() returns early on empty sessions",
		resolution: "added session check in refreshToken",
		file1: "src/auth.ts",
		file2: "src/session.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Fix signup validation",
		cause: "email validator rejects valid addresses with + signs",
		resolution: "switched to RFC 5322 regex",
		file1: "src/validators.ts",
		file2: "src/users.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Add password reset",
		cause: "users can't recover accounts without admin help",
		resolution: "added reset flow with rate limiter",
		file1: "src/reset.ts",
		file2: "src/middleware.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Fix race condition in token refresh",
		cause: "concurrent requests double-refresh the token",
		resolution: "added mutex lock around refresh path",
		file1: "src/auth.ts",
		file2: "src/token.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Add rate limiter to API",
		cause: "unauthenticated endpoints are being scraped",
		resolution: "added sliding window rate limiter middleware",
		file1: "src/middleware.ts",
		file2: "src/config.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Migrate to PostgreSQL",
		cause: "SQLite can't handle concurrent writes",
		resolution: "swapped driver to pg, updated connection pool",
		file1: "src/db.ts",
		file2: "src/config.ts",
		hasCommit: true,
		testPasses: false,
		errorInOutput: true,
	},
	{
		goal: "Fix flaky integration tests",
		cause: "tests share state via global singleton",
		resolution: "isolated test fixtures per suite",
		file1: "tests/auth.test.ts",
		file2: "tests/setup.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Refactor auth middleware",
		cause: "middleware has 300-line function doing auth + routing + logging",
		resolution: "split into auth, routing, logging layers",
		file1: "src/middleware.ts",
		file2: "src/logger.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Extract session handler",
		cause: "session logic mixed into route handlers",
		resolution: "extracted SessionHandler class",
		file1: "src/session.ts",
		file2: "src/routes.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Add OAuth2 integration",
		cause: "users want Google SSO login",
		resolution: "added OAuth2 strategy with PKCE flow",
		file1: "src/oauth.ts",
		file2: "src/auth.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Fix token expiry on slow connections",
		cause: "token expires during long API calls",
		resolution: "added client-side token refresh with 30s buffer",
		file1: "src/token.ts",
		file2: "src/api.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Add crypto utilities",
		cause: "password hashing uses outdated bcrypt rounds",
		resolution: "migrated to argon2id with adaptive cost",
		file1: "src/crypto.ts",
		file2: "src/validators.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Set up structured logging",
		cause: "console.log calls scattered everywhere, no correlation IDs",
		resolution: "added pino logger with request ID middleware",
		file1: "src/logger.ts",
		file2: "src/middleware.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Fix memory leak in connection pool",
		cause: "connections not returned to pool on error paths",
		resolution: "added try/finally release in all query paths",
		file1: "src/db.ts",
		file2: "src/services.ts",
		hasCommit: true,
		testPasses: false,
		errorInOutput: true,
	},
	{
		goal: "Add input validators for API",
		cause: "API accepts malformed payloads causing 500s downstream",
		resolution: "added zod schemas for all endpoints",
		file1: "src/validators.ts",
		file2: "src/routes.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Implement caching layer",
		cause: "repeated DB queries for user profile on every request",
		resolution: "added Redis cache with TTL-based invalidation",
		file1: "src/cache.ts",
		file2: "src/services.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Add type definitions",
		cause: "any-casts causing runtime errors in production",
		resolution: "added strict interfaces for all service boundaries",
		file1: "src/types.ts",
		file2: "src/models.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Fix error handling utilities",
		cause: "errors swallowed silently, no stack traces in logs",
		resolution: "added AppError class with cause chain",
		file1: "src/errors.ts",
		file2: "src/logger.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Build request handlers",
		cause: "route handlers directly call DB, no abstraction",
		resolution: "extracted handler layer with dependency injection",
		file1: "src/handlers.ts",
		file2: "src/services.ts",
		hasCommit: false,
		testPasses: true,
		errorInOutput: false,
	},
	{
		goal: "Fix CSRF protection",
		cause: "CSRF token not validated on mutation requests",
		resolution: "added double-submit cookie pattern",
		file1: "src/middleware.ts",
		file2: "src/routes.ts",
		hasCommit: true,
		testPasses: true,
		errorInOutput: false,
	},
];

/** Generate messages for one round — realistic causal chain */
const makeRound = (roundIdx: number): Message[] => {
	const spec = ROUNDS[roundIdx % ROUNDS.length];
	const id1 = `r${roundIdx}-1`;
	const id2 = `r${roundIdx}-2`;
	const id3 = `r${roundIdx}-3`;
	const id4 = `r${roundIdx}-4`;
	const id5 = `r${roundIdx}-5`;

	const msgs: Message[] = [
		makeUserMsg(spec.goal),
		makeToolCall("Read", id1, { file_path: spec.file1 }),
		makeToolResult(id1, "Read", `// ${spec.file1}\nexport function fn() { /* existing code */ }\n`),
		makeAssistantMsg(`The issue is ${spec.cause}. I'll fix this by ${spec.resolution}.`),
		makeToolCall("Edit", id2, {
			file_path: spec.file1,
			oldText: "// existing code",
			newText: `// ${spec.resolution}\nexport function fixed() { return true; }\n`,
		}),
		makeToolResult(id2, "Edit", "OK"),
	];

	if (spec.errorInOutput) {
		msgs.push(
			makeToolCall("bash", id3, { command: `npm test -- ${spec.file1}` }),
			makeToolResult(id3, "bash", `FAIL ${spec.file1}\n  ✗ ${spec.cause}\n  exit code 1`, true),
			makeAssistantMsg(`Test failed: ${spec.cause}. Retrying with a different approach.`),
			makeToolCall("Edit", id4, {
				file_path: spec.file1,
				oldText: "return true;",
				newText: "return false; // workaround",
			}),
			makeToolResult(id4, "Edit", "OK"),
		);
	}

	msgs.push(
		makeToolCall("read", id5, { file_path: spec.file2 }),
		makeToolResult(id5, "read", `// ${spec.file2}\nexport const DATA = ${roundIdx};\n`),
	);

	if (spec.hasCommit) {
		msgs.push(
			makeToolCall("bash", `r${roundIdx}-6`, { command: `git commit -m "feat: ${spec.goal.toLowerCase()}" ` }),
			makeToolResult(
				`r${roundIdx}-6`,
				"bash",
				`[main abc${String(roundIdx).padStart(4, "0")}] feat: ${spec.goal.toLowerCase()}`,
			),
		);
	}

	if (spec.testPasses) {
		msgs.push(makeAssistantMsg(`All tests pass. ${spec.resolution} is working correctly.`));
	}

	return msgs;
};

// ── Metric extraction helpers ──

interface Metrics {
	round: number;
	outputChars: number;
	outputLines: number;
	sections: number;
	breadcrumbs: number;
	filesKnown: number;
	goalsKnown: number;
	goalsDirectlyPresent: number;
	goalRecoveryRate: number;
	fileRecoveryRate: number;
	linkageRate: number;
	causalChainRate: number;
	briefLines: number;
	briefChars: number;
	totalFilesTouched: number;
	totalGoalsSet: number;
}

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

const extractExplicitGoals = (text: string): string[] => {
	const section = text.indexOf("[Session Goal]");
	if (section < 0) return [];
	const after = text.slice(section);
	const nextSection = after.indexOf("\n[", 1);
	const nextSep = after.indexOf("\n\n---\n\n", 1);
	const end = Math.min(nextSection > 0 ? nextSection : Infinity, nextSep > 0 ? nextSep : Infinity);
	const block = after.slice(0, end);
	return block
		.split("\n")
		.filter((l) => l.startsWith("- ") && !l.startsWith("- ...recall:"))
		.map((l) => l.slice(2));
};

const countBreadcrumbs = (text: string): number => {
	let count = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("- ...recall:")) count++;
	}
	const plusRecall = text.match(/\+recall:/g);
	count += plusRecall ? plusRecall.length : 0;
	return count;
};

const countSections = (text: string): number => {
	const matches = text.match(/^\[.+\]/gm);
	return matches ? matches.length : 0;
};

/** Can we recover a specific goal from the summary (directly or via breadcrumb)? */
const isGoalRecoverable = (text: string, goal: string): boolean => {
	if (text.includes(goal)) return true;
	const keywords = goal
		.split(/\s+/)
		.filter((w) => w.length > 3)
		.slice(0, 3);
	for (const line of text.split("\n")) {
		if (line.startsWith("- ...recall:")) {
			if (keywords.every((kw) => line.toLowerCase().includes(kw.toLowerCase()))) return true;
		}
	}
	return false;
};

/** Can we recover a specific file path? */
const isFileRecoverable = (text: string, filePath: string): boolean => {
	if (text.includes(filePath)) return true;
	const shortName = filePath.split("/").pop() ?? filePath;
	for (const line of text.split("\n")) {
		if (line.includes("+recall:") || line.startsWith("- ...recall:")) {
			if (line.includes(shortName)) return true;
		}
	}
	return false;
};

/**
 * Can we link a goal to its file in the summary?
 * Without recall: only if goal text (or core keywords) and file path
 * appear on the same line or in adjacent lines of Earlier Turns / brief.
 */
const isGoalFileLinked = (text: string, goal: string, file: string): boolean => {
	// Check Earlier Turns for combined lines like "fix login bug → edited auth.ts"
	const turnsIdx = text.indexOf("[Earlier Turns]");
	if (turnsIdx >= 0) {
		const after = text.slice(turnsIdx);
		const end = after.indexOf("\n\n---\n\n", 1);
		const nextSection = after.indexOf("\n\n[", 1);
		const block = after.slice(0, Math.min(end > 0 ? end : Infinity, nextSection > 0 ? nextSection : Infinity));
		for (const line of block.split("\n")) {
			if (line.startsWith("- ...recall:")) continue;
			const goalKeywords = goal
				.split(/\s+/)
				.filter((w) => w.length > 3)
				.slice(0, 2);
			const hasGoal = goalKeywords.some((kw) => line.toLowerCase().includes(kw.toLowerCase()));
			const shortName = file.split("/").pop() ?? file;
			const hasFile = line.includes(file) || line.includes(shortName);
			if (hasGoal && hasFile) return true;
		}
	}

	// Check brief transcript for adjacency
	const briefIdx = text.indexOf("\n\n---\n\n");
	if (briefIdx < 0) return false;
	const brief = text.slice(briefIdx + 6);
	const lines = brief.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const goalKeywords = goal
			.split(/\s+/)
			.filter((w) => w.length > 3)
			.slice(0, 2);
		const lineHasGoal = goalKeywords.some((kw) => lines[i].toLowerCase().includes(kw.toLowerCase()));
		if (lineHasGoal) {
			const nearby = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 5));
			const shortName = file.split("/").pop() ?? file;
			if (nearby.some((l) => l.includes(file) || l.includes(shortName))) return true;
		}
	}
	return false;
};

/**
 * Can we recover the CAUSAL CHAIN for a round from the summary?
 * A causal chain is present if the summary contains both:
 *   1. The cause ("why") — e.g. "refreshToken returns early"
 *   2. The resolution ("what was done") — e.g. "added session check"
 *
 * We check:
 *   - Direct text presence
 *   - Causal breadcrumbs (...recall: file|resolution-key)
 */
const isCausalChainPresent = (text: string, spec: RoundSpec): boolean => {
	const causeWords = spec.cause
		.replace(/[()]/g, " ")
		.split(/\s+/)
		.filter(
			(w) =>
				w.length > 3 &&
				!/^(the|this|that|with|from|into|over|under|before|after|during|because|since|where|which|their|these|those|been|being|have|has|had|will|would|could|should|without|through|between)$/i.test(
					w,
				),
		);

	const resolutionWords = spec.resolution
		.replace(/[()]/g, " ")
		.split(/\s+/)
		.filter(
			(w) =>
				w.length > 3 &&
				!/^(the|this|that|with|from|into|over|under|before|after|during|because|since|where|which|their|these|those|been|being|have|has|had|will|would|could|should|without|through|between)$/i.test(
					w,
				),
		);

	// Direct text presence
	const hasCauseDirect = causeWords.some((w) => text.toLowerCase().includes(w.toLowerCase()));
	const hasResolutionDirect = resolutionWords.some((w) => text.toLowerCase().includes(w.toLowerCase()));

	if (hasCauseDirect && hasResolutionDirect) return true;

	// Causal breadcrumb: ...recall: file|resolution-key
	// Check if the resolution key appears in a breadcrumb
	const resolutionKeyWords = spec.resolution
		.split(/\s+/)
		.filter((w) => w.length > 3)
		.slice(0, 2);

	const causeKeyWords = spec.cause
		.split(/\s+/)
		.filter(
			(w) =>
				w.length > 3 &&
				!/^(the|this|that|with|from|into|over|under|before|after|during|because|since|where|which|their|these|those|been|being|have|has|had|will|would|could|should|without|through|between)$/i.test(
					w,
				),
		)
		.slice(0, 2);

	// Check ...recall: breadcrumbs for the file with a causal key
	const file1Short = spec.file1.split("/").pop() ?? spec.file1;
	const file2Short = spec.file2.split("/").pop() ?? spec.file2;
	for (const line of text.split("\n")) {
		if (!line.includes("...recall:")) continue;
		const bcContent = line.slice(line.indexOf("...recall:") + 10);
		// Check if the breadcrumb references our file
		const hasFile = bcContent.includes(file1Short) || bcContent.includes(file2Short);
		// Check if the breadcrumb contains a resolution or cause key
		const bcParts = bcContent.split(", ");
		for (const bcPart of bcParts) {
			// Causal breadcrumb: "file|resolution-key"
			if (bcPart.includes("|")) {
				const [, key] = bcPart.split("|");
				const keyWords = key.split("-");
				const hasResKey = resolutionKeyWords.some((rw) => keyWords.some((kw) => kw.toLowerCase() === rw.toLowerCase()));
				const hasCauKey = causeKeyWords.some((cw) => keyWords.some((kw) => kw.toLowerCase() === cw.toLowerCase()));
				if ((hasResKey || hasCauKey) && (hasFile || !hasCauseDirect)) return true;
			}
		}
	}

	// Partial: if only one side is found, count as partial
	return false;
};

/** Run N compactions and return per-round metrics */
const runCompactionSeries = (totalRounds: number): Metrics[] => {
	let prev = "";
	const metrics: Metrics[] = [];
	const allFiles = new Set<string>();
	const allGoals: string[] = [];

	for (let round = 0; round < totalRounds; round++) {
		const spec = ROUNDS[round % ROUNDS.length];
		const msgs = makeRound(round);

		allGoals.push(spec.goal);
		allFiles.add(spec.file1);
		allFiles.add(spec.file2);

		const result = compile({
			messages: msgs,
			previousSummary: prev || undefined,
		});

		prev = result;

		const filePaths = extractFilePaths(result);
		const goals = extractExplicitGoals(result);
		const bc = countBreadcrumbs(result);
		const sections = countSections(result);

		const briefIdx = result.indexOf("\n\n---\n\n");
		const brief = briefIdx >= 0 ? result.slice(briefIdx + 6) : "";
		const briefLines = brief.split("\n").filter(Boolean).length;
		const briefChars = brief.length;

		// Recovery rates
		let filesRecoverable = 0;
		for (const f of allFiles) {
			if (isFileRecoverable(result, f)) filesRecoverable++;
		}
		let goalsRecoverable = 0;
		let goalsDirectlyPresent = 0;
		for (const g of allGoals) {
			if (isGoalRecoverable(result, g)) goalsRecoverable++;
			if (result.includes(g)) goalsDirectlyPresent++;
		}

		// Goal→file linkage
		let linked = 0;
		for (const spec2 of ROUNDS.slice(0, round + 1)) {
			if (isGoalFileLinked(result, spec2.goal, spec2.file1)) linked++;
		}

		// Causal chain preservation
		let causalChains = 0;
		for (let r = 0; r <= round; r++) {
			if (isCausalChainPresent(result, ROUNDS[r % ROUNDS.length])) causalChains++;
		}

		metrics.push({
			round: round + 1,
			outputChars: result.length,
			outputLines: result.split("\n").length,
			sections,
			breadcrumbs: bc,
			filesKnown: filePaths.size,
			goalsKnown: goals.length,
			goalsDirectlyPresent,
			goalRecoveryRate: allGoals.length > 0 ? goalsRecoverable / allGoals.length : 1,
			fileRecoveryRate: allFiles.size > 0 ? filesRecoverable / allFiles.size : 1,
			linkageRate: round + 1 > 0 ? linked / (round + 1) : 1,
			causalChainRate: round + 1 > 0 ? causalChains / (round + 1) : 1,
			briefLines,
			briefChars,
			totalFilesTouched: allFiles.size,
			totalGoalsSet: allGoals.length,
		});
	}

	return metrics;
};

// ── Tests ──

const TOTAL_ROUNDS = 20;

describe("baseline vs v2 comparison", () => {
	test("baseline: 20 compactions with degradation metrics", () => {
		const metrics = runCompactionSeries(TOTAL_ROUNDS);

		// Assertions
		for (const m of metrics) {
			expect(m.outputChars).toBeGreaterThan(0);
		}

		const final = metrics[metrics.length - 1];

		// Print comparison table
		console.log(
			"\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗",
		);
		console.log(
			"║  BASELINE — 20 COMPACTIONS (current pi-vcc)                                                                                     ║",
		);
		console.log(
			"╠═══════╦═════════╦════════╦═══════════╦═══════════╦═══════════╦═══════════╦════════════╦════════════╦════════════╣",
		);
		console.log(
			"║ Round ║ Chars   ║ Lines  ║ Sections  ║ Breadcrumbs║ Goals    ║ Files     ║ Goal Rec  ║ Linkage   ║ Causal    ║",
		);
		console.log(
			"║       ║         ║        ║           ║           ║ Direct   ║ Known     ║ Rate      ║ Rate      ║ Rate      ║",
		);
		console.log(
			"╠═══════╬═════════╬════════╬═══════════╬═══════════╬═══════════╬═══════════╬════════════╬════════════╬════════════╣",
		);

		const sampleRounds = [1, 2, 5, 10, 15, 20];
		for (const r of sampleRounds) {
			const m = metrics[r - 1];
			const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;
			console.log(
				`║ ${String(r).padStart(5)} ║ ${String(m.outputChars).padStart(7)} ║ ${String(m.outputLines).padStart(6)} ║ ${String(m.sections).padStart(9)} ║ ${String(m.breadcrumbs).padStart(9)} ║ ${String(m.goalsDirectlyPresent).padStart(6)}/${String(m.totalGoalsSet).padStart(2)} ║ ${String(m.filesKnown).padStart(6)}/${String(m.totalFilesTouched).padStart(2)} ║ ${pct(m.goalRecoveryRate).padStart(9)} ║ ${pct(m.linkageRate).padStart(9)} ║ ${pct(m.causalChainRate).padStart(9)} ║`,
			);
		}

		console.log(
			"╚═══════╩═════════╩════════╩═══════════╩═══════════╩═══════════╩═══════════╩════════════╩════════════╩════════════╝",
		);

		// Print full degradation curve
		console.log("\nFULL DEGRADATION CURVE (all 20 rounds):");
		console.log("Round | GoalRec | FileRec | Linkage | Causal | Chars");
		for (const m of metrics) {
			const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;
			console.log(
				`  ${String(m.round).padStart(2)}   | ${pct(m.goalRecoveryRate)} | ${pct(m.fileRecoveryRate)} | ${pct(m.linkageRate)} | ${pct(m.causalChainRate)} | ${String(m.outputChars).padStart(5)}`,
			);
		}

		// Re-run just the last round to get the summary
		let prevSummary = "";
		for (let i = 0; i < 20; i++) {
			const result = compile({
				messages: makeRound(i),
				previousSummary: prevSummary || undefined,
			});
			prevSummary = result;
		}

		// Extract and print key sections
		for (const sectionName of ["Session Goal", "Earlier Turns", "Files And Changes"]) {
			const idx = prevSummary.indexOf(`[${sectionName}]`);
			if (idx < 0) {
				console.log(`\n[${sectionName}] — NOT PRESENT`);
				continue;
			}
			const after = prevSummary.slice(idx);
			const end = after.indexOf("\n\n[", 1);
			const end2 = after.indexOf("\n\n---\n\n", 1);
			const block = after.slice(0, Math.min(end > 0 ? end : Infinity, end2 > 0 ? end2 : Infinity));
			console.log(`\n[${sectionName}] — ${block.split("\n").length} lines:`);
			console.log(block);
		}

		// Causal chain analysis: what's preserved vs what's lost
		console.log("\n=== CAUSAL CHAIN ANALYSIS (round 20) ===");
		for (const spec of ROUNDS) {
			const hasCause = spec.cause
				.split(/\s+/)
				.filter((w) => w.length > 3)
				.some((w) => prevSummary.toLowerCase().includes(w.toLowerCase()));
			const hasResolution = spec.resolution
				.split(/\s+/)
				.filter((w) => w.length > 3)
				.some((w) => prevSummary.toLowerCase().includes(w.toLowerCase()));
			const chain = hasCause && hasResolution;
			console.log(`  ${chain ? "✓" : "✗"} ${spec.goal}`);
			if (!chain) {
				console.log(`      cause: ${hasCause ? "✓" : "✗"} "${spec.cause}"`);
				console.log(`      resol: ${hasResolution ? "✓" : "✗"} "${spec.resolution}"`);
			}
		}

		// Structural checks
		expect(final.outputChars).toBeGreaterThan(0);
		expect(final.sections).toBeGreaterThanOrEqual(2);
	});

	test("determinism: identical inputs produce identical outputs", () => {
		const m1 = runCompactionSeries(20);
		const m2 = runCompactionSeries(20);
		for (let i = 0; i < m1.length; i++) {
			expect(m1[i].outputChars).toBe(m2[i].outputChars);
			expect(m1[i].goalRecoveryRate).toBe(m2[i].goalRecoveryRate);
			expect(m1[i].causalChainRate).toBe(m2[i].causalChainRate);
		}
	});

	test("idempotency: re-compiling same previous summary produces same result", () => {
		let prev = "";
		for (let i = 0; i < 10; i++) {
			prev = compile({
				messages: makeRound(i),
				previousSummary: prev || undefined,
			});
		}
		const r1 = compile({ messages: makeRound(10), previousSummary: prev });
		const r2 = compile({ messages: makeRound(10), previousSummary: prev });
		expect(r1).toBe(r2);
	});
});
