import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRoles } from "../../organization/src/roles.js";
import { reviewRoleCatalog, reviewRolePolicy } from "../src/policy.js";

test("an all-concrete advisory catalog ignores unrelated malformed profiles, but a profile reference makes them required", () => {
	directory = mkdtempSync(join(tmpdir(), "review-catalog-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", directory);
	mkdirSync(join(directory, "roles"));
	const advisory = [...loadRoles(directory).roles.values()].filter((role) => !role.writes && !role.manages);
	for (const role of advisory)
		writeFileSync(
			join(directory, "roles", `${role.name}.md`),
			`---\ntitle: ${role.title}\nmandate: Inspect the contract.\nmodels: ["fixture/concrete:high"]\nwrites: false\nmanages: false\n---\nRead the source.\n`,
		);
	writeFileSync(join(directory, "model-profiles.json"), "invalid");
	expect(
		reviewRoleCatalog(directory)
			.map((role) => role.name)
			.sort(),
	).toEqual(advisory.map((role) => role.name).sort());
	writeFileSync(
		join(directory, "roles", "profile-reader.md"),
		'---\ntitle: Profile Reader\nmandate: Inspect the contract.\nmodels: ["balanced", "fixture/concrete:high"]\nwrites: false\nmanages: false\n---\nRead the source.\n',
	);
	expect(() => reviewRoleCatalog(directory)).toThrow("invalid JSON");
	expect(existsSync(join(directory, "state", "model-profile-selection.sqlite"))).toBe(false);
});

let directory: string;
afterEach(() => {
	vi.unstubAllEnvs();
	if (directory) rmSync(directory, { recursive: true, force: true });
});

test("policy inspection follows role profile authority without selecting a model or advancing a pool", () => {
	directory = mkdtempSync(join(tmpdir(), "review-policy-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", directory);
	mkdirSync(join(directory, "roles"));
	const role = (models: string[]) =>
		`---\ntitle: Fixture\nmandate: Inspect the change.\nmodels: ${JSON.stringify(models)}\nwrites: false\nmanages: false\n---\nTrace the contract.\n`;
	const path = join(directory, "roles", "fixture.md");
	const profilePath = join(directory, "model-profiles.json");
	writeFileSync(path, role(["fixture/default:high"]));
	writeFileSync(profilePath, "invalid");
	expect(reviewRolePolicy(directory, "fixture").candidates).toEqual([{ model: "fixture/default", thinking: "high" }]);
	writeFileSync(path, role(["balanced", "fixture/default:high"]));
	expect(() => reviewRolePolicy(directory, "fixture")).toThrow("invalid JSON");
	writeFileSync(
		profilePath,
		JSON.stringify({
			profiles: { balanced: { selection: "round-robin", models: [{ model: "fixture/selected", thinking: "low" }] } },
		}),
	);
	expect(reviewRolePolicy(directory, "fixture")).toMatchObject({
		profile: "balanced",
		selection: "round-robin",
		candidates: [{ model: "fixture/selected", thinking: "low" }],
	});
	const first = reviewRoleCatalog(directory);
	expect(reviewRoleCatalog(directory)).toEqual(first);
	expect(existsSync(join(directory, "state", "model-profile-selection.sqlite"))).toBe(false);
});

test("pass depth picks the model tier from any provider's profiles, while concrete-only roles keep their models", () => {
	directory = mkdtempSync(join(tmpdir(), "review-depth-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", directory);
	mkdirSync(join(directory, "roles"));
	const role = (name: string, models: string) =>
		writeFileSync(
			join(directory, "roles", `${name}.md`),
			`---\ntitle: ${name}\nmandate: Inspect the contract.\nmodels: ${models}\nwrites: false\nmanages: false\n---\nRead the source.\n`,
		);
	role("prosecutor", '["deep", "anthropic/claude-opus-5-5:high"]');
	role("reviewer", '["balanced", "anthropic/claude-opus-5-5:medium"]');
	role("concrete", '["fixture/concrete:high"]');
	writeFileSync(
		join(directory, "model-profiles.json"),
		JSON.stringify({
			profiles: {
				balanced: { selection: "ordered", models: [{ model: "anthropic/claude-sonnet-5-5", thinking: "high" }] },
				deep: { selection: "ordered", models: [{ model: "anthropic/claude-opus-5-5", thinking: "high" }] },
			},
		}),
	);
	const tier = (name: string, depth: "standard" | "deep") => {
		const policy = reviewRolePolicy(directory, name, depth);
		return [policy.profile, policy.candidates.map((candidate) => candidate.model)];
	};
	expect(tier("prosecutor", "standard")).toEqual(["balanced", ["anthropic/claude-sonnet-5-5"]]);
	expect(tier("prosecutor", "deep")).toEqual(["deep", ["anthropic/claude-opus-5-5"]]);
	expect(tier("reviewer", "deep")).toEqual(["deep", ["anthropic/claude-opus-5-5"]]);
	expect(tier("concrete", "deep")).toEqual([null, ["fixture/concrete"]]);
	const catalog = reviewRoleCatalog(directory).find((entry) => entry.name === "prosecutor")!;
	expect(catalog.policy).not.toBe(catalog.deepPolicy);
});
