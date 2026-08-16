import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ReviewReceiptEvent, ReviewRun, ReviewRunSummary } from "./types.js";

const STATES = new Set([
	"planning",
	"reviewing",
	"verifying",
	"complete",
	"partial",
	"failed",
	"skipped",
	"stopped",
	"workspace_conflict",
	"error",
]);
const TERMINAL_CAUSES = new Set([
	"operator_stop",
	"external_cancellation",
	"elapsed_time_ceiling",
	"aggregate_token_ceiling",
	"role_turn_ceiling",
	"compaction",
	"provider_error",
	"invalid_output",
	"authority_denial",
	"workspace_conflict",
	"policy_input",
	"internal_error",
]);
const TRANSITIONS: Record<string, Set<string>> = {
	planning: new Set(["planning", "reviewing", "failed", "skipped", "stopped", "workspace_conflict", "error"]),
	reviewing: new Set(["reviewing", "verifying", "partial", "failed", "stopped", "workspace_conflict", "error"]),
	verifying: new Set(["verifying", "complete", "partial", "failed", "stopped", "workspace_conflict", "error"]),
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: receipt validation deliberately enumerates every persisted run-state invariant.
function validateRun(
	run: ReviewRun,
	event: Pick<ReviewReceiptEvent, "runId" | "state" | "sequence">,
	genesis?: ReviewRun,
	previous?: ReviewRun,
): void {
	if (run?.schemaVersion !== 1 || run.runId !== event.runId || run.state !== event.state || !STATES.has(run.state)) {
		throw new Error(`Review receipt event ${event.sequence} has inconsistent run state`);
	}
	if (!/^[a-f0-9]{64}$/.test(run.inputHash) || !Number.isFinite(run.totalTokens) || run.totalTokens < 0) {
		throw new Error(`Review receipt event ${event.sequence} has invalid identity or usage`);
	}
	if (run.terminalCause !== undefined && !TERMINAL_CAUSES.has(run.terminalCause))
		throw new Error(`Review receipt event ${event.sequence} has invalid terminal cause`);
	if (run.policy !== undefined) {
		if (
			run.policy.version !== 1 ||
			run.policy.profile !== run.profile ||
			JSON.stringify(run.policy.budgets) !== JSON.stringify(run.budgets)
		) {
			throw new Error(`Review receipt event ${event.sequence} has inconsistent resolved policy`);
		}
	}
	const selected = new Set<string>();
	for (const item of run.selected) {
		if (!item.id || selected.has(item.id) || !item.path || !/^[a-f0-9]{64}$/.test(item.fingerprint))
			throw new Error(`Review receipt event ${event.sequence} has invalid selected coverage`);
		selected.add(item.id);
	}
	const completed = new Set<string>();
	for (const id of run.completedItemIds) {
		if (!selected.has(id) || completed.has(id))
			throw new Error(`Review receipt event ${event.sequence} has invalid completed coverage`);
		completed.add(id);
	}
	const failed = new Set<string>();
	for (const failure of run.failures) {
		if (!selected.has(failure.itemId) || failed.has(failure.itemId) || completed.has(failure.itemId))
			throw new Error(`Review receipt event ${event.sequence} has invalid failed coverage`);
		failed.add(failure.itemId);
	}
	if (run.workGraph) {
		const graphed = new Set<string>();
		for (const group of run.workGraph.groups)
			for (const id of group.itemIds) {
				if (!selected.has(id) || graphed.has(id))
					throw new Error(`Review receipt event ${event.sequence} has invalid work-graph coverage`);
				graphed.add(id);
			}
		if (graphed.size !== selected.size)
			throw new Error(`Review receipt event ${event.sequence} has incomplete work-graph coverage`);
	}
	const findingIds = new Set<string>();
	for (const finding of run.findings) {
		if (!finding.id || findingIds.has(finding.id))
			throw new Error(`Review receipt event ${event.sequence} has duplicate finding IDs`);
		findingIds.add(finding.id);
	}
	if (run.state === "complete" && (completed.size !== selected.size || failed.size !== 0))
		throw new Error("Complete review receipt has incomplete coverage");
	if (run.state === "skipped" && selected.size !== 0)
		throw new Error("Skipped review receipt selected reviewable items");
	if (run.state === "partial" && (completed.size === 0 || completed.size >= selected.size))
		throw new Error("Partial review receipt has inconsistent coverage");
	if (run.state === "failed" && completed.size !== 0)
		throw new Error("Failed review receipt contains completed coverage");
	if (genesis) {
		const immutable = ["projectRoot", "startedAt", "inputHash", "profile"] as const;
		for (const key of immutable)
			if (run[key] !== genesis[key]) throw new Error(`Review receipt event ${event.sequence} changed immutable ${key}`);
		if (
			JSON.stringify(run.source) !== JSON.stringify(genesis.source) ||
			JSON.stringify(run.budgets) !== JSON.stringify(genesis.budgets) ||
			JSON.stringify(run.routing) !== JSON.stringify(genesis.routing) ||
			JSON.stringify(run.selected) !== JSON.stringify(genesis.selected) ||
			JSON.stringify(run.waived) !== JSON.stringify(genesis.waived)
		) {
			throw new Error(`Review receipt event ${event.sequence} changed immutable run metadata`);
		}
	}
	if (previous) {
		const allowed = TRANSITIONS[previous.state];
		if (allowed && !allowed.has(run.state))
			throw new Error(`Illegal review transition ${previous.state} -> ${run.state}`);
		if (!allowed && previous.state !== run.state)
			throw new Error(`Review receipt event ${event.sequence} follows terminal state ${previous.state}`);
		if (run.totalTokens < previous.totalTokens)
			throw new Error(`Review receipt event ${event.sequence} decreased token usage`);
	}
}

function projectKey(projectRoot: string): string {
	return createHash("sha256").update(realpathSync(projectRoot)).digest("hex").slice(0, 24);
}

export function reviewRunDirectory(projectRoot: string): string {
	return join(getAgentDir(), "reviews", "runs", projectKey(projectRoot));
}

export function reviewReceiptPath(projectRoot: string, runId: string): string {
	if (!/^[a-f0-9-]{8,64}$/.test(runId)) throw new Error(`Invalid review run ID: ${runId}`);
	return join(reviewRunDirectory(projectRoot), `${runId}.jsonl`);
}

export function readReviewReceiptEvents(projectRoot: string, runId: string): ReviewReceiptEvent[] {
	const path = reviewReceiptPath(projectRoot, runId);
	if (!existsSync(path)) throw new Error(`Review run not found: ${runId}`);
	const events: ReviewReceiptEvent[] = [];
	let genesis: ReviewRun | undefined;
	let previous: ReviewRun | undefined;
	for (const [index, line] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		let event: ReviewReceiptEvent;
		try {
			event = JSON.parse(line) as ReviewReceiptEvent;
		} catch {
			throw new Error(`Invalid review receipt JSON at ${path}:${index + 1}`);
		}
		if (event.schemaVersion !== 1 || event.runId !== runId || event.sequence !== events.length + 1 || !event.run) {
			throw new Error(`Invalid review receipt sequence at ${path}:${index + 1}`);
		}
		validateRun(event.run, event, genesis, previous);
		genesis ??= event.run;
		previous = event.run;
		events.push(event);
	}
	return events;
}

export function loadReviewRun(projectRoot: string, runId: string): ReviewRun {
	const events = readReviewReceiptEvents(projectRoot, runId);
	const run = events[events.length - 1]?.run;
	if (!run) throw new Error(`Review receipt has no recoverable run state: ${runId}`);
	return run;
}

export async function appendReviewReceipt(
	run: ReviewRun,
	event: Omit<ReviewReceiptEvent, "schemaVersion" | "sequence" | "timestamp" | "runId" | "state" | "run">,
): Promise<ReviewReceiptEvent> {
	const directory = reviewRunDirectory(run.projectRoot);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = reviewReceiptPath(run.projectRoot, run.runId);
	return withFileMutationQueue(path, async () => {
		const prior = existsSync(path) ? readReviewReceiptEvents(run.projectRoot, run.runId) : [];
		const sequence = prior.length + 1;
		const value: ReviewReceiptEvent = {
			schemaVersion: 1,
			sequence,
			timestamp: new Date().toISOString(),
			runId: run.runId,
			state: run.state,
			...event,
			run,
		};
		validateRun(run, value, prior[0]?.run, prior.at(-1)?.run);
		appendFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		return value;
	});
}

export function listReviewRunSummaries(projectRoot: string): ReviewRunSummary[] {
	const directory = reviewRunDirectory(projectRoot);
	if (!existsSync(directory)) return [];
	const summaries: ReviewRunSummary[] = [];
	for (const file of readdirSync(directory)
		.filter((name) => name.endsWith(".jsonl"))
		.sort()) {
		const runId = file.slice(0, -".jsonl".length);
		try {
			const run = loadReviewRun(projectRoot, runId);
			summaries.push({
				runId,
				state: run.state,
				profile: run.profile,
				source: run.source,
				selected: run.selected.length,
				completed: run.completedItemIds.length,
				failed: run.failures.length,
				findings: run.findings.filter((finding) => finding.validation.status !== "rejected").length,
				totalTokens: run.totalTokens,
				updatedAt: run.updatedAt,
				receiptPath: reviewReceiptPath(projectRoot, runId),
			});
		} catch {
			// Direct status reports a corrupt receipt; summaries omit it.
		}
	}
	return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
