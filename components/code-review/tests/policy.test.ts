import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { reviewRoleCatalog, reviewRolePolicy } from "../src/policy.js";

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
