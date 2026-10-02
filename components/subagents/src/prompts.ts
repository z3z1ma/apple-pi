/**
 * prompts.ts — System prompt builder for agents.
 */

import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import type { AgentConfig, EnvInfo } from "./types.js";

/** Extra sections to inject into the system prompt. */
export interface PromptExtras {
	/** Invocation-level guidance appended after the selected definition's prompt. */
	additionalSystemPrompt?: string;
	/** Preloaded skill contents to inject. */
	skillBlocks?: { name: string; content: string }[];
}

/**
 * Build the custom preamble for an agent from its config.
 *
 * - "replace" mode: delegation header + environment + config.systemPrompt (no parent identity)
 * - "append" mode: parent system prompt + delegation note + environment + config.systemPrompt
 *
 * Both modes include an `<active_agent name="${config.name}"/>` tag so downstream
 * extensions (e.g. permission/policy systems) can resolve per-agent policy
 * inside the child session by parsing the system prompt. In append mode it follows
 * the inherited parent prompt so that prompt stays a verbatim prefix.
 *
 * @param parentSystemPrompt  The parent agent's effective system prompt (for append mode).
 * @param extras  Optional preloaded skills.
 */
export function buildAgentPrompt(
	config: AgentConfig,
	env: EnvInfo,
	parentSystemPrompt?: string,
	extras?: PromptExtras,
): string {
	const activeAgentTag = `<active_agent name="${config.name}"/>\n\n`;

	const envBlock = `# Environment
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

	const extraSections: string[] = [];
	if (extras?.skillBlocks?.length) {
		for (const skill of extras.skillBlocks) {
			extraSections.push(`\n# Preloaded Skill: ${skill.name}\n${skill.content}`);
		}
	}
	const invocationSection = extras?.additionalSystemPrompt?.trim()
		? `\n\n<invocation_instructions>\n${extras.additionalSystemPrompt.trim()}\n</invocation_instructions>`
		: "";
	const extrasSuffix = extraSections.length > 0 ? `\n\n${extraSections.join("\n")}` : "";

	if (config.promptMode === "append") {
		const identity = parentSystemPrompt || genericBase;
		const bridge = `<sub_agent_context>
You are now a sub-agent working on a task delegated by the agent described above. Your own tools define what you can do.
</sub_agent_context>`;
		const customSection = config.systemPrompt?.trim()
			? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
			: "";
		return `${identity}\n\n${bridge}\n\n${activeAgentTag}${envBlock}${customSection}${extrasSuffix}${invocationSection}`;
	}

	const replaceHeader = `You are a teammate in a Pi coding session, working on a task delegated by another agent. Carry the task to completion, then end with a report the delegating agent can act on.

${envBlock}`;

	return `${activeAgentTag + replaceHeader}\n\n${config.systemPrompt}${extrasSuffix}${invocationSection}`;
}

/** Fallback base prompt when parent system prompt is unavailable in append mode. */
const genericBase = `# Role
You are a coding agent handling a specific delegated task.`;

/**
 * Pi renders tool summaries and usage rules only for its default preamble. A child with a
 * custom preamble gets them as sections; an append-mode child already inherits its parent's.
 */
export function addToolGuidanceSections(options: NormalizedBuildSystemPromptOptions): void {
	if (options.customPrompt === undefined) return;
	const tools = options.selectedTools
		.filter((name) => options.toolSnippets[name])
		.map((name) => `- ${name}: ${options.toolSnippets[name]}`);
	const rules = new Set(
		[...options.selectedTools.flatMap((name) => options.toolGuidelines[name] ?? []), ...options.promptGuidelines]
			.map((rule) => rule.trim())
			.filter(Boolean),
	);
	if (tools.length > 0) setSystemPromptSection(options, "tools", tools.join("\n"));
	if (rules.size > 0) setSystemPromptSection(options, "rules", [...rules].map((rule) => `- ${rule}`).join("\n"));
}
