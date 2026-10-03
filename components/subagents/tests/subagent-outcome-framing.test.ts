import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { type FramedOutcome, frameOutcome, type OutcomeDelivery, type OutcomeRecord } from "../src/outcome-framing.js";

const liveSession = {} as AgentSession;
const handle = "\n\nAgent ID: agent-1 (resume with the agent tool's resume parameter)";
const deliveries: OutcomeDelivery[] = [
	"foreground",
	"retrieved",
	"notification",
	"nested-foreground",
	"nested-retrieved",
];

const outcome = (overrides: Partial<OutcomeRecord>): OutcomeRecord => ({
	id: "agent-1",
	status: "completed",
	session: liveSession,
	...overrides,
});

const frameEach = (record: OutcomeRecord): Record<OutcomeDelivery, FramedOutcome> =>
	Object.fromEntries(deliveries.map((delivery) => [delivery, frameOutcome(record, delivery)])) as Record<
		OutcomeDelivery,
		FramedOutcome
	>;

describe("subagent outcome framing", () => {
	it("returns a clean completion unqualified on every surface", () => {
		const framed = frameEach(outcome({ result: "REPORT" }));
		for (const delivery of deliveries) {
			expect(framed[delivery].text).toBe("REPORT");
			expect(framed[delivery].summary).toBe("completed");
		}
	});

	it("keeps root text verbatim while nested results trim and fall back", () => {
		const padded = frameEach(outcome({ result: " REPORT \n" }));
		expect(padded.foreground.text).toBe(" REPORT \n");
		expect(padded.retrieved.text).toBe(" REPORT \n");
		expect(padded.notification.text).toBe(" REPORT \n");
		expect(padded["nested-foreground"].text).toBe("REPORT");
		expect(padded["nested-retrieved"].text).toBe("REPORT");

		const blank = frameEach(outcome({ result: "  ", error: " note " }));
		expect(blank.foreground.text).toBe("  ");
		expect(blank["nested-retrieved"].text).toBe("note");

		const errorOnly = frameEach(outcome({ result: "", error: "note" }));
		for (const delivery of deliveries) expect(errorOnly[delivery].text).toBe("note");

		const nothing = frameEach(outcome({}));
		for (const delivery of deliveries) expect(nothing[delivery].text).toBe("No output.");
	});

	it("labels a failure and keeps any partial output on every surface", () => {
		const partial = frameEach(outcome({ status: "error", error: "boom", result: "  PARTIAL \n" }));
		const empty = frameEach(outcome({ status: "error", result: "  " }));
		for (const delivery of deliveries) {
			expect(partial[delivery].text).toBe("Agent failed: boom\n\nPartial output before the failure:\nPARTIAL");
			expect(partial[delivery].summary).toBe("error");
			expect(empty[delivery].text).toBe("Agent failed: unknown error");
		}
	});

	it("tells an awaiting caller that everything the agent produced is already present", () => {
		const cases = {
			stopped: " (STOPPED BY THE USER — everything the agent produced is above; the task is unfinished)",
			aborted: " (aborted at the turn limit — everything the agent produced is above; the task is unfinished)",
			steered: " (wrapped up at the turn limit — everything the agent produced is above; the task may be unfinished)",
		} as const;
		for (const [status, note] of Object.entries(cases)) {
			const record = outcome({ status: status as OutcomeRecord["status"], result: "PARTIAL" });
			expect(frameOutcome(record, "foreground").text).toBe(`PARTIAL${note}`);
			expect(frameOutcome(record, "nested-foreground").text).toBe(`Nested agent${note}.\n\nPARTIAL`);
		}
	});

	it("qualifies retrieved results and notification summaries without claiming completeness", () => {
		const cases = {
			stopped: " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)",
			aborted: " (aborted — hit the turn limit before completion; output may be incomplete)",
			steered: " (wrapped up at the turn limit — output may be partial)",
		} as const;
		for (const [status, note] of Object.entries(cases)) {
			const record = outcome({ status: status as OutcomeRecord["status"], result: "PARTIAL" });
			expect(frameOutcome(record, "retrieved").text).toBe(`PARTIAL${note}`);
			expect(frameOutcome(record, "nested-retrieved").text).toBe(`Nested agent${note}.\n\nPARTIAL`);
			expect(frameOutcome(record, "notification")).toMatchObject({ text: "PARTIAL", summary: `${status}${note}` });
		}
	});

	it("presents a saved response by its path instead of its body", () => {
		const saved = { outputPath: "/work/out.md", outputWritten: true, result: "SAVED-BODY" };
		expect(frameOutcome(outcome(saved), "foreground").text).toBe("Agent output written to /work/out.md.");
		expect(frameOutcome(outcome({ ...saved, status: "aborted" }), "foreground").text).toBe(
			"Agent output written to /work/out.md. (aborted — hit the turn limit before completion; output may be incomplete)",
		);
		expect(frameOutcome(outcome({ ...saved, status: "error", error: "boom" }), "retrieved").text).toBe(
			"Agent failed: boom\n\nAgent output written to /work/out.md.",
		);
		expect(frameOutcome(outcome({ ...saved, outputWritten: false }), "retrieved").text).toBe("SAVED-BODY");
	});

	it("keeps the response inline beside both failures when persistence fails", () => {
		const unwritten = { outputPath: "/work/out.md", outputWritten: false, outputWriteError: "disk full" };
		expect(frameOutcome(outcome({ ...unwritten, status: "steered", result: "REPORT" }), "foreground")).toMatchObject({
			text: "Failed to write agent output to /work/out.md: disk full\n\nREPORT (wrapped up at the turn limit — everything the agent produced is above; the task may be unfinished)",
			summary: "failed to persist its output",
		});
		expect(
			frameOutcome(outcome({ ...unwritten, status: "error", error: "boom", result: "PARTIAL" }), "notification").text,
		).toBe(
			"Failed to write agent output to /work/out.md: disk full\n\nAgent failed: boom\n\nPartial output before the failure:\nPARTIAL",
		);
	});

	it("offers continuation only on its existing surfaces and only for a live session", () => {
		const live = frameEach(outcome({ status: "error", error: "boom" }));
		expect(live.foreground.resumeHandle).toBe(handle);
		expect(live["nested-foreground"].resumeHandle).toBe(handle);
		expect(live["nested-retrieved"].resumeHandle).toBe(handle);
		expect(live.retrieved.resumeHandle).toBe("");
		expect(live.notification.resumeHandle).toBe("");

		const startupFailure = frameEach(outcome({ status: "error", error: "boom", session: undefined }));
		for (const delivery of deliveries) expect(startupFailure[delivery].resumeHandle).toBe("");
		for (const delivery of deliveries) expect(live[delivery].text).not.toContain("Agent ID:");
	});
});
