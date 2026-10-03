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
