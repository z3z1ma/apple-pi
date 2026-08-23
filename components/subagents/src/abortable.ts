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

export type ResultWaitMode = { kind: "immediate" } | { kind: "indefinite" } | { kind: "yield"; seconds: number };

export type ActiveResultWaitMode = Exclude<ResultWaitMode, { kind: "immediate" }>;
export type AgentSettlementOutcome = "settled" | "yielded" | "interrupted";

/** Resolve omission separately from an explicit immediate check or finite yield interval. */
export function resolveResultWaitMode(yieldSeconds: unknown, transcriptSnapshot = false): ResultWaitMode {
	if (yieldSeconds === undefined) return transcriptSnapshot ? { kind: "immediate" } : { kind: "indefinite" };
	if (typeof yieldSeconds !== "number" || !Number.isFinite(yieldSeconds) || yieldSeconds < 0) {
		throw new Error("yield_seconds must be a finite number greater than or equal to 0.");
	}
	return yieldSeconds === 0 ? { kind: "immediate" } : { kind: "yield", seconds: yieldSeconds };
}

type WaitableAgent = {
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
	promise?: Promise<unknown>;
};

function isPending(record: WaitableAgent): boolean {
	return record.status === "queued" || record.status === "running";
}

// Node timers overflow above this implementation limit. Chaining chunks keeps
// the public finite yield interval uncapped without turning a very large interval into 1 ms.
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const QUEUED_POLL_INTERVAL_MS = 50;

function createYieldExpiry(seconds: number): { promise: Promise<"yielded">; cancel: () => void } {
	let remainingSeconds = seconds;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const promise = new Promise<"yielded">((resolve) => {
		const schedule = () => {
			const delayMs = Math.min(MAX_TIMER_DELAY_MS, remainingSeconds * 1_000);
			timer = setTimeout(() => {
				if (cancelled) return;
				remainingSeconds -= delayMs / 1_000;
				if (remainingSeconds <= 0) resolve("yielded");
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

/** Wait until settlement, an optional finite yield interval, or an external wake-up without cancelling the child. */
export async function waitForAgentSettlement(
	record: WaitableAgent,
	mode: ActiveResultWaitMode,
	signal?: AbortSignal,
	interrupt?: Promise<unknown>,
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

	const expiry = mode.kind === "yield" ? createYieldExpiry(mode.seconds) : undefined;
	const interrupted = interrupt?.then(() => "interrupted" as const);
	try {
		const candidates: Promise<"settled" | "closed" | "yielded" | "interrupted">[] = [settled];
		if (expiry) candidates.push(expiry.promise);
		if (interrupted) candidates.push(interrupted);
		const outcome = await abortable(Promise.race(candidates), signal);
		if (outcome === "interrupted" && isPending(record)) return "interrupted";
		return outcome === "yielded" && isPending(record) ? "yielded" : "settled";
	} finally {
		closed = true;
		expiry?.cancel();
	}
}
