import type { Observation, Reflection } from "./types.js";

const CONTEXT_USAGE_INSTRUCTIONS = `Your pair programming partner keeps this sourced notebook for the current session. It has been restored after compaction so you can continue without carrying every detail in your immediate context.

- Reflections capture the current shared understanding of the user, project, decisions, constraints, completed outcomes, and pivots that still shape the work. Their ids appear in brackets.
- Observations preserve working evidence that still matters in detail. They are timestamped, chronological, and include ids in brackets.

Use the current understanding rather than replaying the notebook as a historical stack. When a newer observation conflicts with a reflection, the newer observation is the latest known state until the reflection is revised. Do not redo work that a current reflection or observation marks complete unless the user asks.

When a notebook entry is too compressed for an important decision, use revisit_note with its id to see the original source context. Do not revisit notes preemptively or inject raw source unless it is needed. Use search_session when you need to search earlier conversation or recover a file written during this session.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} [${observation.relevance}] ${observation.content}`;
}

export function reflectionToSummaryLine(reflection: Reflection): string {
	return `[${reflection.id}] ${reflection.content}`;
}

export function renderSummary(reflections: Reflection[], observations: Observation[]): string {
	if (reflections.length === 0 && observations.length === 0) return "";

	const parts: string[] = [CONTEXT_USAGE_INSTRUCTIONS];
	if (reflections.length > 0) {
		parts.push(`## Reflections\n${reflections.map(reflectionToSummaryLine).join("\n")}`);
	}
	if (observations.length > 0) {
		parts.push(`## Observations\n${observations.map(observationToSummaryLine).join("\n")}`);
	}
	return parts.join("\n\n");
}
