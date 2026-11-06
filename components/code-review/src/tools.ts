import { resolve } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sendCommand } from "../../session-state/src/client.js";
import {
	withReviews as database,
	readReview,
	readReviewFreshness,
	readReviewPart,
	readReviewSource,
	reviewAnalytics,
	reviewQueue,
	reviewSummary,
} from "../../session-state/src/review-read.js";
import { reviewWaitReturned, startReviewWait } from "../../session-state/src/review-waits.js";
import { GitTargetSchema } from "../../shared/src/git-change.js";
import { FindingResponseSchema } from "./decisions.js";
import { type ReviewOperation, ReviewRequestSchema } from "./operations.js";

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
	Type.Literal("source"),
	Type.Literal("configuration"),
	Type.Literal("freshness"),
	Type.Literal("plan"),
	Type.Literal("pass"),
	Type.Literal("findings"),
	Type.Literal("coverage"),
	Type.Literal("attempts"),
	Type.Literal("attempt"),
	Type.Literal("changes"),
	Type.Literal("regions"),
	Type.Literal("decisions"),
	Type.Literal("thread"),
	Type.Literal("log"),
]);

const wait = Type.Optional(
	Type.Boolean({
		description:
			"Block until the review settles, then return its summary and confirmed findings. A review usually takes 10 to 30 minutes, longer behind other queued reviews, and this call waits the whole time. Its milestone mail then arrives only as a pointer. Omit to keep working; mail reports each pass's findings and the outcome as they happen.",
	}),
);
const SETTLED = new Set(["completed", "incomplete", "failed", "cancelled", "no-changes", "interrupted"]);
const POLL_MS = 1000;

type Update = ((update: { content: { type: "text"; text: string }[]; details: undefined }) => void) | undefined;

async function settledReview(actor: string, review: string, signal: AbortSignal | undefined, update: Update) {
	const id = database((db) => readReview(db, actor, review)).id;
	const stop = startReviewWait(id);
	let shown = "";
	try {
		for (;;) {
			signal?.throwIfAborted();
			const job = database((db) => readReview(db, actor, id));
			if (SETTLED.has(job.state)) {
				reviewWaitReturned(id, job.generation);
				return database((db) => {
					const findings = readReviewPart(db, actor, id, { part: "findings", limit: Number.MAX_SAFE_INTEGER }) as {
						page: {
							rows: {
								id: string;
								finding: { severity: string; title: string; path: string; line: number };
								validation: { disposition: string } | null;
							}[];
						};
					};
					return {
						review: reviewSummary(db, actor, id),
						confirmed: findings.page.rows
							.filter((row) => row.validation?.disposition === "confirmed")
							.map((row) => ({
								finding: row.id,
								severity: row.finding.severity,
								title: row.finding.title,
								location: `${row.finding.path}:${row.finding.line}`,
							})),
						note: "Read evidence with read_review part findings; respond with resolve_finding. Completion is not approval.",
					};
				});
			}
			const summary = database((db) => reviewSummary(db, actor, id));
			const line = `Waiting for ${id}: ${summary.state}${summary.passes ? `, ${summary.passes.completed}/${summary.passes.required} passes` : ""}${summary.findings.confirmed ? `, ${summary.findings.confirmed} confirmed so far` : ""}`;
			if (line !== shown) {
				shown = line;
				update?.({ content: [{ type: "text", text: line }], details: undefined });
			}
			await new Promise<void>((done, fail) => {
				const timer = setTimeout(done, POLL_MS);
				signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						fail(signal.reason);
					},
					{ once: true },
				);
			});
		}
	} finally {
		stop();
	}
}

async function andWait(
	admitted: ReturnType<typeof result>,
	shouldWait: boolean | undefined,
	actor: string,
	signal: AbortSignal | undefined,
	update: Update,
) {
	const review = (admitted.details as { review: { id: string } | null }).review;
	if (!shouldWait || !review) return admitted;
	return result({ ...(admitted.details as object), settled: await settledReview(actor, review.id, signal, update) });
}

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
				"Respond to a finding of a settled review, with the revision and digest from read_review. Rejection needs counterevidence; accepted risk needs evidence and a scope. A claimed fix stays unverified; fixed needs a completed question on a newer captured target. The original allegation is kept, and only the operator approves code, through sign-off.",
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
				"Capture an exact Git change and queue independent review; starts model work, checkout unchanged. Supply approved intent. Returns after capture; owner gets plan, findings and outcome mail. Pass wait to block until settled. Prefer fresh temps; name workers only for changes they did not build or work on.",
			parameters: Type.Object(
				{
					target: GitTargetSchema,
					cwd: Type.Optional(text("Repository or worktree directory; defaults to the current session directory.")),
					paths: ReviewRequestSchema.properties.paths,
					intent: ReviewRequestSchema.properties.intent,
					lenses: ReviewRequestSchema.properties.lenses,
					workers: Type.Optional(
						Type.Array(text("Your organization's names/IDs; private forks inspect in order, then temps.")),
					),
					owner: Type.Optional(
						text(
							"Existing lasting person's ID. Omit to own the review yourself; assigning another owner requires management authority.",
						),
					),
					parent: Type.Optional(
						text("Earlier review ID whose evidence this new capture follows; it grants no coverage credit."),
					),
					request,
					wait,
				},
				{ additionalProperties: false },
			),
			async execute(callId, params, signal, update, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const admitted = await mutate(
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
							workers: params.workers,
						},
					},
					signal,
				);
				return andWait(admitted, params.wait, self, signal, update);
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "review_queue",
			label: "Review queue",
			description:
				"Inspect your organization's review queue: state counts without limit, or a page of status, coverage, findings and captured target with one. Completion is not approval or proof of correctness.",
			parameters: Type.Object(
				{
					...page,
					state: Type.Optional(states),
					cwd: Type.Optional(text("Filter a recorded repository or requested worktree directory.")),
					hideAddressed: Type.Optional(
						Type.Boolean({
							description:
								"Leave out settled reviews whose confirmed findings all have a response; they need nothing more from anyone.",
						}),
					),
					analytics: Type.Optional(
						Type.Boolean({
							description:
								"Return cost and yield instead of the queue: totals, by model, by phase and per review, from recorded usage.",
						}),
					),
				},
				{ additionalProperties: false },
			),
			async execute(_callId, { analytics, ...params }, _signal, _update, ctx) {
				const actor = ctx.sessionManager.getSessionId();
				const cwd = params.cwd ? resolve(ctx.cwd, params.cwd) : undefined;
				return result(
					database((db) =>
						analytics ? reviewAnalytics(db, actor, { cwd }) : reviewQueue(db, actor, { ...params, cwd }),
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
				"Read one captured review part by part. summary: execution, intent, coverage, findings and cost. freshness: rechecks the target and current checkout now. configuration, target: the captured instructions, source and revisions. source: the retained files on the before or after side (omit path to list; offsets are zero-based lines). plan, changes, regions, findings, coverage, attempts: counts until you give limit. pass and attempt need their id. thread: the review's mail. log: the running passes' recent transcript. No read establishes approval.",
			parameters: Type.Object(
				{
					review,
					part: Type.Optional(parts),
					path: Type.Optional(text("Captured repository-relative file path for part: source. Omit to list files.")),
					side: Type.Optional(
						Type.Union([Type.Literal("before"), Type.Literal("after")], {
							description: "Captured comparison side for part: source; defaults to after.",
						}),
					),
					pass: Type.Optional(text("Pass ID from the plan; required for part: pass.")),
					attempt: Type.Optional(
						text("Attempt ID from the attempts page or selected pass; required for part: attempt."),
					),
					...page,
					wait,
				},
				{ additionalProperties: false },
			),
			async execute(_callId, params, signal, update, ctx) {
				const actor = ctx.sessionManager.getSessionId();
				const { part } = params;
				if (params.wait) {
					const settled = await settledReview(actor, params.review, signal, update);
					if (!part || part === "summary") return result(settled);
				}
				if (part === "source") return result(await readReviewSource(actor, params.review, params, signal));
				if (part === "freshness") return result(await readReviewFreshness(actor, params.review, signal));
				return result(database((db) => readReviewPart(db, actor, params.review, { ...params, part })));
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "manage_review",
			label: "Manage review",
			description:
				"Manage a review: cancel unfinished work, resume interrupted, failed or incomplete work on the same artifact, change its queue priority, reassign it, rerun the original capture as a new linked review (fresh target, no inherited coverage), or extend it with one more concrete question, its reason and doneWhen evidence, bound to the current revision and digest. Resume and extend can start new model work.",
			parameters: Type.Object(
				{
					review,
					action: Type.Union([
						Type.Literal("cancel"),
						Type.Literal("resume"),
						Type.Literal("priority"),
						Type.Literal("reassign"),
						Type.Literal("rerun"),
						Type.Literal("extend"),
					]),
					priority: Type.Optional(
						Type.Number({ description: "Queue priority; higher values precede lower ones. Required for priority." }),
					),
					owner: Type.Optional(text("Existing lasting person's ID; required for reassign, optional for rerun.")),
					revision: Type.Optional(
						Type.Integer({ minimum: 0, description: "Current assessment revision; required for extend." }),
					),
					digest: Type.Optional(text("Captured target digest; required for extend.")),
					question: Type.Optional(text("Concrete additional review question; required for extend.")),
					reason: Type.Optional(text("Why additional work is justified; required for extend.")),
					doneWhen: Type.Optional(text("Evidence that settles this question; required for extend.")),
					request,
					wait,
				},
				{ additionalProperties: false },
			),
			async execute(callId, params, signal, update, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const job = database((db) => readReview(db, self, params.review));
				let operation: ReviewOperation;
				switch (params.action) {
					case "rerun":
						operation = { action: "enqueue", request: job.request, owner: params.owner ?? self, parent: job.id };
						break;
					case "extend":
						if (
							params.revision === undefined ||
							!params.digest ||
							!params.question ||
							!params.reason ||
							!params.doneWhen
						)
							throw new Error("Extend requires revision, digest, question, reason and doneWhen");
						operation = {
							action: "extend",
							review: job.id,
							revision: params.revision,
							digest: params.digest,
							question: params.question,
							reason: params.reason,
							doneWhen: params.doneWhen,
						};
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
				const applied = await mutate(self, requestId(self, callId, params.request), operation, signal);
				return andWait(applied, params.wait, self, signal, update);
			},
		}),
	);
}
