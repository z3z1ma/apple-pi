import { qualifies } from "./judge.js";
import type { AttemptRecord, SearchRecord } from "./record.js";
import { branchRef, type DiffStat, PLAIN_DIFF } from "./workspace.js";

/** The command that brings a winner that was not applied into the workspace. */
export function mergeCommand(base: string, id: string, winner: string): string {
	return `git diff ${PLAIN_DIFF.join(" ")} --binary ${base} ${branchRef(id, winner)} | git apply --3way`;
}

function fate(attempt: AttemptRecord): string {
	const { scores } = attempt;
	if (!scores) return "unscored";
	const failed = scores.gates.filter((gate) => !gate.pass).map((gate) => `\`${gate.command}\``);
	const values = scores.judges.map(({ value }) => String(value ?? "—")).join(", ");
	const verdict =
		failed.length > 0 ? `failed gate ${failed.join(", ")}` : (scores.failure ?? `passed ${scores.gates.length} gates`);
	return `${verdict}; judges ${values}; diff ${attempt.diffSize ?? "—"} lines`;
}

/** Plain text, summary line first. */
export function formatReport(record: SearchRecord, recordPath: string, winnerStat?: DiffStat): string {
	const qualified = record.attempts.filter(({ scores }) => scores && qualifies(scores));
	const lines = [
		`Branch search ${record.id}: ${record.outcome}. ${qualified.length} of ${record.attempts.length} attempts passed every gate and judge.`,
	];
	if (record.abortReason) lines.push(`Reason: ${record.abortReason}`);
	const winner = record.attempts.find((attempt) => attempt.key === record.winner);
	if (winner && winnerStat) {
		lines.push(
			`Winner: ${winner.key} (${winner.candidate.id}) +${winnerStat.added} -${winnerStat.deleted} in ${winnerStat.files} files.`,
		);
		if (record.choice)
			lines.push(
				record.choice.winner === null
					? `Judge model ${record.choice.profile} could not choose (${record.choice.reason}); ranked by judge numbers.`
					: `Chosen by judge model ${record.choice.profile}: ${record.choice.reason}`,
			);
		if (record.apply && !record.apply.applied) lines.push(`Not applied: ${record.apply.reason}`);
		if (record.outcome === "ready")
			lines.push(`Merge: ${mergeCommand(record.base?.commit ?? "", record.id, winner.key)}`);
	}
	if (record.attempts.length > 0) {
		lines.push(`Judges: ${record.judges.map(({ command, better }) => `\`${command}\` (${better})`).join(", ")}`);
		lines.push("Attempts:");
		for (const attempt of record.attempts)
			lines.push(`  ${attempt.key} ${attempt.candidate.id} ${attempt.stop ?? "unfinished"}: ${fate(attempt)}`);
	}
	if (record.cleanupErrors.length > 0) lines.push(`Cleanup failed: ${record.cleanupErrors.join("; ")}`);
	lines.push(`Record: ${recordPath}`);
	return lines.join("\n");
}
