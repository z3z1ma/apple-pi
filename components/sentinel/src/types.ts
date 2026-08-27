import type {
	ConsultationHypothesis,
	ConsultationSource,
	AdvisorConsultationUsage,
	AdvisorDisposition,
	EvidencePointer,
} from "../../subagents/src/consultation.js";

export type SentinelSeverity = "nit" | "concern" | "blocker";

export interface SentinelNote {
	note: string;
	severity?: SentinelSeverity;
	source?: "sentinel" | "advisor";
	adjudication?: AdvisorDisposition | "unadjudicated";
}

export type SentinelEscalation = ConsultationHypothesis;
export type SentinelEvidencePointer = EvidencePointer;

export type SentinelEscalationState =
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
