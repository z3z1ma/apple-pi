import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Config {
	notebookAfterTokens: number;
	notebookSourceMaxTokens?: number;
	passive: boolean;
}

export const DEFAULTS: Config = {
	notebookAfterTokens: 20_000,
	passive: false,
};

export const NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS = 60_000;
export const NOTEBOOK_SOURCE_MIN_TOKENS = 256;
export const NOTEBOOK_SOURCE_CONTEXT_RATIO = 0.2;

export function resolveNotebookSourceMaxTokens(config: Config, contextWindow: number | undefined): number {
	if (config.notebookSourceMaxTokens !== undefined && config.notebookSourceMaxTokens > 0) {
		return Math.max(NOTEBOOK_SOURCE_MIN_TOKENS, config.notebookSourceMaxTokens);
	}
	if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
		return Math.max(NOTEBOOK_SOURCE_MIN_TOKENS, Math.floor(contextWindow * NOTEBOOK_SOURCE_CONTEXT_RATIO));
	}
	return NOTEBOOK_SOURCE_FALLBACK_MAX_TOKENS;
}

const SETTINGS_KEY = "pair";
const PASSIVE_ENV = "PI_PAIR_NOTEBOOK_PASSIVE";

function positiveIntegerOrUndefined(value: unknown): number | undefined {
	return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeSettingsConfig(value: Record<string, unknown>): Partial<Config> {
	const normalized: Partial<Config> = {};
	const numberKeys = ["notebookAfterTokens", "notebookSourceMaxTokens"] as const;
	for (const key of numberKeys) {
		const candidate = positiveIntegerOrUndefined(value[key]);
		if (candidate !== undefined) normalized[key] = candidate;
	}
	if (typeof value.passive === "boolean") normalized.passive = value.passive;
	return normalized;
}

export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): Partial<Config> {
	const rawPassive = env[PASSIVE_ENV];
	if (rawPassive === undefined) return {};
	const passive = rawPassive.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(passive)) return { passive: true };
	if (["0", "false", "no", "off"].includes(passive)) return { passive: false };
	return {};
}

function readNamespacedConfig(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		const nested = raw[SETTINGS_KEY];
		return isRecord(nested) ? normalizeSettingsConfig(nested) : {};
	} catch {
		return {};
	}
}

export function loadConfig(
	cwd: string,
	projectTrustedOrEnv: boolean | NodeJS.ProcessEnv = false,
	env: NodeJS.ProcessEnv = process.env,
): Config {
	// Keep the former `(cwd, env)` call shape for consumers while defaulting it
	// to untrusted; hooks pass the explicit trust bit.
	const projectTrusted = typeof projectTrustedOrEnv === "boolean" ? projectTrustedOrEnv : false;
	if (typeof projectTrustedOrEnv !== "boolean") env = projectTrustedOrEnv;
	const globalConfig = readNamespacedConfig(join(getAgentDir(), "settings.json"));
	// Project settings are executable-project authority and must never affect an
	// untrusted workspace. Global/user settings and explicit environment remain safe.
	const projectConfig = projectTrusted ? readNamespacedConfig(join(cwd, ".pi", "settings.json")) : {};
	return {
		...DEFAULTS,
		...globalConfig,
		...projectConfig,
		...readEnvConfig(env),
	};
}
