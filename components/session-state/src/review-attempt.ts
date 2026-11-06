import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { TSchema } from "typebox";
import { verifyArtifact, verifyCapturedSource } from "../../code-review/src/capture.js";
import { checkShape } from "../../code-review/src/contracts.js";
import type { ReviewJob } from "../../code-review/src/operations.js";
import { type ReviewDepth, reviewPolicyFingerprint, reviewRolePolicy } from "../../code-review/src/policy.js";
import { normalizeOutputSchema } from "../../shared/src/structured-output.js";
import type { TurnResult } from "../../shared/src/turn-observer.js";
import type { StatePaths } from "./paths.js";
import { openPeerProgram, type PeerProgram } from "./program-client.js";

export class ReviewStop extends Error {}

export const REVIEWER_SILENCE_MS = 15 * 60_000;
const SILENCE_CHECK_MS = 30_000;

export function watchSilence(lastActivity: () => number, onSilent: () => void): () => void {
	const timer = setInterval(() => {
		if (Date.now() - lastActivity() < REVIEWER_SILENCE_MS) return;
		clearInterval(timer);
		onSilent();
	}, SILENCE_CHECK_MS);
	return () => clearInterval(timer);
}

export interface ReviewPassRequest {
	id: string;
	worker?: string;
	role: string;
	policyFingerprint: string | undefined;
	depth?: ReviewDepth;
	kind: "planner" | "focused" | "integration" | "validation";
	goal: string;
	context: unknown;
	schema: unknown;
	thinking?: string;
	fromTool?(value: unknown): unknown;
	validate(value: unknown): unknown;
	reuse?(value: unknown): boolean;
}

export function reviewScope(
	db: DatabaseSync,
	program: string,
	caller: string,
): { attempt: string; person: string; role: string; source: string; fork: string | null } | undefined {
	const known = db.prepare("select id from review_attempts where program_id = ?").get(program);
	if (!known) return undefined;
	const active = db
		.prepare(
			`select a.id as attempt, a.person, a.role, a.fork_file as fork, json_extract(j.artifact, '$.source') as source from review_attempts a join review_jobs j on j.id = a.review_id where a.program_id = ? and j.owner = ? and j.state = 'running' and a.generation = j.generation and a.plan_revision = j.plan_revision and a.state = 'starting'`,
		)
		.get(program, caller) as
		| { attempt: string; person: string; role: string; source: string; fork: string | null }
		| undefined;
	if (!active?.source) throw new Error("The review attempt no longer owns this launch");
	return active;
}

export async function runReviewAttempt(
	db: DatabaseSync,
	paths: StatePaths,
	job: ReviewJob,
	pass: ReviewPassRequest,
	signal: AbortSignal,
): Promise<{ attempt: string; output: unknown }> {
	const artifact = job.artifact;
	if (!artifact) throw new Error("Review execution requires an admitted artifact");
	await verified(pass.kind === "planner" ? verifyArtifact : verifyCapturedSource, artifact, signal);
	signal.throwIfAborted();
	const resolve = () => rolePolicy(artifact.source, pass.role, pass.depth);
	const policy = resolve();
	if (reviewPolicyFingerprint(policy) !== pass.policyFingerprint)
		throw new ReviewStop(
			`The review policy for ${pass.role} differs from the planned catalog; resume to plan under current policy`,
		);
	const worker = pass.worker
		? (db
				.prepare("select id, name, model, session_file as file from sessions where id = ? and retired_at is null")
				.get(pass.worker) as { id: string; name: string | null; model: string | null; file: string | null } | undefined)
		: undefined;
	if (pass.worker && !worker?.file) throw new ReviewStop("The assigned review worker has no available transcript");
	const inputKey = createHash("sha256")
		.update(
			JSON.stringify({
				role: pass.role,
				...(worker ? { worker: { person: worker.id, file: worker.file, model: worker.model } } : {}),
				policy,
				thinking: pass.thinking ?? null,
				goal: pass.goal,
				context: pass.context,
				schema: pass.schema,
			}),
		)
		.digest("hex");
	const previous = db
		.prepare(
			"select id, output from review_attempts where review_id = ? and (plan_revision = ? or (kind = 'planner' and id = ?)) and pass_id = ? and input_key = ? and state = 'completed' and reuse_blocked_by is null order by created_at desc, rowid desc limit 1",
		)
		.get(job.id, job.planRevision, job.selectedAttempts.planner ?? null, pass.id, inputKey) as
		| { id: string; output: string }
		| undefined;
	if (previous) {
		const value = pass.validate(JSON.parse(previous.output));
		if (!pass.reuse || pass.reuse(value)) return { attempt: previous.id, output: value };
	}
	const reviewer = worker ? { kind: "worker", person: worker.id, name: worker.name } : { kind: "temp" };
	const candidates = policy.candidates;
	const id = randomUUID();
	const person = randomUUID();
	const programId = randomUUID();
	const directory = join(dirname(job.artifactDirectory), "attempts", id);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const contextFile = join(directory, "input.json");
	writeFileSync(contextFile, `${JSON.stringify(pass.context, null, 2)}\n`, { mode: 0o600 });
	const input = { task: pass.goal, outputSchema: normalizeOutputSchema(pass.schema), contextFile };
	if (!current(db, job)) throw new ReviewStop("The review no longer owns this attempt");
	db.prepare(
		`insert into review_attempts (id, review_id, generation, plan_revision, pass_id, kind, program_id, person, role, policy, input, input_key, reviewer, fork_file, state, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?)`,
	).run(
		id,
		job.id,
		job.generation,
		job.planRevision,
		pass.id,
		pass.kind,
		programId,
		person,
		pass.role,
		JSON.stringify(policy),
		JSON.stringify(input),
		inputKey,
		JSON.stringify(reviewer),
		worker?.file ?? null,
		Date.now(),
	);
	let program: PeerProgram | undefined;
	let output: unknown;
	let failure: unknown;
	let cleaned = false;
	let cancelled = false;
	const saveResult = (result: TurnResult) => {
		if (!db.isOpen) return;
		const record = {
			status: result.status,
			text: result.text,
			value: result.value,
			error: result.error,
			stopReason: result.stopReason,
			usage: result.usage,
			changes: result.changes,
		};
		db.prepare("update review_attempts set result = ?, state = 'cleaning' where id = ?").run(
			JSON.stringify(record),
			id,
		);
	};
	try {
		program = await openPeerProgram(job.owner, signal, { paths, id: programId });
		const receipt = await watchedTurn(db, program, person, signal, async (peer, configured) => {
			const started = await peer.command(
				person,
				{
					kind: "start",
					role: pass.role,
					...(!worker && policy.profile ? { profile: policy.profile } : {}),
					goal: { by: job.owner, text: pass.goal },
				},
				{ signal, commandId: `${id}:start` },
			);
			if (started.stage !== "applied") throw new Error(started.reason ?? "The reviewer did not start");
			signal.throwIfAborted();
			if (pass.thinking) await setThinking(peer, person, pass.thinking, `${id}:thinking`, signal);
			const observed = db
				.prepare("select role, model, thinking_level as thinking, session_file as file from sessions where id = ?")
				.get(person) as { role: string | null; model: string | null; thinking: string | null; file: string | null };
			db.prepare(
				"update review_attempts set model = ?, thinking = ?, session_file = ?, state = 'running' where id = ?",
			).run(observed.model, pass.thinking ?? observed.thinking, observed.file, id);
			if (worker?.model && observed.model !== worker.model)
				throw new ReviewStop("The fork did not retain the assigned worker's model; no review turn was sent");
			if (
				!worker &&
				(observed.role !== pass.role || !candidates.some((candidate) => candidate.model === observed.model))
			)
				throw new ReviewStop("The reviewer did not select its recorded role/model policy; no review turn was sent");
			if (JSON.stringify(resolve()) !== JSON.stringify(policy))
				throw new ReviewStop("The review policy changed during startup; no review turn was sent");
			configured();
			return peer.command(
				person,
				{ kind: "run_turn", ...input },
				{ signal, commandId: `${id}:turn`, result: saveResult },
			);
		});
		if (receipt.stage !== "applied" || receipt.result?.status !== "completed")
			throw new Error(receipt.reason ?? receipt.result?.error ?? "The review turn did not complete");
		await verified(verifyCapturedSource, artifact, signal);
		if (JSON.stringify(resolve()) !== JSON.stringify(policy))
			throw new ReviewStop("The review policy changed during the turn; resume to obtain current-policy evidence");
		const value = receipt.result.value;
		output = pass.validate(pass.fromTool ? pass.fromTool(checkShape(pass.schema as TSchema, value)) : value);
		storeOutput(db, job, id, output);
	} catch (error) {
		failure = error;
		cancelled = signal.aborted && (error === signal.reason || (error as Error)?.name === "AbortError");
	} finally {
		try {
			if (program) await program.close();
			cleaned = true;
		} catch (error) {
			failure = new ReviewStop(`${failure ? `${message(failure)}; ` : ""}Reviewer cleanup: ${message(error)}`);
		}
	}
	if (!db.isOpen) throw failure ?? new Error("The runtime stopped before the attempt settled");
	cleaned = cleaned && !db.prepare("select 1 from program_scopes where id = ?").get(programId);
	if (!cleaned)
		failure = new ReviewStop(
			`${failure ? `${message(failure)}; ` : ""}The attempt still owns resources; inspect its pending cleanup`,
		);
	const eligible = current(db, job) && !signal.aborted;
	if (!failure && signal.aborted) cancelled = true;
	if (!eligible && !failure) failure = new ReviewStop("The attempt was interrupted or superseded");
	const state = !cleaned ? "interrupted" : failure ? (cancelled ? "cancelled" : "failed") : "completed";
	db.prepare("update review_attempts set state = ?, reason = ?, finished_at = ? where id = ?").run(
		state,
		failure ? message(failure) : null,
		Date.now(),
		id,
	);
	if (failure) throw failure;
	return { attempt: id, output };
}

function storeOutput(db: DatabaseSync, job: ReviewJob, id: string, output: unknown): void {
	if (!current(db, job)) throw new ReviewStop("The review no longer owns this output");
	db.prepare("update review_attempts set output = ? where id = ?").run(JSON.stringify(output), id);
}

function current(db: DatabaseSync, job: ReviewJob): boolean {
	return (
		db.isOpen &&
		Boolean(
			db
				.prepare(
					"select 1 from review_jobs where id = ? and generation = ? and plan_revision = ? and state = 'running'",
				)
				.get(job.id, job.generation, job.planRevision),
		)
	);
}
function rolePolicy(source: string, role: string, depth: ReviewDepth | undefined) {
	try {
		return reviewRolePolicy(source, role, depth);
	} catch (error) {
		throw new ReviewStop(message(error));
	}
}

async function watchedTurn<T>(
	db: DatabaseSync,
	program: PeerProgram,
	person: string,
	signal: AbortSignal,
	turn: (program: PeerProgram, configured: () => void) => Promise<T>,
): Promise<T> {
	const started = Date.now();
	let silent = false;
	let configuring = true;
	const abandon = () => {
		if (configuring) void program.close().catch(() => {});
	};
	signal.addEventListener("abort", abandon, { once: true });
	const stopWatching = watchSilence(
		() => {
			if (!db.isOpen) return Date.now();
			const row = db.prepare("select updated_at from sessions where id = ?").get(person) as
				| { updated_at: number }
				| undefined;
			return Math.max(started, row?.updated_at ?? 0);
		},
		() => {
			silent = true;
			void program.close().catch(() => {});
		},
	);
	const stalled = () =>
		new Error(`The reviewer showed no activity for ${REVIEWER_SILENCE_MS / 60_000} minutes, so its turn was stopped`);
	let result: T;
	try {
		result = await turn(program, () => {
			configuring = false;
		});
	} catch (error) {
		if (signal.aborted) throw signal.reason;
		throw silent ? stalled() : error;
	} finally {
		signal.removeEventListener("abort", abandon);
		stopWatching();
	}
	if (silent) throw stalled();
	return result;
}

async function setThinking(
	program: PeerProgram,
	person: string,
	level: string,
	commandId: string,
	signal: AbortSignal,
): Promise<void> {
	const receipt = await program.command(person, { kind: "set_thinking", level }, { signal, commandId });
	if (receipt.stage !== "applied") throw new Error(receipt.reason ?? "The reviewer did not take its thinking level");
}

async function verified<T>(
	check: (artifact: T, signal: AbortSignal) => Promise<unknown>,
	artifact: T,
	signal: AbortSignal,
): Promise<void> {
	try {
		await check(artifact, signal);
	} catch (error) {
		throw signal.aborted ? error : new ReviewStop(message(error));
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
