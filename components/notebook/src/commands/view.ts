import {
	type Entry,
	foldLedger,
	observationToSummaryLine,
	type Reflection,
	reflectionToSummaryLine,
} from "../session-ledger/index.js";

function renderList<T>(items: T[], render: (item: T) => string, empty: string): string {
	return items.length > 0 ? items.map(render).join("\n") : empty;
}

function renderConclusions(reflections: Reflection[], empty: string): string {
	return ["── Working conclusions ──", renderList(reflections, reflectionToSummaryLine, empty)].join("\n");
}

export function renderNotebookView(entries: Entry[], mode: "visible" | "full" = "visible"): string {
	const folded = foldLedger(entries);
	if (mode !== "full") return renderConclusions(folded.currentReflections, "No current working conclusions.");

	const retired = folded.reflections.filter((reflection) => folded.retiredReflectionIds.has(reflection.id));
	return [
		renderConclusions(folded.currentReflections, "No current working conclusions."),
		"",
		"── Retired conclusions ──",
		renderList(retired, reflectionToSummaryLine, "No retired conclusions."),
		"",
		"── Archived observations ──",
		renderList(folded.observations, observationToSummaryLine, "No archived observations."),
	].join("\n");
}
