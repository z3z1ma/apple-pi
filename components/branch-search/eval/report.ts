import type { TokenCost } from "../src/record.js";
import { ARMS, type ArmId, type ArmResult } from "./arms.js";
import type { Excluded, EvalTask } from "./tasks.js";

/** Prices in US dollars per million tokens, as Pi's model catalog states them. */
export interface Rates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface TaskEvaluation {
	task: EvalTask;
	excluded: Excluded[];
	arms: ArmResult[];
}

export interface Evaluation {
	startedAt: string;
	endedAt: string;
	/** The evaluated model, as the report names it. */
	model: string;
	configPath: string;
	rates?: Rates;
	tasks: TaskEvaluation[];
	skipped: { id: string; reason: string; excluded: Excluded[] }[];
}

/** Input + cache read + cache write + output, as replay counts tokens. */
export function totalTokens(cost: TokenCost): number {
	return cost.inputTokens + cost.cacheReadTokens + cost.cacheWriteTokens + cost.outputTokens;
}

function usd(cost: TokenCost, rates: Rates | undefined): string {
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

function sum(results: ArmResult[]): TokenCost & { ms: number } {
	const total = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, ms: 0 };
	for (const { tokens, ms } of results) {
		total.inputTokens += tokens.inputTokens;
		total.cacheReadTokens += tokens.cacheReadTokens;
		total.cacheWriteTokens += tokens.cacheWriteTokens;
		total.outputTokens += tokens.outputTokens;
		total.ms += ms;
	}
	return total;
}

/** Tokens, cache reads, wall-clock, and price of a set of runs: the cost beside a result. */
function costText(results: ArmResult[], rates: Rates | undefined): string {
	const total = sum(results);
	return `${count(totalTokens(total))} tokens, ${count(total.cacheReadTokens)} cache read, ${seconds(total.ms)}, $${usd(total, rates)}`;
}

function fidelityCell(result: ArmResult, rates: Rates | undefined): string {
	const branches = result.record?.branches ?? [];
	const tags = branches.flatMap((branch) => (branch.fidelity ? [branch.fidelity] : []));
	if (tags.length === 0) return "—";
	const cost = result.tagTokens;
	return `${tags.filter((tag) => tag.faithful === true).length}/${tags.length} faithful (${count(totalTokens(cost))} tokens, $${usd(cost, rates)})`;
}

function armRow(result: ArmResult, rates: Rates | undefined): string {
	const gates = Object.values(result.gates);
	const passed = gates.filter((gate) => gate === "pass").length;
	const winner = result.winner;
	const rank =
		result.arm.startsWith("C") && winner
			? `${winner.rank} (${winner.rootCandidate}; preferred ${winner.preferred})`
			: "—";
	const outcome = result.error === undefined ? result.outcome : `error: ${result.error}`;
	return `| ${[
		result.arm,
		result.solved ? "yes" : "no",
		cell(outcome),
		`${passed}/${gates.length}`,
		count(totalTokens(result.tokens)),
		count(result.tokens.cacheReadTokens),
		seconds(result.ms),
		usd(result.tokens, rates),
		rank,
		result.arm.startsWith("C") ? (result.tailWin ? "yes" : "no") : "—",
		fidelityCell(result, rates),
	].join(" | ")} |`;
}

const HEADER =
	"| Arm | Solved | Outcome | Oracle gates | Total tokens | Cache read tokens | Wall-clock (run) | Est. cost (USD, main-model rates) | Winner rank vs preferred | Tail win | Fidelity |\n|---|---|---|---|---|---|---|---|---|---|---|";

function armRuns(evaluation: Evaluation, arm: ArmId): ArmResult[] {
	return evaluation.tasks.flatMap((task) => task.arms.filter((result) => result.arm === arm));
}

/** Spec 18's success criteria for one kind of scorer, each with the cost of the runs it compares. */
function criteria(evaluation: Evaluation, scorer: "oracle" | "authored"): string[] {
	const a = armRuns(evaluation, "A");
	const b = armRuns(evaluation, `B-${scorer}`);
	const c = armRuns(evaluation, `C-${scorer}`);
	const n = evaluation.tasks.length;
	const solved = (runs: ArmResult[]) => runs.filter((run) => run.solved).length;
	const box = (holds: boolean) => (holds ? "[x]" : "[ ]");
	const { rates } = evaluation;
	const tails = c.filter((run) => run.tailWin);
	// C's solves where A failed, and how many of those the model's preferred candidate won.
	const gained = evaluation.tasks.flatMap((task) => {
		const runA = task.arms.find((run) => run.arm === "A");
		const runC = task.arms.find((run) => run.arm === `C-${scorer}`);
		return runC?.solved && !runA?.solved ? [runC] : [];
	});
	const byPreferred = gained.filter((run) => run.winner?.rank === 0).length;
	return [
		`- ${box(solved(c) > solved(a))} C solves more tasks than A (${scorer} scorer): C ${solved(c)} of ${n} (${costText(c, rates)}), A ${solved(a)} of ${n} (${costText(a, rates)})`,
		`- ${box(solved(c) >= solved(b))} C solves at least as many tasks as B (${scorer} scorer): C ${solved(c)} of ${n} (${costText(c, rates)}), B ${solved(b)} of ${n} (${costText(b, rates)})`,
		`- ${box(tails.length > 0)} Tail wins occur (${scorer} scorer): ${tails.length} (${costText(tails, rates)}). C solved ${gained.length} task(s) that A did not; the preferred candidate won ${byPreferred} of them.`,
	];
}

/** The evaluation report (spec 18): per task and arm, the summary, and the success criteria. */
export function formatEvaluation(evaluation: Evaluation): string {
	const { rates } = evaluation;
	const lines = [
		`# Branch search evaluation, ${evaluation.startedAt}`,
		"",
		`- Model: ${evaluation.model}`,
		`- Configuration: \`${evaluation.configPath}\``,
		`- Ran from ${evaluation.startedAt} to ${evaluation.endedAt}`,
		`- Tasks evaluated: ${evaluation.tasks.length}; skipped: ${evaluation.skipped.length}`,
		`- Wall-clock (run) is the arm's run alone: the single trajectory, or the whole search including its own scoring; it leaves out making the clone and the final oracle scoring.
- Cost: tokens are input + cache read + cache write + output. Est. cost is main-model-equivalent, not actual spend: it prices every token at the evaluated model's rates${rates ? ` (USD per million: input ${rates.input}, output ${rates.output}, cache read ${rates.cacheRead}, cache write ${rates.cacheWrite})` : " (no rates known: n/a)"}; a scorer review or fidelity tag that ran on another profile is priced the same way, so its real price may differ. Fidelity tags are an evaluation cost outside the arm's totals; the Fidelity column prices them beside the tags, and the summary adds them.`,
		'- Arms: A is one trajectory (one prompt, `branch.limits` as its budget). B searches with `draw: "model"`, C with `draw: "random"`; `-oracle` runs use the oracle gates as the scorer (no review), `-authored` runs let the model author it. Every final state is scored with the oracle gates; solved means every oracle gate passes.',
		"- Winner rank: the position of the winner's root ancestor (the winner itself for a root) in the model order of the root enumeration: 0 is `preferred`, then the other candidates in returned order. Tail win (conservative): arm C solved the task, that root is not `preferred`, and its position is at or beyond the most roots B's configuration could ever draw (`branches.perGeneration + generations.maxDepth × generations.rootsPerGeneration`, at most `branches.maxTotal`), so no B run could have reached it.",
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
	lines.push("## Results", "");
	for (const { task, excluded, arms } of evaluation.tasks) {
		lines.push(
			`### \`${task.id}\``,
			"",
			`Base \`${task.base.slice(0, 12)}\`, final \`${task.final.slice(0, 12)}\` (${task.provenance === "cited" ? `${task.commits.length} cited commits: ${task.commits.map((commit) => `\`${commit.slice(0, 12)}\``).join(", ")}` : `override, ${task.commits.length} commits`}); oracle gates: ${task.oracles.map(({ path, command }) => `\`${path}\` (\`${command}\`)`).join(", ")}`,
		);
		if (excluded.length > 0)
			lines.push(
				`Changed tests that are no oracle: ${excluded.map(({ path, reason }) => `\`${path}\` ${reason}`).join("; ")}`,
			);
		lines.push("", HEADER, ...arms.map((result) => armRow(result, rates)), "");
	}
	lines.push(
		"## Summary",
		"",
		"| Arm | Solved | Total tokens | Cache read tokens | Wall-clock (run) | Est. cost (USD, main-model rates) | Fidelity tag tokens (USD, main-model rates) | Tail wins |",
		"|---|---|---|---|---|---|---|---|",
	);
	for (const arm of ARMS) {
		const runs = armRuns(evaluation, arm);
		const total = sum(runs);
		const tags = sum(runs.map((run) => ({ ...run, tokens: run.tagTokens })));
		lines.push(
			`| ${[
				arm,
				`${runs.filter((run) => run.solved).length} of ${runs.length}`,
				count(totalTokens(total)),
				count(total.cacheReadTokens),
				seconds(total.ms),
				usd(total, rates),
				`${count(totalTokens(tags))} (${usd(tags, rates)})`,
				arm.startsWith("C") ? String(runs.filter((run) => run.tailWin).length) : "—",
			].join(" | ")} |`,
		);
	}
	lines.push("", "## Success criteria", "", ...criteria(evaluation, "oracle"), ...criteria(evaluation, "authored"), "");
	return lines.join("\n");
}
