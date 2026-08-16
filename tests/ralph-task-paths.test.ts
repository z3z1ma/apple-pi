import { describe, expect, it } from "vitest";
import { bundleForRecord, recordKindForPath, taskLocation, validTaskId } from "../components/ralph/src/task-paths.js";

describe("ledger task paths", () => {
	it("accepts valid calendar-minute task IDs and rejects aliases", () => {
		expect(validTaskId("202602290930-leap-day")).toBe(false);
		expect(validTaskId("202402290930-leap-day")).toBe(true);
		expect(validTaskId("202608152359-valid-task-2")).toBe(true);
		for (const invalid of ["202608152400-late", "202608151260-minute", "202608151200-Upper", "2026-08-15-task", "202608151200_"]) {
			expect(validTaskId(invalid)).toBe(false);
		}
		expect(taskLocation(".ledger/202608151200-valid-task/task.md")).toEqual({
			taskId: "202608151200-valid-task",
			bundlePath: ".ledger/202608151200-valid-task",
			taskPath: ".ledger/202608151200-valid-task/task.md",
		});
		expect(taskLocation("./.ledger/202608151200-valid-task/task.md")).toBeUndefined();
		expect(taskLocation(".ledger/202608151200-valid-task/other.md")).toBeUndefined();
	});

	it("classifies only supported records inside one task bundle", () => {
		const base = ".ledger/202608151200-valid-task";
		expect(bundleForRecord(`${base}/research/findings.md`)).toBe(base);
		expect(recordKindForPath(`${base}/task.md`)).toBe("task");
		expect(recordKindForPath(`${base}/specs/behavior.md`)).toBe("spec");
		expect(recordKindForPath(`${base}/plans/implementation.md`)).toBe("plan");
		expect(recordKindForPath(`${base}/decisions/choice.md`)).toBe("decision");
		expect(recordKindForPath(`${base}/research/findings.md`)).toBe("research");
		expect(recordKindForPath(`${base}/evidence/result.md`)).toBe("evidence");
		expect(recordKindForPath(`${base}/knowledge/vocabulary.md`)).toBe("knowledge");
		expect(recordKindForPath(`${base}/skills/replay-fixture/SKILL.md`)).toBe("skill");
		expect(recordKindForPath(`${base}/random/file.md`)).toBeUndefined();
		expect(recordKindForPath(`${base}/skills/Bad/SKILL.md`)).toBeUndefined();
	});
});
