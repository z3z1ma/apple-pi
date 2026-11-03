import { type CommandResult, runCommand } from "../../shared/src/run-command.js";

export interface Judge {
	command: string;
	better: "lower" | "higher";
	repeat?: number;
	timeoutSec?: number;
}

export type Gate = string | { command: string; timeoutSec?: number };

export function gateCommand(gate: Gate): { command: string; timeoutSec?: number } {
	return typeof gate === "string" ? { command: gate } : gate;
}

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
	gates: { command: string; pass: boolean; timedOut?: true }[];
	judges: { command: string; value: number | null; runs: number[] }[];
	failure: string | null;
}

function excerpt({ stdout, stderr }: CommandResult): string {
	const text = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
	return text === "" ? "" : `: ${text.slice(-300)}`;
}

export const TAMPERED = "scoring changed a protected path";

export function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function judgeFailure(command: string, timeoutSec: number | undefined, run: CommandResult): string | undefined {
	if (run.timedOut) return `judge \`${command}\` timed out after ${timeoutSec}s`;
	if (run.exitCode !== 0) return `judge \`${command}\` exited with code ${run.exitCode}${excerpt(run)}`;
	if (lastNumber(run.stdout) === undefined) return `judge \`${command}\` printed no number on its last stdout line`;
	return undefined;
}

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

export function qualifies(scores: Scores): boolean {
	return scores.failure === null && scores.gates.every((gate) => gate.pass);
}

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
