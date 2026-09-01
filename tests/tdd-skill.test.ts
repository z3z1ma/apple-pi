import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const skillPath = "skills/tdd/SKILL.md";

function skillSource(): string {
	return readFileSync(skillPath, "utf8");
}

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

	it("requires fresh seam confirmation before every invocation", () => {
		const source = skillSource();
		for (const phrase of [
			"on every tdd invocation",
			"before writing or editing any test",
			"what each catches, what it misses, and its feedback cost",
			"stop and wait for the operator to confirm",
			"does not replace that fresh confirmation",
			"new seam",
		]) {
			expect(source.toLowerCase()).toContain(phrase);
		}
	});

	it("preserves the red-green vertical-slice doctrine", () => {
		const source = skillSource();
		for (const phrase of [
			"red before green",
			"one slice at a time",
			"one test → one implementation → repeat",
			"tracer bullet",
			"implementation-coupled",
			"tautological",
			"horizontal slicing",
			"independent source of truth",
			"/skill:code-review",
		]) {
			expect(source.toLowerCase()).toContain(phrase.toLowerCase());
		}
	});

	it("keeps applicability, context, and authority boundaries explicit", () => {
		const source = skillSource();
		for (const phrase of [
			"pure wiring",
			"configuration",
			"type-only work",
			"generated glue",
			"straight delegation",
			"diagnosing-bugs",
			"codebase-design",
			".wiki/",
			"supporting context rather than authority",
			"creates no mandatory ledger artifact",
			"require their own authority",
		]) {
			expect(source.toLowerCase()).toContain(phrase.toLowerCase());
		}
	});

	it("ships the upstream behavioral and mocking examples", () => {
		expect(existsSync("skills/tdd/references/tests.md")).toBe(true);
		expect(existsSync("skills/tdd/references/mocking.md")).toBe(true);
		const tests = readFileSync("skills/tdd/references/tests.md", "utf8");
		const mocking = readFileSync("skills/tdd/references/mocking.md", "utf8");
		expect(tests).toContain('test("user can checkout with valid cart"');
		expect(tests).toContain('test("createUser makes user retrievable"');
		expect(tests).toContain("independent, known literal");
		expect(mocking).toContain("Mock at **system boundaries** only");
		expect(mocking).toContain("Do not mock:");
		expect(mocking).toContain("Your own classes/modules");
		expect(mocking).toContain("Prefer SDK-style interfaces over generic fetchers");
	});
});
