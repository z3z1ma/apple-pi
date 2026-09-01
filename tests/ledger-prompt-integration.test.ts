import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadPairSystemPrompt } from "../components/pair-programmer/src/config.js";
import {
	appendLedgerSystemPrompt,
	LEDGER_SYSTEM_PROMPT,
	LEDGER_SYSTEM_PROMPT_TAG,
} from "../components/shared/src/ledger-system-prompt.js";
import { childSessionExtensions } from "../components/subagents/src/agent-runner.js";
import { buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig, EnvInfo } from "../components/subagents/src/types.js";
import { AUTO_COMPACT_EXTENSION_PATH } from "../extensions/auto-compact.js";
import { CODEX_FAST_EXTENSION_PATH } from "../extensions/codex-vroom.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../extensions/home-search-guard.js";
import { LEDGER_EXTENSION_PATH } from "../extensions/ledger.js";
import { MCP_EXTENSION_PATH } from "../extensions/mcp.js";
import { PAIR_EXTENSION_PATH } from "../extensions/pi-pair.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../extensions/session-search.js";
import { WIKI_EXTENSION_PATH } from "../extensions/wiki.js";

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
	it("appends the operational-memory contract idempotently", () => {
		const once = appendLedgerSystemPrompt("Root system prompt");
		const twice = appendLedgerSystemPrompt(once);
		expect(once).toBe(`Root system prompt\n\n${LEDGER_SYSTEM_PROMPT}`);
		expect(twice).toBe(once);
		expect(occurrences(twice, marker)).toBe(1);
		expect(LEDGER_SYSTEM_PROMPT).toContain("simple project-local convention");
		expect(LEDGER_SYSTEM_PROMPT).toContain("workflow that creates an artifact owns its format");
		expect(LEDGER_SYSTEM_PROMPT).toContain("retrospective.md");
		expect(LEDGER_SYSTEM_PROMPT).not.toContain("Skill routing");
	});

	it("inherits the parent prompt unchanged in append-mode subagents", () => {
		const rootPrompt = appendLedgerSystemPrompt("Root system prompt");
		const appendChild = buildAgentPrompt({ ...config, promptMode: "append" }, "/repo", env, rootPrompt);
		expect(appendChild).toContain(marker);
		expect(appendChild).toContain(LEDGER_SYSTEM_PROMPT);
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
			AUTO_COMPACT_EXTENSION_PATH,
			CODEX_FAST_EXTENSION_PATH,
			HOME_SEARCH_GUARD_EXTENSION_PATH,
			LEDGER_EXTENSION_PATH,
			WIKI_EXTENSION_PATH,
			SESSION_SEARCH_EXTENSION_PATH,
		]);
	});

	it("does not copy the contract into the pair programmer prompt", () => {
		expect(loadPairSystemPrompt(process.cwd(), false)).not.toContain(marker);
	});

	it("loads children with fast mode, safety guards, the workbenches, search_session, and MCP", () => {
		expect(childSessionExtensions()).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				CODEX_FAST_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				WIKI_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				MCP_EXTENSION_PATH,
			],
		});
	});

	it("keeps fast mode and safety guards when internal children suppress standard extensions", () => {
		expect(childSessionExtensions(false, false)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				CODEX_FAST_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
			],
		});
	});

	it("adds the pair programmer sidecar only when requested", () => {
		expect(childSessionExtensions(true)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				CODEX_FAST_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				WIKI_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				MCP_EXTENSION_PATH,
				PAIR_EXTENSION_PATH,
			],
		});
	});
});
