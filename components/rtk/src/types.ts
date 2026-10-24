export interface RtkStatus {
	available: boolean;
	version?: string;
}

export interface RewriteOptions {
	signal?: AbortSignal;
}
