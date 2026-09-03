import { describe, expect, it } from "vitest";

import {
	earlierCoverageMarkerId,
	entryIndexById,
	isSourceEntry,
	latestCoverageIndex,
	latestCoverageMarkerId,
	rawTokensAfterIndex,
	rawTokensSinceDropCoverage,
	rawTokensSinceObservationCoverage,
	rawTokensSinceReflectionCoverage,
} from "../src/session-ledger/index.js";
import {
	branchSummary,
	compactionEntry,
	NOTEBOOK_OBSERVATIONS_DROPPED,
	NOTEBOOK_OBSERVATIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RECORDED,
	NOTEBOOK_REFLECTIONS_RETIRED,
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	reflectionsRetiredEntry,
	textCustomMessage,
} from "./fixtures/session.js";

describe("notebook ledger progress helpers", () => {
	it("detects only raw/source entries as source entries", () => {
		expect(isSourceEntry(textCustomMessage("raw-1", "abcd"))).toBe(true);
		expect(isSourceEntry(branchSummary("sum-1", "abcd"))).toBe(true);
		expect(
			isSourceEntry({
				type: "message",
				id: "bash-visible",
				message: { role: "bashExecution", command: "npm test", output: "ok", excludeFromContext: false },
			}),
		).toBe(true);
		expect(
			isSourceEntry({
				type: "message",
				id: "bash-hidden",
				message: { role: "bashExecution", command: "secret", output: "hidden", excludeFromContext: true },
			}),
		).toBe(false);
		expect(
			isSourceEntry(
				observationsRecordedEntry("notebook-1", {
					observations: [observation("aaaaaaaaaaaa")],
					coversUpToId: "raw-1",
				}),
			),
		).toBe(false);
		expect(isSourceEntry(compactionEntry("cmp-1"))).toBe(false);
	});

	it("builds a branch id to index map", () => {
		const entries = [textCustomMessage("raw-1", "abcd"), textCustomMessage("raw-2", "efgh")];
		expect(entryIndexById(entries).get("raw-1")).toBe(0);
		expect(entryIndexById(entries).get("raw-2")).toBe(1);
	});

	it("counts raw tokens after a branch index and ignores notebook/compaction entries", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-1", { observations: [observation("aaaaaaaaaaaa")], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			compactionEntry("cmp-1", { firstKeptEntryId: "raw-2" }),
			branchSummary("sum-1", "cccccccccccc"),
		];

		expect(rawTokensAfterIndex(entries, 0)).toBe(5); // raw-2: 2 + sum-1: 3
		expect(rawTokensAfterIndex(entries, 1)).toBe(5);
		expect(rawTokensAfterIndex(entries, 2)).toBe(3);
	});

	it("uses independent coverage clocks for observations, reflections, and drops", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", {
				observations: [observation("aaaaaaaaaaaa")],
				coversUpToId: "raw-1",
			}),
			textCustomMessage("raw-2", "bbbbbbbb"),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", {
				reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				coversUpToId: "raw-2",
			}),
			textCustomMessage("raw-3", "cccccccccccc"),
			observationsDroppedEntry("notebook-drop-1", {
				observationIds: ["aaaaaaaaaaaa"],
				coversUpToId: "notebook-eeeeeeeeeeee",
			}),
			textCustomMessage("raw-4", "dddddddddddddddd"),
		];

		expect(rawTokensSinceObservationCoverage(entries)).toBe(9); // raw-2 + raw-3 + raw-4
		expect(rawTokensSinceReflectionCoverage(entries)).toBe(7); // raw-3 + raw-4
		expect(rawTokensSinceDropCoverage(entries)).toBe(7); // covers ledger entry notebook-eeeeeeeeeeee, raw after it
	});

	it("advances the reflection clock from later retirements", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", {
				reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				coversUpToId: "raw-1",
			}),
			textCustomMessage("raw-2", "bbbbbbbb"),
			reflectionsRetiredEntry("notebook-retire-1", {
				reflectionIds: ["eeeeeeeeeeee"],
				coversUpToId: "raw-2",
			}),
			textCustomMessage("raw-3", "cccccccccccc"),
		];

		expect(latestCoverageIndex(entries, NOTEBOOK_REFLECTIONS_RECORDED)).toBe(0);
		expect(latestCoverageIndex(entries, NOTEBOOK_REFLECTIONS_RETIRED)).toBe(2);
		expect(rawTokensSinceReflectionCoverage(entries)).toBe(3);
	});

	it("lets coversUpToId point to a notebook ledger entry", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			reflectionsRecordedEntry("notebook-eeeeeeeeeeee", {
				reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				coversUpToId: "raw-1",
			}),
			observationsDroppedEntry("notebook-drop-1", {
				observationIds: ["aaaaaaaaaaaa"],
				coversUpToId: "notebook-eeeeeeeeeeee",
			}),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];

		expect(latestCoverageIndex(entries, NOTEBOOK_OBSERVATIONS_DROPPED)).toBe(1);
		expect(rawTokensSinceDropCoverage(entries)).toBe(2);
	});

	it("chooses the max covered branch position, not merely latest ledger entry order", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("notebook-aaaaaaaaaaaa", {
				observations: [observation("aaaaaaaaaaaa")],
				coversUpToId: "raw-2",
			}),
			observationsRecordedEntry("notebook-bbbbbbbbbbbb", {
				observations: [observation("bbbbbbbbbbbb")],
				coversUpToId: "raw-1",
			}),
			textCustomMessage("raw-3", "cccccccccccc"),
		];

		expect(latestCoverageIndex(entries, NOTEBOOK_OBSERVATIONS_RECORDED)).toBe(1);
		expect(latestCoverageMarkerId(entries, NOTEBOOK_OBSERVATIONS_RECORDED)).toBe("raw-2");
		expect(rawTokensSinceObservationCoverage(entries)).toBe(3);
	});

	it("returns latest inner coverage marker and earlier marker by branch index", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			textCustomMessage("raw-2", "bbbbbbbb"),
			textCustomMessage("raw-3", "cccccccccccc"),
			observationsRecordedEntry("notebook-obs", { observations: [observation("aaaaaaaaaaaa")], coversUpToId: "raw-3" }),
			reflectionsRecordedEntry("notebook-ref", {
				reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				coversUpToId: "raw-2",
			}),
		];

		expect(latestCoverageMarkerId(entries, NOTEBOOK_OBSERVATIONS_RECORDED)).toBe("raw-3");
		expect(latestCoverageMarkerId(entries, NOTEBOOK_REFLECTIONS_RECORDED)).toBe("raw-2");
		expect(earlierCoverageMarkerId(entries, "raw-3", "raw-2")).toBe("raw-2");
		expect(earlierCoverageMarkerId(entries, "raw-1", undefined)).toBe("raw-1");
		expect(earlierCoverageMarkerId(entries, "missing", "raw-2")).toBe("raw-2");
		expect(earlierCoverageMarkerId(entries, "missing-a", "missing-b")).toBeUndefined();
	});
});
