import type {
	AdvisorConsultationUsage,
	AdvisorDisposition,
	ConsultationHypothesis,
	ConsultationSource,
	EvidencePointer,
} from "../../subagents/src/consultation.js";

export type PairSeverity = "nit" | "concern" | "blocker";

export interface PairNote {
	id?: string;
	note: string;
	severity?: PairSeverity;
	source?: "pair" | "advisor";
	adjudication?: AdvisorDisposition;
}

export type PairEscalation = ConsultationHypothesis;
export type PairEvidencePointer = EvidencePointer;

export type PairEscalationState =
	| "idle"
	| "escalation_pending"
	| "advisor_running"
	| "advisor_settled"
	| "delivery_pending"
	| "failed"
	| "cancelled";

export interface EscalationOutcome {
	id: string;
	source: ConsultationSource;
	disposition?: AdvisorDisposition;
	originalSeverity: "concern" | "blocker";
	finalSeverity?: "concern" | "blocker";
	delivered: boolean;
	stale: boolean;
	adoption: "unknown";
	validationOutcome: "unknown";
	status: "completed" | "failed" | "malformed" | "cancelled";
	usage: AdvisorConsultationUsage;
}

export type { PrimaryTurnState } from "../../shared/src/types.js";
