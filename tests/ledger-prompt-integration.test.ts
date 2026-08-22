import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadAdvisorSystemPrompt } from "../components/advisor/src/config.js";
import { appendLedgerSystemPrompt, LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import {
	appendLedgerWorkflowSystemPrompt,
	LEDGER_WORKFLOW_SYSTEM_PROMPT_TAG,
} from "../components/shared/src/workflow-system-prompt.js";
import { childSessionExtensions } from "../components/subagents/src/agent-runner.js";
import { buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig, EnvInfo } from "../components/subagents/src/types.js";
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
		expect(occurrences(twice, marker)).toBe(1);
		expect(twice).toContain("ledger_add");
		expect(twice).toContain("ledger_close");
		expect(twice).toContain("**Provenance:**");
		expect(twice).toContain("1. **Shaping:**");
		expect(twice).toContain("2. **Orchestration:**");
		expect(twice).toContain("3. **Execution:**");
		expect(twice).toContain("A worker report is a claim");
		expect(twice).toContain("task.md is the durable statement of intent and acceptance");
		expect(twice).toContain("specs/ holds optional behavioral contracts");
		expect(twice).toContain("plans/ owns work-item decomposition and execution progress");
		expect(twice).toContain("research/ owns inquiry, source citation, interpretation, and synthesis");
		expect(twice).toContain("decisions/ records consequential choices and provenance");
		expect(twice).toContain("evidence/ owns provenance-bearing validation observations");
		expect(twice).toContain("retrospective.md is the single learning-and-improvement record");
		expect(twice).toContain("specification: `draft | active | superseded`");
		expect(twice).toContain("plan: `draft | active | complete | superseded`");
		expect(twice).toContain("research: `active | complete | superseded`");
		expect(twice).toContain("decision: `active | superseded`");
		expect(twice).toContain("evidence: `recorded`");
		expect(twice).toContain("retrospective: `pending | complete`");
		expect(twice).toContain("An execution-changing assumption that is not operator-ratified");
		expect(twice).toContain("The same observation must not be copied into both locations");
		expect(twice).toContain("A task may be marked `done` only when");
		expect(twice).toContain("every dependency resolves to a `done` task");
		expect(twice).toContain("no referenced research, decision need, plan, or dependency still blocks the outcome");
		expect(twice).toContain("no active plan remains, and every plan for the outcome is `complete` or `superseded`");
		expect(twice).toContain("work complete or substantively cancelled with a rationale");
		expect(twice).toContain(
			"every Acceptance Criterion has adequate supporting evidence under `evidence/` with applicable limits",
		);
		expect(twice).toContain(
			"every review finding and remediation is resolved, rejected with evidence, or explicitly bounded",
		);
		expect(twice).toContain("rationale, owner, and revisit condition");
		expect(twice).toContain("`retrospective.md` is complete");
		expect(twice).not.toContain("knowledge/");
		expect(twice).not.toContain("skills/<slug>/SKILL.md");
		expect(twice).not.toContain("Review, routine evidence, Journal");
	});

	it("appends the root workflow bootstrap exactly once", () => {
		const once = appendLedgerWorkflowSystemPrompt("Root system prompt");
		const twice = appendLedgerWorkflowSystemPrompt(once);
		expect(occurrences(twice, workflowMarker)).toBe(1);
		expect(twice).toContain("`<available_skills>` catalog");
		expect(twice).toContain("catalog entry's exact `<location>`");
		expect(twice).toContain("wherever Pi is opened");
		expect(twice).toContain("`task-shaping`");
		expect(twice).toContain("`root-cause-debugging`");
		expect(twice).toContain("`completion-verification`");
		expect(twice).toContain("`pi-exec`");
		const collision = appendLedgerWorkflowSystemPrompt("Project text mentions <ledger-workflow> as an example.");
		expect(collision).toContain("`<available_skills>` catalog");
		expect(occurrences(collision, "# apple-pi Ledger workflow")).toBe(1);
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
		expect(appendChild).not.toContain("`<available_skills>` catalog");
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
