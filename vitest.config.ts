import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"components/backlog/tests/**/*.test.ts",
			"components/ask-user-question/tests/**/*.test.ts",
			"components/shared/tests/**/*.test.ts",
			"components/memory/tests/**/*.test.ts",
			"components/session-search/tests/**/*.test.ts",
			"components/xai-hosted-tools/tests/**/*.test.ts",
			"components/xai-context-compaction/tests/**/*.test.ts",
			"components/subagents/tests/**/*.test.ts",
			"components/notify/tests/**/*.test.ts",
			"components/tmux-sessions/tests/**/*.test.ts",
			"components/status-footer/tests/**/*.test.ts",
			"components/todos/tests/**/*.test.ts",
			"tests/**/*.test.ts",
		],
	},
});
