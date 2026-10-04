import { resolve } from "node:path";
import { it } from "vitest";
import { repoRoot } from "../../shared/src/git.js";
import { loadEvalConfig } from "../src/config.js";
import { runEvaluation, type SessionFactory } from "../src/run.js";
import type { Rates } from "../src/report.js";
import { realSessions } from "../src/session.js";
import { evalStopSignal } from "../src/stop.js";

type Sessions = { createSession: SessionFactory; modelLabel: string; rates?: Rates; close: () => void };

/**
 * The history evaluation on real models: run only through `npm run eval:history`, which the default
 * test run never includes.
 *
 *   HISTORY_EVAL_CONFIG=<eval.json> HISTORY_EVAL_OUT=<.ledger/<task-id> or report.md> npm run eval:history
 *
 * The tasks come from the ledger history of the configured repository (this checkout by default);
 * every run happens in a temporary clone.
 */
it("evaluates a single agent on closed ledger tasks", async () => {
	const configPath = process.env.HISTORY_EVAL_CONFIG;
	const out = process.env.HISTORY_EVAL_OUT;
	if (!configPath || !out) {
		const usage =
			"Set HISTORY_EVAL_CONFIG to the evaluation configuration and HISTORY_EVAL_OUT to the report file or directory (such as the active ledger task bundle).";
		console.error(usage);
		throw new Error(usage);
	}
	const loaded = loadEvalConfig(resolve(configPath));
	if (!loaded.ok) {
		console.error(loaded.text);
		throw new Error(loaded.text);
	}
	// Tests only: a module whose `openSessions` replaces the real sessions (the launcher's cancellation test).
	const fake = process.env.APPLE_PI_EVAL_SESSIONS_MODULE;
	const sessions: Sessions = fake
		? await (await import(/* @vite-ignore */ fake)).openSessions(loaded.config.model)
		: await realSessions(loaded.config.model);
	// SIGINT or SIGTERM to the launcher aborts the running task; the evaluation then shuts its session down,
	// removes its clone, and writes the report of what finished before the run exits.
	const stop = evalStopSignal();
	try {
		const { reportPath } = await runEvaluation({
			repo: await repoRoot(resolve(loaded.config.repo ?? process.cwd())),
			config: loaded.config,
			configPath: resolve(configPath),
			out: resolve(out),
			modelLabel: sessions.modelLabel,
			rates: sessions.rates,
			createSession: sessions.createSession,
			onProgress: (line) => console.log(line),
			signal: stop.signal,
		});
		console.log(`History evaluation report: ${reportPath}`);
	} finally {
		stop.dispose();
		sessions.close();
	}
});
