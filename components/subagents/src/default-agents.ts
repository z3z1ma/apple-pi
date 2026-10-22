/**
 * default-agents.ts — Embedded default agent configurations.
 *
 * The interns (explorer, researcher) are listed in the team prompt; the builder is callable by name for `pi_exec`
 * programs and the skills that use it, but not listed. Each can be overridden by a user .md file with the same name.
 * The consultant is not an agent type at all: the pair programmer's consultation runs it from `CONSULTANT`.
 */

import { INVESTIGATION_GUIDANCE as ADVISORY_CONTRACT, INTERN_PROMPTS } from "../../interns/src/prompts.js";
import { BUILTIN_TOOL_NAMES } from "./builtin-tools.js";
import type { AgentConfig } from "./types.js";

const ADVISORY_TOOLS = BUILTIN_TOOL_NAMES.filter((name) => name !== "edit" && name !== "write");

export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map([
	[
		"explorer",
		{
			name: "explorer",
			displayName: "Explorer",
			description:
				'Read-only scout that maps unfamiliar local code across several areas or hypotheses. Ask for "quick", "medium", or "very thorough" breadth. It reads excerpts and can miss detail; search known paths yourself.',
			builtinToolNames: ADVISORY_TOOLS,
			extensions: false,
			skills: true,
			profile: "quick",
			systemPrompt: INTERN_PROMPTS.explore,
			promptMode: "replace",
			isDefault: true,
		},
	],
	[
		"researcher",
		{
			name: "researcher",
			displayName: "Researcher",
			description:
				"Researches external sources: official documentation, version-specific APIs, GitHub examples, and unfamiliar libraries. Returns sourced findings.",
			builtinToolNames: ADVISORY_TOOLS,
			extensions: false,
			skills: false,
			profile: "quick",
			systemPrompt: INTERN_PROMPTS.research,
			promptMode: "replace",
			isDefault: true,
		},
	],
	[
		"builder",
		{
			name: "builder",
			displayName: "Builder",
			description:
				"Implements a specified, bounded change. Give it the full task, owned files, and checks to run. Best for substantial headless work; keep discovery, unclear requirements, and tiny edits in your session.",
			extensions: false,
			skills: false,
			profile: "coding",
			pair: true,
			listed: false,
			systemPrompt: `# Role
You are an implementation teammate who owns one bounded, well-specified change. Planning, research, and design are settled; apply the task as specified.

Find missing context in the repository yourself, and ask only for inputs you cannot retrieve. Mention obvious issues briefly. Run the validation you were assigned and report anything you skipped.

# Report
- What changed (paths)
- Validation run or skipped, with results
- Anything left incomplete`,
			promptMode: "replace",
			isDefault: true,
		},
	],
]);

/** The pair programmer's consultant: a read-only second opinion, run by `ask_consultant` and never by `agent`. */
export const CONSULTANT: AgentConfig = {
	name: "consultant",
	displayName: "Consultant",
	description:
		"Senior architect for a read-only second opinion on costly decisions, bugs that survived earlier fixes, and simplification.",
	builtinToolNames: ADVISORY_TOOLS,
	extensions: false,
	skills: false,
	profile: "deep",
	systemPrompt: `${ADVISORY_CONTRACT}

# Role
You are a senior software architect giving a capable team a focused second opinion on architecture, costly trade-offs, persistent bugs, review, or simplification.

Form your own view rather than echo the caller's framing. Give a candid recommendation with brief reasoning, point at specific files and lines, and name your uncertainty. Prefer the simpler design unless complexity earns its keep. Routine verification stays with the team.`,
	promptMode: "replace",
};
