import type { EvalTask, Excluded } from "./tasks.js";

/** Prices in US dollars per million tokens, as Pi's model catalog states them. */
export interface Rates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface TokenCost {
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
}

export interface TaskResult {
	task: EvalTask;
	excluded: Excluded[];
	/** Every oracle test passes on the final state. */
	solved: boolean;
	/** Each oracle test file's result on the final state. */
	gates: Record<string, "pass" | "fail" | "timeout">;
	tokens: TokenCost;
	/** The run alone, without the clone or the oracle scoring. */
	ms: number;
	/** The final stop reason, or `limit`. */
	outcome: string;
	/** Set when the run failed; the task then counts as unsolved. */
	error?: string;
}

export interface Evaluation {
	startedAt: string;
	endedAt: string;
	/** The evaluated model, as the report names it. */
	model: string;
	configPath: string;
	rates?: Rates;
	tasks: TaskResult[];
	skipped: { id: string; reason: string; excluded: Excluded[] }[];
}

/** Input + cache read + cache write + output. */
export function totalTokens(cost: TokenCost): number {
	return cost.inputTokens + cost.cacheReadTokens + cost.cacheWriteTokens + cost.outputTokens;
}

/** The price of `cost` at `rates`, in US dollars to six decimals; `n/a` without rates. */
export function usd(cost: TokenCost, rates: Rates | undefined): string {
	if (!rates) return "n/a";
	const dollars =
		(cost.inputTokens * rates.input +
			cost.outputTokens * rates.output +
			cost.cacheReadTokens * rates.cacheRead +
			cost.cacheWriteTokens * rates.cacheWrite) /
		1_000_000;
	return dollars.toFixed(6);
}

const count = (value: number) => value.toLocaleString("en-US");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function row(result: TaskResult, rates: Rates | undefined): string {
	const gates = Object.values(result.gates);
	const outcome = result.error === undefined ? result.outcome : `error: ${result.error}`;
	return `| ${[
		`\`${result.task.id}\``,
		result.solved ? "yes" : "no",
		cell(outcome),
		`${gates.filter((gate) => gate === "pass").length}/${gates.length}`,
		count(totalTokens(result.tokens)),
		count(result.tokens.cacheReadTokens),
		seconds(result.ms),
		usd(result.tokens, rates),
	].join(" | ")} |`;
}

/** The evaluation report: per task the evidence and the run's result with its cost, then the totals. */
export function formatEvaluation(evaluation: Evaluation): string {
	const { rates, tasks } = evaluation;
	const lines = [
		`# History evaluation, ${evaluation.startedAt}`,
		"",
		`- Model: ${evaluation.model}`,
		`- Configuration: \`${evaluation.configPath}\``,
		`- Ran from ${evaluation.startedAt} to ${evaluation.endedAt}`,
		`- Tasks evaluated: ${tasks.length}; skipped: ${evaluation.skipped.length}`,
		`- Each task runs once: its closed \`task.md\` as one prompt in a clone of its base, scored with its oracle tests. Tokens are input + cache read + cache write + output; Est. cost prices them at the evaluated model's rates${rates ? ` (USD per million: input ${rates.input}, output ${rates.output}, cache read ${rates.cacheRead}, cache write ${rates.cacheWrite})` : " (no rates known: n/a)"}. Wall-clock is the run alone.`,
		"",
	];
	if (evaluation.skipped.length > 0) {
		lines.push("## Skipped tasks", "");
		for (const { id, reason, excluded } of evaluation.skipped) {
			lines.push(`- \`${id}\`: ${reason}`);
			for (const { path, reason: why } of excluded) lines.push(`  - \`${path}\` ${why}`);
		}
		lines.push("");
	}
	lines.push("## Tasks", "");
	for (const { task, excluded } of tasks) {
		const provenance =
			task.provenance === "cited"
				? `${task.commits.length} cited commits: ${task.commits.map((commit) => `\`${commit.slice(0, 12)}\``).join(", ")}`
				: `override, ${task.commits.length} commits`;
		lines.push(
			`- \`${task.id}\`: base \`${task.base.slice(0, 12)}\`, final \`${task.final.slice(0, 12)}\` (${provenance}); oracle tests: ${task.oracles.map(({ path, command }) => `\`${path}\` (\`${command}\`)`).join(", ")}`,
		);
		if (excluded.length > 0)
			lines.push(
				`  - Changed tests that are no oracle: ${excluded.map(({ path, reason }) => `\`${path}\` ${reason}`).join("; ")}`,
			);
	}
	lines.push(
		"",
		"## Results",
		"",
		"| Task | Solved | Outcome | Oracle tests | Total tokens | Cache read tokens | Wall-clock | Est. cost (USD) |",
		"|---|---|---|---|---|---|---|---|",
		...tasks.map((result) => row(result, rates)),
		"",
	);
	const total = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
	let ms = 0;
	for (const { tokens, ms: taken } of tasks) {
		total.inputTokens += tokens.inputTokens;
		total.cacheReadTokens += tokens.cacheReadTokens;
		total.cacheWriteTokens += tokens.cacheWriteTokens;
		total.outputTokens += tokens.outputTokens;
		ms += taken;
	}
	lines.push(
		`Solved ${tasks.filter((result) => result.solved).length} of ${tasks.length}: ${count(totalTokens(total))} tokens, ${count(total.cacheReadTokens)} cache read, ${seconds(ms)}, $${usd(total, rates)}.`,
		"",
	);
	return lines.join("\n");
}
