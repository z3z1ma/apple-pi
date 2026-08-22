import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadAdvisorSystemPrompt } from "../components/advisor/src/config.js";
import {
	appendLedgerSystemPrompt,
	LEDGER_SYSTEM_PROMPT,
	LEDGER_SYSTEM_PROMPT_TAG,
} from "../components/shared/src/ledger-system-prompt.js";
import {
	appendLedgerWorkflowSystemPrompt,
	LEDGER_WORKFLOW_SYSTEM_PROMPT,
	LEDGER_WORKFLOW_SYSTEM_PROMPT_TAG,
} from "../components/shared/src/workflow-system-prompt.js";
import { childSessionExtensions } from "../components/subagents/src/agent-runner.js";
import { buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig, EnvInfo } from "../components/subagents/src/types.js";
import { AUTO_COMPACT_EXTENSION_PATH } from "../extensions/auto-compact.js";
import { LEDGER_EXTENSION_PATH } from "../extensions/ledger.js";
import { MCP_EXTENSION_PATH } from "../extensions/mcp.js";
import { ADVISOR_EXTENSION_PATH } from "../extensions/pi-advisor.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../extensions/session-search.js";
import { WORKFLOW_EXTENSION_PATH } from "../extensions/workflow.js";

const marker = `<${LEDGER_SYSTEM_PROMPT_TAG}>`;
const workflowMarker = `<${LEDGER_WORKFLOW_SYSTEM_PROMPT_TAG}>`;
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
		expect(once).toBe(`Root system prompt\n\n${LEDGER_SYSTEM_PROMPT}`);
		expect(twice).toBe(once);
		expect(occurrences(twice, marker)).toBe(1);
	});

	it("appends the root workflow bootstrap exactly once", () => {
		const once = appendLedgerWorkflowSystemPrompt("Root system prompt");
		const twice = appendLedgerWorkflowSystemPrompt(once);
		expect(once).toBe(`Root system prompt\n\n${LEDGER_WORKFLOW_SYSTEM_PROMPT}`);
		expect(twice).toBe(once);
		expect(occurrences(twice, workflowMarker)).toBe(1);
		const collision = appendLedgerWorkflowSystemPrompt("Project text mentions <ledger-workflow> as an example.");
		expect(collision.endsWith(LEDGER_WORKFLOW_SYSTEM_PROMPT)).toBe(true);
		expect(LEDGER_WORKFLOW_SYSTEM_PROMPT).toContain("Keep three layers distinct");
		expect(LEDGER_WORKFLOW_SYSTEM_PROMPT).toContain("Backlog → to-do");
		expect(LEDGER_WORKFLOW_SYSTEM_PROMPT).toContain("completed to-do as Ledger acceptance evidence");
	});

	it("keeps the root workflow extension out of child and worker extension lists", () => {
		expect(childSessionExtensions().additionalExtensionPaths).not.toContain(WORKFLOW_EXTENSION_PATH);
		expect(childSessionExtensions(true).additionalExtensionPaths).not.toContain(WORKFLOW_EXTENSION_PATH);
		const args = buildAgentCliArgs(
			{ task: "Inspect the task", systemPrompt: "Custom worker guidance" },
			{ tools: ["read"], projectTrusted: false, model: "provider/model", thinking: "high" },
		);
		expect(args).not.toContain(WORKFLOW_EXTENSION_PATH);
	});

	it("does not copy root-only contracts into subagent prompt text", () => {
		const replaced = buildAgentPrompt(config, "/repo", env);
		const inherited = buildAgentPrompt({ ...config, promptMode: "append" }, "/repo", env, replaced);
		expect(replaced).not.toContain(marker);
		expect(inherited).not.toContain(marker);
		const rootPrompt = appendLedgerWorkflowSystemPrompt("Root system prompt");
		const appendChild = buildAgentPrompt({ ...config, promptMode: "append" }, "/repo", env, rootPrompt);
		expect(appendChild).not.toContain(workflowMarker);
	});

	it("appends invocation-specific system guidance after preloaded skills", () => {
		const prompt = buildAgentPrompt(config, "/repo", env, undefined, {
			skillBlocks: [{ name: "demo", content: "Generic skill guidance." }],
			additionalSystemPrompt: "Invocation-specific guidance.",
		});
		expect(prompt.indexOf("Do the assigned work.")).toBeLessThan(prompt.indexOf("Generic skill guidance."));
		expect(prompt.indexOf("Generic skill guidance.")).toBeLessThan(prompt.indexOf("Invocation-specific guidance."));
		expect(prompt).toContain("<invocation_instructions>\nInvocation-specific guidance.\n</invocation_instructions>");
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
			LEDGER_EXTENSION_PATH,
			SESSION_SEARCH_EXTENSION_PATH,
		]);
	});

	it("does not copy the contract into the advisor prompt", () => {
		expect(loadAdvisorSystemPrompt(process.cwd(), false)).not.toContain(marker);
	});

	it("loads children with the overflow guard, ledger, session_search, and MCP", () => {
		expect(childSessionExtensions()).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				MCP_EXTENSION_PATH,
			],
		});
	});

	it("keeps the overflow guard when internal children suppress standard extensions", () => {
		expect(childSessionExtensions(false, false)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [AUTO_COMPACT_EXTENSION_PATH],
		});
	});

	it("adds the advisor sidecar only when requested", () => {
		expect(childSessionExtensions(true)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				MCP_EXTENSION_PATH,
				ADVISOR_EXTENSION_PATH,
			],
		});
	});
});
