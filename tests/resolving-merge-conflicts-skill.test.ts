import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

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
});
