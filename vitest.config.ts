import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"components/memory/tests/**/*.test.ts",
			"tests/**/*.test.ts",
		],
	},
});
