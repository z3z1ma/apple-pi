import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	INFERENCE_PROFILE_CATALOG,
	INFERENCE_PROFILE_NAMES,
	isInferenceProfileName,
	loadModelProfiles,
	MODEL_PROFILES_FILENAME,
	modelProfilesPath,
	resolveModelProfile,
} from "../src/model-profiles.js";

describe("user-global model profiles", () => {
	let agentDir: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "apple-pi-model-profiles-"));
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	});

	function writeProfiles(profiles: Record<string, unknown>): void {
		writeFileSync(join(agentDir, MODEL_PROFILES_FILENAME), JSON.stringify({ profiles }));
	}

	it("resolves one exact model/thinking bundle from the global file", () => {
		writeProfiles({ quick: { model: "anthropic/claude-fast", thinking: "low" } });
		const model = { provider: "anthropic", id: "claude-fast" };
		const registry = {
			find: (provider: string, id: string) => (provider === model.provider && id === model.id ? model : undefined),
		};

		expect(resolveModelProfile("quick", registry as never)).toEqual({
			name: "quick",
			model,
			thinking: "low",
		});
	});

	it("requires the global file and an exact case-sensitive profile name", () => {
		expect(() => loadModelProfiles()).toThrow(modelProfilesPath());
		writeProfiles({ quick: { model: "anthropic/claude-fast", thinking: "low" } });
		expect(() => resolveModelProfile("Quick", { find: () => undefined })).toThrow(/model profile must be one of/);
		expect(() => resolveModelProfile(" quick", { find: () => undefined })).toThrow(/unpadded/);
	});

	it("rejects malformed, unknown, or capability-bearing profiles", () => {
		writeFileSync(join(agentDir, MODEL_PROFILES_FILENAME), "{");
		expect(() => loadModelProfiles()).toThrow(/invalid JSON/);

		writeProfiles({ custom: { model: "anthropic/custom", thinking: "low" } });
		expect(() => loadModelProfiles()).toThrow(/unsupported profile "custom"/);

		writeProfiles({ quick: { model: "anthropic/claude-fast", thinking: "low", tools: ["write"] } });
		expect(() => loadModelProfiles()).toThrow(/unsupported field: tools/);

		writeProfiles({ quick: { model: "claude-fast", thinking: "low" } });
		expect(() => loadModelProfiles()).toThrow(/provider\/model/);

		writeProfiles({ quick: { model: "anthropic/claude-fast", thinking: "turbo" } });
		expect(() => loadModelProfiles()).toThrow(/thinking must be one of/);
	});

	it("fails instead of substituting an unavailable configured model", () => {
		writeProfiles({ deep: { model: "anthropic/missing", thinking: "xhigh" } });
		expect(() => resolveModelProfile("deep", { find: () => undefined })).toThrow(
			/profile "deep" selects unavailable model "anthropic\/missing"/,
		);
	});

	it("publishes the fixed inference profile catalog with profile-specific descriptions", () => {
		expect(INFERENCE_PROFILE_CATALOG.map((entry) => entry.profile)).toEqual(INFERENCE_PROFILE_NAMES);
		expect(INFERENCE_PROFILE_CATALOG.every((entry) => entry.description.length > 40)).toBe(true);
		expect(INFERENCE_PROFILE_CATALOG.find((entry) => entry.profile === "quick")?.description).toMatch(
			/fast, economical model.*reasoning effort/,
		);
		expect(INFERENCE_PROFILE_CATALOG.find((entry) => entry.profile === "deep")?.description).toMatch(
			/strongest reasoning model.*high reasoning effort/,
		);
		expect(isInferenceProfileName("coding")).toBe(true);
		expect(isInferenceProfileName("custom")).toBe(false);
	});

	it("does not read project profile files or legacy modes.json", () => {
		const project = mkdtempSync(join(tmpdir(), "apple-pi-project-profiles-"));
		try {
			mkdirSync(join(project, ".pi"), { recursive: true });
			writeFileSync(
				join(project, ".pi", MODEL_PROFILES_FILENAME),
				JSON.stringify({ profiles: { quick: { model: "xai/project", thinking: "low" } } }),
			);
			writeFileSync(
				join(agentDir, "modes.json"),
				JSON.stringify({ modes: { quick: { provider: "xai", modelId: "legacy", thinkingLevel: "low" } } }),
			);
			expect(() => loadModelProfiles()).toThrow(/cannot read model profiles/);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});
