import { describe, expect, it } from "vitest";
import { constraintPool, drawConstraint, drawInt, drawOrder, sampleBelow, u64 } from "../src/draw.js";

const seed = new Uint8Array(32).fill(7);
const otherSeed = new Uint8Array(32).fill(8);

describe("keyed draws", () => {
	it("derives each number from the seed, the label, and the index", () => {
		expect(u64(seed, "order/root/0", 0)).toBe(u64(seed, "order/root/0", 0));
		expect(u64(seed, "order/root/0", 0)).not.toBe(u64(seed, "order/root/0", 1));
		expect(u64(seed, "order/root/0", 0)).not.toBe(u64(seed, "order/root/1", 0));
		expect(u64(seed, "order/root/0", 0)).not.toBe(u64(otherSeed, "order/root/0", 0));
	});

	it("keeps integer draws in range", () => {
		for (const n of [1, 2, 3, 5, 7, 100]) {
			for (let i = 0; i < 50; i++) {
				const value = drawInt(seed, `range/${n}/${i}`, n);
				expect(Number.isInteger(value)).toBe(true);
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThan(n);
			}
		}
	});

	it("rejects values in the biased tail and draws again", () => {
		// For n = 3, 2^64 mod 3 = 1, so only the largest raw value 2^64 - 1 is rejected.
		const max = 2n ** 64n - 1n;
		const raw = [max, max, 5n];
		const asked: number[] = [];
		expect(
			sampleBelow((i) => {
				asked.push(i);
				return raw[i] as bigint;
			}, 3),
		).toBe(2);
		expect(asked).toEqual([0, 1, 2]);
		expect(sampleBelow(() => max - 1n, 3)).toBe(Number((max - 1n) % 3n));
	});

	it("gives a fixed order for a fixed seed and candidate count", () => {
		const order = drawOrder(seed, "root", 6, 6);
		expect(drawOrder(seed, "root", 6, 6)).toEqual(order);
		expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
		expect(new Set(drawOrder(otherSeed, "root", 6, 6)).size).toBe(6);
	});

	it("keeps position p the same however many positions are drawn", () => {
		const full = drawOrder(seed, "root", 8, 8);
		for (let count = 0; count <= 8; count++) expect(drawOrder(seed, "root", 8, count)).toEqual(full.slice(0, count));
	});

	it("orders each enumeration by its own key", () => {
		const orders = new Set(["root", "r0", "r1", "r0.c1"].map((key) => drawOrder(seed, key, 8, 8).join()));
		expect(orders.size).toBeGreaterThan(1);
	});

	it("draws a node's constraint from its key alone, from a pool that includes none", () => {
		const pool = constraintPool(["Add no new dependencies.", "Change as few files as possible."]);
		expect(pool).toContain("none");
		expect(constraintPool(["none", "x"])).toEqual(["none", "x"]);
		const constraint = drawConstraint(seed, "r2", pool);
		expect(pool).toContain(constraint);
		expect(drawConstraint(seed, "r2", pool)).toBe(constraint);
		// Other draws in between do not change it.
		drawOrder(seed, "root", 5, 5);
		drawConstraint(seed, "r0", pool);
		expect(drawConstraint(seed, "r2", pool)).toBe(constraint);
	});
});
