import { type CommandResult, runCommand } from "../../shared/src/run-command.js";

/** A user-supplied scalar judge: a command whose last stdout line is a number, and which way is better. */
export interface Judge {
	command: string;
	better: "lower" | "higher";
	/** Runs per attempt, ranked by their median; absent means 1. */
	repeat?: number;
	/** Seconds before the command's process group is killed and the attempt fails; absent means no limit. */
	timeoutSec?: number;
}

/** A pass/fail command; a plain string has no time limit. */
export type Gate = string | { command: string; timeoutSec?: number };

export function gateCommand(gate: Gate): { command: string; timeoutSec?: number } {
	return typeof gate === "string" ? { command: gate } : gate;
}

/** The number on the last non-empty stdout line, if that whole line is one finite number. */
export function lastNumber(stdout: string): number | undefined {
	const line = stdout
		.split("\n")
		.map((part) => part.trim())
		.filter(Boolean)
		.at(-1);
	if (line === undefined) return undefined;
	const value = Number(line);
	return Number.isFinite(value) ? value : undefined;
}

export interface Scores {
	/** Each gate in order: whether it exited 0, and `timedOut` when its time limit killed it. */
	gates: { command: string; pass: boolean; timedOut?: true }[];
	/**
	 * Each judge in order, empty when a gate failed: the median of its runs, or null when a run failed,
	 * and every run's number.
	 */
	judges: { command: string; value: number | null; runs: number[] }[];
	/** Why the attempt cannot win: the first judge that failed. Gate failures are in `gates`. */
	failure: string | null;
}

/** The end of a command's output, enough to tell why it misbehaved. */
function excerpt({ stdout, stderr }: CommandResult): string {
	const text = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
	return text === "" ? "" : `: ${text.slice(-300)}`;
}

/** Why an attempt whose scoring commands changed a protected path fails. */
export const TAMPERED = "scoring changed a protected path";

export function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Why a judge run gave no number, or undefined when it gave one. */
function judgeFailure(command: string, timeoutSec: number | undefined, run: CommandResult): string | undefined {
	if (run.timedOut) return `judge \`${command}\` timed out after ${timeoutSec}s`;
	if (run.exitCode !== 0) return `judge \`${command}\` exited with code ${run.exitCode}${excerpt(run)}`;
	if (lastNumber(run.stdout) === undefined) return `judge \`${command}\` printed no number on its last stdout line`;
	return undefined;
}

/**
 * Score each worktree, one command at a time: every worktree's gates in turn, then the judges on the
 * worktrees that passed every gate. Each judge's runs go round-robin across those worktrees (run 1
 * of each, then run 2 of each, ...) so drift of the machine favors none of them. A run that fails or
 * prints no number fails that worktree's judge, and its later runs are skipped. After every command,
 * `intact` checks the worktree; a worktree that fails it fails with TAMPERED and runs nothing more.
 */
export async function score(
	worktrees: readonly string[],
	gates: readonly Gate[],
	judges: readonly Judge[],
	signal: AbortSignal,
	intact: (worktree: string) => Promise<boolean> = async () => true,
): Promise<Scores[]> {
	const env = { CI: "1" };
	const all: Scores[] = [];
	const stillIntact = async (worktree: string, scores: Scores) => {
		if (await intact(worktree)) return true;
		scores.failure = TAMPERED;
		return false;
	};
	for (const worktree of worktrees) {
		const scores: Scores = { gates: [], judges: [], failure: null };
		all.push(scores);
		for (const { command, timeoutSec } of gates.map(gateCommand)) {
			signal.throwIfAborted();
			const run = await runCommand(command, worktree, env, { signal, timeoutSec });
			scores.gates.push({
				command,
				pass: run.exitCode === 0 && !run.timedOut,
				...(run.timedOut && { timedOut: true }),
			});
			if (!(await stillIntact(worktree, scores))) break;
		}
	}
	const judged = worktrees.flatMap((worktree, i) => {
		const scores = all[i] as Scores;
		return scores.failure === null && scores.gates.every((gate) => gate.pass) ? [{ worktree, scores }] : [];
	});
	for (const { command, repeat = 1, timeoutSec } of judges) {
		const entries = judged.map(({ scores }) => {
			const entry = { command, value: null as number | null, runs: [] as number[] };
			scores.judges.push(entry);
			return { entry, failed: false };
		});
		for (let round = 0; round < repeat; round++) {
			for (const [i, { worktree, scores }] of judged.entries()) {
				const state = entries[i] as (typeof entries)[number];
				if (state.failed || scores.failure === TAMPERED) continue;
				signal.throwIfAborted();
				const run = await runCommand(command, worktree, env, { signal, timeoutSec });
				const failure = judgeFailure(command, timeoutSec, run);
				if (failure === undefined) state.entry.runs.push(lastNumber(run.stdout) as number);
				else {
					state.failed = true;
					scores.failure ??= failure;
				}
				if (!(await stillIntact(worktree, scores))) state.failed = true;
			}
		}
		for (const { entry, failed } of entries) if (!failed && entry.runs.length > 0) entry.value = median(entry.runs);
	}
	signal.throwIfAborted();
	return all;
}

/** Whether attempt scores can win: every gate passed and every judge printed a number. */
export function qualifies(scores: Scores): boolean {
	return scores.failure === null && scores.gates.every((gate) => gate.pass);
}

/**
 * The qualifying attempts, best first: judges in declared order and direction, then smaller diff,
 * then key.
 */
export function rank<T extends { key: string; diffSize: number | null; scores: Scores | null }>(
	attempts: readonly T[],
	judges: readonly Judge[],
): T[] {
	const value = (attempt: T, i: number) => attempt.scores?.judges[i]?.value as number;
	return attempts
		.filter((attempt) => attempt.scores !== null && qualifies(attempt.scores))
		.sort((a, b) => {
			for (const [i, { better }] of judges.entries()) {
				const [x, y] = [value(a, i), value(b, i)];
				if (x !== y) return better === "lower" ? x - y : y - x;
			}
			return (a.diffSize as number) - (b.diffSize as number) || a.key.localeCompare(b.key, "en", { numeric: true });
		});
}
