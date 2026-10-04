import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { abortable } from "../../shared/src/abortable.js";
import type { ForkWorktree } from "../../shared/src/fork-context.js";
import { git, repoRoot } from "../../shared/src/git.js";
import { type ForkHandle, type ForkRequest, startFork } from "../../shared/src/forked-continuation.js";
import { type BranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import { type Judge, rank, score } from "./judge.js";
import {
	attemptPrompt,
	type Candidate,
	choicePrompt,
	enumeratorPrompt,
	enumeratorRetryPrompt,
	parseCandidates,
	parseChoice,
} from "./prompts.js";
import { type AttemptRecord, addUsage, emptyCost, type SearchRecord, writeRecord } from "./record.js";
import { formatReport } from "./report.js";
import {
	addWorktree,
	applyWinner,
	commitWorktree,
	type DiffStat,
	diffStat,
	gitCommonDir,
	hasHead,
	PLAIN_DIFF,
	pruneRefs,
	removeWorktrees,
	snapshotBase,
} from "./workspace.js";

/** Tools no search fork may run. They stay in the tool list so the request prefix stays the parent's. */
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

/** The custom message type of search prompts in forks. */
export const BRANCH_SEARCH_MESSAGE_TYPE = "branch-search";

/** One request on a user-global model profile, without the conversation or tools. */
export type ProfileRequest = (
	profile: string,
	prompt: string,
	signal: AbortSignal,
) => Promise<{ text: string; usage: Usage }>;

export interface SearchOptions {
	/** The live parent session; its current projection is the fork point. */
	session: AgentSession;
	cwd: string;
	/** The loaded, not yet validated, configuration. */
	config: unknown;
	goal: string;
	/** At least one. */
	judges: Judge[];
	gates: string[];
	/**
	 * Wraps a prompt appended to the fork point (the enumerator's first turn and every attempt).
	 * Without it, the prompt is a hidden custom message. The tool answers its pending
	 * `search_branches` call with it, so the fork point ends with that call.
	 */
	forkPointPrompt?: (prompt: string) => AgentMessage;
	/** Sends the judge model's request when `judge.profile` is set. */
	profileRequest?: ProfileRequest;
	signal: AbortSignal;
	/** Receives `branching <phase>`, and `undefined` once cleanup is done. */
	onStatus: (text: string | undefined) => void;
}

export interface SearchResult {
	/** `applied`, `ready`, `no winner`, `aborted: <reason>`, or `not configured`. */
	outcome: string;
	/** The report body, or the configuration problems. */
	report: string;
	recordPath?: string;
}

class SearchAbort extends Error {}

function searchId(now: Date): string {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	return `bs-${stamp}-${randomBytes(2).toString("hex")}`;
}

function customPrompt(text: string): AgentMessage {
	return {
		role: "custom",
		customType: BRANCH_SEARCH_MESSAGE_TYPE,
		content: text,
		display: false,
		timestamp: Date.now(),
	};
}

function replyText(messages: AgentMessage[]): string {
	const last = messages.at(-1);
	if (last?.role !== "assistant") return "";
	return last.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
}

/** Wait for every task, then fail with the first error, so nothing still runs in a worktree that cleanup removes. */
async function settleAll(tasks: Promise<unknown>[]): Promise<void> {
	const failed = (await Promise.allSettled(tasks)).find((result) => result.status === "rejected");
	if (failed) throw failed.reason;
}

/**
 * Run one search: snapshot the base, enumerate approaches, run attempts in parallel worktrees, score
 * them with the gates and judges, pick the winner, apply it, report, and clean up.
 */
export async function runBranchSearch(options: SearchOptions): Promise<SearchResult> {
	const validated = validateBranchSearchConfig(options.config);
	if (!validated.ok) return { outcome: "not configured", report: validated.text };
	if (!(await hasHead(options.cwd)))
		return { outcome: "aborted: no git history", report: "Branch search: aborted: no git history." };
	const root = await repoRoot(options.cwd);
	return new Search(options, validated.config, root, await gitCommonDir(options.cwd)).run();
}

interface LiveAttempt {
	record: AttemptRecord;
	worktree: string;
}

class Search {
	readonly id = searchId(new Date());
	readonly stateDir: string;
	readonly recordPath: string;
	readonly record: SearchRecord;
	/** Fork point: the parent's conversation when the search starts. */
	readonly forkPoint: AgentMessage[];
	readonly forks = new Set<ForkHandle>();
	readonly worktrees = new Set<string>();
	readonly attempts: LiveAttempt[] = [];
	readonly started = Date.now();
	gitQueue: Promise<void> = Promise.resolve();
	winnerStat: DiffStat | undefined;

	constructor(
		readonly options: SearchOptions,
		readonly config: BranchSearchConfig,
		readonly root: string,
		commonDir: string,
	) {
		this.stateDir = join(commonDir, "apple-pi", "branch-search", this.id);
		this.recordPath = join(this.stateDir, "record.json");
		this.forkPoint = options.session.sessionManager.buildSessionProjection().messages;
		this.record = {
			id: this.id,
			goal: options.goal,
			judges: options.judges,
			gates: options.gates,
			config,
			startedAt: new Date(this.started).toISOString(),
			endedAt: null,
			base: null,
			attempts: [],
			choice: null,
			winner: null,
			apply: null,
			outcome: null,
			abortReason: null,
			cost: { ...emptyCost(), ms: 0 },
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
			const reason = signal.aborted
				? "cancelled"
				: error instanceof SearchAbort
					? error.message
					: error instanceof Error
						? error.message
						: String(error);
			this.record.outcome = signal.aborted || error instanceof SearchAbort ? `aborted: ${reason}` : "aborted: error";
			this.record.abortReason = reason;
		} finally {
			signal.removeEventListener("abort", abortForks);
			await this.cleanup();
		}
		const report = formatReport(this.record, this.recordPath, this.winnerStat);
		return { outcome: this.record.outcome as string, report, recordPath: this.recordPath };
	}

	private async search(): Promise<void> {
		const base = await snapshotBase(this.root, this.id);
		this.record.base = base;
		this.save();

		this.status("enumerate");
		const candidates = (await this.enumerate(base.commit)).slice(0, this.config.attempts);

		const runs: Promise<void>[] = [];
		for (const [i, candidate] of candidates.entries()) {
			const worktree = await this.worktree(`a${i + 1}`, base.commit);
			this.options.signal.throwIfAborted();
			runs.push(this.runAttempt(`a${i + 1}`, candidate, worktree));
		}
		this.status("run");
		await settleAll(runs);
		this.options.signal.throwIfAborted();
		for (const { record, worktree } of this.attempts)
			record.commit = await commitWorktree(this.root, worktree, this.id, record.key);
		this.save();

		// One attempt at a time, so a judge that measures time or memory is not skewed by the others.
		this.status("score");
		for (const { record, worktree } of this.attempts) {
			record.scores = await score(worktree, this.options.gates, this.options.judges, this.options.signal);
			const stat = await diffStat(this.root, base.commit, record.commit as string);
			record.diffSize = stat.added + stat.deleted;
		}
		this.save();

		const ranked = rank(this.record.attempts, this.options.judges);
		const first = ranked[0];
		if (!first) {
			this.record.outcome = "no winner";
			return;
		}
		const winner = ranked.length > 1 ? await this.choose(ranked, base.commit) : first.key;
		this.record.winner = winner;
		const commit = this.attempts.find(({ record }) => record.key === winner)?.record.commit as string;
		this.winnerStat = await diffStat(this.root, base.commit, commit);

		this.status("apply");
		this.record.apply = await applyWinner(this.root, {
			base,
			winner: commit,
			patchPath: join(this.stateDir, "winner.patch"),
			signal: this.options.signal,
		});
		this.record.outcome = this.record.apply.applied ? "applied" : "ready";
	}

	/**
	 * With `judge.profile`, one request on that profile chooses among the qualifying attempts. A failed
	 * request or an unusable reply leaves the judge numbers' order, and the record and report say why.
	 */
	private async choose(ranked: AttemptRecord[], base: string): Promise<string> {
		const profile = this.config.judge?.profile;
		const best = ranked[0]?.key as string;
		if (profile === undefined) return best;
		const { signal } = this.options;
		this.status("judge");
		const choice: SearchRecord["choice"] = { profile, winner: null, reason: "" };
		this.record.choice = choice;
		try {
			if (!this.options.profileRequest) throw new Error("no profile request is available");
			const attempts = [];
			for (const record of ranked)
				attempts.push({
					key: record.key,
					approach: record.candidate.approach,
					values: record.scores?.judges.map(({ value }) => value) ?? [],
					diff: await git(this.root, ["diff", ...PLAIN_DIFF, base, record.commit as string]),
				});
			const prompt = choicePrompt(this.options.goal, this.options.judges, attempts);
			const answer = await abortable(this.options.profileRequest(profile, prompt, signal), signal);
			addUsage(this.record.cost, answer.usage);
			const parsed = parseChoice(
				answer.text,
				ranked.map(({ key }) => key),
			);
			if (typeof parsed === "string") choice.reason = `its reply could not be used: ${parsed}`;
			else Object.assign(choice, parsed);
		} catch (error) {
			signal.throwIfAborted();
			choice.reason = `the request failed: ${error instanceof Error ? error.message : String(error)}`;
		}
		return choice.winner ?? best;
	}

	/** The enumerator: a fork of the parent at the fork point in its own base worktree, asked once more after an unusable reply. */
	private async enumerate(base: string): Promise<Candidate[]> {
		const path = await this.worktree("enumerate", base);
		try {
			const { goal, judges, gates } = this.options;
			let messages = this.forkPoint;
			let append = this.atForkPoint(enumeratorPrompt(this.config.attempts, goal, judges, gates));
			for (let turn = 1; turn <= 2; turn++) {
				const fork = this.fork({
					messages,
					append,
					label: "Branch search enumerator",
					worktree: this.forkWorktree(path),
					onUsage: (usage) => addUsage(this.record.cost, usage),
				});
				const result = await fork.result;
				this.options.signal.throwIfAborted();
				const parsed = parseCandidates(replyText(result.messages));
				if (typeof parsed !== "string") return parsed;
				messages = result.messages;
				append = customPrompt(enumeratorRetryPrompt(parsed));
			}
			throw new SearchAbort("enumeration failed");
		} finally {
			await this.serial(() => removeWorktrees(this.root, [path]));
			this.worktrees.delete(path);
		}
	}

	/** One attempt: a fork of the parent at the fork point, bound to its own worktree, under the per-attempt limits. */
	private runAttempt(key: string, candidate: Candidate, worktree: string): Promise<void> {
		const record: AttemptRecord = {
			key,
			candidate,
			stop: null,
			commit: null,
			diffSize: null,
			scores: null,
			cost: { ...emptyCost(), ms: 0 },
		};
		this.attempts.push({ record, worktree });
		this.record.attempts.push(record);
		const { goal, judges, gates } = this.options;
		const { wallClockSec, outputTokens } = this.config.limits;
		let limited = false;
		const stop = () => {
			limited = true;
			fork.abort();
		};
		let output = 0;
		const started = Date.now();
		const fork = this.fork({
			messages: this.forkPoint,
			append: this.atForkPoint(attemptPrompt(key, candidate, goal, judges, gates)),
			label: `Branch search ${key}`,
			worktree: this.forkWorktree(worktree),
			onUsage: (usage) => {
				addUsage(record.cost, usage);
				addUsage(this.record.cost, usage);
				output += usage.output;
				if (outputTokens !== undefined && output > outputTokens) stop();
			},
		});
		const timer = wallClockSec === undefined ? undefined : setTimeout(stop, wallClockSec * 1000);
		return fork.result.then(({ messages }) => {
			clearTimeout(timer);
			record.cost.ms = Date.now() - started;
			const last = messages.at(-1);
			const failed = last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted");
			record.stop = limited ? "limit" : failed ? "error" : "done";
		});
	}

	/** A prompt appended to the fork point itself; continuations of a fork's own conversation use `customPrompt`. */
	private atForkPoint(prompt: string): AgentMessage {
		return (this.options.forkPointPrompt ?? customPrompt)(prompt);
	}

	private fork(request: ForkRequest): ForkHandle {
		// The abort handler stops only forks that exist, so none may start after it fired.
		this.options.signal.throwIfAborted();
		const handle = startFork(this.options.session, { blockedTools: SEARCH_BLOCKED_TOOLS, ...request });
		this.forks.add(handle);
		handle.result.finally(() => this.forks.delete(handle)).catch(() => undefined);
		return handle;
	}

	/** A fork's binding to its worktree, with a private temporary directory beside the worktrees. */
	private forkWorktree(root: string): ForkWorktree {
		return { root, parentRoot: this.root, tmp: join(this.stateDir, "tmp", basename(root)) };
	}

	private async worktree(name: string, commit: string): Promise<string> {
		const path = join(this.stateDir, "wt", name);
		this.worktrees.add(path);
		await this.serial(() => addWorktree(this.root, path, commit, this.config.workspace.cloneIgnored));
		return path;
	}

	/** Git worktree commands run one at a time. */
	private serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.gitQueue.then(task);
		this.gitQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private status(phase: string): void {
		this.options.onStatus(`branching ${phase}`);
	}

	private save(): void {
		this.record.cost.ms = Date.now() - this.started;
		writeRecord(this.recordPath, this.record);
	}

	/** Stop every fork, remove every worktree and every search ref but a ready winner's; keep the record files. */
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
		// Only a winner that was not applied keeps its ref, for the report's merge command.
		const keep = this.record.outcome === "ready" && this.record.winner ? [this.record.winner] : [];
		await attempt(() => pruneRefs(this.root, this.id, keep));
		await attempt(() => rmSync(join(this.stateDir, "wt"), { recursive: true, force: true }));
		await attempt(() => rmSync(join(this.stateDir, "tmp"), { recursive: true, force: true }));
		this.record.endedAt = new Date().toISOString();
		this.record.cleanupErrors = problems;
		await attempt(() => this.save());
		this.options.onStatus(undefined);
	}
}
