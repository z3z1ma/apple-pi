import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { abortable } from "../../shared/src/abortable.js";
import type { ForkWorktree } from "../../shared/src/fork-context.js";
import { type ForkHandle, type ForkRequest, startFork } from "../../shared/src/forked-continuation.js";
import { cloneIgnoredDirs, git, repoRoot } from "../../shared/src/git.js";
import type { ProfileRequest } from "../../shared/src/model-profiles.js";
import { relativePathsProblem } from "../../shared/src/relative-paths.js";
import { type BranchSearchConfig, normalizePaths, validateBranchSearchConfig } from "./config.js";
import { type Gate, type Judge, rank, type Scores, score } from "./judge.js";
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
	protectedClones,
	protectedState,
	protectProblem,
	pruneRefs,
	removeWorktrees,
	restoreProtected,
	snapshotBase,
} from "./workspace.js";

export const SEARCH_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
	"search_branches",
	"ask_user_question",
	"update_notebook",
	"revisit_note",
	"ledger_add",
	"ledger_status",
	"explore",
	"research",
	"send_mail",
	"reply",
	"post",
	"escalate",
	"hire",
	"call_in",
	"rehire",
	"send_home",
	"let_go",
	"move",
	"rename",
	"meet",
	"end_meeting",
	"assign",
	"unassign",
	"take_task",
	"focus",
	"finish_task",
	"promote_task",
	"update_self",
	"read_thread",
	"remind_me",
	"monitor",
	"task",
	"codemode",
]);

export const BRANCH_SEARCH_MESSAGE_TYPE = "branch-search";

export interface SearchOptions {
	session: AgentSession;
	cwd: string;
	config: unknown;
	goal: string;
	judges: Judge[];
	gates: Gate[];
	protect: string[];
	forkPointPrompt?: (prompt: string) => AgentMessage;
	profileRequest?: ProfileRequest;
	signal: AbortSignal;
	onStatus: (text: string | undefined) => void;
}

export interface SearchResult {
	outcome: string;
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

async function settleAll(tasks: Promise<unknown>[]): Promise<void> {
	const failed = (await Promise.allSettled(tasks)).find((result) => result.status === "rejected");
	if (failed) throw failed.reason;
}

export async function runBranchSearch(options: SearchOptions): Promise<SearchResult> {
	const validated = validateBranchSearchConfig(options.config);
	if (!validated.ok) return { outcome: "not configured", report: validated.text };
	const lexical = relativePathsProblem(options.protect);
	if (lexical !== undefined) throw new Error(`protect: ${lexical}`);
	if (!(await hasHead(options.cwd)))
		return { outcome: "aborted: no git history", report: "Branch search: aborted: no git history." };
	const root = await repoRoot(options.cwd);
	const protect = normalizePaths(options.protect);
	const outside = protectProblem(root, protect);
	if (outside !== undefined) throw new Error(`protect: ${outside}`);
	return new Search({ ...options, protect }, validated.config, root, await gitCommonDir(options.cwd)).run();
}

interface LiveAttempt {
	record: AttemptRecord;
	worktree: string;
}

class Search {
	readonly id = searchId(new Date());
	readonly stateDir: string;
	readonly recordPath: string;
	readonly protectedClones: string;
	readonly record: SearchRecord;
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
		this.protectedClones = join(this.stateDir, "protected");
		this.forkPoint = options.session.sessionManager.buildSessionProjection().messages;
		this.record = {
			id: this.id,
			goal: options.goal,
			judges: options.judges,
			gates: options.gates,
			protect: options.protect,
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
		await cloneIgnoredDirs(
			this.root,
			this.protectedClones,
			protectedClones(this.options.protect, this.config.workspace.cloneIgnored),
		);

		this.status("enumerate");
		const candidates = (await this.enumerate(base.commit)).slice(0, this.config.attempts);

		const worktrees: string[] = [];
		for (const i of candidates.keys()) worktrees.push(await this.worktree(`a${i + 1}`, base.commit));
		this.options.signal.throwIfAborted();
		const runs = candidates.map((candidate, i) => this.runAttempt(`a${i + 1}`, candidate, worktrees[i] as string));
		this.status("run");
		await settleAll(runs);
		this.options.signal.throwIfAborted();
		const scorable: LiveAttempt[] = [];
		const restored = new Map<string, string>();
		const { protect } = this.options;
		for (const attempt of this.attempts) {
			const { record, worktree } = attempt;
			record.commit = await commitWorktree(this.root, worktree, this.id, record.key);
			try {
				record.protectedChanged = await restoreProtected(
					this.protectedClones,
					worktree,
					base.commit,
					this.options.protect,
					this.config.workspace.cloneIgnored,
				);
				if (record.protectedChanged.length > 0)
					record.commit = await commitWorktree(this.root, worktree, this.id, record.key);
				if (protect.length > 0) restored.set(worktree, await protectedState(worktree, protect));
				scorable.push(attempt);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				record.scores = { gates: [], judges: [], failure: `its protected paths could not be restored: ${reason}` };
			}
		}
		this.save();

		this.status("score");
		const scores = await score(
			scorable.map(({ worktree }) => worktree),
			this.options.gates,
			this.options.judges,
			this.options.signal,
			async (worktree) => protect.length === 0 || (await protectedState(worktree, protect)) === restored.get(worktree),
		);
		for (const [i, { record }] of scorable.entries()) record.scores = scores[i] as Scores;
		for (const { record } of this.attempts) {
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

	private async enumerate(base: string): Promise<Candidate[]> {
		const path = await this.worktree("enumerate", base);
		try {
			const { goal, judges, gates, protect } = this.options;
			let messages = this.forkPoint;
			let append = this.atForkPoint(enumeratorPrompt(this.config.attempts, goal, judges, gates, protect));
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

	private runAttempt(key: string, candidate: Candidate, worktree: string): Promise<void> {
		const record: AttemptRecord = {
			key,
			candidate,
			stop: null,
			commit: null,
			diffSize: null,
			scores: null,
			protectedChanged: [],
			cost: { ...emptyCost(), ms: 0 },
		};
		this.attempts.push({ record, worktree });
		this.record.attempts.push(record);
		const { goal, judges, gates, protect } = this.options;
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
			append: this.atForkPoint(attemptPrompt(key, candidate, goal, judges, gates, protect)),
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

	private atForkPoint(prompt: string): AgentMessage {
		return (this.options.forkPointPrompt ?? customPrompt)(prompt);
	}

	private fork(request: ForkRequest): ForkHandle {
		this.options.signal.throwIfAborted();
		const handle = startFork(this.options.session, { blockedTools: SEARCH_BLOCKED_TOOLS, ...request });
		this.forks.add(handle);
		handle.result.finally(() => this.forks.delete(handle)).catch(() => undefined);
		return handle;
	}

	private forkWorktree(root: string): ForkWorktree {
		return { root, parentRoot: this.root, tmp: join(this.stateDir, "tmp", basename(root)) };
	}

	private async worktree(name: string, commit: string): Promise<string> {
		const path = join(this.stateDir, "wt", name);
		this.worktrees.add(path);
		await this.serial(() => addWorktree(this.root, path, commit, this.config.workspace.cloneIgnored));
		return path;
	}

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
		const keep = this.record.outcome === "ready" && this.record.winner ? [this.record.winner] : [];
		await attempt(() => pruneRefs(this.root, this.id, keep));
		await attempt(() => rmSync(join(this.stateDir, "wt"), { recursive: true, force: true }));
		await attempt(() => rmSync(join(this.stateDir, "tmp"), { recursive: true, force: true }));
		await attempt(() => rmSync(this.protectedClones, { recursive: true, force: true }));
		this.record.endedAt = new Date().toISOString();
		this.record.cleanupErrors = problems;
		await attempt(() => this.save());
		this.options.onStatus(undefined);
	}
}
