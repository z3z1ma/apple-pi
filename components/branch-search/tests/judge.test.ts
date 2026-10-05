import { describe, expect, it } from "vitest";
import { lastNumber, median, rank, type Scores } from "../src/judge.js";
import { parseCandidates, parseChoice } from "../src/prompts.js";

describe("judge numbers", () => {
	it("reads the whole last non-empty stdout line as one finite number", () => {
		expect(lastNumber("warming up\n12.5\n\n")).toBe(12.5);
		expect(lastNumber("12 ms")).toBeUndefined();
		expect(lastNumber("Infinity")).toBeUndefined();
		expect(lastNumber("")).toBeUndefined();
	});

	it("takes the middle run, or the mean of the two middle runs", () => {
		expect(median([9, 1, 8])).toBe(8);
		expect(median([4, 1, 3, 9])).toBe(3.5);
		expect(median([7])).toBe(7);
	});

	it("ranks qualifying attempts by judges in order and direction, then diff size, then key", () => {
		const scores = (pass: boolean, ...values: (number | null)[]): Scores => ({
			gates: [{ command: "g", pass }],
			judges: values.map((value) => ({ command: "j", value, runs: [] })),
			failure: values.includes(null) ? "judge failed" : null,
		});
		const attempts = [
			{ key: "a10", diffSize: 3, scores: scores(true, 2, 5) },
			{ key: "a2", diffSize: 3, scores: scores(true, 2, 5) },
			{ key: "a3", diffSize: 1, scores: scores(true, 2, 4) },
			{ key: "a4", diffSize: 9, scores: scores(true, 3, 0) },
			{ key: "a5", diffSize: 1, scores: scores(false, 9, 9) },
			{ key: "a6", diffSize: 1, scores: scores(true, 9, null) },
			{ key: "a7", diffSize: null, scores: null },
		];
		const judges = [
			{ command: "j", better: "higher" as const },
			{ command: "j", better: "lower" as const },
		];
		expect(rank(attempts, judges).map(({ key }) => key)).toEqual(["a4", "a3", "a2", "a10"]);
	});
});

describe("replies", () => {
	it("takes candidates from a fenced or plain JSON reply and names an unusable one", () => {
		const list = '{"candidates":[{"id":"c1","approach":"a","firstStep":"f"}]}';
		expect(parseCandidates(`\`\`\`json\n${list}\n\`\`\``)).toEqual([{ id: "c1", approach: "a", firstStep: "f" }]);
		expect(parseCandidates("try c1")).toBe("it is not valid JSON");
		expect(parseCandidates('{"candidates":[]}')).toBe("it lists no candidate");
	});

	it("accepts only a qualifying attempt as the judge model's choice", () => {
		expect(parseChoice('{"winner":"a2","reason":"clear"}', ["a1", "a2"])).toEqual({ winner: "a2", reason: "clear" });
		expect(parseChoice('{"winner":"a3"}', ["a1", "a2"])).toBe("its winner is not one of a1, a2");
	});
});
