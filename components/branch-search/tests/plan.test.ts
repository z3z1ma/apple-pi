import { describe, expect, it } from "vitest";
import type { SearchShape } from "../src/config.js";
import { constraintPool, drawConstraint, drawOrder } from "../src/draw.js";
import {
	compareNodeKeys,
	type ObservedNode,
	type ObservedTree,
	planStep,
	type Ranking,
	selectWinner,
} from "../src/plan.js";

const seed = new Uint8Array(32).fill(3);
const pool = constraintPool(["Add no new dependencies.", "Change as few files as possible."]);
const candidates = ["c1", "c2", "c3", "c4"].map((id) => ({ id, approach: `approach ${id}`, firstStep: `step ${id}` }));

function shape(perGeneration: number, maxTotal = 10): SearchShape {
	return {
		branches: { perGeneration, maxTotal },
		generations: { maxDepth: 2, rootsPerGeneration: 1, parentsPerGeneration: 1, childrenPerParent: 1 },
	};
}

function tree(nodes: ObservedNode[] = []): ObservedTree {
	return { enumerations: { root: { key: "root", candidates, preferred: "c1" } }, nodes, constraints: pool };
}

function node(
	key: string,
	status: "survived" | "dead",
	diffSize = 1,
	objectives: Record<string, number> = {},
): ObservedNode {
	return {
		key,
		parent: null,
		generation: 0,
		status,
		gatesPassed: status === "survived" ? 1 : 0,
		diffSize,
		objectives: { ...objectives, diff_size: diffSize },
	};
}

const FAIL_GATE = [{ onBase: "fail" as const }];
const PASS_GATE = [{ onBase: "pass" as const }];
const NO_OBJECTIVES: Ranking = { gates: FAIL_GATE, objectives: [], baseValues: {} };

describe("planStep", () => {
	it("runs the first perGeneration root positions with their keyed constraints in generation 0", () => {
		const step = planStep(tree(), shape(3), "random", seed);
		const order = drawOrder(seed, "root", 4, 3);
		expect(step).toEqual({
			kind: "run",
			batch: order.map((index, p) => ({
				key: `r${p}`,
				parent: null,
				candidate: candidates[index]?.id,
				constraint: drawConstraint(seed, `r${p}`, pool),
			})),
		});
	});

	it("runs every candidate when the enumeration has fewer than perGeneration", () => {
		const step = planStep(tree(), shape(9), "random", seed);
		expect(step.kind === "run" && step.batch.map((entry) => entry.key)).toEqual(["r0", "r1", "r2", "r3"]);
	});

	it("keeps generation 0 within maxTotal", () => {
		const step = planStep(tree(), shape(3, 2), "random", seed);
		expect(step.kind === "run" && step.batch).toHaveLength(2);
	});

	it("gives a root the same assignment under any perGeneration", () => {
		const small = planStep(tree(), shape(1), "random", seed);
		const large = planStep(tree(), shape(4), "random", seed);
		expect(small.kind === "run" && small.batch[0]).toEqual(large.kind === "run" && large.batch[0]);
	});

	it("stops with a survivor when a node of the latest generation survived", () => {
		expect(planStep(tree([node("r0", "dead"), node("r1", "survived")]), shape(2), "random", seed)).toEqual({
			kind: "stop",
			outcome: "survivor",
		});
	});

	it("stops with no survivor when every node of generation 0 died", () => {
		expect(planStep(tree([node("r0", "dead"), node("r1", "dead")]), shape(2), "random", seed)).toEqual({
			kind: "stop",
			outcome: "no survivor",
		});
	});
});

describe("selectWinner", () => {
	it("picks the survivor with the smallest diff_size, then node key, when the spec has no objectives", () => {
		const nodes = [
			node("r0", "dead", 1),
			node("r3", "survived", 5),
			node("r2", "survived", 4),
			node("r1", "survived", 4),
		];
		expect(selectWinner(nodes, NO_OBJECTIVES)?.key).toBe("r1");
	});

	it("never picks a dead node", () => {
		expect(selectWinner([node("r0", "dead", 0)], NO_OBJECTIVES)).toBeUndefined();
	});

	it("ranks by the first objective in its direction before diff_size", () => {
		const nodes = [node("r0", "survived", 1, { speed: 10 }), node("r1", "survived", 50, { speed: 3 })];
		const lower: Ranking = { gates: FAIL_GATE, objectives: [{ id: "speed", better: "lower" }], baseValues: {} };
		const higher: Ranking = { gates: FAIL_GATE, objectives: [{ id: "speed", better: "higher" }], baseValues: {} };
		expect(selectWinner(nodes, lower)?.key).toBe("r1");
		expect(selectWinner(nodes, higher)?.key).toBe("r0");
	});

	it("breaks a tie on one objective by the next objective in declared order, then diff_size, then node key", () => {
		const ranking: Ranking = {
			gates: FAIL_GATE,
			objectives: [
				{ id: "a", better: "higher" },
				{ id: "b", better: "lower" },
			],
			baseValues: {},
		};
		const nodes = [
			node("r10", "survived", 3, { a: 5, b: 1 }),
			node("r0", "survived", 1, { a: 4, b: 0 }),
			node("r3", "survived", 2, { a: 5, b: 2 }),
			node("r2", "survived", 3, { a: 5, b: 1 }),
			node("r1", "survived", 4, { a: 5, b: 1 }),
		];
		// a=5 ties among r10, r3, r2, r1; b=1 ties r10, r2, r1; diff_size 3 ties r10 and r2; r2 < r10.
		expect(selectWinner(nodes, ranking)?.key).toBe("r2");
	});

	it("without a gate that fails on base, keeps only survivors that strictly beat the first objective's base value", () => {
		const ranking: Ranking = {
			gates: PASS_GATE,
			objectives: [
				{ id: "ms", better: "lower" },
				{ id: "size", better: "lower" },
			],
			baseValues: { ms: 100, size: 10 },
		};
		const equal = node("r0", "survived", 0, { ms: 100, size: 0 });
		const worse = node("r1", "survived", 0, { ms: 120, size: 0 });
		const better = node("r2", "survived", 9, { ms: 99, size: 50 });
		expect(selectWinner([equal, worse, better], ranking)?.key).toBe("r2");
		expect(selectWinner([equal, worse], ranking)).toBeUndefined();

		const higher: Ranking = { ...ranking, objectives: [{ id: "ms", better: "higher" }] };
		expect(selectWinner([equal, worse, better], higher)?.key).toBe("r1");
	});

	it("does not apply the base rule when some gate fails on base", () => {
		const ranking: Ranking = {
			gates: [...PASS_GATE, ...FAIL_GATE],
			objectives: [{ id: "ms", better: "lower" }],
			baseValues: { ms: 1 },
		};
		expect(selectWinner([node("r0", "survived", 0, { ms: 5 })], ranking)?.key).toBe("r0");
	});

	it("orders node keys by their numbers", () => {
		expect(["r10", "r2", "r1.c3", "r1", "r1.c10"].sort(compareNodeKeys)).toEqual([
			"r1",
			"r1.c3",
			"r1.c10",
			"r2",
			"r10",
		]);
	});
});
