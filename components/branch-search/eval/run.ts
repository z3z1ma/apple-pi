import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runArms, type SessionFactory } from "./arms.js";
import type { EvalConfig } from "./config.js";
import { type Evaluation, formatEvaluation, type Rates } from "./report.js";
import { extractTask, repositoryTestRunner, type TestRunner } from "./tasks.js";

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
	/** Tests only. */
	seed?: Uint8Array;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
}

/** `out` itself when it is a `.md` file, otherwise a timestamped `<name>-<stamp>.md` in the directory `out`. */
export function reportPathFor(out: string, startedAt: Date, name = "branch-search-evaluation"): string {
	if (out.endsWith(".md")) return out;
	const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	return join(out, `${name}-${stamp}.md`);
}

/**
 * Extract each configured task, run the five arms on every task with oracle gates, and write the report.
 * The report is rewritten after each task, so an interrupted evaluation keeps what finished. Each
 * search's record, spec, and patch go to `<report path without .md>/<task>/<arm>/<search id>/`.
 */
export async function runEvaluation(
	options: EvaluationOptions,
): Promise<{ reportPath: string; evaluation: Evaluation }> {
	const started = new Date();
	const reportPath = reportPathFor(options.out, started);
	const recordsDir = reportPath.replace(/\.md$/, "");
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
	// An interrupted evaluation still leaves the report of every task that finished.
	try {
		for (const id of config.tasks) {
			options.signal?.throwIfAborted();
			options.onProgress?.(`${id}: extracting oracle gates`);
			const extraction = await extractTask(options.repo, id, {
				testRunner: options.testRunner ?? repositoryTestRunner,
				cloneIgnored: config.search.workspace.cloneIgnored,
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
			const arms = await runArms(extraction.task, {
				repo: options.repo,
				search: config.search,
				createSession: options.createSession,
				recordsDir: join(recordsDir, id),
				seed: options.seed,
				signal: options.signal,
				onProgress: options.onProgress,
			});
			evaluation.tasks.push({ task: extraction.task, excluded: extraction.excluded, arms });
			write();
		}
	} finally {
		write();
	}
	return { reportPath, evaluation };
}
