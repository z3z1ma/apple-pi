import { describe, expect, it, vi } from "vitest";

import { DEFAULTS } from "../src/config.js";
import { hashId } from "../src/ids.js";
import { commitPairMemoryUpdate, preparePairMemoryBatch, UpdateMemoryTool } from "../src/pair-maintenance.js";
import { OM_OBSERVATIONS_RECORDED, OM_REFLECTIONS_RECORDED, type Entry } from "../src/session-ledger/index.js";

function sourceEntries(): Entry[] {
	return [
		{
			type: "message",
			id: "source-user",
			message: { role: "user", content: [{ type: "text", text: "Use the Pair Programmer paradigm." }] },
		},
		{
			type: "message",
			id: "source-assistant",
			message: { role: "assistant", content: [{ type: "text", text: "Proceeding." }] },
		},
	];
}

describe("Pair memory maintenance", () => {
	it("prepares one source-addressed maintenance span from uncovered primary entries", () => {
		const batch = preparePairMemoryBatch({
			entries: sourceEntries(),
			config: { ...DEFAULTS, memoryAfterTokens: 1 },
			contextWindow: 128_000,
			fullMaintenanceDue: true,
			sourceTokens: 42,
			sessionIdentity: "session-1",
		});
		expect(batch).toMatchObject({
			coversUpToId: "source-assistant",
			allowedSourceEntryIds: ["source-user", "source-assistant"],
			fullMaintenanceDue: true,
			sourceTokens: 42,
			sessionIdentity: "session-1",
		});
		expect(batch?.prompt).toContain("Pair memory maintenance due");
		expect(batch?.prompt).toContain("source-user, source-assistant");
	});

	it("stages a sourced observation and reflection in one host-validated transaction", async () => {
		const batch = preparePairMemoryBatch({
			entries: sourceEntries(),
			config: DEFAULTS,
			fullMaintenanceDue: true,
			sourceTokens: 42,
		});
		expect(batch).toBeDefined();
		const tool = new UpdateMemoryTool();
		tool.begin(batch);
		const observationContent = "The user selected Pair Programmer as the persistent companion paradigm.";
		const observationId = hashId(observationContent);
		const result = await tool.execute("memory-1", {
			observations: [
				{
					timestamp: "2026-08-27 18:00",
					content: observationContent,
					relevance: "critical",
					sourceEntryIds: ["source-user"],
				},
			],
			reflections: [
				{
					content: "The persistent companion is the Pair Programmer.",
					supportingObservationIds: [observationId],
				},
			],
			retireReflectionIds: [],
			dropObservationIds: [],
		});
		expect(result.details).toMatchObject({ accepted: true, observations: 1, reflections: 1 });
		const staged = tool.takeStaged();
		expect(staged?.observations[0]).toMatchObject({
			id: observationId,
			sourceEntryIds: ["source-user"],
		});
		expect(staged?.reflections[0]?.supportingObservationIds).toEqual([observationId]);
	});

	it("rejects invented source ids and commits accepted records only through the root host", async () => {
		const entries = sourceEntries();
		const batch = preparePairMemoryBatch({
			entries,
			config: DEFAULTS,
			fullMaintenanceDue: true,
			sourceTokens: 42,
		});
		const tool = new UpdateMemoryTool();
		tool.begin(batch);
		await tool.execute("memory-2", {
			observations: [
				{
					timestamp: "2026-08-27 18:00",
					content: "Invented evidence must not persist.",
					relevance: "high",
					sourceEntryIds: ["invented"],
				},
				{
					timestamp: "2026-08-27 18:01",
					content: "The Pair shares the primary trajectory.",
					relevance: "high",
					sourceEntryIds: ["source-user"],
				},
			],
			reflections: [],
			retireReflectionIds: [],
			dropObservationIds: [],
		});
		const staged = tool.takeStaged();
		expect(staged?.observations).toHaveLength(1);
		const appendEntry = vi.fn();
		expect(commitPairMemoryUpdate({ appendEntry } as never, { disposed: false } as never, entries, staged!)).toBe(true);
		expect(appendEntry).toHaveBeenCalledTimes(1);
		expect(appendEntry).toHaveBeenCalledWith(
			OM_OBSERVATIONS_RECORDED,
			expect.objectContaining({ coversUpToId: "source-assistant" }),
		);
		expect(appendEntry).not.toHaveBeenCalledWith(OM_REFLECTIONS_RECORDED, expect.anything());
	});
});
