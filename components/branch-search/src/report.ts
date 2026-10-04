import type { SearchRecord } from "./record.js";
import type { DiffStat } from "./scorer.js";
import { branchRef } from "./workspace.js";

export interface ReportInput {
	record: SearchRecord;
	recordPath: string;
	gateCount: number;
	winnerStat?: DiffStat;
}

/** The command that brings a kept winner into the workspace (spec 6.9 step 4). */
export function mergeCommand(base: string, id: string, winner: string): string {
	return `git diff --binary ${base} ${branchRef(id, winner)} | git apply --3way`;
}

/** Plain text, summary line first (spec 6.10). */
export function formatReport({ record, recordPath, gateCount, winnerStat }: ReportInput): string {
	const survivors = record.branches.filter((branch) => branch.status === "survived");
	const generations = new Set(record.branches.map((branch) => branch.generation)).size;
	const lines = [
		`Branch search ${record.id}: ${record.outcome}. ${survivors.length} of ${record.branches.length} branches survived over ${generations} generations.`,
	];
	if (record.abortReason) lines.push(`Reason: ${record.abortReason}`);
	const winner = record.branches.find((branch) => branch.key === record.winner);
	if (winner && winnerStat) {
		lines.push(
			`Winner: ${winner.key} (${winner.candidate}, constraint: ${winner.constraint}) +${winnerStat.added} -${winnerStat.deleted} in ${winnerStat.files} files.`,
			`Objectives: ${Object.entries(winner.objectives ?? {})
				.map(([id, value]) => `${id}=${value}`)
				.join(", ")}`,
			`Merge: ${mergeCommand(record.base?.commit ?? "", record.id, winner.key)}`,
		);
	}
	if (record.branches.length > 0) {
		lines.push("Branches:");
		for (const branch of record.branches) {
			const fate =
				branch.status === undefined
					? "unscored"
					: branch.status === "survived"
						? "survived"
						: `dead (gates passed ${branch.gatesPassed}/${gateCount})`;
			lines.push(
				`  ${branch.key} ${fate} ${branch.selfReport ?? "unfinished"}: ${branch.learned ?? "(nothing reported)"}`,
			);
		}
	}
	if (record.cleanupErrors.length > 0) lines.push(`Cleanup failed: ${record.cleanupErrors.join("; ")}`);
	lines.push(`Record: ${recordPath}`);
	return lines.join("\n");
}
