/**
 * outcome-framing.ts — What a settled agent outcome says to whoever receives it.
 *
 * One owner for result selection, partial-output framing, status qualifiers,
 * saved-output presentation, and continuation eligibility, shared by the root
 * tools, the nested delegation tools, and background notifications. Callers keep
 * their delivery mechanics: active-status checks, transcripts, XML envelopes,
 * previews, file-change reports, and scheduling.
 */

import type { AgentRecord } from "./types.js";

/**
 * Where a settled outcome is delivered:
 *   - `foreground` / `nested-foreground`: the caller awaited the run (launch or resume) and receives
 *     its entire output inline.
 *   - `retrieved` / `nested-retrieved`: the caller fetched the result with `get_subagent_result`.
 *   - `notification`: a background completion announced to the main agent.
 */
export type OutcomeDelivery = "foreground" | "retrieved" | "notification" | "nested-foreground" | "nested-retrieved";

export type OutcomeRecord = Pick<
	AgentRecord,
	"id" | "status" | "result" | "error" | "session" | "outputPath" | "outputWritten" | "outputWriteError"
>;

export interface FramedOutcome {
	/** Model-visible response text, qualified by what it represents. */
	text: string;
	/** Continuation handle; "" when the delivery offers none or no live session exists. Belongs last. */
	resumeHandle: string;
	/** Short outcome phrase: the status and its qualifier, or the persistence failure. */
	summary: string;
}

/**
 * Parenthetical qualifier for a non-normal outcome whose full output may not be
 * at hand, so partial output is not mistaken for a completed result. `stopped`
 * (a human aborted it) is deliberately distinct from `aborted` (the turn limit was
 * hit): human intervention is treated differently from a budget cutoff.
 */
function statusNote(status: string): string {
	switch (status) {
		case "stopped":
			return " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)";
		case "aborted":
			return " (aborted — hit the turn limit before completion; output may be incomplete)";
		case "steered":
			return " (wrapped up at the turn limit — output may be partial)";
		default:
			return "";
	}
}

/**
 * Qualifier for a caller that awaited the run. It already holds the ENTIRE output
 * inline (a notification carries only a preview), so only here can we truthfully
 * say there is nothing more to fetch; the continuation handle is for a new turn,
 * not a cue that settled output remains (#174).
 *
 * Only `steered` hedges on completion: it was told to wrap up and did. An aborted
 * run blew through its grace turns while still working, and `stopped` only fires
 * on a running agent, so neither delivered a final answer. Every clause states
 * state, never an instruction, and never names `get_subagent_result`: re-spawn and
 * ask-before-restarting instructions were tried and cut because nothing here can
 * measure whether wording improves parent behavior. Don't add either back without
 * a way to measure it.
 */
function foregroundNote(status: string): string {
	switch (status) {
		case "stopped":
			return " (STOPPED BY THE USER — everything the agent produced is above; the task is unfinished)";
		case "aborted":
			return " (aborted at the turn limit — everything the agent produced is above; the task is unfinished)";
		case "steered":
			return " (wrapped up at the turn limit — everything the agent produced is above; the task may be unfinished)";
		default:
			return "";
	}
}

/** The response text a delivery shows when the run produced its own output. */
function responseText(record: OutcomeRecord, delivery: OutcomeDelivery): string {
	if (record.status === "error") {
		// `record.result` is bounded to the run's own turns, so this is never a stale earlier answer (#144).
		const partial = record.result?.trim();
		return `Agent failed: ${record.error ?? "unknown error"}${partial ? `\n\nPartial output before the failure:\n${partial}` : ""}`;
	}
	const note =
		delivery === "notification"
			? ""
			: delivery === "foreground" || delivery === "nested-foreground"
				? foregroundNote(record.status)
				: statusNote(record.status);
	if (delivery === "nested-foreground" || delivery === "nested-retrieved") {
		const text = record.result?.trim() || record.error?.trim() || "No output.";
		return note ? `Nested agent${note}.\n\n${text}` : text;
	}
	return `${record.result || record.error || "No output."}${note}`;
}

/** Keep a successfully persisted response out of the parent transcript; keep it inline when persistence failed. */
function savedOutputText(record: OutcomeRecord, inline: string): string {
	if (!record.outputPath) return inline;
	if (record.outputWriteError) {
		return `Failed to write agent output to ${record.outputPath}: ${record.outputWriteError}\n\n${inline}`;
	}
	if (!record.outputWritten) return inline;
	const failure = record.status === "error" ? `Agent failed: ${record.error ?? "unknown error"}\n\n` : "";
	return `${failure}Agent output written to ${record.outputPath}.${statusNote(record.status)}`;
}

/**
 * Tool-result `details` never reach the orchestrating model, so the id travels in
 * content. Only the awaiting surfaces and nested retrieval offer it, and only when
 * a live session exists: startup failures create records that cannot be resumed.
 */
function resumeHandle(record: OutcomeRecord, delivery: OutcomeDelivery): string {
	if (!record.session || delivery === "retrieved" || delivery === "notification") return "";
	return `\n\nAgent ID: ${record.id} (resume with the agent tool's resume parameter)`;
}

/** Frame one settled outcome for its delivery surface. */
export function frameOutcome(record: OutcomeRecord, delivery: OutcomeDelivery): FramedOutcome {
	return {
		text: savedOutputText(record, responseText(record, delivery)),
		resumeHandle: resumeHandle(record, delivery),
		summary: record.outputWriteError ? "failed to persist its output" : `${record.status}${statusNote(record.status)}`,
	};
}
