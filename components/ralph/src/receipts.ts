import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { RalphRun, ReceiptEvent, RunSummary } from "./types.js";
import { taskLocation } from "./task-paths.js";

const STATES = new Set(["ready", "executing", "reviewing", "judging", "iterating", "done", "blocked", "review_failed", "evidence_failed", "workspace_conflict", "authority_required", "budget_exhausted", "compacted", "interrupted", "stopped", "error"]);
const TERMINAL = new Set(["done", "blocked", "review_failed", "evidence_failed", "workspace_conflict", "authority_required", "budget_exhausted", "compacted", "interrupted", "stopped", "error"]);
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
	if (!value || typeof value !== "object" || !/^[a-f0-9]{40,64}$/.test(value.head) || typeof value.branch !== "string") throw new Error(`${label} is invalid`);
	if (!/^[a-f0-9]{64}$/.test(value.indexHash) || !/^[a-f0-9]{64}$/.test(value.statusHash) || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error(`${label} hashes are invalid`);
	if (!Array.isArray(value.entries)) throw new Error(`${label}.entries is invalid`);
	let prior = "";
	for (const entry of value.entries) {
		if (!entry || typeof entry.path !== "string" || entry.path <= prior || !["file", "symlink", "directory"].includes(entry.kind) || !/^[a-f0-9]{64}$/.test(entry.digest)) throw new Error(`${label} entry is invalid`);
		prior = entry.path;
	}
	const expected = sha256(JSON.stringify({ head: value.head, branch: value.branch, indexHash: value.indexHash, statusHash: value.statusHash, entries: value.entries }));
	if (expected !== value.hash) throw new Error(`${label} hash does not match its contents`);
}

function validateRunState(run: RalphRun, event: ReceiptEvent, genesis?: RalphRun, previous?: RalphRun): void {
	if (!run || run.schemaVersion !== 2 || run.runId !== event.runId || run.projectRoot !== event.projectRoot || run.ledgerRoot !== event.ledgerRoot || run.taskPath !== event.taskPath || run.mode !== event.mode || run.state !== event.state || run.iteration !== event.iteration) throw new Error(`Receipt event ${event.sequence} has inconsistent run state`);
	if (!taskLocation(run.taskPath) || !isAbsolute(run.ledgerRoot) || normalize(run.ledgerRoot) !== run.ledgerRoot) throw new Error(`Receipt event ${event.sequence} has invalid task or ledger path`);
	for (const [name, value] of [["lastOutcome", run.lastOutcome], ["activeAgentId", run.activeAgentId]] as const) {
		if (value !== undefined && (typeof value !== "string" || value.length > 20_000)) throw new Error(`Receipt event ${event.sequence} has invalid ${name}`);
	}
	if (!STATES.has(run.state) || !["step", "auto"].includes(run.mode) || !Number.isInteger(run.iteration) || run.iteration < 0 || !Number.isFinite(run.totalTokens) || run.totalTokens < 0) throw new Error(`Receipt event ${event.sequence} has invalid run values`);
	if (!/^[a-f0-9]{64}$/.test(run.graphHash) || !Number.isFinite(Date.parse(run.startedAt)) || !Number.isFinite(Date.parse(run.updatedAt))) throw new Error(`Receipt event ${event.sequence} has invalid hashes or timestamps`);
	if (run.nextObjective !== undefined && (typeof run.nextObjective !== "string" || !run.nextObjective.trim() || run.nextObjective.length > 10_000)) throw new Error(`Receipt event ${event.sequence} has invalid next objective`);
	const budgets = run.budgets;
	const budgetKeys = ["executorMaxTurns", "judgeMaxTurns", "maxIterations", "maxTokens", "reviewerMaxTurns", "timeoutSeconds"];
	if (!budgets || JSON.stringify(Object.keys(budgets).sort()) !== JSON.stringify(budgetKeys)) throw new Error(`Receipt event ${event.sequence} has incomplete budgets`);
	const ranges: Record<string, [number, number]> = {
		maxIterations: [1, 100], maxTokens: [10_000, 10_000_000], timeoutSeconds: [60, 86_400],
		executorMaxTurns: [1, 500], reviewerMaxTurns: [1, 200], judgeMaxTurns: [1, 200],
	};
	for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
		const value = (budgets as unknown as Record<string, number>)[key];
		if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Receipt event ${event.sequence} has invalid budget ${key}`);
	}
	validateSnapshot(run.baselineWorkspace, "baselineWorkspace");
	validateSnapshot(run.expectedWorkspace, "expectedWorkspace");
	if (event.workspaceHashBefore !== undefined && event.workspaceHashBefore !== run.expectedWorkspace.hash) throw new Error(`Receipt event ${event.sequence} has inconsistent workspaceHashBefore`);
	if (event.workspaceHashAfter !== undefined && event.workspaceHashAfter !== run.expectedWorkspace.hash) throw new Error(`Receipt event ${event.sequence} has inconsistent workspaceHashAfter`);
	if (genesis && (run.projectRoot !== genesis.projectRoot || run.ledgerRoot !== genesis.ledgerRoot || run.taskPath !== genesis.taskPath || run.mode !== genesis.mode || run.startedAt !== genesis.startedAt || JSON.stringify(run.budgets) !== JSON.stringify(genesis.budgets) || run.baselineWorkspace.hash !== genesis.baselineWorkspace.hash)) throw new Error(`Receipt event ${event.sequence} changed immutable run metadata`);
	if (previous) {
		if (TERMINAL.has(previous.state)) throw new Error(`Receipt event ${event.sequence} follows terminal state ${previous.state}`);
		if (!TRANSITIONS[previous.state]?.has(run.state)) throw new Error(`Illegal Ralph transition ${previous.state} -> ${run.state}`);
		if (run.iteration < previous.iteration || run.iteration > previous.iteration + 1) throw new Error(`Receipt event ${event.sequence} has invalid iteration progression`);
		if (run.totalTokens < previous.totalTokens) throw new Error(`Receipt event ${event.sequence} decreased lifetime token usage`);
	}
}

function projectKey(projectRoot: string): string {
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
		if ((event as { schemaVersion?: number }).schemaVersion === 1 && event.runId === runId) throw new Error("Legacy Ralph receipt schema v1 is audit-only and cannot resume a .ledger task run");
		if (event.schemaVersion !== 2 || event.runId !== runId || event.projectRoot !== realpathSync(projectRoot) || event.sequence !== events.length + 1 || !event.run) {
			throw new Error(`Invalid receipt sequence at ${path}:${index + 1}`);
		}
		validateRunState(event.run, event, genesis, previous);
		genesis ??= event.run;
		previous = event.run;
		events.push(event);
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
	event: Omit<ReceiptEvent, "schemaVersion" | "sequence" | "timestamp" | "runId" | "projectRoot" | "ledgerRoot" | "taskPath" | "mode" | "state" | "iteration" | "run">,
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
		appendFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		return value;
	});
}

export function listRunSummaries(projectRoot: string): RunSummary[] {
	const directory = runDirectory(projectRoot);
	if (!existsSync(directory)) return [];
	const summaries: RunSummary[] = [];
	for (const file of readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort()) {
		const runId = file.slice(0, -".jsonl".length);
		const firstLine = readFileSync(join(directory, file), "utf8").split(/\r?\n/).find((line) => line.trim());
		if (firstLine) {
			let first: { schemaVersion?: unknown; runId?: unknown };
			try { first = JSON.parse(firstLine) as { schemaVersion?: unknown; runId?: unknown }; } catch { throw new Error(`Invalid receipt JSON at ${join(directory, file)}:1`); }
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
