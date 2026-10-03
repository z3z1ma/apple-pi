export interface ProgramEnvelope {
	callBudget: number;
	concurrency: number;
	agentBudget: number;
	memoryMb: number;
	timeoutSeconds: number;
}

/** Hard caps for optional `pi_exec` `limits`. Defaults stay derived from program shape. */
export const PROGRAM_ENVELOPE_MAXIMA: ProgramEnvelope = {
	callBudget: 2048,
	concurrency: 32,
	agentBudget: 128,
	memoryMb: 512,
	timeoutSeconds: 7200,
};

export type ProgramEnvelopeLimits = Partial<
	Pick<ProgramEnvelope, "callBudget" | "concurrency" | "agentBudget" | "timeoutSeconds">
>;

const DEFAULT_CALL_BUDGET = 128;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_AGENT_BUDGET = 8;

function clampLimit(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Default envelope from program shape. Optional limits scale capacity up to package maxima. */
export function deriveProgramEnvelope(code: string, limits: ProgramEnvelopeLimits = {}): ProgramEnvelope {
	const hasWorkers = /\bagent(?:_run)?\s*\(/.test(code);
	const hasFanout = /\basyncio\.gather\s*\(/.test(code);
	const callBudget = Math.min(DEFAULT_CALL_BUDGET, Math.max(64, 64 + Math.ceil(Buffer.byteLength(code) / 2_048) * 8));
	const derived: ProgramEnvelope = {
		callBudget,
		concurrency: hasFanout ? DEFAULT_CONCURRENCY : Math.min(8, DEFAULT_CONCURRENCY),
		agentBudget: DEFAULT_AGENT_BUDGET,
		memoryMb: PROGRAM_ENVELOPE_MAXIMA.memoryMb,
		timeoutSeconds: hasWorkers ? 600 : 300,
	};
	return {
		callBudget: clampLimit(limits.callBudget, derived.callBudget, 1, PROGRAM_ENVELOPE_MAXIMA.callBudget),
		concurrency: clampLimit(limits.concurrency, derived.concurrency, 1, PROGRAM_ENVELOPE_MAXIMA.concurrency),
		agentBudget: clampLimit(limits.agentBudget, derived.agentBudget, 1, PROGRAM_ENVELOPE_MAXIMA.agentBudget),
		memoryMb: derived.memoryMb,
		timeoutSeconds: clampLimit(
			limits.timeoutSeconds,
			derived.timeoutSeconds,
			1,
			PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
		),
	};
}
