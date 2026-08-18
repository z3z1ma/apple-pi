import { errorFromAbortSignal } from "../abort.js";

export type AgentEventStream<TEvent> = AsyncIterable<TEvent> & {
	result: () => Promise<unknown>;
};

/**
 * Drain an agent-core event stream, and refuse to wait forever if `signal` aborts.
 *
 * `agentLoop` ends the stream only in a `.then()`; a rejected loop never calls
 * `stream.end()`, so a bare `for await` can hang. Racing the abort signal lets
 * the consolidation lock release even when the iterator never settles.
 */
export async function drainAgentStream<TEvent>(
	stream: AgentEventStream<TEvent>,
	onEvent: (event: TEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) throw errorFromAbortSignal(signal);

	const drain = (async () => {
		for await (const event of stream) {
			if (signal?.aborted) throw errorFromAbortSignal(signal);
			onEvent(event);
		}
		await stream.result();
		if (signal?.aborted) throw errorFromAbortSignal(signal);
	})();

	if (!signal) {
		await drain;
		return;
	}

	let removeAbortListener: (() => void) | undefined;
	const abort = new Promise<never>((_, reject) => {
		const onAbort = () => reject(errorFromAbortSignal(signal));
		signal.addEventListener("abort", onAbort, { once: true });
		removeAbortListener = () => signal.removeEventListener("abort", onAbort);
	});

	void drain.catch(() => {
		// Abort won the race; ignore a later drain rejection so it is not unhandled.
	});
	try {
		await Promise.race([drain, abort]);
	} finally {
		removeAbortListener?.();
	}
}
