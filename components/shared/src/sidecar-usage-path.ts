import { join } from "node:path";

const DIRECTORY = "sidecar-usage";
const UNSCOPED = "unscoped.ndjson";

export function safeSidecarUsageSessionId(sessionId: string | undefined): string | undefined {
	const trimmed = sessionId?.trim();
	if (!trimmed) return undefined;
	const sanitized = trimmed
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 128);
	if (!/[A-Za-z0-9]/.test(sanitized)) return undefined;
	return sanitized;
}

export function sidecarUsageRelativePath(sessionId: string | undefined): string {
	const safeSessionId = safeSidecarUsageSessionId(sessionId);
	return join(DIRECTORY, safeSessionId ? `${safeSessionId}.ndjson` : UNSCOPED);
}
