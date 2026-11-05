import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { captureIntent, readCapturedSource } from "../../code-review/src/capture.js";
import {
	chunkRegions,
	type FindingValidation,
	findingKey,
	planPasses,
	REVIEW_PASS_CONCURRENCY,
	type ReviewReport,
	unscopedRegions,
} from "../../code-review/src/contracts.js";
import type { FindingDecision, ReviewApproval, ReviewDecision } from "../../code-review/src/decisions.js";
import type { ReviewJob, ReviewState } from "../../code-review/src/operations.js";
import {
	configurationSummary,
	type ReviewDepth,
	reviewConfiguration,
	reviewRolePolicy,
} from "../../code-review/src/policy.js";
import type {
	ReviewAnalytics,
	ReviewAssessment,
	ReviewAttempt,
	ReviewAttemptLog,
	ReviewLogEntry,
	ReviewQueue,
	ReviewSource,
	ReviewSummary,
	ReviewThreadMessage,
} from "../../code-review/src/results.js";
import { type GitChange, openGitChange } from "../../shared/src/git-change.js";
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
		const passes = (job.plan ? planPasses(job.plan, job.artifact?.regions ?? []) : []).map((pass) => {
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

const SETTLED: readonly ReviewState[] = ["completed", "incomplete", "failed", "cancelled", "no-changes", "interrupted"];
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

function reviewCost(db: DatabaseSync, review: string): ReviewSummary["cost"] {
	const attempts = db
		.prepare(
			"select result -> '$.usage.cost.total' as cost, result -> '$.usage' as usage from review_attempts where review_id = ?",
		)
		.all(review);
	const tokens = { input: 0, output: 0, cacheRead: 0 };
	for (const row of attempts) {
		const usage = row.usage === null ? undefined : (JSON.parse(row.usage as string) as Record<string, unknown> | null);
		tokens.input += count(usage?.input);
		tokens.output += count(usage?.output);
		tokens.cacheRead += count(usage?.cacheRead);
	}
	const reported = attempts.flatMap((row) => {
		const cost: unknown = row.cost === null ? undefined : JSON.parse(row.cost as string);
		return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? [cost] : [];
	});
	const total = reported.reduce((sum, cost) => sum + cost, 0);
	return {
		reportedDollars: Number.isFinite(total) && (reported.length || !attempts.length) ? total : null,
		reportedAttempts: reported.length,
		totalAttempts: attempts.length,
		tokens,
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
		const confirmed = findings.filter(({ validation }) => validation?.disposition === "confirmed");
		const responded = confirmed.filter(({ decision }) => decision).length;
		const settledAt = SETTLED.includes(job.state)
			? ((
					db.prepare("select max(finished_at) as at from review_attempts where review_id = ?").get(job.id) as {
						at: number | null;
					}
				).at ?? job.updatedAt)
			: null;
		return {
			id: job.id,
			owner: job.owner,
			ownerName: nameOf(db, job.owner),
			label: {
				repository: (job.artifact?.repository ?? job.request.cwd).split(/[\\/]/).at(-1) ?? "",
				branch: job.artifact?.label?.branch ?? null,
				head: job.artifact?.headCommit ?? null,
				subject: job.artifact?.label?.subject ?? null,
				commits: job.artifact?.label?.commits ?? null,
				files: job.artifact?.changes.length ?? null,
			},
			addressed: ["completed", "no-changes", "cancelled"].includes(job.state) && responded === confirmed.length,
			settledAt,
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
						unassignedRegions: job.plan.gaps?.length ?? 0,
						integrationOnlyRegions: job.plan.gaps ? 0 : unscopedRegions(job.plan, job.artifact?.regions ?? []).length,
						additionalRequests: passes.reduce((sum, { report }) => sum + (report?.extraPasses.length ?? 0), 0),
					}
				: null,
			cost: reviewCost(db, job.id),
			findings: {
				reported: findings.length,
				confirmed: confirmed.length,
				unresolved: findings.filter(({ validation }) => !validation || validation.disposition === "unresolved").length,
				responded,
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

function scopeClause(db: DatabaseSync, actor: string): { where: string[]; args: SQLInputValue[] } {
	const scope = organization(db, actor);
	if (!scope) return { where: [], args: [] };
	const roots = (db.prepare("select distinct organization from review_jobs").all() as { organization: string }[])
		.filter((row) => rootOf(db, row.organization) === scope)
		.map((row) => row.organization);
	return { where: [`organization in (${roots.map(() => "?").join(",")})`], args: roots };
}

export function reviewStates(db: DatabaseSync, actor: string): { id: string; state: ReviewState }[] {
	return snapshot(db, () => {
		const { where, args } = scopeClause(db, actor);
		const filter = where.length ? `where ${where.join(" and ")}` : "";
		return db.prepare(`select id, state from review_jobs ${filter}`).all(...args) as {
			id: string;
			state: ReviewState;
		}[];
	});
}

export function reviewQueue(
	db: DatabaseSync,
	actor: string,
	options: {
		limit?: number;
		offset?: number;
		state?: ReviewState;
		cwd?: string;
		around?: string;
		hideAddressed?: boolean;
	} = {},
): ReviewQueue {
	if (options.offset !== undefined && options.limit === undefined) throw new Error("A page offset requires a limit");
	if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
		throw new Error("limit must be a positive safe integer");
	if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0))
		throw new Error("offset must be a non-negative safe integer");
	return snapshot(db, () => {
		const { where, args } = scopeClause(db, actor);
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
		const states = Object.fromEntries(groups.map((row) => [row.state, row.count]));
		const running = (
			db
				.prepare(
					`select count(*) as count from review_attempts where state in ('starting', 'running', 'cleaning') and review_id in (select id from review_jobs ${filter})`,
				)
				.get(...args) as { count: number }
		).count;
		const passes = { running, limit: REVIEW_PASS_CONCURRENCY };
		const order =
			"case when state in ('capturing', 'running', 'cancelling') then 0 when state = 'queued' then 1 else 2 end, case when state = 'queued' then priority end desc, case when state = 'queued' then created_at end asc, case when state = 'queued' then rowid end asc, updated_at desc, rowid desc";
		const visible = options.hideAddressed
			? (db.prepare(`select id from review_jobs ${filter} order by ${order}`).all(...args) as { id: string }[])
					.map(({ id }) => reviewSummary(db, actor, id))
					.filter((summary) => !summary.addressed)
			: undefined;
		const total = visible?.length ?? groups.reduce((sum, row) => sum + row.count, 0);
		if (options.limit === undefined) return { total, states, passes, page: null };
		let offset = options.offset ?? 0;
		if (offset >= total && total > 0) offset = Math.floor((total - 1) / options.limit) * options.limit;
		if (visible) {
			if (options.around) {
				const position = visible.findIndex((summary) => summary.id === options.around);
				if (position >= 0) offset = Math.floor(position / options.limit) * options.limit;
			}
			const rows = visible.slice(offset, offset + options.limit);
			return {
				total,
				states,
				passes,
				page: { offset, nextOffset: offset + rows.length < total ? offset + rows.length : null, rows },
			};
		}
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
			passes,
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
		| "decisions"
		| "thread"
		| "log";
	pass?: string;
	attempt?: string;
	limit?: number;
	offset?: number;
}

export type ReviewStore = <T>(read: (db: DatabaseSync) => T) => T;

async function targetConfiguration(change: GitChange) {
	const directory = await mkdtemp(join(tmpdir(), "review-roles-"));
	const entries = new Map<string, { mode: string; type: string } | undefined>();
	const entry = async (path: string) => {
		if (!entries.has(path)) {
			const record = (await change.git(["ls-tree", "-z", change.headTree, "--", path])).toString("utf8").split("\0")[0];
			const [mode = "", type = ""] = record ? record.slice(0, record.indexOf("\t")).split(" ") : [];
			entries.set(path, record ? { mode, type } : undefined);
		}
		return entries.get(path);
	};
	const place = async (path: string) => mkdir(dirname(join(directory, path)), { recursive: true });
	const realize = async (path: string, seen = new Set<string>()): Promise<string | undefined> => {
		const parts = path.split("/");
		for (let index = 0, real = ""; index < parts.length; index++) {
			const next = real ? `${real}/${parts[index]}` : parts[index]!;
			const item = await entry(next);
			if (!item) return undefined;
			if (item.mode === "120000") {
				const text = (await change.read("after", next))?.toString("utf8") ?? "";
				await place(next);
				await symlink(text, join(directory, next)).catch(() => {});
				const resolved = posix.normalize(posix.join(posix.dirname(next), text, ...parts.slice(index + 1)));
				if (posix.isAbsolute(text) || resolved === ".." || resolved.startsWith("../") || seen.has(next))
					return undefined;
				return realize(resolved, new Set(seen).add(next));
			}
			if (item.type === "tree") await mkdir(join(directory, next), { recursive: true });
			else if (index < parts.length - 1) return undefined;
			else {
				const data = await change.read("after", next);
				await place(next);
				if (data) await writeFile(join(directory, next), data);
			}
			real = next;
		}
		return path;
	};
	try {
		const roles = await realize(".pi/roles");
		if (roles && (await entry(roles))?.type === "tree") {
			const names = (await change.git(["ls-tree", "-z", "--name-only", change.headTree, "--", `${roles}/`]))
				.toString("utf8")
				.split("\0")
				.filter(Boolean);
			for (const name of names) await realize(name);
		}
		return reviewConfiguration(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

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
		const current = await openGitChange(job.request.cwd, job.request.target, { signal });
		let same: boolean;
		try {
			const intent = await captureIntent(job.request, signal);
			const index = current.indexEntries?.map(({ path, mode, blob }) => ({ path, mode, blob })) ?? null;
			same =
				current.baseCommit === artifact.baseCommit &&
				current.headCommit === artifact.headCommit &&
				current.baseTree === artifact.baseTree &&
				current.headTree === artifact.headTree &&
				(typeof artifact.index === "string"
					? current.indexTree === artifact.index
					: JSON.stringify(index) === JSON.stringify(artifact.index)) &&
				JSON.stringify(intent) === JSON.stringify(artifact.intent) &&
				(await realpath(current.repository)) === artifact.repository &&
				(await realpath(current.commonDirectory)) === artifact.commonDirectory &&
				JSON.stringify(await targetConfiguration(current)) === JSON.stringify(artifact.configuration);
		} finally {
			await current.close();
		}
		signal?.throwIfAborted();
		if (artifact.configuration) requestedTarget = same ? "matches" : "changed";
		else errors.push("Capture-time configuration is absent; complete target identity cannot be compared.");
		const working =
			job.request.target.kind === "working-tree"
				? current
				: await openGitChange(job.request.cwd, { kind: "working-tree", base: "HEAD" }, { signal }).then(
						async (change) => {
							await change.close();
							return change;
						},
					);
		signal?.throwIfAborted();
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
				policies.every(
					(row) =>
						row &&
						JSON.stringify(
							reviewRolePolicy(artifact.source, row.role, (JSON.parse(row.policy) as { depth?: ReviewDepth }).depth),
						) === row.policy,
				)
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
					unscopedRegions: job.plan ? unscopedRegions(job.plan, job.artifact?.regions ?? []) : [],
					additionalWork: job.additionalWork,
					chunks: page(
						(job.plan?.chunks ?? []).map((chunk) => ({
							...chunk,
							regions: chunkRegions(chunk, job.artifact?.regions ?? []),
						})),
						options,
					),
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
			case "thread":
				return page(reviewThread(db, job.id), options);
			case "log":
				return reviewLogs(db, job.id, options);
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

function reviewThread(db: DatabaseSync, review: string): ReviewThreadMessage[] {
	return (
		db
			.prepare("select seq, sender, body, at from thread_messages where thread_id = ? order by seq")
			.all(`review:${review}`) as Omit<ReviewThreadMessage, "senderName">[]
	).map((message) => ({ ...message, senderName: nameOf(db, message.sender) }));
}

const LOG_TAIL_BYTES = 512 * 1024;

function transcriptTail(file: string): ReviewLogEntry[] {
	let descriptor: number;
	try {
		descriptor = openSync(file, "r");
	} catch {
		return [];
	}
	try {
		const size = fstatSync(descriptor).size;
		const start = Math.max(0, size - LOG_TAIL_BYTES);
		const buffer = Buffer.alloc(size - start);
		readSync(descriptor, buffer, 0, buffer.length, start);
		const lines = buffer.toString("utf8").split("\n");
		if (start > 0) lines.shift();
		const clip = (text: string) => (text.length > 400 ? `${text.slice(0, 400)}\u2026` : text);
		return lines.flatMap((line): ReviewLogEntry[] => {
			let entry: { type?: string; timestamp?: string; message?: Record<string, unknown> } | null;
			try {
				entry = JSON.parse(line);
			} catch {
				return [];
			}
			if (!entry || typeof entry !== "object") return [];
			const message = entry.message;
			if (entry.type !== "message" || !message || typeof message !== "object") return [];
			const at = entry.timestamp ? Date.parse(entry.timestamp) : null;
			const content = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : [];
			if (message.role === "assistant")
				return content.flatMap((part): ReviewLogEntry[] => {
					if (part.type === "text" && typeof part.text === "string" && part.text.trim())
						return [{ at, kind: "text", text: clip(part.text.trim()) }];
					if (part.type === "toolCall")
						return [{ at, kind: "tool", text: clip(`${part.name}(${JSON.stringify(part.arguments ?? {})})`) }];
					return [];
				});
			if (message.role === "toolResult") {
				const text = content.find((part) => part.type === "text")?.text;
				return [
					{
						at,
						kind: message.isError ? "error" : "result",
						text: clip(`${message.toolName}: ${typeof text === "string" ? (text.trim().split("\n")[0] ?? "") : ""}`),
					},
				];
			}
			return [];
		});
	} finally {
		closeSync(descriptor);
	}
}

function reviewLogs(db: DatabaseSync, review: string, options: ReviewReadOptions): ReviewAttemptLog[] {
	const columns = "id, pass_id as pass, kind, state, model, session_file as sessionFile";
	type Row = Omit<ReviewAttemptLog, "attempt" | "entries"> & { id: string; sessionFile: string | null };
	let rows: Row[];
	if (options.attempt) {
		const row = db
			.prepare(`select ${columns} from review_attempts where review_id = ? and id = ?`)
			.get(review, options.attempt) as Row | undefined;
		if (!row) throw new Error(`Unknown review attempt: ${options.attempt}`);
		rows = [row];
	} else {
		rows = db
			.prepare(
				`select ${columns} from review_attempts where review_id = ? and state in ('starting', 'running', 'cleaning') order by created_at, rowid`,
			)
			.all(review) as Row[];
		if (!rows.length)
			rows = db
				.prepare(
					`select ${columns} from review_attempts where review_id = ? order by created_at desc, rowid desc limit 1`,
				)
				.all(review) as Row[];
	}
	const limit = options.limit ?? 20;
	return rows.map(({ id, sessionFile, ...row }) => ({
		attempt: id,
		...row,
		entries: sessionFile ? transcriptTail(sessionFile).slice(-limit) : [],
	}));
}

export function reviewAnalytics(db: DatabaseSync, actor: string, options: { cwd?: string } = {}): ReviewAnalytics {
	return snapshot(db, () => {
		const queue = reviewQueue(db, actor, { cwd: options.cwd, limit: Number.MAX_SAFE_INTEGER });
		const summaries = queue.page?.rows ?? [];
		const byModel = new Map<string, ReviewAnalytics["byModel"][number]>();
		const byPhase = new Map<ReviewAttempt["kind"], ReviewAnalytics["byPhase"][number]>();
		const attemptModel = new Map<string, string>();
		for (const summary of summaries) {
			const attempts = db
				.prepare(
					"select id, kind, model, result -> '$.usage.cost.total' as cost, created_at as createdAt, finished_at as finishedAt from review_attempts where review_id = ?",
				)
				.all(summary.id) as {
				id: string;
				kind: ReviewAttempt["kind"];
				model: string | null;
				cost: string | null;
				createdAt: number;
				finishedAt: number | null;
			}[];
			for (const attempt of attempts) {
				const observed: unknown = attempt.cost === null ? undefined : JSON.parse(attempt.cost);
				const reported = typeof observed === "number" && Number.isFinite(observed) && observed >= 0;
				const minutes = attempt.finishedAt ? (attempt.finishedAt - attempt.createdAt) / 60000 : 0;
				const model = attempt.model ?? "unknown";
				attemptModel.set(attempt.id, model);
				const forModel = byModel.get(model) ?? {
					model,
					attempts: 0,
					reported: 0,
					dollars: 0,
					minutes: 0,
					confirmed: 0,
					severities: {},
				};
				const phase = byPhase.get(attempt.kind) ?? {
					kind: attempt.kind,
					attempts: 0,
					reported: 0,
					dollars: 0,
					minutes: 0,
				};
				for (const row of [forModel, phase]) {
					row.attempts++;
					row.minutes += minutes;
					if (reported) {
						row.reported++;
						row.dollars = finiteSum(row.dollars, observed);
					}
				}
				byModel.set(model, forModel);
				byPhase.set(attempt.kind, phase);
			}
			for (const finding of reviewAssessment(db, actor, summary.id).findings) {
				if (finding.validation?.disposition !== "confirmed") continue;
				const forModel = byModel.get(attemptModel.get(finding.attempt) ?? "unknown");
				if (!forModel) continue;
				forModel.confirmed++;
				forModel.severities[finding.finding.severity] = (forModel.severities[finding.finding.severity] ?? 0) + 1;
			}
		}
		const durations = summaries
			.flatMap((summary) => (summary.settledAt === null ? [] : [(summary.settledAt - summary.createdAt) / 60000]))
			.sort((a, b) => a - b);
		return {
			reviews: summaries.length,
			settled: durations.length,
			dollars: summaries.reduce<number | null>(
				(sum, summary) => (summary.cost.reportedDollars === null ? sum : finiteSum(sum, summary.cost.reportedDollars)),
				0,
			),
			unreported: summaries.reduce(
				(sum, summary) =>
					sum +
					(summary.cost.reportedDollars === null
						? summary.cost.totalAttempts
						: summary.cost.totalAttempts - summary.cost.reportedAttempts),
				0,
			),
			confirmed: summaries.reduce((sum, summary) => sum + summary.findings.confirmed, 0),
			medianMinutes: median(durations),
			byModel: [...byModel.values()].sort((a, b) => (b.dollars ?? 0) - (a.dollars ?? 0)),
			byPhase: [...byPhase.values()],
			recent: summaries
				.slice()
				.sort((a, b) => b.createdAt - a.createdAt)
				.map((summary) => ({
					id: summary.id,
					label: summary.label,
					state: summary.state,
					createdAt: summary.createdAt,
					minutes: summary.settledAt === null ? null : (summary.settledAt - summary.createdAt) / 60000,
					dollars: summary.cost.reportedDollars,
					confirmed: summary.findings.confirmed,
				})),
		};
	});
}

function finiteSum(sum: number | null, value: number): number | null {
	if (sum === null) return null;
	const total = sum + value;
	return Number.isFinite(total) ? total : null;
}

function median(sorted: number[]): number | null {
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
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
