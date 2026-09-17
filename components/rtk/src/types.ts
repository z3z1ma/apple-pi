export interface RtkStatus {
	available: boolean;
	version?: string;
	executablePath?: string;
}

export interface RewriteOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}
