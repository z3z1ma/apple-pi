import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { captureIntent, readCapturedSource } from "../../code-review/src/capture.js";
import { type FindingValidation, findingKey, planPasses, type ReviewReport } from "../../code-review/src/contracts.js";
import type { FindingDecision, ReviewApproval, ReviewDecision } from "../../code-review/src/decisions.js";
import type { ReviewJob, ReviewState } from "../../code-review/src/operations.js";
import { configurationSummary, reviewConfiguration, reviewRolePolicy } from "../../code-review/src/policy.js";
import type {
	ReviewAssessment,
	ReviewAttempt,
	ReviewQueue,
	ReviewSource,
	ReviewSummary,
} from "../../code-review/src/results.js";
import { type GitTarget, openGitChange } from "../../shared/src/git-change.js";
import { nameOf, withThreads } from "./threads.js";
import { rootOf } from "./tree.js";

const columns = `id, command_id as commandId, requester, owner, organization, origin_task as originTask,
 parent, state, priority, generation, revision, plan_revision as planRevision, request,
 artifact_directory as artifactDirectory, artifact, plan, selected_attempts as selectedAttempts, additional_work as additionalWork,
 reason, created_at as createdAt, updated_at as updatedAt`;
type StoredJob = Omit<ReviewJob, "request" | "artifact" | "plan" | "selectedAttempts" | "additionalWork"> & {
	request: string;
	artifact: string | null;
	plan: string | null;
	selectedAttempts: string;
	additionalWork: string;
};

function organization(db: DatabaseSync, actor: string): string | null {
	if (actor === "operator") return null;
	if (!db.prepare("select 1 from sessions where id = ? and kind = 'root' and retired_at is null").get(actor))
		throw new Error("Review reading needs a current person");
	return rootOf(db, actor);
}

export function readReview(db: DatabaseSync, actor: string, id: string): ReviewJob {
	const scope = organization(db, actor);
	let row = db.prepare(`select ${columns} from review_jobs where id = ?`).get(id) as StoredJob | undefined;
	if (!row) {
		const command = db.prepare("select result from commands where command_id = ? and kind = 'review'").get(id) as
			| { result: string | null }
			| undefined;
		const pointer = command?.result ? (JSON.parse(command.result) as { review: string }) : null;
		if (pointer)
			row = db.prepare(`select ${columns} from review_jobs where id = ?`).get(pointer.review) as StoredJob | undefined;
	}
	if (!row) throw new Error(`Unknown or not yet admitted review: ${id}`);
	if (scope && rootOf(db, row.organization) !== scope) throw new Error("The review belongs to another organization");
	return {
		...row,
		request: JSON.parse(row.request),
		artifact: row.artifact ? JSON.parse(row.artifact) : null,
		plan: row.plan ? JSON.parse(row.plan) : null,
		selectedAttempts: JSON.parse(row.selectedAttempts),
		additionalWork: JSON.parse(row.additionalWork),
	};
}

export function reviewAttempt(db: DatabaseSync, actor: string, review: string, id: string): ReviewAttempt {
	const job = readReview(db, actor, review);
	return attemptRecord(db, job.id, id);
}

function attemptRecord(db: DatabaseSync, review: string, id: string): ReviewAttempt {
	const row = db
		.prepare(
			`select id, review_id as review, generation, plan_revision as planRevision, pass_id as pass, kind, person, role, state, model, thinking, session_file as sessionFile, input, policy, reuse_blocked_by as reuseBlockedBy, result, output, reason, created_at as createdAt, finished_at as finishedAt from review_attempts where review_id = ? and id = ?`,
		)
		.get(review, id) as
		| (Omit<ReviewAttempt, "input" | "policy" | "result" | "output"> & {
				input: string;
				policy: string;
				result: string | null;
				output: string | null;
		  })
		| undefined;
	if (!row) throw new Error(`Unknown review attempt: ${id}`);
	return {
		...row,
		input: JSON.parse(row.input),
		policy: JSON.parse(row.policy),
		result: row.result ? JSON.parse(row.result) : null,
		output: row.output ? JSON.parse(row.output) : null,
	};
}

export function reviewAssessment(db: DatabaseSync, actor: string, id: string): ReviewAssessment {
	return snapshot(db, () => {
		const job = readReview(db, actor, id);
		const selected = (pass: string, kind: ReviewAttempt["kind"]): ReviewAttempt | null => {
			if (!Object.hasOwn(job.selectedAttempts, pass)) return null;
			const attemptId = job.selectedAttempts[pass];
			const attempt = attemptRecord(db, job.id, attemptId);
			if (
				attempt.state !== "completed" ||
				attempt.pass !== pass ||
				attempt.kind !== kind ||
				attempt.output?.artifact !== job.artifact?.digest
			)
				throw new Error(`Selected attempt is not a completed result for ${pass}`);
			return attempt;
		};
		const passes = (job.plan ? planPasses(job.plan) : []).map((pass) => {
			const attempt = selected(pass.id, pass.kind);
			return { pass, attempt, report: (attempt?.output as ReviewReport | null) ?? null };
		});
		const validator = selected("validator", "validation");
		const validation = validator ? { attempt: validator, report: validator.output as FindingValidation } : null;
		const decisions = db
			.prepare(
				"select id, review_id as review, digest, revision, actor, kind, finding, data, created_at as createdAt from review_decisions where review_id = ? order by created_at, rowid",
			)
			.all(job.id)
			.map((row) => ({ ...row, data: JSON.parse(row.data as string) })) as unknown as ReviewDecision[];
		const findings = passes.flatMap(({ pass, attempt, report }) =>
			(report?.findings ?? []).map((finding) => ({
				id: findingKey(attempt!.id, finding.id),
				attempt: attempt!.id,
				pass: pass.id,
				finding,
				decision:
					decisions.findLast(
						(decision): decision is FindingDecision =>
							decision.kind === "finding" &&
							decision.finding === findingKey(attempt!.id, finding.id) &&
							decision.digest === job.artifact?.digest,
					) ?? null,
				validation:
					validation?.report.findings.find((entry) => entry.finding === findingKey(pass.id, finding.id)) ?? null,
			})),
		);
		return { job, passes, validation, findings, decisions };
	});
}

export function withReviews<T>(read: (db: DatabaseSync) => T): T {
	const value = withThreads((db) => {
		if (!db.prepare("select 1 from pragma_table_info('review_jobs') where name = 'additional_work'").get())
			throw new Error(
				"The review store is unavailable. Ask the operator to update the session-state runtime before using reviews.",
			);
		return snapshot(db, () => read(db));
	});
	if (value === undefined) throw new Error("The session-state review store is unavailable.");
	return value;
}

function reviewCost(db: DatabaseSync, review: string): ReviewSummary["cost"] {
	const attempts = db
		.prepare("select result -> '$.usage.cost.total' as cost from review_attempts where review_id = ?")
		.all(review);
	const reported = attempts.flatMap((row) => {
		const cost: unknown = row.cost === null ? undefined : JSON.parse(row.cost as string);
		return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? [cost] : [];
	});
	const total = reported.reduce((sum, cost) => sum + cost, 0);
	return {
		reportedDollars: Number.isFinite(total) && (reported.length || !attempts.length) ? total : null,
		reportedAttempts: reported.length,
		totalAttempts: attempts.length,
	};
}

export function reviewSummary(db: DatabaseSync, actor: string, id: string): ReviewSummary {
	return snapshot(db, () => {
		const { job, passes, findings, validation, decisions } = reviewAssessment(db, actor, id);
		const approval = decisions.findLast((decision): decision is ReviewApproval => decision.kind === "approval");
		const coverage = passes.map(({ pass, report }) => ({
			required: pass.questions.length,
			completed: pass.questions.filter(
				(question) =>
					report?.coverage.some((entry) => entry.question === question.id && entry.state === "completed") &&
					!validation?.report.coverageGaps.some((gap) => gap.pass === pass.id && gap.question === question.id),
			).length,
		}));
		const phase = db
			.prepare(
				"select kind, state, pass_id as pass from review_attempts where review_id = ? and generation = ? and state in ('starting', 'running', 'cleaning') order by created_at desc, rowid desc limit 1",
			)
			.get(job.id, job.generation) as ReviewSummary["phase"] | undefined;
		return {
			id: job.id,
			owner: job.owner,
			ownerName: nameOf(db, job.owner),
			summary: job.plan?.summary ?? null,
			state: job.state,
			phase: phase ?? null,
			priority: job.priority,
			revision: job.revision,
			cwd: job.artifact?.repository ?? job.request.cwd,
			target: job.request.target,
			digest: job.artifact?.digest ?? null,
			intent: job.artifact?.intent ? "captured" : "not-assessed",
			chunks: job.plan?.chunks.length ?? null,
			passes: job.plan
				? { completed: coverage.filter((entry) => entry.completed === entry.required).length, required: passes.length }
				: null,
			coverage: job.plan
				? {
						completedQuestions: coverage.reduce((sum, entry) => sum + entry.completed, 0),
						requiredQuestions: coverage.reduce((sum, entry) => sum + entry.required, 0),
						unassignedRegions: job.plan.gaps.length,
						additionalRequests: passes.reduce((sum, { report }) => sum + (report?.extraPasses.length ?? 0), 0),
					}
				: null,
			cost: reviewCost(db, job.id),
			findings: {
				reported: findings.length,
				confirmed: findings.filter(({ validation }) => validation?.disposition === "confirmed").length,
				unresolved: findings.filter(({ validation }) => !validation || validation.disposition === "unresolved").length,
			},
			approval: approval
				? {
						record: approval,
						matchesAssessment: approval.revision === job.revision && approval.digest === job.artifact?.digest,
					}
				: null,
			reason: job.reason,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
		};
	});
}

export function reviewQueue(
	db: DatabaseSync,
	actor: string,
	options: { limit?: number; offset?: number; state?: ReviewState; cwd?: string; around?: string } = {},
): ReviewQueue {
	if (options.offset !== undefined && options.limit === undefined) throw new Error("A page offset requires a limit");
	if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
		throw new Error("limit must be a positive safe integer");
	if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))
		throw new Error("offset must be a non-negative safe integer");
	return snapshot(db, () => {
		const scope = organization(db, actor);
		const where: string[] = [];
		const args: SQLInputValue[] = [];
		if (scope) {
			const roots = (db.prepare("select distinct organization from review_jobs").all() as { organization: string }[])
				.filter((row) => rootOf(db, row.organization) === scope)
				.map((row) => row.organization);
			where.push(`organization in (${roots.map(() => "?").join(",")})`);
			args.push(...roots);
		}
		if (options.state) {
			where.push("state = ?");
			args.push(options.state);
		}
		if (options.cwd) {
			where.push("(json_extract(artifact, '$.repository') = ? or json_extract(request, '$.cwd') = ?)");
			args.push(options.cwd, options.cwd);
		}
		const filter = where.length ? `where ${where.join(" and ")}` : "";
		const groups = db
			.prepare(`select state, count(*) as count from review_jobs ${filter} group by state`)
			.all(...args) as { state: ReviewState; count: number }[];
		const total = groups.reduce((sum, row) => sum + row.count, 0);
		const states = Object.fromEntries(groups.map((row) => [row.state, row.count]));
		if (options.limit === undefined) return { total, states, page: null };
		const order =
			"case when state in ('capturing', 'running', 'cancelling') then 0 when state = 'queued' then 1 else 2 end, case when state = 'queued' then priority end desc, case when state = 'queued' then created_at end asc, case when state = 'queued' then rowid end asc, updated_at desc, rowid desc";
		let offset = options.offset ?? 0;
		if (options.around) {
			const position = db
				.prepare(
					`select position from (select id, row_number() over (order by ${order}) - 1 as position from review_jobs ${filter}) where id = ?`,
				)
				.get(...args, options.around) as { position: number } | undefined;
			if (position) offset = Math.floor(position.position / options.limit) * options.limit;
		}
		const rows = db
			.prepare(`select id from review_jobs ${filter} order by ${order} limit ? offset ?`)
			.all(...args, options.limit, offset) as { id: string }[];
		return {
			total,
			states,
			page: {
				offset,
				nextOffset: offset + rows.length < total ? offset + rows.length : null,
				rows: rows.map(({ id }) => reviewSummary(db, actor, id)),
			},
		};
	});
}

export interface ReviewReadOptions {
	part?:
		| "summary"
		| "configuration"
		| "target"
		| "plan"
		| "pass"
		| "findings"
		| "coverage"
		| "attempts"
		| "attempt"
		| "changes"
		| "regions"
		| "decisions";
	pass?: string;
	attempt?: string;
	limit?: number;
	offset?: number;
}

export type ReviewStore = <T>(read: (db: DatabaseSync) => T) => T;

export async function readReviewFreshness(
	actor: string,
	id: string,
	signal?: AbortSignal,
	store: ReviewStore = withReviews,
) {
	const { job, policies } = store((db) => {
		const job = readReview(db, actor, id);
		const policies = Object.values(job.selectedAttempts).map((attempt) => {
			const row = db
				.prepare("select role, policy from review_attempts where id = ? and review_id = ?")
				.get(attempt, job.id) as { role: string; policy: string } | undefined;
			return row;
		});
		return { job, policies };
	});
	const artifact = job.artifact;
	if (!artifact) throw new Error("The review has no captured target");
	const errors: string[] = [];
	type Match = "matches" | "changed" | "unavailable";
	let requestedTarget: Match = "unavailable";
	let checkout: Match = "unavailable";
	let policy: Match = "unavailable";
	try {
		// Every captured comparison, region and file list derives from these Git identities and the intent bytes.
		const identity = async (target: GitTarget) => {
			const change = await openGitChange(job.request.cwd, target, { signal });
			await change.close();
			return change;
		};
		const current = await identity(job.request.target);
		const intent = job.request.intent ? (await captureIntent(job.request))?.hash : undefined;
		if (artifact.configuration)
			requestedTarget =
				current.baseCommit === artifact.baseCommit &&
				current.headCommit === artifact.headCommit &&
				current.baseTree === artifact.baseTree &&
				current.headTree === artifact.headTree &&
				(typeof artifact.index !== "string" || current.indexTree === artifact.index) &&
				intent === artifact.intent?.hash &&
				// Captured configuration reads project roles from the live checkout here, not from the target tree.
				JSON.stringify(reviewConfiguration(current.repository)) === JSON.stringify(artifact.configuration)
					? "matches"
					: "changed";
		else errors.push("Capture-time configuration is absent; complete target identity cannot be compared.");
		const working =
			job.request.target.kind === "working-tree" ? current : await identity({ kind: "working-tree", base: "HEAD" });
		checkout =
			working.headTree === artifact.headTree && working.headCommit === artifact.headCommit ? "matches" : "changed";
	} catch (error) {
		if (signal?.aborted) throw error;
		errors.push(`Live source: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		if (artifact.configuration) {
			policy =
				JSON.stringify(reviewConfiguration(artifact.source)) === JSON.stringify(artifact.configuration) &&
				policies.every((row) => row && JSON.stringify(reviewRolePolicy(artifact.source, row.role)) === row.policy)
					? "matches"
					: "changed";
		} else errors.push("Capture-time review policy was not recorded.");
	} catch (error) {
		errors.push(`Review policy: ${error instanceof Error ? error.message : String(error)}`);
	}
	return {
		review: job.id,
		revision: job.revision,
		artifact: artifact.digest,
		requestedTarget,
		checkout,
		policy,
		checkedAt: Date.now(),
		errors,
		note: "Point-in-time observation, not approval or an atomic filesystem snapshot. Requested comparison and current checkout are distinct; external resources and ambient instructions are not frozen. Recheck before relying on applicability.",
	};
}

export async function readReviewSource(
	actor: string,
	id: string,
	options: { path?: string; side?: "before" | "after"; limit?: number; offset?: number } = {},
	signal?: AbortSignal,
	store: ReviewStore = withReviews,
): Promise<ReviewSource> {
	const job = store((db) => readReview(db, actor, id));
	if (!job.artifact) throw new Error("The review has no captured source");
	page([], options);
	const source = await readCapturedSource(job.artifact, options, signal);
	const identity = {
		review: job.id,
		revision: job.revision,
		artifact: source.artifact,
		side: source.side,
		tree: source.tree,
		note: "Retained Git objects; this does not verify the materialized file copy or the live checkout.",
	};
	if (source.kind === "files") return { ...identity, kind: source.kind, ...page(source.files, options) };
	const lines = source.text === null ? null : source.text === "" ? [] : source.text.split("\n");
	if (source.text?.endsWith("\n")) lines!.pop();
	const representations = {
		text: "Text from the captured blob.",
		binary: "Binary bytes; text is not shown.",
		symlink: "Link target text only; the link is not followed.",
		submodule: "Commit pointer only; submodule contents are not captured.",
		lfs: "LFS pointer text only; the referenced contents are not captured.",
	};
	return {
		...identity,
		kind: source.kind,
		file: source.file,
		bytes: source.bytes,
		representation: representations[source.file.content],
		...(lines === null ? { total: null, page: null } : page(lines, options)),
	};
}

export function readReviewPart(db: DatabaseSync, actor: string, id: string, options: ReviewReadOptions = {}): unknown {
	return snapshot(db, () => {
		const job = readReview(db, actor, id);
		switch (options.part ?? "summary") {
			case "summary":
				return reviewSummary(db, actor, id);
			case "target": {
				const artifact = job.artifact;
				return {
					review: job.id,
					revision: job.revision,
					target: artifact
						? {
								digest: artifact.digest,
								repository: artifact.repository,
								source: artifact.source,
								requested: artifact.request,
								base: artifact.baseCommit,
								head: artifact.headCommit,
								baseTree: artifact.baseTree,
								headTree: artifact.headTree,
								baseRevision: artifact.baseRevision,
								headRevision: artifact.headRevision,
								intent: artifact.intent,
								configuration: configurationSummary(artifact.configuration),
								files: artifact.files.length,
								regions: artifact.regions.length,
								omissions: page(artifact.omissions, options),
							}
						: null,
					reason: job.reason,
				};
			}
			case "configuration":
				return {
					review: job.id,
					revision: job.revision,
					configuration: job.artifact?.configuration ?? null,
					note: "Captured review prompts and configured model references; actual role/model policy belongs to each attempt. Ambient instructions and external resources are not a frozen environment.",
				};
			case "plan":
				return {
					review: job.id,
					revision: job.planRevision,
					summary: job.plan?.summary ?? null,
					planner: job.selectedAttempts.planner ?? null,
					integration: job.plan?.integration ?? null,
					gaps: job.plan?.gaps ?? [],
					additionalWork: job.additionalWork,
					chunks: page(job.plan?.chunks ?? [], options),
				};
			case "changes":
				return page(job.artifact?.changes ?? [], options);
			case "regions":
				return page(job.artifact?.regions ?? [], options);
			case "attempt": {
				if (!options.attempt) throw new Error("The attempt part requires an attempt ID");
				return attemptRecord(db, job.id, options.attempt);
			}
			case "attempts": {
				const rows = db
					.prepare(
						"select id, pass_id as pass, kind, role, state, model, thinking, reason, json_extract(result, '$.usage') as usage, reuse_blocked_by as reuseBlockedBy, output is not null as hasOutput, created_at as createdAt, finished_at as finishedAt from review_attempts where review_id = ? order by created_at, rowid",
					)
					.all(job.id) as { id: string; usage: string | null; hasOutput: number }[];
				return page(
					rows.map((row) => ({
						...row,
						usage: row.usage ? JSON.parse(row.usage) : null,
						hasOutput: Boolean(row.hasOutput),
						selected: Object.values(job.selectedAttempts).includes(row.id),
					})),
					options,
				);
			}
			case "pass": {
				if (!options.pass) throw new Error("The pass part requires a pass ID");
				const entry = reviewAssessment(db, actor, id).passes.find((entry) => entry.pass.id === options.pass);
				if (!entry) throw new Error(`Unknown review pass: ${options.pass}`);
				return {
					...entry,
					attempt: entry.attempt
						? {
								id: entry.attempt.id,
								state: entry.attempt.state,
								role: entry.attempt.role,
								model: entry.attempt.model,
								thinking: entry.attempt.thinking,
							}
						: null,
				};
			}
			case "findings":
				return page(reviewAssessment(db, actor, id).findings, options);
			case "decisions":
				return page(reviewAssessment(db, actor, id).decisions, options);
			case "coverage": {
				const assessment = reviewAssessment(db, actor, id);
				return page(
					assessment.passes.flatMap(({ pass, report }) =>
						pass.questions.map((question) => {
							const reported = report?.coverage.find((entry) => entry.question === question.id) ?? null;
							const challenge =
								assessment.validation?.report.coverageGaps.find(
									(gap) => gap.pass === pass.id && gap.question === question.id,
								) ?? null;
							return {
								pass: pass.id,
								question,
								state: challenge ? "challenged" : (reported?.state ?? "pending"),
								reported,
								challenge,
							};
						}),
					),
					options,
				);
			}
			default:
				throw new Error("Unknown review part");
		}
	});
}

function page<T>(rows: T[], options: { limit?: number; offset?: number }) {
	if (options.offset !== undefined && options.limit === undefined) throw new Error("A page offset requires a limit");
	if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
		throw new Error("limit must be a positive safe integer");
	if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))
		throw new Error("offset must be a non-negative safe integer");
	if (options.limit === undefined) return { total: rows.length, page: null };
	const offset = options.offset ?? 0;
	const selected = rows.slice(offset, offset + options.limit);
	return {
		total: rows.length,
		page: {
			offset,
			nextOffset: offset + selected.length < rows.length ? offset + selected.length : null,
			rows: selected,
		},
	};
}

function snapshot<T>(db: DatabaseSync, read: () => T): T {
	const owned = !db.isTransaction;
	if (owned) db.exec("begin");
	try {
		return read();
	} finally {
		if (owned) db.exec("rollback");
	}
}
