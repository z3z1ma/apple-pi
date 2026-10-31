import { type Static, Type } from "typebox";
import type { ReviewPlan } from "./contracts.js";
import type { ReviewArtifact, ReviewRequest } from "./types.js";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const object = { additionalProperties: false } as const;
export const ReviewTargetSchema = Type.Union([
	Type.Object({ kind: Type.Literal("working-tree"), base: text }, object),
	Type.Object({ kind: Type.Literal("staged") }, object),
	Type.Object({ kind: Type.Literal("commit"), commit: text, parent: Type.Optional(text) }, object),
	Type.Object({ kind: Type.Literal("range"), base: text, head: text }, object),
	Type.Object({ kind: Type.Literal("branch"), base: text, head: text }, object),
]);
export const ReviewRequestSchema = Type.Object(
	{
		cwd: text,
		target: ReviewTargetSchema,
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
			owner: Type.Optional(text),
			parent: Type.Optional(text),
		},
		object,
	),
	Type.Object({ action: Type.Literal("cancel"), review: text }, object),
	Type.Object({ action: Type.Literal("resume"), review: text }, object),
	Type.Object({ action: Type.Literal("priority"), review: text, priority: Type.Number() }, object),
	Type.Object({ action: Type.Literal("reassign"), review: text, owner: text }, object),
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
	| "completed";
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
	reason: string | null;
	createdAt: number;
	updatedAt: number;
}
