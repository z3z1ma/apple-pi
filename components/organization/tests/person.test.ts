import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { drawSoul, installOrganization, renderSoul, SOUL_LISTS, soulLine } from "../src/index.js";

vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "apo-agent-")));

const organization = (pi: ExtensionAPI) => {
	pi.registerFlag("role", { type: "string", description: "role" });
	pi.registerFlag("reports-to", { type: "string", description: "manager" });
	installOrganization(pi);
};

test("a soul is drawn from every list, renders as one paragraph, and the lists are long enough to tell people apart", () => {
	expect(SOUL_LISTS.HABITS.length).toBeGreaterThanOrEqual(30);
	expect(new Set(SOUL_LISTS.HABITS).size).toBe(SOUL_LISTS.HABITS.length);
	const first = drawSoul(() => 0);
	const last = drawSoul(() => 0.999999);
	expect(first).toEqual({
		stance: SOUL_LISTS.STANCES[0],
		evidence: SOUL_LISTS.EVIDENCE[0],
		risk: SOUL_LISTS.RISKS[0],
		length: SOUL_LISTS.LENGTHS[0],
		estimates: SOUL_LISTS.ESTIMATES[0],
		habit: SOUL_LISTS.HABITS[0],
	});
	expect(last.habit).toBe(SOUL_LISTS.HABITS.at(-1));
	expect(renderSoul(first)).toBe(
		`As a person: ${first.stance}; ${first.evidence}; ${first.risk}. ${first.length} ${first.estimates} One habit: ${first.habit}.`,
	);
	expect(soulLine(first)).toBe(`${first.stance}; habit: ${first.habit}.`);
	for (const value of Object.values(drawSoul())) expect(value.length).toBeGreaterThan(10);
});

test("two people hired into the same role share the role body and differ by soul", async () => {
	const prompts: string[] = [];
	for (let i = 0; i < 2; i++) {
		const run = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"]);
		try {
			run.session.extensionRunner.setFlagValue("role", "staff-engineer-simplicity");
			await run.session.bindExtensions({});
			await run.session.prompt("hi");
			prompts.push(run.session.agent.state.systemPrompt);
		} finally {
			run.dispose();
		}
	}
	const [a, b] = prompts as [string, string];
	expect(a).toContain("<role>\nYou are a Staff Software Engineer");
	expect(b).toContain("<role>\nYou are a Staff Software Engineer");
	const soulOf = (prompt: string) => /As a person: [^\n]+/.exec(prompt)?.[0];
	expect(soulOf(a)).toBeDefined();
	// Six independent draws from lists of 6 to 34 entries; two equal souls are a one-in-a-million event.
	expect(soulOf(a)).not.toBe(soulOf(b));
});

test("a session without a role has no soul paragraph, and the self seed is shown until update_self replaces it", async () => {
	const self = "# The people I work with\n- Nobody yet.\n\n# What I am working on now\nThe org.";
	const run = await fauxSession(
		[organization],
		[
			fauxAssistantMessage("ok"),
			fauxAssistantMessage([fauxToolCall("update_self", { text: self })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
			fauxAssistantMessage("again"),
		],
		["read"],
	);
	try {
		await run.session.prompt("hi");
		let prompt = run.session.agent.state.systemPrompt;
		expect(prompt).not.toContain("As a person:");
		expect(prompt).toContain("<self>\nYou have not written your self yet.");
		expect(prompt).toContain("# Standing agreements");

		await run.session.prompt("write yourself");
		await run.session.prompt("and again");
		prompt = run.session.agent.state.systemPrompt;
		expect(prompt).toContain(`<self>\n${self}\n</self>`);
		expect(prompt).not.toContain("You have not written your self yet");
	} finally {
		run.dispose();
	}
});
