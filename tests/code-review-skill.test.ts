import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const PROGRAMS = ["plan-review-verify.js", "multi-lens-review.js", "residual-review-loop.js"];
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
	...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

describe("code-review skill", () => {
	it("loads only the renamed public skill", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-code-review-"));
		try {
			const loaded = loadSkills({
				cwd: process.cwd(),
				skillPaths: ["./skills"],
				includeDefaults: false,
				agentDir,
			});
			expect(loaded.diagnostics).toEqual([]);
			expect(loaded.skills.map((skill) => skill.name)).toContain("code-review");
			expect(loaded.skills.map((skill) => skill.name)).not.toContain("review");
			expect(existsSync("skills/review")).toBe(false);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("ships Pi Exec bodies with axis and coverage invariants", () => {
		for (const program of PROGRAMS) {
			const source = readFileSync(join("skills", "code-review", "references", program), "utf8");
			expect(() => new AsyncFunction(source)).not.toThrow();
			expect(source).toMatch(/\breturn\s+\{/);
			expect(source).not.toMatch(/^\s*\(async\s*\(/);
			expect(source).not.toContain(".slice(0, 3)");
			expect(source).not.toMatch(/fields:\s*\{\s*title:/);
			expect(source).not.toContain('inputs.compare || "HEAD"');
			expect(source).toContain('["standards", "intent"]');
			expect(source).toContain('contract: "string"');
			expect(source).toContain("candidateReceipts");
			expect(source).toContain("standardsPaths");
			expect(source).toContain("intentPaths");
			expect(source).toContain('priority: "priority"');
			expect(source).toContain("unknownIds");
			expect(source).toContain("missingIds");
			expect(source).toContain("duplicateIds");
			expect(source).toContain("coverage failure");
			expect(source).toContain("coverageComplete");
			expect(source).toContain("statusText");
			expect(source).toContain("changedFiles");
			expect(source).toContain("smellBaselinePath");
		}
		expect(readFileSync("skills/code-review/references/plan-review-verify.js", "utf8")).toContain(
			"axisAssignmentCoverage",
		);
		expect(readFileSync("skills/code-review/references/multi-lens-review.js", "utf8")).toContain(
			"lens axis coverage mismatch",
		);
	});

	it("preserves the pragmatic review guardrails", () => {
		const source = readFileSync("skills/code-review/SKILL.md", "utf8");
		for (const phrase of [
			"work in progress",
			"review since X",
			"confirmation bias",
			"finding as a hypothesis",
			"attacker and defender",
			"must not invoke `code-review`",
			"stable shared-cause reference",
			"unranked shared-cause index",
			"without deduplicating, merging, or reranking",
		]) {
			expect(source.toLowerCase()).toContain(phrase.toLowerCase());
		}
		for (const forbidden of [
			"shared causes / remediation order",
			"rank shared remediation groups",
			"shared remediation group",
		]) {
			expect(source.toLowerCase()).not.toContain(forbidden);
		}
	});

	it("keeps one consolidated graph set", () => {
		expect(existsSync("skills/code-review/references/targeted-review.js")).toBe(false);
		expect(existsSync("skills/code-review/references/security-baseline-review.js")).toBe(false);
		expect(existsSync("skills/ralph/references/ralph-ledger-review.js")).toBe(false);
	});
});
