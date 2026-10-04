import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import { type EvalConfig, loadEvalConfig } from "../src/config.js";
import { type EvalSession, runEvaluation } from "../src/run.js";
import { gitOut, taskRepo } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}

const testRunner = { command: (path: string) => (path.endsWith(".test.sh") ? `bash ${path}` : undefined), files: [] };

function evalConfig(): EvalConfig {
	return {
		model: "coding",
		tasks: ["value"],
		oracle: { timeoutSec: 30 },
		limits: { wallClockSec: 60 },
		cloneIgnored: ["node_modules"],
	};
}

/** Every reply costs 100 input, 50 cache read, and 10 output tokens. */
function priced(reply: Reply): Reply {
	return {
		...reply,
		usage: { ...reply.usage, input: 100, cacheRead: 50, cacheWrite: 0, output: 10, totalTokens: 160 },
	};
}

/** One agent turn that writes `value` into src/value, then ends. */
function writer(value: string, sessionDirs: string[]) {
	return async (cwd: string): Promise<EvalSession> => {
		sessionDirs.push(cwd);
		const replies = (context: Context): Reply =>
			priced(
				context.messages.at(-1)?.role === "toolResult"
					? fauxAssistantMessage("Done.")
					: fauxAssistantMessage(fauxToolCall("write", { path: "src/value", content: value }, { id: "w" }), {
							stopReason: "toolUse",
						}),
			);
		const run = await fauxSession([registerTasks], replies, ["read", "write", "edit", "ls", "bash"], { cwd });
		return { session: run.session, dispose: run.dispose };
	};
}

describe("history evaluation", { timeout: 120_000 }, () => {
	it("runs the agent in a base-only clone, scores the final state with the oracle tests, and reports the cost", async () => {
		const repo = taskRepo(tempDir);
		const out = tempDir("apple-pi-eval-out-");
		const sessionDirs: string[] = [];
		const seen: { commits?: string; oracle?: boolean; dep?: string } = {};
		const createSession = async (cwd: string) => {
			// The session sees only the base: no later commit and no oracle test file.
			seen.commits = gitOut(cwd, "rev-list", "--all", "--count");
			seen.oracle = existsSync(join(cwd, "tests", "value.test.sh"));
			seen.dep = readFileSync(join(cwd, "node_modules", "dep"), "utf8");
			return writer("2\n", sessionDirs)(cwd);
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
		});

		expect(seen).toEqual({ commits: "1", oracle: false, dep: "dep\n" });
		expect(existsSync(sessionDirs[0] as string)).toBe(false);
		expect(gitOut(repo, "status", "--porcelain")).toBe("");
		const [result] = evaluation.tasks;
		expect(result?.solved).toBe(true);
		expect(result?.gates).toEqual({ "tests/value.test.sh": "pass" });
		expect(result?.outcome).toBe("stop");
		expect(result?.tokens).toEqual({ inputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 20 });

		const report = readFileSync(reportPath, "utf8");
		expect(dirname(reportPath)).toBe(out);
		expect(report).toMatch(/^\| `value` \| yes \| stop \| 1\/1 \| 320 \| 100 \| \d+\.\d s \| 0\.000290 \|$/m);
		expect(report).toContain("oracle tests: `tests/value.test.sh` (`bash tests/value.test.sh`)");
		expect(report).toContain("2 cited commits");
		expect(report).toMatch(/Solved 1 of 1: 320 tokens/);
	});

	it("counts a wrong final state as unsolved", async () => {
		const repo = taskRepo(tempDir);
		const { evaluation } = await runEvaluation({
			repo,
			config: evalConfig(),
			configPath: "eval.json",
			out: join(tempDir("apple-pi-eval-out-"), "report.md"),
			modelLabel: "faux",
			testRunner,
			createSession: writer("3\n", []),
		});
		expect(evaluation.tasks[0]?.solved).toBe(false);
		expect(evaluation.tasks[0]?.gates).toEqual({ "tests/value.test.sh": "fail" });
	});

	it("refuses to install an oracle file through a symlink the run left, and counts the run as failed", async () => {
		const repo = taskRepo(tempDir);
		const outside = tempDir("apple-pi-eval-outside-");
		writeFileSync(join(outside, "value.test.sh"), "untouched\n");
		const createSession = async (cwd: string): Promise<EvalSession> => {
			const replies = (context: Context): Reply =>
				context.messages.at(-1)?.role === "toolResult"
					? fauxAssistantMessage("Done.")
					: fauxAssistantMessage(
							fauxToolCall("bash", { command: `ln -s ${outside} tests`, verbatim: true }, { id: "link" }),
							{ stopReason: "toolUse" },
						);
			const run = await fauxSession([registerTasks], replies, ["bash"], { cwd });
			return { session: run.session, dispose: run.dispose };
		};
		const { evaluation } = await runEvaluation({
			repo,
			config: evalConfig(),
			configPath: "eval.json",
			out: join(tempDir("apple-pi-eval-out-"), "report.md"),
			modelLabel: "faux",
			testRunner,
			createSession,
		});

		expect(readdirSync(outside)).toEqual(["value.test.sh"]);
		expect(readFileSync(join(outside, "value.test.sh"), "utf8")).toBe("untouched\n");
		const [result] = evaluation.tasks;
		expect(result?.solved).toBe(false);
		expect(result?.error).toBe("oracle file tests/value.test.sh leads outside the clone");
		expect(result?.gates).toEqual({ "tests/value.test.sh": "fail" });
	});

	it("reports a task without oracle tests as skipped with the reason and runs nothing", async () => {
		const repo = taskRepo(tempDir);
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
				throw new Error("nothing may run");
			},
		});

		expect(sessions).toBe(0);
		expect(evaluation.tasks).toEqual([]);
		expect(reportPath).toBe(join(out, "report.md"));
		expect(readFileSync(reportPath, "utf8")).toContain(
			"- `value`: no test file was added or changed in the task's commits",
		);
	});

	it("shuts the session down before scoring, so a background command it started is gone", async () => {
		const repo = taskRepo(tempDir);
		const duration = `${30 + Math.floor(Math.random() * 1000) / 1000}`;
		const steps: Reply[] = [
			fauxAssistantMessage(fauxToolCall("write", { path: "src/value", content: "2\n" }, { id: "w" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(
				fauxToolCall("bash", { command: `sleep ${duration}`, run_in_background: true }, { id: "bg" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Started."),
		];
		let started = false;
		const createSession = async (cwd: string): Promise<EvalSession> => {
			const run = await fauxSession([registerTasks], [...steps], ["write", "bash"], { cwd });
			run.session.subscribe((event) => {
				if (event.type === "tool_execution_end" && event.toolCallId === "bg") started = true;
			});
			return { session: run.session, dispose: run.dispose };
		};
		// The oracle passes only when the value is right and no process of the run is left.
		const runner = {
			command: (path: string) =>
				path.endsWith(".test.sh") ? `bash ${path} && ! pgrep -f 'sleep ${duration}'` : undefined,
			files: [],
		};
		const { evaluation } = await runEvaluation({
			repo,
			config: evalConfig(),
			configPath: "eval.json",
			out: join(tempDir("apple-pi-eval-out-"), "report.md"),
			modelLabel: "faux",
			testRunner: runner,
			createSession,
		});

		expect(started).toBe(true);
		expect(evaluation.tasks[0]?.gates).toEqual({ "tests/value.test.sh": "pass" });
	});

	it("aborts the run on the signal, tears down its session and clone, and writes the report", async () => {
		const repo = taskRepo(tempDir);
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
				["read"],
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
		expect(readFileSync(join(out, "report.md"), "utf8")).toContain("Tasks evaluated: 0");
	});
});

describe("evaluation configuration", () => {
	it("names a missing file, and every missing or invalid key", () => {
		const dir = tempDir("apple-pi-eval-config-");
		expect(loadEvalConfig(join(dir, "missing.json"))).toEqual({
			ok: false,
			text: expect.stringContaining(`Cannot read the evaluation configuration ${join(dir, "missing.json")}`),
		});
		writeFileSync(join(dir, "eval.json"), JSON.stringify({ tasks: [], limits: {} }));
		const loaded = loadEvalConfig(join(dir, "eval.json"));
		const problems = loaded.ok ? "" : loaded.text;
		expect(problems).toContain("model: missing");
		expect(problems).toContain("tasks: must list at least one closed task id");
		expect(problems).toContain("oracle.timeoutSec: missing");
		expect(problems).toContain("limits: must set wallClockSec or outputTokens to a positive number");
		expect(problems).toContain("cloneIgnored: must be a list of strings");
		writeFileSync(
			join(dir, "bad-override.json"),
			JSON.stringify({ ...evalConfig(), overrides: { value: { base: "abc", tests: "x" } } }),
		);
		const bad = loadEvalConfig(join(dir, "bad-override.json"));
		expect(bad.ok ? "" : bad.text).toContain(
			"overrides.value: needs a base and a final commit, and tests must be a list of paths",
		);
	});

	it("rejects cloneIgnored entries that would land outside the clone", () => {
		const dir = tempDir("apple-pi-eval-config-");
		for (const entry of ["../deps", "/abs/deps", "a/../../deps", "a/../deps"]) {
			writeFileSync(join(dir, "eval.json"), JSON.stringify({ ...evalConfig(), cloneIgnored: [entry] }));
			const loaded = loadEvalConfig(join(dir, "eval.json"));
			expect(loaded.ok ? "" : loaded.text, entry).toContain(
				`cloneIgnored: must hold relative paths inside the workspace ("${entry}" is not)`,
			);
		}
	});

	it("accepts a complete configuration", () => {
		const dir = tempDir("apple-pi-eval-config-");
		writeFileSync(join(dir, "eval.json"), JSON.stringify(evalConfig()));
		expect(loadEvalConfig(join(dir, "eval.json"))).toEqual({ ok: true, config: evalConfig() });
	});
});
