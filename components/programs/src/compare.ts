import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { managesPeople } from "../../organization/src/install.js";
import { sessionRole } from "../../organization/src/session-role.js";
import { statePaths } from "../../session-state/src/paths.js";
import { openPeerProgram, type PeerProgram } from "../../session-state/src/program-client.js";
import { git } from "../../shared/src/git.js";
import { runCommand } from "../../shared/src/run-command.js";
import { parseProgram } from "./programs.js";

export const COMPARE_PROGRAM_TOOL_NAME = "compare_program";
const MIN_SAMPLES = 3;

export interface ComparisonTask {
	task: string;
	check: string;
}

export interface Sample {
	task: number;
	arm: "with" | "without";
	correct: boolean;
	completed: boolean;
	usedProgram: boolean;
	toolCalls: number;
	tokens: number;
	cost: number;
	seconds: number;
	error?: string;
}

export interface ComparisonPlan {
	root: string;
	name: string;
	source: string;
	base: string;
	role: string;
	tasks: ComparisonTask[];
	samples: number;
}

export function recentTurnCost(dbPath = statePaths().db): number | undefined {
	if (!existsSync(dbPath)) return undefined;
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db
			.prepare(
				"select json_extract(result, '$.usage.cost.total') as cost from review_attempts where state = 'completed' and result is not null order by finished_at desc limit 50",
			)
			.all() as { cost: number | null }[];
		const costs = rows.flatMap((row) => (typeof row.cost === "number" ? [row.cost] : [])).sort((a, b) => a - b);
		return costs.length ? costs[Math.floor(costs.length / 2)] : undefined;
	} catch {
		return undefined;
	} finally {
		db.close();
	}
}

async function runSample(
	self: string,
	plan: ComparisonPlan,
	index: number,
	arm: Sample["arm"],
	signal: AbortSignal | undefined,
): Promise<Sample> {
	const task = plan.tasks[index]!;
	const copy = mkdtempSync(join(tmpdir(), "compare-program-"));
	const sample: Sample = {
		task: index,
		arm,
		correct: false,
		completed: false,
		usedProgram: false,
		toolCalls: 0,
		tokens: 0,
		cost: 0,
		seconds: 0,
	};
	try {
		await git(plan.root, ["worktree", "add", "--detach", copy, plan.base]);
		const programFile = join(copy, ".pi", "programs", `${plan.name}.js`);
		if (arm === "with") {
			mkdirSync(join(copy, ".pi", "programs"), { recursive: true });
			writeFileSync(programFile, plan.source);
		} else rmSync(programFile, { force: true });
		const program = await openPeerProgram(self, signal);
		const started = Date.now();
		try {
			await runTurn(program, self, plan, task.task, copy, sample, signal);
		} catch (error) {
			if (signal?.aborted) throw error;
			sample.error = error instanceof Error ? error.message : String(error);
		} finally {
			sample.seconds = Math.round((Date.now() - started) / 1000);
			await program.close();
		}
		if (sample.completed) sample.correct = (await runCommand(task.check, copy, process.env, { signal })).exitCode === 0;
	} finally {
		await git(plan.root, ["worktree", "remove", "--force", copy]).catch(async () => {
			rmSync(copy, { recursive: true, force: true });
			await git(plan.root, ["worktree", "prune"]);
		});
	}
	return sample;
}

async function runTurn(
	program: PeerProgram,
	self: string,
	plan: ComparisonPlan,
	task: string,
	copy: string,
	sample: Sample,
	signal: AbortSignal | undefined,
): Promise<void> {
	const person = randomUUID();
	const launched = await program.command(
		person,
		{ kind: "start", role: plan.role, cwd: copy, goal: { by: self, text: task } },
		{ signal },
	);
	if (launched.stage !== "applied") throw new Error(launched.reason ?? "The peer could not start");
	const receipt = await program.command(person, { kind: "run_turn", task }, { signal });
	const result = receipt.result;
	sample.completed = receipt.stage === "applied" && result?.status === "completed";
	sample.toolCalls = result?.operations.length ?? 0;
	sample.usedProgram = Boolean(result?.operations.some((operation) => operation.ref === `pi.program_${plan.name}`));
	sample.tokens = result?.usage ? result.usage.input + result.usage.output + result.usage.cacheRead : 0;
	sample.cost = result?.usage?.cost.total ?? 0;
	if (!sample.completed) sample.error = receipt.reason ?? result?.error ?? "The turn did not complete";
}

export async function comparePrograms(
	self: string,
	plan: ComparisonPlan,
	signal?: AbortSignal,
	onSample: (sample: Sample) => void = () => {},
): Promise<Sample[]> {
	const samples: Sample[] = [];
	for (let round = 0; round < plan.samples; round++)
		for (let index = 0; index < plan.tasks.length; index++)
			for (const arm of round % 2 ? (["without", "with"] as const) : (["with", "without"] as const)) {
				const sample = await runSample(self, plan, index, arm, signal);
				samples.push(sample);
				onSample(sample);
			}
	return samples;
}

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};

export function comparisonReport(plan: ComparisonPlan, samples: Sample[]): string {
	const lines = [
		`program_${plan.name} on ${plan.tasks.length} tasks, ${plan.samples} samples per arm, base ${plan.base}:`,
	];
	for (const [index, task] of plan.tasks.entries()) {
		lines.push(`Task ${index + 1}: ${task.task.slice(0, 120)}`);
		for (const arm of ["with", "without"] as const) {
			const runs = samples.filter((sample) => sample.task === index && sample.arm === arm);
			const correct = runs.filter((sample) => sample.correct).length;
			lines.push(
				`  ${arm}: ${correct}/${runs.length} correct; tool calls ${runs.map((s) => s.toolCalls).join(", ")} (median ${median(runs.map((s) => s.toolCalls))}); tokens median ${median(runs.map((s) => s.tokens))}; cost $${runs.reduce((sum, s) => sum + s.cost, 0).toFixed(2)}; seconds ${runs.map((s) => s.seconds).join(", ")}${arm === "with" ? `; used the program in ${runs.filter((s) => s.usedProgram).length}` : ""}`,
			);
			for (const failed of runs.filter((sample) => sample.error)) lines.push(`    failed: ${failed.error}`);
		}
	}
	return lines.join("\n");
}

function mayCompare(ctx: ExtensionContext): boolean {
	return managesPeople(ctx) || sessionRole(ctx)?.name === "capability-steward";
}

export function installCompareTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: COMPARE_PROGRAM_TOOL_NAME,
		label: "Compare program",
		description:
			"Measure a candidate saved program: temporary peers do each task in fresh worktrees with and without it, then the task's check runs there. Reports correctness first, then tool calls, tokens, cost and time per sample. Asks the operator to agree to the estimated cost first.",
		parameters: Type.Object(
			{
				program: Type.String({
					minLength: 1,
					description: "Path of the candidate .js program, relative to the repository.",
				}),
				tasks: Type.Array(
					Type.Object(
						{
							task: Type.String({
								minLength: 1,
								description: "What the peer is asked to do, as a real recorded task.",
							}),
							check: Type.String({
								minLength: 1,
								description: "Shell command run in the worktree afterwards; exit 0 means the work is correct.",
							}),
						},
						{ additionalProperties: false },
					),
					{ minItems: 1 },
				),
				samples: Type.Integer({ minimum: MIN_SAMPLES, description: "Runs per task and arm; three or more." }),
				role: Type.Optional(
					Type.String({ minLength: 1, description: "Catalog role of the peers; implementation-engineer by default." }),
				),
				base: Type.Optional(
					Type.String({ minLength: 1, description: "Revision both arms start from; HEAD by default." }),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_id, params, signal, update, ctx) {
			if (!mayCompare(ctx))
				throw new Error("Comparing programs needs a managing role, an unroled root or the capability steward");
			if (!ctx.hasUI) throw new Error("Comparing programs needs the operator's agreement in an interactive session");
			const root = await git(ctx.cwd, ["rev-parse", "--show-toplevel"]);
			const file = resolve(root, params.program);
			const name = basename(file, ".js");
			const source = readFileSync(file, "utf8");
			parseProgram(name, source);
			const plan: ComparisonPlan = {
				root,
				name,
				source,
				base: await git(root, ["rev-parse", params.base ?? "HEAD"]),
				role: params.role ?? "implementation-engineer",
				tasks: params.tasks,
				samples: params.samples,
			};
			const runs = plan.tasks.length * plan.samples * 2;
			const each = recentTurnCost();
			const estimate =
				each === undefined
					? "no recorded peer turns to estimate from"
					: `about $${(each * runs).toFixed(2)} (median recorded reviewer turn $${each.toFixed(2)} times ${runs})`;
			const agreed = await ctx.ui.confirm(
				`Compare program_${name}?`,
				`${runs} peer turns: ${plan.tasks.length} tasks, ${plan.samples} samples, with and without the program, from ${plan.base.slice(0, 12)}. Estimated cost: ${estimate}.`,
			);
			if (!agreed)
				return {
					content: [{ type: "text" as const, text: "The operator declined; nothing ran." }],
					details: { ran: false },
				};
			let done = 0;
			const samples = await comparePrograms(ctx.sessionManager.getSessionId(), plan, signal, () =>
				update?.({ content: [{ type: "text", text: `compare_program: ${++done}/${runs} runs` }], details: undefined }),
			);
			return {
				content: [{ type: "text" as const, text: comparisonReport(plan, samples) }],
				details: { ran: true, base: plan.base, samples },
			};
		},
	});
}
