/**
 * abortable.ts — race a promise against an AbortSignal without cancelling the
 * underlying work.
 *
 * Used by the `get_subagent_result` wait paths (top-level and nested): pressing
 * Esc cancels only the caller's wait; the background child keeps running and its
 * result stays unconsumed. The listener is removed on every settle path so the
 * signal accumulates no handlers, and a late settlement of the wrapped promise
 * after an abort is absorbed as a no-op (no unhandled rejection).
 */

/** Await a promise until it settles or the caller cancels, without aborting the underlying work. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(signal.reason);

	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(signal.reason);
		};

		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			},
		);
	});
}

/** The longest a result check may wait without returning control to its caller. */
export const MAX_SUBAGENT_RESULT_WAIT_SECONDS = 300;
export const MAX_SUBAGENT_RESULT_WAIT_MS = MAX_SUBAGENT_RESULT_WAIT_SECONDS * 1_000;

/** Clamp model-facing wait input defensively at the tool boundary. */
export function normalizeWaitSeconds(seconds: number): number {
	if (!Number.isFinite(seconds)) return 0;
	return Math.min(MAX_SUBAGENT_RESULT_WAIT_SECONDS, Math.max(0, Math.floor(seconds)));
}

type WaitableAgent = {
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
	promise?: Promise<unknown>;
};

function isPending(record: WaitableAgent): boolean {
	return record.status === "queued" || record.status === "running";
}

/**
 * Wait for the requested bounded interval without ever cancelling the child.
 *
 * A bounded wait keeps the parent able to inspect, steer, or work in parallel
 * instead of wedging on one slow child. `true` means the record settled; `false`
 * means the requested wait elapsed and the child is still active. Caller abort
 * still rejects exactly as {@link abortable} does.
 */
export async function waitForAgentSettlement(
	record: WaitableAgent,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<boolean> {
	if (!isPending(record)) return true;

	const boundedTimeoutMs = Number.isFinite(timeoutMs)
		? Math.min(MAX_SUBAGENT_RESULT_WAIT_MS, Math.max(0, Math.floor(timeoutMs)))
		: 0;
	if (boundedTimeoutMs === 0) return false;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), boundedTimeoutMs);
	});
	const settled = (async (): Promise<"settled" | "cancelled"> => {
		// Queued records have no run promise until they reach the pool. The outer
		// race closes this poller on timeout, so it cannot keep a timer alive for a
		// child that remains queued indefinitely.
		while (record.status === "queued") {
			await abortable(new Promise<void>((resolve) => setTimeout(resolve, 50)), signal);
			if (closed) return "cancelled";
		}
		if (closed) return "cancelled";
		if (record.promise) await abortable(record.promise, signal);
		return "settled";
	})();

	try {
		await abortable(Promise.race([settled, timeout]), signal);
	} finally {
		closed = true;
		if (timer) clearTimeout(timer);
	}
	return !isPending(record);
}
