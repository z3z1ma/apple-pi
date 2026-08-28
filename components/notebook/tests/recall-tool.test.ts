import { describe, expect, it, vi } from "vitest";

import {
	formatRecallCallForTui,
	formatRecallRenderedResultForTui,
	NOTEBOOK_SOURCE_TOOL_NAME,
	recallObservationTool,
	registerRecallTool,
} from "../src/tools/notebook-source.js";
import {
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	rawMessage,
	reflection,
	reflectionsRecordedEntry,
	type TestEntry,
} from "./fixtures/session.js";

function fakeCtx(entries: TestEntry[]) {
	const getBranch = vi.fn(() => entries);
	const getEntries = vi.fn(() => {
		throw new Error("recall tool must not use getEntries");
	});
	return { ctx: { sessionManager: { getBranch, getEntries } }, getBranch, getEntries };
}

async function execute(id: string, entries: TestEntry[]) {
	const { ctx, getBranch, getEntries } = fakeCtx(entries);
	const result = await recallObservationTool.execute("tool-1", { id }, undefined as any, undefined as any, ctx as any);
	const text = result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return { result, text, getBranch, getEntries };
}

describe("revisit note tool", () => {
	it("uses the model-facing name without changing TUI call rendering", () => {
		const pi = { registerTool: vi.fn() };
		registerRecallTool(pi as any);

		expect(NOTEBOOK_SOURCE_TOOL_NAME).toBe("revisit_note");
		expect(recallObservationTool.name).toBe("revisit_note");
		expect(recallObservationTool.label).toBe("Notebook source");
		expect(formatRecallCallForTui("aaaaaaaaaaaa")).toBe("notebook_source aaaaaaaaaaaa");
		expect(pi.registerTool).toHaveBeenCalledWith(recallObservationTool);
	});

	it("renders active observation source evidence", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User likes tea.", sourceEntryIds: ["raw-1"] });
		const entries = [
			rawMessage("raw-1", "I like tea."),
			observationsRecordedEntry("notebook-obs", { observations: [obs], coversUpToId: "raw-1" }),
		];

		const { result, text, getBranch, getEntries } = await execute("aaaaaaaaaaaa", entries);

		expect(getBranch).toHaveBeenCalledOnce();
		expect(getEntries).not.toHaveBeenCalled();
		expect(result.details?.status).toBe("ok");
		expect(result.details?.matches[0].observation.status).toBe("active");
		expect(text).toContain("I like tea.");
		expect(formatRecallRenderedResultForTui(result as any, false)).toContain("✓ observation");
	});

	it("renders dropped observations as recallable but dropped", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User likes tea.", sourceEntryIds: ["raw-1"] });
		const entries = [
			rawMessage("raw-1", "I like tea."),
			observationsRecordedEntry("notebook-obs", { observations: [obs], coversUpToId: "raw-1" }),
			observationsDroppedEntry("notebook-drop", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "notebook-obs" }),
		];

		const { result, text } = await execute("aaaaaaaaaaaa", entries);
		const tui = formatRecallRenderedResultForTui(result as any, false);

		expect(result.details?.matches[0].observation.status).toBe("dropped");
		expect(text).toContain("dropped from active notebook but remains recallable");
		expect(tui).toContain("[dropped]");
	});

	it("renders reflection recall with supporting observations and sources", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User likes tea.", sourceEntryIds: ["raw-1"] });
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "User likes tea." });
		const entries = [
			rawMessage("raw-1", "I like tea."),
			observationsRecordedEntry("notebook-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("notebook-ref", { reflections: [ref], coversUpToId: "notebook-obs" }),
		];

		const { result, text } = await execute("eeeeeeeeeeee", entries);

		expect(result.details?.status).toBe("ok");
		expect(result.details?.reflections).toHaveLength(1);
		expect(result.details?.observations).toHaveLength(1);
		expect(text).toContain("Reflections:");
		expect(text).toContain("[eeeeeeeeeeee] User likes tea.");
		expect(text).toContain("Observations:");
		expect(text).toContain("Sources:");
		expect(text).toContain("I like tea.");
	});

	it("reports missing sources as partial", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["missing-raw"] });
		const entries = [observationsRecordedEntry("notebook-obs", { observations: [obs], coversUpToId: "notebook-obs" })];

		const { result, text } = await execute("aaaaaaaaaaaa", entries);

		expect(result.details?.status).toBe("partial");
		expect(result.details?.missingSourceEntryIds).toEqual(["missing-raw"]);
		expect(text).toContain("missing: missing-raw");
	});

	it("reports invalid ids without reading the branch", async () => {
		const { result, text, getBranch } = await execute("not-valid", []);

		expect(result.details?.status).toBe("invalid_id");
		expect(text).toContain("Notebook id must be 12 lowercase hex characters");
		expect(getBranch).not.toHaveBeenCalled();
	});
});
