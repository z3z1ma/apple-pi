import { resolve } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sendCommand } from "../../session-state/src/client.js";
import {
	withReviews as database,
	readReview,
	readReviewPart,
	reviewQueue,
	reviewSummary,
} from "../../session-state/src/review-read.js";
import { FindingResponseSchema } from "./decisions.js";
import { type ReviewOperation, ReviewRequestSchema, ReviewTargetSchema } from "./operations.js";

const text = (description: string) => Type.String({ minLength: 1, description });
const page = {
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: Number.MAX_SAFE_INTEGER,
			description: "Requested page size. Omit for counts; there is no implicit detail-page budget.",
		}),
	),
	offset: Type.Optional(
		Type.Integer({
			minimum: 0,
			maximum: Number.MAX_SAFE_INTEGER,
			description: "Row offset; requires limit. Pages observe current state, not a frozen queue.",
		}),
	),
};
const request = Type.Optional(
	text(
		"Replay the exact earlier request using its returned handle. Changed arguments are refused. Omit for a new request.",
	),
);
const review = text(
	"A returned review ID, or the request handle of its admission. Access follows the recorded organization.",
);
const states = Type.Union([
	Type.Literal("capturing"),
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("cancelling"),
	Type.Literal("cancelled"),
	Type.Literal("interrupted"),
	Type.Literal("failed"),
	Type.Literal("incomplete"),
	Type.Literal("completed"),
	Type.Literal("no-changes"),
]);
const parts = Type.Union([
	Type.Literal("summary"),
	Type.Literal("target"),
	Type.Literal("plan"),
	Type.Literal("pass"),
	Type.Literal("findings"),
	Type.Literal("coverage"),
	Type.Literal("attempts"),
	Type.Literal("attempt"),
	Type.Literal("changes"),
	Type.Literal("regions"),
	Type.Literal("decisions"),
]);

function result(details: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }], details };
}

function requestId(self: string, callId: string, previous?: string): string {
	if (!previous) return `review:${self}:${callId}`;
	return database((db) => {
		if (
			!db
				.prepare("select 1 from commands where command_id = ? and session_id = ? and kind = 'review'")
				.get(previous, self)
		)
			throw new Error("Unknown review request handle for this caller; omit request to start new work");
		return previous;
	});
}

async function mutate(self: string, id: string, operation: ReviewOperation, signal?: AbortSignal) {
	database(() => true);
	let stage: string = "unknown";
	let reason: string | undefined;
	try {
		const receipt = await sendCommand(self, { kind: "review", version: 1, operation }, { commandId: id, signal });
		stage = receipt.stage;
		reason = receipt.reason;
	} catch (error) {
		reason = error instanceof Error ? error.message : String(error);
	}
	const recorded = database((db) => {
		const row = db
			.prepare("select stage, result from commands where command_id = ? and session_id = ?")
			.get(id, self) as { stage: string; result: string | null } | undefined;
		const pointer = row?.result ? (JSON.parse(row.result) as { review: string }) : null;
		return { recordedStage: row?.stage ?? null, review: pointer ? reviewSummary(db, self, pointer.review) : null };
	});
	const details = {
		request: id,
		stage,
		reason,
		...recorded,
		note: "An applied request confirms its mutation or target admission, not completed review work. Admitted jobs outlive the requesting connection; replay this handle to recover the original request.",
	};
	if (stage !== "applied") throw new Error(JSON.stringify(details, null, 2));
	return result(details);
}

export function installReviewTools(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "resolve_finding",
			label: "Respond to finding",
			description:
				"Append an accountable finding response to a settled captured assessment. Supply its current revision and digest from read_review. Rejection needs counterevidence; accepted risk needs evidence and explicit scope. A claimed fix remains unverified. Fixed requires a specific completed, unchallenged question on a different captured target and supporting evidence; this records your judgment, not a correctness certificate. A fix in later code never changes the original snapshot. Responses retain the original allegation and invalidate older assessment approval. Only the operator can approve code through sign-off.",
			promptSnippet: "Record finding responses with evidence, scope and explicit new-target fix verification.",
			parameters: Type.Object(
				{
					review,
					revision: Type.Integer({ minimum: 0 }),
					digest: text("Exact artifact digest from the current summary."),
					finding: text("Attempt-scoped finding ID from read_review."),
					response: FindingResponseSchema,
					request,
				},
				{ additionalProperties: false },
			),
			async execute(callId, params, signal, _update, ctx) {
				const self = ctx.sessionManager.getSessionId();
				return mutate(
					self,
					requestId(self, callId, params.request),
					{
						action: "finding",
						review: params.review,
						revision: params.revision,
						digest: params.digest,
						finding: params.finding,
						response: params.response,
					},
					signal,
				);
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "review_code",
			label: "Review code",
			description:
				"Capture an exact commit, range, branch, staged index or working tree and enqueue independent semantic/risk-based review through ordinary role peers. This starts model work under the configured role profiles. Return after target capture and admission, not after review. The author's index and checkout stay unchanged. Supply approved intent when available; absent intent stays unassessed. Use review_queue/read_review for progress and evidence. Exact request replay retains the original captured target even if the checkout changes.",
			promptSnippet: "Capture exact code and enqueue independent review; inspect its durable result separately.",
			promptGuidelines: [
				"For an already assigned review pass, inspect its captured source and return the requested report. Route additional questions to the plan owner through that report; the requester initiates new reviews.",
				"Use captured review evidence for its named artifact. Distinguish reported findings, coverage, incomplete work, current-checkout applicability and operator approval.",
				"Use the returned review ID for progress and the request handle for exact mutation recovery. An empty comparison/scope records no-changes without running reviewers. A failed, incomplete or no-changes review is not a clean-review claim.",
			],
			parameters: Type.Object(
				{
					target: ReviewTargetSchema,
					cwd: Type.Optional(text("Repository or worktree directory; defaults to the current session directory.")),
					paths: ReviewRequestSchema.properties.paths,
					intent: ReviewRequestSchema.properties.intent,
					lenses: ReviewRequestSchema.properties.lenses,
					owner: Type.Optional(
						text(
							"Existing lasting person's ID. Omit to own the review yourself; assigning another owner requires management authority.",
						),
					),
					parent: Type.Optional(
						text("Earlier review ID whose evidence this new capture follows; it grants no coverage credit."),
					),
					request,
				},
				{ additionalProperties: false },
			),
			async execute(callId, params, signal, _update, ctx) {
				const self = ctx.sessionManager.getSessionId();
				return mutate(
					self,
					requestId(self, callId, params.request),
					{
						action: "enqueue",
						owner: params.owner,
						parent: params.parent,
						request: {
							cwd: resolve(ctx.cwd, params.cwd ?? "."),
							target: params.target,
							paths: params.paths,
							intent: params.intent,
							lenses: params.lenses,
						},
					},
					signal,
				);
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "review_queue",
			label: "Review queue",
			description:
				"Inspect the durable review queue in your organization. Without limit, return state counts; with limit, return a page of meaningful status, coverage, findings and captured-target identity. Active work precedes queued priority/FIFO work and history. Completion is not approval or proof of correctness. These reads do not establish current-checkout freshness.",
			promptSnippet: "See review progress and incomplete work, with explicit detail paging.",
			parameters: Type.Object(
				{
					...page,
					state: Type.Optional(states),
					cwd: Type.Optional(text("Filter a recorded repository or requested worktree directory.")),
				},
				{ additionalProperties: false },
			),
			async execute(_callId, params, _signal, _update, ctx) {
				return result(
					database((db) =>
						reviewQueue(db, ctx.sessionManager.getSessionId(), {
							...params,
							cwd: params.cwd ? resolve(ctx.cwd, params.cwd) : undefined,
						}),
					),
				);
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "read_review",
			label: "Read review",
			description:
				"Read one captured review progressively. Summary separates execution, missing intent, question coverage and findings. Target gives captured source and Git revisions; use ordinary source tools there. Plan, changes, regions, findings, coverage and attempts return counts until limit is supplied. Pass requires its pass ID; attempt requires its attempt ID and exposes that retained input policy, raw result, observed turn usage and validated output. Original allegations and validation remain distinct. These reads establish neither freshness nor approval.",
			promptSnippet: "Inspect review scope, evidence and retained attempts without treating partial work as clean.",
			parameters: Type.Object(
				{
					review,
					part: Type.Optional(parts),
					pass: Type.Optional(text("Pass ID from the plan; required for part: pass.")),
					attempt: Type.Optional(
						text("Attempt ID from the attempts page or selected pass; required for part: attempt."),
					),
					...page,
				},
				{ additionalProperties: false },
			),
			async execute(_callId, params, _signal, _update, ctx) {
				return result(database((db) => readReviewPart(db, ctx.sessionManager.getSessionId(), params.review, params)));
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "manage_review",
			label: "Manage review",
			description:
				"Cancel unfinished review work and wait for guarded cleanup, explicitly resume interrupted/failed/incomplete work on the same verified artifact, reprioritize queued work, reassign responsibility, or rerun the original capture request as a new review linked to this one (owned by you unless owner is supplied). Resume checks current role/profile policy before reusing exact-input work. A changed policy or advisory catalog requires a new plan and fresh inspections; challenged or incomplete work also reruns. Rerun resolves mutable targets again and grants no old coverage credit. Extra questions still need a plan-owner decision; a resume is not a waiver.",
			promptSnippet: "Manage review responsibility, recovery and fresh reruns without recapturing silently.",
			parameters: Type.Object(
				{
					review,
					action: Type.Union([
						Type.Literal("cancel"),
						Type.Literal("resume"),
						Type.Literal("priority"),
						Type.Literal("reassign"),
						Type.Literal("rerun"),
					]),
					priority: Type.Optional(
						Type.Number({ description: "Queue priority; higher values precede lower ones. Required for priority." }),
					),
					owner: Type.Optional(text("Existing lasting person's ID; required for reassign, optional for rerun.")),
					request,
				},
				{ additionalProperties: false },
			),
			async execute(callId, params, signal, _update, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const job = database((db) => readReview(db, self, params.review));
				let operation: ReviewOperation;
				switch (params.action) {
					case "rerun":
						operation = { action: "enqueue", request: job.request, owner: params.owner ?? self, parent: job.id };
						break;
					case "priority":
						if (params.priority === undefined) throw new Error("Priority requires a priority value");
						operation = { action: "priority", review: job.id, priority: params.priority };
						break;
					case "reassign":
						if (!params.owner) throw new Error("Reassign requires an owner ID");
						operation = { action: "reassign", review: job.id, owner: params.owner };
						break;
					default:
						operation = { action: params.action, review: job.id };
				}
				return mutate(self, requestId(self, callId, params.request), operation, signal);
			},
		}),
	);
}
