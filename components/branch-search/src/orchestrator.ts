import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { abortable } from "../../shared/src/abortable.js";
import type { ForkWorktree } from "../../shared/src/fork-context.js";
import { type ForkHandle, type ForkRequest, startFork } from "../../shared/src/forked-continuation.js";
import { type BranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import { constraintPool } from "./draw.js";
import { type BatchEntry, type Enumeration, type ObservedTree, planStep, selectWinner } from "./plan.js";
import {
	authorPrompt,
	authorRetryPrompt,
	enumeratorPrompt,
	enumeratorRetryPrompt,
	parseEnumeration,
	parseJson,
	parseReview,
	parseSelfReport,
	reviewPrompt,
	rootDirective,
} from "./prompts.js";
import {
	addUsage,
	type BranchRecord,
	type ValidationRecord,
	type BranchScore,
	type BranchSelfReport,
	emptyCost,
	type ReviewRecord,
	type SearchMode,
	type SearchRecord,
	type TokenCost,
	sumCosts,
	writeRecord,
} from "./record.js";
import { formatReport } from "./report.js";
import {
	type BranchScoring,
	checkScorerSpec,
	type DiffStat,
	diffStat,
	parseScorerSpec,
	type ScorerSpec,
	scoreBranches,
	settleAll,
	type Validation,
	validateScorer,
} from "./scorer.js";
import {
	addWorktree,
	applyWinner,
	commitWorktree,
	git,
	gitCommonDir,
	hasHead,
	PLAIN_DIFF,
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

/** The custom message type of search prompts in forks and of the report in the parent conversation. */
export const BRANCH_SEARCH_MESSAGE_TYPE = "branch-search";
const MESSAGE_TYPE = BRANCH_SEARCH_MESSAGE_TYPE;

/** One request on a user-global model profile; resolves with the reply text (spec 10.5). */
export type ReviewRequest = (profile: string, prompt: string, signal: AbortSignal) => Promise<string>;

/** Branch counts per state, for `/branch-search status`. */
export interface SearchProgress {
	id: string;
	phase: string;
	branches: { running: number; stopped: number; survived: number; dead: number };
	elapsedMs: number;
}

export interface SearchOptions {
	mode: SearchMode;
	/** The live parent session; its current projection is the fork point. */
	session: AgentSession;
	cwd: string;
	/** The loaded, not yet validated, configuration (spec 11). */
	config: unknown;
	/**
	 * A scorer to judge branches with (spec 7.1), for evaluation with oracle gates; the author then
	 * does not run. Without one, a role fork authors it (spec 6.2). Either way `scorer.reviewProfile`
	 * reviews it, so an evaluation that must keep its oracle unchanged leaves that key unset.
	 */
	scorer?: ScorerSpec;
	goal?: string;
	/** Sends the scorer review when `scorer.reviewProfile` is set. */
	review?: ReviewRequest;
	/**
	 * Holds the root session for the apply (spec 6.9 step 1): resolves once the root session has
	 * settled and root tools that change the workspace are blocked, with a function that ends the
	 * hold. The search holds it from the workspace snapshot through apply and any rollback. A search
	 * that runs inside a tool call does not wait for a settle: the root run is blocked on it.
	 */
	exclusive: () => Promise<() => void>;
	/** Called once the search has its ID, with a live view of its progress. */
	onStart?: (search: { id: string; progress: () => SearchProgress }) => void;
	signal: AbortSignal;
	/** Receives `branching <phase> <alive>/<total>`, and `undefined` once cleanup is done. */
	onStatus: (text: string | undefined) => void;
	/** Tests only; otherwise 32 random bytes. */
	seed?: Uint8Array;
}

export interface SearchResult {
	/** `applied`, `ready`, `no survivor`, `aborted: <reason>`, or `not configured`. */
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

/**
 * Run one complete search: prepare, author or take the scorer, validate, review, freeze, enumerate,
 * draw, run, score, select, apply, report, clean up.
 */
export async function runBranchSearch(options: SearchOptions): Promise<SearchResult> {
	const validated = validateBranchSearchConfig(options.config);
	if (!validated.ok) return { outcome: "not configured", report: validated.text };
	const problems = options.scorer ? checkScorerSpec(options.scorer) : [];
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
	/** The spec being validated, then the frozen one (spec I1). */
	spec: ScorerSpec | undefined;
	/** The exact bytes whose hash is recorded at the freeze and stored as spec.json. */
	specText: string | undefined;
	review: ReviewRecord | null = null;
	readonly authorCost: TokenCost & { ms: number } = { ...emptyCost(), ms: 0 };
	/** Fork point: the parent's conversation when the search starts. */
	readonly forkPoint: AgentMessage[];
	readonly forks = new Set<ForkHandle>();
	readonly worktrees = new Set<string>();
	readonly branches: LiveBranch[] = [];
	/** Scoring results stay in memory until the last branch stops (spec 8.4). */
	readonly scores = new Map<string, BranchScore>();
	readonly enumerations: Record<string, Enumeration> = {};
	/** Validation reports and base values are scorer content: held until the search ends (spec 8.4). */
	readonly validation: ValidationRecord[] = [];
	baseValues: Record<string, number> = {};
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
		this.forkPoint = options.session.sessionManager.buildSessionProjection().messages;
		this.record = {
			id: this.id,
			mode: options.mode,
			goal: options.goal ?? null,
			seed: Buffer.from(this.seed).toString("hex"),
			startedAt: new Date(this.started).toISOString(),
			endedAt: null,
			config,
			base: null,
			spec: null,
			cost: { total: emptyCost(), author: null, ms: 0 },
			enumerations: [],
			steps: [],
			branches: [],
			parentTreeChecks: [],
			winner: null,
			apply: null,
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
		this.options.onStart?.({ id: this.id, progress: () => this.progress() });
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
		const gateCount = this.spec?.gates.length ?? 0;
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

		const { spec, validation } = await this.reviewScorer(
			base.commit,
			this.options.scorer
				? await this.validateSupplied(base.commit, this.options.scorer)
				: await this.authorScorer(base.commit),
		);
		this.baseValues = validation.baseValues;
		this.freeze(spec);

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
		const { gates, objectives } = spec;
		const winner =
			stop.outcome === "survivor"
				? selectWinner(this.observedTree().nodes, { gates, objectives, baseValues: this.baseValues })
				: undefined;
		if (!winner) return this.end("no survivor");
		this.record.winner = winner.key;
		const commit = this.branches.find((branch) => branch.record.key === winner.key)?.record.commit as string;
		this.winnerStat = await diffStat(this.root, base.commit, commit);
		this.status("apply");
		const release = await this.holdRoot();
		try {
			this.options.signal.throwIfAborted();
			this.record.apply = await applyWinner(this.root, {
				base,
				winner: commit,
				mode: this.config.apply,
				patchPath: join(this.stateDir, "winner.patch"),
				signal: this.options.signal,
			});
		} finally {
			release();
		}
		this.end(this.record.apply.applied ? "applied" : "ready");
	}

	/** Wait for the hold on the root session; a hold granted after a cancel ends at once. */
	private async holdRoot(): Promise<() => void> {
		const hold = this.options.exclusive();
		try {
			return await abortable(hold, this.options.signal);
		} catch (error) {
			hold.then(
				(release) => release(),
				() => undefined,
			);
			throw error;
		}
	}

	private async validateSupplied(
		base: string,
		spec: ScorerSpec,
	): Promise<{ spec: ScorerSpec; validation: Validation }> {
		this.spec = spec;
		const validation = await this.validate(base, 0, spec);
		if (!validation.ok) throw new SearchAbort("scorer invalid");
		return { spec, validation };
	}

	/**
	 * The scorer author: a role fork of the parent in its own base worktree, which replies with the
	 * spec (spec 6.2). An unusable reply or a failed validation goes back to the same conversation as
	 * a new message, up to `scorer.validationRetries` times (spec 6.3).
	 */
	private async authorScorer(base: string): Promise<{ spec: ScorerSpec; validation: Validation }> {
		let messages = this.forkPoint;
		let append = customPrompt(authorPrompt(this.options.goal));
		for (let attempt = 0; attempt <= this.config.scorer.validationRetries; attempt++) {
			this.status("author");
			messages = await this.runAuthor(base, messages, append);
			const value = parseJson(replyText(messages));
			const parsed = value === undefined ? ["the reply is not valid JSON"] : parseScorerSpec(value);
			let report: string;
			if (Array.isArray(parsed)) {
				report = ["The reply is not a usable scorer spec.", ...parsed].join("\n");
				this.validation.push({ attempt, ok: false, report, ms: 0 });
			} else {
				this.spec = parsed;
				const validation = await this.validate(base, attempt, parsed);
				if (validation.ok) return { spec: parsed, validation };
				report = validation.report;
			}
			append = customPrompt(authorRetryPrompt(report));
		}
		throw new SearchAbort("scorer invalid");
	}

	/** One author turn in a fresh `wt/author` worktree, discarded before validation (spec 6.2). */
	private async runAuthor(base: string, messages: AgentMessage[], append: AgentMessage): Promise<AgentMessage[]> {
		const started = Date.now();
		const worktree = await this.worktree("author", base);
		try {
			const fork = this.fork({
				messages,
				append,
				label: "Branch search scorer author",
				worktree: this.forkWorktree(worktree),
				onUsage: (usage) => addUsage(this.authorCost, usage),
			});
			const result = await fork.result;
			this.options.signal.throwIfAborted();
			return result.messages;
		} finally {
			this.authorCost.ms += Date.now() - started;
			await removeWorktrees(this.root, [worktree]);
			this.worktrees.delete(worktree);
		}
	}

	/**
	 * With `scorer.reviewProfile`, one request on that profile reviews the validated spec (spec 6.2,
	 * 10.5). A `refine` replaces the spec once, if the replacement validates; otherwise, and when the
	 * request fails, the author's spec stands and the record says why.
	 */
	private async reviewScorer(
		base: string,
		authored: { spec: ScorerSpec; validation: Validation },
	): Promise<{ spec: ScorerSpec; validation: Validation }> {
		const profile = this.config.scorer.reviewProfile;
		if (profile === undefined) return authored;
		const { signal } = this.options;
		this.status("review");
		const started = Date.now();
		const review: ReviewRecord = { profile, verdict: "error", reason: null, applied: false, ms: 0 };
		this.review = review;
		const prompt = reviewPrompt({
			goal: this.options.goal ?? authored.spec.goal,
			diffStat: await git(this.root, ["diff", ...PLAIN_DIFF, "--stat", "HEAD", base]),
			spec: JSON.stringify(authored.spec),
		});
		let reply: string;
		try {
			if (!this.options.review) throw new Error("no review request is available");
			reply = await abortable(this.options.review(profile, prompt, signal), signal);
		} catch (error) {
			signal.throwIfAborted();
			review.reason = `the review request failed: ${error instanceof Error ? error.message : String(error)}`;
			review.ms = Date.now() - started;
			return authored;
		}
		review.ms = Date.now() - started;
		const verdict = parseReview(reply);
		if (typeof verdict === "string") {
			review.reason = `the reply could not be used: ${verdict}`;
			return authored;
		}
		review.verdict = verdict.verdict;
		if (verdict.verdict === "confirm") return authored;
		review.reason = verdict.reason;
		const attempt = this.validation.length;
		const refined = parseScorerSpec(verdict.spec);
		if (Array.isArray(refined)) {
			this.validation.push({
				attempt,
				ok: false,
				report: ["The refined spec is not a usable scorer spec.", ...refined].join("\n"),
				ms: 0,
			});
			return authored;
		}
		const validation = await this.validate(base, attempt, refined);
		if (!validation.ok) return authored;
		review.applied = true;
		this.spec = refined;
		return { spec: refined, validation };
	}

	/**
	 * Fix the spec's bytes and record their hash before any enumerator or branch starts (spec I1).
	 * The bytes stay in memory until the search ends (spec 8.4).
	 */
	private freeze(spec: ScorerSpec): void {
		this.spec = spec;
		this.specText = `${JSON.stringify(spec, null, 2)}\n`;
		this.record.spec = {
			sha256: createHash("sha256").update(this.specText).digest("hex"),
			path: "spec.json",
			validation: [],
			review: null,
			baseValues: {},
		};
		this.save();
	}

	/**
	 * Validate a spec on the base in a fresh `wt/validate` worktree (spec 6.3), then remove that
	 * worktree, so no scorer file is on disk once an enumerator or branch starts (spec 8.4). Each
	 * call is one attempt.
	 */
	private async validate(base: string, attempt: number, spec: ScorerSpec): Promise<Validation> {
		this.status("validate");
		const started = Date.now();
		const worktree = await this.worktree("validate", base);
		let validation: Validation;
		try {
			validation = await validateScorer(worktree, base, spec, this.id, this.options.signal);
		} finally {
			await removeWorktrees(this.root, [worktree]);
			this.worktrees.delete(worktree);
		}
		this.options.signal.throwIfAborted();
		this.validation.push({ attempt, ok: validation.ok, report: validation.report, ms: Date.now() - started });
		return validation;
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
						objectives: score.objectives,
					},
				];
			}),
		};
	}

	private progress(): SearchProgress {
		const branches = { running: 0, stopped: 0, survived: 0, dead: 0 };
		for (const { record } of this.branches) {
			const score = this.scores.get(record.key);
			if (score) branches[score.status]++;
			else if (record.endSeq === null) branches.running++;
			else branches.stopped++;
		}
		return { id: this.id, phase: this.phase, branches, elapsedMs: Date.now() - this.started };
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

	/** A fork's binding to its worktree, with a private temporary directory beside the worktrees (spec 8.4). */
	private forkWorktree(root: string): ForkWorktree {
		return { root, parentRoot: this.root, tmp: join(this.stateDir, "tmp", basename(root)) };
	}

	private async worktree(name: string, commit: string): Promise<string> {
		const path = join(this.stateDir, "wt", name);
		this.worktrees.add(path);
		await addWorktree(this.root, path, commit, this.config.workspace.cloneIgnored);
		return path;
	}

	/** The root enumerator: a fork of the parent in its own base worktree, asked once more after an unusable reply (spec 6.4). */
	private async enumerate(base: string): Promise<Enumeration> {
		const worktree = this.forkWorktree(await this.worktree("enum-root", base));
		const cost = emptyCost();
		const started = Date.now();
		let messages = this.forkPoint;
		let append = customPrompt(enumeratorPrompt(this.config.enumerate.count, this.options.goal));
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
			append: customPrompt(rootDirective(entry.key, candidate, entry.constraint, this.options.goal)),
			label: `Branch search ${entry.key}`,
			worktree: this.forkWorktree(worktree),
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

	/**
	 * Install the scorer in each worktree and run gates, objectives, and diff_size (spec 6.7 steps 1 to 4).
	 * Every branch, dead or alive, gets its diff_size.
	 */
	private async scoreGeneration(generation: number, base: string): Promise<void> {
		this.status(`score g${generation}`);
		const { signal } = this.options;
		const scorer = this.spec as ScorerSpec;
		const branches = this.branches.filter(({ record }) => record.generation === generation);
		const scored = await scoreBranches(
			branches.map(({ record, worktree }) => ({ key: record.key, worktree })),
			base,
			scorer,
			this.id,
			async (key) => {
				const commit = branches.find(({ record }) => record.key === key)?.record.commit as string;
				const stat = await diffStat(this.root, base, commit);
				return stat.added + stat.deleted;
			},
			signal,
		);
		for (const { record } of branches) {
			const { gates, diffSize, objectives, survived } = scored.get(record.key) as BranchScoring;
			const measured = objectives.flatMap(({ id, value }) => (value === undefined ? [] : [[id, value]]));
			this.scores.set(record.key, {
				gates: Object.fromEntries(gates.map((gate) => [gate.id, gate.result])),
				gateOutput: Object.fromEntries(
					gates.map(({ id, exitCode, stdout, stderr, ms }) => [id, { exitCode, stdout, stderr, ms }]),
				),
				gatesPassed: gates.filter((gate) => gate.result === "pass").length,
				status: survived ? "survived" : "dead",
				objectives: { ...Object.fromEntries(measured), diff_size: diffSize },
				objectiveOutput: Object.fromEntries(objectives.map(({ id, value: _, ...output }) => [id, output])),
			});
			record.cost.scoreMs = [...gates, ...objectives].reduce((total, { ms }) => total + ms, 0);
		}
		signal.throwIfAborted();
		this.status(`score g${generation}`);
	}

	/** Non-scorer parts only; scoring results join the record when the search ends (spec 8.4). */
	private save(): void {
		const authored = this.options.scorer === undefined;
		this.record.cost = {
			total: sumCosts([
				...(authored ? [this.authorCost] : []),
				...this.record.enumerations.map((e) => e.cost),
				...this.record.branches.map((b) => b.cost),
			]),
			author: authored ? this.authorCost : null,
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
		await attempt(() => rmSync(join(this.stateDir, "tmp"), { recursive: true, force: true }));

		// A frozen spec keeps its bytes; a search that ended before the freeze stores its last candidate.
		const specText = this.specText ?? (this.spec && `${JSON.stringify(this.spec, null, 2)}\n`);
		if (specText !== undefined) await attempt(() => writeFileSync(join(this.stateDir, "spec.json"), specText));
		this.record.spec = {
			sha256: specText === undefined ? null : createHash("sha256").update(specText).digest("hex"),
			path: specText === undefined ? null : "spec.json",
			validation: this.validation,
			review: this.review,
			baseValues: this.baseValues,
		};
		this.record.branches = this.record.branches.map((branch) => ({ ...branch, ...this.scores.get(branch.key) }));
		this.record.endedAt = new Date().toISOString();
		this.record.cleanupErrors = problems;
		await attempt(() => this.save());
		this.options.onStatus(undefined);
	}
}
