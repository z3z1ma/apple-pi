import { writeFileSync } from "node:fs";
import type { BranchSearchConfig } from "./config.js";
import type { Gate, Judge, Scores } from "./judge.js";
import type { Candidate } from "./prompts.js";
import type { ApplyResult } from "./workspace.js";

export interface TokenCost {
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
}

export interface AttemptRecord {
	key: string;
	candidate: Candidate;
	stop: "done" | "limit" | "error" | null;
	commit: string | null;
	diffSize: number | null;
	scores: Scores | null;
	protectedChanged: string[];
	cost: TokenCost & { ms: number };
}

export interface SearchRecord {
	id: string;
	goal: string;
	judges: Judge[];
	gates: Gate[];
	protect: string[];
	config: BranchSearchConfig;
	startedAt: string;
	endedAt: string | null;
	base: { commit: string; tree: string } | null;
	attempts: AttemptRecord[];
	choice: { profile: string; winner: string | null; reason: string } | null;
	winner: string | null;
	apply: ApplyResult | null;
	outcome: string | null;
	abortReason: string | null;
	cost: TokenCost & { ms: number };
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
