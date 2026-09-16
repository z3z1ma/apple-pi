import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SOURCE_ROOTS = ["components", "extensions", "optional-extensions"];

/**
 * Provider prompt caches match on an exact prefix. A `context` hook that
 * rebuilds, moves, or removes a message on every request invalidates the
 * cache for the whole history and re-sends it at cache-write prices. Only the
 * overflow guard may filter, and it only drops an empty marker.
 */
const ALLOWED_CONTEXT_HOOKS = ["components/notebook/src/hooks/overflow-guard.ts"];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "node_modules" || entry.name === "tests" ? [] : sourceFiles(path);
		}
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
	});
}

describe("context hooks", () => {
	it("registers no per-request context rewrite outside the allowlist", () => {
		const registrations = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))
			.filter((file) => /\.on\(\s*["']context["']/.test(readFileSync(file, "utf8")))
			.map((file) => relative(ROOT, file))
			.sort();
		expect(registrations).toEqual(ALLOWED_CONTEXT_HOOKS);
	});
});
