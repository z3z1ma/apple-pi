import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import { ARMS, type ArmResult, type EvalSession, winnerDraw } from "../eval/arms.js";
import { type EvalConfig, loadEvalConfig } from "../eval/config.js";
import { runEvaluation } from "../eval/run.js";
import { drawOrder } from "../src/draw.js";
import type { SearchRecord } from "../src/record.js";
import type { ScorerSpec } from "../src/scorer.js";
import { finish, gitOut, initRepo, scriptedModel, text, validConfig, write } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}

function commit(dir: string, files: Record<string, string>, message: string): void {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

/** A repository whose closed task `value` makes `src/value` hold 2, with a test that proves it. */
function taskRepo(): string {
	const dir = tempDir("apple-pi-eval-arms-");
	initRepo(dir, { "src/value": "1\n", ".gitignore": "node_modules/\n" });
	mkdirSync(join(dir, "node_modules"));
	writeFileSync(join(dir, "node_modules", "dep"), "dep\n");
	commit(
		dir,
		{ ".ledger/value/task.md": "# Make src/value hold 2\n", "tests/value.test.sh": "grep -qx 2 src/value\n" },
		"add",
	);
	const tests = gitOut(dir, "rev-parse", "HEAD");
	commit(dir, { "src/value": "2\n" }, "fix");
	const fix = gitOut(dir, "rev-parse", "HEAD");
	// The bundle cites the task's commits: that is its evidence.
	writeFileSync(
		join(dir, ".ledger", "value", "task.md"),
		`# Make src/value hold 2\n\nDone in ${tests.slice(0, 7)} and ${fix.slice(0, 7)}.\n`,
	);
	mkdirSync(join(dir, ".ledger", "history"));
	renameSync(join(dir, ".ledger", "value"), join(dir, ".ledger", "history", "value"));
	commit(dir, {}, "close value");
	return dir;
}

const testRunner = { command: (path: string) => (path.endsWith(".test.sh") ? `bash ${path}` : undefined), files: [] };

const AUTHORED: ScorerSpec = {
	version: 1,
	goal: "src/value holds 2",
	files: [],
	protect: [],
	gates: [{ id: "value", run: "grep -qx 2 src/value", onBase: "fail", timeoutSec: 30 }],
	objectives: [],
};

/** Every reply costs 100 input, 50 cache read, and 10 output tokens. */
function priced(reply: Reply | "until-aborted"): Reply | "until-aborted" {
	if (reply === "until-aborted") return reply;
	return {
		...reply,
		usage: { ...reply.usage, input: 100, cacheRead: 50, cacheWrite: 0, output: 10, totalTokens: 160 },
	};
}

const WRONG = write("src/value", "3\n", "wrong");
const RIGHT = write("src/value", "2\n", "right");

/** A seed whose random draw of two out of four candidates includes c3 or c4 and not c1 (the preferred). */
function tailSeed(): Uint8Array {
	for (let byte = 0; byte < 256; byte++) {
		const seed = new Uint8Array(32).fill(byte);
		const drawn = drawOrder(seed, "root", 4, 2);
		if (!drawn.includes(0) && drawn.some((index) => index >= 2)) return seed;
	}
	throw new Error("no seed draws a tail candidate");
}

function evalConfig(): EvalConfig {
	return {
		model: "coding",
		tasks: ["value"],
		oracle: { timeoutSec: 30 },
		search: {
			...validConfig(),
			scorer: { validationRetries: 0, reviewProfile: "deep" },
			fidelity: { profile: "quick" },
		} as EvalConfig["search"],
	};
}

describe("evaluation arms", { timeout: 120_000 }, () => {
	it("runs all five arms in temporary clones, scores every final state with the oracle gates, and writes the report", async () => {
		const repo = taskRepo();
		const out = tempDir("apple-pi-eval-out-");
		const sessionDirs: string[] = [];
		const reviews: string[] = [];
		// The single trajectory writes the wrong value; c1 and c2 (the model's first picks) fail, c3 and c4 pass.
		const createSession = async (cwd: string): Promise<EvalSession> => {
			sessionDirs.push(cwd);
			expect(gitOut(cwd, "status", "--porcelain")).toBe("");
			// The session sees only the base: no later commit and no oracle test file.
			expect(gitOut(cwd, "rev-list", "--all", "--count")).toBe("1");
			expect(existsSync(join(cwd, "tests", "value.test.sh"))).toBe(false);
			expect(readFileSync(join(cwd, "node_modules", "dep"), "utf8")).toBe("dep\n");
			const model = scriptedModel(
				{
					c1: [WRONG, finish("done", "three")],
					c2: [WRONG, finish("done", "three")],
					c3: [RIGHT, finish("done", "two")],
					c4: [RIGHT, finish("done", "two")],
				},
				undefined,
				[fauxAssistantMessage(JSON.stringify(AUTHORED))],
				(context) => {
					if (context.messages.some((message) => text(message).includes("Branch search"))) return undefined;
					return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("Done.") : WRONG;
				},
			);
			const run = await fauxSession(
				[registerTasks],
				(context) => priced(model(context)),
				["read", "write", "edit", "ls", "bash"],
				{
					cwd,
				},
			);
			return {
				session: run.session,
				review: async (_profile, prompt) => {
					reviews.push(prompt);
					const reply = prompt.startsWith("Review an acceptance spec")
						? '{"verdict":"confirm"}'
						: '{"faithful": true, "reason": "follows the approach"}';
					return { text: reply, usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 } };
				},
				dispose: run.dispose,
			};
		};

		const { reportPath, evaluation } = await runEvaluation({
			repo,
			config: evalConfig(),
			configPath: "eval.json",
			out,
			modelLabel: "faux/faux-session-model (coding)",
			rates: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.25 },
			testRunner,
			createSession,
			seed: tailSeed(),
		});

		// Five runs, each in its own fresh clone, all removed; the repository is untouched.
		expect(new Set(sessionDirs).size).toBe(5);
		for (const dir of sessionDirs) {
			expect(dir).not.toBe(repo);
			expect(existsSync(dir)).toBe(false);
		}
		expect(gitOut(repo, "status", "--porcelain")).toBe("");
		expect(gitOut(repo, "for-each-ref", "refs/apple-pi/")).toBe("");
		expect(
			gitOut(repo, "worktree", "list", "--porcelain")
				.split("\n")
				.filter((l) => l.startsWith("worktree ")),
		).toEqual([`worktree ${repo}`]);

		const [task] = evaluation.tasks;
		const results = task?.arms as ArmResult[];
		const byArm = Object.fromEntries(results.map((result) => [result.arm, result]));
		expect(results.map((result) => result.arm)).toEqual([...ARMS]);
		expect(results.map((result) => result.solved)).toEqual([false, false, false, true, true]);
		for (const result of results) expect(Object.keys(result.gates)).toEqual(["oracle-1"]);

		// Arm A: one prompt, two model requests.
		expect(byArm.A?.tokens).toEqual({ inputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 20 });
		expect(byArm.A?.outcome).toBe("stop");

		// B draws preferred first; C draws at random. Oracle arms keep the oracle unreviewed.
		for (const arm of ["B-oracle", "B-authored", "C-oracle", "C-authored"] as const) {
			const record = byArm[arm]?.record;
			expect(byArm[arm]?.tokens).toEqual(record?.cost.total);
			expect(record?.config.draw).toBe(arm.startsWith("B") ? "model" : "random");
			expect(record?.config.scorer.reviewProfile).toBe(arm.endsWith("oracle") ? undefined : "deep");
			expect(record?.spec?.review).toEqual(
				arm.endsWith("oracle") ? null : expect.objectContaining({ verdict: "confirm" }),
			);
			expect(record?.branches.every((branch) => branch.fidelity?.faithful === true)).toBe(true);
			// Two tags of 3 input and 1 output tokens each, outside the search total.
			expect(byArm[arm]?.tagTokens).toEqual({
				inputTokens: 6,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 2,
			});
		}
		expect(byArm["B-oracle"]?.outcome).toBe("no survivor");
		expect(byArm["B-oracle"]?.winner).toBeNull();
		for (const arm of ["C-oracle", "C-authored"] as const) {
			const winner = byArm[arm]?.winner;
			expect(winner?.preferred).toBe("c1");
			expect(winner?.rank).toBeGreaterThanOrEqual(2);
			expect(winner?.bReach).toBe(2);
			expect(winner?.tail).toBe(true);
			expect(byArm[arm]?.tailWin).toBe(true);
		}
		// The fidelity tags: one per branch, two branches in each of the four searches.
		expect(reviews.filter((prompt) => prompt.startsWith("Directive:"))).toHaveLength(8);

		// The report: every column, a row per arm, cost beside every result, tail wins, and the criteria.
		const report = readFileSync(reportPath, "utf8");
		expect(dirname(reportPath)).toBe(out);
		expect(report).toContain(
			"| Arm | Solved | Outcome | Oracle gates | Total tokens | Cache read tokens | Wall-clock (run) | Est. cost (USD, main-model rates) | Winner rank vs preferred | Tail win | Fidelity |",
		);
		expect(report).toMatch(/^\| A \| no \| stop \| 0\/1 \| 320 \| 100 \| \d+\.\d s \| 0\.000290 \| — \| — \| — \|$/m);
		expect(report).toMatch(
			/^\| C-oracle \| yes \| ready \| 1\/1 \| [\d,]+ \| [\d,]+ \| \d+\.\d s \| [\d.]+ \| \d \(c\d; preferred c1\) \| yes \| 2\/2 faithful \(8 tokens, \$0\.000010\) \|$/m,
		);
		expect(report).toMatch(
			/^\| B-oracle \| no \| no survivor \| 0\/1 \| [\d,]+ \| [\d,]+ \| \d+\.\d s \| [\d.]+ \| — \| — \| 2\/2 faithful \(8 tokens, \$0\.000010\) \|$/m,
		);
		expect(report).toContain("- [x] C solves more tasks than A (oracle scorer): C 1 of 1");
		expect(report).toContain("- [x] C solves at least as many tasks as B (oracle scorer): C 1 of 1");
		expect(report).toContain("- [x] Tail wins occur (oracle scorer): 1");
		expect(report).toContain("- [x] C solves more tasks than A (authored scorer)");
		expect(report).toContain("oracle gates: `tests/value.test.sh` (`bash tests/value.test.sh`)");
		expect(report).toContain("2 cited commits");
		expect(report).toContain("Tail win (conservative)");

		// Each search's record and frozen spec are kept beside the report for later replay (no patch: apply is "report").
		const records = join(reportPath.replace(/\.md$/, ""), "value", "C-oracle");
		const [searchId] = readdirSync(records);
		expect(readdirSync(join(records, searchId as string)).sort()).toEqual(["record.json", "spec.json"]);
	});

	it("reports a task without oracle gates as skipped with the reason and runs no arm", async () => {
		const repo = taskRepo();
		const out = tempDir("apple-pi-eval-out-");
		let sessions = 0;
		const { reportPath, evaluation } = await runEvaluation({
			repo,
			config: evalConfig(),
			configPath: "eval.json",
			out: join(out, "report.md"),
			modelLabel: "faux",
			testRunner: { command: () => undefined, files: [] },
			createSession: async () => {
				sessions++;
				throw new Error("no arm may run");
			},
		});

		expect(sessions).toBe(0);
		expect(evaluation.tasks).toEqual([]);
		expect(reportPath).toBe(join(out, "report.md"));
		expect(readFileSync(reportPath, "utf8")).toContain(
			"- `value`: no test file was added or changed in the task's commits",
		);
	});
});

describe("evaluation configuration", () => {
	it("names a missing file, and every missing or invalid key", () => {
		const dir = tempDir("apple-pi-eval-config-");
		expect(loadEvalConfig(join(dir, "missing.json"))).toEqual({
			ok: false,
			text: expect.stringContaining(`Cannot read the evaluation configuration ${join(dir, "missing.json")}`),
		});
		writeFileSync(join(dir, "eval.json"), JSON.stringify({ tasks: [], search: { apply: "auto" } }));
		const loaded = loadEvalConfig(join(dir, "eval.json"));
		expect(loaded.ok).toBe(false);
		const problems = loaded.ok ? "" : loaded.text;
		expect(problems).toContain("model: missing");
		expect(problems).toContain("tasks: must list at least one closed task id");
		expect(problems).toContain("oracle.timeoutSec: missing");
		expect(problems).toContain("search.passive.enabled: missing");
		writeFileSync(
			join(dir, "bad-override.json"),
			JSON.stringify({ ...evalConfig(), overrides: { value: { base: "abc", tests: "x" } } }),
		);
		const bad = loadEvalConfig(join(dir, "bad-override.json"));
		expect(bad.ok ? "" : bad.text).toContain(
			"overrides.value: needs a base and a final commit, and tests must be a list of paths",
		);
	});

	it("accepts a complete configuration", () => {
		const dir = tempDir("apple-pi-eval-config-");
		writeFileSync(join(dir, "eval.json"), JSON.stringify(evalConfig()));
		expect(loadEvalConfig(join(dir, "eval.json"))).toEqual({
			ok: true,
			config: expect.objectContaining({ model: "coding" }),
		});
	});
});

/** Whether a process whose command line contains `pattern` is running. */
function running(pattern: string): boolean {
	try {
		execFileSync("pgrep", ["-f", pattern], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

describe("evaluation lifecycle", { timeout: 120_000 }, () => {
	it("shuts arm A's session down before scoring, so its background command is gone after the arm", async () => {
		const repo = taskRepo();
		const out = tempDir("apple-pi-eval-out-");
		const duration = `${30 + Math.floor(Math.random() * 1000) / 1000}`;
		const seen: boolean[] = [];
		let sessions = 0;
		const createSession = async (cwd: string): Promise<EvalSession> => {
			sessions++;
			// The next arm starts after arm A's teardown and scoring.
			if (sessions === 2) seen.push(running(`sleep ${duration}`));
			const background = fauxAssistantMessage(
				fauxToolCall("bash", { command: `sleep ${duration}`, run_in_background: true }, { id: "bg" }),
				{ stopReason: "toolUse" },
			);
			const replies = (context: Context): Reply => {
				if (context.messages.some((message) => text(message).includes("Branch search")))
					return fauxAssistantMessage("No.");
				return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("Started.") : background;
			};
			const run = await fauxSession([registerTasks], replies, ["read", "write", "edit", "ls", "bash"], { cwd });
			if (sessions === 1) {
				await run.session.prompt("warm up");
				expect(running(`sleep ${duration}`)).toBe(true);
			}
			return { session: run.session, dispose: run.dispose };
		};
		const config = evalConfig();
		config.search = { ...config.search, fidelity: undefined } as EvalConfig["search"];

		const { evaluation } = await runEvaluation({
			repo,
			config,
			configPath: "eval.json",
			out,
			modelLabel: "faux",
			testRunner,
			createSession,
		});

		expect(evaluation.skipped).toEqual([]);
		expect(seen).toEqual([false]);
	});

	it("aborts arm A on the signal, tears down its session and clone, and starts no other arm", async () => {
		const repo = taskRepo();
		const out = tempDir("apple-pi-eval-out-");
		const controller = new AbortController();
		const cwds: string[] = [];
		const shutdowns: string[] = [];
		const createSession = async (cwd: string): Promise<EvalSession> => {
			cwds.push(cwd);
			const run = await fauxSession(
				[registerTasks, (pi) => pi.on("session_shutdown", () => void shutdowns.push(cwd))],
				() => {
					setTimeout(() => controller.abort(), 20);
					return "until-aborted";
				},
				["read", "write", "edit", "ls", "bash"],
				{ cwd },
			);
			return { session: run.session, dispose: run.dispose };
		};

		const failure = await runEvaluation({
			repo,
			config: evalConfig(),
			configPath: "eval.json",
			out: join(out, "report.md"),
			modelLabel: "faux",
			testRunner,
			createSession,
			signal: controller.signal,
		}).catch((error: unknown) => error);

		expect((failure as Error).name).toBe("AbortError");
		expect(cwds).toHaveLength(1);
		expect(shutdowns).toEqual(cwds);
		expect(existsSync(cwds[0] as string)).toBe(false);
		expect(existsSync(join(out, "report.md"))).toBe(true);
	});
});

describe("tail wins", () => {
	/** A C record over the root enumeration [a, b, c, d] with `preferred` a, and the given shape and branches. */
	function record(
		shape: { perGeneration: number; maxTotal: number; maxDepth: number; rootsPerGeneration: number },
		branches: { key: string; parent: string | null; candidate: string }[],
		winner: string,
	): SearchRecord {
		const candidates = ["a", "b", "c", "d"].map((id) => ({ id, approach: id, firstStep: id }));
		return {
			config: {
				branches: { perGeneration: shape.perGeneration, maxTotal: shape.maxTotal },
				generations: {
					maxDepth: shape.maxDepth,
					rootsPerGeneration: shape.rootsPerGeneration,
					parentsPerGeneration: 1,
					childrenPerParent: 1,
				},
			},
			enumerations: [
				{ key: "root", candidates, preferred: "a" },
				{ key: "r1", candidates: candidates.slice(0, 2), preferred: "b" },
			],
			branches,
			winner,
		} as unknown as SearchRecord;
	}

	it("is no tail win when B's configuration could have drawn the winner's root (the reviewer's case)", () => {
		const shape = { perGeneration: 2, maxTotal: 4, maxDepth: 1, rootsPerGeneration: 2 };
		const draw = winnerDraw(
			record(
				shape,
				[
					{ key: "r0", parent: null, candidate: "d" },
					{ key: "r1", parent: null, candidate: "b" },
					{ key: "r2", parent: null, candidate: "c" },
				],
				"r2",
			),
		);
		expect(draw).toEqual(expect.objectContaining({ root: "r2", rootCandidate: "c", rank: 2, bReach: 4, tail: false }));
	});

	it("judges a child winner by its root ancestor, beyond every root B could draw", () => {
		const shape = { perGeneration: 2, maxTotal: 6, maxDepth: 1, rootsPerGeneration: 0 };
		const branches = [
			{ key: "r0", parent: null, candidate: "c" },
			{ key: "r1", parent: null, candidate: "d" },
			{ key: "r1.c0", parent: "r1", candidate: "a" },
		];
		const draw = winnerDraw(record(shape, branches, "r1.c0"));
		expect(draw).toEqual(
			expect.objectContaining({ candidate: "a", root: "r1", rootCandidate: "d", rank: 3, bReach: 2, tail: true }),
		);
	});

	it("bounds B's reach by maxTotal and never counts the preferred candidate", () => {
		const shape = { perGeneration: 1, maxTotal: 1, maxDepth: 3, rootsPerGeneration: 1 };
		const tail = winnerDraw(record(shape, [{ key: "r0", parent: null, candidate: "b" }], "r0"));
		expect(tail).toEqual(expect.objectContaining({ rank: 1, bReach: 1, tail: true }));
		const preferred = winnerDraw(
			record({ ...shape, perGeneration: 1, maxDepth: 0 }, [{ key: "r0", parent: null, candidate: "a" }], "r0"),
		);
		expect(preferred).toEqual(expect.objectContaining({ rank: 0, tail: false }));
	});
});
