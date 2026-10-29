import { describe, expect, test, vi } from "vitest";
import { createReplyWatches } from "../web/reply-watches.js";

describe("shared reply watches", () => {
	test("preserves subscription failures", async () => {
		const failure = new Error("subscription unavailable");
		const watch = createReplyWatches({ watchReplies: vi.fn().mockRejectedValue(failure) });
		await expect(watch({}, "ada")).rejects.toBe(failure);
	});

	test.each([false, true])("cleanup preserves another visible reader (reverse=%s)", async (reverse) => {
		const watchReplies = vi.fn(async (_ids: string[]) => {});
		const watch = createReplyWatches({ watchReplies });
		const world = {};
		const chat = {};
		const previous = reverse ? chat : world;
		const current = reverse ? world : chat;
		const previousId = reverse ? "ben" : "ada";
		const currentId = reverse ? "ada" : "ben";
		await watch(previous, previousId);
		await watch(current, currentId);
		await watch(previous);
		expect(watchReplies).toHaveBeenLastCalledWith([currentId]);
		await watch(current);
		expect(watchReplies).toHaveBeenLastCalledWith([]);
	});

	test("removing one of two queued readers preserves their shared character", async () => {
		const watchReplies = vi.fn(async (_ids: string[]) => {});
		const watch = createReplyWatches({ watchReplies });
		const first = {};
		const second = {};
		await Promise.all([watch(first, "ada"), watch(second, "ada"), watch(first)]);
		expect(watchReplies).toHaveBeenLastCalledWith(["ada"]);
		await watch(second);
		expect(watchReplies).toHaveBeenLastCalledWith([]);
	});
});
