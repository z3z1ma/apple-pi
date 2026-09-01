import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BASELINE_PROTECTED_ROOTS, loadSearchRootGuardConfig } from "../src/config.js";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "search-root-config-"));
	tempRoots.push(root);
	const agentDir = join(root, "agent");
	const project = join(root, "project");
	mkdirSync(join(project, ".pi"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	return { agentDir, project };
}

function writeSettings(path: string, protectedRoots: unknown): void {
	writeFileSync(path, JSON.stringify({ searchRootGuard: { protectedRoots } }), "utf8");
}

describe("search root guard config", () => {
	it("uses only the invariant root and legacy home baseline when configuration is absent", () => {
		const { agentDir, project } = fixture();
		expect(loadSearchRootGuardConfig(project, false, agentDir).protectedRoots).toEqual([...BASELINE_PROTECTED_ROOTS]);
	});

	it("adds global roots and trusted project roots without allowing project removal", () => {
		const { agentDir, project } = fixture();
		writeSettings(join(agentDir, "settings.json"), ["~/code_projects", "~/code_projects/work"]);
		writeSettings(join(project, ".pi", "settings.json"), ["/Volumes/source"]);

		expect(loadSearchRootGuardConfig(project, false, agentDir).protectedRoots).toEqual([
			...BASELINE_PROTECTED_ROOTS,
			"~/code_projects",
			"~/code_projects/work",
		]);
		expect(loadSearchRootGuardConfig(project, true, agentDir).protectedRoots).toEqual([
			...BASELINE_PROTECTED_ROOTS,
			"~/code_projects",
			"~/code_projects/work",
			"/Volumes/source",
		]);
	});

	it.each([["relative/path"], ["~/code_*"], ["/tmp/$ROOT"], ["/tmp/$HOMEfoo"], [""]])(
		"rejects an unverifiable configured root: %j",
		(protectedRoots) => {
			const { agentDir, project } = fixture();
			writeSettings(join(agentDir, "settings.json"), protectedRoots);
			expect(() => loadSearchRootGuardConfig(project, false, agentDir)).toThrow(/Invalid search-root settings/);
		},
	);

	it("rejects malformed configured-root schema", () => {
		const { agentDir, project } = fixture();
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ searchRootGuard: {} }), "utf8");
		expect(() => loadSearchRootGuardConfig(project, false, agentDir)).toThrow(/protectedRoots must be an array/);
	});
});
