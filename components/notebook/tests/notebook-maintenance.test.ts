import { describe, expect, it, vi } from "vitest";

import { DEFAULTS } from "../src/config.js";
import { hashId } from "../src/ids.js";
import { commitPairNotebookUpdate, preparePairNotebookBatch, UpdateNotebookTool } from "../src/notebook-maintenance.js";
import {
	NOTEBOOK_OBSERVATIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RECORDED,
	type Entry,
} from "../src/session-ledger/index.js";

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

describe("Pair notebook maintenance", () => {
	it("prepares one source-addressed maintenance span from uncovered primary entries", () => {
		const batch = preparePairNotebookBatch({
			entries: sourceEntries(),
			config: { ...DEFAULTS, notebookAfterTokens: 1 },
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
		expect(batch?.prompt).toContain("Time to update the shared notebook");
		expect(batch?.prompt).toContain("source-user, source-assistant");
	});

	it("stages a sourced observation and reflection in one host-validated transaction", async () => {
		const batch = preparePairNotebookBatch({
			entries: sourceEntries(),
			config: DEFAULTS,
			fullMaintenanceDue: true,
			sourceTokens: 42,
		});
		expect(batch).toBeDefined();
		const tool = new UpdateNotebookTool();
		tool.begin(batch);
		const observationContent = "The user selected Pair Programmer as the persistent companion paradigm.";
		const observationId = hashId(observationContent);
		const result = await tool.execute("notebook-1", {
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
		const batch = preparePairNotebookBatch({
			entries,
			config: DEFAULTS,
			fullMaintenanceDue: true,
			sourceTokens: 42,
		});
		const tool = new UpdateNotebookTool();
		tool.begin(batch);
		await tool.execute("notebook-2", {
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
		expect(commitPairNotebookUpdate({ appendEntry } as never, { disposed: false } as never, entries, staged!)).toBe(
			true,
		);
		expect(appendEntry).toHaveBeenCalledTimes(1);
		expect(appendEntry).toHaveBeenCalledWith(
			NOTEBOOK_OBSERVATIONS_RECORDED,
			expect.objectContaining({ coversUpToId: "source-assistant" }),
		);
		expect(appendEntry).not.toHaveBeenCalledWith(NOTEBOOK_REFLECTIONS_RECORDED, expect.anything());
	});
});
