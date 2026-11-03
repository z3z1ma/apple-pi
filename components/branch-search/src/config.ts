import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { relativePathsProblem } from "../../shared/src/relative-paths.js";

export const CONFIG_FILE = "branch-search.json";

export interface BranchSearchConfig {
	attempts: number;
	limits: { wallClockSec?: number; outputTokens?: number };
	workspace: { cloneIgnored: string[] };
	judge?: { profile?: string };
}

export type ConfigResult = { ok: true; config: BranchSearchConfig } | { ok: false; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = merged[key];
		merged[key] = isRecord(current) && isRecord(value) ? merge(current, value) : value;
	}
	return merged;
}

function readFile(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Invalid branch search settings at ${path}: ${error instanceof Error ? error.message : error}`);
	}
	if (!isRecord(parsed)) throw new Error(`Invalid branch search settings at ${path}: expected a JSON object.`);
	return parsed;
}

export function readBranchSearchConfig(cwd: string, projectTrusted: boolean, agentDir = getAgentDir()): unknown {
	const user = readFile(join(agentDir, CONFIG_FILE));
	return projectTrusted ? merge(user, readFile(join(cwd, ".pi", CONFIG_FILE))) : user;
}

type Check = (value: unknown) => string | undefined;

const attempts: Check = (value) =>
	Number.isInteger(value) && (value as number) >= 2 ? undefined : "must be an integer ≥ 2";

const limits: Check = (value) => {
	if (!isRecord(value)) return "must be an object with wallClockSec or outputTokens";
	const fields = (["wallClockSec", "outputTokens"] as const).filter((field) => value[field] !== undefined);
	if (fields.length === 0) return "must set wallClockSec or outputTokens";
	for (const field of fields) {
		const limit = value[field];
		if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return `${field} must be a positive number`;
	}
	return undefined;
};

const profile: Check = (value) => (typeof value === "string" && value !== "" ? undefined : "must be a profile name");

const KEYS: [string, Check, "required" | "optional"][] = [
	["attempts", attempts, "required"],
	["limits", limits, "required"],
	["workspace.cloneIgnored", relativePathsProblem, "required"],
	["judge.profile", profile, "optional"],
];

function lookup(config: unknown, key: string): unknown {
	let value = config;
	for (const part of key.split(".")) value = isRecord(value) ? value[part] : undefined;
	return value;
}

export function validateBranchSearchConfig(raw: unknown): ConfigResult {
	const problems: string[] = [];
	for (const [key, check, presence] of KEYS) {
		const value = lookup(raw, key);
		const problem = value === undefined ? (presence === "required" ? "missing" : undefined) : check(value);
		if (problem) problems.push(`${key}: ${problem}`);
	}
	if (problems.length > 0)
		return {
			ok: false,
			text: `Branch search is not configured. Fix these keys in ${CONFIG_FILE}:\n${problems.map((p) => `  ${p}`).join("\n")}`,
		};
	const config = raw as BranchSearchConfig;
	return {
		ok: true,
		config: {
			...config,
			workspace: { ...config.workspace, cloneIgnored: normalizePaths(config.workspace.cloneIgnored) },
		},
	};
}

export function normalizePaths(paths: readonly string[]): string[] {
	return paths.map((path) => posix.normalize(path.replaceAll("\\", "/")).replace(/(.)\/+$/, "$1"));
}
