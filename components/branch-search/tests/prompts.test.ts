import { describe, expect, it } from "vitest";
import { childDirective, parseEnumeration, parseRepair, parseSelfReport, rootDirective } from "../src/prompts.js";

const candidates = [
	{ id: "c1", approach: "a", firstStep: "s" },
	{ id: "c2", approach: "b", firstStep: "t" },
];

describe("enumeration replies", () => {
	it("accepts a JSON list of at least two candidates, fenced or not", () => {
		const reply = JSON.stringify({ candidates, preferred: "c2" });
		expect(parseEnumeration("root", reply)).toEqual({ key: "root", candidates, preferred: "c2" });
		expect(parseEnumeration("root", `\`\`\`json\n${reply}\n\`\`\``)).toEqual({
			key: "root",
			candidates,
			preferred: "c2",
		});
	});

	it("names why a reply cannot be used", () => {
		expect(parseEnumeration("root", "c1 is best")).toBe("it is not valid JSON");
		expect(parseEnumeration("root", JSON.stringify({ candidates: candidates.slice(0, 1), preferred: "c1" }))).toBe(
			"it has fewer than two candidates",
		);
		expect(
			parseEnumeration("root", JSON.stringify({ candidates: [candidates[0], candidates[0]], preferred: "c1" })),
		).toBe("candidate id c1 repeats");
		expect(parseEnumeration("root", JSON.stringify({ candidates }))).toBe("it names no preferred candidate");
	});
});

describe("self-reports", () => {
	it("reads the result and learned lines, and gives unknown without them", () => {
		expect(parseSelfReport("Done.\nresult: abandoned\nlearned: the cache hides the bug")).toEqual({
			selfReport: "abandoned",
			learned: "the cache hides the bug",
		});
		expect(parseSelfReport("All finished.")).toEqual({ selfReport: "unknown", learned: null });
	});
});

describe("root directive", () => {
	it("names the approach and adds a constraint line only when one is drawn", () => {
		const plain = rootDirective("r0", candidates[0] as (typeof candidates)[0], "none");
		expect(plain).toContain("Branch search: attempt r0.");
		expect(plain).toContain("Approach: a\nFirst action: s\n\n");
		expect(plain).not.toContain("Constraint:");
		expect(rootDirective("r1", candidates[0] as (typeof candidates)[0], "Add no new dependencies.")).toContain(
			"Constraint: Add no new dependencies.",
		);
	});
});

describe("child directive", () => {
	it("names the attempt and its parent, says only that hidden checks rejected the state, and states the goal", () => {
		const directive = childDirective("r1.c0", "r1", candidates[1] as (typeof candidates)[0], "none", "value is 2");
		expect(directive.startsWith("Branch search: attempt r1.c0, continuing from r1.\n\n")).toBe(true);
		expect(directive).toContain("Hidden acceptance checks rejected the current state of this attempt.");
		expect(directive).toContain("continuing from r1.\n\nGoal: value is 2\n\nHidden acceptance checks");
		expect(directive).toContain("in this direction:\n\nApproach: b\nFirst action: t\n\n");
		expect(directive).not.toContain("Constraint:");
		expect(directive).toMatch(/result: done \| abandoned\nlearned: <one sentence about what this attempt revealed>$/);
		expect(
			childDirective("r1.c0", "r1", candidates[0] as (typeof candidates)[0], "Change as few files as possible."),
		).toContain("First action: s\nConstraint: Change as few files as possible.\n\n");
	});
});

describe("repair replies", () => {
	it("takes dismissals with one-line reasons and an optional spec, and leaves a plain spec alone", () => {
		expect(parseRepair({ dismissed: { "challenger-1": "meets the goal" } })).toEqual({
			dismissed: { "challenger-1": "meets the goal" },
		});
		expect(parseRepair({ dismissed: {}, spec: { version: 1 } })).toEqual({ dismissed: {}, spec: { version: 1 } });
		expect(parseRepair({ version: 1, gates: [] })).toBeUndefined();
	});

	it("refuses a dismissal reason that is empty or spans several lines", () => {
		expect(parseRepair({ dismissed: { "challenger-1": "" } })).toMatch(/one-line reasons/);
		expect(parseRepair({ dismissed: { "challenger-1": "fine\nreally" } })).toMatch(/one-line reasons/);
	});
});
