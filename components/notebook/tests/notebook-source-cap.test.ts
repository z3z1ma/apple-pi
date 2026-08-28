import { describe, expect, it } from "vitest";

import {
	DEFAULTS,
	NOTEBOOK_SOURCE_CONTEXT_RATIO,
	NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS,
	NOTEBOOK_SOURCE_MIN_TOKENS,
	resolveNotebookSourceMaxTokens,
	type Config,
} from "../src/config.js";

function config(overrides: Partial<Config> = {}): Config {
	return { ...DEFAULTS, ...overrides };
}

describe("resolveNotebookSourceMaxTokens", () => {
	it("uses the explicit config value when set", () => {
		expect(resolveNotebookSourceMaxTokens(config({ notebookSourceMaxTokens: 12_345 }), 1_000_000)).toBe(12_345);
		expect(resolveNotebookSourceMaxTokens(config({ notebookSourceMaxTokens: 12_345 }), undefined)).toBe(12_345);
	});

	it("derives the cap from the model context window when unset", () => {
		expect(resolveNotebookSourceMaxTokens(config(), 1_000_000)).toBe(
			Math.floor(1_000_000 * NOTEBOOK_SOURCE_CONTEXT_RATIO),
		);
		expect(resolveNotebookSourceMaxTokens(config(), 200_000)).toBe(Math.floor(200_000 * NOTEBOOK_SOURCE_CONTEXT_RATIO));
		expect(resolveNotebookSourceMaxTokens(config(), 3)).toBe(NOTEBOOK_SOURCE_MIN_TOKENS);
	});

	it("falls back to the static default when the context window is unknown or invalid", () => {
		expect(resolveNotebookSourceMaxTokens(config(), undefined)).toBe(NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS);
		expect(resolveNotebookSourceMaxTokens(config(), 0)).toBe(NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS);
		expect(resolveNotebookSourceMaxTokens(config(), -1)).toBe(NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS);
		expect(resolveNotebookSourceMaxTokens(config(), Number.NaN)).toBe(NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS);
	});

	it("clamps explicit values to the minimum useful chunk size", () => {
		expect(resolveNotebookSourceMaxTokens(config({ notebookSourceMaxTokens: 1 }), 100_000)).toBe(
			NOTEBOOK_SOURCE_MIN_TOKENS,
		);
	});

	it("ignores non-positive config values", () => {
		expect(resolveNotebookSourceMaxTokens(config({ notebookSourceMaxTokens: 0 }), 100_000)).toBe(
			Math.floor(100_000 * NOTEBOOK_SOURCE_CONTEXT_RATIO),
		);
	});
});
