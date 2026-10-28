import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { modelSizingBand, PROFILE_SIZING_BANDS } from "../../../tests/helpers/model-sizing.js";
import { isInferenceProfileName } from "../../shared/src/model-profiles.js";
import { installOrganization, loadRoles } from "../src/index.js";

const organization = (pi: ExtensionAPI) => {
	pi.registerFlag("role", { type: "string", description: "role" });
	pi.registerFlag("reports-to", { type: "string", description: "manager" });
	installOrganization(pi);
};

vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "apo-agent-")));

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "apo-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("every package role loads with a mandate, a profile, concrete defaults, and an obligation", () => {
	const catalog = loadRoles(tempDir());
	expect(catalog.problems).toEqual([]);
	expect(catalog.roles.size).toBeGreaterThan(0);
	const managers = [...catalog.roles.values()].filter((role) => role.manages).map((role) => role.name);
	expect(managers.sort()).toEqual(["coordinator", "director-of-engineering"]);
	for (const role of catalog.roles.values()) {
		expect(role.mandate, role.name).not.toBe("");
		expect(isInferenceProfileName(role.models[0]!), role.name).toBe(true);
		expect(role.models.length, role.name).toBeGreaterThan(1);
		expect(role.body.trim(), role.name).not.toBe("");
	}
});

test("concrete role recommendations meet their workload's sizing band at the role's shared effort", () => {
	const { roles } = loadRoles(tempDir());
	for (const role of roles.values()) {
		const minimum = PROFILE_SIZING_BANDS[role.models[0]!]!;
		expect(minimum, role.name).toBeGreaterThan(0);
		for (const model of role.models.slice(1)) {
			expect(modelSizingBand(model, role.thinking), `${role.name}: ${model}/${role.thinking}`).toBeGreaterThanOrEqual(
				minimum,
			);
		}
	}
	expect(roles.get("technical-writer")?.models[1]).toBe("openai/gpt-6.1-terra");
});

test("a manager's prompt carries the catalog's titles and mandates; a hired non-manager's does not", async () => {
	const catalog = loadRoles(tempDir());
	const run = await fauxSession([organization], [fauxAssistantMessage("ok"), fauxAssistantMessage("ok")], ["read"]);
	try {
		run.session.extensionRunner.setFlagValue("role", "coordinator");
		await run.session.bindExtensions({});
		await run.session.prompt("hi");
		const prompt = run.session.agent.state.systemPrompt;
		expect(prompt).toContain("<role-catalog>");
		for (const role of catalog.roles.values())
			expect(prompt).toContain(`\`${role.name}\`: ${role.title}. ${role.mandate}.`);
	} finally {
		run.dispose();
	}

	const hired = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"]);
	try {
		hired.session.extensionRunner.setFlagValue("role", "scientific-skeptic");
		hired.session.extensionRunner.setFlagValue("reports-to", "some-manager");
		await hired.session.bindExtensions({});
		await hired.session.prompt("hi");
		expect(hired.session.agent.state.systemPrompt).not.toContain("<role-catalog>");
		expect(hired.session.agent.state.systemPrompt).not.toContain("<manager>");
	} finally {
		hired.dispose();
	}
});

test("three people hired with the same brief hold three obligations, not one prompt with three titles", async () => {
	const sections: string[] = [];
	for (const role of [
		"distinguished-member-of-technical-staff",
		"staff-engineer-simplicity",
		"architecture-prosecutor",
	]) {
		const run = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"]);
		try {
			run.session.extensionRunner.setFlagValue("role", role);
			run.session.extensionRunner.setFlagValue("reports-to", "some-manager");
			await run.session.bindExtensions({});
			await run.session.prompt("Review the proposal in docs/proposal.md.");
			const prompt = run.session.agent.state.systemPrompt;
			sections.push(prompt.slice(prompt.indexOf("<role>"), prompt.indexOf("</role>")));
		} finally {
			run.dispose();
		}
	}
	const obligations = sections.map((section) => /Your obligation is ([^.]+)\./.exec(section)?.[1]);
	expect(new Set(obligations).size).toBe(3);
	expect(obligations[0]).toContain("widen");
	expect(obligations[1]).toContain("reduce accidental complexity");
	expect(obligations[2]).toContain("evidence that the design is");
	expect(sections[0]).not.toContain("Prosecutor");
	expect(sections[2]).not.toContain("Distinguished");
});
