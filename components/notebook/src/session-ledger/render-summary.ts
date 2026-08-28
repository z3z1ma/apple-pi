import type { Observation, Reflection } from "./types.js";

const CONTEXT_USAGE_INSTRUCTIONS = `This is the Pair Programmer's notebook for the current session, restored after compaction.

- Reflections: current law. Binding facts about the user, project, decisions, constraints, completed outcomes, and still-constraining pivots. Reflection lines include ids in brackets.
- Observations: working evidence still needed as detail. Timestamped, in chronological order, with ids in brackets.

Honor current law. Do not replay this list as a historical stack. When current law and a newer observation conflict, the newer observation is the latest known state until law is updated. Work that current law or a current observation marks completed must not be redone unless the user asks.

When exact source context is needed for precision or traceability, use notebook_source with the relevant observation or reflection id. This is especially useful when a reflection materially affects a decision or is too compressed to continue confidently. Do not use notebook_source as broad search or inject raw source unless it is needed. To search this session's transcript or recover a file written earlier, use session_search.`;

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
