import { describe, expect, it, vi } from "vitest";

import { PAIR_SESSION_TOOLS, EscalateTool, RepeatedFailureDetector, PairEscalationController } from "../src/index.js";
import type { AdvisorConsultationResult } from "../../subagents/src/consultation.js";

function harness(result: AdvisorConsultationResult, minTurnsBetween = 0) {
	let state = "initial";
	const pi = {
		exec: async (_command: string, args: string[]) => {
			const key = args.join(" ");
			const stdout =
				key === "rev-parse --is-inside-work-tree"
					? "true\n"
					: key === "status --short"
						? " M src/retry.ts\n"
						: key === "diff HEAD --name-only"
							? "src/retry.ts\n"
							: key === "diff HEAD --stat"
								? " src/retry.ts | 1 +\n"
								: key.startsWith("diff HEAD --no-ext-diff")
									? `+ ${state}\n`
									: "";
			return { code: 0, stdout, stderr: "" };
		},
	} as never;
	const ctx = {
		cwd: "/tmp/pair-controller",
		sessionManager: {
			getBranch: () => [{ type: "message", message: { role: "user", content: "make retries durable" } }],
		},
	} as never;
	const service = { runConsultation: vi.fn(async () => result) };
	const outcomes: any[] = [];
	let ready = 0;
	const controller = new PairEscalationController({
		pi,
		getContext: () => ctx,
		getService: () => service as any,
		onDeliveryReady: () => ready++,
		onOutcome: (outcome) => outcomes.push(outcome),
		onStateChange: () => {},
		minTurnsBetween,
	});
	return {
		controller,
		service,
		outcomes,
		get ready() {
			return ready;
		},
		changeState: () => {
			state = "changed";
		},
	};
}

const request = {
	severity: "concern" as const,
	claim: "The retry path may bypass durable enqueue.",
	whyDeepReasoning: "Queue ownership crosses lifecycle modules.",
	evidence: [{ kind: "file" as const, ref: "src/retry.ts", path: "src/retry.ts" }],
	uncertainty: "A wrapper may enqueue later.",
};

const usage = { input: 100, cacheRead: 50, cacheWrite: 0, output: 20, cost: 0.2, durationMs: 10, toolCalls: 3 };

describe("Pair escalation machinery", () => {
	it("keeps architectural consultation private and excludes delegation or mutation capabilities", () => {
		expect(PAIR_SESSION_TOOLS).toContain("ask_advisor");
		for (const forbidden of ["Agent", "pi_exec", "bash", "edit", "write", "mcp"]) {
			expect(PAIR_SESSION_TOOLS).not.toContain(forbidden);
		}
	});

	it("uses a separate concern/blocker-only tool instead of magic note prose", async () => {
		const seen: any[] = [];
		const tool = new EscalateTool((value) => {
			seen.push(value);
			return "accepted";
		});
		const result = await tool.execute("e1", {
			severity: "blocker",
			claim: "transaction order may lose data",
			why_deep_reasoning: "ownership spans three modules",
			evidence: [{ kind: "call", ref: "call:abc" }],
		});
		expect(seen).toEqual([expect.objectContaining({ severity: "blocker", claim: "transaction order may lose data" })]);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("software architect");
		const severities = (tool.parameters as any).properties.severity.anyOf.map((entry: any) => entry.const);
		expect(severities).toEqual(["concern", "blocker"]);
	});

	it("opens the repeated-failure gate only on the third exact failing command and resets on success", () => {
		const detector = new RepeatedFailureDetector();
		const message = {
			content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "npm test -- retry" } }],
		};
		expect(detector.observe(message, [{ toolCallId: "c1", toolName: "bash", isError: true }], 1)).toBeUndefined();
		message.content[0].id = "c2";
		expect(detector.observe(message, [{ toolCallId: "c2", toolName: "bash", isError: true }], 2)).toBeUndefined();
		message.content[0].id = "c3";
		expect(detector.observe(message, [{ toolCallId: "c3", toolName: "bash", isError: true }], 3)).toMatchObject({
			severity: "concern",
			evidence: [{ ref: "call:c1" }, { ref: "call:c2" }, { ref: "call:c3" }],
		});
		message.content[0].id = "ok";
		expect(detector.observe(message, [{ toolCallId: "ok", toolName: "bash", isError: false }], 4)).toBeUndefined();
		message.content[0].id = "again";
		expect(detector.observe(message, [{ toolCallId: "again", toolName: "bash", isError: true }], 5)).toBeUndefined();
	});

	it("delivers a current confirmed finding and records structural usage", async () => {
		const h = harness({
			status: "completed",
			finding: {
				disposition: "confirm",
				severity: "blocker",
				finding: "Acknowledgement precedes durable insertion.",
				evidence: ["src/retry.ts:42"],
				recommendedAction: "Move acknowledgement after enqueue.",
			},
			usage,
		});
		expect(h.controller.submit("pair", request, 1)).toBe("accepted");
		await vi.waitFor(() => expect(h.ready).toBe(1));
		const delivered: any[] = [];
		const prepared = await h.controller.prepareDelivery();
		expect(prepared).toBeDefined();
		if (prepared) {
			delivered.push(prepared.note);
			prepared.commit(true);
		}

		expect(delivered).toEqual([
			expect.objectContaining({
				source: "advisor",
				adjudication: "confirm",
				severity: "blocker",
				note: expect.stringContaining("Acknowledgement precedes durable insertion"),
			}),
		]);
		expect(h.outcomes).toEqual([
			expect.objectContaining({ disposition: "confirm", delivered: true, stale: false, usage }),
		]);
		expect(h.controller.stats.cost).toBe(0.2);
		expect(h.controller.state).toBe("idle");
	});

	it("suppresses a refutation and collapses an equivalent concurrent escalation", async () => {
		let settle!: (result: AdvisorConsultationResult) => void;
		const pending = new Promise<AdvisorConsultationResult>((resolve) => {
			settle = resolve;
		});
		const h = harness({
			status: "completed",
			finding: { disposition: "refute", finding: "No issue.", evidence: [] },
			usage,
		});
		(h.service.runConsultation as any).mockImplementationOnce(() => pending);
		expect(h.controller.submit("pair", request, 1)).toBe("accepted");
		expect(h.controller.submit("pair", request, 1)).toBe("suppressed");
		settle({
			status: "completed",
			finding: { disposition: "refute", finding: "Wrapper enqueues durably.", evidence: [] },
			usage,
		});
		await vi.waitFor(() => expect(h.outcomes).toHaveLength(1));
		expect(await h.controller.prepareDelivery()).toBeUndefined();
		expect(h.service.runConsultation).toHaveBeenCalledTimes(1);
		expect(h.outcomes[0]).toMatchObject({ disposition: "refute", delivered: false });
		expect(h.controller.stats.suppressed).toBe(1);
	});

	it("drops a late finding when implicated working state changed", async () => {
		const h = harness({
			status: "completed",
			finding: { disposition: "refine", finding: "Flush ordering is unsafe.", evidence: [] },
			usage,
		});
		h.controller.submit("pair", request, 1);
		await vi.waitFor(() => expect(h.ready).toBe(1));
		h.changeState();
		const delivered: any[] = [];
		const prepared = await h.controller.prepareDelivery();
		if (prepared) delivered.push(prepared.note);
		expect(delivered).toEqual([]);
		expect(h.outcomes[0]).toMatchObject({ disposition: "refine", delivered: false, stale: true });
	});

	it.each([
		{ status: "failed" as const, error: "deep provider unavailable" },
		{ status: "malformed" as const, error: "Advisor returned without a typed disposition." },
	])("records $status without promoting the escalation hypothesis to advice", async ({ status, error }) => {
		const h = harness({ status, error, usage: { ...usage, cost: 0 } });
		h.controller.submit("pair", request, 1);
		await vi.waitFor(() => expect(h.outcomes).toHaveLength(1));
		expect(h.ready).toBe(0);
		expect(await h.controller.prepareDelivery()).toBeUndefined();
		expect(h.outcomes[0]).toMatchObject({ status, delivered: false });
	});

	it("records a typed uncertain disposition without delivering advice", async () => {
		const h = harness({
			status: "completed",
			finding: {
				disposition: "uncertain",
				finding: "The available evidence does not resolve queue ownership.",
				evidence: [],
				uncertainty: "The wrapper implementation is unavailable.",
			},
			usage,
		});
		h.controller.submit("pair", request, 1);
		await vi.waitFor(() => expect(h.outcomes).toHaveLength(1));
		expect(h.ready).toBe(0);
		expect(await h.controller.prepareDelivery()).toBeUndefined();
		expect(h.outcomes[0]).toMatchObject({ disposition: "uncertain", delivered: false });
	});

	it("throttles starts by turns without imposing an absolute consultation maximum", async () => {
		const h = harness(
			{ status: "completed", finding: { disposition: "refute", finding: "No issue.", evidence: [] }, usage },
			2,
		);
		h.controller.submit("pair", request, 1);
		await vi.waitFor(() => expect(h.service.runConsultation).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(h.outcomes).toHaveLength(1));
		const changedEvidence = { ...request, evidence: [{ kind: "call" as const, ref: "call:new" }] };
		h.controller.submit("pair", changedEvidence, 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(h.service.runConsultation).toHaveBeenCalledTimes(1);
		h.controller.advanceTurn(3);
		await vi.waitFor(() => expect(h.service.runConsultation).toHaveBeenCalledTimes(2));
	});
});
