import type { TokenCost } from "../src/record.js";
import type { GateResult } from "../src/scorer.js";
import { type Rates, totalTokens, usd } from "./report.js";

/** The arms of the trap benchmark, in run and report order. */
export const TRAP_ARMS = ["alone", "search", "search+challengers"] as const;
export type TrapArm = (typeof TRAP_ARMS)[number];

/** The win bar, fixed before the first run: search with challengers over the agent alone, over all traps. */
export const WIN_BAR_POINTS = 20;

/** One finished run of one arm on one trap. */
export interface TrapRun {
	trap: string;
	arm: TrapArm;
	/** 0-based run number within its trap and arm. */
	index: number;
	/** The oracle passes on the final state, and the run itself did not fail. */
	solved: boolean;
	oracle: GateResult["result"];
	/** Alone: the final stop reason, or `limit`. Search arms: the search outcome. */
	outcome: string;
	/** The run alone: the trajectory, or the whole search with its own scoring. */
	ms: number;
	/** Alone: the session's requests. Search arms: the search's `cost.total`. */
	tokens: TokenCost;
	/** Search arms: whether the frozen scorer's gates fail on the known-wrong solution; null without a frozen scorer, and for alone. */
	killed: boolean | null;
	searchId: string | null;
	/** Set when the run failed before it could be scored; it then counts as unsolved. */
	error?: string;
}

export interface TrapBenchmark {
	startedAt: string;
	endedAt: string;
	model: string;
	configPath: string;
	rates?: Rates;
	traps: string[];
	runsPerArm: number;
	concurrency: number;
	runs: TrapRun[];
}

const count = (value: number) => value.toLocaleString("en-US");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const percent = (part: number, whole: number) => `${Math.round((100 * part) / whole)}%`;
const rate = (part: number, whole: number) =>
	whole === 0 ? "0 of 0" : `${part} of ${whole} (${percent(part, whole)})`;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length === 0) return 0;
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function sum(runs: TrapRun[]): TokenCost {
	const total = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
	for (const { tokens } of runs) {
		total.inputTokens += tokens.inputTokens;
		total.cacheReadTokens += tokens.cacheReadTokens;
		total.cacheWriteTokens += tokens.cacheWriteTokens;
		total.outputTokens += tokens.outputTokens;
	}
	return total;
}

const solvedText = (runs: TrapRun[]) => rate(runs.filter((run) => run.solved).length, runs.length);

/** How often the frozen checks of these search runs killed the known-wrong solution, over all runs. */
function killText(runs: TrapRun[]): string {
	const unfrozen = runs.filter((run) => run.killed === null).length;
	const killed = rate(runs.filter((run) => run.killed === true).length, runs.length);
	return unfrozen === 0 ? killed : `${killed}, ${unfrozen} without a frozen scorer`;
}

export interface WinBar {
	/** Null when either arm has no finished run. */
	met: boolean | null;
	alone: { solved: number; runs: number };
	challengers: { solved: number; runs: number };
}

/**
 * Search with challengers meets the bar when its overall solve rate is at least `WIN_BAR_POINTS` percentage
 * points above the agent alone's. Compared in integers: 3/5 − 2/5 is not exactly 0.2 in floating point.
 */
export function winBar(runs: TrapRun[]): WinBar {
	const tally = (arm: TrapArm) => {
		const of = runs.filter((run) => run.arm === arm);
		return { solved: of.filter((run) => run.solved).length, runs: of.length };
	};
	const alone = tally("alone");
	const challengers = tally("search+challengers");
	if (alone.runs === 0 || challengers.runs === 0) return { met: null, alone, challengers };
	const lead = 100 * (challengers.solved * alone.runs - alone.solved * challengers.runs);
	return { met: lead >= WIN_BAR_POINTS * alone.runs * challengers.runs, alone, challengers };
}

function verdict(bar: WinBar): string {
	const { alone, challengers } = bar;
	const compared = `search+challengers solved ${rate(challengers.solved, challengers.runs)}, alone ${rate(alone.solved, alone.runs)}`;
	if (bar.met === null) return `- [ ] Undecided: ${compared}; both arms need a finished run (bar: +${WIN_BAR_POINTS}).`;
	const points = Math.round((100 * challengers.solved) / challengers.runs - (100 * alone.solved) / alone.runs);
	const signed = points >= 0 ? `+${points}` : `${points}`;
	return `- [${bar.met ? "x" : " "}] ${bar.met ? "Met" : "Not met"}: ${compared}: ${signed} percentage points (bar: +${WIN_BAR_POINTS}).`;
}

/** The trap benchmark report: per trap and arm, the scorer kill rates, the overall solve rates, the win bar, and every run. */
export function formatTrapReport(benchmark: TrapBenchmark): string {
	const { rates } = benchmark;
	const expected = benchmark.traps.length * TRAP_ARMS.length * benchmark.runsPerArm;
	const order = (run: TrapRun) => [benchmark.traps.indexOf(run.trap), TRAP_ARMS.indexOf(run.arm), run.index] as const;
	const runs = [...benchmark.runs].sort((a, b) => {
		const [x, y] = [order(a), order(b)];
		return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
	});
	const lines = [
		`# Trap benchmark, ${benchmark.startedAt}`,
		"",
		`- Model: ${benchmark.model}`,
		`- Configuration: \`${benchmark.configPath}\``,
		`- Ran from ${benchmark.startedAt} to ${benchmark.endedAt}`,
		`- Traps: ${benchmark.traps.map((trap) => `\`${trap}\``).join(", ")}; ${benchmark.runsPerArm} runs per arm, ${benchmark.concurrency} at once`,
		`- Runs finished: ${runs.length} of ${expected}`,
		"- Arms: alone is one prompt (the goal with a branch directive's commitment framing, `branch.limits` as its budget); search runs branch search with an authored scorer and no challengers; search+challengers adds `scorer.challengers`. Each run starts from a fresh repository holding only the trap's base. A search's final state is its winner, applied or not, else the base. Every final state is scored with the trap's hidden oracle; solved means it passes.",
		"- Scorer kill rate: after each search, the trap's known-wrong solution is put on a fresh copy of the base, the search's frozen scorer is installed, and its gates run; it is killed when any gate fails. The rate counts every run of the arm, so a search without a frozen scorer (say, `aborted: scorer invalid`) counts as no kill.",
		`- Wall-clock is the run alone (the trajectory, or the whole search with its own scoring), without staging and oracle scoring. Tokens are input + cache read + cache write + output; fidelity tags (\`fidelity.profile\`) are outside them. Est. cost prices every token at the evaluated model's rates${rates ? ` (USD per million: input ${rates.input}, output ${rates.output}, cache read ${rates.cacheRead}, cache write ${rates.cacheWrite})` : " (no rates known: n/a)"}, including a scorer review on another profile.`,
		"",
		"## Results",
		"",
		"| Trap | Arm | Solved | Median wall-clock | Total tokens | Est. cost (USD) | Scorer kill rate |",
		"|---|---|---|---|---|---|---|",
	];
	for (const trap of benchmark.traps)
		for (const arm of TRAP_ARMS) {
			const of = runs.filter((run) => run.trap === trap && run.arm === arm);
			if (of.length === 0) continue;
			const total = sum(of);
			lines.push(
				`| ${[
					trap,
					arm,
					solvedText(of),
					seconds(median(of.map((run) => run.ms))),
					count(totalTokens(total)),
					usd(total, rates),
					arm === "alone" ? "—" : killText(of),
				].join(" | ")} |`,
			);
		}
	lines.push("", "## Scorer kill rate", "");
	for (const arm of TRAP_ARMS.filter((arm) => arm !== "alone"))
		lines.push(`- ${arm}: ${killText(runs.filter((run) => run.arm === arm))}`);
	lines.push("", "## Overall", "", "| Arm | Solved | Total tokens | Est. cost (USD) |", "|---|---|---|---|");
	for (const arm of TRAP_ARMS) {
		const of = runs.filter((run) => run.arm === arm);
		const total = sum(of);
		lines.push(`| ${arm} | ${solvedText(of)} | ${count(totalTokens(total))} | ${usd(total, rates)} |`);
	}
	lines.push("", "## Win bar", "", verdict(winBar(runs)), "", "## Runs", "");
	lines.push(
		"| Trap | Arm | Run | Solved | Oracle | Outcome | Wall-clock | Total tokens | Est. cost (USD) | Killed known-wrong | Search |",
		"|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const run of runs) {
		const killed = run.arm === "alone" ? "—" : run.killed === null ? "no frozen scorer" : run.killed ? "yes" : "no";
		lines.push(
			`| ${[
				run.trap,
				run.arm,
				String(run.index + 1),
				run.solved ? "yes" : "no",
				run.oracle,
				cell(run.error === undefined ? run.outcome : `error: ${run.error}`),
				seconds(run.ms),
				count(totalTokens(run.tokens)),
				usd(run.tokens, rates),
				killed,
				run.searchId ? `\`${run.searchId}\`` : "—",
			].join(" | ")} |`,
		);
	}
	lines.push("");
	return lines.join("\n");
}
