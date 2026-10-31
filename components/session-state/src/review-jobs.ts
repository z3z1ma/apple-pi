import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { captureReview, verifyArtifact } from "../../code-review/src/capture.js";
import {
	checkShape,
	type FindingValidation,
	FindingValidationSchema,
	planPasses,
	type ReviewPlan,
	ReviewPlanSchema,
	type ReviewReport,
	ReviewReportSchema,
	validateFindings,
	validatePlan,
	validateReport,
} from "../../code-review/src/contracts.js";
import { type ReviewJob, type ReviewOperation, ReviewOperationSchema } from "../../code-review/src/operations.js";
import { reviewRoleCatalog } from "../../code-review/src/policy.js";
import { INSPECT_REVIEW, PLAN_REVIEW, VALIDATE_REVIEW } from "../../code-review/src/prompts.js";
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

/** Runtime-owned capture and admission. Request sockets never own this work. */
export class ReviewJobs {
	private stopped = false;
	private pumping?: Promise<void>;
	private active?: { id: string; controller: AbortController; done: Promise<void> };
	private readonly captures = new Map<string, { controller: AbortController; done: Promise<void> }>();
	private readonly db: DatabaseSync;
	private readonly paths: StatePaths;
	constructor(db: DatabaseSync, paths: StatePaths) {
		this.db = db;
		this.paths = paths;
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
						.prepare("update review_jobs set state = 'cancelled', revision = revision + 1, updated_at = ? where id = ?")
						.run(Date.now(), job.id),
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
					kind: "planner",
					goal: `${PLAN_REVIEW}\nCaptured source: ${artifact.source}`,
					schema: ReviewPlanSchema,
					context: {
						phase: "planning",
						artifact: source,
						regions: artifact.regions,
						roles,
					},
					validate: (value) =>
						validatePlan(
							value,
							artifact.digest,
							artifact.regions,
							new Set(roles.map((role) => role.name)),
							artifact.request.lenses,
						),
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
			}
			const plan = job.plan!;
			const reports: ReviewReport[] = [];
			const paths = new Set([...artifact.files, ...artifact.regions, ...artifact.omissions].map((entry) => entry.path));
			for (const pass of planPasses(plan)) {
				const inspected = await runReviewAttempt(
					this.db,
					this.paths,
					job,
					{
						id: pass.id,
						role: pass.role,
						kind: pass.kind,
						goal: `${INSPECT_REVIEW}\nCaptured source: ${artifact.source}`,
						schema: ReviewReportSchema,
						context: {
							phase: "inspection",
							artifact: source,
							pass,
							regions: artifact.regions.filter((region) => pass.regions.includes(region.id)),
							chunks: plan.chunks.map(({ id, title, regions, context, risks }) => ({
								id,
								title,
								regions,
								context,
								risks,
							})),
						},
						validate: (value) => validateReport(value, artifact.digest, pass, paths),
						reuse: (value) => (value as ReviewReport).coverage.every((entry) => entry.state === "completed"),
					},
					signal,
				);
				job.selectedAttempts = { ...job.selectedAttempts, [pass.id]: inspected.attempt };
				this.storeSelection(job);
				reports.push(inspected.output as ReviewReport);
			}
			const reviewedAttempts = { ...job.selectedAttempts };
			const validated = await runReviewAttempt(
				this.db,
				this.paths,
				job,
				{
					id: "validator",
					role: "code-review-specialist",
					kind: "validation",
					goal: `${VALIDATE_REVIEW}\nCaptured source: ${artifact.source}`,
					schema: FindingValidationSchema,
					context: { phase: "validation", artifact: source, plan, reports, reviewedAttempts },
					reviewedAttempts,
					validate: (value) => validateFindings(value, artifact.digest, reports),
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
				plan.gaps.length ||
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
		} catch (error) {
			if (!this.stopped)
				this.db
					.prepare(
						"update review_jobs set state = 'failed', reason = ?, revision = revision + 1, updated_at = ? where id = ? and generation = ? and state = 'running'",
					)
					.run(error instanceof Error ? error.message : String(error), Date.now(), id, job.generation);
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
