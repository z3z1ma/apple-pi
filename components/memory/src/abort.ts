export const CONSOLIDATION_ABORT_REASON = {
	disposed: "observational-memory:disposed",
	userTurn: "observational-memory:user-turn",
	timeout: "observational-memory:timeout",
} as const;

export type ConsolidationAbortReason = (typeof CONSOLIDATION_ABORT_REASON)[keyof typeof CONSOLIDATION_ABORT_REASON];

export function errorFromAbortSignal(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	const error = new Error(typeof reason === "string" && reason.length > 0 ? reason : "aborted");
	error.name = "AbortError";
	return error;
}

export function consolidationAbortReason(error: unknown): ConsolidationAbortReason | undefined {
	const message = error instanceof Error ? error.message : String(error);
	if (message === CONSOLIDATION_ABORT_REASON.disposed) return CONSOLIDATION_ABORT_REASON.disposed;
	if (message === CONSOLIDATION_ABORT_REASON.userTurn) return CONSOLIDATION_ABORT_REASON.userTurn;
	if (message === CONSOLIDATION_ABORT_REASON.timeout) return CONSOLIDATION_ABORT_REASON.timeout;
	return undefined;
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/** Failures that must not surface as observer/reflector/dropper warnings. */
export function isQuietConsolidationAbort(error: unknown): boolean {
	const reason = consolidationAbortReason(error);
	if (reason === CONSOLIDATION_ABORT_REASON.disposed || reason === CONSOLIDATION_ABORT_REASON.userTurn) {
		return true;
	}
	return isAbortError(error) && reason !== CONSOLIDATION_ABORT_REASON.timeout;
}
