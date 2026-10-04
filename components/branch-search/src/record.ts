import { writeFileSync } from "node:fs";
import type { BranchSearchConfig } from "./config.js";
import type { Candidate, NodeKey, Step } from "./plan.js";
import type { GateResult, ObjectiveResult } from "./scorer.js";
import type { ApplyResult } from "./workspace.js";

/** Search records (spec 12): a replay world that a reviewer can read to reconstruct the search. */

export interface TokenCost {
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
}

export interface EnumerationRecord {
	key: string;
	candidates: Candidate[];
	preferred: string;
	attempts: number;
	cost: TokenCost & { ms: number };
}

export type BranchSelfReport = "done" | "abandoned" | "unknown" | "limit" | "error";

export interface BranchRecord {
	key: NodeKey;
	generation: number;
	parent: NodeKey | null;
	candidate: string;
	constraint: string;
	startSeq: number;
	endSeq: number | null;
	startCommit: string;
	commit: string | null;
	selfReport: BranchSelfReport | null;
	learned: string | null;
	cost: TokenCost & { runMs: number; scoreMs: number };
}

/** What scoring revealed about a branch. Held in memory until the last branch of the search stops (spec 8.4). */
export interface BranchScore {
	gates: Record<string, GateResult["result"]>;
	gateOutput: Record<string, { exitCode: number | null; stdout: string; stderr: string; ms: number }>;
	gatesPassed: number;
	status: "survived" | "dead";
	/** Measured values in declared order, then `diff_size`; a failed objective has no value. */
	objectives: Record<string, number>;
	/** Every objective that ran: its values, why it failed, and its last run's output. */
	objectiveOutput: Record<string, Omit<ObjectiveResult, "id" | "value">>;
}

/** One validation of the spec on the base (spec 6.3). */
export interface ValidationRecord {
	attempt: number;
	ok: boolean;
	report: string;
	ms: number;
}

export interface SearchRecord {
	id: string;
	goal: string | null;
	seed: string;
	startedAt: string;
	endedAt: string | null;
	config: BranchSearchConfig;
	base: { commit: string; tree: string } | null;
	spec: {
		sha256: string;
		path: string;
		validation: ValidationRecord[];
		/** Median base value of each objective (spec 6.3 step 3). */
		baseValues: Record<string, number>;
	} | null;
	cost: { total: TokenCost; ms: number };
	enumerations: EnumerationRecord[];
	steps: { seq: number; step: Step }[];
	branches: (BranchRecord & Partial<BranchScore>)[];
	parentTreeChecks: { phase: string; tree: string }[];
	winner: NodeKey | null;
	/** How apply went for a winner (spec 6.9); null when there was none. */
	apply: ApplyResult | null;
	outcome: string | null;
	abortReason: string | null;
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

export function sumCosts(costs: TokenCost[]): TokenCost {
	const total = emptyCost();
	for (const cost of costs) {
		total.inputTokens += cost.inputTokens;
		total.outputTokens += cost.outputTokens;
		total.cacheReadTokens += cost.cacheReadTokens;
		total.cacheWriteTokens += cost.cacheWriteTokens;
	}
	return total;
}

export function writeRecord(path: string, record: SearchRecord): void {
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}
