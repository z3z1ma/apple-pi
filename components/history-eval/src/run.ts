import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { canonical, within } from "../../shared/src/real-path.js";
import { runCommand } from "../../shared/src/run-command.js";
import { disposeAgentSession } from "../../subagents/src/session-lifecycle.js";
import { cloneAt } from "./clone.js";
import type { EvalConfig } from "./config.js";
import { type Evaluation, formatEvaluation, type Rates, type TaskResult, type TokenCost } from "./report.js";
import { type EvalTask, extractTask, repositoryTestRunner, type TestRunner } from "./tasks.js";

/** A root session in a clone, on the evaluated model. */
export interface EvalSession {
	session: AgentSession;
	/** Frees what the factory made besides the session; the run has already shut the session down and disposed it. */
	dispose: () => void | Promise<void>;
}

export type SessionFactory = (cwd: string) => Promise<EvalSession>;

export interface EvaluationOptions {
	/** The repository whose ledger history holds the tasks; it is only read and cloned. */
	repo: string;
	config: EvalConfig;
	configPath: string;
	/** A `.md` file, or a directory (such as a ledger task bundle) that receives a timestamped report. */
	out: string;
	modelLabel: string;
	rates?: Rates;
	createSession: SessionFactory;
	testRunner?: TestRunner;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
}

/** `out` itself when it is a `.md` file, otherwise a timestamped `history-evaluation-<stamp>.md` in the directory `out`. */
export function reportPathFor(out: string, startedAt: Date): string {
	if (out.endsWith(".md")) return out;
	const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	return join(out, `history-evaluation-${stamp}.md`);
}

/**
 * Extract each configured task, run the single agent on it in a base-only clone, score the final state
 * with the task's oracle tests, and write the report. The report is rewritten after each task, so an
 * interrupted evaluation keeps what finished.
 */
export async function runEvaluation(
	options: EvaluationOptions,
): Promise<{ reportPath: string; evaluation: Evaluation }> {
	const started = new Date();
	const reportPath = reportPathFor(options.out, started);
	mkdirSync(dirname(reportPath), { recursive: true });
	const evaluation: Evaluation = {
		startedAt: started.toISOString(),
		endedAt: started.toISOString(),
		model: options.modelLabel,
		configPath: options.configPath,
		rates: options.rates,
		tasks: [],
		skipped: [],
	};
	const write = () => {
		evaluation.endedAt = new Date().toISOString();
		writeFileSync(reportPath, formatEvaluation(evaluation));
	};
	const { config } = options;
	try {
		for (const id of config.tasks) {
			options.signal?.throwIfAborted();
			options.onProgress?.(`${id}: extracting oracle tests`);
			const extraction = await extractTask(options.repo, id, {
				testRunner: options.testRunner ?? repositoryTestRunner,
				cloneIgnored: config.cloneIgnored,
				timeoutSec: config.oracle.timeoutSec,
				override: config.overrides?.[id],
				signal: options.signal,
			});
			if (!extraction.ok) {
				options.onProgress?.(`${id}: skipped, ${extraction.reason}`);
				evaluation.skipped.push({ id, reason: extraction.reason, excluded: extraction.excluded });
				write();
				continue;
			}
			options.onProgress?.(`${id}: running`);
			const result = await runTask(extraction.task, options);
			evaluation.tasks.push({ ...result, excluded: extraction.excluded });
			write();
		}
	} finally {
		write();
	}
	return { reportPath, evaluation };
}

/** One run in a fresh base-only clone, scored with the oracle tests once its session has shut down. */
async function runTask(task: EvalTask, options: EvaluationOptions): Promise<Omit<TaskResult, "excluded">> {
	const { config } = options;
	const clone = await cloneAt(options.repo, task.base, config.cloneIgnored);
	const result: Omit<TaskResult, "excluded"> = {
		task,
		solved: false,
		gates: {},
		tokens: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
		ms: 0,
		outcome: "",
	};
	try {
		const ran = await inSession(clone.dir, options.createSession, options.signal, (session) =>
			runSingle(session, task.goal, config.limits, result),
		);
		result.ms = ran.ms;
		if (ran.error !== undefined) result.error = ran.error;
		const refused = refusedDestination(clone.dir, task);
		if (refused) {
			// The run left a link that would send the oracle files elsewhere: nothing is written, and it fails.
			result.error ??= refused;
			result.gates = Object.fromEntries(task.oracles.map(({ path }) => [path, "fail" as const]));
		} else result.gates = await scoreOracle(clone.dir, task, config.oracle.timeoutSec, options.signal);
		result.solved = result.error === undefined && Object.values(result.gates).every((gate) => gate === "pass");
	} finally {
		clone.dispose();
	}
	return result;
}

/**
 * One run in a new session in `cwd`: `body` gets the session, and cancellation aborts it. A failure of
 * `body` becomes the run's error. The session is then shut down and disposed, so extensions stop what
 * they started (background commands) before the final state is scored and the directory is removed;
 * after a cancellation the run throws instead of returning, so nothing scores a cut-off state.
 */
export async function inSession(
	cwd: string,
	createSession: SessionFactory,
	signal: AbortSignal | undefined,
	body: (session: AgentSession) => Promise<void>,
): Promise<{ ms: number; error?: string }> {
	const evalSession = await createSession(cwd);
	const { session } = evalSession;
	const abort = () => void session.abort();
	signal?.addEventListener("abort", abort, { once: true });
	const started = Date.now();
	let error: string | undefined;
	let ms = 0;
	try {
		signal?.throwIfAborted();
		await body(session);
	} catch (thrown) {
		error = thrown instanceof Error ? thrown.message : String(thrown);
	} finally {
		ms = Date.now() - started;
		signal?.removeEventListener("abort", abort);
		await disposeAgentSession(session);
		await evalSession.dispose();
	}
	signal?.throwIfAborted();
	return error === undefined ? { ms } : { ms, error };
}

/** The goal as one prompt to the agent, under the configured limits; records its tokens and how it ended. */
export async function runSingle(
	session: AgentSession,
	goal: string,
	limits: EvalConfig["limits"],
	result: { tokens: TokenCost; outcome: string },
): Promise<void> {
	const { wallClockSec, outputTokens } = limits;
	let limited = false;
	const stop = () => {
		limited = true;
		void session.abort();
	};
	let output = 0;
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "message_end" || event.message.role !== "assistant") return;
		output += event.message.usage.output;
		if (outputTokens !== undefined && output > outputTokens) stop();
	});
	const timer = wallClockSec === undefined ? undefined : setTimeout(stop, wallClockSec * 1000);
	try {
		await session.prompt(goal);
	} finally {
		clearTimeout(timer);
		unsubscribe();
	}
	for (const entry of session.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const { usage } = entry.message;
		result.tokens.inputTokens += usage.input;
		result.tokens.outputTokens += usage.output;
		result.tokens.cacheReadTokens += usage.cacheRead;
		result.tokens.cacheWriteTokens += usage.cacheWrite;
	}
	const last = session.messages.findLast((message) => message.role === "assistant");
	result.outcome = limited ? "limit" : (last?.role === "assistant" && last.stopReason) || "no reply";
}

/**
 * Why an oracle file cannot be installed in `dir`: its destination, with every link the run may have
 * left resolved, lies outside the clone or cannot be resolved. Undefined when every destination is safe.
 */
function refusedDestination(dir: string, task: EvalTask): string | undefined {
	const root = canonical(dir);
	for (const { path } of task.files) {
		try {
			if (!within(canonical(join(dir, path)), root)) return `oracle file ${path} leads outside the clone`;
		} catch (error) {
			return `oracle file ${path} cannot be resolved (${error instanceof Error ? error.message : String(error)})`;
		}
	}
	return undefined;
}

/** Install the oracle's final test files over the final state, then run each oracle test; every destination is checked first. */
async function scoreOracle(
	dir: string,
	task: EvalTask,
	timeoutSec: number,
	signal?: AbortSignal,
): Promise<Record<string, "pass" | "fail" | "timeout">> {
	for (const { path, content } of task.files) {
		const target = join(dir, path);
		// Whatever the run left at the path, such as a link inside the clone, is replaced.
		rmSync(target, { recursive: true, force: true });
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	const gates: Record<string, "pass" | "fail" | "timeout"> = {};
	for (const { path, command } of task.oracles) {
		signal?.throwIfAborted();
		const run = await runCommand(command, dir, { CI: "1" }, { timeoutSec, signal });
		gates[path] = run.timedOut ? "timeout" : run.exitCode === 0 ? "pass" : "fail";
	}
	signal?.throwIfAborted();
	return gates;
}
