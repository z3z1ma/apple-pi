import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadPairSystemPrompt } from "../components/pair-programmer/src/config.js";
import {
	appendWikiSystemPrompt,
	WIKI_SYSTEM_PROMPT,
	WIKI_SYSTEM_PROMPT_TAG,
} from "../components/wiki/src/system-prompt.js";
import { childSessionExtensions, isStructurallyReadOnlyAgent } from "../components/subagents/src/agent-runner.js";
import { buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig, EnvInfo } from "../components/subagents/src/types.js";
import { AUTO_COMPACT_EXTENSION_PATH } from "../extensions/auto-compact.js";
import { VROOM_EXTENSION_PATH } from "../extensions/vroom.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../extensions/home-search-guard.js";
import { LEDGER_EXTENSION_PATH } from "../extensions/ledger.js";
import { MCP_EXTENSION_PATH } from "../extensions/mcp.js";
import { PAIR_EXTENSION_PATH } from "../extensions/pi-pair.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../extensions/session-search.js";
import { WIKI_EXTENSION_PATH } from "../extensions/wiki.js";

const marker = `<${WIKI_SYSTEM_PROMPT_TAG}>`;
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

describe("wiki workbench distribution", () => {
	it("appends the compact wiki contract idempotently", () => {
		const once = appendWikiSystemPrompt("Root system prompt");
		const twice = appendWikiSystemPrompt(once);
		expect(once).toBe(`Root system prompt\n\n${WIKI_SYSTEM_PROMPT}`);
		expect(twice).toBe(once);
		expect(occurrences(twice, marker)).toBe(1);
		expect(WIKI_SYSTEM_PROMPT).toContain("filename stem");
		expect(WIKI_SYSTEM_PROMPT).toContain("case-insensitively");
		expect(WIKI_SYSTEM_PROMPT).toContain("wiki_references");
		expect(WIKI_SYSTEM_PROMPT).toContain("wiki_lint");
		expect(WIKI_SYSTEM_PROMPT).toContain("llm-wiki");
	});

	it("inherits the parent contract unchanged in append-mode subagents", () => {
		const rootPrompt = appendWikiSystemPrompt("Root system prompt");
		const appendChild = buildAgentPrompt({ ...config, promptMode: "append" }, "/repo", env, rootPrompt);
		expect(appendChild).toContain(marker);
		expect(appendChild).toContain(WIKI_SYSTEM_PROMPT);
	});

	it("loads the wiki extension on workers instead of pasting the contract", () => {
		const args = buildAgentCliArgs(
			{ task: "Inspect the wiki", systemPrompt: "Custom worker guidance" },
			{ tools: ["read"], projectTrusted: false, model: "provider/model", thinking: "high" },
		);
		const guidance = args[args.indexOf("--append-system-prompt") + 1];
		expect(guidance).not.toContain(marker);
		expect(args[args.indexOf("--tools") + 1]).toBe("read,wiki_lint,wiki_references");
		expect(args.filter((_, index, all) => all[index - 1] === "--extension")).toEqual([
			AUTO_COMPACT_EXTENSION_PATH,
			VROOM_EXTENSION_PATH,
			HOME_SEARCH_GUARD_EXTENSION_PATH,
			LEDGER_EXTENSION_PATH,
			WIKI_EXTENSION_PATH,
			SESSION_SEARCH_EXTENSION_PATH,
		]);
	});

	it("does not copy the wiki contract into the pair programmer prompt", () => {
		expect(loadPairSystemPrompt(process.cwd(), false)).not.toContain(marker);
	});

	it("loads ordinary children with the wiki extension", () => {
		expect(childSessionExtensions()).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				VROOM_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				WIKI_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				MCP_EXTENSION_PATH,
			],
		});
	});

	it("loads the read-only wiki surface for public read-only roles", () => {
		for (const role of ["explorer", "planner", "researcher", "consultant"]) {
			expect(isStructurallyReadOnlyAgent(role)).toBe(true);
			const readOnly = isStructurallyReadOnlyAgent(role);
			expect(childSessionExtensions(false, !readOnly, readOnly)).toEqual({
				noExtensions: true,
				additionalExtensionPaths: [
					AUTO_COMPACT_EXTENSION_PATH,
					VROOM_EXTENSION_PATH,
					HOME_SEARCH_GUARD_EXTENSION_PATH,
					WIKI_EXTENSION_PATH,
					SESSION_SEARCH_EXTENSION_PATH,
				],
			});
		}
		expect(isStructurallyReadOnlyAgent("builder")).toBe(false);
	});

	it("keeps the internal child free of wiki guidance and tools", () => {
		expect(childSessionExtensions(false, false)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [AUTO_COMPACT_EXTENSION_PATH, VROOM_EXTENSION_PATH, HOME_SEARCH_GUARD_EXTENSION_PATH],
		});
	});

	it("adds the pair sidecar after the standard wiki boundary", () => {
		expect(childSessionExtensions(true)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				VROOM_EXTENSION_PATH,
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
