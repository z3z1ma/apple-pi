import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { verifyArtifact } from "../../code-review/src/capture.js";
import type { ReviewJob } from "../../code-review/src/operations.js";
import { loadRoles, parseRoleModel } from "../../organization/src/roles.js";
import { isInferenceProfileName, loadModelProfiles } from "../../shared/src/model-profiles.js";
import { normalizeOutputSchema } from "../../shared/src/structured-output.js";
import type { TurnResult } from "../../shared/src/turn-observer.js";
import type { StatePaths } from "./paths.js";
import { openPeerProgram, type PeerProgram } from "./program-client.js";

export interface ReviewPassRequest {
	id: string;
	role: string;
	kind: "planner" | "focused" | "integration" | "validation";
	goal: string;
	context: unknown;
	schema: unknown;
	validate(value: unknown): unknown;
	reuse?(value: unknown): boolean;
}

/** The persisted attempt, not a requested cwd or a new security policy, owns this launch. */
export function reviewScope(
	db: DatabaseSync,
	program: string,
	caller: string,
): { attempt: string; person: string; role: string; source: string } | undefined {
	const known = db.prepare("select id from review_attempts where program_id = ?").get(program);
	if (!known) return undefined;
	const active = db
		.prepare(
			`select a.id as attempt, a.person, a.role, json_extract(j.artifact, '$.source') as source from review_attempts a join review_jobs j on j.id = a.review_id where a.program_id = ? and j.owner = ? and j.state = 'running' and a.generation = j.generation and a.plan_revision = j.plan_revision and a.state = 'starting'`,
		)
		.get(program, caller) as { attempt: string; person: string; role: string; source: string } | undefined;
	if (!active?.source) throw new Error("The review attempt no longer owns this launch");
	return active;
}

/** One ordinary peer turn, with durable identity before launch and guarded cleanup before completion. */
export async function runReviewAttempt(
	db: DatabaseSync,
	paths: StatePaths,
	job: ReviewJob,
	pass: ReviewPassRequest,
	signal: AbortSignal,
): Promise<unknown> {
	const artifact = job.artifact;
	if (!artifact) throw new Error("Review execution requires an admitted artifact");
	await verifyArtifact(artifact, signal);
	signal.throwIfAborted();
	const inputKey = createHash("sha256")
		.update(JSON.stringify({ role: pass.role, goal: pass.goal, context: pass.context, schema: pass.schema }))
		.digest("hex");
	const previous = db
		.prepare(
			"select output from review_attempts where review_id = ? and plan_revision = ? and pass_id = ? and input_key = ? and state = 'completed' order by created_at desc, rowid desc limit 1",
		)
		.get(job.id, job.planRevision, pass.id, inputKey) as { output: string } | undefined;
	if (previous) {
		const value = pass.validate(JSON.parse(previous.output));
		if (!pass.reuse || pass.reuse(value)) return value;
	}
	const role = loadRoles(artifact.source).roles.get(pass.role);
	if (!role || role.writes || role.manages) throw new Error(`Unavailable advisory review role: ${pass.role}`);
	const roleSource = readFileSync(role.path, "utf8");
	const roleHash = createHash("sha256").update(roleSource).digest("hex");
	const profileName = isInferenceProfileName(role.models[0]!) ? role.models[0]! : undefined;
	const profile = profileName ? loadModelProfiles({ optional: true })[profileName] : undefined;
	const candidates =
		profile?.models ?? (profileName ? role.models.slice(1) : role.models).map((entry) => parseRoleModel(entry)!);
	const policy = {
		role: { path: role.path, hash: roleHash, text: roleSource },
		profile: profileName ?? null,
		selection: profile?.selection ?? "ordered",
		candidates,
	};
	const id = randomUUID();
	const person = randomUUID();
	const programId = randomUUID();
	const directory = join(dirname(job.artifactDirectory), "attempts", id);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const contextFile = join(directory, "input.json");
	writeFileSync(contextFile, `${JSON.stringify(pass.context, null, 2)}\n`, { mode: 0o600 });
	const input = { task: pass.goal, outputSchema: normalizeOutputSchema(pass.schema), contextFile };
	if (!current(db, job)) throw new Error("The review no longer owns this attempt");
	db.prepare(
		`insert into review_attempts (id, review_id, generation, plan_revision, pass_id, kind, program_id, person, role, policy, input, input_key, state, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?)`,
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
		Date.now(),
	);
	let program: PeerProgram | undefined;
	let output: unknown;
	let failure: unknown;
	let cleaned = false;
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
		const started = await program.command(
			person,
			{ kind: "start", role: pass.role, goal: { by: job.owner, text: pass.goal } },
			{ signal, commandId: `${id}:start` },
		);
		if (started.stage !== "applied") throw new Error(started.reason ?? "The reviewer did not start");
		signal.throwIfAborted();
		const observed = db
			.prepare("select role, model, thinking_level as thinking, session_file as file from sessions where id = ?")
			.get(person) as { role: string | null; model: string | null; thinking: string | null; file: string | null };
		db.prepare(
			"update review_attempts set model = ?, thinking = ?, session_file = ?, state = 'running' where id = ?",
		).run(observed.model, observed.thinking, observed.file, id);
		if (observed.role !== pass.role || !candidates.some((candidate) => candidate.model === observed.model))
			throw new Error("The reviewer did not select its recorded role/model policy; no review turn was sent");
		if (createHash("sha256").update(readFileSync(role.path)).digest("hex") !== roleHash)
			throw new Error("The review role changed during startup; no review turn was sent");
		const receipt = await program.command(
			person,
			{ kind: "run_turn", ...input },
			{ signal, commandId: `${id}:turn`, result: saveResult },
		);
		if (receipt.stage !== "applied" || receipt.result?.status !== "completed")
			throw new Error(receipt.reason ?? receipt.result?.error ?? "The review turn did not complete");
		await verifyArtifact(artifact, signal);
		output = pass.validate(receipt.result.value);
		db.prepare("update review_attempts set output = ? where id = ?").run(JSON.stringify(output), id);
	} catch (error) {
		failure = error;
	} finally {
		try {
			if (program) await program.close();
			cleaned = true;
		} catch (error) {
			failure = new Error(`${failure ? `${message(failure)}; ` : ""}Reviewer cleanup: ${message(error)}`);
		}
	}
	if (!db.isOpen) throw failure ?? new Error("The runtime stopped before the attempt settled");
	cleaned = cleaned && !db.prepare("select 1 from program_scopes where id = ?").get(programId);
	if (!cleaned && !failure) failure = new Error("The attempt still owns resources; inspect its pending cleanup");
	const eligible = current(db, job) && !signal.aborted;
	if (!eligible && !failure) failure = new Error("The attempt was interrupted or superseded");
	const state = !cleaned ? "interrupted" : failure ? (signal.aborted ? "cancelled" : "failed") : "completed";
	db.prepare("update review_attempts set state = ?, reason = ?, finished_at = ? where id = ?").run(
		state,
		failure ? message(failure) : null,
		Date.now(),
		id,
	);
	if (failure) throw failure;
	return output;
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
function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
