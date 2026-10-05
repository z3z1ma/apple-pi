import { writeFileSync } from "node:fs";
import type { BranchSearchConfig } from "./config.js";
import type { Gate, Judge, Scores } from "./judge.js";
import type { Candidate } from "./prompts.js";
import type { ApplyResult } from "./workspace.js";

/** `record.json`: what the report and a reviewer need to understand one search. */

export interface TokenCost {
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
}

export interface AttemptRecord {
	key: string;
	candidate: Candidate;
	/** How the attempt's run ended: on its own, stopped at a limit, or on a provider error. */
	stop: "done" | "limit" | "error" | null;
	commit: string | null;
	diffSize: number | null;
	/** Null until scored. */
	scores: Scores | null;
	/** Files the attempt changed under a protected path; they were put back to base before scoring. */
	protectedChanged: string[];
	cost: TokenCost & { ms: number };
}

export interface SearchRecord {
	id: string;
	goal: string;
	judges: Judge[];
	gates: Gate[];
	/** Paths put back to their base content in every attempt before scoring. */
	protect: string[];
	config: BranchSearchConfig;
	startedAt: string;
	endedAt: string | null;
	base: { commit: string; tree: string } | null;
	attempts: AttemptRecord[];
	/** With `judge.profile` and two or more qualifying attempts: the model's choice, or why it could not choose. */
	choice: { profile: string; winner: string | null; reason: string } | null;
	winner: string | null;
	apply: ApplyResult | null;
	outcome: string | null;
	abortReason: string | null;
	/** Every model request of the search: enumerator, attempts, and judge model. */
	cost: TokenCost & { ms: number };
	/** Cleanup steps that failed; empty when every worktree and extra ref is gone. */
	cleanupErrors: string[];
}

export function emptyCost(): TokenCost {
	return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
}

export function addUsage(
	cost: TokenCost,
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
): void {
	cost.inputTokens += usage.input;
	cost.outputTokens += usage.output;
	cost.cacheReadTokens += usage.cacheRead;
	cost.cacheWriteTokens += usage.cacheWrite;
}

export function writeRecord(path: string, record: SearchRecord): void {
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}
