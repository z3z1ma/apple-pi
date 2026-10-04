import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, readBranchSearchConfig, validateBranchSearchConfig } from "../src/config.js";
import { validConfig } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-branch-config-"));
	dirs.push(dir);
	return dir;
}

describe("branch search configuration", () => {
	it("accepts a complete configuration and defaults draw to random", () => {
		const result = validateBranchSearchConfig(validConfig());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.config.draw).toBe("random");
			expect(result.config.branch.limits).toEqual({ wallClockSec: 600 });
		}
	});

	it('accepts the evaluation arm draw "model"', () => {
		const result = validateBranchSearchConfig({ ...validConfig(), draw: "model" });
		expect(result.ok && result.config.draw).toBe("model");
	});

	it("names every missing required key", () => {
		const result = validateBranchSearchConfig({ passive: { enabled: true } });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		for (const key of [
			"passive.repeatThreshold",
			"enumerate.count",
			"branches.perGeneration",
			"branches.maxTotal",
			"generations.maxDepth",
			"generations.rootsPerGeneration",
			"generations.parentsPerGeneration",
			"generations.childrenPerParent",
			"branch.limits",
			"scorer.validationRetries",
			"constraints",
			"workspace.cloneIgnored",
			"apply",
		])
			expect(result.text).toContain(`${key}: missing`);
		expect(result.text).not.toContain("passive.enabled");
	});

	it("names every invalid key and why", () => {
		const config = validConfig();
		config.passive = { enabled: "yes", repeatThreshold: 1 };
		config.enumerate = { count: 2.5 };
		config.branch = { limits: {} };
		config.apply = "sometimes";
		config.constraints = ["ok", 3];
		config.workspace = { cloneIgnored: ["../outside"] };
		config.draw = "dice";
		config.scorer = { validationRetries: 0, reviewProfile: 4 };
		const result = validateBranchSearchConfig(config);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		for (const key of [
			"passive.enabled",
			"passive.repeatThreshold",
			"enumerate.count",
			"branch.limits",
			"apply",
			"constraints",
			"workspace.cloneIgnored",
			"draw",
			"scorer.reviewProfile",
		])
			expect(result.text).toMatch(new RegExp(`${key.replace(".", "\\.")}: (?!missing)`));
	});

	it("accepts the optional profile keys", () => {
		const config = validConfig();
		config.scorer = { validationRetries: 0, reviewProfile: "deep" };
		config.fidelity = { profile: "fast" };
		expect(validateBranchSearchConfig(config).ok).toBe(true);
	});

	it("rejects a non-object configuration", () => {
		const result = validateBranchSearchConfig(undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.text).toContain("apply: missing");
	});

	it("reads the user file and lets a trusted project override individual keys", () => {
		const agentDir = temp();
		const cwd = temp();
		writeFileSync(join(agentDir, CONFIG_FILE), JSON.stringify(validConfig()));
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", CONFIG_FILE), JSON.stringify({ branches: { perGeneration: 3 }, apply: "auto" }));

		const trusted = readBranchSearchConfig(cwd, true, agentDir) as Record<string, any>;
		expect(trusted.branches).toEqual({ perGeneration: 3, maxTotal: 6 });
		expect(trusted.apply).toBe("auto");
		expect(trusted.enumerate).toEqual({ count: 4 });

		const untrusted = readBranchSearchConfig(cwd, false, agentDir) as Record<string, any>;
		expect(untrusted.branches).toEqual({ perGeneration: 2, maxTotal: 6 });
	});

	it("reads nothing when no file exists and reports malformed JSON with its path", () => {
		const agentDir = temp();
		const cwd = temp();
		expect(readBranchSearchConfig(cwd, true, agentDir)).toEqual({});
		writeFileSync(join(agentDir, CONFIG_FILE), "{");
		expect(() => readBranchSearchConfig(cwd, true, agentDir)).toThrow(join(agentDir, CONFIG_FILE));
	});
});
