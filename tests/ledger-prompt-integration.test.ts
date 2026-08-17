import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadAdvisorSystemPrompt } from "../components/advisor/src/config.js";
import { appendLedgerSystemPrompt, LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import { buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig, EnvInfo } from "../components/subagents/src/types.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";

const marker = `<${LEDGER_SYSTEM_PROMPT_TAG}>`;
const env: EnvInfo = { isGitRepo: true, branch: "main", platform: "test" };
const config: AgentConfig = {
	name: "test-agent",
	description: "test",
	systemPrompt: "Do the assigned work.",
	extensions: false,
	skills: false,
	promptMode: "replace",
};

function occurrences(value: string, needle: string): number {
	return value.split(needle).length - 1;
}

describe("ledger system prompt distribution", () => {
	it("appends the root prompt idempotently", () => {
		const once = appendLedgerSystemPrompt("Root system prompt");
		const twice = appendLedgerSystemPrompt(once);
		expect(occurrences(twice, marker)).toBe(1);
		expect(twice).toContain("ledger_scaffold");
		expect(twice).toContain("ledger_close");
	});

	it("teaches replace-mode and inherited subagents", () => {
		const replaced = buildAgentPrompt(config, "/repo", env);
		const inherited = buildAgentPrompt({ ...config, promptMode: "append" }, "/repo", env, replaced);
		expect(occurrences(replaced, marker)).toBe(1);
		expect(occurrences(inherited, marker)).toBe(1);
	});

	it("teaches pi_exec workers once without enabling extensions", () => {
		const args = buildAgentCliArgs(
			{ task: "Inspect the task", systemPrompt: appendLedgerSystemPrompt("Custom worker guidance") },
			{ tools: ["read"], model: "provider/model", thinking: "high" },
		);
		const guidance = args[args.indexOf("--append-system-prompt") + 1];
		expect(occurrences(guidance, marker)).toBe(1);
		expect(args).toContain("--no-extensions");
	});

	it("teaches the advisor's independent model", () => {
		expect(loadAdvisorSystemPrompt(process.cwd(), false)).toContain(marker);
	});
});
