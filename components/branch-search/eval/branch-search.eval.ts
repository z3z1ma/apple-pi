import { resolve } from "node:path";
import { it } from "vitest";
import { repoRoot } from "../src/workspace.js";
import { loadEvalConfig } from "./config.js";
import { runEvaluation } from "./run.js";
import { realSessions } from "./session.js";

/**
 * The real evaluation (spec 18), on real models: run only through `npm run eval:branch-search`, which
 * the default test run never includes.
 *
 *   BRANCH_SEARCH_EVAL_CONFIG=<eval.json> BRANCH_SEARCH_EVAL_OUT=<.ledger/<task-id> or report.md> \
 *     npm run eval:branch-search
 *
 * The tasks come from this checkout's ledger history; every run happens in a temporary clone.
 */
it("evaluates branch search on closed ledger tasks", async () => {
	const configPath = process.env.BRANCH_SEARCH_EVAL_CONFIG;
	const out = process.env.BRANCH_SEARCH_EVAL_OUT;
	if (!configPath || !out) {
		const usage =
			"Set BRANCH_SEARCH_EVAL_CONFIG to the evaluation configuration and BRANCH_SEARCH_EVAL_OUT to the report file or directory (such as the active ledger task bundle).";
		console.error(usage);
		throw new Error(usage);
	}
	const loaded = loadEvalConfig(resolve(configPath));
	if (!loaded.ok) {
		console.error(loaded.text);
		throw new Error(loaded.text);
	}
	// SIGINT or SIGTERM aborts the running arm; the evaluation then shuts its session down, removes its
	// clone, and writes the report of what finished before the run exits.
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	const sessions = await realSessions(loaded.config.model);
	try {
		const { reportPath } = await runEvaluation({
			repo: await repoRoot(process.cwd()),
			config: loaded.config,
			configPath: resolve(configPath),
			out: resolve(out),
			modelLabel: sessions.modelLabel,
			rates: sessions.rates,
			createSession: sessions.createSession,
			onProgress: (line) => console.log(line),
			signal: controller.signal,
		});
		console.log(`Branch search evaluation report: ${reportPath}`);
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		sessions.close();
	}
});
