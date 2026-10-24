import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("tdd skill", () => {
	it("loads as a model-invoked skill", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-tdd-"));
		try {
			const loaded = loadSkills({
				cwd: process.cwd(),
				skillPaths: ["./skills"],
				includeDefaults: false,
				agentDir,
			});
			expect(loaded.diagnostics).toEqual([]);
			const tdd = loaded.skills.find((skill) => skill.name === "tdd");
			expect(tdd?.description).toBe(
				'Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.',
			);
			expect(tdd?.disableModelInvocation).toBe(false);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("ships the behavioral and mocking references", () => {
		expect(existsSync("skills/tdd/references/tests.md")).toBe(true);
		expect(existsSync("skills/tdd/references/mocking.md")).toBe(true);
	});
});
