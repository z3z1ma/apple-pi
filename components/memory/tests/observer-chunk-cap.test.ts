import { describe, expect, it } from "vitest";

import {
	DEFAULTS,
	MEMORY_SOURCE_CONTEXT_RATIO,
	MEMORY_SOURCE_FALLBACK_MAX_TOKENS,
	MEMORY_SOURCE_MIN_TOKENS,
	resolveMemorySourceMaxTokens,
	type Config,
} from "../src/config.js";

function config(overrides: Partial<Config> = {}): Config {
	return { ...DEFAULTS, ...overrides };
}

describe("resolveMemorySourceMaxTokens", () => {
	it("uses the explicit config value when set", () => {
		expect(resolveMemorySourceMaxTokens(config({ memorySourceMaxTokens: 12_345 }), 1_000_000)).toBe(12_345);
		expect(resolveMemorySourceMaxTokens(config({ memorySourceMaxTokens: 12_345 }), undefined)).toBe(12_345);
	});

	it("derives the cap from the model context window when unset", () => {
		expect(resolveMemorySourceMaxTokens(config(), 1_000_000)).toBe(Math.floor(1_000_000 * MEMORY_SOURCE_CONTEXT_RATIO));
		expect(resolveMemorySourceMaxTokens(config(), 200_000)).toBe(Math.floor(200_000 * MEMORY_SOURCE_CONTEXT_RATIO));
		expect(resolveMemorySourceMaxTokens(config(), 3)).toBe(MEMORY_SOURCE_MIN_TOKENS);
	});

	it("falls back to the static default when the context window is unknown or invalid", () => {
		expect(resolveMemorySourceMaxTokens(config(), undefined)).toBe(MEMORY_SOURCE_FALLBACK_MAX_TOKENS);
		expect(resolveMemorySourceMaxTokens(config(), 0)).toBe(MEMORY_SOURCE_FALLBACK_MAX_TOKENS);
		expect(resolveMemorySourceMaxTokens(config(), -1)).toBe(MEMORY_SOURCE_FALLBACK_MAX_TOKENS);
		expect(resolveMemorySourceMaxTokens(config(), Number.NaN)).toBe(MEMORY_SOURCE_FALLBACK_MAX_TOKENS);
	});

	it("clamps explicit values to the minimum useful chunk size", () => {
		expect(resolveMemorySourceMaxTokens(config({ memorySourceMaxTokens: 1 }), 100_000)).toBe(MEMORY_SOURCE_MIN_TOKENS);
	});

	it("ignores non-positive config values", () => {
		expect(resolveMemorySourceMaxTokens(config({ memorySourceMaxTokens: 0 }), 100_000)).toBe(
			Math.floor(100_000 * MEMORY_SOURCE_CONTEXT_RATIO),
		);
	});
});
