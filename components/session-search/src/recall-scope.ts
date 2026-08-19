export type RecallScope = "lineage" | "all";
export type RecallMode = "history" | "file" | "touched";

export const normalizeRecallScope = (scope?: unknown): RecallScope => {
	if (typeof scope !== "string") return "lineage";
	return scope.toLowerCase() === "all" ? "all" : "lineage";
};

export const normalizeRecallMode = (mode?: unknown): RecallMode =>
	mode === "file" || mode === "touched" ? mode : "history";
