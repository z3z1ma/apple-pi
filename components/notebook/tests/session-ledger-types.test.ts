import { describe, expect, it } from "vitest";

import {
	buildObservationsDroppedData,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRetiredData,
	isNotebookDetails,
	isObservation,
	isObservationsDroppedData,
	isObservationsDroppedEntry,
	isObservationsRecordedData,
	isObservationsRecordedEntry,
	isReflection,
	isReflectionsRecordedData,
	isReflectionsRecordedEntry,
	isReflectionsRetiredData,
	isReflectionsRetiredEntry,
	NOTEBOOK_FOLDED,
	NOTEBOOK_OBSERVATIONS_DROPPED,
	NOTEBOOK_OBSERVATIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RETIRED,
} from "../src/session-ledger/index.js";
import {
	notebookDetails,
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	reflectionsRetiredEntry,
} from "./fixtures/session.js";

describe("notebook ledger type guards and builders", () => {
	it("exports the notebook custom type constants", () => {
		expect(NOTEBOOK_OBSERVATIONS_RECORDED).toBe("notebook.observations.recorded");
		expect(NOTEBOOK_REFLECTIONS_RECORDED).toBe("notebook.reflections.recorded");
		expect(NOTEBOOK_OBSERVATIONS_DROPPED).toBe("notebook.observations.dropped");
		expect(NOTEBOOK_REFLECTIONS_RETIRED).toBe("notebook.reflections.retired");
		expect(NOTEBOOK_FOLDED).toBe("notebook.folded");
	});

	it("accepts valid notebook observation records and rejects observations without source ids", () => {
		expect(isObservation(observation("aaaaaaaaaaaa"))).toBe(true);
		expect(isObservation({ ...observation("bbbbbbbbbbbb"), sourceEntryIds: [] })).toBe(false);
		expect(isObservation({ ...observation("cccccccccccc"), sourceEntryIds: undefined })).toBe(false);
		expect(isObservation({ ...observation("dddddddddddd"), tokenCount: undefined })).toBe(false);
	});

	it("accepts valid notebook reflection records", () => {
		expect(isReflection(reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]))).toBe(true);
		expect(isReflection({ ...reflection("ffffffffffff"), supportingObservationIds: undefined })).toBe(false);
		expect(isReflection({ ...reflection("111111111111"), tokenCount: undefined })).toBe(false);
	});

	it("accepts non-empty notebook ledger entry data", () => {
		const obsData = { observations: [observation("aaaaaaaaaaaa")], coversUpToId: "raw-1" };
		const refData = { reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])], coversUpToId: "raw-2" };
		const dropData = { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "ref-entry-1" };
		const retireData = { reflectionIds: ["eeeeeeeeeeee"], coversUpToId: "raw-2", successorIds: ["ffffffffffff"] };

		expect(isObservationsRecordedData(obsData)).toBe(true);
		expect(isReflectionsRecordedData(refData)).toBe(true);
		expect(isObservationsDroppedData(dropData)).toBe(true);
		expect(isReflectionsRetiredData(retireData)).toBe(true);
	});

	it("rejects empty ledger entry data so no empty progress entries can be appended", () => {
		expect(isObservationsRecordedData({ observations: [], coversUpToId: "raw-1" })).toBe(false);
		expect(isReflectionsRecordedData({ reflections: [], coversUpToId: "raw-1" })).toBe(false);
		expect(isObservationsDroppedData({ observationIds: [], coversUpToId: "raw-1" })).toBe(false);
		expect(isReflectionsRetiredData({ reflectionIds: [], coversUpToId: "raw-1" })).toBe(false);
	});

	it("builders return undefined for empty arrays and data for non-empty arrays", () => {
		expect(buildObservationsRecordedData([], "raw-1")).toBeUndefined();
		expect(buildReflectionsRecordedData([], "raw-1")).toBeUndefined();
		expect(buildObservationsDroppedData([], "raw-1")).toBeUndefined();
		expect(buildReflectionsRetiredData([], "raw-1")).toBeUndefined();

		expect(buildObservationsRecordedData([observation("aaaaaaaaaaaa")], "raw-1")).toEqual({
			observations: [observation("aaaaaaaaaaaa")],
			coversUpToId: "raw-1",
		});
		expect(buildReflectionsRecordedData([reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])], "raw-1")).toEqual({
			reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
			coversUpToId: "raw-1",
		});
		expect(buildObservationsDroppedData(["aaaaaaaaaaaa"], "ref-entry-1")).toEqual({
			observationIds: ["aaaaaaaaaaaa"],
			coversUpToId: "ref-entry-1",
		});
		expect(buildReflectionsRetiredData(["eeeeeeeeeeee"], "raw-1", ["ffffffffffff"])).toEqual({
			reflectionIds: ["eeeeeeeeeeee"],
			coversUpToId: "raw-1",
			successorIds: ["ffffffffffff"],
		});
	});

	it("recognizes notebook entries", () => {
		expect(
			isObservationsRecordedEntry(
				observationsRecordedEntry("notebook-aaaaaaaaaaaa", {
					observations: [observation("aaaaaaaaaaaa")],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(true);
		expect(
			isReflectionsRecordedEntry(
				reflectionsRecordedEntry("notebook-eeeeeeeeeeee", {
					reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(true);
		expect(
			isObservationsDroppedEntry(
				observationsDroppedEntry("notebook-drop-1", {
					observationIds: ["aaaaaaaaaaaa"],
					coversUpToId: "notebook-eeeeeeeeeeee",
				}),
			),
		).toBe(true);
		expect(
			isReflectionsRetiredEntry(
				reflectionsRetiredEntry("notebook-retire-1", {
					reflectionIds: ["eeeeeeeeeeee"],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(true);
	});

	it("accepts folded notebook details", () => {
		expect(
			isNotebookDetails(
				notebookDetails({
					fullFold: true,
					observations: [observation("aaaaaaaaaaaa")],
					reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				}),
			),
		).toBe(true);
	});
});
