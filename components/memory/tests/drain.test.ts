import { describe, expect, it } from "vitest";

import { CONSOLIDATION_ABORT_REASON } from "../src/abort.js";
import { drainAgentStream } from "../src/agents/drain.js";

function hangingStream(): AsyncIterable<unknown> & { result: () => Promise<unknown> } {
	return {
		async *[Symbol.asyncIterator]() {
			await new Promise(() => {});
		},
		result: async () => ({}),
	};
}

function eventsStream(events: unknown[]): AsyncIterable<unknown> & { result: () => Promise<unknown> } {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
		result: async () => ({ done: true }),
	};
}

function failingStream(error: Error): AsyncIterable<unknown> & { result: () => Promise<unknown> } {
	return {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					throw error;
				},
			};
		},
		result: async () => ({}),
	};
}

function eventsStreamThenAbort(
	events: unknown[],
	controller: AbortController,
	reason: string,
): AsyncIterable<unknown> & { result: () => Promise<unknown> } {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event;
			}
			// Abort mid-stream after yielding all prepared events.
			controller.abort(reason);
			// One more yield that should not be delivered.
			yield "should-not-see";
		},
		result: async () => ({ done: true }),
	};
}

describe("drainAgentStream", () => {
	it("drains events and awaits result", async () => {
		const seen: unknown[] = [];
		await drainAgentStream(eventsStream(["a", "b"]), (event) => {
			seen.push(event);
		});
		expect(seen).toEqual(["a", "b"]);
	});

	it("throws immediately when the signal is already aborted", async () => {
		const signal = AbortSignal.abort(CONSOLIDATION_ABORT_REASON.timeout);
		await expect(drainAgentStream(hangingStream(), () => {}, signal)).rejects.toMatchObject({
			name: "AbortError",
			message: CONSOLIDATION_ABORT_REASON.timeout,
		});
	});

	it("unblocks a hanging iterator when the signal aborts", async () => {
		const controller = new AbortController();
		const drained = drainAgentStream(hangingStream(), () => {}, controller.signal);
		controller.abort(CONSOLIDATION_ABORT_REASON.userTurn);
		await expect(drained).rejects.toMatchObject({
			name: "AbortError",
			message: CONSOLIDATION_ABORT_REASON.userTurn,
		});
	});

	it("completes normally with a live non-aborted signal", async () => {
		const controller = new AbortController();
		const seen: unknown[] = [];
		await drainAgentStream(
			eventsStream(["x", "y", "z"]),
			(event) => {
				seen.push(event);
			},
			controller.signal,
		);
		expect(seen).toEqual(["x", "y", "z"]);
	});

	it("collects events delivered before a mid-stream abort then throws", async () => {
		const controller = new AbortController();
		const seen: unknown[] = [];
		const drained = drainAgentStream(
			eventsStreamThenAbort(["a", "b"], controller, CONSOLIDATION_ABORT_REASON.userTurn),
			(event) => {
				seen.push(event);
			},
			controller.signal,
		);
		await expect(drained).rejects.toMatchObject({
			name: "AbortError",
			message: CONSOLIDATION_ABORT_REASON.userTurn,
		});
		expect(seen).toEqual(["a", "b"]);
	});

	it("propagates independent stream errors through the race", async () => {
		const streamError = new Error("provider 500");
		const controller = new AbortController();
		await expect(drainAgentStream(failingStream(streamError), () => {}, controller.signal)).rejects.toThrow(
			"provider 500",
		);
	});

	it("throws when drain completes but signal was aborted during result()", async () => {
		const controller = new AbortController();
		const stream: AsyncIterable<unknown> & { result: () => Promise<unknown> } = {
			async *[Symbol.asyncIterator]() {
				yield "event";
			},
			result: async () => {
				// Signal aborts while result() is completing.
				controller.abort(CONSOLIDATION_ABORT_REASON.timeout);
				return {};
			},
		};
		await expect(drainAgentStream(stream, () => {}, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
			message: CONSOLIDATION_ABORT_REASON.timeout,
		});
	});
});
