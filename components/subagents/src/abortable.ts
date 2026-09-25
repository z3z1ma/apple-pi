import { abortable } from "../../shared/src/abortable.js";

export type ResultWaitMode = { kind: "immediate" } | { kind: "indefinite" } | { kind: "yield"; seconds: number };

export type ActiveResultWaitMode = Exclude<ResultWaitMode, { kind: "immediate" }>;
export type AgentSettlementOutcome = "settled" | "yielded";

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

/** Wait until settlement or an optional finite yield interval without cancelling the child. */
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

	const expiry = mode.kind === "yield" ? createYieldExpiry(mode.seconds) : undefined;
	try {
		const candidates: Promise<"settled" | "closed" | "yielded">[] = [settled];
		if (expiry) candidates.push(expiry.promise);
		const outcome = await abortable(Promise.race(candidates), signal);
		return outcome === "yielded" && isPending(record) ? "yielded" : "settled";
	} finally {
		closed = true;
		expiry?.cancel();
	}
}
