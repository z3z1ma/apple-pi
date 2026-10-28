import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	INFERENCE_PROFILE_CATALOG,
	INFERENCE_PROFILE_NAMES,
	isInferenceProfileName,
	loadModelProfiles,
	MODEL_PROFILES_FILENAME,
	modelProfilesPath,
	resolveModelProfile,
	resolveModelProfileCandidates,
	selectModelProfile,
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
		vi.restoreAllMocks();
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

	it("permits only a missing optional file, not invalid JSON, directory reads, or malformed profiles", () => {
		expect(loadModelProfiles({ optional: true })).toEqual({});
		expect(() => resolveModelProfile("quick", { find: () => undefined })).toThrow(/cannot read/);
		writeFileSync(modelProfilesPath(), "{");
		expect(() => loadModelProfiles({ optional: true })).toThrow(/invalid JSON/);
		writeProfiles({ quick: { model: "p/m" } });
		expect(() => loadModelProfiles({ optional: true })).toThrow(/thinking/);
		rmSync(modelProfilesPath());
		mkdirSync(modelProfilesPath());
		expect(() => loadModelProfiles({ optional: true })).toThrow(/cannot read/);
	});

	it("normalizes single entries and pools while preserving per-entry thinking", () => {
		writeProfiles({
			coordination: { model: "p/one", thinking: "high" },
			routine: { selection: "random", models: [{ model: "p/two", thinking: "low" }] },
			writing: { selection: "ordered", models: [{ model: "p/three", thinking: "medium" }] },
		});
		expect(loadModelProfiles()).toEqual({
			coordination: { selection: "ordered", models: [{ model: "p/one", thinking: "high" }] },
			routine: { selection: "random", models: [{ model: "p/two", thinking: "low" }] },
			writing: { selection: "ordered", models: [{ model: "p/three", thinking: "medium" }] },
		});
	});

	it.each([
		{ selection: "ordered", models: [] },
		{ selection: "ordered", models: {} },
		{ selection: "unknown", models: [{ model: "p/m", thinking: "low" }] },
		{ models: [{ model: "p/m", thinking: "low" }] },
		{ selection: "ordered", models: [{ model: "p/m", thinking: "low", tools: [] }] },
		{ selection: "ordered", models: [{ model: "p/m" }] },
		{ selection: "ordered", models: [{ model: " p/m", thinking: "low" }] },
		{ selection: "ordered", models: [null] },
		{ selection: "ordered", models: [{ model: "p/m", thinking: "low" }], thinking: "high" },
	])("rejects invalid pool configuration %j", (profile) => {
		writeProfiles({ quick: profile });
		expect(() => loadModelProfiles()).toThrow();
	});

	function pool(selection: "ordered" | "random" | "round-robin"): void {
		writeProfiles({
			quick: {
				selection,
				models: [
					{ model: "p/missing", thinking: "off" },
					{ model: "p/one", thinking: "low" },
					{ model: "p/two", thinking: "high" },
				],
			},
		});
	}

	const registry = {
		find: (provider: string, id: string) => (id === "missing" ? undefined : ({ provider, id } as never)),
	};

	it("orders registered, authenticated candidates and allows further eligibility filtering", () => {
		pool("ordered");
		const profile = loadModelProfiles().quick!;
		const candidates = resolveModelProfileCandidates("quick", profile, registry);
		expect(candidates.map((candidate) => candidate.model.id)).toEqual(["one", "two"]);
		expect(selectModelProfile("quick", profile, candidates.slice(1)).thinking).toBe("high");
		expect(resolveModelProfile("quick", registry).model.id).toBe("one");
		expect(
			resolveModelProfile("quick", { ...registry, hasConfiguredAuth: (model) => model.id === "two" }),
		).toMatchObject({ model: { id: "two" }, thinking: "high" });
		expect(() =>
			resolveModelProfileCandidates("quick", profile, { ...registry, hasConfiguredAuth: () => false }),
		).toThrow(/unavailable/);
		expect(() => selectModelProfile("quick", profile, [])).toThrow(/unavailable/);
		expect(existsSync(join(agentDir, "state", "model-profile-selection.sqlite"))).toBe(false);
	});

	it("selects random candidates only from eligible entries without creating counters", () => {
		pool("random");
		vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
		expect(resolveModelProfile("quick", registry)).toMatchObject({ model: { id: "one" }, thinking: "low" });
		expect(resolveModelProfile("quick", registry)).toMatchObject({ model: { id: "two" }, thinking: "high" });
		expect(existsSync(join(agentDir, "state", "model-profile-selection.sqlite"))).toBe(false);
	});

	it("cycles over eligible candidates with independent counters per profile", () => {
		pool("round-robin");
		expect(Array.from({ length: 5 }, () => resolveModelProfile("quick", registry).model.id)).toEqual([
			"one",
			"two",
			"one",
			"two",
			"one",
		]);
		const profile = loadModelProfiles().quick!;
		const candidates = resolveModelProfileCandidates("routine", profile, registry);
		expect(selectModelProfile("routine", profile, candidates).model.id).toBe("one");
	});

	it("shares transactional round-robin counters across concurrent processes", async () => {
		pool("round-robin");
		const script = `
			import {resolveModelProfile} from ${JSON.stringify(new URL("../src/model-profiles.ts", import.meta.url).href)};
			const registry = {find: (provider,id) => id === 'missing' ? undefined : {provider,id}};
			console.log(JSON.stringify(Array.from({length:3}, () => resolveModelProfile('quick', registry).model.id)));
		`;
		const run = promisify(execFile);
		const loader = fileURLToPath(new URL("../../session-state/src/register.mjs", import.meta.url));
		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				run(process.execPath, ["--import", loader, "--input-type=module", "-e", script], {
					env: { ...process.env },
					timeout: 20000,
				}),
			),
		);
		const ids: string[] = results.flatMap((result) => JSON.parse(result.stdout));
		expect(ids.filter((id) => id === "one")).toHaveLength(6);
		expect(ids.filter((id) => id === "two")).toHaveLength(6);
	}, 30000);

	it("publishes the fixed inference profile catalog with profile-specific descriptions", () => {
		expect(INFERENCE_PROFILE_CATALOG.map((entry) => entry.profile)).toEqual(INFERENCE_PROFILE_NAMES);
		expect(INFERENCE_PROFILE_CATALOG.every((entry) => entry.description.length > 0)).toBe(true);
		expect(INFERENCE_PROFILE_CATALOG.find((entry) => entry.profile === "quick")?.description).toMatch(
			/Fast, economical model/,
		);
		expect(INFERENCE_PROFILE_CATALOG.find((entry) => entry.profile === "pair")?.description).toMatch(
			/attentive model that follows the work/,
		);
		expect(INFERENCE_PROFILE_CATALOG.find((entry) => entry.profile === "deep")?.description).toMatch(
			/Strongest available model/,
		);
		expect(isInferenceProfileName("coding")).toBe(true);
		expect(isInferenceProfileName("custom")).toBe(false);
	});
});
