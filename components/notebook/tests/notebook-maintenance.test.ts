import { describe, expect, it, vi } from "vitest";

import { DEFAULTS } from "../src/config.js";
import { hashId } from "../src/ids.js";
import {
	applyNotebookUpdate,
	commitNotebookUpdate,
	preparePairNotebookBatch,
	registerMainNotebookTool,
	UpdateNotebookTool,
} from "../src/notebook-maintenance.js";
import { type Entry, foldLedger, NOTEBOOK_MAINTENANCE, type Reflection } from "../src/session-ledger/index.js";

function sourceEntries(): Entry[] {
	return [
		{
			type: "message",
			id: "source-user",
			message: { role: "user", content: [{ type: "text", text: "Use the pair programmer paradigm." }] },
		},
		{
			type: "message",
			id: "source-assistant",
			message: { role: "assistant", content: [{ type: "text", text: "Proceeding." }] },
		},
	];
}

function conclusion(content: string, sourceEntryIds = ["source-user"]): Reflection {
	const id = hashId(content);
	return {
		id,
		content,
		supportingObservationIds: [],
		sourceEntryIds,
		tokenCount: Math.ceil(content.length / 4),
	};
}

describe("pair programmer notebook maintenance", () => {
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
		expect(batch?.prompt).toContain("retainReflectionIds");
		expect(batch?.prompt).not.toContain("Current law");
		expect(batch?.prompt).toContain("source-user, source-assistant");
	});

	it("stages a sourced working conclusion in one host-validated transaction", async () => {
		const batch = preparePairNotebookBatch({
			entries: sourceEntries(),
			config: DEFAULTS,
			fullMaintenanceDue: true,
			sourceTokens: 42,
		});
		expect(batch).toBeDefined();
		const tool = new UpdateNotebookTool();
		tool.begin(batch);
		const content = "The persistent companion is the pair programmer.";
		const result = await tool.execute("notebook-1", {
			reflections: [{ content, sourceEntryIds: ["source-user"] }],
			retireReflectionIds: [],
			retainReflectionIds: [],
		});
		expect(result.details).toMatchObject({ accepted: true, reflections: 1 });
		const staged = tool.takeStaged();
		expect(staged?.reflections[0]).toMatchObject({
			id: expect.stringMatching(/^[a-f0-9]{12}$/),
			sourceEntryIds: ["source-user"],
			supportingObservationIds: [],
		});
		expect(staged?.expectedReflectionIds).toEqual([]);
	});

	it("rejects invented source ids and commits accepted records only through the root host", async () => {
		const entries = sourceEntries();
		const batch = preparePairNotebookBatch({
			entries,
			config: DEFAULTS,
			fullMaintenanceDue: false,
			sourceTokens: 42,
		});
		const tool = new UpdateNotebookTool();
		tool.begin(batch);
		await tool.execute("notebook-2", {
			reflections: [
				{
					content: "Invented evidence must not persist.",
					sourceEntryIds: ["invented"],
				},
				{
					content: "The pair programmer shares the primary trajectory.",
					sourceEntryIds: ["source-user"],
				},
			],
			retireReflectionIds: [],
			retainReflectionIds: [],
		});
		const staged = tool.takeStaged();
		expect(staged?.reflections).toHaveLength(1);
		expect(staged?.rejected).toBe(1);
		const appendEntry = vi.fn();
		expect(commitNotebookUpdate({ appendEntry } as never, { disposed: false } as never, entries, staged!)).toBe(true);
		expect(appendEntry).toHaveBeenCalledTimes(1);
		expect(appendEntry).toHaveBeenCalledWith(
			NOTEBOOK_MAINTENANCE,
			expect.objectContaining({
				coversUpToId: "source-user",
				observations: [],
				reflections: [expect.objectContaining({ sourceEntryIds: ["source-user"] })],
			}),
		);
	});

	it("commits an empty full review as one coverage envelope", () => {
		const entries = sourceEntries();
		const appendEntry = vi.fn();
		expect(
			commitNotebookUpdate({ appendEntry } as never, { disposed: false } as never, entries, {
				batchId: "empty",
				coversUpToId: "source-assistant",
				reflections: [],
				retiredIds: [],
				expectedReflectionIds: [],
				fullMaintenanceDue: true,
				sourceTokens: 42,
				rejected: 0,
			}),
		).toBe(true);
		expect(appendEntry).toHaveBeenCalledTimes(1);
		expect(appendEntry).toHaveBeenCalledWith(
			NOTEBOOK_MAINTENANCE,
			expect.objectContaining({ observations: [], reflections: [], coversUpToId: "source-assistant" }),
		);
	});

	it("retires current conclusions omitted from retainReflectionIds during full maintenance", () => {
		const keep = conclusion("Keep this constraint.");
		const drop = conclusion("This is now out of scope.");
		const applied = applyNotebookUpdate(
			{
				allowedSourceEntryIds: ["source-user"],
				currentReflections: [keep, drop],
				expectedReflectionIds: [keep.id, drop.id],
				fullMaintenanceDue: true,
				coversUpToId: "source-assistant",
			},
			{
				reflections: [],
				retireReflectionIds: [],
				retainReflectionIds: [keep.id],
			},
		);
		expect(applied.retiredIds).toEqual([drop.id]);
		expect(applied.reflections).toEqual([]);
	});

	it("treats an empty retain list as clearing the notebook during full maintenance", () => {
		const current = conclusion("Stale conclusion.");
		const applied = applyNotebookUpdate(
			{
				allowedSourceEntryIds: ["source-user"],
				currentReflections: [current],
				expectedReflectionIds: [current.id],
				fullMaintenanceDue: true,
				coversUpToId: "source-assistant",
			},
			{ reflections: [], retireReflectionIds: [], retainReflectionIds: [] },
		);
		expect(applied.retiredIds).toEqual([current.id]);
	});

	it("requires an explicit retention decision for a full review", () => {
		expect(() =>
			applyNotebookUpdate(
				{
					allowedSourceEntryIds: [],
					currentReflections: [],
					expectedReflectionIds: [],
					fullMaintenanceDue: true,
					coversUpToId: "source-user",
				},
				{ reflections: [], retireReflectionIds: [] },
			),
		).toThrow("explicitly select retainReflectionIds");
	});

	it("rejects a full review with invalid replacements before retiring anything", () => {
		const current = conclusion("Keep until a valid review.");
		expect(() =>
			applyNotebookUpdate(
				{
					allowedSourceEntryIds: ["source-user"],
					currentReflections: [current],
					expectedReflectionIds: [current.id],
					fullMaintenanceDue: true,
					coversUpToId: "source-user",
				},
				{
					reflections: [{ content: "Replacement", sourceEntryIds: ["invented"] }],
					retireReflectionIds: [],
					retainReflectionIds: [],
				},
			),
		).toThrow("invalid conclusions");
	});

	it("can restore a retired conclusion as a new sourced record", () => {
		const old = conclusion("This constraint applies again.");
		const entries: Entry[] = [
			...sourceEntries(),
			{
				type: "custom",
				id: "old",
				customType: NOTEBOOK_MAINTENANCE,
				data: {
					coversUpToId: "source-user",
					observations: [],
					reflections: [old],
					retiredReflectionIds: [old.id],
					droppedObservationIds: [],
				},
			},
		];
		const update = applyNotebookUpdate(
			{
				allowedSourceEntryIds: ["source-user"],
				currentReflections: [],
				expectedReflectionIds: [],
				fullMaintenanceDue: false,
				coversUpToId: "source-user",
			},
			{ reflections: [{ content: old.content, sourceEntryIds: ["source-user"] }], retireReflectionIds: [] },
		);
		commitNotebookUpdate(
			{
				appendEntry: (customType: string, data: unknown) =>
					entries.push({ type: "custom", id: "new", customType, data }),
			} as never,
			{ disposed: false } as never,
			entries,
			update,
		);
		expect(foldLedger(entries).currentReflections).toHaveLength(1);
		expect(foldLedger(entries).currentReflections[0].id).not.toBe(old.id);
	});

	it("lets the main agent cite its current user turn without opaque ids", async () => {
		const entries = sourceEntries();
		let tool: any;
		registerMainNotebookTool(
			{
				registerTool: (definition: unknown) => {
					tool = definition;
				},
				appendEntry: (customType: string, data: unknown) =>
					entries.push({ type: "custom", id: "main-update", customType, data }),
			} as never,
			{ disposed: false, ensureConfig: () => {} } as never,
		);
		await tool.execute(
			"call",
			{ reflections: [{ content: "Use one shared correction path." }], retireReflectionIds: [] },
			undefined,
			undefined,
			{ cwd: "/tmp", sessionManager: { getBranch: () => entries } },
		);
		expect(foldLedger(entries).currentReflections[0].sourceEntryIds).toEqual(["source-user", "source-assistant"]);
	});

	it("ignores retainReflectionIds on targeted updates", () => {
		const keep = conclusion("Still true.");
		const drop = conclusion("Retire only this one.");
		const applied = applyNotebookUpdate(
			{
				allowedSourceEntryIds: ["source-user"],
				currentReflections: [keep, drop],
				expectedReflectionIds: [keep.id, drop.id],
				fullMaintenanceDue: false,
				coversUpToId: "source-user",
			},
			{
				reflections: [],
				retireReflectionIds: [drop.id],
				retainReflectionIds: [],
			},
		);
		expect(applied.retiredIds).toEqual([drop.id]);
		expect(applied.reflections).toEqual([]);
	});

	it("rejects a stale commit after the live conclusions change", () => {
		const current = conclusion("Original conclusion.");
		const entries: Entry[] = [
			...sourceEntries(),
			{
				type: "custom",
				id: "maintenance-1",
				customType: NOTEBOOK_MAINTENANCE,
				data: {
					coversUpToId: "source-assistant",
					observations: [],
					reflections: [current],
					retiredReflectionIds: [],
					droppedObservationIds: [],
				},
			},
		];
		const appendEntry = vi.fn();
		expect(
			commitNotebookUpdate({ appendEntry } as never, { disposed: false } as never, entries, {
				coversUpToId: "source-assistant",
				reflections: [conclusion("Newer conclusion.")],
				retiredIds: [],
				expectedReflectionIds: [],
				fullMaintenanceDue: false,
				rejected: 0,
			}),
		).toBe(false);
		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("does not append a no-op targeted update", () => {
		const appendEntry = vi.fn();
		expect(
			commitNotebookUpdate({ appendEntry } as never, { disposed: false } as never, sourceEntries(), {
				coversUpToId: "source-assistant",
				reflections: [],
				retiredIds: [],
				expectedReflectionIds: [],
				fullMaintenanceDue: false,
				rejected: 0,
			}),
		).toBe(true);
		expect(appendEntry).not.toHaveBeenCalled();
	});
});
