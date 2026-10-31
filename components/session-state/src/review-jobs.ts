import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { captureReview, verifyArtifact } from "../../code-review/src/capture.js";
import { checkShape } from "../../code-review/src/contracts.js";
import { type ReviewJob, ReviewOperationSchema } from "../../code-review/src/operations.js";
import type { StatePaths } from "./paths.js";
import { temporaryCallers } from "./program-peers.js";
import { rootOf } from "./tree.js";
import { focusedTask, mayManage } from "./work.js";

const columns = `id, command_id as commandId, requester, owner, organization, origin_task as originTask,
 parent, state, priority, generation, revision, plan_revision as planRevision, request,
 artifact_directory as artifactDirectory, artifact, plan, reason, created_at as createdAt, updated_at as updatedAt`;

type StoredJob = Omit<ReviewJob, "request" | "artifact" | "plan"> & {
	request: string;
	artifact: string | null;
	plan: string | null;
};
export function readReview(db: DatabaseSync, actor: string, id: string): ReviewJob {
	const row = db.prepare(`select ${columns} from review_jobs where id = ?`).get(id) as StoredJob | undefined;
	if (!row) throw new Error(`Unknown review: ${id}`);
	if (
		actor !== "operator" &&
		(!db.prepare("select 1 from sessions where id = ? and kind = 'root' and retired_at is null").get(actor) ||
			rootOf(db, actor) !== rootOf(db, row.organization))
	)
		throw new Error("The review belongs to another organization");
	return {
		...row,
		request: JSON.parse(row.request),
		artifact: row.artifact ? JSON.parse(row.artifact) : null,
		plan: row.plan ? JSON.parse(row.plan) : null,
	};
}

/** Runtime-owned capture and admission. Request sockets never own this work. */
export class ReviewJobs {
	private stopped = false;
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
				`update review_jobs set state = 'interrupted', reason = 'The runtime restarted. Inspect the retained work and explicitly resume a verified target.', updated_at = ? where state in ('capturing', 'queued', 'running', 'cancelling')`,
			)
			.run(Date.now());
	}

	stop(): void {
		this.stopped = true;
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
			const done = this.capture(id, actor, controller);
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
		if (operation.action === "cancel") {
			if (job.state !== "completed" && job.state !== "cancelled") {
				if (job.state === "running")
					throw new Error("The running attempt must finish guarded cleanup before cancellation completes");
				this.db
					.prepare("update review_jobs set state = 'cancelling', updated_at = ? where id = ?")
					.run(Date.now(), job.id);
				const capture = this.captures.get(job.id);
				capture?.controller.abort(new Error("Review capture cancelled"));
				if (capture) await capture.done.catch(() => {});
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
		return job.id;
	}

	private async capture(id: string, actor: string, controller: AbortController): Promise<void> {
		const job = readReview(this.db, actor, id);
		try {
			mkdirSync(dirname(job.artifactDirectory), { recursive: true, mode: 0o700 });
			const artifact = await captureReview(job.request, job.artifactDirectory, controller.signal);
			this.live();
			controller.signal.throwIfAborted();
			const changed = this.db
				.prepare(
					"update review_jobs set artifact = ?, state = 'queued', revision = revision + 1, updated_at = ? where id = ? and state = 'capturing'",
				)
				.run(JSON.stringify(artifact), Date.now(), id);
			if (!changed.changes) throw new Error("Review capture no longer owns admission");
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
