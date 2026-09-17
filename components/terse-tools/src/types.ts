export type ToolStatus = "running" | "success" | "error";

export interface DiffLine {
	type: "added" | "removed" | "context";
	content: string;
}

export interface EditDiffSummary {
	added: number;
	removed: number;
	lines: DiffLine[];
}
