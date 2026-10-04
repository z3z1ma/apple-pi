import { resolve } from "node:path";
import { it } from "vitest";
import { realSessions } from "./session.js";
import { evalStopSignal } from "./stop.js";
import { type BenchmarkSessions, runTrapCommand } from "./traps.js";

/**
 * The trap benchmark on real models: run only through `npm run eval:traps`, which the default test run
 * never includes.
 *
 *   BRANCH_SEARCH_TRAPS_CONFIG=<traps.json> BRANCH_SEARCH_TRAPS_OUT=<.ledger/<task-id> or report.md> \
 *     npm run eval:traps
 *
 * `eval/traps.example.json` is a complete configuration to copy. Every run happens in a fresh temporary
 * repository staged from the trap's `repo/`.
 */
it("benchmarks branch search on the staged traps", async () => {
	const configPath = process.env.BRANCH_SEARCH_TRAPS_CONFIG;
	const out = process.env.BRANCH_SEARCH_TRAPS_OUT;
	if (!configPath || !out) {
		const usage =
			"Set BRANCH_SEARCH_TRAPS_CONFIG to the trap benchmark configuration and BRANCH_SEARCH_TRAPS_OUT to the report file or directory (such as the active ledger task bundle).";
		console.error(usage);
		throw new Error(usage);
	}
	// Tests only: a module whose `openSessions` replaces the real sessions (the launcher's cancellation test).
	const fake = process.env.APPLE_PI_EVAL_SESSIONS_MODULE;
	const openSessions: (model: string) => Promise<BenchmarkSessions> = fake
		? (await import(/* @vite-ignore */ fake)).openSessions
		: (model) => realSessions(model);
	// SIGINT or SIGTERM to the launcher aborts the running arms; the benchmark then shuts their sessions
	// down, removes their directories, and writes the report of what finished before the run exits.
	const stop = evalStopSignal();
	try {
		const result = await runTrapCommand({
			configPath: resolve(configPath),
			out: resolve(out),
			openSessions,
			signal: stop.signal,
			onProgress: (line) => console.log(line),
		});
		if (!result.ok) {
			console.error(result.text);
			throw new Error(result.text);
		}
		console.log(`Trap benchmark report: ${result.reportPath}`);
	} finally {
		stop.dispose();
	}
});
