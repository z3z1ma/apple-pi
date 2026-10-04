import type { SearchShape } from "./config.js";
import { drawConstraint, drawOrder } from "./draw.js";

/** `r<i>` for root position i; `<parent>.c<j>` for child position j. Also the branch id. */
export type NodeKey = string;

export interface Candidate {
	id: string;
	approach: string;
	firstStep: string;
}

export interface Enumeration {
	/** `root`, or the node key of the dead branch it continues. */
	key: string;
	candidates: Candidate[];
	/** Recorded for evaluation only (spec I3). */
	preferred: string;
}

export interface ObservedNode {
	key: NodeKey;
	parent: NodeKey | null;
	generation: number;
	status: "survived" | "dead";
	gatesPassed: number;
	diffSize: number;
	/** Measured objective values by id, `diff_size` included; a dead branch may lack some. */
	objectives: Record<string, number>;
}

export interface ObservedTree {
	enumerations: Record<string, Enumeration>;
	nodes: ObservedNode[];
	/** The constraint pool, including `none`. */
	constraints: string[];
}

export interface BatchEntry {
	key: NodeKey;
	parent: NodeKey | null;
	candidate: string;
	constraint: string;
}

export type Step =
	| { kind: "stop"; outcome: "survivor" | "no survivor" }
	| { kind: "enumerate"; parents: NodeKey[] }
	| { kind: "run"; batch: BatchEntry[] };

/**
 * The first `count` positions of an enumeration's draw order, as candidates (spec 6.5). With
 * `draw: "model"` the preferred candidate comes first, then the others in returned order.
 */
function drawCandidates(
	enumeration: Enumeration,
	draw: "random" | "model",
	seed: Uint8Array,
	count: number,
): Candidate[] {
	const { candidates, preferred } = enumeration;
	if (draw === "random")
		return drawOrder(seed, enumeration.key, candidates.length, count).map((index) => candidates[index] as Candidate);
	const first = candidates.filter((candidate) => candidate.id === preferred);
	return [...first, ...candidates.filter((candidate) => candidate.id !== preferred)].slice(0, Math.max(0, count));
}

function entry(key: NodeKey, parent: NodeKey | null, candidate: Candidate, tree: ObservedTree, seed: Uint8Array) {
	return { key, parent, candidate: candidate.id, constraint: drawConstraint(seed, key, tree.constraints) };
}

/**
 * The one pure function that decides every step of a search (spec 6.7). It reads only
 * its arguments, so replay can call it offline on a stored record.
 */
export function planStep(tree: ObservedTree, shape: SearchShape, draw: "random" | "model", seed: Uint8Array): Step {
	const root = tree.enumerations.root;
	if (!root) throw new Error("planStep needs the root enumeration.");
	const { branches, generations } = shape;

	// Rule 1: generation 0.
	if (tree.nodes.length === 0) {
		const count = Math.min(branches.perGeneration, branches.maxTotal);
		const batch = drawCandidates(root, draw, seed, count).map((candidate, p) =>
			entry(`r${p}`, null, candidate, tree, seed),
		);
		return { kind: "run", batch };
	}

	// Rules 2 and 3: a survivor, or the depth limit.
	const latest = Math.max(...tree.nodes.map((node) => node.generation));
	const newest = tree.nodes.filter((node) => node.generation === latest);
	if (newest.some((node) => node.status === "survived")) return { kind: "stop", outcome: "survivor" };
	if (latest >= generations.maxDepth) return { kind: "stop", outcome: "no survivor" };

	// Rule 4: parents, enumerated before they can have children.
	const parents = newest
		.filter((node) => node.status === "dead")
		.sort((a, b) => b.gatesPassed - a.gatesPassed || a.diffSize - b.diffSize || compareNodeKeys(a.key, b.key))
		.slice(0, generations.parentsPerGeneration)
		.map((node) => node.key);
	const missing = parents.filter((key) => !tree.enumerations[key]);
	if (missing.length > 0) return { kind: "enumerate", parents: missing };

	// Rule 5: unused root positions, then children per parent in rank order, trimmed to maxTotal.
	const used = new Set(tree.nodes.map((node) => node.key));
	const roots = drawCandidates(root, draw, seed, root.candidates.length)
		.map((candidate, p) => ({ key: `r${p}`, candidate }))
		.filter(({ key }) => !used.has(key))
		.slice(0, generations.rootsPerGeneration)
		.map(({ key, candidate }) => entry(key, null, candidate, tree, seed));
	const children = parents.flatMap((parent) =>
		drawCandidates(tree.enumerations[parent] as Enumeration, draw, seed, generations.childrenPerParent).map(
			(candidate, j) => entry(`${parent}.c${j}`, parent, candidate, tree, seed),
		),
	);
	const batch = [...roots, ...children].slice(0, Math.max(0, branches.maxTotal - tree.nodes.length));

	// Rule 6.
	if (batch.length === 0) return { kind: "stop", outcome: "no survivor" };
	return { kind: "run", batch };
}

/** Node keys compare segment by segment, by number: r2 < r10, r1 < r1.c3 < r1.c10. */
export function compareNodeKeys(a: NodeKey, b: NodeKey): number {
	const numbers = (key: NodeKey) => key.split(".").map((part) => Number(part.slice(1)));
	const [left, right] = [numbers(a), numbers(b)];
	for (let i = 0; i < Math.min(left.length, right.length); i++) {
		const difference = (left[i] as number) - (right[i] as number);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

/** What selection reads from the frozen scorer spec and its validation (spec 6.8). */
export interface Ranking {
	gates: readonly { onBase: "fail" | "pass" }[];
	objectives: readonly { id: string; better: "lower" | "higher" }[];
	/** Median base value of each objective, from validation. */
	baseValues: Record<string, number>;
}

/** Positive when `a` is better than `b` in the objective's direction. */
function advantage(better: "lower" | "higher", a: number, b: number): number {
	return better === "lower" ? b - a : a - b;
}

/**
 * The winner among survivors (spec 6.8). Without a gate that fails on base, a survivor must strictly
 * beat the first objective's base value. Then objectives in declared order and direction, then
 * diff_size (smaller first), then node key.
 */
export function selectWinner<T extends ObservedNode>(nodes: readonly T[], ranking: Ranking): T | undefined {
	const [first] = ranking.objectives;
	const mustBeatBase = first !== undefined && !ranking.gates.some((gate) => gate.onBase === "fail");
	const value = (node: T, id: string) => node.objectives[id] as number;
	return nodes
		.filter((node) => node.status === "survived")
		.filter(
			(node) =>
				!mustBeatBase || advantage(first.better, value(node, first.id), ranking.baseValues[first.id] as number) > 0,
		)
		.sort((a, b) => {
			for (const { id, better } of ranking.objectives) {
				const difference = advantage(better, value(b, id), value(a, id));
				if (difference !== 0) return difference;
			}
			return a.diffSize - b.diffSize || compareNodeKeys(a.key, b.key);
		})[0];
}
