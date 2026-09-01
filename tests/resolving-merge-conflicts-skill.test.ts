import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const skillPath = "skills/resolving-merge-conflicts/SKILL.md";

function skillSource(): string {
	return readFileSync(skillPath, "utf8");
}

function expectAll(source: string, phrases: string[]): void {
	const normalized = source.toLowerCase();
	for (const phrase of phrases) {
		expect(normalized).toContain(phrase.toLowerCase());
	}
}

describe("resolving-merge-conflicts skill", () => {
	it("loads as a model-invoked skill with the upstream trigger", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-conflicts-"));
		try {
			const loaded = loadSkills({
				cwd: process.cwd(),
				skillPaths: ["./skills"],
				includeDefaults: false,
				agentDir,
			});
			expect(loaded.diagnostics).toEqual([]);
			const skill = loaded.skills.find((candidate) => candidate.name === "resolving-merge-conflicts");
			expect(skill?.description).toBe("Use when you need to resolve an in-progress git merge/rebase conflict.");
			expect(skill?.disableModelInvocation).toBe(false);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("fails closed outside active merge and rebase conflicts", () => {
		expectAll(skillSource(), [
			"active merge or rebase with unmerged index entries",
			"cherry-pick",
			"revert",
			"stash apply/pop",
			"non-conflict interactive-rebase stop",
			"this skill does not own it",
		]);
	});

	it("resolves all conflict classes from primary-source intent", () => {
		expectAll(skillSource(), [
			"commit",
			"primary sources",
			"preserve both behaviors",
			"confirmed integration goal",
			"modify/delete",
			"rename",
			"binary",
			"submodule/gitlink",
			"rebase those intuitive roles reverse",
			"never choose a resolution from the label alone",
			"smallest integration glue",
			"new product behavior",
		]);
	});

	it("protects unrelated work and the cached index", () => {
		expectAll(skillSource(), [
			"staged, unstaged, and untracked paths",
			"preserve work outside the operation",
			"sequencer",
			"never use blanket `git add -a`",
			"neither sequencer-owned nor an inspected resolution",
			"the operator must decide whether it belongs",
			"do not silently commit, unstage, stash, reset, or discard it",
		]);
	});

	it("preserves operator authority over history and recovery", () => {
		expectAll(skillSource(), [
			"implicit model invocation",
			"is not authority to create or rewrite commits",
			"explicit operator language to finish or continue",
			"merge --continue",
			"repeated ordinary `rebase --continue` steps",
			"non-pick rebase commands",
			"abort is an operator-only cancellation action",
			"skip is also operator-only",
			"never authorizes pushing",
		]);
	});

	it("requires staged-diff inspection and evidence-backed validation", () => {
		expectAll(skillSource(), [
			"no unmerged index entry remains",
			"inspect every staged path, deletion, and cached diff",
			"git diff --cached --check",
			"cheapest meaningful checks at each rebase stop",
			"full relevant gate after the final continuation",
			"failures caused by the resolution",
			"inspect the resulting history and topology",
			"compare status with the initial baseline",
			"primary sources used",
		]);
	});
});
