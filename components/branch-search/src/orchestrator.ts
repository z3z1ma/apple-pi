import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type ForkHandle, type ForkRequest, startFork } from "../../shared/src/forked-continuation.js";
import { type BranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import { constraintPool } from "./draw.js";
import { type BatchEntry, type Enumeration, type ObservedTree, planStep, selectWinner } from "./plan.js";
import {
	enumeratorPrompt,
	enumeratorRetryPrompt,
	parseEnumeration,
	parseSelfReport,
	rootDirective,
} from "./prompts.js";
import {
	addUsage,
	type BranchRecord,
	type BranchScore,
	type BranchSelfReport,
	emptyCost,
	type SearchRecord,
	sumCosts,
	writeRecord,
} from "./record.js";
import { formatReport } from "./report.js";
import {
	checkScorerSpec,
	type DiffStat,
	diffStat,
	type GateResult,
	installScorer,
	runGates,
	type ScorerSpec,
} from "./scorer.js";
import {
	addWorktree,
	commitWorktree,
	gitCommonDir,
	hasHead,
	pruneRefs,
	removeWorktrees,
	repoRoot,
	snapshotBase,
	snapshotTree,
} from "./workspace.js";

/** Tools no search fork may run (spec 8.5). They stay in the tool list so the request prefix stays the parent's. */
export const SEARCH_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
	"search_branches",
	"ask_user_question",
	"update_notebook",
	"revisit_note",
	"ledger_add",
	"ledger_status",
	"agent",
	"get_subagent_result",
	"steer_subagent",
	"stop_subagent",
	"schedule",
	"monitor",
	"task",
	"pi_exec",
]);

const MESSAGE_TYPE = "branch-search";

export interface SearchOptions {
	/** The live parent session; its current projection is the fork point. */
	session: AgentSession;
	cwd: string;
	/** The loaded, not yet validated, configuration (spec 11). */
	config: unknown;
	/** The scorer to judge branches with (spec 7.1). */
	scorer: ScorerSpec;
	goal?: string;
	signal: AbortSignal;
	/** Receives `branching <phase> <alive>/<total>`, and `undefined` once cleanup is done. */
	onStatus: (text: string | undefined) => void;
	/** Tests only; otherwise 32 random bytes. */
	seed?: Uint8Array;
}

export interface SearchResult {
	/** `ready`, `no survivor`, `aborted: <reason>`, or `not configured`. */
	outcome: string;
	/** The report body (spec 6.10), or the configuration problems. */
	report: string;
	recordPath?: string;
}

class SearchAbort extends Error {
	constructor(readonly reason: string) {
		super(reason);
	}
}

function searchId(now: Date): string {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	return `bs-${stamp}-${randomBytes(2).toString("hex")}`;
}

function customPrompt(text: string): AgentMessage {
	return { role: "custom", customType: MESSAGE_TYPE, content: text, display: false, timestamp: Date.now() };
}

function lastAssistant(messages: AgentMessage[]) {
	const last = messages.at(-1);
	return last?.role === "assistant" ? last : undefined;
}

function replyText(messages: AgentMessage[]): string {
	return (lastAssistant(messages)?.content ?? [])
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
}

/** Run one complete search for a supplied scorer: prepare, enumerate, draw, run, score, select, report, clean up. */
export async function runBranchSearch(options: SearchOptions): Promise<SearchResult> {
	const validated = validateBranchSearchConfig(options.config);
	if (!validated.ok) return { outcome: "not configured", report: validated.text };
	const problems = checkScorerSpec(options.scorer);
	if (problems.length > 0)
		return {
			outcome: "aborted: scorer invalid",
			report: `Branch search: aborted: scorer invalid.\n${problems.join("\n")}`,
		};
	if (!(await hasHead(options.cwd)))
		return { outcome: "aborted: no git history", report: "Branch search: aborted: no git history." };
	const search = new Search(options, validated.config, await repoRoot(options.cwd), await gitCommonDir(options.cwd));
	return search.run();
}

/** Wait for every task, then fail with the first error, so nothing still runs in a worktree that cleanup removes. */
async function settleAll(tasks: Promise<unknown>[]): Promise<void> {
	const failed = (await Promise.allSettled(tasks)).find((result) => result.status === "rejected");
	if (failed) throw failed.reason;
}

/** Every gate fails with the reason the scorer could not be installed. */
function refusedGates(scorer: ScorerSpec, reason: string): GateResult[] {
	return scorer.gates.map(({ id }) => ({ id, result: "fail", exitCode: null, stdout: "", stderr: reason, ms: 0 }));
}

interface LiveBranch {
	record: BranchRecord;
	worktree: string;
}

class Search {
	readonly id = searchId(new Date());
	readonly stateDir: string;
	readonly recordPath: string;
	readonly seed: Uint8Array;
	readonly record: SearchRecord;
	readonly specText: string;
	/** Fork point: the parent's conversation when the search starts. */
	readonly forkPoint: AgentMessage[];
	readonly forks = new Set<ForkHandle>();
	readonly worktrees = new Set<string>();
	readonly branches: LiveBranch[] = [];
	/** Scoring results stay in memory until the last branch stops (spec 8.4). */
	readonly scores = new Map<string, BranchScore>();
	readonly enumerations: Record<string, Enumeration> = {};
	readonly started = Date.now();
	seq = 0;
	phase = "prepare";
	winnerStat: DiffStat | undefined;

	constructor(
		readonly options: SearchOptions,
		readonly config: BranchSearchConfig,
		readonly root: string,
		commonDir: string,
	) {
		this.stateDir = join(commonDir, "apple-pi", "branch-search", this.id);
		this.recordPath = join(this.stateDir, "record.json");
		this.seed = options.seed ?? randomBytes(32);
		this.specText = `${JSON.stringify(options.scorer, null, 2)}\n`;
		this.forkPoint = options.session.sessionManager.buildSessionProjection().messages;
		this.record = {
			id: this.id,
			goal: options.goal ?? null,
			seed: Buffer.from(this.seed).toString("hex"),
			startedAt: new Date(this.started).toISOString(),
			endedAt: null,
			config,
			base: null,
			spec: null,
			cost: { total: emptyCost(), ms: 0 },
			enumerations: [],
			steps: [],
			branches: [],
			parentTreeChecks: [],
			winner: null,
			outcome: null,
			abortReason: null,
			cleanupErrors: [],
		};
	}

	async run(): Promise<SearchResult> {
		const { signal } = this.options;
		const abortForks = () => {
			for (const fork of this.forks) fork.abort();
		};
		signal.addEventListener("abort", abortForks);
		mkdirSync(this.stateDir, { recursive: true });
		try {
			signal.throwIfAborted();
			await this.search();
		} catch (error) {
			this.record.winner = null;
			if (signal.aborted) this.end("aborted: cancelled", "cancelled");
			else if (error instanceof SearchAbort) this.end(`aborted: ${error.reason}`, error.reason);
			else this.end("aborted: error", error instanceof Error ? error.message : String(error));
		} finally {
			signal.removeEventListener("abort", abortForks);
			await this.cleanup();
		}
		const gateCount = this.options.scorer.gates.length;
		const report = formatReport({
			record: this.record,
			recordPath: this.recordPath,
			gateCount,
			winnerStat: this.winnerStat,
		});
		return { outcome: this.record.outcome as string, report, recordPath: this.recordPath };
	}

	private end(outcome: string, abortReason: string | null = null): void {
		this.record.outcome = outcome;
		this.record.abortReason = abortReason;
	}

	private async search(): Promise<void> {
		const base = await snapshotBase(this.root, this.id);
		this.record.base = base;
		this.save();

		this.status("enumerate");
		const root = await this.enumerate(base.commit);
		this.enumerations.root = root;
		this.save();

		const step = this.plan();
		if (step.kind !== "run") throw new Error(`Unexpected first step ${step.kind}.`);
		await this.runGeneration(0, step.batch, base);
		await this.scoreGeneration(0, base.commit);

		const stop = this.plan();
		if (stop.kind !== "stop") throw new Error(`Later generations are not available yet (step ${stop.kind}).`);
		const winner = stop.outcome === "survivor" ? selectWinner(this.observedTree().nodes) : undefined;
		if (!winner) return this.end("no survivor");
		this.record.winner = winner.key;
		const commit = this.branches.find((branch) => branch.record.key === winner.key)?.record.commit as string;
		this.winnerStat = await diffStat(this.root, base.commit, commit);
		this.end("ready");
	}

	private plan() {
		const step = planStep(this.observedTree(), this.config, this.config.draw, this.seed);
		this.record.steps.push({ seq: this.record.steps.length, step });
		return step;
	}

	private observedTree(): ObservedTree {
		return {
			enumerations: this.enumerations,
			constraints: constraintPool(this.config.constraints),
			nodes: this.branches.flatMap(({ record }) => {
				const score = this.scores.get(record.key);
				if (!score) return [];
				return [
					{
						key: record.key,
						parent: record.parent,
						generation: record.generation,
						status: score.status,
						gatesPassed: score.gatesPassed,
						diffSize: score.objectives.diff_size as number,
					},
				];
			}),
		};
	}

	private status(phase: string): void {
		this.phase = phase;
		const total = this.branches.length;
		const dead = [...this.scores.values()].filter((score) => score.status === "dead").length;
		this.options.onStatus(`branching ${phase} ${total - dead}/${total}`);
	}

	private fork(request: ForkRequest): ForkHandle {
		// The abort handler stops only forks that exist, so none may start after it fired.
		this.options.signal.throwIfAborted();
		const handle = startFork(this.options.session, { blockedTools: SEARCH_BLOCKED_TOOLS, ...request });
		this.forks.add(handle);
		handle.result.finally(() => this.forks.delete(handle)).catch(() => undefined);
		return handle;
	}

	private async worktree(name: string, commit: string): Promise<string> {
		const path = join(this.stateDir, "wt", name);
		this.worktrees.add(path);
		await addWorktree(this.root, path, commit, this.config.workspace.cloneIgnored);
		return path;
	}

	/** The root enumerator: a fork of the parent in its own base worktree, asked once more after an unusable reply (spec 6.4). */
	private async enumerate(base: string): Promise<Enumeration> {
		const worktree = { root: await this.worktree("enum-root", base), parentRoot: this.root };
		const cost = emptyCost();
		const started = Date.now();
		let messages = this.forkPoint;
		let append = customPrompt(enumeratorPrompt(this.config.enumerate.count));
		for (let attempt = 1; attempt <= 2; attempt++) {
			const fork = this.fork({
				messages,
				append,
				label: "Branch search enumerator",
				worktree,
				onUsage: (usage) => addUsage(cost, usage),
			});
			const result = await fork.result;
			this.options.signal.throwIfAborted();
			const parsed = parseEnumeration("root", replyText(result.messages));
			if (typeof parsed !== "string") {
				this.record.enumerations.push({ ...parsed, attempts: attempt, cost: { ...cost, ms: Date.now() - started } });
				return parsed;
			}
			messages = result.messages;
			append = customPrompt(enumeratorRetryPrompt(parsed));
		}
		throw new SearchAbort("enumeration failed");
	}

	/** Start every branch of the batch at once, wait for all to stop, then commit each (spec 6.6). */
	private async runGeneration(
		generation: number,
		batch: BatchEntry[],
		base: { commit: string; tree: string },
	): Promise<void> {
		this.record.parentTreeChecks.push({ phase: `before g${generation}`, tree: await snapshotTree(this.root) });
		const runs: Promise<void>[] = [];
		for (const entry of batch) {
			const worktree = await this.worktree(entry.key, base.commit);
			this.options.signal.throwIfAborted();
			runs.push(this.startBranch(generation, entry, base.commit, worktree));
			this.status(`run g${generation}`);
		}
		await settleAll(runs);
		this.options.signal.throwIfAborted();
		for (const branch of this.branches.filter(({ record }) => record.generation === generation)) {
			branch.record.commit = await commitWorktree(this.root, branch.worktree, this.id, branch.record.key);
		}
		this.record.parentTreeChecks.push({ phase: `after g${generation}`, tree: await snapshotTree(this.root) });
		this.save();
	}

	private startBranch(generation: number, entry: BatchEntry, startCommit: string, worktree: string): Promise<void> {
		const candidate = this.enumerations.root?.candidates.find((c) => c.id === entry.candidate);
		if (!candidate) throw new Error(`Unknown candidate ${entry.candidate}.`);
		const record: BranchRecord = {
			key: entry.key,
			generation,
			parent: entry.parent,
			candidate: entry.candidate,
			constraint: entry.constraint,
			startSeq: this.seq++,
			endSeq: null,
			startCommit,
			commit: null,
			selfReport: null,
			learned: null,
			cost: { ...emptyCost(), runMs: 0, scoreMs: 0 },
		};
		this.branches.push({ record, worktree });
		this.record.branches.push(record);

		const { wallClockSec, outputTokens } = this.config.branch.limits;
		let limited = false;
		let output = 0;
		const started = Date.now();
		const onUsage = (usage: Usage) => {
			addUsage(record.cost, usage);
			output += usage.output;
			if (outputTokens !== undefined && output > outputTokens && !limited) {
				limited = true;
				fork.abort();
			}
		};
		const fork = this.fork({
			messages: this.forkPoint,
			append: customPrompt(rootDirective(entry.key, candidate, entry.constraint)),
			label: `Branch search ${entry.key}`,
			worktree: { root: worktree, parentRoot: this.root },
			onUsage,
		});
		const timer =
			wallClockSec === undefined
				? undefined
				: setTimeout(() => {
						limited = true;
						fork.abort();
					}, wallClockSec * 1000);
		return fork.result.then(({ messages }) => {
			clearTimeout(timer);
			record.endSeq = this.seq++;
			record.cost.runMs = Date.now() - started;
			const last = lastAssistant(messages);
			const { selfReport, learned } = parseSelfReport(replyText(messages));
			record.learned = learned;
			let report: BranchSelfReport = selfReport;
			if (limited) report = "limit";
			else if (last?.stopReason === "error" || last?.stopReason === "aborted") report = "error";
			record.selfReport = report;
		});
	}

	/** Install the scorer in each worktree and run its gates; survivors and dead branches alike get diff_size (spec 6.7). */
	private async scoreGeneration(generation: number, base: string): Promise<void> {
		this.status(`score g${generation}`);
		const { scorer, signal } = this.options;
		const branches = this.branches.filter(({ record }) => record.generation === generation);
		await settleAll(
			branches.map(async ({ record, worktree }) => {
				const started = Date.now();
				const refused = await installScorer(worktree, base, scorer);
				const gates = refused ? refusedGates(scorer, refused) : await runGates(worktree, scorer, this.id, signal);
				const stat = await diffStat(this.root, base, record.commit as string);
				const gatesPassed = gates.filter((gate) => gate.result === "pass").length;
				this.scores.set(record.key, {
					gates: Object.fromEntries(gates.map((gate) => [gate.id, gate.result])),
					gateOutput: Object.fromEntries(
						gates.map(({ id, exitCode, stdout, stderr, ms }) => [id, { exitCode, stdout, stderr, ms }]),
					),
					gatesPassed,
					status: gatesPassed === scorer.gates.length ? "survived" : "dead",
					objectives: { diff_size: stat.added + stat.deleted },
				});
				record.cost.scoreMs = Date.now() - started;
				this.status(`score g${generation}`);
			}),
		);
		signal.throwIfAborted();
	}

	/** Non-scorer parts only; scoring results join the record when the search ends (spec 8.4). */
	private save(): void {
		this.record.cost = {
			total: sumCosts([...this.record.enumerations.map((e) => e.cost), ...this.record.branches.map((b) => b.cost)]),
			ms: Date.now() - this.started,
		};
		writeRecord(this.recordPath, this.record);
	}

	/** Spec 6.11: stop every fork, remove every worktree, keep only the base and winner refs and the record files. */
	private async cleanup(): Promise<void> {
		const problems: string[] = [];
		const attempt = async (step: () => Promise<unknown> | unknown) => {
			try {
				await step();
			} catch (error) {
				problems.push(error instanceof Error ? error.message : String(error));
			}
		};
		const forks = [...this.forks];
		for (const fork of forks) fork.abort();
		await Promise.allSettled(forks.map((fork) => fork.result));
		await attempt(() => removeWorktrees(this.root, this.worktrees));
		await attempt(() => pruneRefs(this.root, this.id, this.record.winner ? ["base", this.record.winner] : ["base"]));
		await attempt(() => rmSync(join(this.stateDir, "wt"), { recursive: true, force: true }));

		const specPath = join(this.stateDir, "spec.json");
		await attempt(() => writeFileSync(specPath, this.specText));
		this.record.spec = { sha256: createHash("sha256").update(this.specText).digest("hex"), path: "spec.json" };
		this.record.branches = this.record.branches.map((branch) => ({ ...branch, ...this.scores.get(branch.key) }));
		this.record.endedAt = new Date().toISOString();
		this.record.cleanupErrors = problems;
		await attempt(() => this.save());
		this.options.onStatus(undefined);
	}
}
