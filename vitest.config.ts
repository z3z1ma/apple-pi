import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"components/ask-user-question/tests/**/*.test.ts",
			"components/memory/tests/**/*.test.ts",
			"components/operations/tests/**/*.test.ts",
			"components/ralph/tests/**/*.test.ts",
			"components/review/tests/**/*.test.ts",
			"components/xai-hosted-tools/tests/**/*.test.ts",
			"components/subagents/tests/**/*.test.ts",
			"tests/**/*.test.ts",
		],
	},
});
