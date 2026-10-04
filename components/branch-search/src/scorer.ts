import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { canonical, within } from "../../shared/src/real-path.js";
import { git, PLAIN_DIFF } from "./workspace.js";

/** The pre-registered acceptance spec (spec 7.1). */
export interface ScorerSpec {
	version: 1;
	goal: string;
	files: { path: string; content: string }[];
	protect: string[];
	gates: { id: string; run: string; onBase: "fail" | "pass"; timeoutSec: number }[];
	objectives: {
		id: string;
		run: string;
		better: "lower" | "higher";
		timeoutSec: number;
		serial?: boolean;
		repeat?: number;
	}[];
}

const ID = /^[a-z0-9_-]+$/;

function insideWorktree(path: string): boolean {
	if (typeof path !== "string" || path === "" || isAbsolute(path)) return false;
	const clean = normalize(path);
	return clean !== ".." && !clean.startsWith(`..${sep}`) && !path.split(/[\\/]/).includes("..");
}

/** The structural rules of spec 7.1; an empty list means the spec is well formed. */
export function checkScorerSpec(spec: ScorerSpec): string[] {
	const problems: string[] = [];
	if (!Array.isArray(spec.gates) || spec.gates.length === 0) problems.push("the spec needs at least one gate");
	const seen = new Set<string>();
	for (const { id } of [...(spec.gates ?? []), ...(spec.objectives ?? [])]) {
		if (id === "diff_size") problems.push(`id "diff_size" is reserved`);
		else if (typeof id !== "string" || !ID.test(id)) problems.push(`id "${id}" must match ${ID}`);
		else if (seen.has(id)) problems.push(`id "${id}" is used twice`);
		seen.add(id);
	}
	for (const { path } of spec.files ?? [])
		if (!insideWorktree(path)) problems.push(`file path "${path}" must stay inside the worktree`);
	for (const path of spec.protect ?? [])
		if (!insideWorktree(path)) problems.push(`protected path "${path}" must stay inside the worktree`);
	for (const { id, repeat } of spec.objectives ?? [])
		if (repeat !== undefined && !(Number.isInteger(repeat) && repeat >= 1))
			problems.push(`objective "${id}" repeat must be a positive integer`);
	return problems;
}

/**
 * Write the scorer's files, then restore protected paths to base, so a protected path always holds base
 * content (spec 7.3). A destination that a symlink in the branch's tree leads outside the worktree is
 * refused before anything is written; the returned reason then fails every gate.
 */
export async function installScorer(worktree: string, base: string, spec: ScorerSpec): Promise<string | undefined> {
	const root = canonical(worktree);
	const outside = (path: string) => !within(canonical(join(worktree, path)), root);
	for (const path of spec.protect) if (outside(path)) return `protected path ${path} leads outside the worktree`;
	for (const file of spec.files) {
		if (outside(file.path)) return `scorer file ${file.path} leads outside the worktree`;
		const target = join(worktree, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content);
	}
	if (spec.protect.length > 0) await git(worktree, ["checkout", base, "--", ...spec.protect]);
	return undefined;
}

export interface CommandResult {
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	ms: number;
}

/** Each command keeps this much of the end of its stdout and of its stderr (spec 7.2). */
export const OUTPUT_TAIL_BYTES = 64 * 1024;

/** Collects a stream, keeping only its last OUTPUT_TAIL_BYTES bytes. */
function tail() {
	let kept = Buffer.alloc(0);
	return {
		add(chunk: Buffer) {
			kept = Buffer.concat([kept, chunk]);
			if (kept.length > OUTPUT_TAIL_BYTES) kept = kept.subarray(kept.length - OUTPUT_TAIL_BYTES);
		},
		text: () => kept.toString("utf8"),
	};
}

/**
 * Run a scorer command with `bash -lc` in the worktree root (spec 7.2). The command gets
 * its own process group, which a timeout or the search's abort signal kills whole. When the
 * command settles, anything it left running in that group is killed too.
 */
export function runCommand(
	command: string,
	cwd: string,
	timeoutSec: number,
	env: NodeJS.ProcessEnv,
	signal?: AbortSignal,
): Promise<CommandResult> {
	const started = Date.now();
	return new Promise((resolvePromise, reject) => {
		const child = spawn("bash", ["-lc", command], {
			cwd,
			env: { ...process.env, ...env },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const [stdout, stderr] = [tail(), tail()];
		let timedOut = false;
		child.stdout.on("data", stdout.add);
		child.stderr.on("data", stderr.add);
		const kill = () => {
			try {
				if (child.pid) process.kill(-child.pid, "SIGKILL");
			} catch {
				// The group already exited.
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutSec * 1000);
		signal?.addEventListener("abort", kill, { once: true });
		// An abort that fired before the listener existed would otherwise be missed.
		if (signal?.aborted) kill();
		const settle = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", kill);
			kill();
		};
		child.on("error", (error) => {
			settle();
			reject(error);
		});
		child.on("close", (exitCode) => {
			settle();
			resolvePromise({ exitCode, timedOut, stdout: stdout.text(), stderr: stderr.text(), ms: Date.now() - started });
		});
	});
}

export interface GateResult {
	id: string;
	result: "pass" | "fail" | "timeout";
	exitCode: number | null;
	stdout: string;
	stderr: string;
	ms: number;
}

function scorerEnv(searchId: string): NodeJS.ProcessEnv {
	return { CI: "1", APPLE_PI_BRANCH_SEARCH: searchId };
}

/** Run every gate in order. A gate passes only when it exits 0 within its timeout. */
export async function runGates(
	worktree: string,
	spec: ScorerSpec,
	searchId: string,
	signal?: AbortSignal,
): Promise<GateResult[]> {
	const env = scorerEnv(searchId);
	const results: GateResult[] = [];
	for (const gate of spec.gates) {
		signal?.throwIfAborted();
		const run = await runCommand(gate.run, worktree, gate.timeoutSec, env, signal);
		const result = run.timedOut ? "timeout" : run.exitCode === 0 ? "pass" : "fail";
		results.push({ id: gate.id, result, exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, ms: run.ms });
	}
	return results;
}

/** Every gate fails with the reason the scorer could not be installed. */
export function refusedGates(spec: ScorerSpec, reason: string): GateResult[] {
	return spec.gates.map(({ id }) => ({ id, result: "fail", exitCode: null, stdout: "", stderr: reason, ms: 0 }));
}

/** The number on the last non-empty stdout line, if that whole line is one finite number (spec 7.1). */
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

/** The middle value; the mean of the middle pair for an even count. */
export function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export interface ObjectiveResult {
	id: string;
	/** The median of `values`; undefined when a run failed. */
	value: number | undefined;
	values: number[];
	/** Why the measurement failed: non-zero exit, timeout, or no finite number. */
	failure?: string;
	/** Output of the last run. */
	exitCode: number | null;
	stdout: string;
	stderr: string;
	ms: number;
}

type Objective = ScorerSpec["objectives"][number];

/** Run an objective `repeat` times (default 1) and keep the median; the first failed run ends it (spec 7.1, 7.2). */
export async function measureObjective(
	worktree: string,
	objective: Objective,
	searchId: string,
	signal?: AbortSignal,
): Promise<ObjectiveResult> {
	const values: number[] = [];
	let last: CommandResult = { exitCode: null, timedOut: false, stdout: "", stderr: "", ms: 0 };
	let failure: string | undefined;
	let ms = 0;
	for (let run = 1; run <= (objective.repeat ?? 1) && failure === undefined; run++) {
		signal?.throwIfAborted();
		last = await runCommand(objective.run, worktree, objective.timeoutSec, scorerEnv(searchId), signal);
		ms += last.ms;
		const value = lastNumber(last.stdout);
		if (last.timedOut) failure = `timed out after ${objective.timeoutSec}s`;
		else if (last.exitCode !== 0) failure = `exited with code ${last.exitCode}`;
		else if (value === undefined) failure = "printed no finite number on its last non-empty stdout line";
		else values.push(value);
		if (failure !== undefined && (objective.repeat ?? 1) > 1) failure += ` (run ${run})`;
	}
	const { exitCode, stdout, stderr } = last;
	return {
		id: objective.id,
		value: failure === undefined ? median(values) : undefined,
		values,
		...(failure === undefined ? {} : { failure }),
		exitCode,
		stdout,
		stderr,
		ms,
	};
}

/** Wait for every task, then fail with the first error, so nothing still runs in a worktree that cleanup removes. */
export async function settleAll(tasks: Promise<unknown>[]): Promise<void> {
	const failed = (await Promise.allSettled(tasks)).find((result) => result.status === "rejected");
	if (failed) throw failed.reason;
}

export interface BranchScoring {
	gates: GateResult[];
	/** The built-in objective, measured for every branch, dead or alive (spec 7.4). */
	diffSize: number;
	/** In declared order; stops at the first failed objective. Empty when a gate failed. */
	objectives: ObjectiveResult[];
	survived: boolean;
}

/**
 * Score one generation (spec 6.7 steps 1 to 4). Each branch installs the scorer, runs its gates, then
 * its non-serial objectives, then `diffSize`, all branches at once. Serial objectives run after every
 * one of those has finished, one branch at a time in the given order, so concurrent load does not
 * distort them. A failed gate or objective kills the branch and skips its remaining objectives.
 */
export async function scoreBranches(
	branches: readonly { key: string; worktree: string }[],
	base: string,
	spec: ScorerSpec,
	searchId: string,
	diffSize: (key: string) => Promise<number>,
	signal?: AbortSignal,
): Promise<Map<string, BranchScoring>> {
	const scored = new Map<string, BranchScoring>();
	const measure = async (worktree: string, score: BranchScoring, objectives: Objective[]) => {
		for (const objective of objectives) {
			if (!score.survived) return;
			const result = await measureObjective(worktree, objective, searchId, signal);
			score.objectives.push(result);
			if (result.value === undefined) score.survived = false;
		}
	};
	await settleAll(
		branches.map(async ({ key, worktree }) => {
			const refused = await installScorer(worktree, base, spec);
			const gates = refused ? refusedGates(spec, refused) : await runGates(worktree, spec, searchId, signal);
			const score: BranchScoring = {
				gates,
				diffSize: 0,
				objectives: [],
				survived: gates.every((gate) => gate.result === "pass"),
			};
			scored.set(key, score);
			await measure(
				worktree,
				score,
				spec.objectives.filter((objective) => !objective.serial),
			);
			score.diffSize = await diffSize(key);
		}),
	);
	for (const { key, worktree } of branches) {
		signal?.throwIfAborted();
		const score = scored.get(key) as BranchScoring;
		await measure(
			worktree,
			score,
			spec.objectives.filter((objective) => objective.serial),
		);
		const order = spec.objectives.map((objective) => objective.id);
		score.objectives.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
	}
	return scored;
}

/** The end of a command's output, enough to tell the author why a check misbehaved. */
function excerpt({ stdout, stderr }: { stdout: string; stderr: string }): string {
	const text = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
	return text === "" ? "" : `\n    output: ${text.slice(-1000).replace(/\n/g, "\n    ")}`;
}

export interface Validation {
	ok: boolean;
	/** One line per gate and objective, plus every problem; what the author reads to correct the spec. */
	report: string;
	/** Median base value of each objective that measured. */
	baseValues: Record<string, number>;
}

/**
 * Validate a spec on the base in a fresh worktree created from it (spec 6.3): install files and restore
 * protected paths, run every gate twice (both runs must agree with each other and with `onBase`), measure
 * every objective, and require an objective when no gate fails on the base. The caller owns the worktree;
 * a retry needs a fresh one, because this installs the scorer and the commands may leave files behind.
 */
export async function validateScorer(
	worktree: string,
	base: string,
	spec: ScorerSpec,
	searchId: string,
	signal?: AbortSignal,
): Promise<Validation> {
	const lines: string[] = [];
	let ok = true;
	const problem = (line: string) => {
		ok = false;
		lines.push(line);
	};
	const baseValues: Record<string, number> = {};
	const finish = () => ({
		ok,
		report: [ok ? "The scorer spec is valid on the base." : "The scorer spec is invalid on the base.", ...lines].join(
			"\n",
		),
		baseValues,
	});

	if (spec.objectives.length === 0 && !spec.gates.some((gate) => gate.onBase === "fail"))
		problem(`no gate has onBase "fail", so the spec needs at least one objective`);
	let refused: string | undefined;
	try {
		refused = await installScorer(worktree, base, spec);
	} catch (error) {
		refused = error instanceof Error ? error.message : String(error);
	}
	if (refused !== undefined) {
		problem(`could not install the scorer: ${refused}`);
		return finish();
	}

	const first = await runGates(worktree, spec, searchId, signal);
	const second = await runGates(worktree, spec, searchId, signal);
	spec.gates.forEach((gate, i) => {
		const runs = [first[i], second[i]] as GateResult[];
		const [a, b] = runs.map((run) => (run.result === "pass" ? "pass" : "fail"));
		const shown = runs.map((run) => run.result).join(", then ");
		if (a !== b) problem(`gate ${gate.id}: the two base runs disagree (${shown})${excerpt(runs[1] as GateResult)}`);
		else if (a !== gate.onBase)
			problem(
				`gate ${gate.id}: declared onBase "${gate.onBase}" but ${a === "pass" ? "passed" : "failed"} on the base (${shown})${excerpt(runs[1] as GateResult)}`,
			);
		else lines.push(`gate ${gate.id}: ${a === "pass" ? "passes" : "fails"} on the base twice, as declared`);
	});

	for (const objective of spec.objectives) {
		const result = await measureObjective(worktree, objective, searchId, signal);
		if (result.value === undefined) problem(`objective ${objective.id}: ${result.failure}${excerpt(result)}`);
		else {
			baseValues[objective.id] = result.value;
			lines.push(`objective ${objective.id}: base value ${result.value} (runs ${result.values.join(", ")})`);
		}
	}
	return finish();
}

export interface DiffStat {
	added: number;
	deleted: number;
	files: number;
}

/** `git diff --numstat` totals; binary rows count as 0 lines. `diff_size` is added + deleted (spec 7.4). */
export async function diffStat(root: string, from: string, to: string): Promise<DiffStat> {
	const rows = (await git(root, ["diff", ...PLAIN_DIFF, "--numstat", from, to])).split("\n").filter(Boolean);
	const count = (value: string | undefined) => (value === undefined || value === "-" ? 0 : Number(value));
	let added = 0;
	let deleted = 0;
	for (const row of rows) {
		const [plus, minus] = row.split("\t");
		added += count(plus);
		deleted += count(minus);
	}
	return { added, deleted, files: rows.length };
}
