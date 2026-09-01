import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SearchRootGuardConfig {
	protectedRoots: string[];
}

export const BASELINE_PROTECTED_ROOTS = ["/", "~"] as const;
const SETTINGS_KEY = "searchRootGuard";
const BRACED_HOME = "$" + "{HOME}";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validConfiguredRoot(value: string): boolean {
	const supportedPrefix =
		value === "~" ||
		value.startsWith("~/") ||
		value === "$HOME" ||
		value.startsWith("$HOME/") ||
		value === BRACED_HOME ||
		value.startsWith(`${BRACED_HOME}/`) ||
		isAbsolute(value);
	const withoutHome = value.replaceAll(BRACED_HOME, "").replace(/\$HOME(?![A-Za-z0-9_])/g, "");
	return supportedPrefix && !/[`$*?[{]/.test(withoutHome);
}

function readConfiguredRoots(path: string): string[] {
	if (!existsSync(path)) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Invalid search-root settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(parsed) || parsed[SETTINGS_KEY] === undefined) return [];
	const settings = parsed[SETTINGS_KEY];
	if (!isRecord(settings) || !Array.isArray(settings.protectedRoots)) {
		throw new Error(`Invalid search-root settings at ${path}: ${SETTINGS_KEY}.protectedRoots must be an array.`);
	}
	return settings.protectedRoots.map((value, index) => {
		if (typeof value !== "string" || value.trim() === "" || !validConfiguredRoot(value)) {
			throw new Error(
				`Invalid search-root settings at ${path}: ${SETTINGS_KEY}.protectedRoots[${index}] must be an absolute path or supported HOME path without shell expansion.`,
			);
		}
		return value;
	});
}

export function loadSearchRootGuardConfig(
	cwd: string,
	projectTrusted = false,
	agentDir = getAgentDir(),
): SearchRootGuardConfig {
	const globalRoots = readConfiguredRoots(join(agentDir, "settings.json"));
	const projectRoots = projectTrusted ? readConfiguredRoots(join(cwd, ".pi", "settings.json")) : [];
	return { protectedRoots: [...new Set([...BASELINE_PROTECTED_ROOTS, ...globalRoots, ...projectRoots])] };
}
