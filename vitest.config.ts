import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"components/pair-programmer/tests/**/*.test.ts",
			"components/reminders/tests/**/*.test.ts",
			"optional-extensions/backlog/tests/**/*.test.ts",
			"components/codex-vroom/tests/**/*.test.ts",
			"components/home-search-guard/tests/**/*.test.ts",
			"components/ask-user-question/tests/**/*.test.ts",
			"components/shared/tests/**/*.test.ts",
			"components/notebook/tests/**/*.test.ts",
			"components/session-search/tests/**/*.test.ts",
			"components/xai-hosted-tools/tests/**/*.test.ts",
			"components/xai-context-compaction/tests/**/*.test.ts",
			"components/subagents/tests/**/*.test.ts",
			"components/notify/tests/**/*.test.ts",
			"components/tmux-sessions/tests/**/*.test.ts",
			"components/status-footer/tests/**/*.test.ts",
			"optional-extensions/todos/tests/**/*.test.ts",
			"tests/**/*.test.ts",
		],
	},
});
