import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { modelSizingBand, PROFILE_SIZING_BANDS } from "../../../tests/helpers/model-sizing.js";
import { INFERENCE_PROFILE_NAMES, loadModelProfiles } from "../src/model-profiles.js";

let agentDir: string;
let previousAgentDir: string | undefined;
beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "apple-pi-profile-examples-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

it.each(["openai", "anthropic"])(
	"the %s starting policy loads every workload through the production parser",
	(provider) => {
		const example = fileURLToPath(new URL(`../../../model-profiles.${provider}.json`, import.meta.url));
		copyFileSync(example, join(agentDir, "model-profiles.json"));
		const profiles = loadModelProfiles();
		expect(Object.keys(profiles).sort()).toEqual([...INFERENCE_PROFILE_NAMES].sort());
		for (const [name, profile] of Object.entries(profiles)) {
			for (const candidate of profile.models) {
				const slash = candidate.model.indexOf("/");
				expect(candidate.model.slice(0, slash)).toBe(provider);
				expect(modelSizingBand(candidate.model, candidate.thinking), `${name}: ${candidate.model}`).toBe(
					PROFILE_SIZING_BANDS[name],
				);
			}
		}
	},
);
