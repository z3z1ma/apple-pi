import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// The default (one worker per core) saturates the machine the operator also works on.
		maxWorkers: "25%",
		setupFiles: ["tests/helpers/random-article.ts"],
		env: {
			// Only the session-state suites start a runtime daemon, each in its own temporary directory.
			PI_SESSION_STATE_DISABLED: "1",
		},
		include: [
			"components/pair-programmer/tests/**/*.test.ts",
			"components/vroom/tests/**/*.test.ts",
			"components/anthropic-watchdog/tests/**/*.test.ts",
			"components/home-search-guard/tests/**/*.test.ts",
			"components/ask-user-question/tests/**/*.test.ts",
			"components/shared/tests/**/*.test.ts",
			"components/notebook/tests/**/*.test.ts",
			"components/session-search/tests/**/*.test.ts",
			"components/xai-hosted-tools/tests/**/*.test.ts",
			"components/server-compaction/tests/**/*.test.ts",
			"components/interns/tests/**/*.test.ts",
			"components/btw/tests/**/*.test.ts",
			"components/notify/tests/**/*.test.ts",
			"components/tmux-sessions/tests/**/*.test.ts",
			"components/session-state/tests/**/*.test.ts",
			"components/session-title/tests/**/*.test.ts",
			"components/organization/tests/**/*.test.ts",
			"components/input-editor/tests/**/*.test.ts",
			"components/wiki/tests/**/*.test.ts",
			"components/code-context/tests/**/*.test.ts",
			"components/tasks/tests/**/*.test.ts",
			"components/prompt-stash/tests/**/*.test.ts",
			"components/terse-tools/tests/**/*.test.ts",
			"components/rtk/tests/**/*.test.ts",
			"components/change-reflection/tests/**/*.test.ts",
			"components/pi-exec/tests/**/*.test.ts",
			"components/branch-search/tests/**/*.test.ts",
			"components/browser-pages/tests/**/*.test.ts",
			"apps/agent-world/tests/**/*.test.ts",
			"tests/**/*.test.ts",
		],
	},
});
