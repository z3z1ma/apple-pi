import { describe, test, expect } from "bun:test";
import {
	countPiVccCompactions,
	countPiVccCompactionsFromSession,
	ordinalSuffix,
} from "../src/core/compaction-count.js";

const compaction = (id: string) => ({
	id,
	type: "compaction",
	details: { compactor: "pi-vcc" },
});

const otherCompaction = (id: string) => ({
	id,
	type: "compaction",
	details: { compactor: "pi-core" },
});

const message = (id: string) => ({ id, type: "message", message: { role: "user" } });

describe("countPiVccCompactions", () => {
	test("returns 0 for an empty session", () => {
		expect(countPiVccCompactions([])).toBe(0);
	});

	test("counts only pi-vcc compactions, ignoring messages and other compactors", () => {
		const entries = [message("m1"), compaction("c1"), otherCompaction("c2"), message("m2"), compaction("c3")];
		expect(countPiVccCompactions(entries)).toBe(2);
	});

	test("includes the just-completed compaction in the count", () => {
		const entries = [compaction("c1"), compaction("c2"), compaction("c3")];
		expect(countPiVccCompactions(entries)).toBe(3);
	});
});

describe("countPiVccCompactionsFromSession", () => {
	test("reads entries from sessionManager.getEntries()", () => {
		const sm = { getEntries: () => [compaction("c1"), compaction("c2")] };
		expect(countPiVccCompactionsFromSession(sm)).toBe(2);
	});

	test("returns 0 when sessionManager is undefined or throws", () => {
		expect(countPiVccCompactionsFromSession(undefined)).toBe(0);
		const throwing = {
			getEntries: () => {
				throw new Error("boom");
			},
		};
		expect(countPiVccCompactionsFromSession(throwing as any)).toBe(0);
	});
});

describe("ordinalSuffix", () => {
	test("correct suffixes for 1-13 and round hundreds", () => {
		expect(ordinalSuffix(1)).toBe("st");
		expect(ordinalSuffix(2)).toBe("nd");
		expect(ordinalSuffix(3)).toBe("rd");
		expect(ordinalSuffix(4)).toBe("th");
		expect(ordinalSuffix(11)).toBe("th");
		expect(ordinalSuffix(12)).toBe("th");
		expect(ordinalSuffix(13)).toBe("th");
		expect(ordinalSuffix(21)).toBe("st");
		expect(ordinalSuffix(22)).toBe("nd");
		expect(ordinalSuffix(23)).toBe("rd");
		expect(ordinalSuffix(100)).toBe("th");
		expect(ordinalSuffix(112)).toBe("th");
	});
});
