import { describe, expect, it } from "vitest";
import { normalizeRecallMode, normalizeRecallScope } from "../src/recall-scope.js";

describe("normalizeRecallScope", () => {
	it("defaults to active lineage", () => {
		expect(normalizeRecallScope()).toBe("lineage");
		expect(normalizeRecallScope("lineage")).toBe("lineage");
		expect(normalizeRecallScope("unknown")).toBe("lineage");
		expect(normalizeRecallScope(123)).toBe("lineage");
	});

	it("accepts all scope", () => {
		expect(normalizeRecallScope("all")).toBe("all");
		expect(normalizeRecallScope("ALL")).toBe("all");
	});

	it("does not keep VCC compaction scopes", () => {
		expect(normalizeRecallScope("compaction:latest")).toBe("lineage");
		expect(normalizeRecallScope("compaction:0")).toBe("lineage");
	});
});

describe("normalizeRecallMode", () => {
	it("accepts file and touched, otherwise history", () => {
		expect(normalizeRecallMode("file")).toBe("file");
		expect(normalizeRecallMode("touched")).toBe("touched");
		expect(normalizeRecallMode("history")).toBe("history");
		expect(normalizeRecallMode()).toBe("history");
	});
});
