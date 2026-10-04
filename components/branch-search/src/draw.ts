import { createHash } from "node:crypto";

/**
 * Keyed seeded draws (spec 6.5). Every number derives from the seed and a label that
 * names what is drawn, so a draw never depends on how many other draws came before it.
 */

const RANGE = 2n ** 64n;

/** First 8 bytes, big-endian, of sha256(seed || utf8(label) || uint32be(i)). */
export function u64(seed: Uint8Array, label: string, i: number): bigint {
	const index = Buffer.alloc(4);
	index.writeUInt32BE(i);
	const digest = createHash("sha256").update(seed).update(label, "utf8").update(index).digest();
	return digest.readBigUInt64BE(0);
}

/** An integer in [0, n) from the raw values next(0), next(1), …, rejecting the biased tail. */
export function sampleBelow(next: (i: number) => bigint, n: number): number {
	if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Cannot draw below ${n}.`);
	const bound = BigInt(n);
	const limit = RANGE - (RANGE % bound);
	for (let i = 0; ; i++) {
		const value = next(i);
		if (value < limit) return Number(value % bound);
	}
}

export function drawInt(seed: Uint8Array, label: string, n: number): number {
	return sampleBelow((i) => u64(seed, label, i), n);
}

/**
 * The first `count` positions of an enumeration's draw order, as indexes into its
 * candidate array. A forward Fisher-Yates shuffle fixes position p with label
 * `order/<key>/<p>`, so position p is the same however many positions are drawn.
 */
export function drawOrder(seed: Uint8Array, key: string, candidates: number, count: number): number[] {
	const order = Array.from({ length: candidates }, (_, i) => i);
	const positions = Math.min(count, candidates);
	for (let p = 0; p < positions; p++) {
		const j = p + drawInt(seed, `order/${key}/${p}`, candidates - p);
		[order[p], order[j]] = [order[j] as number, order[p] as number];
	}
	return order.slice(0, positions);
}

/** The configured constraints with the entry `none` always present. */
export function constraintPool(constraints: readonly string[]): string[] {
	return constraints.includes("none") ? [...constraints] : ["none", ...constraints];
}

export function drawConstraint(seed: Uint8Array, nodeKey: string, pool: readonly string[]): string {
	return pool[drawInt(seed, `constraint/${nodeKey}`, pool.length)] as string;
}
