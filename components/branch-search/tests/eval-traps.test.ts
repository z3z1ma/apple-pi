import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import type { EvalSession } from "../eval/arms.js";
import {
	alonePrompt,
	frozenPhase,
	killsWrong,
	loadTrapConfig,
	runTrapBenchmark,
	runTrapCommand,
	TRAP_ARMS,
	type TrapConfig,
} from "../eval/traps.js";
import { formatTrapReport, type TrapBenchmark, type TrapRun, winBar } from "../eval/traps-report.js";
import { drawOrder } from "../src/draw.js";
import { runBranchSearch } from "../src/orchestrator.js";
import { rootDirective } from "../src/prompts.js";
import type { SearchRecord } from "../src/record.js";
import type { ScorerSpec } from "../src/scorer.js";
import { FIX, finish, gitOut, initFixtureRepo, scriptedModel, text, validConfig, write } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}

const TRAP = "tags-case-dedupe";
const trapDir = fileURLToPath(new URL(`../eval/traps/${TRAP}/`, import.meta.url));
const trapFile = (part: string) => readFileSync(join(trapDir, part), "utf8");
const node = `'${process.execPath}'`;

/** The visible tests: the known-wrong solution passes them, so this frozen scorer does not kill it. */
const WEAK: ScorerSpec = {
	version: 1,
	goal: "case-insensitive tags",
	files: [],
	protect: [],
	gates: [{ id: "visible", run: `${node} --test`, onBase: "fail", timeoutSec: 60 }],
	objectives: [],
};

/** The visible tests plus the scale case the known-wrong (quadratic) solution misses: this scorer kills it. */
const STRONG: ScorerSpec = {
	...WEAK,
	gates: [
		...WEAK.gates,
		{
			id: "scale",
			run: `TRAP_DIR="$PWD" ${node} --test '${join(trapDir, "oracle.test.mjs")}'`,
			onBase: "fail",
			timeoutSec: 60,
		},
	],
};

const WRONG = () => write("src/tags.js", trapFile("wrong/src/tags.js"), "wrong");
const RIGHT = () => write("src/tags.js", trapFile("right/src/tags.js"), "right");

/** Every reply costs 100 input and 10 output tokens. */
function priced(reply: Reply | "until-aborted"): Reply | "until-aborted" {
	if (reply === "until-aborted") return reply;
	return { ...reply, usage: { ...reply.usage, input: 100, cacheRead: 0, cacheWrite: 0, output: 10, totalTokens: 110 } };
}

function trapConfig(runsPerArm: number, concurrency: number): TrapConfig {
	return {
		model: "coding",
		traps: [TRAP],
		runsPerArm,
		concurrency,
		oracle: { timeoutSec: 60 },
		search: {
			...validConfig(),
			enumerate: { count: 2 },
			branches: { perGeneration: 2, maxTotal: 2 },
			scorer: { validationRetries: 1, challengers: 1 },
		} as TrapConfig["search"],
	};
}

/** What a run's session saw when it started. */
interface Seen {
	cwd: string;
	commits: string;
	status: string;
	files: string[];
	source: string;
}

function look(cwd: string): Seen {
	return {
		cwd,
		commits: gitOut(cwd, "rev-list", "--all", "--count"),
		status: gitOut(cwd, "status", "--porcelain"),
		files: readdirSync(cwd).sort(),
		source: readFileSync(join(cwd, "src", "tags.js"), "utf8"),
	};
}

describe("trap benchmark", { timeout: 300_000 }, () => {
	it("runs every arm N times in fresh directories, scores each final state with the oracle, and measures scorer kills", async () => {
		const out = tempDir("apple-pi-traps-out-");
		const seen: Seen[] = [];
		const alonePrompts: string[] = [];
		// Alone ships the known-wrong solution; every branch ships the right one. The author first writes the
		// visible tests as its only gate; a challenger's wrong solution passes them, so with challengers the
		// author adds the scale gate.
		const createSession = async (cwd: string): Promise<EvalSession> => {
			seen.push(look(cwd));
			const model = scriptedModel(
				{ c1: [RIGHT(), finish("done", "linear")], c2: [RIGHT(), finish("done", "linear")] },
				undefined,
				[fauxAssistantMessage(JSON.stringify(WEAK)), fauxAssistantMessage(JSON.stringify(STRONG))],
				(context: Context) => {
					const last = context.messages.at(-1);
					if (context.messages.some((message) => text(message).includes("Branch search: challenger")))
						return last?.role === "toolResult" ? fauxAssistantMessage("Done.\ndefect: quadratic dedupe") : WRONG();
					if (context.messages.some((message) => text(message).includes("Branch search"))) return undefined;
					if (last?.role === "user") alonePrompts.push(text(last));
					return last?.role === "toolResult" ? fauxAssistantMessage("Done.") : WRONG();
				},
			);
			const run = await fauxSession(
				[registerTasks],
				(context) => priced(model(context)),
				["read", "write", "edit", "ls", "bash"],
				{ cwd },
			);
			return { session: run.session, dispose: run.dispose };
		};

		const { reportPath, benchmark } = await runTrapBenchmark({
			config: trapConfig(2, 3),
			configPath: "traps.json",
			out,
			modelLabel: "faux",
			rates: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.25 },
			createSession,
		});

		// Six runs, each in its own fresh repository holding only the trap's base, all removed afterwards.
		expect(seen).toHaveLength(6);
		expect(new Set(seen.map((run) => run.cwd)).size).toBe(6);
		for (const run of seen) {
			expect(run.commits).toBe("1");
			expect(run.status).toBe("");
			expect(run.files).toEqual([".git", "package.json", "src", "test"]);
			expect(run.source).toBe(trapFile("repo/src/tags.js"));
			expect(existsSync(run.cwd)).toBe(false);
		}

		// The alone prompt carries the goal and the commitment framing of a branch directive.
		const directive = rootDirective("r0", { id: "c1", approach: "a", firstStep: "b" }, "none", "g");
		for (const sentence of [
			"Make reasonable decisions on your own; the user is away.",
			"Hidden acceptance checks will judge the final state of the repository.",
		]) {
			expect(directive).toContain(sentence);
			expect(alonePrompt(trapFile("goal.md"))).toContain(sentence);
		}
		expect(alonePrompts).toEqual([alonePrompt(trapFile("goal.md")), alonePrompt(trapFile("goal.md"))]);

		// The oracle, not the visible tests, judges: alone's wrong solution passes the visible tests and fails.
		const byArm = (arm: string) => benchmark.runs.filter((run) => run.arm === arm);
		expect(byArm("alone").map((run) => [run.solved, run.oracle])).toEqual([
			[false, "fail"],
			[false, "fail"],
		]);
		for (const arm of ["search", "search+challengers"]) {
			expect(byArm(arm).map((run) => [run.solved, run.oracle, run.outcome])).toEqual([
				[true, "pass", "ready"],
				[true, "pass", "ready"],
			]);
		}
		// The visible-tests scorer lets the known-wrong solution through; the scorer the challenger forced kills it.
		expect(byArm("alone").map((run) => run.killed)).toEqual([null, null]);
		expect(byArm("search").map((run) => run.killed)).toEqual([false, false]);
		expect(byArm("search+challengers").map((run) => run.killed)).toEqual([true, true]);
		for (const run of benchmark.runs) expect(run.tokens.inputTokens).toBeGreaterThan(0);

		const report = readFileSync(reportPath, "utf8");
		expect(report).toMatch(/^\| tags-case-dedupe \| alone \| 0 of 2 \(0%\) \| [\d.]+ s \| 440 \| 0\.000480 \| — \|$/m);
		expect(report).toMatch(/^\| tags-case-dedupe \| search \| 2 of 2 \(100%\) \| .* \| 0 of 2 \(0%\) \|$/m);
		expect(report).toMatch(
			/^\| tags-case-dedupe \| search\+challengers \| 2 of 2 \(100%\) \| .* \| 2 of 2 \(100%\) \|$/m,
		);
		expect(report).toContain(
			"- [x] Met: search+challengers solved 2 of 2 (100%), alone 0 of 2 (0%): +100 percentage points",
		);

		// Each search's record and frozen spec are kept beside the report.
		for (const arm of ["search", "search+challengers"]) {
			const records = join(reportPath.replace(/\.md$/, ""), TRAP, arm);
			const searches = readdirSync(records);
			expect(searches).toHaveLength(2);
			for (const search of searches)
				expect(readdirSync(join(records, search)).sort()).toEqual(["record.json", "spec.json"]);
		}
	});

	it("cancellation stops the running arm, removes its directory, starts no other run, and reports what finished", async () => {
		const out = tempDir("apple-pi-traps-out-");
		const controller = new AbortController();
		const cwds: string[] = [];
		const shutdowns: string[] = [];
		// Alone finishes; the search's scorer author holds its request until the benchmark is cancelled.
		const createSession = async (cwd: string): Promise<EvalSession> => {
			cwds.push(cwd);
			const run = await fauxSession(
				[registerTasks, (pi) => pi.on("session_shutdown", () => void shutdowns.push(cwd))],
				(context: Context) => {
					const last = context.messages.at(-1);
					if (context.messages.some((message) => text(message).includes("Branch search"))) {
						setTimeout(() => controller.abort(), 20);
						return "until-aborted";
					}
					return last?.role === "toolResult" ? fauxAssistantMessage("Done.") : WRONG();
				},
				["read", "write", "edit", "ls", "bash"],
				{ cwd },
			);
			return { session: run.session, dispose: run.dispose };
		};

		const failure = await runTrapBenchmark({
			config: trapConfig(1, 1),
			configPath: "traps.json",
			out: join(out, "report.md"),
			modelLabel: "faux",
			createSession,
			signal: controller.signal,
		}).catch((error: unknown) => error);

		expect((failure as Error).name).toBe("AbortError");
		expect(cwds).toHaveLength(2);
		expect(shutdowns).toEqual(cwds);
		for (const cwd of cwds) expect(existsSync(cwd)).toBe(false);
		const report = readFileSync(join(out, "report.md"), "utf8");
		expect(report).toMatch(/^\| tags-case-dedupe \| alone \| 0 of 1 \(0%\) \|/m);
		expect(report).not.toMatch(/^\| tags-case-dedupe \| search/m);
		expect(report).toContain("Runs finished: 1 of 3");
	});
});

describe("trap benchmark cancellation during scoring", { timeout: 60_000 }, () => {
	it("does not report a run whose oracle was cut off by cancellation", async () => {
		const out = tempDir("apple-pi-traps-out-");
		const root = tempDir("apple-pi-traps-root-");
		const started = join(out, "oracle-started");
		// A copy of the trap whose oracle announces itself and then outlasts the cancellation.
		cpSync(trapDir, join(root, TRAP), { recursive: true });
		writeFileSync(
			join(root, TRAP, "oracle.test.mjs"),
			`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(started)}, "");\nawait new Promise((resolve) => setTimeout(resolve, 30000));\n`,
		);
		const controller = new AbortController();
		const cwds: string[] = [];
		const createSession = async (cwd: string): Promise<EvalSession> => {
			cwds.push(cwd);
			const run = await fauxSession([registerTasks], [fauxAssistantMessage("Done.")], ["read"], { cwd });
			return { session: run.session, dispose: run.dispose };
		};
		const poll = setInterval(() => {
			if (existsSync(started)) controller.abort();
		}, 20);

		const failure = await runTrapBenchmark({
			config: trapConfig(1, 1),
			configPath: "traps.json",
			out: join(out, "report.md"),
			modelLabel: "faux",
			createSession,
			trapsRoot: root,
			signal: controller.signal,
		})
			.catch((error: unknown) => error)
			.finally(() => clearInterval(poll));

		expect((failure as Error).name).toBe("AbortError");
		expect(cwds).toHaveLength(1);
		expect(existsSync(cwds[0] as string)).toBe(false);
		const report = readFileSync(join(out, "report.md"), "utf8");
		expect(report).toContain("Runs finished: 0 of 3");
		expect(report).not.toMatch(/^\| tags-case-dedupe \| alone/m);
	});
});

describe("frozen scorer", () => {
	it("counts as frozen from the first phase after the freeze, whatever ends the search later", () => {
		for (const status of [
			"branching author 0/0",
			"branching challenge 0/0",
			"branching review 0/0",
			"branching validate 0/0",
		])
			expect(frozenPhase(status), status).toBe(false);
		for (const status of [
			"branching enumerate 0/0",
			"branching enumerate g1 2/3",
			"branching run g0 3/3",
			"branching score g0 3/3",
			"branching apply 1/3",
		])
			expect(frozenPhase(status), status).toBe(true);
		expect(frozenPhase(undefined)).toBe(false);
	});
});

describe("scorer kill check", { timeout: 60_000 }, () => {
	it("kills the known-wrong solution only when a frozen gate fails on it", async () => {
		expect(await killsWrong(trapDir, STRONG)).toBe(true);
		expect(await killsWrong(trapDir, WEAK)).toBe(false);
	});
});

function run(arm: TrapRun["arm"], solved: boolean, overrides: Partial<TrapRun> = {}): TrapRun {
	return {
		trap: "t1",
		arm,
		index: 0,
		solved,
		oracle: solved ? "pass" : "fail",
		outcome: arm === "alone" ? "stop" : "ready",
		ms: 2000,
		tokens: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
		killed: arm === "alone" ? null : true,
		searchId: null,
		...overrides,
	};
}

/** `solved` solved runs of `total` for an arm, on trap t1. */
function runs(arm: TrapRun["arm"], solved: number, total: number): TrapRun[] {
	return Array.from({ length: total }, (_, index) => run(arm, index < solved, { index }));
}

function synthetic(list: TrapRun[]): TrapBenchmark {
	return {
		startedAt: "2026-10-04T00:00:00.000Z",
		endedAt: "2026-10-04T01:00:00.000Z",
		model: "faux",
		configPath: "traps.json",
		rates: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.25 },
		traps: ["t1"],
		runsPerArm: 5,
		concurrency: 3,
		runs: list,
	};
}

describe("trap benchmark report", () => {
	it("lists per trap and arm the solve rate, median wall-clock, tokens, cost, and kill rate", () => {
		const report = formatTrapReport(
			synthetic([
				...runs("alone", 1, 3).map((r, index) => ({ ...r, ms: [1000, 3000, 9000][index] as number })),
				run("search", true, { killed: false }),
				run("search", false, { index: 1, killed: null }),
				run("search+challengers", true),
			]),
		);
		expect(report).toContain(
			"| Trap | Arm | Solved | Median wall-clock | Total tokens | Est. cost (USD) | Scorer kill rate |",
		);
		expect(report).toContain("| t1 | alone | 1 of 3 (33%) | 3.0 s | 3,300 | 0.003600 | — |");
		expect(report).toContain(
			"| t1 | search | 1 of 2 (50%) | 2.0 s | 2,200 | 0.002400 | 0 of 2 (0%), 1 without a frozen scorer |",
		);
		expect(report).toContain("| t1 | search+challengers | 1 of 1 (100%) | 2.0 s | 1,100 | 0.001200 | 1 of 1 (100%) |");
		expect(report).toContain("| alone | 1 of 3 (33%) | 3,300 | 0.003600 |");
		expect(report).toContain("- search: 0 of 2 (0%), 1 without a frozen scorer");
		expect(report).toContain("- search+challengers: 1 of 1 (100%)");
	});

	it("meets the win bar at +20 percentage points and not below, with exact arithmetic", () => {
		// 3/5 - 2/5 is 0.19999999999999996 in floating point; the bar must still hold.
		const met = winBar([...runs("alone", 2, 5), ...runs("search+challengers", 3, 5)]);
		expect(met).toEqual(expect.objectContaining({ met: true }));
		expect(formatTrapReport(synthetic([...runs("alone", 2, 5), ...runs("search+challengers", 3, 5)]))).toContain(
			"- [x] Met: search+challengers solved 3 of 5 (60%), alone 2 of 5 (40%): +20 percentage points (bar: +20).",
		);
		const notMet = synthetic([...runs("alone", 2, 5), ...runs("search+challengers", 2, 5), ...runs("search", 5, 5)]);
		expect(winBar(notMet.runs)).toEqual(expect.objectContaining({ met: false }));
		expect(formatTrapReport(notMet)).toContain(
			"- [ ] Not met: search+challengers solved 2 of 5 (40%), alone 2 of 5 (40%): +0 percentage points (bar: +20).",
		);
		expect(winBar(runs("alone", 1, 5))).toEqual(expect.objectContaining({ met: null }));
		expect(formatTrapReport(synthetic(runs("alone", 1, 5)))).toContain("- [ ] Undecided:");
	});
});

describe("trap benchmark configuration", () => {
	it("names a missing file and every missing or invalid key, and opens no session", async () => {
		const dir = tempDir("apple-pi-traps-config-");
		let opened = 0;
		const openSessions = async () => {
			opened++;
			throw new Error("no session may open");
		};
		const missing = await runTrapCommand({ configPath: join(dir, "missing.json"), out: dir, openSessions });
		expect(missing).toEqual({
			ok: false,
			text: expect.stringContaining(`Cannot read the trap benchmark configuration`),
		});

		const search = { ...validConfig(), scorer: { validationRetries: 1 } };
		writeFileSync(join(dir, "traps.json"), JSON.stringify({ traps: ["no-such-trap"], runsPerArm: 0, search }));
		const incomplete = await runTrapCommand({ configPath: join(dir, "traps.json"), out: dir, openSessions });
		const problems = incomplete.ok ? "" : incomplete.text;
		expect(problems).toContain("model: missing");
		expect(problems).toContain("traps: no-such-trap is not a trap");
		expect(problems).toContain("runsPerArm: must be an integer ≥ 1");
		expect(problems).toContain("concurrency: missing");
		expect(problems).toContain("oracle.timeoutSec: missing");
		expect(problems).toContain("search.scorer.challengers: missing");
		expect(opened).toBe(0);
		expect(TRAP_ARMS).toEqual(["alone", "search", "search+challengers"]);
	});

	it("accepts a complete configuration", () => {
		const dir = tempDir("apple-pi-traps-config-");
		writeFileSync(join(dir, "traps.json"), JSON.stringify(trapConfig(5, 3)));
		expect(loadTrapConfig(join(dir, "traps.json"))).toEqual({
			ok: true,
			config: expect.objectContaining({ traps: [TRAP], runsPerArm: 5 }),
		});
	});

	it("ships an example configuration that loads, with the search configuration normalized", () => {
		const example = fileURLToPath(new URL("../eval/traps.example.json", import.meta.url));
		expect(JSON.parse(readFileSync(example, "utf8")).search.draw).toBeUndefined();
		const loaded = loadTrapConfig(example);
		expect(loaded.ok && loaded.config.search.draw).toBe("random");
	});

	it("runs a search with the example configuration in random draw order", { timeout: 60_000 }, async () => {
		const example = loadTrapConfig(fileURLToPath(new URL("../eval/traps.example.json", import.meta.url)));
		if (!example.ok) throw new Error(example.text);
		const { challengers: _, ...scorer } = example.config.search.scorer;
		const count = example.config.search.enumerate.count;
		const runs = example.config.search.branches.perGeneration;
		// A seed whose random draw differs from the model's order (c1 first, then as returned).
		const seed = Array.from({ length: 256 }, (_, byte) => new Uint8Array(32).fill(byte)).find(
			(candidate) => drawOrder(candidate, "root", count, runs).join() !== [...Array(runs).keys()].join(),
		) as Uint8Array;
		const cwd = tempDir("apple-pi-traps-draw-");
		initFixtureRepo(cwd);
		const ids = Array.from({ length: count }, (_, index) => `c${index + 1}`);
		const spec: ScorerSpec = {
			...WEAK,
			gates: [{ id: "value", run: "bash check.sh", onBase: "fail", timeoutSec: 30 }],
		};
		const model = scriptedModel(Object.fromEntries(ids.map((id) => [id, [FIX, finish("done", "two")]])), undefined, [
			fauxAssistantMessage(JSON.stringify(spec)),
		]);
		const run = await fauxSession([registerTasks], model, ["read", "write", "edit", "ls", "bash"], { cwd });
		try {
			const searched = await runBranchSearch({
				mode: "human",
				session: run.session,
				cwd,
				config: { ...example.config.search, scorer },
				goal: "make app.ts hold value 2",
				exclusive: async () => () => {},
				signal: new AbortController().signal,
				onStatus: () => {},
				seed,
			});
			const record = JSON.parse(readFileSync(searched.recordPath as string, "utf8")) as SearchRecord;
			expect(record.config.draw).toBe("random");
			const roots = record.branches.filter((branch) => branch.parent === null);
			expect(roots.map((branch) => branch.candidate)).toEqual(
				drawOrder(seed, "root", count, runs).map((index) => ids[index]),
			);
		} finally {
			await run.session.abort();
			run.dispose();
		}
	});
});
