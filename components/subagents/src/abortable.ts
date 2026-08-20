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

export type ResultWaitMode = { kind: "immediate" } | { kind: "indefinite" } | { kind: "timed"; seconds: number };

export type ActiveResultWaitMode = Exclude<ResultWaitMode, { kind: "immediate" }>;
export type AgentSettlementOutcome = "settled" | "timed-out";

/** Resolve omission separately from an explicit immediate or finite timed wait. */
export function resolveResultWaitMode(seconds: unknown, transcriptSnapshot = false): ResultWaitMode {
	if (seconds === undefined) return transcriptSnapshot ? { kind: "immediate" } : { kind: "indefinite" };
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
		throw new Error("wait_seconds must be a finite number greater than or equal to 0.");
	}
	return seconds === 0 ? { kind: "immediate" } : { kind: "timed", seconds };
}

type WaitableAgent = {
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
	promise?: Promise<unknown>;
};

function isPending(record: WaitableAgent): boolean {
	return record.status === "queued" || record.status === "running";
}

// Node timers overflow above this implementation limit. Chaining chunks keeps
// the public finite wait uncapped without turning a very large wait into 1 ms.
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const QUEUED_POLL_INTERVAL_MS = 50;

function createTimedExpiry(seconds: number): { promise: Promise<"timed-out">; cancel: () => void } {
	let remainingSeconds = seconds;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const promise = new Promise<"timed-out">((resolve) => {
		const schedule = () => {
			const delayMs = Math.min(MAX_TIMER_DELAY_MS, remainingSeconds * 1_000);
			timer = setTimeout(() => {
				if (cancelled) return;
				remainingSeconds -= delayMs / 1_000;
				if (remainingSeconds <= 0) resolve("timed-out");
				else schedule();
			}, delayMs);
		};
		schedule();
	});
	return {
		promise,
		cancel: () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		},
	};
}

/** Wait until settlement or an optional finite deadline without cancelling the child. */
export async function waitForAgentSettlement(
	record: WaitableAgent,
	mode: ActiveResultWaitMode,
	signal?: AbortSignal,
): Promise<AgentSettlementOutcome> {
	if (!isPending(record)) return "settled";

	let closed = false;
	const settled = (async (): Promise<"settled" | "closed"> => {
		// Queued records have no run promise until they reach the pool. Poll status
		// so queued stops and startup failures also release indefinite waiters.
		while (isPending(record) && !record.promise) {
			await new Promise<void>((resolve) => setTimeout(resolve, QUEUED_POLL_INTERVAL_MS));
			if (closed) return "closed";
		}
		if (closed) return "closed";
		if (record.promise) await record.promise;
		return "settled";
	})();

	const expiry = mode.kind === "timed" ? createTimedExpiry(mode.seconds) : undefined;
	try {
		if (!expiry) {
			await abortable(settled, signal);
			return "settled";
		}
		const outcome = await abortable(Promise.race([settled, expiry.promise]), signal);
		return outcome === "timed-out" && isPending(record) ? "timed-out" : "settled";
	} finally {
		closed = true;
		expiry?.cancel();
	}
}
