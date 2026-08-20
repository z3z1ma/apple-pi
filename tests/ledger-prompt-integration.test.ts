import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadAdvisorSystemPrompt } from "../components/advisor/src/config.js";
import { appendLedgerSystemPrompt, LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import { childSessionExtensions } from "../components/subagents/src/agent-runner.js";
import { buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig, EnvInfo } from "../components/subagents/src/types.js";
import { LEDGER_EXTENSION_PATH } from "../extensions/ledger.js";
import { MCP_EXTENSION_PATH } from "../extensions/mcp.js";
import { ADVISOR_EXTENSION_PATH } from "../extensions/pi-advisor.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../extensions/session-search.js";

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
	it("appends the contract idempotently", () => {
		const once = appendLedgerSystemPrompt("Root system prompt");
		const twice = appendLedgerSystemPrompt(once);
		expect(occurrences(twice, marker)).toBe(1);
		expect(twice).toContain("ledger_add");
		expect(twice).toContain("ledger_close");
	});

	it("does not copy the contract into subagent prompt text", () => {
		const replaced = buildAgentPrompt(config, "/repo", env);
		const inherited = buildAgentPrompt({ ...config, promptMode: "append" }, "/repo", env, replaced);
		expect(replaced).not.toContain(marker);
		expect(inherited).not.toContain(marker);
	});

	it("loads the ledger extension on workers instead of pasting the contract", () => {
		const args = buildAgentCliArgs(
			{ task: "Inspect the task", systemPrompt: "Custom worker guidance" },
			{ tools: ["read"], projectTrusted: false, model: "provider/model", thinking: "high" },
		);
		const guidance = args[args.indexOf("--append-system-prompt") + 1];
		expect(guidance).not.toContain(marker);
		expect(args).toContain("--no-extensions");
		expect(args).toContain("--extension");
		expect(args.filter((_, index, all) => all[index - 1] === "--extension")).toEqual([
			LEDGER_EXTENSION_PATH,
			SESSION_SEARCH_EXTENSION_PATH,
		]);
	});

	it("does not copy the contract into the advisor prompt", () => {
		expect(loadAdvisorSystemPrompt(process.cwd(), false)).not.toContain(marker);
	});

	it("loads children with ledger, session_search, and MCP", () => {
		expect(childSessionExtensions()).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [LEDGER_EXTENSION_PATH, SESSION_SEARCH_EXTENSION_PATH, MCP_EXTENSION_PATH],
		});
	});

	it("adds the advisor sidecar only when requested", () => {
		expect(childSessionExtensions(true)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				LEDGER_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				MCP_EXTENSION_PATH,
				ADVISOR_EXTENSION_PATH,
			],
		});
	});
});
