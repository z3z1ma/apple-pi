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
 * The one pure function that decides every step of a search (spec 6.7). It reads only
 * its arguments, so replay can call it offline on a stored record.
 * Rules 1 and 2 are implemented; later generations (rules 3 to 6) arrive with ticket 07.
 */
export function planStep(tree: ObservedTree, shape: SearchShape, draw: "random" | "model", seed: Uint8Array): Step {
	if (draw !== "random") throw new Error(`Draw mode "${draw}" is not available yet.`);
	const root = tree.enumerations.root;
	if (!root) throw new Error("planStep needs the root enumeration.");

	if (tree.nodes.length === 0) {
		const count = Math.min(shape.branches.perGeneration, shape.branches.maxTotal);
		const order = drawOrder(seed, "root", root.candidates.length, count);
		return {
			kind: "run",
			batch: order.map((index, p) => {
				const key = `r${p}`;
				return {
					key,
					parent: null,
					candidate: (root.candidates[index] as Candidate).id,
					constraint: drawConstraint(seed, key, tree.constraints),
				};
			}),
		};
	}

	const latest = Math.max(...tree.nodes.map((node) => node.generation));
	if (tree.nodes.some((node) => node.generation === latest && node.status === "survived"))
		return { kind: "stop", outcome: "survivor" };
	return { kind: "stop", outcome: "no survivor" };
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

/** The survivor with the smallest diff_size, then node key (spec 7.4). Objectives arrive with ticket 03. */
export function selectWinner<T extends ObservedNode>(nodes: readonly T[]): T | undefined {
	return nodes
		.filter((node) => node.status === "survived")
		.sort((a, b) => a.diffSize - b.diffSize || compareNodeKeys(a.key, b.key))[0];
}
