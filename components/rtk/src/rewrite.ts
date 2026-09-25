import { execFile } from "node:child_process";
import { isRtkAvailable } from "./detector.js";
import type { RewriteOptions } from "./types.js";

const DEFAULT_REWRITE_TIMEOUT_MS = 2000;

function execRtkRewrite(
	command: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ code: number | null; stdout: string }> {
	return new Promise((resolve) => {
		execFile(
			"rtk",
			["rewrite", command],
			{
				timeout: timeoutMs,
				signal,
				windowsHide: true,
			},
			(err, stdout) => {
				if (!err) {
					resolve({ code: 0, stdout: stdout ?? "" });
					return;
				}
				const code = typeof (err as any).code === "number" ? (err as any).code : null;
				resolve({ code, stdout: stdout ?? "" });
			},
		);
	});
}

/**
 * Call `rtk rewrite <command>`.
 * Returns the rewritten command string, or null if unrewritten / RTK unavailable.
 */
export async function rewriteCommand(command: string, options?: RewriteOptions): Promise<string | null> {
	options?.signal?.throwIfAborted();
	if (!command || typeof command !== "string" || !command.trim()) {
		return null;
	}

	const trimmed = command.trim();
	if (trimmed.startsWith("rtk ")) {
		return null;
	}

	if (process.env.RTK_DISABLED === "1") {
		return null;
	}

	const available = await isRtkAvailable(options?.signal);
	options?.signal?.throwIfAborted();
	if (!available) {
		return null;
	}

	try {
		const timeoutMs = options?.timeoutMs ?? DEFAULT_REWRITE_TIMEOUT_MS;
		const result = await execRtkRewrite(command, timeoutMs, options?.signal);
		options?.signal?.throwIfAborted();

		if (result.code === 0 || result.code === 3) {
			const rewritten = result.stdout.trim();
			return rewritten && rewritten !== command ? rewritten : null;
		}

		return null;
	} catch {
		options?.signal?.throwIfAborted();
		// Fail-open: never block or throw on unexpected rewrite errors
		return null;
	}
}
