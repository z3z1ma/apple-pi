export type AdvisorSeverity = "nit" | "concern" | "blocker";

export interface AdvisorNote {
	note: string;
	severity?: AdvisorSeverity;
}

export type { PrimaryTurnState } from "../../shared/src/types.js";
