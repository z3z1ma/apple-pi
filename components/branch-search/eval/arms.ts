import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { BranchSearchConfig } from "../src/config.js";
import { disposeAgentSession } from "../../subagents/src/session-lifecycle.js";
import { type ReviewRequest, runBranchSearch } from "../src/orchestrator.js";
import { addUsage, emptyCost, type SearchRecord, type TokenCost } from "../src/record.js";
import { type GateResult, installScorer, refusedGates, runGates } from "../src/scorer.js";
import { git } from "../src/workspace.js";
import { cloneAt } from "./clone.js";
import type { EvalTask } from "./tasks.js";

/**
 * The arms of spec 18 on one task, each in a fresh clone at the task's base: A is one trajectory, B
 * searches with `draw: "model"`, C with `draw: "random"`; B and C each run once with the oracle gates
 * as the scorer and once with the scorer the model authors. Every final state is scored with the
 * oracle gates.
 */

export const ARMS = ["A", "B-oracle", "B-authored", "C-oracle", "C-authored"] as const;
export type ArmId = (typeof ARMS)[number];

/** A root session in a clone, on the evaluated model, with the requests the search sends on other profiles. */
export interface EvalSession {
	session: AgentSession;
	/** One request on a model profile: the authored scorer's review and the fidelity tags. */
	review?: ReviewRequest;
	/** Frees what the factory made besides the session; the arm has already shut the session down and disposed it. */
	dispose: () => void | Promise<void>;
}

export type SessionFactory = (cwd: string) => Promise<EvalSession>;

/** Where a search's winner came from, judged by its root ancestor on the root enumeration (spec 18). */
export interface WinnerDraw {
	key: string;
	/** The winner's own candidate, in the enumeration it was drawn from. */
	candidate: string;
	/** The winner's root ancestor (itself for a root), and that root's candidate. */
	root: string;
	rootCandidate: string;
	/** The root enumeration's `preferred` candidate. */
	preferred: string;
	/** The root candidate's position in the `draw: "model"` order: 0 is `preferred`, then the others in returned order. */
	rank: number;
	/**
	 * The most roots B's configuration could ever draw: `branches.perGeneration` plus
	 * `generations.maxDepth × generations.rootsPerGeneration`, at most `branches.maxTotal`. B draws roots in
	 * model order, so it can reach exactly the first `bReach` positions.
	 */
	bReach: number;
	/**
	 * Conservative: the root candidate is not `preferred` and sits at or beyond `bReach`, so no B run with
	 * this configuration could have drawn it. B's own run enumerates separately, so its ids are not compared.
	 */
	tail: boolean;
}

export interface ArmResult {
	arm: ArmId;
	/** Every oracle gate passes on the final state. */
	solved: boolean;
	gates: Record<string, GateResult["result"]>;
	/** Arm A: the session's requests. B and C: the search's `cost.total` (spec 12). */
	tokens: TokenCost;
	/** The fidelity tag requests of B and C (spec 10.6): evaluation cost outside `tokens`, priced beside it. */
	tagTokens: TokenCost;
	/** The run itself (for B and C, the whole search with its own scoring), without the clone or the final oracle scoring. */
	ms: number;
	/** Arm A: the final stop reason, or `limit`. B and C: the search outcome. */
	outcome: string;
	winner: WinnerDraw | null;
	/** A solved arm C run whose winner's root no B run with this configuration could have drawn (`WinnerDraw.tail`). */
	tailWin: boolean;
	/** The search record of B and C; null for A. */
	record: SearchRecord | null;
	/** Set when the run failed before it could be scored; the arm then counts as unsolved. */
	error?: string;
}

export interface ArmOptions {
	repo: string;
	search: BranchSearchConfig;
	createSession: SessionFactory;
	/** Each search's state directory (record, spec, patch) is copied to `<recordsDir>/<arm>/`. */
	recordsDir?: string;
	/** Tests only; otherwise each search draws its own seed. */
	seed?: Uint8Array;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
}

export async function runArms(task: EvalTask, options: ArmOptions): Promise<ArmResult[]> {
	const results: ArmResult[] = [];
	for (const arm of ARMS) {
		options.signal?.throwIfAborted();
		options.onProgress?.(`${task.id}: arm ${arm}`);
		results.push(await runArm(arm, task, options));
	}
	return results;
}

async function runArm(arm: ArmId, task: EvalTask, options: ArmOptions): Promise<ArmResult> {
	const clone = await cloneAt(options.repo, task.base, options.search.workspace.cloneIgnored);
	const result: ArmResult = {
		arm,
		solved: false,
		gates: {},
		tokens: emptyCost(),
		tagTokens: emptyCost(),
		ms: 0,
		outcome: "",
		winner: null,
		tailWin: false,
		record: null,
	};
	try {
		const evalSession = await options.createSession(clone.dir);
		const { session } = evalSession;
		// Cancellation stops the trajectory; a search stops through its own signal.
		const abort = () => void session.abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		const started = Date.now();
		try {
			options.signal?.throwIfAborted();
			if (arm === "A") await runSingle(session, task.goal, options.search, result);
			else await runSearch(arm, clone.dir, task, evalSession, options, result);
		} catch (error) {
			result.error = error instanceof Error ? error.message : String(error);
		} finally {
			result.ms = Date.now() - started;
			options.signal?.removeEventListener("abort", abort);
			// Shutdown first, so extensions stop what they started (background commands) before the
			// final state is scored and the clone is removed.
			await disposeAgentSession(session);
			await evalSession.dispose();
		}
		options.signal?.throwIfAborted();
		const gates = await scoreOracle(clone.dir, task, options.signal);
		result.gates = Object.fromEntries(gates.map((gate) => [gate.id, gate.result]));
		result.solved = result.error === undefined && gates.every((gate) => gate.result === "pass");
		result.tailWin = arm.startsWith("C") && result.solved && result.winner?.tail === true;
	} finally {
		clone.dispose();
	}
	return result;
}

/**
 * Arm A: the goal as one prompt to the main agent, under the same per-trajectory limits a branch gets
 * (`branch.limits`), so A and each branch have the same budget.
 */
async function runSingle(
	session: AgentSession,
	goal: string,
	search: BranchSearchConfig,
	result: ArmResult,
): Promise<void> {
	const { wallClockSec, outputTokens } = search.branch.limits;
	let limited = false;
	const stop = () => {
		limited = true;
		void session.abort();
	};
	let output = 0;
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "message_end" || event.message.role !== "assistant") return;
		output += event.message.usage.output;
		if (outputTokens !== undefined && output > outputTokens) stop();
	});
	const timer = wallClockSec === undefined ? undefined : setTimeout(stop, wallClockSec * 1000);
	try {
		await session.prompt(goal);
	} finally {
		clearTimeout(timer);
		unsubscribe();
	}
	for (const entry of session.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") addUsage(result.tokens, entry.message.usage);
	}
	const last = session.messages.findLast((message) => message.role === "assistant");
	result.outcome = limited ? "limit" : (last?.role === "assistant" && last.stopReason) || "no reply";
}

/** Arms B and C: one search in the clone; a winner becomes the clone's final state whatever `apply` says. */
async function runSearch(
	arm: Exclude<ArmId, "A">,
	cwd: string,
	task: EvalTask,
	evalSession: EvalSession,
	options: ArmOptions,
	result: ArmResult,
): Promise<void> {
	const oracle = arm.endsWith("oracle");
	const config: BranchSearchConfig = { ...options.search, draw: arm.startsWith("B") ? "model" : "random" };
	// A review would replace the oracle; it runs on supplied scorers too, so oracle arms drop it.
	if (oracle) {
		const { reviewProfile: _, ...scorer } = config.scorer;
		config.scorer = scorer;
	}
	const searched = await runBranchSearch({
		mode: "human",
		session: evalSession.session,
		cwd,
		config,
		scorer: oracle ? task.spec : undefined,
		goal: task.goal,
		review: evalSession.review,
		exclusive: async () => () => {},
		signal: options.signal ?? new AbortController().signal,
		onStatus: () => {},
		seed: options.seed,
	});
	result.outcome = searched.outcome;
	if (!searched.recordPath || !existsSync(searched.recordPath)) throw new Error(searched.report);
	const record = JSON.parse(readFileSync(searched.recordPath, "utf8")) as SearchRecord;
	result.record = record;
	result.tokens = record.cost.total;
	for (const { fidelity } of record.branches)
		if (fidelity)
			addUsage(result.tagTokens, {
				input: fidelity.cost.inputTokens,
				output: fidelity.cost.outputTokens,
				cacheRead: fidelity.cost.cacheReadTokens,
				cacheWrite: fidelity.cost.cacheWriteTokens,
			});
	if (options.recordsDir) {
		const target = join(options.recordsDir, arm, record.id);
		mkdirSync(dirname(target), { recursive: true });
		cpSync(dirname(searched.recordPath), target, { recursive: true });
	}
	result.winner = winnerDraw(record);
	const commit = record.branches.find((branch) => branch.key === record.winner)?.commit;
	if (commit) await git(cwd, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--force", "--detach", commit]);
}

/** The winner's root ancestor, its place in the root enumeration's model order, and whether that is a tail win. */
export function winnerDraw(record: SearchRecord): WinnerDraw | null {
	const winner = record.branches.find((branch) => branch.key === record.winner);
	const rootKey = winner?.key.split(".")[0];
	const root = record.branches.find((branch) => branch.key === rootKey);
	const enumeration = record.enumerations.find((entry) => entry.key === "root");
	if (!winner || !root || !enumeration) return null;
	const { preferred, candidates } = enumeration;
	const order = [
		...candidates.filter((candidate) => candidate.id === preferred),
		...candidates.filter((candidate) => candidate.id !== preferred),
	].map((candidate) => candidate.id);
	const rank = order.indexOf(root.candidate);
	const { branches, generations } = record.config;
	const bReach = Math.min(
		branches.perGeneration + generations.maxDepth * generations.rootsPerGeneration,
		branches.maxTotal,
	);
	return {
		key: winner.key,
		candidate: winner.candidate,
		root: root.key,
		rootCandidate: root.candidate,
		preferred,
		rank,
		bReach,
		tail: root.candidate !== preferred && rank >= bReach,
	};
}

/** Install the oracle's final test files over the final state and run each oracle gate. */
async function scoreOracle(dir: string, task: EvalTask, signal?: AbortSignal): Promise<GateResult[]> {
	const refused = await installScorer(dir, task.base, task.spec);
	return refused ? refusedGates(task.spec, refused) : runGates(dir, task.spec, "evaluation", signal);
}
