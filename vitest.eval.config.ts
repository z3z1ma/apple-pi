import { defineConfig } from "vitest/config";

/**
 * The history evaluation on real models, never part of `npm test`: `npm run eval:history` runs it
 * through `scripts/eval-run.mjs`, which selects the entry and owns SIGINT/SIGTERM.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["components/history-eval/eval/**/*.eval.ts"],
		fileParallelism: false,
		// An evaluation runs for hours; the operator stops it.
		testTimeout: 7 * 24 * 60 * 60 * 1000,
	},
});
