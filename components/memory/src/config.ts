import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type CompactAfterTokensMode = "calibrated" | "ratio";

export interface Config {
	memoryAfterTokens: number;
	memorySourceMaxTokens?: number;
	compactAfterTokens: number;
	compactAfterTokensMode: CompactAfterTokensMode;
	compactAfterTokensRatio: number;
	observationsPoolMaxTokens: number;
	observationsPoolTargetTokens: number;
	passive: boolean;
}

export const DEFAULTS: Config = {
	memoryAfterTokens: 20_000,
	compactAfterTokens: 81_000,
	compactAfterTokensMode: "calibrated",
	compactAfterTokensRatio: 0.68,
	observationsPoolMaxTokens: 20_000,
	observationsPoolTargetTokens: 10_000,
	passive: false,
};

export const COMPACT_AFTER_TOKENS_MODE_VALUES: readonly CompactAfterTokensMode[] = ["calibrated", "ratio"] as const;

export function resolveCompactAfterTokens(config: Config, contextWindow: number | undefined): number {
	if (config.compactAfterTokensMode === "ratio" && typeof contextWindow === "number" && contextWindow > 0) {
		return Math.max(1, Math.floor(contextWindow * config.compactAfterTokensRatio));
	}
	return config.compactAfterTokens;
}

export const MEMORY_SOURCE_FALLBACK_MAX_TOKENS = 60_000;
export const MEMORY_SOURCE_MIN_TOKENS = 256;
export const MEMORY_SOURCE_CONTEXT_RATIO = 0.2;

export function resolveMemorySourceMaxTokens(config: Config, contextWindow: number | undefined): number {
	if (config.memorySourceMaxTokens !== undefined && config.memorySourceMaxTokens > 0) {
		return Math.max(MEMORY_SOURCE_MIN_TOKENS, config.memorySourceMaxTokens);
	}
	if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
		return Math.max(MEMORY_SOURCE_MIN_TOKENS, Math.floor(contextWindow * MEMORY_SOURCE_CONTEXT_RATIO));
	}
	return MEMORY_SOURCE_FALLBACK_MAX_TOKENS;
}

const SETTINGS_KEY = "pair";
const PASSIVE_ENV = "PI_PAIR_MEMORY_PASSIVE";

function positiveIntegerOrUndefined(value: unknown): number | undefined {
	return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined;
}

function validTargetOrUndefined(value: unknown, maxTokens: number): number | undefined {
	const target = positiveIntegerOrUndefined(value);
	return target !== undefined && target < maxTokens ? target : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isCompactAfterTokensMode(value: unknown): value is CompactAfterTokensMode {
	return typeof value === "string" && (COMPACT_AFTER_TOKENS_MODE_VALUES as readonly string[]).includes(value);
}

function validRatioOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : undefined;
}

function normalizeSettingsConfig(value: Record<string, unknown>): Partial<Config> {
	const normalized: Partial<Config> = {};
	const numberKeys = [
		"memoryAfterTokens",
		"memorySourceMaxTokens",
		"compactAfterTokens",
		"observationsPoolMaxTokens",
		"observationsPoolTargetTokens",
	] as const;
	for (const key of numberKeys) {
		const candidate = positiveIntegerOrUndefined(value[key]);
		if (candidate !== undefined) normalized[key] = candidate;
	}
	if (isCompactAfterTokensMode(value.compactAfterTokensMode)) {
		normalized.compactAfterTokensMode = value.compactAfterTokensMode;
	}
	const ratio = validRatioOrUndefined(value.compactAfterTokensRatio);
	if (ratio !== undefined) normalized.compactAfterTokensRatio = ratio;
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

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): Config {
	const globalConfig = readNamespacedConfig(join(getAgentDir(), "settings.json"));
	const projectConfig = readNamespacedConfig(join(cwd, ".pi", "settings.json"));
	const merged = {
		...DEFAULTS,
		observationsPoolTargetTokens: undefined,
		...globalConfig,
		...projectConfig,
		...readEnvConfig(env),
	};
	const target =
		validTargetOrUndefined(merged.observationsPoolTargetTokens, merged.observationsPoolMaxTokens) ??
		Math.floor(merged.observationsPoolMaxTokens / 2);
	return { ...merged, observationsPoolTargetTokens: target };
}
