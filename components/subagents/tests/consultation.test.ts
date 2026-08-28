import { describe, expect, it } from "vitest";

import {
	buildConsultationContext,
	captureConsultationWorkingState,
	ADVISOR_CONSULTATION_OVERLAY,
	renderConsultationContext,
} from "../src/consultation.js";

function fakePi(overrides: Record<string, string> = {}) {
	return {
		exec: async (_command: string, args: string[]) => {
			const key = args.join(" ");
			const stdout =
				overrides[key] ??
				(key === "rev-parse --is-inside-work-tree"
					? "true\n"
					: key === "status --short"
						? " M src/retry.ts\n"
						: key === "diff HEAD --name-only"
							? "src/retry.ts\n"
							: key === "diff HEAD --stat"
								? " src/retry.ts | 2 +-\n"
								: key === "diff HEAD --no-ext-diff --unified=3"
									? "- volatile.push(job)\n+ durable.enqueue(job)\n"
									: key.startsWith("diff HEAD --no-ext-diff --unified=0 --")
										? "+ durable.enqueue(job)\n"
										: "");
			return { code: 0, stdout, stderr: "" };
		},
	} as never;
}

function ctx(entries: unknown[]) {
	return {
		cwd: "/tmp/consultation-project",
		sessionManager: {
			getBranch: () => entries,
		},
	} as never;
}

function assistant(content: unknown[]) {
	return { type: "message", message: { role: "assistant", content, stopReason: "toolUse", usage: {} } };
}

function toolResult(input: { id: string; toolName: string; text: string; isError?: boolean; diff?: string }) {
	return {
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: input.id,
			toolName: input.toolName,
			content: [{ type: "text", text: input.text }],
			isError: input.isError ?? false,
			...(input.diff ? { details: { diff: input.diff } } : {}),
		},
	};
}

describe("consultation context", () => {
	it("retains the current request and follow-up while older trajectory falls out first", async () => {
		const oldTurns = Array.from({ length: 10 }, (_, index) =>
			assistant([{ type: "thinking", thinking: `obsolete-${index}` }]),
		);
		const entries = [
			{ type: "message", message: { role: "user", content: "old completed request" } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
			{ type: "message", message: { role: "user", content: "implement durable retry" } },
			...oldTurns,
			{ type: "message", message: { role: "user", content: "and preserve restart behavior" } },
			assistant([{ type: "thinking", thinking: "inspect durable queue" }]),
		];
		const context = await buildConsultationContext({
			pi: fakePi(),
			ctx: ctx(entries),
			source: "pair",
			trajectorySequence: 12,
		});

		expect(context.request.current).toContain("preserve restart behavior");
		expect(context.request.prior).toContain("implement durable retry");
		expect(context.trajectory).toContain("inspect durable queue");
		expect(context.trajectory).not.toContain("obsolete-0");
	});

	it("keeps compact receipts, actionable error tails, diffs, and evidence handles", async () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "fix retry" } },
			assistant([
				{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/retry.ts" } },
				{ type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/retry.ts", edits: [{}] } },
				{ type: "toolCall", id: "test-1", name: "bash", arguments: { command: "npm test -- retry" } },
			]),
			toolResult({ id: "read-1", toolName: "read", text: "source\n".repeat(100) }),
			toolResult({ id: "edit-1", toolName: "edit", text: "ok", diff: "- old\n+ new" }),
			toolResult({
				id: "test-1",
				toolName: "bash",
				text: `${"noise\n".repeat(40)}AssertionError: durable queue missing`,
				isError: true,
			}),
		];
		const context = await buildConsultationContext({
			pi: fakePi(),
			ctx: ctx(entries),
			source: "pair",
			trajectorySequence: 3,
			hypothesis: {
				severity: "concern",
				claim: "Retry may bypass durability.",
				whyDeepReasoning: "Queue ownership spans modules.",
				evidence: [{ kind: "file", ref: "src/retry.ts", path: "src/retry.ts" }],
				uncertainty: "A wrapper may enqueue later.",
			},
		});

		expect(context.trajectory).toContain("100 lines");
		expect(context.trajectory).not.toContain("source\nsource");
		expect(context.trajectory).toContain("- old\n+ new");
		expect(context.openFailures).toContain("AssertionError: durable queue missing");
		expect(context.evidenceHandles).toContainEqual(expect.objectContaining({ ref: "call:test-1" }));
		expect(context.evidenceHandles).toContainEqual(expect.objectContaining({ ref: "src/retry.ts" }));
	});

	it("labels Pair hypotheses as untrusted and represents unavailable evidence", async () => {
		const context = await buildConsultationContext({
			pi: fakePi({ "rev-parse --is-inside-work-tree": "false\n" }),
			ctx: ctx([{ type: "message", message: { role: "user", content: "choose the safe queue path" } }]),
			source: "pair",
			trajectorySequence: 1,
			hypothesis: {
				severity: "blocker",
				claim: "Acknowledge happens before persistence.",
				whyDeepReasoning: "Transaction order is cross-cutting.",
				evidence: [],
			},
		});
		const rendered = renderConsultationContext(context);

		expect(rendered).toContain("UNTRUSTED CLAIM, NOT EVIDENCE");
		expect(rendered).toContain("Working state unavailable");
		expect(rendered).toContain("absence is not evidence");
	});

	it("does not impose an invented packet ceiling on required request or diff context", async () => {
		const request = `required-start-${"x".repeat(55_000)}-required-end`;
		const diff = `diff-start-${"z".repeat(30_000)}-diff-end`;
		const context = await buildConsultationContext({
			pi: fakePi({ "diff HEAD --no-ext-diff --unified=3": diff }),
			ctx: ctx([{ type: "message", message: { role: "user", content: request } }]),
			source: "gate",
			trajectorySequence: 2,
		});

		expect(context.request.current).toBe(request);
		expect(context.changedWork).toContain(diff);
	});

	it("fingerprints implicated paths separately for staleness decisions", async () => {
		const first = await captureConsultationWorkingState(fakePi(), "/tmp/consultation-project", ["src/retry.ts"]);
		const second = await captureConsultationWorkingState(
			fakePi({ "diff HEAD --no-ext-diff --unified=0 -- src/retry.ts": "+ changed again\n" }),
			"/tmp/consultation-project",
			["src/retry.ts"],
		);
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.relevanceFingerprint).not.toBe(second.relevanceFingerprint);
	});

	it("keeps the Advisor overlay independent, read-only, and typed", () => {
		expect(ADVISOR_CONSULTATION_OVERLAY).toContain("independent adjudication");
		expect(ADVISOR_CONSULTATION_OVERLAY).toContain("claims are not evidence");
		expect(ADVISOR_CONSULTATION_OVERLAY).toContain("Do not implement");
		expect(ADVISOR_CONSULTATION_OVERLAY).toContain("report_consultation exactly once");
	});
});
