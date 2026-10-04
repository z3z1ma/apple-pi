/**
 * completion-reflection.ts — In-band completion work for public interactive coding children.
 *
 * The root session reflects in passive forks after it settles. A coding child instead finishes
 * its own review before handing off: at the pre-settle boundary of each invocation it appends one
 * instruction and asks Pi to continue the same run, so the caller receives the report written
 * after the review, within the child's ordinary cancellation and turn limits.
 */

import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { extractText } from "./context.js";
import { reflectionPrompt, trackChanges } from "../../change-reflection/src/index.js";
import { learningQuestions, trackLearningEvidence } from "../../notebook/src/hooks/learning-reflection.js";

export const COMPLETION_REFLECTION_MESSAGE_TYPE = "subagents.completion-reflection";

const EDITING_TOOLS = ["edit", "write"];

const CLARIFY =
	"You cannot ask the user directly. When the intended behavior is unclear, ask with `clarify` if you have it; its answer is advice, not new authorization. If it cannot settle the question, leave the disputed change alone and report the question and the verification it affects.";

const REPORT =
	"Last, give your full final report. Your caller receives only that message, and it replaces your earlier report.";

const LEARNING_SUMMARY = "a brief summary of notebook additions, plus any learning that could not be recorded and why";

function completionPrompt(changed: ReadonlyMap<string, readonly string[]>, evidence: readonly string[]): string {
	const learning = `${learningQuestions(evidence)} Recording nothing is a valid outcome.`;
	if (changed.size === 0)
		return [
			"Before you hand off, capture what this invocation taught you, then give your final report.",
			learning,
			`${REPORT} Include your findings, any checks with their results and what stays unverified, that no change review was due because no built-in edit or write succeeded, and ${LEARNING_SUMMARY}.`,
		].join("\n\n");
	return [
		"Before you hand off, finish this invocation in order: review your changes, capture learnings, then give your final report.",
		reflectionPrompt([...changed.keys()], changed),
		CLARIFY,
		learning,
		`${REPORT} Cover the changed files as they now stand, the checks that ran after their last changes with their results, what stays unverified, the review outcome with any open question, and ${LEARNING_SUMMARY}.`,
	].join("\n\n");
}

/** Loaded only into public interactive children; eligibility is the session's active built-in editing tools. */
export function registerCompletionReflection(pi: ExtensionAPI): void {
	const changed = trackChanges(pi);
	const evidence = trackLearningEvidence(pi);
	let due = false;

	// Each externally submitted prompt or resume is one invocation; the boundary continuation is not.
	pi.on("before_agent_start", () => {
		changed.clear();
		evidence.length = 0;
		due = true;
	});

	pi.on("agent_before_settle", (event) => {
		if (!due || event.outcome !== "completed") return;
		due = false;
		const active = pi.getActiveTools();
		if (!EDITING_TOOLS.some((name) => active.includes(name))) return;
		return {
			entries: [
				...event.entries,
				{
					type: "custom_message",
					customType: COMPLETION_REFLECTION_MESSAGE_TYPE,
					content: completionPrompt(changed, evidence),
					display: true,
				},
			],
			continue: true,
		};
	});
}

/**
 * The report a failed, stopped, or turn-limited invocation hands off may predate its requested
 * completion work. Say so rather than let it read as a reviewed result.
 */
export function withUnfinishedCompletionNote(text: string, entries: readonly SessionEntry[]): string {
	const requested = entries.findLastIndex(
		(entry) => entry.type === "custom_message" && entry.customType === COMPLETION_REFLECTION_MESSAGE_TYPE,
	);
	if (requested < 0) return text;
	const lastIndex = entries.findLastIndex((entry) => entry.type === "message");
	const lastEntry = entries[lastIndex];
	const last = lastEntry?.type === "message" ? lastEntry.message : undefined;
	const finished =
		lastIndex > requested &&
		last?.role === "assistant" &&
		(last.stopReason === "stop" || last.stopReason === "length") &&
		Boolean(extractText(last.content).trim());
	if (finished) return text;
	const note =
		"Note: this invocation's automatic completion review did not finish, so any report above may predate its final review, checks, and learning capture.";
	return text ? `${text}\n\n${note}` : note;
}
