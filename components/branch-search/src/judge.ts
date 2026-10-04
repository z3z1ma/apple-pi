import { type CommandResult, runCommand } from "../../shared/src/run-command.js";

/** A user-supplied scalar judge: a command whose last stdout line is a number, and which way is better. */
export interface Judge {
	command: string;
	better: "lower" | "higher";
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
	/** Each gate in order: whether it exited 0. */
	gates: { command: string; pass: boolean }[];
	/** Each judge in order: its number, or null when it failed. */
	judges: { command: string; value: number | null }[];
	/** Why the attempt cannot win: the first judge that failed. Gate failures are in `gates`. */
	failure: string | null;
}

/** The end of a command's output, enough to tell why it misbehaved. */
function excerpt({ stdout, stderr }: CommandResult): string {
	const text = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
	return text === "" ? "" : `: ${text.slice(-300)}`;
}

/** Run every gate, then every judge, in `worktree`. A judge that fails or prints no number fails the attempt. */
export async function score(worktree: string, gates: string[], judges: Judge[], signal: AbortSignal): Promise<Scores> {
	const env = { CI: "1" };
	const scores: Scores = { gates: [], judges: [], failure: null };
	for (const command of gates) {
		signal.throwIfAborted();
		const run = await runCommand(command, worktree, env, { signal });
		scores.gates.push({ command, pass: run.exitCode === 0 });
	}
	for (const { command } of judges) {
		signal.throwIfAborted();
		const run = await runCommand(command, worktree, env, { signal });
		const value = run.exitCode === 0 ? lastNumber(run.stdout) : undefined;
		scores.judges.push({ command, value: value ?? null });
		if (value === undefined && scores.failure === null)
			scores.failure =
				run.exitCode === 0
					? `judge \`${command}\` printed no number on its last stdout line`
					: `judge \`${command}\` exited with code ${run.exitCode}${excerpt(run)}`;
	}
	signal.throwIfAborted();
	return scores;
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
