import { describe, expect, it } from "vitest";

import {
	buildObservationsDroppedData,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRetiredData,
	isMemoryDetails,
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
	OM_FOLDED,
	OM_OBSERVATIONS_DROPPED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_RETIRED,
} from "../src/session-ledger/index.js";
import {
	memoryDetails,
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	reflectionsRetiredEntry,
} from "./fixtures/session.js";

describe("session-ledger V3 type guards and builders", () => {
	it("exports the V3 custom type constants", () => {
		expect(OM_OBSERVATIONS_RECORDED).toBe("om.observations.recorded");
		expect(OM_REFLECTIONS_RECORDED).toBe("om.reflections.recorded");
		expect(OM_OBSERVATIONS_DROPPED).toBe("om.observations.dropped");
		expect(OM_REFLECTIONS_RETIRED).toBe("om.reflections.retired");
		expect(OM_FOLDED).toBe("om.folded");
	});

	it("accepts valid V3 observation records and rejects observations without source ids", () => {
		expect(isObservation(observation("aaaaaaaaaaaa"))).toBe(true);
		expect(isObservation({ ...observation("bbbbbbbbbbbb"), sourceEntryIds: [] })).toBe(false);
		expect(isObservation({ ...observation("cccccccccccc"), sourceEntryIds: undefined })).toBe(false);
		expect(isObservation({ ...observation("dddddddddddd"), tokenCount: undefined })).toBe(false);
	});

	it("accepts valid V3 reflection records", () => {
		expect(isReflection(reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]))).toBe(true);
		expect(isReflection({ ...reflection("ffffffffffff"), supportingObservationIds: undefined })).toBe(false);
		expect(isReflection({ ...reflection("111111111111"), tokenCount: undefined })).toBe(false);
	});

	it("accepts non-empty V3 ledger entry data", () => {
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

	it("recognizes V3 memory entries", () => {
		expect(
			isObservationsRecordedEntry(
				observationsRecordedEntry("om-aaaaaaaaaaaa", {
					observations: [observation("aaaaaaaaaaaa")],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(true);
		expect(
			isReflectionsRecordedEntry(
				reflectionsRecordedEntry("om-eeeeeeeeeeee", {
					reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(true);
		expect(
			isObservationsDroppedEntry(
				observationsDroppedEntry("om-drop-1", {
					observationIds: ["aaaaaaaaaaaa"],
					coversUpToId: "om-eeeeeeeeeeee",
				}),
			),
		).toBe(true);
		expect(
			isReflectionsRetiredEntry(
				reflectionsRetiredEntry("om-retire-1", {
					reflectionIds: ["eeeeeeeeeeee"],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(true);
	});

	it("accepts flat V3 folded memory details", () => {
		expect(
			isMemoryDetails(
				memoryDetails({
					fullFold: true,
					observations: [observation("aaaaaaaaaaaa")],
					reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				}),
			),
		).toBe(true);
	});
});
