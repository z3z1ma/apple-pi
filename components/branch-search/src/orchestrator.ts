import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AfterToolCallContext, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { abortable } from "../../shared/src/abortable.js";
import type { ForkWorktree } from "../../shared/src/fork-context.js";
import { type ForkHandle, type ForkRequest, startFork } from "../../shared/src/forked-continuation.js";
import { type BranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import { constraintPool } from "./draw.js";
import { FailureCounter, shellOutcome } from "./failure-signature.js";
import { type BatchEntry, type Enumeration, type NodeKey, type ObservedTree, planStep, selectWinner } from "./plan.js";
import {
	authorPrompt,
	authorRetryPrompt,
	challengerPrompt,
	childDirective,
	enumeratorPrompt,
	enumeratorRetryPrompt,
	fidelityPrompt,
	gapPrompt,
	parseDefect,
	parseEnumeration,
	parseFidelity,
	parseJson,
	parseRepair,
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
	type ChallengerRecord,
	emptyCost,
	type FidelityRecord,
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
	type GateResult,
	gatesOn,
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
	commitAll,
	commitWorktree,
	git,
	gitCommonDir,
	hasHead,
	PLAIN_DIFF,
	privateObjects,
	refPrefix,
	pruneRefs,
	readRefs,
	restoreRefs,
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

/** One request on a user-global model profile; resolves with the reply text and its token usage (spec 10.5, 10.6). */
export type ReviewRequest = (
	profile: string,
	prompt: string,
	signal: AbortSignal,
) => Promise<{ text: string; usage: Parameters<typeof addUsage>[1] }>;

/** A profile request whose reply ended in an error or abort; it still cost what `usage` says. */
export class ProfileRequestError extends Error {
	constructor(
		message: string,
		readonly usage: Parameters<typeof addUsage>[1],
	) {
		super(message);
	}
}

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
	/** Passive mode: the repeatedly failing command; the author and the reviewer see it (spec 5.3, 10.1, 10.5). */
	seedGate?: string;
	/**
	 * Wraps a prompt appended to the fork point: the author's first turn, the root enumerator, and every
	 * root branch. Without it, the prompt is a hidden custom message (human mode). Agent mode answers
	 * the pending `search_branches` call with it, so the fork point ends with that call (spec 5.2, I4).
	 */
	forkPointPrompt?: (prompt: string) => AgentMessage;
	/** Sends the scorer review when `scorer.reviewProfile` is set, and the fidelity tags when `fidelity.profile` is set. */
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

function passesAll(gates: GateResult[]): boolean {
	return gates.every((gate) => gate.result === "pass");
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

/** A challenger as the search holds it: its commit lives only in the private scorer object store. */
interface LiveChallenger extends ChallengerRecord {
	/** Null until its work is committed; a cancelled or failed challenger has none. */
	commit: string | null;
}

interface LiveBranch {
	record: BranchRecord;
	worktree: string;
	/** The branch's final conversation, which its enumerator and children fork (spec 6.7). */
	messages: AgentMessage[];
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
	/** The review request's tokens and duration; null without a review profile. */
	reviewCost: (TokenCost & { ms: number }) | null = null;
	readonly authorCost: TokenCost & { ms: number } = { ...emptyCost(), ms: 0 };
	/** Fork point: the parent's conversation when the search starts. */
	readonly forkPoint: AgentMessage[];
	/** The author's conversation so far; each later author turn continues it (spec 6.3). */
	authorMessages: AgentMessage[];
	/** Scorer content: in memory until the search ends; their commits only in `scorerObjects` (spec 8.4). */
	readonly challengers: LiveChallenger[] = [];
	/** Challenger solutions that passed the authored gates; every later validation requires the gates to reject them. */
	gaps: LiveChallenger[] = [];
	/**
	 * The private object store of the scorer-side forks (author, challengers) and of the challengers'
	 * commits: whatever git writes there is deleted before the enumerator starts (spec 8.4).
	 */
	readonly scorerObjects: string;
	scorerEnv: Record<string, string> | undefined;
	/** The shared refs before the scorer phase; role forks' git may move them onto private objects. */
	refsBefore: Map<string, string> | undefined;
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
	gitQueue: Promise<void> = Promise.resolve();
	winnerStat: DiffStat | undefined;

	constructor(
		readonly options: SearchOptions,
		readonly config: BranchSearchConfig,
		readonly root: string,
		readonly commonDir: string,
	) {
		this.stateDir = join(commonDir, "apple-pi", "branch-search", this.id);
		this.scorerObjects = join(this.stateDir, "scorer-objects");
		this.recordPath = join(this.stateDir, "record.json");
		this.seed = options.seed ?? randomBytes(32);
		this.forkPoint = options.session.sessionManager.buildSessionProjection().messages;
		this.authorMessages = this.forkPoint;
		this.record = {
			id: this.id,
			mode: options.mode,
			goal: options.goal ?? null,
			seedGate: options.seedGate ?? null,
			seed: Buffer.from(this.seed).toString("hex"),
			startedAt: new Date(this.started).toISOString(),
			endedAt: null,
			config,
			base: null,
			spec: null,
			cost: { total: emptyCost(), author: null, review: null, challengers: null, ms: 0 },
			challengers: null,
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

	/** A prompt appended to the fork point itself; continuations of a fork's own conversation use `customPrompt`. */
	private atForkPoint(prompt: string): AgentMessage {
		return (this.options.forkPointPrompt ?? customPrompt)(prompt);
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
				: await this.challenge(base.commit, await this.authorScorer(base.commit)),
		);
		this.baseValues = validation.baseValues;
		await this.checkChallengers(base.commit, spec);
		await this.restoreSharedRefs();
		// No challenger solution or object an author wrote may be on disk once the enumerator starts (spec 8.4).
		rmSync(this.scorerObjects, { recursive: true, force: true });
		this.freeze(spec);

		this.status("enumerate");
		this.enumerations.root = await this.enumerate("root", base.commit, this.forkPoint, [], undefined, (prompt) =>
			this.atForkPoint(prompt),
		);
		this.save();

		const stop = await this.runGenerations(base);
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

	/**
	 * Plan, enumerate, run, and score until the planning function stops (spec 6.7). Each generation's
	 * worktrees, which hold installed scorer files after scoring, are removed before any later fork
	 * starts (spec 8.4); children and enumerators get fresh worktrees from their parent's commit.
	 */
	private async runGenerations(base: { commit: string; tree: string }): Promise<{ kind: "stop"; outcome: string }> {
		let generation = 0;
		for (;;) {
			const step = this.plan();
			if (step.kind === "stop") return step;
			if (step.kind === "enumerate") {
				this.status(`enumerate g${generation}`);
				await this.enumerateParents(step.parents);
				this.save();
				continue;
			}
			await this.runGeneration(generation, step.batch, base);
			await settleAll([this.scoreGeneration(generation, base.commit), this.tagFidelity(generation)]);
			await this.removeGeneration(generation);
			generation++;
		}
	}

	/**
	 * The parents' enumerators run at once. The first failure stops the others, including any still
	 * waiting to start, and is rethrown once every one of them has removed its worktree.
	 */
	private async enumerateParents(parents: NodeKey[]): Promise<void> {
		const stop = new AbortController();
		let failure: { error: unknown } | undefined;
		await Promise.allSettled(
			parents.map(async (key) => {
				try {
					await this.enumerateParent(key, stop.signal);
				} catch (error) {
					if (!failure) {
						failure = { error };
						stop.abort();
					}
				}
			}),
		);
		if (failure) throw failure.error;
	}

	/** The enumerator of a dead branch: a fork of its final conversation in a worktree of its commit (spec 6.7). */
	private async enumerateParent(key: NodeKey, stop: AbortSignal): Promise<void> {
		const parent = this.liveBranch(key);
		this.enumerations[key] = await this.enumerate(
			key,
			parent.record.commit as string,
			parent.messages,
			this.lineage(key),
			stop,
		);
	}

	private liveBranch(key: NodeKey): LiveBranch {
		const branch = this.branches.find(({ record }) => record.key === key);
		if (!branch) throw new Error(`Unknown branch ${key}.`);
		return branch;
	}

	/** Remove a scored generation's worktrees; its commits and refs stay. */
	private async removeGeneration(generation: number): Promise<void> {
		const worktrees = this.branches.filter(({ record }) => record.generation === generation).map((b) => b.worktree);
		await removeWorktrees(this.root, worktrees);
		for (const worktree of worktrees) this.worktrees.delete(worktree);
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
		this.refsBefore = await readRefs(this.root);
		this.scorerEnv = privateObjects(this.commonDir, this.scorerObjects);
		const append = this.atForkPoint(authorPrompt(this.options.goal, this.options.seedGate));
		const authored = await this.authorTurns(base, append, this.config.scorer.validationRetries + 1);
		if (!authored) throw new SearchAbort("scorer invalid");
		return authored;
	}

	/**
	 * Up to `turns` author turns, each continuing the author's conversation: the first with `append`,
	 * each later one with the report on the previous reply. Returns the first spec that validates.
	 */
	private async authorTurns(
		base: string,
		append: AgentMessage,
		turns: number,
		/** Repair turns: the spec that stands while the author may dismiss gaps instead of revising it. */
		current?: { spec: ScorerSpec; validation: Validation },
	): Promise<{ spec: ScorerSpec; validation: Validation } | undefined> {
		let next = append;
		for (let turn = 0; turn < turns; turn++) {
			this.status("author");
			this.authorMessages = await this.runAuthor(base, this.authorMessages, next);
			const attempt = this.validation.length;
			let value = parseJson(replyText(this.authorMessages));
			if (current) {
				const answer = parseRepair(value);
				const problem = typeof answer === "string" ? answer : answer && this.dismiss(answer.dismissed);
				if (problem) {
					this.validation.push({ attempt, ok: false, report: problem, ms: 0 });
					next = customPrompt(authorRetryPrompt(problem));
					continue;
				}
				if (answer && typeof answer !== "string" && !("spec" in answer)) {
					if (this.gaps.length === 0) return current;
					const report = `These solutions are neither rejected nor dismissed: ${this.gaps.map((g) => g.key).join(", ")}.`;
					this.validation.push({ attempt, ok: false, report, ms: 0 });
					next = customPrompt(authorRetryPrompt(report));
					continue;
				}
				if (answer && typeof answer !== "string") value = answer.spec;
			}
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
			next = customPrompt(authorRetryPrompt(report));
		}
		return undefined;
	}

	/**
	 * With `scorer.challengers`, challenger forks each write a plausible but wrong solution without
	 * seeing the checks. A solution that passes every authored gate is a gap: the author gets its diff
	 * and stated defect and revises the spec, which must then reject every gap, within
	 * `scorer.validationRetries` turns. A gap still open when they run out makes the scorer invalid.
	 */
	private async challenge(
		base: string,
		authored: { spec: ScorerSpec; validation: Validation },
	): Promise<{ spec: ScorerSpec; validation: Validation }> {
		const count = this.config.scorer.challengers;
		if (count === undefined) return authored;
		this.status("challenge");
		await settleAll(Array.from({ length: count }, (_, i) => this.runChallenger(base, i + 1)));
		for (const challenger of this.challengers) {
			challenger.gap = passesAll(await this.gatesOnChallenger(base, authored.spec, challenger));
			challenger.caught = !challenger.gap;
		}
		this.gaps = this.challengers.filter((challenger) => challenger.gap);
		if (this.gaps.length === 0) return authored;
		const repaired = await this.authorTurns(
			base,
			customPrompt(gapPrompt(this.gaps)),
			this.config.scorer.validationRetries,
			authored,
		);
		if (repaired) return repaired;
		this.spec = authored.spec;
		// Every gap dismissed, though a revision failed: the authored spec stands.
		if (this.gaps.length === 0) return authored;
		return this.openGaps(this.gaps);
	}

	/**
	 * Mark the named gaps dismissed: the author judged their solutions correct, so they no longer count
	 * and later validations need not reject them. Returns a problem for a name that is not an open gap.
	 */
	private dismiss(dismissed: Record<string, string>): string | undefined {
		const unknown = Object.keys(dismissed).filter((key) => !this.gaps.some((gap) => gap.key === key));
		if (unknown.length > 0) return `Only open gaps can be dismissed, not: ${unknown.join(", ")}.`;
		for (const gap of this.gaps) {
			const reason = dismissed[gap.key];
			if (reason === undefined) continue;
			gap.dismissed = true;
			gap.dismissReason = reason.trim();
		}
		this.gaps = this.gaps.filter((gap) => !gap.dismissed);
		return undefined;
	}

	/**
	 * Run every challenger solution against the final scorer, after repair and review, so `caught`
	 * describes the scorer that freezes. A solution it accepts is an open gap: the scorer is invalid.
	 */
	private async checkChallengers(base: string, spec: ScorerSpec): Promise<void> {
		for (const challenger of this.challengers)
			challenger.caught = !passesAll(await this.gatesOnChallenger(base, spec, challenger));
		const open = this.challengers.filter((challenger) => !challenger.caught && !challenger.dismissed);
		if (open.length > 0) this.openGaps(open);
	}

	/**
	 * Put back every shared ref the scorer phase created, deleted, or moved, with the reflog entries
	 * it added (a stash or a commit on a branch), before the private store those refs may name goes.
	 * The search's own refs are left alone. Runs once.
	 */
	private async restoreSharedRefs(): Promise<void> {
		const before = this.refsBefore;
		if (!before) return;
		this.refsBefore = undefined;
		await restoreRefs(this.root, before, refPrefix(this.id), this.scorerEnv);
	}

	/** Record the open gaps as a failed validation and end the search `aborted: scorer invalid`. */
	private openGaps(open: LiveChallenger[]): never {
		const report = [
			"The scorer leaves open gaps:",
			...open.map(({ key }) => `${key}: its wrong solution passes every gate`),
		].join("\n");
		this.validation.push({ attempt: this.validation.length, ok: false, report, ms: 0 });
		throw new SearchAbort("scorer invalid");
	}

	/**
	 * One challenger: a role fork of the parent at the fork point in its own base worktree. Its git
	 * writes, and the harness's commit of its work, go to the private scorer object store. Its record
	 * and cost exist from the start, so a cancelled or failed challenger still counts what it spent.
	 */
	private async runChallenger(base: string, number: number): Promise<void> {
		const key = `challenger-${number}`;
		const started = Date.now();
		const challenger: LiveChallenger = {
			key,
			defect: null,
			diff: "",
			gap: false,
			caught: false,
			dismissed: false,
			dismissReason: null,
			cost: { ...emptyCost(), ms: 0 },
			commit: null,
		};
		this.challengers.push(challenger);
		const env = this.scorerEnv;
		let path: string | undefined;
		try {
			path = await this.worktree(key, base);
			const { wallClockSec, outputTokens } = this.config.branch.limits;
			let output = 0;
			const fork = this.fork({
				messages: this.forkPoint,
				append: this.atForkPoint(challengerPrompt(number, this.options.goal)),
				label: `Branch search ${key}`,
				worktree: this.forkWorktree(path, [], env),
				onUsage: (usage) => {
					addUsage(challenger.cost, usage);
					output += usage.output;
					if (outputTokens !== undefined && output > outputTokens) fork.abort();
				},
			});
			const timer = wallClockSec === undefined ? undefined : setTimeout(() => fork.abort(), wallClockSec * 1000);
			const result = await fork.result.finally(() => clearTimeout(timer));
			this.options.signal.throwIfAborted();
			const worktree = path;
			const commit = await this.serial(() => commitAll(worktree, `branch-search ${this.id} ${key}`, env));
			const patch = await git(this.root, ["diff", ...PLAIN_DIFF, "--binary", base, commit], { env });
			// `git` trims its output; a patch needs its final newline to apply.
			challenger.diff = patch === "" ? "" : `${patch}\n`;
			challenger.defect = parseDefect(replyText(result.messages));
			challenger.commit = commit;
		} finally {
			challenger.cost.ms = Date.now() - started;
			if (path !== undefined) {
				const worktree = path;
				await this.serial(() => removeWorktrees(this.root, [worktree]));
				this.worktrees.delete(worktree);
			}
		}
	}

	/** The spec's gates on a challenger's solution, in a fresh worktree of its private commit. */
	private async gatesOnChallenger(base: string, spec: ScorerSpec, challenger: LiveChallenger): Promise<GateResult[]> {
		const env = this.scorerEnv;
		const path = await this.worktree(`check-${challenger.key}`, challenger.commit as string, env);
		try {
			return await gatesOn(path, base, spec, this.id, this.options.signal, env);
		} finally {
			await this.serial(() => removeWorktrees(this.root, [path]));
			this.worktrees.delete(path);
		}
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
				worktree: this.forkWorktree(worktree, [], this.scorerEnv),
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
		const cost = { ...emptyCost(), ms: 0 };
		this.reviewCost = cost;
		const prompt = reviewPrompt({
			goal: this.options.goal ?? authored.spec.goal,
			seedGate: this.options.seedGate,
			diffStat: await git(this.root, ["diff", ...PLAIN_DIFF, "--stat", "HEAD", base]),
			spec: JSON.stringify(authored.spec),
		});
		let reply: string;
		try {
			if (!this.options.review) throw new Error("no review request is available");
			const answer = await abortable(this.options.review(profile, prompt, signal), signal);
			addUsage(cost, answer.usage);
			reply = answer.text;
		} catch (error) {
			if (error instanceof ProfileRequestError) addUsage(cost, error.usage);
			signal.throwIfAborted();
			review.reason = `the review request failed: ${error instanceof Error ? error.message : String(error)}`;
			review.ms = cost.ms = Date.now() - started;
			return authored;
		}
		review.ms = cost.ms = Date.now() - started;
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
		const lines = [validation.report];
		let ok = validation.ok;
		for (const gap of this.gaps) {
			const gates = await this.gatesOnChallenger(base, spec, gap);
			const failed = gates.filter((gate) => gate.result !== "pass").map((gate) => gate.id);
			if (failed.length === 0) {
				ok = false;
				lines.push(`${gap.key}: its wrong solution passes every gate; a gate must reject it`);
			} else lines.push(`${gap.key}: its wrong solution is rejected by gate ${failed.join(", ")}`);
		}
		const report = lines.join("\n");
		this.options.signal.throwIfAborted();
		this.validation.push({ attempt, ok, report, ms: Date.now() - started });
		return { ...validation, ok, report };
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

	/**
	 * A fork's binding to its worktree, with a private temporary directory beside the worktrees (spec 8.4).
	 * `ancestors` are the worktree roots its inherited conversation may name; they map onto `root`.
	 */
	private forkWorktree(root: string, ancestors: string[] = [], env?: Record<string, string>): ForkWorktree {
		const tmp = join(this.stateDir, "tmp", basename(root));
		return { root, parentRoot: this.root, tmp, ancestors, ...(env ? { env } : {}) };
	}

	/** The worktree roots of a branch and of every branch its conversation continues, oldest first. */
	private lineage(key: NodeKey | null): string[] {
		const roots: string[] = [];
		for (let current = key; current !== null; ) {
			const branch = this.liveBranch(current);
			roots.unshift(branch.worktree);
			current = branch.record.parent;
		}
		return roots;
	}

	private async worktree(name: string, commit: string, env?: NodeJS.ProcessEnv): Promise<string> {
		const path = join(this.stateDir, "wt", name);
		this.worktrees.add(path);
		await this.serial(() => addWorktree(this.root, path, commit, this.config.workspace.cloneIgnored, env));
		return path;
	}

	/** Enumerators run concurrently; their git worktree commands run one at a time. */
	private serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.gitQueue.then(task);
		this.gitQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/**
	 * An enumerator: a fork of `messages` in its own worktree of `commit`, asked once more after an
	 * unusable reply (spec 6.4). The root enumerator forks the parent at the base; the enumerator of a
	 * dead branch forks that branch's final conversation at its commit (spec 6.7).
	 */
	private async enumerate(
		key: string,
		commit: string,
		from: AgentMessage[],
		ancestors: string[] = [],
		stop?: AbortSignal,
		opening: (prompt: string) => AgentMessage = customPrompt,
	): Promise<Enumeration> {
		stop?.throwIfAborted();
		const path = await this.worktree(`enum-${key}`, commit);
		try {
			return await this.runEnumerator(key, this.forkWorktree(path, ancestors), from, opening, stop);
		} finally {
			await this.serial(() => removeWorktrees(this.root, [path]));
			this.worktrees.delete(path);
		}
	}

	/** `stop` aborts the enumerator's fork and keeps it from starting another (a sibling failed). */
	private async runEnumerator(
		key: string,
		worktree: ForkWorktree,
		from: AgentMessage[],
		opening: (prompt: string) => AgentMessage,
		stop?: AbortSignal,
	): Promise<Enumeration> {
		const cost = emptyCost();
		const started = Date.now();
		let messages = from;
		let append = opening(enumeratorPrompt(this.config.enumerate.count, this.options.goal));
		for (let attempt = 1; attempt <= 2; attempt++) {
			stop?.throwIfAborted();
			const fork = this.fork({
				messages,
				append,
				label: `Branch search enumerator ${key}`,
				worktree,
				onUsage: (usage) => addUsage(cost, usage),
			});
			const abort = () => fork.abort();
			stop?.addEventListener("abort", abort, { once: true });
			const result = await fork.result.finally(() => stop?.removeEventListener("abort", abort));
			this.options.signal.throwIfAborted();
			stop?.throwIfAborted();
			const parsed = parseEnumeration(key, replyText(result.messages));
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
			const start = entry.parent === null ? base.commit : (this.liveBranch(entry.parent).record.commit as string);
			const worktree = await this.worktree(entry.key, start);
			this.options.signal.throwIfAborted();
			runs.push(this.startBranch(generation, entry, start, worktree));
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

	/**
	 * A root forks the parent at the fork point under the root directive; a child forks its parent
	 * branch's final conversation under the child directive (spec 6.6, 10.3, 10.4).
	 */
	private startBranch(generation: number, entry: BatchEntry, startCommit: string, worktree: string): Promise<void> {
		const candidate = this.candidate(entry.parent, entry.candidate);
		const { goal } = this.options;
		const [messages, append] =
			entry.parent === null
				? [this.forkPoint, this.atForkPoint(rootDirective(entry.key, candidate, entry.constraint, goal))]
				: [
						this.liveBranch(entry.parent).messages,
						customPrompt(childDirective(entry.key, entry.parent, candidate, entry.constraint, goal)),
					];
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
			fidelity: null,
			cost: { ...emptyCost(), runMs: 0, scoreMs: 0 },
		};
		const live: LiveBranch = { record, worktree, messages: [] };
		this.branches.push(live);
		this.record.branches.push(record);

		const { wallClockSec, outputTokens } = this.config.branch.limits;
		// Why the harness stopped the run, if it did; the first reason stands.
		let stopped: "limit" | "stalled" | undefined;
		const stop = (reason: "limit" | "stalled") => {
			if (stopped) return;
			stopped = reason;
			fork.abort();
		};
		let output = 0;
		const started = Date.now();
		const onUsage = (usage: Usage) => {
			addUsage(record.cost, usage);
			output += usage.output;
			if (outputTokens !== undefined && output > outputTokens) stop("limit");
		};
		// The in-branch failure detector: the branch's own counts, the passive threshold (spec 6.6 step 4).
		const failures = new FailureCounter();
		const onToolResult = ({ toolCall, args, result, isError }: AfterToolCallContext) => {
			const outcome = shellOutcome(toolCall.name, args, result, isError);
			const counted = outcome && failures.record(outcome);
			if (counted && counted.count >= this.config.passive.repeatThreshold) stop("stalled");
		};
		const fork = this.fork({
			messages,
			append,
			label: `Branch search ${entry.key}`,
			worktree: this.forkWorktree(worktree, this.lineage(entry.parent)),
			onUsage,
			onToolResult,
		});
		const timer = wallClockSec === undefined ? undefined : setTimeout(() => stop("limit"), wallClockSec * 1000);
		return fork.result.then(({ messages }) => {
			clearTimeout(timer);
			live.messages = messages;
			record.endSeq = this.seq++;
			record.cost.runMs = Date.now() - started;
			const last = lastAssistant(messages);
			const { selfReport, learned } = parseSelfReport(replyText(messages));
			record.learned = learned;
			let report: BranchSelfReport = selfReport;
			if (stopped) report = stopped;
			else if (last?.stopReason === "error" || last?.stopReason === "aborted") report = "error";
			record.selfReport = report;
		});
	}

	/** A candidate of the enumeration a branch was drawn from: the root's, or its parent's. */
	private candidate(parent: NodeKey | null, id: string) {
		const candidate = this.enumerations[parent ?? "root"]?.candidates.find((c) => c.id === id);
		if (!candidate) throw new Error(`Unknown candidate ${id}.`);
		return candidate;
	}

	/**
	 * With `fidelity.profile`, one request per branch of the generation on that profile asks whether
	 * the branch's diff implements its directive (spec 6.6, 10.6). The tag is for evaluation: a failed
	 * request or an unusable reply records why, and no tag changes a branch's fate or the selection.
	 */
	private async tagFidelity(generation: number): Promise<void> {
		const profile = this.config.fidelity?.profile;
		if (profile === undefined) return;
		const { signal } = this.options;
		const branches = this.branches.filter(({ record }) => record.generation === generation);
		await settleAll(
			branches.map(async ({ record }) => {
				const started = Date.now();
				const tag: FidelityRecord = { profile, faithful: null, reason: "", cost: { ...emptyCost(), ms: 0 } };
				record.fidelity = tag;
				try {
					if (!this.options.review) throw new Error("no profile request is available");
					const diff = await git(this.root, ["diff", ...PLAIN_DIFF, record.startCommit, record.commit as string]);
					const prompt = fidelityPrompt(this.candidate(record.parent, record.candidate), record.constraint, diff);
					const answer = await abortable(this.options.review(profile, prompt, signal), signal);
					addUsage(tag.cost, answer.usage);
					const verdict = parseFidelity(answer.text);
					if (typeof verdict === "string") tag.reason = `the reply could not be used: ${verdict}`;
					else Object.assign(tag, verdict);
				} catch (error) {
					if (error instanceof ProfileRequestError) addUsage(tag.cost, error.usage);
					signal.throwIfAborted();
					tag.reason = `the fidelity request failed: ${error instanceof Error ? error.message : String(error)}`;
				} finally {
					tag.cost.ms = Date.now() - started;
				}
			}),
		);
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
		const challengers = this.record.challengers?.map((challenger) => challenger.cost) ?? [];
		this.record.cost = {
			total: sumCosts([
				...(authored ? [this.authorCost] : []),
				...(this.reviewCost ? [this.reviewCost] : []),
				...challengers,
				...this.record.enumerations.map((e) => e.cost),
				...this.record.branches.map((b) => b.cost),
			]),
			author: authored ? this.authorCost : null,
			review: this.reviewCost,
			challengers: this.record.challengers
				? { ...sumCosts(challengers), ms: challengers.reduce((total, { ms }) => total + ms, 0) }
				: null,
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
		await attempt(() => this.restoreSharedRefs());
		await attempt(() => rmSync(this.scorerObjects, { recursive: true, force: true }));

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
		this.record.challengers =
			this.challengers.length === 0 ? null : this.challengers.map(({ commit: _, ...challenger }) => challenger);
		this.record.endedAt = new Date().toISOString();
		this.record.cleanupErrors = problems;
		await attempt(() => this.save());
		this.options.onStatus(undefined);
	}
}
