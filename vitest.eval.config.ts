import { defineConfig } from "vitest/config";

/** The branch search evaluation on real models (`npm run eval:branch-search`); never part of `npm test`. */
export default defineConfig({
	test: {
		environment: "node",
		include: ["components/branch-search/eval/**/*.eval.ts"],
		fileParallelism: false,
		// An evaluation runs for hours; the operator stops it.
		testTimeout: 7 * 24 * 60 * 60 * 1000,
	},
});
