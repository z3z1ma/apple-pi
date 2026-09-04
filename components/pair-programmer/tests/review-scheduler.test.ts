import { describe, expect, it } from "vitest";
import {
	classifyPairWork,
	commandLooksLikeVerification,
	createPairReviewScheduler,
	createSetPairAttentionTool,
	DEFAULT_PAIR_WAKE_ON,
	nextPairWorkPhase,
	PAIR_ATTENTION_FALLBACKS,
	type PairAttentionLease,
	type PairReviewObservation,
	type PairReviewPermit,
	type PairReviewScheduler,
	SET_PAIR_ATTENTION_TOOL_NAME,
} from "../src/review-scheduler.js";

type Timer = { readonly fireAt: number; readonly callback: () => void };

function observation(
	sequence: number,
	renderedTokens: number,
	rest: Omit<PairReviewObservation, "sequence" | "renderedTokens"> = {},
): PairReviewObservation {
	return { sequence, renderedTokens, ...rest };
}

function toolTurn(
	sequence: number,
	name: string,
	extra: Omit<PairReviewObservation, "sequence" | "renderedTokens" | "toolCalls"> & {
		args?: unknown;
		result?: PairReviewObservation["toolResults"];
		tokens?: number;
	} = {},
): PairReviewObservation {
	const { args, result, tokens, ...rest } = extra;
	return observation(sequence, tokens ?? 10, {
		toolCalls: [{ name, arguments: args }],
		...(result ? { toolResults: result } : {}),
		...rest,
	});
}

function harness() {
	let now = 0;
	let nextTimer = 1;
	const timers = new Map<number, Timer>();
	const due: PairReviewPermit[] = [];
	const scheduler = createPairReviewScheduler({
		now: () => now,
		setTimer: (callback, delayMs) => {
			const id = nextTimer++;
			timers.set(id, { fireAt: now + delayMs, callback });
			return id;
		},
		clearTimer: (handle) => {
			timers.delete(handle as number);
		},
		onDue: (permit) => {
			due.push(permit);
		},
	});
	scheduler.setRunActive(true);
	const fireDue = () => {
		for (const [id, timer] of [...timers]) {
			if (timer.fireAt <= now) {
				timers.delete(id);
				timer.callback();
			}
		}
	};
	return {
		scheduler,
		due,
		timers,
		get now() {
			return now;
		},
		advance(ms: number) {
			now += ms;
			fireDue();
		},
		take(): PairReviewPermit {
			const permit = scheduler.takePermit();
			expect(permit).toBeDefined();
			return permit as PairReviewPermit;
		},
		settle(permit: PairReviewPermit, settlement: Parameters<PairReviewScheduler["complete"]>[0] = { outcome: "ok" }) {
			scheduler.complete(settlement);
			return permit;
		},
	};
}

describe("classifyPairWork", () => {
	it("detects assistant error, aborted, and length failures", () => {
		expect(classifyPairWork({ assistant: { stopReason: "error" } }).failure).toBe(true);
		expect(classifyPairWork({ assistant: { stopReason: "aborted" } }).phase).toBe("recovery");
		expect(classifyPairWork({ assistant: { aborted: true } }).failure).toBe(true);
		expect(classifyPairWork({ assistant: { stopReason: "length" } }).failure).toBe(true);
		expect(classifyPairWork({ assistant: { stopReason: "end_turn" } }).failure).toBe(false);
	});

	it("detects tool isError and numeric nonzero exit codes", () => {
		expect(classifyPairWork({ toolResults: [{ isError: true }] }).failure).toBe(true);
		expect(classifyPairWork({ toolResults: [{ exitCode: 1 }] }).failure).toBe(true);
		expect(classifyPairWork({ toolResults: [{ details: { exitCode: 2 } }] }).failure).toBe(true);
		expect(classifyPairWork({ toolResults: [{ details: { exit_code: 3 } }] }).failure).toBe(true);
		expect(classifyPairWork({ toolResults: [{ exitCode: 0 }] }).failure).toBe(false);
		expect(classifyPairWork({ toolResults: [{ exitCode: "1" }] }).failure).toBe(false);
	});

	it("detects mutation from named tools and nonempty unified diffs", () => {
		for (const name of ["edit", "write", "multiedit", "apply_patch"]) {
			expect(classifyPairWork({ toolCalls: [{ name }] }).mutation).toBe(true);
			expect(classifyPairWork({ toolCalls: [{ name }] }).phase).toBe("mutation");
		}
		expect(
			classifyPairWork({
				toolResults: [{ toolName: "unknown_patch", details: { diff: "@@ -1 +1 @@\n-a\n+b\n" } }],
			}).mutation,
		).toBe(true);
		expect(classifyPairWork({ toolResults: [{ details: { diff: "" } }] }).mutation).toBe(false);
	});

	it("detects verification from named tools and conservative commands", () => {
		expect(classifyPairWork({ toolCalls: [{ name: "typecheck" }] }).verification).toBe(true);
		expect(classifyPairWork({ toolCalls: [{ name: "bash", arguments: { command: "npm run test:pair" } }] }).phase).toBe(
			"verification",
		);
		expect(classifyPairWork({ toolCalls: [{ name: "bash", arguments: { command: "pnpm lint" } }] }).verification).toBe(
			true,
		);
		expect(classifyPairWork({ toolCalls: [{ name: "bash", arguments: { command: "cargo test" } }] }).verification).toBe(
			true,
		);
		expect(commandLooksLikeVerification("git diff --check")).toBe(true);
		expect(commandLooksLikeVerification("npm pack --dry-run")).toBe(true);
		expect(commandLooksLikeVerification("cd packages/core && npm test")).toBe(true);
		expect(commandLooksLikeVerification("swift test")).toBe(true);
		expect(commandLooksLikeVerification("dotnet build")).toBe(true);
		expect(commandLooksLikeVerification("git checkout main")).toBe(false);
		expect(classifyPairWork({ toolCalls: [{ name: "bash", arguments: { command: "git checkout main" } }] }).phase).toBe(
			"execution",
		);
	});

	it("detects exploration, execution, delegation, and delegated results", () => {
		expect(classifyPairWork({ toolCalls: [{ name: "read" }] }).phase).toBe("exploration");
		expect(classifyPairWork({ toolCalls: [{ name: "wiki_lint" }] }).phase).toBe("exploration");
		expect(classifyPairWork({ toolCalls: [{ name: "search_session" }] }).phase).toBe("exploration");
		expect(classifyPairWork({ toolCalls: [{ name: "bash", arguments: { command: "ls src" } }] }).phase).toBe(
			"exploration",
		);
		expect(
			classifyPairWork({
				toolCalls: [{ name: "bash", arguments: { command: "rg scheduler components" } }],
				toolResults: [{ toolName: "bash", content: "components/pair-programmer/src/review-scheduler.ts" }],
			}).phase,
		).toBe("exploration");
		expect(classifyPairWork({ toolCalls: [{ name: "pi_exec" }] }).phase).toBe("execution");
		expect(classifyPairWork({ toolCalls: [{ name: "mystery" }] }).phase).toBe("execution");
		expect(classifyPairWork({ toolCalls: [{ name: "agent" }] }).phase).toBe("delegation");
		expect(classifyPairWork({ toolCalls: [{ name: "get_subagent_result" }] }).delegatedResult).toBe(false);
		expect(
			classifyPairWork({ toolResults: [{ toolName: "get_subagent_result", details: { status: "completed" } }] })
				.delegatedResult,
		).toBe(true);
		expect(
			classifyPairWork({ toolResults: [{ toolName: "get_subagent_result", details: { status: "running" } }] })
				.delegatedResult,
		).toBe(false);
		expect(classifyPairWork({ assistant: { content: [{ type: "text" }] } }).phase).toBe("response");
	});

	it("uses mixed-signal precedence", () => {
		expect(
			classifyPairWork({
				toolCalls: [{ name: "edit" }, { name: "read" }],
				toolResults: [{ isError: true }],
			}).phase,
		).toBe("recovery");
		expect(
			classifyPairWork({
				toolCalls: [{ name: "get_subagent_result" }, { name: "bash", arguments: { command: "npm test" } }],
			}).phase,
		).toBe("verification");
		expect(classifyPairWork({ toolCalls: [{ name: "write" }, { name: "typecheck" }] }).phase).toBe("verification");
		expect(classifyPairWork({ toolCalls: [{ name: "agent" }, { name: "edit" }] }).phase).toBe("mutation");
		expect(classifyPairWork({ toolCalls: [{ name: "agent" }, { name: "pi_exec" }] }).phase).toBe("delegation");
		expect(classifyPairWork({ toolCalls: [{ name: "read" }, { name: "pi_exec" }] }).phase).toBe("execution");
	});
});

describe("sticky phases", () => {
	it("does not regress from mutation or verification to exploration or execution", () => {
		const exploration = classifyPairWork({ toolCalls: [{ name: "read" }] });
		const execution = classifyPairWork({ toolCalls: [{ name: "pi_exec" }] });
		expect(nextPairWorkPhase("mutation", exploration)).toBe("mutation");
		expect(nextPairWorkPhase("mutation", execution)).toBe("mutation");
		expect(nextPairWorkPhase("verification", exploration)).toBe("verification");
		expect(nextPairWorkPhase("verification", execution)).toBe("verification");
	});

	it("treats mutation and verification as meaningful transitions either way", () => {
		expect(nextPairWorkPhase("mutation", classifyPairWork({ toolCalls: [{ name: "typecheck" }] }))).toBe(
			"verification",
		);
		expect(nextPairWorkPhase("verification", classifyPairWork({ toolCalls: [{ name: "write" }] }))).toBe("mutation");
	});

	it("keeps sticky phase across delegated-result-only turns", () => {
		const result = classifyPairWork({
			toolResults: [{ toolName: "get_subagent_result", details: { status: "completed" } }],
		});
		expect(nextPairWorkPhase("mutation", result)).toBe("mutation");
		expect(nextPairWorkPhase(undefined, result)).toBeUndefined();
	});
});

describe("PairReviewScheduler", () => {
	it("reviews the first completed step after user direction as orientation", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		expect(h.due).toHaveLength(1);
		expect(h.take().reason).toBe("orientation");
	});

	it("does not wake on consecutive reads after orientation", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take());
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "read"));
		h.scheduler.observe(toolTurn(3, "grep"));
		h.scheduler.observe(toolTurn(4, "find"));
		expect(h.due).toHaveLength(0);
		expect(h.scheduler.takePermit()).toBeUndefined();
		expect(h.scheduler.snapshot().pendingItems).toBe(3);
	});

	it("wakes on first mutation and first verification, not every later edit", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take());
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "write"));
		expect(h.take().reason).toBe("phase_mutation");
		h.settle(h.scheduler.snapshot().permit!);
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "edit"));
		h.scheduler.observe(toolTurn(4, "multiedit"));
		expect(h.due).toHaveLength(0);
		h.scheduler.observe(toolTurn(5, "typecheck"));
		expect(h.take().reason).toBe("phase_verification");
		h.settle(h.scheduler.snapshot().permit!);
		h.due.length = 0;
		h.scheduler.observe(toolTurn(6, "write"));
		expect(h.take().reason).toBe("phase_mutation");
	});

	it("keeps wakeOn mutation as an enter-phase checkpoint, not a per-write pulse", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", lease: { attention: "close", wakeOn: ["mutation"] } });
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "write"));
		expect(h.take().reason).toBe("phase_mutation");
		h.settle(h.scheduler.snapshot().permit!);
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "edit"));
		h.scheduler.observe(toolTurn(4, "write"));
		expect(h.due).toHaveLength(0);
		expect(h.scheduler.takePermit()).toBeUndefined();
	});

	it("wakes on execution after exploration as a phase transition", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", silent: true });
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "pi_exec"));
		expect(h.take().reason).toBe("phase_transition");
	});

	it("does not ping-pong between execution and later exploration", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", silent: true });
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "pi_exec"));
		h.settle(h.take(), { outcome: "ok", silent: true });
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "read"));
		h.scheduler.observe(toolTurn(4, "grep"));
		expect(h.scheduler.takePermit()).toBeUndefined();
		expect(h.scheduler.snapshot().committedPhase).toBe("execution");
	});

	it("coalesces mixed reasons into one permit with failure first", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		expect(h.due[0]?.reason).toBe("orientation");
		h.scheduler.observe(
			toolTurn(2, "write", {
				result: [{ isError: true, details: { exitCode: 1 } }],
				terminal: true,
			}),
		);
		expect(h.due).toHaveLength(1);
		const permit = h.take();
		expect(permit.reason).toBe("failure");
		expect(permit.batchItems).toBe(2);
		expect(permit.throughSequence).toBe(2);
	});

	it("treats delegated results as events and failures as mandatory", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take());
		h.due.length = 0;
		h.scheduler.observe(
			observation(2, 10, {
				toolResults: [{ toolName: "get_subagent_result", details: { status: "completed" } }],
			}),
		);
		expect(h.take().reason).toBe("delegated_result");
		h.settle(h.scheduler.snapshot().permit!);
		expect(h.scheduler.snapshot().committedPhase).toBe("exploration");
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "read", { result: [{ isError: true }] }));
		expect(h.take().reason).toBe("failure");
	});

	it("reviews unseen terminal evidence even without a phase change", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take());
		h.due.length = 0;
		h.scheduler.observe(observation(2, 8, { terminal: true, assistant: { stopReason: "end_turn" } }));
		expect(h.take().reason).toBe("terminal");
	});

	it("one permit covers all accumulated evidence", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read", { tokens: 100 }));
		h.scheduler.observe(toolTurn(2, "grep", { tokens: 40 }));
		h.scheduler.observe(toolTurn(3, "write", { tokens: 20 }));
		const permit = h.take();
		expect(permit.batchItems).toBe(3);
		expect(permit.batchTokens).toBe(160);
		expect(permit.throughSequence).toBe(3);
		expect(permit.reviewId).toMatch(/^rev-\d+$/);
	});

	it("starves on estimated rendered tokens at the close threshold", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read", { tokens: 10 }));
		h.settle(h.take());
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "read", { tokens: PAIR_ATTENTION_FALLBACKS.close.tokens - 1 }));
		expect(h.due).toHaveLength(0);
		h.scheduler.observe(toolTurn(3, "read", { tokens: 1 }));
		expect(h.take().reason).toBe("starvation_tokens");
	});

	it("starves on active time and ignores paused idle wall time", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take());
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "read"));
		h.advance(PAIR_ATTENTION_FALLBACKS.close.activeMs - 1);
		expect(h.due).toHaveLength(0);
		h.scheduler.setRunActive(false);
		h.advance(60_000);
		expect(h.due).toHaveLength(0);
		h.scheduler.setRunActive(true);
		h.advance(1);
		expect(h.take().reason).toBe("starvation_time");
	});

	it("widens attention after silent reviews and resets close on intervention", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", silent: true });
		expect(h.scheduler.snapshot().attention).toBe("routine");
		h.scheduler.observe(toolTurn(2, "write"));
		expect(h.scheduler.snapshot().attention).toBe("close");
		h.settle(h.take(), { outcome: "ok", silent: true });
		expect(h.scheduler.snapshot().attention).toBe("routine");
		h.scheduler.observe(toolTurn(3, "typecheck"));
		expect(h.scheduler.snapshot().attention).toBe("close");
		h.settle(h.take(), { outcome: "ok", silent: true });
		expect(h.scheduler.snapshot().attention).toBe("routine");
		h.scheduler.observe(toolTurn(4, "write"));
		h.settle(h.take(), { outcome: "ok", consultantRequested: true, silent: true });
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect([...h.scheduler.snapshot().wakeOn]).toEqual([...DEFAULT_PAIR_WAKE_ON]);
	});

	it("keeps close attention when consequential evidence arrives during a silent review", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const first = h.take();
		h.scheduler.observe(toolTurn(2, "write"));
		h.scheduler.complete({ outcome: "ok", reviewedThrough: first.throughSequence, silent: true });
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect(h.take().reason).toBe("phase_mutation");
	});

	it("ignores an old-direction lease after new user direction", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const oldDirection = h.take();
		h.scheduler.noteUserDirection();
		h.scheduler.complete({
			outcome: "ok",
			reviewedThrough: oldDirection.throughSequence,
			lease: { attention: "relaxed", wakeOn: ["verification"] },
			silent: true,
		});
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect([...h.scheduler.snapshot().wakeOn]).toEqual([...DEFAULT_PAIR_WAKE_ON]);
		h.scheduler.observe(toolTurn(2, "read"));
		expect(h.take().reason).toBe("orientation");
	});

	it("restores close attention for a completed delegated result", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), {
			outcome: "ok",
			lease: { attention: "relaxed", wakeOn: ["delegated_result"] },
		});
		h.due.length = 0;
		h.scheduler.observe(
			observation(2, 10, {
				toolResults: [{ toolName: "get_subagent_result", details: { status: "completed" } }],
			}),
		);
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect(h.take().reason).toBe("delegated_result");
	});

	it("commits an explicit lease, keeping close when combined with intervention", () => {
		const h = harness();
		const lease: PairAttentionLease = { attention: "relaxed", wakeOn: ["mutation"] };
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", lease, silent: true });
		expect(h.scheduler.snapshot().attention).toBe("relaxed");
		expect([...h.scheduler.snapshot().wakeOn]).toEqual(["mutation"]);
		h.scheduler.observe(toolTurn(2, "write"));
		h.settle(h.take(), { outcome: "ok", lease, newIntervention: true, terminalCovered: true });
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect([...h.scheduler.snapshot().wakeOn]).toEqual(["mutation"]);
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "pi_exec"));
		h.scheduler.observe(toolTurn(4, "edit"));
		expect(h.due).toHaveLength(0);
		h.scheduler.observe(toolTurn(5, "read", { result: [{ isError: true }] }));
		expect(h.take().reason).toBe("failure");
	});

	it("rolls back a lease when the permit fails", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const permit = h.take();
		h.scheduler.complete({
			outcome: "failed",
			lease: { attention: "relaxed", wakeOn: ["verification"] },
		});
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect([...h.scheduler.snapshot().wakeOn]).toEqual([...DEFAULT_PAIR_WAKE_ON]);
		expect(h.scheduler.snapshot().pendingItems).toBe(1);
		expect(h.scheduler.takePermit()).toBeUndefined();
		h.scheduler.complete({ outcome: "ok" });
		expect(permit.reviewId).toBe(permit.reviewId);
	});

	it("does not tight-loop a failed permit without new evidence or a timer", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "failed" });
		expect(h.scheduler.takePermit()).toBeUndefined();
		expect(h.scheduler.snapshot().retryBlocked).toBe(true);
		expect(h.due).toHaveLength(1);
		h.scheduler.observe(toolTurn(2, "write"));
		const retry = h.take();
		expect(retry.reason).toBe("retry:orientation");
		h.settle(retry, { outcome: "failed" });
		h.due.length = 0;
		h.advance(PAIR_ATTENTION_FALLBACKS.close.activeMs);
		expect(h.due).toHaveLength(1);
		expect(h.take().reason).toBe("retry:orientation");
	});

	it("arms expedited reconfirmation, including immediate due when evidence is already pending", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const first = h.take();
		h.scheduler.observe(toolTurn(2, "write"));
		h.settle(first, { outcome: "ok", newIntervention: true });
		expect(h.scheduler.snapshot().reconfirmArmed).toBe(true);
		expect(h.take().reason).toBe("frontier_reconfirm");
		h.settle(h.scheduler.snapshot().permit!, { outcome: "ok", silent: true });
		expect(h.scheduler.snapshot().reconfirmArmed).toBe(false);
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "typecheck"));
		h.settle(h.take(), { outcome: "ok", newIntervention: true });
		expect(h.scheduler.takePermit()).toBeUndefined();
		h.scheduler.observe(toolTurn(4, "read"));
		expect(h.take().reason).toBe("frontier_reconfirm");
	});

	it("does not arm reconfirmation when a terminal turn already covered the intervention", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read", { terminal: true }));
		h.settle(h.take(), { outcome: "ok", newIntervention: true, terminalCovered: true });
		expect(h.scheduler.snapshot().reconfirmArmed).toBe(false);
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "read"));
		expect(h.due).toHaveLength(0);
	});

	it("commits only the exact retried prefix when newer evidence is queued behind it", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const first = h.take();
		h.scheduler.observe(toolTurn(2, "write"));
		h.scheduler.complete({ outcome: "ok", reviewedThrough: 1, silent: true });
		const snapshot = h.scheduler.snapshot();
		expect(snapshot.pendingItems).toBe(1);
		expect(snapshot.pendingThroughSequence).toBe(2);
		expect(h.take().reason).toBe("phase_mutation");
		expect(first.throughSequence).toBe(1);
	});

	it("preserves orientation when a new user direction arrives behind an older review", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const oldReview = h.take();
		h.scheduler.noteUserDirection();
		h.scheduler.complete({ outcome: "ok", reviewedThrough: oldReview.throughSequence, silent: true });
		expect(h.scheduler.snapshot().orientationArmed).toBe(true);
		expect(h.scheduler.takePermit()).toBeUndefined();
		h.scheduler.observe(toolTurn(2, "read"));
		expect(h.take().reason).toBe("orientation");
	});

	it("retries immediately when newer evidence arrived during a failed review", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const failed = h.take();
		h.scheduler.observe(toolTurn(2, "write"));
		h.scheduler.complete({ outcome: "failed" });
		const retry = h.take();
		expect(retry.reason).toBe("retry:orientation");
		expect(retry.reviewId).not.toBe(failed.reviewId);
	});

	it("leaves a cancelled permit available without creating a new review id", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		const permit = h.take();
		h.scheduler.cancelPermit(permit);
		expect(h.scheduler.snapshot().due).toBe(true);
		expect(h.scheduler.snapshot().inFlight).toBe(false);
		const again = h.take();
		expect(again.reviewId).toBe(permit.reviewId);
		expect(h.due).toHaveLength(1);
	});

	it("resets and disposes by clearing timers", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take());
		h.scheduler.observe(toolTurn(2, "read"));
		expect(h.timers.size).toBe(1);
		h.scheduler.reset();
		expect(h.timers.size).toBe(0);
		expect(h.scheduler.snapshot().pendingItems).toBe(0);
		expect(h.scheduler.snapshot().orientationArmed).toBe(true);
		h.scheduler.setRunActive(true);
		h.scheduler.observe(toolTurn(3, "read"));
		h.settle(h.take());
		h.scheduler.observe(toolTurn(4, "read"));
		expect(h.timers.size).toBe(1);
		h.scheduler.dispose();
		expect(h.timers.size).toBe(0);
		h.scheduler.observe(toolTurn(5, "write"));
		expect(h.scheduler.takePermit()).toBeUndefined();
	});

	it("uses routine and relaxed fallbacks after widening", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", silent: true });
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "read", { tokens: PAIR_ATTENTION_FALLBACKS.routine.tokens }));
		expect(h.take().reason).toBe("starvation_tokens");
		h.settle(h.scheduler.snapshot().permit!, { outcome: "ok", silent: true });
		h.due.length = 0;
		h.scheduler.observe(toolTurn(3, "read"));
		h.advance(PAIR_ATTENTION_FALLBACKS.relaxed.activeMs);
		expect(h.take().reason).toBe("starvation_time");
	});

	it("resets close attention and default wakes on a new user direction", () => {
		const h = harness();
		h.scheduler.observe(toolTurn(1, "read"));
		h.settle(h.take(), { outcome: "ok", lease: { attention: "relaxed", wakeOn: ["mutation"] }, silent: true });
		h.scheduler.noteUserDirection();
		expect(h.scheduler.snapshot().attention).toBe("close");
		expect([...h.scheduler.snapshot().wakeOn]).toEqual([...DEFAULT_PAIR_WAKE_ON]);
		expect(h.scheduler.snapshot().committedPhase).toBeUndefined();
		h.due.length = 0;
		h.scheduler.observe(toolTurn(2, "read"));
		expect(h.take().reason).toBe("orientation");
	});
});

describe("createSetPairAttentionTool", () => {
	it("stages a lease transactionally and terminates without committing", async () => {
		const staged: PairAttentionLease[] = [];
		const tool = createSetPairAttentionTool({
			stage: (lease) => {
				staged.push(lease);
				return true;
			},
		});
		expect(tool.name).toBe(SET_PAIR_ATTENTION_TOOL_NAME);
		expect(tool.parameters.properties).toHaveProperty("attention");
		expect(tool.parameters.properties).toHaveProperty("wake_on");
		const guidance = tool.promptGuidelines?.join("\n") ?? "";
		expect(guidance).toContain("final action");
		expect(guidance).toContain("mandatory wakes");
		const result = await tool.execute(
			"call-1",
			{ attention: "routine", wake_on: ["verification", "delegated_result"] },
			undefined,
			undefined,
			{} as never,
		);
		expect(result.terminate).toBe(true);
		expect(result.details).toEqual({ staged: true });
		expect(result.content).toEqual([{ type: "text", text: "Attention lease staged." }]);
		expect(JSON.stringify(result)).not.toMatch(/\/Users\/|secret|token/i);
		expect(staged).toEqual([{ attention: "routine", wakeOn: ["verification", "delegated_result"] }]);
	});

	it("does not pretend a lease committed when no review is active", async () => {
		const tool = createSetPairAttentionTool({ stage: () => false });
		const result = await tool.execute("call-2", { attention: "close", wake_on: [] }, undefined, undefined, {} as never);
		expect(result.terminate).toBe(true);
		expect(result.details).toEqual({ staged: false });
		expect(result.content[0]).toMatchObject({ type: "text", text: "No active review; attention was not changed." });
	});
});
