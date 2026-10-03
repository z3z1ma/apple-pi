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
	sessionUsable: boolean;
}

export type ProgramHostCall = (ref: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
