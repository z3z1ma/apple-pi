import { describe, expect, it } from "vitest";
import { DEFAULT_STASH_CAPACITY, PromptStash } from "../src/stash.js";

describe("PromptStash", () => {
	it("uses default capacity of 20 when unconfigured", () => {
		const stash = new PromptStash();
		expect(stash.getCapacity()).toBe(DEFAULT_STASH_CAPACITY);
		expect(stash.getCapacity()).toBe(20);
		expect(stash.isEmpty()).toBe(true);
		expect(stash.size()).toBe(0);
	});

	it("enforces minimum capacity of 1", () => {
		const stash = new PromptStash(0);
		expect(stash.getCapacity()).toBe(1);

		const negativeStash = new PromptStash(-5);
		expect(negativeStash.getCapacity()).toBe(1);
	});

	it("rejects empty or whitespace-only prompts", () => {
		const stash = new PromptStash(5);
		expect(stash.push("")).toBe(false);
		expect(stash.push("   \t\n  ")).toBe(false);
		expect(stash.isEmpty()).toBe(true);
		expect(stash.size()).toBe(0);
	});

	it("pushes valid prompts and tracks size and timestamp", () => {
		const stash = new PromptStash(5);
		const before = Date.now();
		const result = stash.push("First prompt");
		const after = Date.now();

		expect(result).toEqual({ evicted: undefined, size: 1 });
		expect(stash.size()).toBe(1);
		expect(stash.isEmpty()).toBe(false);
		expect(stash.peek()).toBe("First prompt");

		const item = stash.get(0);
		expect(item?.text).toBe("First prompt");
		expect(item?.createdAt).toBeGreaterThanOrEqual(before);
		expect(item?.createdAt).toBeLessThanOrEqual(after);
	});

	it("evicts oldest prompt FIFO when capacity is reached", () => {
		const stash = new PromptStash(3);
		expect(stash.push("one")).toEqual({ evicted: undefined, size: 1 });
		expect(stash.push("two")).toEqual({ evicted: undefined, size: 2 });
		expect(stash.push("three")).toEqual({ evicted: undefined, size: 3 });

		// 4th prompt should evict "one"
		const result4 = stash.push("four");
		expect(result4).toEqual({ evicted: "one", size: 3 });
		expect(stash.size()).toBe(3);

		// Remaining items in FIFO order should be "two", "three", "four"
		expect(stash.list().map((i) => i.text)).toEqual(["two", "three", "four"]);

		// 5th prompt should evict "two"
		const result5 = stash.push("five");
		expect(result5).toEqual({ evicted: "two", size: 3 });
		expect(stash.list().map((i) => i.text)).toEqual(["three", "four", "five"]);
	});

	it("pops the most recent prompt", () => {
		const stash = new PromptStash(5);
		stash.push("first");
		stash.push("second");

		expect(stash.pop()).toBe("second");
		expect(stash.size()).toBe(1);
		expect(stash.pop()).toBe("first");
		expect(stash.size()).toBe(0);
		expect(stash.pop()).toBeUndefined();
	});

	it("peeks without removing the top prompt", () => {
		const stash = new PromptStash(5);
		expect(stash.peek()).toBeUndefined();

		stash.push("hello");
		expect(stash.peek()).toBe("hello");
		expect(stash.size()).toBe(1);
	});

	it("drops the top prompt when index is omitted", () => {
		const stash = new PromptStash(5);
		stash.push("a");
		stash.push("b");

		expect(stash.drop()).toBe("b");
		expect(stash.size()).toBe(1);
		expect(stash.peek()).toBe("a");
	});

	it("drops prompt at specific index", () => {
		const stash = new PromptStash(5);
		stash.push("alpha");
		stash.push("beta");
		stash.push("gamma");

		// Drop middle item at index 1 ("beta")
		expect(stash.drop(1)).toBe("beta");
		expect(stash.size()).toBe(2);
		expect(stash.list().map((i) => i.text)).toEqual(["alpha", "gamma"]);

		// Drop invalid indices
		expect(stash.drop(-1)).toBeUndefined();
		expect(stash.drop(10)).toBeUndefined();
		expect(stash.size()).toBe(2);
	});

	it("handles drop on empty stash", () => {
		const stash = new PromptStash(5);
		expect(stash.drop()).toBeUndefined();
		expect(stash.drop(0)).toBeUndefined();
	});

	it("clears all items", () => {
		const stash = new PromptStash(5);
		stash.push("x");
		stash.push("y");
		expect(stash.size()).toBe(2);

		stash.clear();
		expect(stash.isEmpty()).toBe(true);
		expect(stash.size()).toBe(0);
		expect(stash.list()).toEqual([]);
	});

	it("returns a detached copy from list()", () => {
		const stash = new PromptStash(5);
		stash.push("keep");

		const list = stash.list();
		expect(list).toHaveLength(1);

		// Mutating the returned array should not affect internal storage
		(list as unknown as unknown[]).pop();
		expect(stash.size()).toBe(1);
	});
});
