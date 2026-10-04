import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BranchSearchConfig, configProblems, validateBranchSearchConfig } from "../src/config.js";
import { runBranchSearch } from "../src/orchestrator.js";
import { emptyCost, type SearchRecord } from "../src/record.js";
import { type GateResult, gatesOn, parseScorerSpec, runCommand, type ScorerSpec } from "../src/scorer.js";
import { git } from "../src/workspace.js";
import { type EvalSession, inSession, runSingle, type SessionFactory } from "./arms.js";
import type { Rates } from "./report.js";
import { reportPathFor } from "./run.js";
import { formatTrapReport, TRAP_ARMS, type TrapArm, type TrapBenchmark, type TrapRun } from "./traps-report.js";

export { TRAP_ARMS, type TrapArm } from "./traps-report.js";

/**
 * The trap benchmark: staged puzzles whose obvious fix passes the visible tests and fails a hidden oracle.
 * Each trap directory holds `repo/` (the base), `goal.md`, `oracle.test.mjs` (run with `TRAP_DIR` set to
 * the repository to judge), and `wrong/` and `right/` overlays of the known-wrong and a correct solution.
 */
export const TRAPS_ROOT = fileURLToPath(new URL("./traps/", import.meta.url));

/**
 * The operator's benchmark configuration. It carries no built-in values: a missing file or key stops the
 * benchmark with the list of what to fix, before any session opens.
 *
 * ```json
 * {
 *   "model": "coding",
 *   "traps": ["tags-case-dedupe", "config-deep-merge", "slugify-diacritics"],
 *   "runsPerArm": 5,
 *   "concurrency": 3,
 *   "oracle": { "timeoutSec": 60 },
 *   "search": { ...every required key of branch-search.json, and scorer.challengers... }
 * }
 * ```
 */
export interface TrapConfig {
	/** The model profile every arm runs on (`model-profiles.json`). */
	model: string;
	/** Trap directory names under `eval/traps/`. */
	traps: string[];
	runsPerArm: number;
	/** How many runs execute at once, over all traps and arms. */
	concurrency: number;
	/** Per oracle run. */
	oracle: { timeoutSec: number };
	/** The search arms' configuration; only the search+challengers arm uses `scorer.challengers`. */
	search: BranchSearchConfig & { scorer: { challengers: number } };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const positiveInteger = (value: unknown) => Number.isInteger(value) && (value as number) >= 1;

/** Why `name` is not a usable trap under `root`, or undefined. */
function trapProblem(root: string, name: string): string | undefined {
	if (name === "" || name.includes("/") || name.includes("\\") || name.startsWith("."))
		return `${name} is not a trap name`;
	if (!existsSync(join(root, name))) return `${name} is not a trap in ${root}`;
	const missing = ["repo", "goal.md", "oracle.test.mjs", "wrong"].filter((part) => !existsSync(join(root, name, part)));
	return missing.length === 0 ? undefined : `${name} lacks ${missing.join(", ")}`;
}

export function loadTrapConfig(
	path: string,
	trapsRoot = TRAPS_ROOT,
): { ok: true; config: TrapConfig } | { ok: false; text: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return {
			ok: false,
			text: `Cannot read the trap benchmark configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const value = isRecord(raw) ? raw : {};
	const problems: string[] = [];
	if (value.model === undefined) problems.push("model: missing");
	else if (typeof value.model !== "string" || value.model === "") problems.push("model: must be a model profile name");
	if (value.traps === undefined) problems.push("traps: missing");
	else if (!Array.isArray(value.traps) || value.traps.length === 0 || !value.traps.every((t) => typeof t === "string"))
		problems.push("traps: must list at least one trap name");
	else
		for (const trap of value.traps as string[]) {
			const problem = trapProblem(trapsRoot, trap);
			if (problem) problems.push(`traps: ${problem}`);
		}
	for (const key of ["runsPerArm", "concurrency"] as const) {
		if (value[key] === undefined) problems.push(`${key}: missing`);
		else if (!positiveInteger(value[key])) problems.push(`${key}: must be an integer ≥ 1`);
	}
	const timeout = isRecord(value.oracle) ? value.oracle.timeoutSec : undefined;
	if (timeout === undefined) problems.push("oracle.timeoutSec: missing");
	else if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)
		problems.push("oracle.timeoutSec: must be a positive number");
	if (value.search === undefined) problems.push("search: missing");
	else {
		problems.push(...configProblems(value.search).map((problem) => `search.${problem}`));
		const scorer = isRecord(value.search) ? value.search.scorer : undefined;
		if (isRecord(scorer) && scorer.challengers === undefined) problems.push("search.scorer.challengers: missing");
	}
	if (problems.length > 0)
		return {
			ok: false,
			text: `The trap benchmark configuration ${path} is incomplete. Fix these keys:\n${problems.map((p) => `  ${p}`).join("\n")}`,
		};
	// The search block as the branch-search validator normalizes it (an omitted `draw` is "random").
	const search = validateBranchSearchConfig(value.search);
	if (!search.ok) return { ok: false, text: search.text };
	return { ok: true, config: { ...value, search: search.config } as unknown as TrapConfig };
}

/**
 * The alone arm's one prompt: the goal with the commitment framing of a branch directive (`rootDirective`),
 * without an approach to commit to.
 */
export function alonePrompt(goal: string): string {
	return `Goal: ${goal.trim()}

Work until the task is complete, or until you have concrete evidence that it cannot be done. Make reasonable decisions on your own; the user is away. Hidden acceptance checks will judge the final state of the repository.

End your final message with exactly these two lines:
result: done | abandoned
learned: <one sentence about what this attempt revealed>`;
}

const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

interface Staged {
	dir: string;
	base: string;
	dispose: () => void;
}

/**
 * A fresh repository in a temporary directory holding the trap's `repo/` as its one commit on `main`, with a
 * local identity and no remote, and optionally an overlay (`wrong/`) on top, uncommitted. Nothing else of
 * the trap, its oracle and reference solutions included, is in it.
 */
async function stage(trapDir: string, overlay?: string): Promise<Staged> {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-trap-")));
	const dispose = () => rmSync(dir, { recursive: true, force: true });
	try {
		cpSync(join(trapDir, "repo"), dir, { recursive: true });
		await git(dir, ["init", "--quiet", "--initial-branch=main"]);
		for (const [key, value] of [
			["user.name", "apple-pi-eval"],
			["user.email", "apple-pi-eval@localhost"],
			["commit.gpgsign", "false"],
		] as const)
			await git(dir, ["config", key, value]);
		await git(dir, ["add", "-A"]);
		await git(dir, ["commit", "--quiet", "--no-verify", "-m", "trap base"]);
		const base = await git(dir, ["rev-parse", "HEAD"]);
		if (overlay) cpSync(join(trapDir, overlay), dir, { recursive: true });
		return { dir, base, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}

/** The trap's oracle on the repository in `dir`. */
async function scoreOracle(
	trapDir: string,
	dir: string,
	timeoutSec: number,
	signal?: AbortSignal,
): Promise<GateResult["result"]> {
	const command = `${quote(process.execPath)} --test ${quote(join(trapDir, "oracle.test.mjs"))}`;
	const run = await runCommand(command, dir, timeoutSec, { TRAP_DIR: dir }, signal);
	return run.timedOut ? "timeout" : run.exitCode === 0 ? "pass" : "fail";
}

/**
 * Whether `spec` kills the trap's known-wrong solution: on a fresh copy of the base with `wrong/` on top,
 * the scorer's files are installed and its protected paths restored, and any gate fails.
 */
export async function killsWrong(trapDir: string, spec: ScorerSpec, signal?: AbortSignal): Promise<boolean> {
	const staged = await stage(trapDir, "wrong");
	try {
		const gates = await gatesOn(staged.dir, staged.base, spec, "trap-benchmark", signal);
		return gates.some((gate) => gate.result !== "pass");
	} finally {
		staged.dispose();
	}
}

/**
 * Whether a search status line names a phase after the scorer froze. The search reports `enumerate` right
 * after the freeze, and every later phase (`enumerate g…`, `run g…`, `score g…`, `apply`) follows it; the
 * phases before it are `author`, `challenge`, `review`, and `validate`.
 */
export function frozenPhase(status: string | undefined): boolean {
	return status !== undefined && /^branching (enumerate|run|score|apply)\b/.test(status);
}

/**
 * A search's frozen scorer as stored beside its record, or null when it never froze one: a search that ended
 * before its freeze stores its last unfrozen candidate in spec.json.
 */
function frozenSpec(frozen: boolean, specPath: string): ScorerSpec | null {
	if (!frozen || !existsSync(specPath)) return null;
	const spec = parseScorerSpec(JSON.parse(readFileSync(specPath, "utf8")));
	return Array.isArray(spec) ? null : spec;
}

interface RunOptions {
	config: TrapConfig;
	trapsRoot: string;
	createSession: SessionFactory;
	recordsDir: string;
	seed?: Uint8Array;
	signal?: AbortSignal;
}

/** One search in the staged repository; returns its record and frozen scorer after copying both to `recordsDir`. */
async function runSearchArm(
	arm: Exclude<TrapArm, "alone">,
	staged: Staged,
	goal: string,
	evalSession: EvalSession,
	target: string,
	options: RunOptions,
	run: TrapRun,
): Promise<{ record: SearchRecord; spec: ScorerSpec | null }> {
	const { search } = options.config;
	const { challengers: _, ...withoutChallengers } = search.scorer;
	const config: BranchSearchConfig = { ...search, scorer: arm === "search" ? withoutChallengers : search.scorer };
	let frozen = false;
	const searched = await runBranchSearch({
		mode: "human",
		session: evalSession.session,
		cwd: staged.dir,
		config,
		goal,
		review: evalSession.review,
		exclusive: async () => () => {},
		signal: options.signal ?? new AbortController().signal,
		onStatus: (status) => {
			if (frozenPhase(status)) frozen = true;
		},
		seed: options.seed,
	});
	run.outcome = searched.outcome;
	if (!searched.recordPath || !existsSync(searched.recordPath)) throw new Error(searched.report);
	const record = JSON.parse(readFileSync(searched.recordPath, "utf8")) as SearchRecord;
	run.tokens = record.cost.total;
	run.searchId = record.id;
	const specPath = join(dirname(searched.recordPath), "spec.json");
	const keep = join(target, `${run.index + 1}-${record.id}`);
	mkdirSync(keep, { recursive: true });
	copyFileSync(searched.recordPath, join(keep, "record.json"));
	if (existsSync(specPath)) copyFileSync(specPath, join(keep, "spec.json"));
	return { record, spec: frozenSpec(frozen, specPath) };
}

/**
 * One run of one arm on one trap, in a fresh staged repository that is removed afterwards. The final state
 * (alone: the working tree; a search: its winner, else the base) is scored with the oracle once the session
 * has shut down; a search's frozen scorer is then tried on the known-wrong solution.
 */
async function runTrap(trap: string, arm: TrapArm, index: number, options: RunOptions): Promise<TrapRun> {
	const trapDir = join(options.trapsRoot, trap);
	const goal = readFileSync(join(trapDir, "goal.md"), "utf8").trim();
	const run: TrapRun = {
		trap,
		arm,
		index,
		solved: false,
		oracle: "fail",
		outcome: "",
		ms: 0,
		tokens: emptyCost(),
		killed: null,
		searchId: null,
	};
	const staged = await stage(trapDir);
	try {
		let searched: { record: SearchRecord; spec: ScorerSpec | null } | undefined;
		const target = join(options.recordsDir, trap, arm);
		const ran = await inSession(staged.dir, options.createSession, options.signal, async (evalSession) => {
			if (arm === "alone") await runSingle(evalSession.session, alonePrompt(goal), options.config.search, run);
			else searched = await runSearchArm(arm, staged, goal, evalSession, target, options, run);
		});
		run.ms = ran.ms;
		if (ran.error !== undefined) run.error = ran.error;
		if (searched) {
			const { record } = searched;
			const commit = record.branches.find((branch) => branch.key === record.winner)?.commit;
			if (commit)
				await git(staged.dir, [
					"-c",
					"advice.detachedHead=false",
					"checkout",
					"--quiet",
					"--force",
					"--detach",
					commit,
				]);
			else {
				await git(staged.dir, ["reset", "--quiet", "--hard", staged.base]);
				await git(staged.dir, ["clean", "--quiet", "-fd"]);
			}
		}
		// A command cut off by cancellation reads as a failure, not an error: check the signal after each.
		run.oracle = await scoreOracle(trapDir, staged.dir, options.config.oracle.timeoutSec, options.signal);
		options.signal?.throwIfAborted();
		run.solved = run.error === undefined && run.oracle === "pass";
		if (searched?.spec) run.killed = await killsWrong(trapDir, searched.spec, options.signal);
		options.signal?.throwIfAborted();
	} finally {
		staged.dispose();
	}
	return run;
}

export interface TrapBenchmarkOptions {
	config: TrapConfig;
	configPath: string;
	/** A `.md` file, or a directory (such as a ledger task bundle) that receives a timestamped report. */
	out: string;
	modelLabel: string;
	rates?: Rates;
	createSession: SessionFactory;
	/** Tests only. */
	trapsRoot?: string;
	/** Tests only. */
	seed?: Uint8Array;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
}

/**
 * Run every arm `runsPerArm` times on every configured trap, `concurrency` runs at once, and write the report.
 * The report is rewritten after each run, so a cancelled benchmark keeps every run that finished: cancellation
 * starts no further run, aborts the running ones, removes their directories, and then throws. Each search's
 * `record.json` and `spec.json` go to `<report path without .md>/<trap>/<arm>/<run>-<search id>/`.
 */
export async function runTrapBenchmark(
	options: TrapBenchmarkOptions,
): Promise<{ reportPath: string; benchmark: TrapBenchmark }> {
	const started = new Date();
	const reportPath = reportPathFor(options.out, started, "trap-benchmark");
	const { config, signal } = options;
	mkdirSync(dirname(reportPath), { recursive: true });
	const benchmark: TrapBenchmark = {
		startedAt: started.toISOString(),
		endedAt: started.toISOString(),
		model: options.modelLabel,
		configPath: options.configPath,
		rates: options.rates,
		traps: config.traps,
		runsPerArm: config.runsPerArm,
		concurrency: config.concurrency,
		runs: [],
	};
	const write = () => {
		benchmark.endedAt = new Date().toISOString();
		writeFileSync(reportPath, formatTrapReport(benchmark));
	};
	const runOptions: RunOptions = {
		config,
		trapsRoot: options.trapsRoot ?? TRAPS_ROOT,
		createSession: options.createSession,
		recordsDir: reportPath.replace(/\.md$/, ""),
		seed: options.seed,
		signal,
	};
	const jobs = config.traps.flatMap((trap) =>
		Array.from({ length: config.runsPerArm }, (_, index) => TRAP_ARMS.map((arm) => ({ trap, arm, index }))).flat(),
	);
	let next = 0;
	let failure: { error: unknown } | undefined;
	const worker = async () => {
		while (next < jobs.length && !signal?.aborted && !failure) {
			const { trap, arm, index } = jobs[next++] as (typeof jobs)[number];
			const name = `${trap} ${arm} run ${index + 1}`;
			options.onProgress?.(`${name}: started`);
			try {
				const run = await runTrap(trap, arm, index, runOptions);
				benchmark.runs.push(run);
				write();
				options.onProgress?.(`${name}: ${run.solved ? "solved" : "not solved"} (${run.error ?? run.outcome})`);
			} catch (error) {
				// A cancelled run is not reported; any other failure stops the benchmark after the running ones end.
				if (!signal?.aborted) failure ??= { error };
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.min(config.concurrency, jobs.length) }, worker));
	} finally {
		write();
	}
	signal?.throwIfAborted();
	if (failure) throw failure.error;
	return { reportPath, benchmark };
}

/** The real sessions the benchmark runs on, opened only once the configuration is complete. */
export interface BenchmarkSessions {
	createSession: SessionFactory;
	modelLabel: string;
	rates?: Rates;
	close: () => void;
}

/**
 * The benchmark command: load the configuration, and only when it is complete open sessions on its model
 * profile and run. An incomplete configuration returns what to fix and opens nothing.
 */
export async function runTrapCommand(options: {
	configPath: string;
	out: string;
	openSessions: (model: string) => Promise<BenchmarkSessions>;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
}): Promise<{ ok: false; text: string } | ({ ok: true } & Awaited<ReturnType<typeof runTrapBenchmark>>)> {
	const loaded = loadTrapConfig(options.configPath);
	if (!loaded.ok) return loaded;
	const sessions = await options.openSessions(loaded.config.model);
	try {
		const result = await runTrapBenchmark({
			config: loaded.config,
			configPath: options.configPath,
			out: options.out,
			modelLabel: sessions.modelLabel,
			rates: sessions.rates,
			createSession: sessions.createSession,
			signal: options.signal,
			onProgress: options.onProgress,
		});
		return { ok: true, ...result };
	} finally {
		sessions.close();
	}
}
