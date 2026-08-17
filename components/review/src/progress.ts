import type { HarnessBoundedActivity } from "../../subagents/src/service.js";
import type {
	ReviewFocus,
	ReviewFocusProgress,
	ReviewFocusProgressState,
	ReviewPartition,
	ReviewProgressSnapshot,
	ReviewReceiptStage,
	ReviewRoleProgressStatus,
	ReviewRun,
	ReviewTerminalState,
} from "./types.js";

const TERMINAL = new Set<string>([
	"complete",
	"partial",
	"failed",
	"skipped",
	"stopped",
	"workspace_conflict",
	"error",
]);

export function reviewProgressIdentity(snapshot: ReviewProgressSnapshot): string {
	return [
		snapshot.runId,
		snapshot.projectRoot,
		JSON.stringify(snapshot.source),
		snapshot.profile,
		snapshot.startedAt,
	].join("\0");
}

export interface ReviewLiveProgress {
	sequence: number;
	stage?: ReviewReceiptStage;
	cycleIndex?: number;
	plannerStatus?: ReviewRoleProgressStatus;
	verifierStatus?: ReviewRoleProgressStatus;
	focusStates?: Map<string, ReviewFocusProgressState>;
	plannerActivity?: HarnessBoundedActivity;
	verifierActivity?: HarnessBoundedActivity;
	focusActivity?: Map<string, HarnessBoundedActivity>;
}

export function buildReviewProgressSnapshot(run: ReviewRun, live: ReviewLiveProgress): ReviewProgressSnapshot {
	const cycles = run.workGraph?.cycles ?? [];
	const current = live.cycleIndex ?? cycles.at(-1)?.index ?? 0;
	const cycle = cycles.find((record) => record.index === current);
	const partitions = cycle?.partitions ?? cycles.flatMap((record) => record.partitions);
	const focuses = cycle?.focuses ?? cycles.flatMap((record) => record.focuses);
	const completed = new Set(run.completedItemIds);
	const findings = (run.rawFindings ?? run.findings).filter((finding) => !current || finding.cycle === current);
	const notes = (run.notes ?? []).filter((note) => !current || note.cycle === current);
	const visible = run.findings.filter((finding) => finding.validation.status !== "rejected");
	return {
		runId: run.runId,
		projectRoot: run.projectRoot,
		source: structuredClone(run.source),
		profile: run.profile,
		sequence: live.sequence,
		startedAt: run.startedAt,
		updatedAt: run.updatedAt,
		state: run.state,
		...(live.stage && { stage: live.stage }),
		cycleIndex: current,
		cycleCap: run.budgets.maxCycles,
		policy: {
			profile: run.profile,
			selectedItems: run.selected.length,
			maxCycles: run.budgets.maxCycles,
			maxFocuses: run.budgets.maxFocuses,
			maxConcurrency: run.budgets.maxConcurrency,
		},
		usage: { totalTokens: run.totalTokens },
		planner: {
			status: live.plannerStatus ?? (cycles.length > 0 ? "completed" : run.state === "planning" ? "running" : "idle"),
			...(live.plannerActivity && { activity: structuredClone(live.plannerActivity) }),
		},
		verifier: {
			status:
				live.verifierStatus ??
				(run.metaReviews?.some((meta) => meta.cycle === current)
					? "completed"
					: run.state === "verifying"
						? "running"
						: "idle"),
			...(live.verifierActivity && { activity: structuredClone(live.verifierActivity) }),
		},
		partitions: partitions.map((partition) => partitionProgress(partition, completed)),
		focuses: focuses.map((focus) =>
			focusProgress(focus, live.focusStates?.get(focus.id), live.focusActivity?.get(focus.id), findings),
		),
		findings: visible.map((finding) => ({
			id: finding.id,
			cycle: finding.cycle,
			severity: finding.severity,
			path: finding.path,
			summary: finding.summary,
			validation: finding.validation.status,
		})),
		notes: notes.map((note) => ({ id: note.id, cycle: note.cycle, summary: note.summary })),
		verifierDecisions: findings.map((finding) => ({ findingId: finding.id, status: finding.validation.status })),
		...(cycle?.metaReview && { metaReview: structuredClone(cycle.metaReview) }),
		failures: structuredClone(run.failures),
		residualRisk: [...run.residualRisk],
		coverage: {
			selected: run.selected.length,
			completed: run.completedItemIds.length,
			failed: run.failures.length,
			waived: run.waived.length,
		},
		...(TERMINAL.has(run.state) && {
			terminalOutcome: {
				state: run.state as ReviewTerminalState,
				...(run.terminalCause && { cause: run.terminalCause }),
				...(run.lastOutcome && { lastOutcome: run.lastOutcome }),
			},
		}),
	};
}

function partitionProgress(partition: ReviewPartition, completed: Set<string>) {
	return {
		id: partition.id,
		title: partition.title,
		itemCount: partition.itemIds.length,
		completedItemCount: partition.itemIds.filter((id) => completed.has(id)).length,
	};
}

function focusProgress(
	focus: ReviewFocus,
	state: ReviewFocusProgressState | undefined,
	activity: HarnessBoundedActivity | undefined,
	findings: Array<{ focusId: string }>,
): ReviewFocusProgress {
	return {
		id: focus.id,
		partitionId: focus.partitionId,
		title: focus.title,
		state: state ?? "queued",
		findingCount: findings.filter((finding) => finding.focusId === focus.id).length,
		...(activity && { activity: structuredClone(activity) }),
	};
}
