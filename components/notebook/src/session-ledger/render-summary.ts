import type { Observation, Reflection } from "./types.js";

const CONTEXT_USAGE_INSTRUCTIONS = `You and your pair programming partner record learnings from this session here: things found out the hard way and what to do differently now. This live view replaces earlier notebook snapshots; historical notes remain available through source recall.

- Apply each learning to the work while it holds. Its id appears in brackets.
- Learnings last for this session only. Place each one where it improves future work once the user approves: a wiki page, the governing task's retrospective, AGENTS.md, a skill, a saved program in .pi/programs/, or a test or doc. Then retire it with update_notebook, and retire a learning that is not worth keeping.

When a learning is too compressed for an important decision, use revisit_note with its id to see the original source context. Use search_session to search earlier conversation or recover a file written during this session.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} [${observation.relevance}] ${observation.content}`;
}

export function reflectionToSummaryLine(reflection: Reflection): string {
	return `[${reflection.id}] ${reflection.content}`;
}

export function renderSummary(reflections: Reflection[]): string {
	if (reflections.length === 0) return "";

	return [CONTEXT_USAGE_INSTRUCTIONS, `## Learnings\n${reflections.map(reflectionToSummaryLine).join("\n")}`].join(
		"\n\n",
	);
}
