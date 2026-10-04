import { defineConfig } from "vitest/config";

/**
 * The branch search evaluations on real models, never part of `npm test`: the ledger-history evaluation
 * (`npm run eval:branch-search`) and the trap benchmark (`npm run eval:traps`). Both run through
 * `scripts/eval-run.mjs`, which selects the entry and owns SIGINT/SIGTERM.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["components/branch-search/eval/**/*.eval.ts"],
		fileParallelism: false,
		// An evaluation runs for hours; the operator stops it.
		testTimeout: 7 * 24 * 60 * 60 * 1000,
	},
});
