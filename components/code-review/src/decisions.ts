import { type Static, Type } from "typebox";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const object = { additionalProperties: false } as const;
export const FindingResponseSchema = Type.Object(
	{
		disposition: Type.Union([
			Type.Literal("acknowledged"),
			Type.Literal("rejected"),
			Type.Literal("accepted-risk"),
			Type.Literal("fixed-claimed"),
			Type.Literal("fixed"),
		]),
		reason: text,
		evidence: Type.Array(text),
		scope: Type.Optional(text),
		verification: Type.Optional(Type.Object({ review: text, pass: text, question: text }, object)),
	},
	object,
);
export type FindingResponse = Static<typeof FindingResponseSchema>;
export interface VerifiedQuestion {
	review: string;
	digest: string;
	revision: number;
	attempt: string;
	validator: string;
	pass: string;
	question: string;
	evidence: string[];
}
interface DecisionRecord {
	id: string;
	review: string;
	digest: string;
	revision: number;
	actor: string;
	createdAt: number;
}
export interface FindingDecision extends DecisionRecord {
	kind: "finding";
	finding: string;
	data: FindingResponse & { verifiedAgainst: VerifiedQuestion | null };
}
export interface ReviewApproval extends DecisionRecord {
	kind: "approval";
	finding: null;
	data: { verdict: "approved" | "changes-requested" | "withdrawn"; note: string; limits: string[] };
}
export type ReviewDecision = FindingDecision | ReviewApproval;
