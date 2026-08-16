export interface ProgramEnvelope {
	callBudget: number;
	concurrency: number;
	agentBudget: number;
	memoryMb: number;
	timeoutSeconds: number;
}
