import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RtkStatus } from "./types.js";

const execFileAsync = promisify(execFile);
const MIN_SUPPORTED_RTK_MINOR = 23;
const DEFAULT_PROBE_TIMEOUT_MS = 1500;

let cachedStatus: RtkStatus | undefined;

export function parseSemver(raw: string): [number, number, number] | null {
	const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/);
	if (!m) return null;
	return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10)];
}

export function resetRtkCache(): void {
	cachedStatus = undefined;
}

export async function probeRtk(options?: { timeoutMs?: number }): Promise<RtkStatus> {
	if (cachedStatus !== undefined) {
		return cachedStatus;
	}

	if (process.env.RTK_DISABLED === "1") {
		cachedStatus = { available: false };
		return cachedStatus;
	}

	try {
		const { stdout } = await execFileAsync("rtk", ["--version"], {
			timeout: options?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
			windowsHide: true,
		});

		const rawVersion = stdout.replace(/^rtk\s+/, "").trim();
		const parsed = parseSemver(rawVersion);

		if (parsed) {
			const [major, minor] = parsed;
			if (major === 0 && minor < MIN_SUPPORTED_RTK_MINOR) {
				cachedStatus = { available: false, version: rawVersion };
				return cachedStatus;
			}
			cachedStatus = { available: true, version: rawVersion };
			return cachedStatus;
		}

		// Non-standard version output format; fallback to available if binary ran
		cachedStatus = { available: true, version: rawVersion || undefined };
		return cachedStatus;
	} catch {
		cachedStatus = { available: false };
		return cachedStatus;
	}
}

export async function isRtkAvailable(): Promise<boolean> {
	const status = await probeRtk();
	return status.available;
}
