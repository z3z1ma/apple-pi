import { describe, expect, it } from "vitest";

import {
	buildCompactionProjection,
	diffProjection,
	fullProjection,
	latestFullFoldBoundaryId,
	visibleProjection,
} from "../src/session-ledger/index.js";
import {
	compactionEntry,
	notebookDetails,
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	reflectionsRetiredEntry,
	textCustomMessage,
} from "./fixtures/session.js";

describe("notebook ledger projections", () => {
	it("full projection folds observations, reflections, and drops through the target", () => {
		const obs1 = observation("aaaaaaaaaaaa");
		const obs2 = observation("bbbbbbbbbbbb");
		const ref1 = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", { observations: [obs1, obs2], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", { reflections: [ref1], coversUpToId: "raw-1" }),
			observationsDroppedEntry("notebook-drop-1", {
				observationIds: ["aaaaaaaaaaaa"],
				coversUpToId: "notebook-eeeeeeeeeeee",
			}),
		];

		const projection = fullProjection(entries);

		expect(projection.observations.map((obs) => obs.id)).toEqual(["bbbbbbbbbbbb"]);
		expect(projection.reflections.map((ref) => ref.id)).toEqual(["eeeeeeeeeeee"]);
	});

	it("visible projection is empty when there is no notebook compaction", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", {
				observations: [observation("aaaaaaaaaaaa")],
				coversUpToId: "raw-1",
			}),
		];

		expect(visibleProjection(entries)).toEqual({ observations: [], reflections: [] });
	});

	it("visible projection uses the latest valid notebook.folded compaction details", () => {
		const obs1 = observation("aaaaaaaaaaaa");
		const ref1 = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const obs2 = observation("bbbbbbbbbbbb");
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			compactionEntry("cmp-1", {
				firstKeptEntryId: "raw-1",
				details: notebookDetails({ observations: [obs1], reflections: [] }),
			}),
			textCustomMessage("raw-2", "bbbb"),
			compactionEntry("cmp-2", {
				firstKeptEntryId: "raw-2",
				details: notebookDetails({ fullFold: true, observations: [obs2], reflections: [ref1] }),
			}),
		];

		expect(visibleProjection(entries)).toEqual({ observations: [obs2], reflections: [ref1] });
	});

	it("finds the latest full-fold boundary", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			compactionEntry("cmp-1", { firstKeptEntryId: "raw-1", details: notebookDetails({ fullFold: true }) }),
			textCustomMessage("raw-2", "bbbb"),
			compactionEntry("cmp-2", { firstKeptEntryId: "raw-2", details: notebookDetails({ fullFold: false }) }),
			textCustomMessage("raw-3", "cccc"),
			compactionEntry("cmp-3", { firstKeptEntryId: "raw-3", details: notebookDetails({ fullFold: true }) }),
		];

		expect(latestFullFoldBoundaryId(entries)).toBe("raw-3");
	});

	it("first compaction applies reflections and drops through the cut", () => {
		const obs1 = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-2"], tokenCount: 10 });
		const ref1 = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			textCustomMessage("raw-2", "bbbb"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", { observations: [obs1], coversUpToId: "raw-2" }),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", { reflections: [ref1], coversUpToId: "raw-2" }),
			observationsDroppedEntry("notebook-drop-1", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "raw-2" }),
		];

		const result = buildCompactionProjection(entries, "raw-2", { observationsPoolMaxTokens: 100 });

		expect(result.fullFold).toBe(false);
		expect(result.observations.map((obs) => obs.id)).toEqual([]);
		expect(result.reflections.map((ref) => ref.id)).toEqual(["eeeeeeeeeeee"]);
		expect(result.details).toMatchObject({ type: "notebook.folded", version: 1, fullFold: false });
	});

	it("compaction projection applies later reflections, retirements, and drops before overflow", () => {
		const obs1 = observation("aaaaaaaaaaaa", { tokenCount: 5 });
		const obs2 = observation("bbbbbbbbbbbb", { tokenCount: 5 });
		const ref1 = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const ref2 = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", { observations: [obs1], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", { reflections: [ref1], coversUpToId: "raw-1" }),
			compactionEntry("cmp-full", {
				firstKeptEntryId: "raw-1",
				details: notebookDetails({ fullFold: true, observations: [obs1], reflections: [ref1] }),
			}),
			textCustomMessage("raw-2", "bbbb"),
			observationsRecordedEntry("notebook-bbbbbbbbbbbb", { observations: [obs2], coversUpToId: "raw-2" }),
			reflectionsRecordedEntry("notebook-ffffffffffff", { reflections: [ref2], coversUpToId: "raw-2" }),
			reflectionsRetiredEntry("notebook-retire-1", {
				reflectionIds: ["eeeeeeeeeeee"],
				successorIds: ["ffffffffffff"],
				coversUpToId: "raw-2",
			}),
			observationsDroppedEntry("notebook-drop-2", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "raw-2" }),
		];

		const result = buildCompactionProjection(entries, "raw-2", { observationsPoolMaxTokens: 100 });

		expect(result.fullFold).toBe(false);
		expect(result.observations.map((obs) => obs.id)).toEqual(["bbbbbbbbbbbb"]);
		expect(result.reflections.map((ref) => ref.id)).toEqual(["ffffffffffff"]);
		expect(result.details).toMatchObject({ type: "notebook.folded", version: 1, fullFold: false });
	});

	it("full compaction projection applies reflections and drops through the cut", () => {
		const obs1 = observation("aaaaaaaaaaaa", { tokenCount: 80 });
		const obs2 = observation("bbbbbbbbbbbb", { tokenCount: 120 });
		const ref1 = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const ref2 = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", { observations: [obs1], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", { reflections: [ref1], coversUpToId: "raw-1" }),
			compactionEntry("cmp-full", {
				firstKeptEntryId: "raw-1",
				details: notebookDetails({ fullFold: true, observations: [obs1], reflections: [ref1] }),
			}),
			textCustomMessage("raw-2", "bbbb"),
			observationsRecordedEntry("notebook-bbbbbbbbbbbb", { observations: [obs2], coversUpToId: "raw-2" }),
			reflectionsRecordedEntry("notebook-ffffffffffff", { reflections: [ref2], coversUpToId: "raw-2" }),
			observationsDroppedEntry("notebook-drop-2", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "raw-2" }),
		];

		const result = buildCompactionProjection(entries, "raw-2", { observationsPoolMaxTokens: 100 });

		expect(result.fullFold).toBe(true);
		expect(result.observations.map((obs) => obs.id)).toEqual(["bbbbbbbbbbbb"]);
		expect(result.reflections.map((ref) => ref.id)).toEqual(["eeeeeeeeeeee", "ffffffffffff"]);
		expect(result.details).toMatchObject({ type: "notebook.folded", version: 1, fullFold: true });
	});

	it("ignores dangling coversUpToId markers during projection", () => {
		const obs1 = observation("aaaaaaaaaaaa", { tokenCount: 10 });
		const ref1 = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", { observations: [obs1], coversUpToId: "missing" }),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", { reflections: [ref1], coversUpToId: "missing" }),
			observationsDroppedEntry("notebook-drop-1", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "missing" }),
		];

		expect(() => fullProjection(entries, "raw-1")).not.toThrow();
		expect(fullProjection(entries, "raw-1")).toEqual({ observations: [], reflections: [] });
	});

	it("keeps the first covered observation and reflection for duplicate ids", () => {
		const firstObs = observation("aaaaaaaaaaaa", { content: "first observation" });
		const secondObs = observation("aaaaaaaaaaaa", { content: "second observation" });
		const firstRef = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "first reflection" });
		const secondRef = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "second reflection" });
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-obs-1", { observations: [firstObs], coversUpToId: "raw-1" }),
			observationsRecordedEntry("notebook-obs-2", { observations: [secondObs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("notebook-ref-1", { reflections: [firstRef], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("notebook-ref-2", { reflections: [secondRef], coversUpToId: "raw-1" }),
		];

		const projection = fullProjection(entries, "raw-1");

		expect(projection.observations).toEqual([firstObs]);
		expect(projection.reflections).toEqual([firstRef]);
	});

	it("uses >= observationsPoolMaxTokens for full-fold pressure", () => {
		const obs1 = observation("aaaaaaaaaaaa", { tokenCount: 50 });
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", { observations: [obs1], coversUpToId: "raw-1" }),
		];

		expect(buildCompactionProjection(entries, "raw-1", { observationsPoolMaxTokens: 50 }).fullFold).toBe(true);
	});

	it("reports visible/full drift", () => {
		const visible = { observations: [observation("aaaaaaaaaaaa")], reflections: [] };
		const full = {
			observations: [observation("aaaaaaaaaaaa"), observation("bbbbbbbbbbbb")],
			reflections: [reflection("eeeeeeeeeeee", ["bbbbbbbbbbbb"])],
		};

		const diff = diffProjection(visible, full);

		expect(diff.observationsOnlyInFull.map((obs) => obs.id)).toEqual(["bbbbbbbbbbbb"]);
		expect(diff.reflectionsOnlyInFull.map((ref) => ref.id)).toEqual(["eeeeeeeeeeee"]);
	});
});
