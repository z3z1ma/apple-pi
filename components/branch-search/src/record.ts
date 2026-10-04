import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BranchSearchConfig } from "./config.js";
import type { Candidate, NodeKey, Step } from "./plan.js";
import { type GateResult, type ObjectiveResult, parseScorerSpec, type ScorerSpec } from "./scorer.js";
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

export type BranchSelfReport = "done" | "abandoned" | "unknown" | "limit" | "stalled" | "error";

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

/** The optional scorer review (spec 6.2, 10.5). */
export interface ReviewRecord {
	profile: string;
	/** `error` when the request failed or its reply could not be used; the author's spec then stands. */
	verdict: "confirm" | "refine" | "error";
	reason: string | null;
	/** Whether a refined spec passed validation and replaced the author's. */
	applied: boolean;
	ms: number;
}

export type SearchMode = "human" | "agent" | "passive";

export interface SearchRecord {
	id: string;
	mode: SearchMode;
	goal: string | null;
	/** The repeatedly failing command that started a passive search (spec 5.3); null otherwise. */
	seedGate: string | null;
	seed: string;
	startedAt: string;
	endedAt: string | null;
	config: BranchSearchConfig;
	base: { commit: string; tree: string } | null;
	/**
	 * Written with only the frozen spec's `sha256` and `path` before the enumerator starts (spec I1).
	 * The rest is scorer content and joins when the last branch has stopped (spec 8.4). A search
	 * that never froze a spec stores the last spec it validated, if any, with that spec's hash.
	 */
	spec: {
		sha256: string | null;
		path: string | null;
		validation: ValidationRecord[];
		review: ReviewRecord | null;
		/** Median base value of each objective (spec 6.3 step 3). */
		baseValues: Record<string, number>;
	} | null;
	cost: {
		total: TokenCost;
		author: (TokenCost & { ms: number }) | null;
		/** The scorer review request (spec 6.2, 10.5); null without a review profile. */
		review: (TokenCost & { ms: number }) | null;
		ms: number;
	};
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

/** Outcomes of searches that ran to a decision: the records replay can use as worlds (spec 18.1). */
const WORLD_OUTCOMES = new Set(["applied", "ready", "no survivor"]);

export function isWorld(record: SearchRecord): boolean {
	return WORLD_OUTCOMES.has(record.outcome as string);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isTokens = (value: unknown, ...extra: string[]) =>
	isObject(value) &&
	["inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens", ...extra].every((key) => isNumber(value[key]));
const isStrings = (value: unknown) => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isNumbers = (value: unknown) => isObject(value) && Object.values(value).every(isNumber);

/** The first part of a world that replay reads and that is missing or malformed, or undefined. */
function worldProblem(record: Record<string, unknown>): string | undefined {
	const { config, cost, spec, enumerations, branches } = record;
	if (typeof record.seed !== "string" || !/^([0-9a-f]{2})+$/.test(record.seed)) return "seed is not hex";
	if (
		!isObject(config) ||
		!isStrings(config.constraints) ||
		!["random", "model", undefined].includes(config.draw as string)
	)
		return "config lacks constraints or a valid draw";
	if (!isObject(cost) || ![cost.author, cost.review].every((part) => part === null || isTokens(part)))
		return "cost lacks the author's or the review's tokens";
	if (!isObject(spec) || typeof spec.sha256 !== "string" || !isNumbers(spec.baseValues))
		return "spec lacks its hash or base values";
	if (
		!Array.isArray(enumerations) ||
		!enumerations.some((e) => isObject(e) && e.key === "root") ||
		!enumerations.every(
			(e) =>
				isObject(e) &&
				typeof e.key === "string" &&
				typeof e.preferred === "string" &&
				Array.isArray(e.candidates) &&
				e.candidates.length > 0 &&
				e.candidates.every((c) => isObject(c) && typeof c.id === "string") &&
				isTokens(e.cost),
		)
	)
		return "enumerations are malformed";
	if (
		!Array.isArray(branches) ||
		!branches.every(
			(b) =>
				isObject(b) &&
				typeof b.key === "string" &&
				(b.parent === null || typeof b.parent === "string") &&
				typeof b.candidate === "string" &&
				typeof b.constraint === "string" &&
				isTokens(b.cost, "runMs", "scoreMs") &&
				(b.status === undefined ||
					((b.status === "survived" || b.status === "dead") &&
						isNumber(b.gatesPassed) &&
						isNumbers(b.objectives) &&
						isNumber((b.objectives as Record<string, unknown>).diff_size))),
		)
	)
		return "branches are malformed";
	return undefined;
}

/** A stored search as replay reads it: the record and, for a world, its frozen scorer. */
export interface StoredSearch {
	record: SearchRecord;
	/** The frozen `spec.json` beside a world's record; null for a record that is not a world. */
	spec: ScorerSpec | null;
}

/** A world's frozen scorer: `spec.json`, whose bytes must hash to the record's `spec.sha256` (spec I1). */
function frozenSpec(path: string, sha256: string): ScorerSpec | string {
	if (!existsSync(path)) return "spec.json is missing";
	const bytes = readFileSync(path);
	if (createHash("sha256").update(bytes).digest("hex") !== sha256)
		return "spec.json does not match the record's spec hash";
	let parsed: ScorerSpec | string[];
	try {
		parsed = parseScorerSpec(JSON.parse(bytes.toString("utf8")));
	} catch (error) {
		return `spec.json: ${error instanceof Error ? error.message : String(error)}`;
	}
	return Array.isArray(parsed) ? `spec.json is not a scorer spec: ${parsed.join("; ")}` : parsed;
}

/**
 * Every `<dir>/<search-id>/record.json` (spec 12), in ID order, with each world's frozen `spec.json`.
 * A missing directory holds no records. A record that cannot be read or parsed, that is not a search
 * record, or a world missing what replay reads or whose `spec.json` is missing or does not match its
 * hash is named with its path in `unreadable` instead.
 */
export function readRecords(dir: string): { records: StoredSearch[]; unreadable: string[] } {
	const records: StoredSearch[] = [];
	const unreadable: string[] = [];
	if (!existsSync(dir)) return { records, unreadable };
	for (const id of readdirSync(dir).sort()) {
		const path = join(dir, id, "record.json");
		if (!existsSync(path)) continue;
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			unreadable.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const problem = !isObject(value)
			? "not a search record"
			: typeof value.id !== "string" || !(value.outcome === null || typeof value.outcome === "string")
				? "not a search record: no id or outcome"
				: undefined;
		if (problem) {
			unreadable.push(`${path}: ${problem}`);
			continue;
		}
		const record = value as unknown as SearchRecord;
		if (!isWorld(record)) {
			records.push({ record, spec: null });
			continue;
		}
		const spec =
			worldProblem(value as Record<string, unknown>) ??
			frozenSpec(join(dir, id, "spec.json"), record.spec?.sha256 as string);
		if (typeof spec === "string") unreadable.push(`${path}: ${spec}`);
		else records.push({ record, spec });
	}
	return { records, unreadable };
}
