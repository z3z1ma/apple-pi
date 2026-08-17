import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { RalphRun, ReceiptEvent, RunSummary } from "./types.js";
import { taskLocation } from "./task-paths.js";

const STATES = new Set([
	"ready",
	"executing",
	"reviewing",
	"judging",
	"iterating",
	"done",
	"blocked",
	"review_failed",
	"evidence_failed",
	"workspace_conflict",
	"authority_required",
	"budget_exhausted",
	"compacted",
	"interrupted",
	"stopped",
	"error",
]);
const TERMINAL = new Set([
	"done",
	"blocked",
	"review_failed",
	"evidence_failed",
	"workspace_conflict",
	"authority_required",
	"budget_exhausted",
	"compacted",
	"interrupted",
	"stopped",
	"error",
]);
const TERMINAL_CAUSES = new Set([
	"operator_stop",
	"judge_stop",
	"external_cancellation",
	"elapsed_time_ceiling",
	"aggregate_token_ceiling",
	"iteration_ceiling",
	"role_turn_ceiling",
	"compaction",
	"provider_error",
	"invalid_output",
	"authority_denial",
	"workspace_conflict",
	"review_failure",
	"evidence_failure",
	"blocked",
	"internal_error",
]);
const TRANSITIONS: Record<string, Set<string>> = {
	ready: new Set(["ready", "executing", ...TERMINAL]),
	executing: new Set(["executing", "reviewing", ...TERMINAL]),
	reviewing: new Set(["reviewing", "judging", ...TERMINAL]),
	judging: new Set(["judging", "iterating", "done", ...TERMINAL]),
	iterating: new Set(["iterating", "executing", ...TERMINAL]),
};

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function validateSnapshot(value: RalphRun["expectedWorkspace"], label: string): void {
	if (!value || typeof value !== "object" || !/^[a-f0-9]{40,64}$/.test(value.head) || typeof value.branch !== "string")
		throw new Error(`${label} is invalid`);
	if (
		!/^[a-f0-9]{64}$/.test(value.indexHash) ||
		!/^[a-f0-9]{64}$/.test(value.statusHash) ||
		!/^[a-f0-9]{64}$/.test(value.hash)
	)
		throw new Error(`${label} hashes are invalid`);
	if (!Array.isArray(value.entries)) throw new Error(`${label}.entries is invalid`);
	let prior = "";
	for (const entry of value.entries) {
		if (
			!entry ||
			typeof entry.path !== "string" ||
			entry.path <= prior ||
			!["file", "symlink", "directory"].includes(entry.kind) ||
			!/^[a-f0-9]{64}$/.test(entry.digest)
		)
			throw new Error(`${label} entry is invalid`);
		prior = entry.path;
	}
	const expected = sha256(
		JSON.stringify({
			head: value.head,
			branch: value.branch,
			indexHash: value.indexHash,
			statusHash: value.statusHash,
			entries: value.entries,
		}),
	);
	if (expected !== value.hash) throw new Error(`${label} hash does not match its contents`);
}

function substantive(value: string): boolean {
	const normalized = value.trim();
	return (
		normalized.length >= 12 &&
		!/^(?:none|n\/?a|todo|pending|tbd|not yet|will be|do it)(?:\b|[.:])/i.test(normalized) &&
		!/^no\.?$/i.test(normalized)
	);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	return JSON.stringify(keys) === JSON.stringify([...expected].sort());
}

function validateWorkItems(event: ReceiptEvent): void {
	const value = event.workItems;
	const label = `Receipt event ${event.sequence} workItems`;
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
	const validateIds = (ids: string[] | undefined, field: string) => {
		if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !/^WI-\d{3}$/.test(id)))
			throw new Error(`${label}.${field} is invalid`);
	};
	if (hasExactKeys(value, ["proposals"])) {
		if (
			event.stage !== "executor" ||
			event.state !== "executing" ||
			!["done", "partial", "blocked", "failed"].includes(event.outcome ?? "") ||
			!Array.isArray(value.proposals) ||
			value.proposals.some(
				(item) =>
					!item ||
					typeof item !== "object" ||
					!hasExactKeys(item, ["id", "evidence"]) ||
					!/^WI-\d{3}$/.test(item.id) ||
					typeof item.evidence !== "string" ||
					!substantive(item.evidence),
			)
		)
			throw new Error(`${label} has invalid proposal event`);
		return;
	}
	if (hasExactKeys(value, ["judgments"])) {
		if (
			event.stage !== "judge" ||
			event.state !== "judging" ||
			!["close", "iterate", "blocked", "stop"].includes(event.outcome ?? "") ||
			!Array.isArray(value.judgments) ||
			value.judgments.some(
				(item) =>
					!item ||
					typeof item !== "object" ||
					!hasExactKeys(item, ["id", "decision", "reason"]) ||
					!/^WI-\d{3}$/.test(item.id) ||
					!["confirmed", "rejected"].includes(item.decision) ||
					typeof item.reason !== "string" ||
					!substantive(item.reason),
			)
		)
			throw new Error(`${label} has invalid judgment event`);
		return;
	}
	if (
		!hasExactKeys(value, ["confirmedIds", "rejectedIds", "taskDigest"]) ||
		event.stage !== "judge" ||
		event.state !== "judging" ||
		event.outcome !== "work_items_applied"
	)
		throw new Error(`${label} has invalid envelope`);
	validateIds(value.confirmedIds, "confirmedIds");
	validateIds(value.rejectedIds, "rejectedIds");
	if (typeof value.taskDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.taskDigest))
		throw new Error(`${label}.taskDigest is invalid`);
}

function validateRunState(run: RalphRun, event: ReceiptEvent, genesis?: RalphRun, previous?: RalphRun): void {
	if (
		run?.schemaVersion !== 2 ||
		run.runId !== event.runId ||
		run.projectRoot !== event.projectRoot ||
		run.ledgerRoot !== event.ledgerRoot ||
		run.taskPath !== event.taskPath ||
		run.mode !== event.mode ||
		run.state !== event.state ||
		run.iteration !== event.iteration
	)
		throw new Error(`Receipt event ${event.sequence} has inconsistent run state`);
	if (!taskLocation(run.taskPath) || !isAbsolute(run.ledgerRoot) || normalize(run.ledgerRoot) !== run.ledgerRoot)
		throw new Error(`Receipt event ${event.sequence} has invalid task or ledger path`);
	for (const [name, value] of [
		["lastOutcome", run.lastOutcome],
		["activeAgentId", run.activeAgentId],
	] as const) {
		if (value !== undefined && (typeof value !== "string" || value.length > 20_000))
			throw new Error(`Receipt event ${event.sequence} has invalid ${name}`);
	}
	if (
		!STATES.has(run.state) ||
		!["step", "auto"].includes(run.mode) ||
		!Number.isInteger(run.iteration) ||
		run.iteration < 0 ||
		!Number.isFinite(run.totalTokens) ||
		run.totalTokens < 0
	)
		throw new Error(`Receipt event ${event.sequence} has invalid run values`);
	if (run.terminalCause !== undefined && !TERMINAL_CAUSES.has(run.terminalCause))
		throw new Error(`Receipt event ${event.sequence} has invalid terminal cause`);
	if (
		!/^[a-f0-9]{64}$/.test(run.graphHash) ||
		!Number.isFinite(Date.parse(run.startedAt)) ||
		!Number.isFinite(Date.parse(run.updatedAt))
	)
		throw new Error(`Receipt event ${event.sequence} has invalid hashes or timestamps`);
	if (
		run.nextObjective !== undefined &&
		(typeof run.nextObjective !== "string" || !run.nextObjective.trim() || run.nextObjective.length > 10_000)
	)
		throw new Error(`Receipt event ${event.sequence} has invalid next objective`);
	validateWorkItems(event);
	if (
		run.policy !== undefined &&
		(run.policy.version !== 1 ||
			run.policy.mode !== run.mode ||
			!Number.isInteger(run.policy.recordCount) ||
			run.policy.recordCount < 1 ||
			!Number.isInteger(run.policy.contextBytes) ||
			run.policy.contextBytes < 1 ||
			JSON.stringify(run.policy.budgets) !== JSON.stringify(run.budgets))
	) {
		throw new Error(`Receipt event ${event.sequence} has inconsistent resolved policy`);
	}
	const budgets = run.budgets;
	const budgetKeys = [
		"executorMaxTurns",
		"judgeMaxTurns",
		"maxIterations",
		"maxTokens",
		"reviewerMaxTurns",
		"timeoutSeconds",
	];
	if (!budgets || JSON.stringify(Object.keys(budgets).sort()) !== JSON.stringify(budgetKeys))
		throw new Error(`Receipt event ${event.sequence} has incomplete budgets`);
	const ranges: Record<string, [number, number]> = {
		maxIterations: [1, 100],
		maxTokens: [10_000, 10_000_000],
		timeoutSeconds: [60, 86_400],
		executorMaxTurns: [1, 500],
		reviewerMaxTurns: [1, 200],
		judgeMaxTurns: [1, 200],
	};
	for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
		const value = (budgets as unknown as Record<string, number>)[key];
		if (!Number.isInteger(value) || value < minimum || value > maximum)
			throw new Error(`Receipt event ${event.sequence} has invalid budget ${key}`);
	}
	if (run.baselineWorkspace !== undefined) validateSnapshot(run.baselineWorkspace, "baselineWorkspace");
	if (run.expectedWorkspace !== undefined) validateSnapshot(run.expectedWorkspace, "expectedWorkspace");
	if (
		genesis &&
		(run.projectRoot !== genesis.projectRoot ||
			run.ledgerRoot !== genesis.ledgerRoot ||
			run.taskPath !== genesis.taskPath ||
			run.mode !== genesis.mode ||
			run.startedAt !== genesis.startedAt ||
			JSON.stringify(run.budgets) !== JSON.stringify(genesis.budgets) ||
			run.baselineWorkspace?.hash !== genesis.baselineWorkspace?.hash)
	)
		throw new Error(`Receipt event ${event.sequence} changed immutable run metadata`);
	if (previous) {
		if (TERMINAL.has(previous.state))
			throw new Error(`Receipt event ${event.sequence} follows terminal state ${previous.state}`);
		if (!TRANSITIONS[previous.state]?.has(run.state))
			throw new Error(`Illegal Ralph transition ${previous.state} -> ${run.state}`);
		const startsIteration = (previous.state === "ready" || previous.state === "iterating") && run.state === "executing";
		if (run.iteration !== previous.iteration + (startsIteration ? 1 : 0))
			throw new Error(`Receipt event ${event.sequence} has invalid iteration progression`);
		if (run.totalTokens < previous.totalTokens)
			throw new Error(`Receipt event ${event.sequence} decreased lifetime token usage`);
	}
}

function validateWorkItemHistory(events: ReceiptEvent[]): void {
	const proposals = new Map<number, string[]>();
	const judgments = new Map<number, Map<string, "confirmed" | "rejected">>();
	const appliedIterations = new Set<number>();
	for (const event of events) {
		const workItems = event.workItems;
		if (!workItems) continue;
		if (workItems.proposals) {
			const ids = workItems.proposals.map((item) => item.id);
			if (new Set(ids).size !== ids.length || proposals.has(event.iteration))
				throw new Error(`Receipt event ${event.sequence} has duplicate work-item proposals`);
			proposals.set(event.iteration, ids);
		}
		if (workItems.judgments) {
			if (judgments.has(event.iteration))
				throw new Error(`Receipt event ${event.sequence} repeats work-item judgments`);
			const expected = proposals.get(event.iteration);
			const ids = workItems.judgments.map((item) => item.id);
			if (
				!expected ||
				new Set(ids).size !== ids.length ||
				ids.length !== expected.length ||
				ids.some((id) => !expected.includes(id))
			)
				throw new Error(`Receipt event ${event.sequence} does not assess work-item proposals exactly`);
			judgments.set(event.iteration, new Map(workItems.judgments.map((item) => [item.id, item.decision])));
		}
		if (workItems.confirmedIds || workItems.rejectedIds || workItems.taskDigest) {
			if (appliedIterations.has(event.iteration))
				throw new Error(`Receipt event ${event.sequence} repeats applied work-item state`);
			const assessed = judgments.get(event.iteration);
			const confirmed = workItems.confirmedIds ?? [];
			const rejected = workItems.rejectedIds ?? [];
			const applied = [...confirmed, ...rejected];
			if (
				!assessed ||
				!workItems.taskDigest ||
				new Set(applied).size !== applied.length ||
				applied.length !== assessed.size ||
				confirmed.some((id) => assessed.get(id) !== "confirmed") ||
				rejected.some((id) => assessed.get(id) !== "rejected")
			) {
				throw new Error(`Receipt event ${event.sequence} has invalid applied work-item state`);
			}
			appliedIterations.add(event.iteration);
		}
	}
}

function projectKey(projectRoot: string) {
	return createHash("sha256").update(realpathSync(projectRoot)).digest("hex").slice(0, 24);
}

export function runDirectory(projectRoot: string): string {
	return join(getAgentDir(), "ralph", "runs", projectKey(projectRoot));
}

export function receiptPath(projectRoot: string, runId: string): string {
	if (!/^[a-f0-9-]{8,64}$/.test(runId)) throw new Error(`Invalid Ralph run ID: ${runId}`);
	return join(runDirectory(projectRoot), `${runId}.jsonl`);
}

export function readReceiptEvents(projectRoot: string, runId: string): ReceiptEvent[] {
	const path = receiptPath(projectRoot, runId);
	if (!existsSync(path)) throw new Error(`Ralph run not found: ${runId}`);
	const events: ReceiptEvent[] = [];
	let genesis: RalphRun | undefined;
	let previous: RalphRun | undefined;
	for (const [index, line] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		let event: ReceiptEvent;
		try {
			event = JSON.parse(line) as ReceiptEvent;
		} catch {
			throw new Error(`Invalid receipt JSON at ${path}:${index + 1}`);
		}
		if ((event as { schemaVersion?: number }).schemaVersion === 1 && event.runId === runId)
			throw new Error("Legacy Ralph receipt schema v1 is audit-only and cannot resume a .ledger task run");
		if (
			event.schemaVersion !== 2 ||
			event.runId !== runId ||
			event.projectRoot !== realpathSync(projectRoot) ||
			event.sequence !== events.length + 1 ||
			!event.run
		) {
			throw new Error(`Invalid receipt sequence at ${path}:${index + 1}`);
		}
		validateRunState(event.run, event, genesis, previous);
		genesis ??= event.run;
		previous = event.run;
		events.push(event);
		validateWorkItemHistory(events);
	}
	return events;
}

export function loadRun(projectRoot: string, runId: string): RalphRun {
	const events = readReceiptEvents(projectRoot, runId);
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (event?.run) return event.run;
	}
	throw new Error(`Ralph receipt has no recoverable run state: ${runId}`);
}

export async function appendReceipt(
	run: RalphRun,
	event: Omit<
		ReceiptEvent,
		| "schemaVersion"
		| "sequence"
		| "timestamp"
		| "runId"
		| "projectRoot"
		| "ledgerRoot"
		| "taskPath"
		| "mode"
		| "state"
		| "iteration"
		| "run"
	>,
): Promise<ReceiptEvent> {
	const directory = runDirectory(run.projectRoot);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = receiptPath(run.projectRoot, run.runId);
	return withFileMutationQueue(path, async () => {
		const priorEvents = existsSync(path) ? readReceiptEvents(run.projectRoot, run.runId) : [];
		const sequence = priorEvents.length + 1;
		const value: ReceiptEvent = {
			schemaVersion: 2,
			sequence,
			timestamp: new Date().toISOString(),
			runId: run.runId,
			projectRoot: run.projectRoot,
			ledgerRoot: run.ledgerRoot,
			taskPath: run.taskPath,
			mode: run.mode,
			state: run.state,
			iteration: run.iteration,
			...event,
			run,
		};
		validateRunState(run, value, priorEvents[0]?.run, priorEvents.at(-1)?.run);
		validateWorkItemHistory([...priorEvents, value]);
		appendFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		return value;
	});
}

export function listRunSummaries(projectRoot: string): RunSummary[] {
	const directory = runDirectory(projectRoot);
	if (!existsSync(directory)) return [];
	const summaries: RunSummary[] = [];
	for (const file of readdirSync(directory)
		.filter((name) => name.endsWith(".jsonl"))
		.sort()) {
		const runId = file.slice(0, -".jsonl".length);
		const firstLine = readFileSync(join(directory, file), "utf8")
			.split(/\r?\n/)
			.find((line) => line.trim());
		if (firstLine) {
			let first: { schemaVersion?: unknown; runId?: unknown };
			try {
				first = JSON.parse(firstLine) as { schemaVersion?: unknown; runId?: unknown };
			} catch {
				throw new Error(`Invalid receipt JSON at ${join(directory, file)}:1`);
			}
			if (first.schemaVersion === 1 && first.runId === runId) continue;
		}
		const run = loadRun(projectRoot, runId);
		summaries.push({
			runId,
			state: run.state,
			iteration: run.iteration,
			ledgerRoot: run.ledgerRoot,
			taskPath: run.taskPath,
			lastOutcome: run.lastOutcome,
			nextObjective: run.nextObjective,
			totalTokens: run.totalTokens,
			receiptPath: receiptPath(projectRoot, runId),
		});
	}
	return summaries.sort((a, b) => b.runId.localeCompare(a.runId));
}
