import type { Usage } from "@earendil-works/pi-ai";

export interface WorkerResult {
	index: number;
	task: string;
	output: string;
	exitCode: number;
	stopReason?: string;
	error?: string;
	truncated: boolean;
	usage?: Usage;
	operations: ExecutionOperation[];
}

export type ExecutionOutcome = "succeeded" | "failed" | "aborted" | "timed_out";

export interface ExecutionOperation {
	sequence: number;
	ref: string;
	args: Record<string, unknown>;
	outcome: ExecutionOutcome;
	activity?: string;
	children?: ExecutionOperation[];
	result?: unknown;
	error?: string;
}

export interface ProgramExecution {
	value?: unknown;
	outcome: ExecutionOutcome;
	error?: string;
}

export type ProgramHostCall = (ref: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export interface ProgramEnvelope {
	callBudget: number;
	concurrency: number;
	agentBudget: number;
	memoryMb: number;
	timeoutSeconds: number;
}
