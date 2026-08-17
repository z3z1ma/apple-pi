import type { ReviewProgressSnapshot } from "../../review/src/types.js";
import type { HarnessBoundedActivity } from "../../subagents/src/service.js";
import type { WorkItem } from "./task-document.js";
import type {
	RalphProgressSnapshot,
	RalphRun,
	RalphTerminalState,
	RalphWorkItemSnapshot,
	WorkItemReceipt,
} from "./types.js";

const TERMINAL = new Set<string>([
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

export function ralphProgressIdentity(snapshot: RalphProgressSnapshot): string {
	return [snapshot.runId, snapshot.projectRoot, snapshot.ledgerRoot, snapshot.taskPath, snapshot.startedAt].join("\0");
}

export interface RalphLiveProgress {
	sequence: number;
	activity?: HarnessBoundedActivity;
	workItems?: WorkItem[];
	workItemReceipt?: WorkItemReceipt;
	review?: ReviewProgressSnapshot;
	nestedReviewRunId?: string;
	gate?: { kind: RalphTerminalState; reason: string };
}

export function buildRalphProgressSnapshot(run: RalphRun, live: RalphLiveProgress): RalphProgressSnapshot {
	return {
		runId: run.runId,
		projectRoot: run.projectRoot,
		ledgerRoot: run.ledgerRoot,
		taskPath: run.taskPath,
		sequence: live.sequence,
		startedAt: run.startedAt,
		updatedAt: run.updatedAt,
		state: run.state,
		...(run.state === "executing"
			? { stage: "executor" }
			: run.state === "reviewing"
				? { stage: "reviewer" }
				: run.state === "judging"
					? { stage: "judge" }
					: {}),
		iteration: run.iteration,
		mode: run.mode,
		usage: { totalTokens: run.totalTokens },
		policy: {
			mode: run.mode,
			...(run.policy?.recordCount !== undefined && { recordCount: run.policy.recordCount }),
			...(run.policy?.contextBytes !== undefined && { contextBytes: run.policy.contextBytes }),
		},
		...(live.activity && { activity: structuredClone(live.activity) }),
		workItems: workItemSnapshot(live.workItems ?? [], live.workItemReceipt),
		...(live.review && { review: structuredClone(live.review) }),
		...(live.nestedReviewRunId && { nestedReviewRunId: live.nestedReviewRunId }),
		...(run.nextObjective && { nextObjective: run.nextObjective }),
		...(live.gate && { gate: structuredClone(live.gate) }),
		...(TERMINAL.has(run.state) && {
			terminalOutcome: {
				state: run.state as RalphTerminalState,
				...(run.terminalCause && { cause: run.terminalCause }),
				...(run.lastOutcome && { lastOutcome: run.lastOutcome }),
			},
		}),
	};
}

function workItemSnapshot(items: WorkItem[], receipt?: WorkItemReceipt): RalphWorkItemSnapshot {
	return {
		open: items.filter((item) => item.state === "open").length,
		complete: items.filter((item) => item.state === "complete").length,
		cancelled: items.filter((item) => item.state === "cancelled").length,
		total: items.length,
		items: items.slice(0, 20).map((item) => ({
			id: item.id,
			state: item.state,
			description: item.description,
		})),
		...(receipt?.proposals && { proposals: receipt.proposals.map((item) => item.id) }),
		...(receipt?.confirmedIds && { confirmedIds: [...receipt.confirmedIds] }),
		...(receipt?.rejectedIds && { rejectedIds: [...receipt.rejectedIds] }),
	};
}
