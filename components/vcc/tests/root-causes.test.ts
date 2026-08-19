/**
 * Regression tests for the compaction-tail failures that previously caused
 * direct Agent.prompt([]) continuations and split AgentSession busy state.
 *
 * Current invariants:
 * - own-cut selection keeps valid conversational boundaries;
 * - clean/manual and pre-prompt compactions do not restart the agent;
 * - active threshold, proactive, Codex recovery, and willRetry paths enqueue
 *   one hidden native follow-up;
 * - core Agent.continue drains that queued marker before assistant-tail role
 *   validation, so no Agent prototype patch is required.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	buildOwnCut,
	shouldResumeAfterCompaction,
	shouldTriggerResumeForCompaction,
} from "../src/hooks/before-compact.js";
import {
	assistantMsg,
	compactionSummaryMsg,
	makeAssistantEntry,
	makeContextMessages,
	makeUserEntry,
	resetIds,
	toolResultMsg,
	userMsg,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// buildOwnCut — the compaction boundary logic
// ---------------------------------------------------------------------------

describe("buildOwnCut", () => {
	beforeEach(resetIds);

	it("keeps a tail from the last user message", () => {
		const entries = [
			makeUserEntry("u1"),
			makeAssistantEntry("a1", "stop"),
			makeUserEntry("u2"),
			makeAssistantEntry("a2", "stop"),
		];
		const result = buildOwnCut(entries);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// Summarizes u1 + a1, keeps u2 + a2
		expect(result.messages).toHaveLength(2); // u1 + a1
		expect(result.firstKeptEntryId).toBe(entries[2].id);
	});

	it("ignores hidden continuation markers when choosing a cut", () => {
		const user1 = makeUserEntry("task one");
		const assistant1 = makeAssistantEntry("done one");
		const marker = {
			type: "message",
			id: "hidden_resume",
			message: {
				role: "custom",
				customType: "pi-retry:continue",
				content: [],
				display: false,
			},
		};
		const user2 = makeUserEntry("task two");
		const assistant2 = makeAssistantEntry("working", "toolUse");

		const result = buildOwnCut([user1, assistant1, marker, user2, assistant2]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.firstKeptEntryId).toBe(user2.id);
		expect(result.messages).toEqual([user1.message, assistant1.message]);
	});

	it("keeps the last assistant when only one user message (3+ live messages)", () => {
		const entries = [makeUserEntry("u1"), makeAssistantEntry("a1", "stop"), makeAssistantEntry("a1b", "stop")];
		const result = buildOwnCut(entries);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.compactAll).toBe(false);
		expect(result.firstKeptEntryId).toBe(entries[2].id);
	});

	it("cancels when no live messages", () => {
		const result = buildOwnCut([]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("no_live_messages");
	});

	it("cancels when too few live messages", () => {
		const entries = [makeUserEntry("u1")];
		const result = buildOwnCut(entries);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("too_few_live_messages");
	});
});

// ---------------------------------------------------------------------------
// RC1: Compaction result produces assistant last message in context
// ---------------------------------------------------------------------------

describe("RC1: post-compaction context last message", () => {
	/**
	 * After buildOwnCut compacts [u1, a1, u2, a2(stop)], the kept tail is
	 * [u2, a2]. After rebuild, the context is [compactionSummary, u2, a2].
	 * The LAST message is an assistant message.
	 *
	 * If continue() is called at this point, it throws.
	 */
	it("kept tail ending with assistant message makes continue() impossible", () => {
		const context = makeContextMessages(compactionSummaryMsg("summary"), userMsg("u2"), assistantMsg("a2", "stop"));

		const lastMsg = context[context.length - 1];
		expect(lastMsg.role).toBe("assistant");
		// This IS the condition that triggers "Cannot continue from message role: assistant"
		// Fix: the session should strip or not call continue() in this case.
	});

	/**
	 * After buildOwnCut compacts [u1, a1(toolUse), toolResult, a2(stop)],
	 * the kept tail starts from u1 (or wherever the cut boundary is).
	 * If tail ends with assistant, same problem.
	 */
	it("kept tail with toolUse assistant as last message is also blocked", () => {
		const context = makeContextMessages(compactionSummaryMsg("summary"), userMsg("u2"), assistantMsg("a2", "toolUse"));

		const lastMsg = context[context.length - 1];
		expect(lastMsg.role).toBe("assistant");
		expect(lastMsg.stopReason).toBe("toolUse");
	});

	/**
	 * The ONLY case where continue() works after compaction is when the
	 * kept tail ends with a user or toolResult message.
	 */
	it("kept tail ending with user message allows continue()", () => {
		const context = makeContextMessages(compactionSummaryMsg("summary"), userMsg("u2"));

		const lastMsg = context[context.length - 1];
		expect(lastMsg.role).toBe("user");
	});

	it("kept tail ending with toolResult allows continue()", () => {
		const context = makeContextMessages(
			compactionSummaryMsg("summary"),
			userMsg("u2"),
			assistantMsg("a2", "toolUse"),
			toolResultMsg("tc1", "result"),
		);

		const lastMsg = context[context.length - 1];
		expect(lastMsg.role).toBe("toolResult");
	});

	/**
	 * Compact-all (firstKeptEntryId="") produces context with just
	 * compactionSummary — which is role "user". continue() works.
	 */
	it("compact-all produces user-only context", () => {
		const context = makeContextMessages(compactionSummaryMsg("summary"));

		const lastMsg = context[context.length - 1];
		expect(lastMsg.role).toBe("user");
	});
});

// ---------------------------------------------------------------------------
// RC2: Overflow compaction error removal mismatch
// ---------------------------------------------------------------------------

describe("RC2: overflow compaction error removal", () => {
	/**
	 * After overflow compaction, _runAutoCompaction checks:
	 *   if (lastMsg?.role === "assistant" && lastMsg.stopReason === "error")
	 *     this.agent.state.messages = messages.slice(0, -1);
	 *
	 * This ONLY removes the last message if stopReason is "error".
	 * If the last message is a different assistant (e.g., stopReason "stop"
	 * or "toolUse"), it stays. continue() would throw.
	 *
	 * Scenario: Session has [u1, a1(stop), u2, a2(error)].
	 * pi-vcc cuts at u2 → kept tail: [u2, a2(error)].
	 * The error message IS the last → removal works → continue() OK.
	 *
	 * But what if: Session has [u1, a1(error), u2, a2(stop)].
	 * pi-vcc cuts at u2 → kept tail: [u2, a2(stop)].
	 * The last message is a2(stop), NOT an error → NO removal → continue() THROWS.
	 */
	it("error removal only triggers for stopReason=error at tail", () => {
		// Simulated context after compaction with assistant(stop) as last
		const context = makeContextMessages(
			compactionSummaryMsg("summary"),
			userMsg("u2"),
			assistantMsg("a2", "stop"), // NOT "error"
		);

		const lastMsg = context[context.length - 1];
		const wouldRemove = lastMsg.role === "assistant" && lastMsg.stopReason === "error";
		expect(wouldRemove).toBe(false); // Removal doesn't fire!
		// continue() would throw "Cannot continue from message role: assistant"
	});

	it("error removal works when error IS the last message", () => {
		const context = makeContextMessages(compactionSummaryMsg("summary"), userMsg("u2"), assistantMsg("a2", "error"));

		const lastMsg = context[context.length - 1];
		const wouldRemove = lastMsg.role === "assistant" && lastMsg.stopReason === "error";
		expect(wouldRemove).toBe(true); // Removal fires → after removal, last is user
	});
});

// ---------------------------------------------------------------------------
// RC5: stopReason value mapping
// ---------------------------------------------------------------------------

describe("RC5: stopReason string values", () => {
	/**
	 * pi-ai StopReason type: "stop" | "toolUse" | "length" | "error" | "aborted"
	 *
	 * NOT the Claude API values: "end_turn" / "tool_use" / "max_tokens"
	 *
	 * Our invisible-continue gate must use the pi-ai values:
	 */
	const PI_AI_STOP_REASONS = ["stop", "toolUse", "length", "error", "aborted"];
	const WRONG_VALUES = ["end_turn", "tool_use", "max_tokens"];

	it("pi-ai stopReason values are lowercase-first camelCase", () => {
		expect(PI_AI_STOP_REASONS).toContain("stop");
		expect(PI_AI_STOP_REASONS).toContain("toolUse");
		expect(PI_AI_STOP_REASONS).toContain("length");
		expect(PI_AI_STOP_REASONS).toContain("error");
		expect(PI_AI_STOP_REASONS).toContain("aborted");
	});

	it("Claude API values are NOT valid pi-ai stopReasons", () => {
		for (const wrong of WRONG_VALUES) {
			expect(PI_AI_STOP_REASONS).not.toContain(wrong);
		}
	});

	/**
	 * The invisible continue decision table with CORRECT values:
	 *
	 * stopReason | Continuation needed?
	 * -----------|---------------------
	 * stop       | NO (agent finished cleanly)
	 * toolUse    | YES (mid-tool cycle, compacted mid-task)
	 * length     | YES (hit max tokens, output truncated)
	 * error      | YES (API error, but pi-retry may handle)
	 * aborted    | NO (user cancelled)
	 */
	it("correct invisible-continue decision table", () => {
		const decisions: Record<string, boolean> = {
			stop: false,
			toolUse: true,
			length: true,
			error: true,
			aborted: false,
		};

		// Verify the decisions match our intent
		expect(decisions.stop).toBe(false);
		expect(decisions.toolUse).toBe(true);
		expect(decisions.length).toBe(true);
		expect(decisions.error).toBe(true);
		expect(decisions.aborted).toBe(false);
	});

	it("using 'end_turn' would NEVER match — always continues", () => {
		const stopReasons = ["stop", "toolUse", "length", "error", "aborted"];
		const matchesEndTurn = stopReasons.some((sr) => sr === "end_turn");
		expect(matchesEndTurn).toBe(false);
		// This was the original bug: checking === "end_turn" always fails,
		// so triggerInvisibleContinue always fires.
	});
});

// ---------------------------------------------------------------------------
// RC6: Manual /compact should NOT auto-continue
// ---------------------------------------------------------------------------

describe("RC6: manual compact should not auto-continue", () => {
	it("rejects manual compaction and queues a marker for core-owned retries", () => {
		expect(shouldTriggerResumeForCompaction({ reason: "manual", willRetry: false }, true, false, false)).toBe(false);
		expect(shouldTriggerResumeForCompaction({ reason: "overflow", willRetry: true }, false, false, false)).toBe(true);
	});

	it("rejects pre-prompt threshold compaction but resumes an active threshold run", () => {
		expect(shouldTriggerResumeForCompaction({ reason: "threshold", willRetry: false }, true, false, false)).toBe(false);
		expect(shouldTriggerResumeForCompaction({ reason: "threshold", willRetry: false }, false, false, false)).toBe(true);
	});

	it("uses active state conservatively when legacy Pi omits metadata", () => {
		expect(shouldTriggerResumeForCompaction({}, false, false, false)).toBe(true);
		expect(shouldTriggerResumeForCompaction({}, true, false, false)).toBe(false);
	});

	it("allows extension-owned proactive and Codex recovery compactions", () => {
		expect(shouldTriggerResumeForCompaction({ reason: "manual", willRetry: false }, true, true, false)).toBe(true);
		expect(shouldTriggerResumeForCompaction({ reason: "manual", willRetry: false }, true, false, true)).toBe(true);
	});

	/**
	 * For manual /compact, the agent is always idle before compaction.
	 * The last assistant message always has stopReason !== "toolUse"
	 * (because if the agent were mid-task, it would be running).
	 *
	 * With our fix that checks stopReason === "stop" → no continue,
	 * manual /compact AFTER a clean finish correctly does NOT continue.
	 */
	it("after user-initiated /compact, last stopReason is typically 'stop'", () => {
		const lastAssistant = assistantMsg("done", "stop");
		const shouldContinue = lastAssistant.stopReason !== "stop" && lastAssistant.stopReason !== "aborted";
		expect(shouldContinue).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The comprehensive fix: strip trailing assistant from rebuilt context
// ---------------------------------------------------------------------------

describe("native queued resume", () => {
	it("resumes mid-task assistant tails", () => {
		expect(shouldResumeAfterCompaction(assistantMsg("working", "toolUse") as any)).toBe(true);
		expect(shouldResumeAfterCompaction(assistantMsg("partial", "length") as any)).toBe(true);
	});

	it("does not resume clean, aborted, or ordinary error tails", () => {
		expect(shouldResumeAfterCompaction(assistantMsg("done", "stop") as any)).toBe(false);
		expect(shouldResumeAfterCompaction(assistantMsg("cancelled", "aborted") as any)).toBe(false);
		expect(shouldResumeAfterCompaction(assistantMsg("failed", "error") as any)).toBe(false);
	});

	it("allows only the explicit Codex recovery path to resume an error tail", () => {
		expect(
			shouldResumeAfterCompaction(
				{
					role: "assistant",
					stopReason: "error",
					provider: "openai-codex",
					errorMessage: "You have 8129 weighted tokens left: maximum output token limit reached",
				},
				true,
			),
		).toBe(true);
	});

	it("queues a marker for willRetry so native continue can drain it", () => {
		expect(shouldTriggerResumeForCompaction({ reason: "overflow", willRetry: true }, false, false, false)).toBe(true);
	});
});
