import { type Static, Type } from "typebox";
import { GitTargetSchema } from "../../shared/src/git-change.js";
import type { ReviewPlan } from "./contracts.js";
import { FindingResponseSchema } from "./decisions.js";
import type { ReviewArtifact, ReviewRequest } from "./types.js";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const object = { additionalProperties: false } as const;
export const ReviewRequestSchema = Type.Object(
	{
		cwd: text,
		target: GitTargetSchema,
		paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		intent: Type.Optional(
			Type.Union([Type.Object({ text }, object), Type.Object({ path: Type.String({ minLength: 1 }) }, object)]),
		),
		lenses: Type.Optional(Type.Array(text)),
	},
	object,
);
export const ReviewOperationSchema = Type.Union([
	Type.Object(
		{
			action: Type.Literal("enqueue"),
			request: ReviewRequestSchema,
			expectedDigest: Type.Optional(text),
			owner: Type.Optional(text),
			parent: Type.Optional(text),
		},
		object,
	),
	Type.Object({ action: Type.Literal("cancel"), review: text }, object),
	Type.Object({ action: Type.Literal("resume"), review: text }, object),
	Type.Object(
		{
			action: Type.Literal("extend"),
			review: text,
			revision: Type.Integer({ minimum: 0 }),
			digest: text,
			question: text,
			reason: text,
			doneWhen: text,
		},
		object,
	),
	Type.Object({ action: Type.Literal("priority"), review: text, priority: Type.Number() }, object),
	Type.Object({ action: Type.Literal("reassign"), review: text, owner: text }, object),
	Type.Object(
		{
			action: Type.Literal("finding"),
			review: text,
			revision: Type.Integer({ minimum: 0 }),
			digest: text,
			finding: text,
			response: FindingResponseSchema,
		},
		object,
	),
	Type.Object(
		{
			action: Type.Literal("approve"),
			review: text,
			revision: Type.Integer({ minimum: 0 }),
			digest: text,
			verdict: Type.Union([Type.Literal("approved"), Type.Literal("changes-requested"), Type.Literal("withdrawn")]),
			note: Type.String(),
			acceptLimits: Type.Boolean(),
		},
		object,
	),
]);
export type ReviewOperation = Static<typeof ReviewOperationSchema>;
export interface ReviewCommand {
	kind: "review";
	version: 1;
	operation: ReviewOperation;
}
export type ReviewState =
	| "capturing"
	| "queued"
	| "running"
	| "cancelling"
	| "cancelled"
	| "interrupted"
	| "failed"
	| "incomplete"
	| "completed"
	| "no-changes";
export interface ReviewJob {
	id: string;
	commandId: string;
	requester: string;
	owner: string;
	organization: string;
	originTask: string | null;
	parent: string | null;
	state: ReviewState;
	priority: number;
	generation: number;
	revision: number;
	planRevision: number;
	request: ReviewRequest;
	artifactDirectory: string;
	artifact: ReviewArtifact | null;
	plan: ReviewPlan | null;
	selectedAttempts: Record<string, string>;
	additionalWork: {
		id: string;
		actor: string;
		question: string;
		reason: string;
		doneWhen: string;
		createdAt: number;
	}[];
	reason: string | null;
	createdAt: number;
	updatedAt: number;
}
