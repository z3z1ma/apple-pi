import { describe, expect, it } from "vitest";
import type { SearchShape } from "../src/config.js";
import { constraintPool, drawConstraint, drawOrder } from "../src/draw.js";
import { compareNodeKeys, type ObservedNode, type ObservedTree, planStep, selectWinner } from "../src/plan.js";

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

function node(key: string, status: "survived" | "dead", diffSize = 1): ObservedNode {
	return { key, parent: null, generation: 0, status, gatesPassed: status === "survived" ? 1 : 0, diffSize };
}

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
	it("picks the survivor with the smallest diff_size, then node key", () => {
		const nodes = [
			node("r0", "dead", 1),
			node("r3", "survived", 5),
			node("r2", "survived", 4),
			node("r1", "survived", 4),
		];
		expect(selectWinner(nodes)?.key).toBe("r1");
	});

	it("never picks a dead node", () => {
		expect(selectWinner([node("r0", "dead", 0)])).toBeUndefined();
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
