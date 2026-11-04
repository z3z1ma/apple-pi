import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { captureReview, verifyArtifact } from "../../code-review/src/capture.js";
import {
	checkShape,
	combineValidation,
	DuplicateLinksSchema,
	type FindingValidation,
	FindingValidationSchema,
	findingKey,
	planPasses,
	REVIEW_PASS_CONCURRENCY,
	type ReviewPlan,
	ReviewPlanSchema,
	type ReviewReport,
	reviewReportSchema,
	unscopedRegions,
	validatePlan,
	validateReport,
	validateShard,
} from "../../code-review/src/contracts.js";
import { type ReviewJob, type ReviewOperation, ReviewOperationSchema } from "../../code-review/src/operations.js";
import { reviewRoleCatalog } from "../../code-review/src/policy.js";
import { INSPECT_REVIEW, LINK_DUPLICATES, PLAN_REVIEW, VALIDATE_REVIEW } from "../../code-review/src/prompts.js";
import type { ReviewArtifact } from "../../code-review/src/types.js";
import { RETRY_MS } from "./client.js";
import type { StatePaths } from "./paths.js";
import { temporaryCallers } from "./program-peers.js";
import { runReviewAttempt } from "./review-attempt.js";
import { recordReviewDecision, reviewSettled } from "./review-decisions.js";
import { readReview } from "./review-read.js";
import { rootOf } from "./tree.js";
import { focusedTask, mayManage } from "./work.js";

function reviewSource(artifact: ReviewArtifact) {
	return {
		digest: artifact.digest,
		source: artifact.source,
		base: artifact.baseRevision,
		head: artifact.headRevision,
		originalBase: artifact.baseCommit,
		originalHead: artifact.headCommit,
		target: artifact.request.target,
		paths: artifact.request.paths ?? [],
		lenses: artifact.request.lenses ?? [],
		intent: artifact.intent,
		omissions: artifact.omissions,
		changes: artifact.changes,
	};
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type ReviewNotify = (notice: {
	review: string;
	owner: string;
	key: string;
	subject: string;
	body: string;
	sender?: string;
}) => void;

function outcomeNotice(
	id: string,
	state: "completed" | "incomplete",
	reports: ReviewReport[],
	validation: FindingValidation,
): string {
	const findings = new Map(
		reports.flatMap((report) =>
			report.findings.map((finding) => [findingKey(report.pass, finding.id), finding] as const),
		),
	);
	const confirmed = validation.findings.filter((entry) => entry.disposition === "confirmed");
	const unresolved = validation.findings.filter((entry) => entry.disposition === "unresolved").length;
	return [
		`Review ${id} ${state === "completed" ? "completed" : "is incomplete"}: ${count(confirmed.length, "confirmed finding")}, ${unresolved} unresolved, ${count(validation.coverageGaps.length, "coverage gap")}.`,
		...confirmed.map((entry) => {
			const finding = findings.get(entry.finding);
			return finding
				? `- [${finding.severity}] ${finding.title} (${finding.path}:${finding.line})`
				: `- ${entry.finding}`;
		}),
		"",
		validation.summary,
		"",
		`Completion is not approval. Read the evidence with read_review (review "${id}", part "findings"); respond with resolve_finding.`,
	].join("\n");
}

function findingsNotice(
	id: string,
	report: ReviewReport,
	attempt: string,
	validation: FindingValidation,
): string | undefined {
	const confirmed = new Set(
		validation.findings.filter((entry) => entry.disposition === "confirmed").map((entry) => entry.finding),
	);
	const findings = report.findings.filter((finding) => confirmed.has(findingKey(report.pass, finding.id)));
	if (!findings.length) return undefined;
	return [
		`Review ${id}: ${count(findings.length, "confirmed finding")} from pass ${report.pass}. Other passes are still settling; duplicates across passes are linked when validation finishes.`,
		...findings.map(
			(finding) =>
				`- [${finding.severity}] ${finding.title} (${finding.path}:${finding.line}), finding "${attempt}:${finding.id}"`,
		),
	].join("\n");
}

async function inParallel<T, R>(
	items: T[],
	limit: number,
	signal: AbortSignal,
	run: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
	const stop = new AbortController();
	const abort = () => stop.abort(signal.reason);
	signal.addEventListener("abort", abort, { once: true });
	const results: R[] = new Array(items.length);
	let next = 0;
	let failure: { error: unknown } | undefined;
	const worker = async () => {
		while (!failure && !stop.signal.aborted && next < items.length) {
			const index = next++;
			try {
				results[index] = await run(items[index]!, stop.signal);
			} catch (error) {
				failure ??= { error };
				stop.abort(error);
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	} finally {
		signal.removeEventListener("abort", abort);
	}
	if (failure) throw failure.error;
	signal.throwIfAborted();
	return results;
}

export class ReviewJobs {
	private stopped = false;
	private pumping?: Promise<void>;
	private active?: { id: string; controller: AbortController; done: Promise<void> };
	private readonly captures = new Map<string, { controller: AbortController; done: Promise<void> }>();
	private readonly db: DatabaseSync;
	private readonly paths: StatePaths;
	private readonly notify: ReviewNotify;
	constructor(db: DatabaseSync, paths: StatePaths, notify: ReviewNotify = () => {}) {
		this.db = db;
		this.paths = paths;
		this.notify = notify;
	}

	private notice(job: ReviewJob, key: string, body: string): void {
		try {
			this.notify({
				review: job.id,
				owner: job.owner,
				key: `${job.generation}:${key}`,
				subject: `Review ${job.id.slice(-8)}`,
				body,
			});
		} catch (error) {
			console.error(`Review notice failed: ${error instanceof Error ? error.message : error}`);
		}
	}

	recover(): void {
		this.db
			.prepare(
				"update review_attempts set state = 'interrupted', reason = 'The runtime restarted before this attempt completed', finished_at = ? where state in ('starting', 'running', 'cleaning')",
			)
			.run(Date.now());
		this.db
			.prepare(
				`update review_jobs set state = 'interrupted', reason = 'The runtime restarted. Inspect the retained work and explicitly resume a verified target.', updated_at = ? where state in ('capturing', 'queued', 'running', 'cancelling')`,
			)
			.run(Date.now());
	}

	stop(): void {
		this.stopped = true;
		this.active?.controller.abort(new Error("The runtime stopped during review"));
		for (const capture of this.captures.values())
			capture.controller.abort(new Error("The runtime stopped during capture"));
	}

	async execute(commandId: string, actor: string, input: unknown): Promise<string> {
		const operation = checkShape(ReviewOperationSchema, input);
		if (operation.action === "enqueue") {
			const owner = operation.owner ?? actor;
			if (actor !== owner) mayManage(this.db, actor, owner);
			this.availableOwner(owner);
			if (!isAbsolute(operation.request.cwd)) throw new Error("A review needs an absolute working directory");
			const organization = rootOf(this.db, owner);
			if (operation.parent) {
				const parent = readReview(this.db, actor, operation.parent);
				if (rootOf(this.db, parent.organization) !== organization)
					throw new Error("A rerun must stay in the review's organization");
			}
			const id = `review-${randomUUID()}`;
			const directory = join(this.paths.dir, "reviews", id, "artifact");
			const now = Date.now();
			this.commit(commandId, id, () => {
				this.db
					.prepare(
						`insert into review_jobs (id, command_id, requester, owner, organization, origin_task, parent, state, request, artifact_directory, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'capturing', ?, ?, ?, ?)`,
					)
					.run(
						id,
						commandId,
						actor,
						owner,
						organization,
						focusedTask(this.db, owner)?.id ?? null,
						operation.parent ?? null,
						JSON.stringify(operation.request),
						directory,
						now,
						now,
					);
			});
			const controller = new AbortController();
			const done = this.capture(id, actor, controller, operation.expectedDigest);
			this.captures.set(id, { controller, done });
			try {
				await done;
			} finally {
				this.captures.delete(id);
			}
			return id;
		}
		const job = readReview(this.db, actor, operation.review);
		if (operation.action === "comment") {
			this.notify({
				review: job.id,
				owner: job.owner,
				key: `comment:${commandId}`,
				subject: `Review ${job.id.slice(-8)}`,
				body: operation.body,
				sender: actor,
			});
			this.commit(commandId, job.id, () => {});
			return job.id;
		}
		if (actor !== job.owner) mayManage(this.db, actor, job.owner);
		if (operation.action === "finding" || operation.action === "approve") {
			await this.decide(commandId, actor, job, operation);
			return job.id;
		}
		if (operation.action === "cancel") {
			if (!["completed", "cancelled", "no-changes"].includes(job.state)) {
				this.db
					.prepare("update review_jobs set state = 'cancelling', updated_at = ? where id = ?")
					.run(Date.now(), job.id);
				const capture = this.captures.get(job.id);
				capture?.controller.abort(new Error("Review capture cancelled"));
				if (capture) await capture.done.catch(() => {});
				if (this.active?.id === job.id) {
					this.active.controller.abort(new Error("Review cancelled"));
					await this.active.done;
				}
				await this.waitCleanup(job.id);
				this.live();
				this.commit(commandId, job.id, () =>
					this.db
						.prepare(
							"update review_jobs set state = 'cancelled', revision = revision + 1, updated_at = ? where id = ? and generation = ?",
						)
						.run(Date.now(), job.id, job.generation),
				);
			} else this.commit(commandId, job.id, () => {});
		} else if (operation.action === "resume") {
			if (!["interrupted", "failed", "incomplete"].includes(job.state))
				throw new Error("Only interrupted, failed or incomplete reviews can resume");
			if (!job.artifact)
				throw new Error("No verified target was admitted. Capture a new review rather than resume live source");
			this.availableOwner(job.owner);
			await this.waitCleanup(job.id);
			await verifyArtifact(job.artifact);
			this.live();
			this.commit(commandId, job.id, () => {
				const changed = this.db
					.prepare(
						"update review_jobs set state = 'queued', generation = generation + 1, revision = revision + 1, reason = null, updated_at = ? where id = ? and state = ? and generation = ? and owner = ? and revision = ?",
					)
					.run(Date.now(), job.id, job.state, job.generation, job.owner, job.revision);
				if (!changed.changes) throw new Error("The review changed while its target was verified; inspect it again");
			});
		} else if (operation.action === "extend") {
			if (!reviewSettled(job.state) || !job.artifact || job.state === "no-changes")
				throw new Error("Additional review work requires a settled captured change");
			this.availableOwner(job.owner);
			await this.waitCleanup(job.id);
			await verifyArtifact(job.artifact);
			this.live();
			this.commit(commandId, job.id, () => {
				const additionalWork = [
					...job.additionalWork,
					{
						id: commandId,
						actor,
						question: operation.question,
						reason: operation.reason,
						doneWhen: operation.doneWhen,
						createdAt: Date.now(),
					},
				];
				const changed = this.db
					.prepare(
						"update review_jobs set additional_work = ?, selected_attempts = '{}', state = 'queued', generation = generation + 1, revision = revision + 1, reason = null, updated_at = ? where id = ? and revision = ? and generation = ? and owner = ? and state = ? and json_extract(artifact, '$.digest') = ?",
					)
					.run(
						JSON.stringify(additionalWork),
						Date.now(),
						job.id,
						operation.revision,
						job.generation,
						job.owner,
						job.state,
						operation.digest,
					);
				if (!changed.changes)
					throw new Error("The review assessment changed; inspect it again before authorizing work");
			});
		} else if (operation.action === "priority") {
			this.commit(commandId, job.id, () =>
				this.db
					.prepare("update review_jobs set priority = ?, updated_at = ? where id = ?")
					.run(operation.priority, Date.now(), job.id),
			);
		} else {
			mayManage(this.db, actor, operation.owner);
			this.availableOwner(operation.owner);
			if (rootOf(this.db, operation.owner) !== rootOf(this.db, job.organization))
				throw new Error("The new owner belongs to another organization");
			if (["running", "capturing", "cancelling"].includes(job.state))
				throw new Error("Finish or cancel active work before changing its owner");
			this.commit(commandId, job.id, () =>
				this.db
					.prepare("update review_jobs set owner = ?, updated_at = ? where id = ?")
					.run(operation.owner, Date.now(), job.id),
			);
		}
		this.wake();
		return job.id;
	}

	private async decide(
		commandId: string,
		actor: string,
		job: ReviewJob,
		operation: Extract<ReviewOperation, { action: "finding" | "approve" }>,
	): Promise<void> {
		if (!reviewSettled(job.state) || !job.artifact) throw new Error("Decisions require a settled captured review");
		if (operation.action === "approve") {
			if (actor !== "operator") throw new Error("Only the operator can sign off on a captured review");
			await this.waitCleanup(job.id);
		}
		await verifyArtifact(job.artifact);
		if (operation.action === "finding" && operation.response.verification) {
			const verification = readReview(this.db, actor, operation.response.verification.review);
			if (!verification.artifact) throw new Error("The verification target was not captured");
			await verifyArtifact(verification.artifact);
		}
		this.live();
		this.commit(commandId, job.id, () => recordReviewDecision(this.db, commandId, actor, job, operation));
	}

	wake(): void {
		if (this.stopped || this.pumping) return;
		this.pumping = this.drain()
			.catch((error) => {
				console.error(`Review queue: ${error instanceof Error ? error.stack : error}`);
			})
			.finally(() => {
				this.pumping = undefined;
				if (!this.stopped && this.db.prepare("select 1 from review_jobs where state = 'queued'").get()) this.wake();
			});
	}

	private async drain(): Promise<void> {
		while (!this.stopped) {
			const claimed = this.db
				.prepare(
					"update review_jobs set state = 'running', generation = generation + 1, updated_at = ? where id = (select id from review_jobs where state = 'queued' order by priority desc, created_at, rowid limit 1) and state = 'queued' returning id",
				)
				.get(Date.now()) as { id: string } | undefined;
			if (!claimed) return;
			const controller = new AbortController();
			const done = this.inspect(claimed.id, controller.signal);
			this.active = { id: claimed.id, controller, done };
			try {
				await done;
			} finally {
				this.active = undefined;
			}
		}
	}

	private async inspect(id: string, signal: AbortSignal): Promise<void> {
		let job = readReview(this.db, "operator", id);
		try {
			this.availableOwner(job.owner);
			job.selectedAttempts = job.selectedAttempts.planner ? { planner: job.selectedAttempts.planner } : {};
			this.storeSelection(job);
			const artifact = job.artifact!;
			const source = reviewSource(artifact);
			const roles = reviewRoleCatalog(artifact.source);
			const planned = await runReviewAttempt(
				this.db,
				this.paths,
				job,
				{
					id: "planner",
					role: "code-review-specialist",
					policyFingerprint: roles.find((role) => role.name === "code-review-specialist")?.policy,
					kind: "planner",
					goal: `${artifact.configuration?.instructions.planning ?? PLAN_REVIEW}\nEach authorized additionalWork entry is required work. Assign its id as a lens to a focused pass and answer its question with the stated doneWhen evidence; preserve its reason.\nCaptured source: ${artifact.source}`,
					schema: ReviewPlanSchema,
					context: {
						phase: "planning",
						artifact: source,
						regions: artifact.regions,
						roles,
						additionalWork: job.additionalWork,
					},
					validate: (value) =>
						validatePlan(value, artifact.digest, artifact.regions, new Set(roles.map((role) => role.name)), [
							...(artifact.request.lenses ?? []),
							...job.additionalWork.map((request) => request.id),
						]),
				},
				signal,
			);
			if (!job.plan || planned.attempt !== job.selectedAttempts.planner) {
				const plan = planned.output as ReviewPlan;
				job.selectedAttempts.planner = planned.attempt;
				this.live();
				signal.throwIfAborted();
				const changed = this.db
					.prepare(
						"update review_jobs set plan = ?, selected_attempts = ?, plan_revision = plan_revision + 1, revision = revision + 1, updated_at = ? where id = ? and generation = ? and state = 'running'",
					)
					.run(JSON.stringify(plan), JSON.stringify(job.selectedAttempts), Date.now(), id, job.generation);
				if (!changed.changes) throw new Error("The planner no longer owns this review");
				job = readReview(this.db, "operator", id);
				const passes = planPasses(plan, artifact.regions);
				const unscoped = unscopedRegions(plan, artifact.regions).length;
				this.notice(
					job,
					`plan:${job.planRevision}`,
					[
						`Review ${job.id} is planned: ${count(plan.chunks.length, "scope")}, ${count(passes.length, "pass", "passes")}, ${count(
							passes.reduce((n, pass) => n + pass.questions.length, 0),
							"question",
						)}${unscoped ? ` (${count(unscoped, "changed region")} outside every scope, covered by the integration pass)` : ""}. Up to ${REVIEW_PASS_CONCURRENCY} passes run at once.`,
						"",
						plan.summary,
						"",
						`Follow it with read_review (review "${job.id}") or /reviews. You will get mail when it settles.`,
					].join("\n"),
				);
			}
			const plan = job.plan!;
			const paths = new Set([...artifact.files, ...artifact.regions, ...artifact.omissions].map((entry) => entry.path));
			const reports = await inParallel(
				planPasses(plan, artifact.regions),
				REVIEW_PASS_CONCURRENCY,
				signal,
				async (pass, passSignal) => {
					const inspected = await runReviewAttempt(
						this.db,
						this.paths,
						job,
						{
							id: pass.id,
							role: pass.role,
							depth: pass.depth ?? "standard",
							policyFingerprint: roles.find((role) => role.name === pass.role)?.[
								pass.depth === "deep" ? "deepPolicy" : "policy"
							],
							kind: pass.kind,
							goal: `${artifact.configuration?.instructions.inspection ?? INSPECT_REVIEW}\nCaptured source: ${artifact.source}`,
							schema: reviewReportSchema(pass),
							context: {
								phase: "inspection",
								artifact: source,
								pass,
								regions: artifact.regions.filter((region) => pass.regions.includes(region.id)),
								chunks: plan.chunks.map(({ id, title, paths, context, risks }) => ({
									id,
									title,
									paths,
									context,
									risks,
								})),
							},
							validate: (value) => validateReport(value, artifact.digest, pass, paths),
							reuse: (value) => (value as ReviewReport).coverage.every((entry) => entry.state === "completed"),
						},
						passSignal,
					);
					job.selectedAttempts = { ...job.selectedAttempts, [pass.id]: inspected.attempt };
					this.storeSelection(job);
					return inspected.output as ReviewReport;
				},
			);
			const reviewedAttempts = { ...job.selectedAttempts };
			const validatorPolicy = roles.find((role) => role.name === "code-review-specialist")?.policy;
			const shards = await inParallel(reports, REVIEW_PASS_CONCURRENCY, signal, async (report, shardSignal) => {
				const inspected = { [report.pass]: reviewedAttempts[report.pass]! };
				const shard = await runReviewAttempt(
					this.db,
					this.paths,
					job,
					{
						id: `validator:${report.pass}`,
						role: "code-review-specialist",
						policyFingerprint: validatorPolicy,
						kind: "validation",
						goal: `${artifact.configuration?.instructions.validation ?? VALIDATE_REVIEW}\nCaptured source: ${artifact.source}`,
						schema: FindingValidationSchema,
						context: { phase: "validation", artifact: source, plan, reports: [report], reviewedAttempts: inspected },
						reviewedAttempts: inspected,
						validate: (value) => validateShard(value, artifact.digest, report),
						reuse: (value) => !(value as FindingValidation).coverageGaps.length,
					},
					shardSignal,
				);
				job.selectedAttempts = { ...job.selectedAttempts, [`validator:${report.pass}`]: shard.attempt };
				this.storeSelection(job);
				const streamed = findingsNotice(job.id, report, inspected[report.pass], shard.output as FindingValidation);
				if (streamed) this.notice(job, `findings:${report.pass}`, streamed);
				return shard.output as FindingValidation;
			});
			const validated = await runReviewAttempt(
				this.db,
				this.paths,
				job,
				{
					id: "validator",
					role: "code-review-specialist",
					policyFingerprint: validatorPolicy,
					kind: "validation",
					goal: artifact.configuration?.instructions.duplicates ?? LINK_DUPLICATES,
					schema: DuplicateLinksSchema,
					context: {
						phase: "validation",
						artifact: source,
						shards: shards.map(({ summary, coverageGaps, limitations }) => ({ summary, coverageGaps, limitations })),
						findings: reports.flatMap((report) =>
							report.findings.map((finding) => ({
								key: findingKey(report.pass, finding.id),
								title: finding.title,
								location: `${finding.path}:${finding.line}`,
								trigger: finding.trigger,
								invariant: finding.invariant,
								cause: finding.cause,
								validation: shards
									.flatMap((shard) => shard.findings)
									.find((entry) => entry.finding === findingKey(report.pass, finding.id)),
							})),
						),
					},
					reviewedAttempts,
					validate: (value) => combineValidation(value, artifact.digest, reports, shards),
					reuse: (value) => !(value as FindingValidation).coverageGaps.length,
				},
				signal,
			);
			job.selectedAttempts.validator = validated.attempt;
			this.storeSelection(job);
			const validation = validated.output as FindingValidation;
			this.live();
			signal.throwIfAborted();
			if (JSON.stringify(reviewRoleCatalog(artifact.source)) !== JSON.stringify(roles))
				throw new Error("The review policy changed during execution; resume to obtain a current-policy plan");
			const incomplete =
				plan.gaps?.length ||
				reports.some(
					(report) => report.coverage.some((entry) => entry.state === "incomplete") || report.extraPasses.length,
				) ||
				validation.coverageGaps.length;
			this.db
				.prepare(
					"update review_jobs set state = ?, reason = ?, revision = revision + 1, updated_at = ? where id = ? and generation = ? and state = 'running'",
				)
				.run(
					incomplete ? "incomplete" : "completed",
					incomplete ? "Required coverage is incomplete or additional questions need the plan owner's decision" : null,
					Date.now(),
					id,
					job.generation,
				);
			this.notice(job, "outcome", outcomeNotice(job.id, incomplete ? "incomplete" : "completed", reports, validation));
		} catch (error) {
			if (this.stopped) return;
			const reason = error instanceof Error ? error.message : String(error);
			const failed = this.db
				.prepare(
					"update review_jobs set state = 'failed', reason = ?, revision = revision + 1, updated_at = ? where id = ? and generation = ? and state = 'running'",
				)
				.run(reason, Date.now(), id, job.generation);
			if (failed.changes)
				this.notice(
					job,
					"outcome",
					`Review ${job.id} failed: ${reason}\n\nRetained work stays inspectable with read_review; resume or rerun with manage_review.`,
				);
		}
	}

	private storeSelection(job: ReviewJob): void {
		this.live();
		const changed = this.db
			.prepare(
				"update review_jobs set selected_attempts = ?, revision = revision + 1, updated_at = ? where id = ? and generation = ? and plan_revision = ? and state = 'running'",
			)
			.run(JSON.stringify(job.selectedAttempts), Date.now(), job.id, job.generation, job.planRevision);
		if (!changed.changes) throw new Error("The attempt no longer owns the review assessment");
	}

	private async waitCleanup(id: string): Promise<void> {
		for (;;) {
			this.live();
			const scopes = this.db
				.prepare(
					"select s.last_error from program_scopes s join review_attempts a on a.program_id = s.id where a.review_id = ?",
				)
				.all(id) as { last_error: string | null }[];
			if (!scopes.length) return;
			const failure = scopes.find((scope) => scope.last_error);
			if (failure) throw new Error(`Previous reviewer cleanup is unresolved: ${failure.last_error}`);
			await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
		}
	}

	private async capture(
		id: string,
		actor: string,
		controller: AbortController,
		expectedDigest?: string,
	): Promise<void> {
		const job = readReview(this.db, actor, id);
		try {
			mkdirSync(dirname(job.artifactDirectory), { recursive: true, mode: 0o700 });
			const artifact = await captureReview(job.request, job.artifactDirectory, controller.signal);
			this.live();
			controller.signal.throwIfAborted();
			if (expectedDigest && artifact.digest !== expectedDigest)
				throw new Error("Target changed after preview; inspect a fresh preview before queueing review");
			const empty = artifact.changes.length === 0;
			const changed = this.db
				.prepare(
					"update review_jobs set artifact = ?, state = ?, reason = ?, revision = revision + 1, updated_at = ? where id = ? and state = 'capturing'",
				)
				.run(
					JSON.stringify(artifact),
					empty ? "no-changes" : "queued",
					empty ? "No changed paths in the requested comparison and scope; no reviewers ran." : null,
					Date.now(),
					id,
				);
			if (!changed.changes) throw new Error("Review capture no longer owns admission");
			this.wake();
		} catch (error) {
			if (!this.stopped)
				this.db
					.prepare(
						"update review_jobs set state = case when state = 'cancelling' then 'cancelled' else 'failed' end, reason = ?, updated_at = ? where id = ?",
					)
					.run(error instanceof Error ? error.message : String(error), Date.now(), id);
			throw error;
		}
	}

	private availableOwner(owner: string): void {
		if (
			!this.db.prepare("select 1 from sessions where id = ? and kind = 'root' and retired_at is null").get(owner) ||
			temporaryCallers(this.db).has(owner)
		)
			throw new Error("A durable review needs an existing lasting owner");
		if (
			this.db
				.prepare(
					"select 1 from commands where session_id = ? and kind = 'retire' and stage in ('accepted', 'delivered')",
				)
				.get(owner)
		)
			throw new Error("The review owner has a pending departure");
	}

	private live(): void {
		if (this.stopped) throw new Error("The review runtime stopped");
	}
	private commit(commandId: string, id: string, change: () => void): void {
		this.db.exec("begin");
		try {
			change();
			this.db
				.prepare("update commands set result = ? where command_id = ?")
				.run(JSON.stringify({ review: id }), commandId);
			this.db.exec("commit");
		} catch (error) {
			this.db.exec("rollback");
			throw error;
		}
	}
}
