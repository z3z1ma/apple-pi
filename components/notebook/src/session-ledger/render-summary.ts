import type { Observation, Reflection } from "./types.js";

const CONTEXT_USAGE_INSTRUCTIONS = `You and your pair programming partner curate these current working conclusions. This live view replaces earlier notebook snapshots; historical notes remain available through source recall.

- Working conclusions are revisable, scoped understandings that should still change how you proceed. Their ids appear in brackets.
- User direction and current evidence take precedence. An empty notebook is a successful outcome.

Use a conclusion only while it still applies. When a notebook entry is too compressed for an important decision, use revisit_note with its id to see the original source context. Retrieve evidence when it can change the decision. Use search_session when you need to search earlier conversation or recover a file written during this session. You and your partner can add, supersede, or retire conclusions with update_notebook.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} [${observation.relevance}] ${observation.content}`;
}

export function reflectionToSummaryLine(reflection: Reflection): string {
	return `[${reflection.id}] ${reflection.content}`;
}

export function renderSummary(reflections: Reflection[]): string {
	if (reflections.length === 0) return "";

	return [
		CONTEXT_USAGE_INSTRUCTIONS,
		`## Working conclusions\n${reflections.map(reflectionToSummaryLine).join("\n")}`,
	].join("\n\n");
}
