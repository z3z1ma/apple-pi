import type {
	ConsultantConsultationUsage,
	ConsultantDisposition,
	ConsultationHypothesis,
	ConsultationSource,
	EvidencePointer,
} from "../../subagents/src/consultation.js";

export type PairSeverity = "nit" | "concern" | "blocker";

export interface PairNote {
	id?: string;
	note: string;
	severity?: PairSeverity;
	source?: "pair" | "consultant" | "advisor";
	adjudication?: ConsultantDisposition;
}

export type PairEscalation = ConsultationHypothesis;
export type PairEvidencePointer = EvidencePointer;

export type PairEscalationState =
	| "idle"
	| "escalation_pending"
	| "consultant_running"
	| "consultant_settled"
	| "delivery_pending"
	| "failed"
	| "cancelled";

export interface EscalationOutcome {
	id: string;
	source: ConsultationSource;
	disposition?: ConsultantDisposition;
	originalSeverity: "concern" | "blocker";
	finalSeverity?: "concern" | "blocker";
	delivered: boolean;
	stale: boolean;
	adoption: "unknown";
	validationOutcome: "unknown";
	status: "completed" | "failed" | "malformed" | "cancelled";
	usage: ConsultantConsultationUsage;
}

export type { PrimaryTurnState } from "../../shared/src/types.js";
