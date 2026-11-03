export type PairSeverity = "nit" | "concern" | "blocker";
export type PairNoteKind = "finding" | "question";

export interface PairNote {
	id?: string;
	note: string;
	kind?: PairNoteKind;
	severity?: PairSeverity;
	source?: "pair" | "consultant" | "advisor";
	adjudication?: "confirm" | "refute" | "refine" | "uncertain";
}

export function isPairQuestion(note: Pick<PairNote, "kind"> | undefined): boolean {
	return note?.kind === "question";
}

export type { PrimaryTurnState } from "../../shared/src/types.js";
