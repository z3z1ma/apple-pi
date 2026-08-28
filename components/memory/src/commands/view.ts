import {
	fullProjection,
	observationToSummaryLine,
	reflectionToSummaryLine,
	visibleProjection,
	type Entry,
	type Projection,
} from "../session-ledger/index.js";

function renderList<T>(items: T[], render: (item: T) => string, empty: string): string {
	return items.length > 0 ? items.map(render).join("\n") : empty;
}

export function renderContentOnlyProjection(projection: Projection, emptyScope: "visible" | "recorded"): string {
	return [
		"── Reflections ──",
		renderList(projection.reflections, reflectionToSummaryLine, `No ${emptyScope} reflections.`),
		"",
		"── Observations ──",
		renderList(projection.observations, observationToSummaryLine, `No ${emptyScope} observations.`),
	].join("\n");
}

export function renderMemoryView(entries: Entry[], mode: "visible" | "full" = "visible"): string {
	return mode === "full"
		? renderContentOnlyProjection(fullProjection(entries), "recorded")
		: renderContentOnlyProjection(visibleProjection(entries), "visible");
}
