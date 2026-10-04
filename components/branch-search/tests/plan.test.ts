import { describe, expect, it } from "vitest";
import type { SearchShape } from "../src/config.js";
import { constraintPool, drawConstraint, drawOrder } from "../src/draw.js";
import {
	compareNodeKeys,
	type ObservedNode,
	type ObservedTree,
	planStep,
	type Ranking,
	type Step,
	selectWinner,
} from "../src/plan.js";

const seed = new Uint8Array(32).fill(3);
const pool = constraintPool(["Add no new dependencies.", "Change as few files as possible."]);
const candidates = ["c1", "c2", "c3", "c4"].map((id) => ({ id, approach: `approach ${id}`, firstStep: `step ${id}` }));

function shape(
	perGeneration: number,
	maxTotal = 10,
	generations: Partial<SearchShape["generations"]> = {},
): SearchShape {
	return {
		branches: { perGeneration, maxTotal },
		generations: { maxDepth: 2, rootsPerGeneration: 1, parentsPerGeneration: 1, childrenPerParent: 1, ...generations },
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

	it("stops with no survivor when every node of generation 0 died and maxDepth is 0", () => {
		const dead = tree([node("r0", "dead"), node("r1", "dead")]);
		expect(planStep(dead, shape(2, 10, { maxDepth: 0 }), "random", seed)).toEqual({
			kind: "stop",
			outcome: "no survivor",
		});
	});
});

/** A scored node in any generation, with its own gate count. */
function scored(
	key: string,
	generation: number,
	gatesPassed: number,
	diffSize = 1,
	status: "survived" | "dead" = "dead",
): ObservedNode {
	const parent = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : null;
	return { key, parent, generation, status, gatesPassed, diffSize, objectives: { diff_size: diffSize } };
}

const childCandidates = ["k1", "k2", "k3"].map((id) => ({ id, approach: `approach ${id}`, firstStep: `step ${id}` }));

function withEnumerations(nodes: ObservedNode[], parents: string[]): ObservedTree {
	const base = tree(nodes);
	for (const key of parents) base.enumerations[key] = { key, candidates: childCandidates, preferred: "k3" };
	return base;
}

function batchOf(step: Step) {
	if (step.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(step)}`);
	return step.batch;
}

describe("planStep in later generations", () => {
	const generation0 = [scored("r0", 0, 1, 9), scored("r1", 0, 2, 5), scored("r2", 0, 2, 3), scored("r3", 0, 0)];

	it("stops with a survivor before it checks the depth", () => {
		const nodes = [...generation0, scored("r2.c0", 1, 3, 1, "survived")];
		expect(planStep(withEnumerations(nodes, ["r2"]), shape(4, 10, { maxDepth: 1 }), "random", seed)).toEqual({
			kind: "stop",
			outcome: "survivor",
		});
	});

	it("stops with no survivor once maxDepth generations after generation 0 have run", () => {
		const nodes = [...generation0, scored("r2.c0", 1, 1)];
		expect(planStep(withEnumerations(nodes, ["r2"]), shape(4, 10, { maxDepth: 1 }), "random", seed)).toEqual({
			kind: "stop",
			outcome: "no survivor",
		});
		expect(planStep(tree(generation0), shape(4, 10, { maxDepth: 1 }), "random", seed).kind).toBe("enumerate");
	});

	it("enumerates every top-ranked parent that has no enumeration: more gates, then smaller diff_size, then key", () => {
		const ties = [scored("r1", 0, 2, 3), scored("r0", 0, 2, 3), scored("r2", 0, 2, 1), scored("r3", 0, 0)];
		expect(planStep(tree(ties), shape(4, 10, { parentsPerGeneration: 3 }), "random", seed)).toEqual({
			kind: "enumerate",
			parents: ["r2", "r0", "r1"],
		});
		// Only the parents still missing an enumeration.
		expect(planStep(withEnumerations(ties, ["r0"]), shape(4, 10, { parentsPerGeneration: 3 }), "random", seed)).toEqual(
			{ kind: "enumerate", parents: ["r2", "r1"] },
		);
	});

	it("runs the next unused root positions, then each parent's first children in rank order", () => {
		const nodes = [scored("r0", 0, 1), scored("r1", 0, 2)];
		const generations = { rootsPerGeneration: 2, parentsPerGeneration: 2, childrenPerParent: 2 };
		const batch = batchOf(planStep(withEnumerations(nodes, ["r0", "r1"]), shape(2, 10, generations), "random", seed));
		const rootOrder = drawOrder(seed, "root", 4, 4);
		const children = (parent: string) =>
			drawOrder(seed, parent, 3, 2).map((index, j) => ({
				key: `${parent}.c${j}`,
				parent,
				candidate: childCandidates[index]?.id,
				constraint: drawConstraint(seed, `${parent}.c${j}`, pool),
			}));
		expect(batch).toEqual([
			...[2, 3].map((p) => ({
				key: `r${p}`,
				parent: null,
				candidate: candidates[rootOrder[p] as number]?.id,
				constraint: drawConstraint(seed, `r${p}`, pool),
			})),
			...children("r1"),
			...children("r0"),
		]);
	});

	it("takes parents only from the latest generation and roots only from positions no node used", () => {
		const nodes = [
			scored("r0", 0, 3),
			scored("r1", 0, 1),
			scored("r0.c0", 1, 1),
			scored("r2", 1, 2),
			scored("r1.c0", 1, 0),
		];
		const batch = batchOf(planStep(withEnumerations(nodes, ["r0", "r2"]), shape(2), "random", seed));
		expect(batch.map(({ key, parent }) => ({ key, parent }))).toEqual([
			{ key: "r3", parent: null },
			{ key: "r2.c0", parent: "r2" },
		]);
	});

	it("starts no root once every root position is used", () => {
		const nodes = ["r0", "r1", "r2", "r3"].map((key) => scored(key, 0, 1));
		const batch = batchOf(
			planStep(withEnumerations(nodes, ["r0"]), shape(4, 10, { rootsPerGeneration: 3 }), "random", seed),
		);
		expect(batch.map((entry) => entry.key)).toEqual(["r0.c0"]);
	});

	it("trims the batch from the end to stay within maxTotal", () => {
		const nodes = [scored("r0", 0, 2), scored("r1", 0, 1)];
		const generations = { rootsPerGeneration: 1, parentsPerGeneration: 2, childrenPerParent: 2 };
		const batch = batchOf(planStep(withEnumerations(nodes, ["r0", "r1"]), shape(2, 5, generations), "random", seed));
		expect(batch.map((entry) => entry.key)).toEqual(["r2", "r0.c0", "r0.c1"]);
	});

	it("stops with no survivor when the batch is empty", () => {
		const nodes = [scored("r0", 0, 2), scored("r1", 0, 1)];
		expect(planStep(withEnumerations(nodes, ["r0"]), shape(2, 2), "random", seed)).toEqual({
			kind: "stop",
			outcome: "no survivor",
		});
	});

	it("gives a child the same assignment under any shape", () => {
		const nodes = [scored("r0", 0, 2), scored("r1", 0, 1)];
		const small = batchOf(
			planStep(withEnumerations(nodes, ["r0"]), shape(2, 10, { rootsPerGeneration: 0 }), "random", seed),
		);
		const large = batchOf(
			planStep(
				withEnumerations(nodes, ["r0"]),
				shape(2, 10, { rootsPerGeneration: 2, childrenPerParent: 3 }),
				"random",
				seed,
			),
		);
		expect(large.find((entry) => entry.key === "r0.c0")).toEqual(small[0]);
	});
});

describe('planStep with draw "model"', () => {
	it("orders each enumeration preferred first, then in returned order, and keeps keyed constraints", () => {
		const roots = { ...tree(), enumerations: { root: { key: "root", candidates, preferred: "c3" } } };
		expect(batchOf(planStep(roots, shape(3), "model", seed))).toEqual(
			["c3", "c1", "c2"].map((candidate, p) => ({
				key: `r${p}`,
				parent: null,
				candidate,
				constraint: drawConstraint(seed, `r${p}`, pool),
			})),
		);

		const nodes = [scored("r0", 0, 1), scored("r1", 0, 0), scored("r2", 0, 0)];
		const later = withEnumerations(nodes, ["r0"]);
		later.enumerations.root = roots.enumerations.root;
		const batch = batchOf(
			planStep(later, shape(3, 10, { rootsPerGeneration: 1, childrenPerParent: 3 }), "model", seed),
		);
		expect(batch.map(({ key, candidate }) => ({ key, candidate }))).toEqual([
			{ key: "r3", candidate: "c4" },
			{ key: "r0.c0", candidate: "k3" },
			{ key: "r0.c1", candidate: "k1" },
			{ key: "r0.c2", candidate: "k2" },
		]);
		expect(batch[1]?.constraint).toBe(drawConstraint(seed, "r0.c0", pool));
	});

	it("keeps the returned order when the preferred id names no candidate", () => {
		const roots = { ...tree(), enumerations: { root: { key: "root", candidates, preferred: "c9" } } };
		expect(batchOf(planStep(roots, shape(2), "model", seed)).map((entry) => entry.candidate)).toEqual(["c1", "c2"]);
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
