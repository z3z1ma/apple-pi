import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Read from the Pi agent directory, then from `.pi/` in a trusted project (spec 11). */
export const CONFIG_FILE = "branch-search.json";

export interface SearchShape {
	branches: { perGeneration: number; maxTotal: number };
	generations: {
		maxDepth: number;
		rootsPerGeneration: number;
		parentsPerGeneration: number;
		childrenPerParent: number;
	};
}

export interface BranchSearchConfig extends SearchShape {
	passive: { enabled: boolean; repeatThreshold: number };
	enumerate: { count: number };
	branch: { limits: { wallClockSec?: number; outputTokens?: number } };
	scorer: { validationRetries: number; reviewProfile?: string };
	fidelity?: { profile?: string };
	constraints: string[];
	workspace: { cloneIgnored: string[] };
	apply: "auto" | "report";
	draw: "random" | "model";
}

export type ConfigResult = { ok: true; config: BranchSearchConfig } | { ok: false; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Project values replace user values key by key; arrays replace whole. */
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

/** The merged, unvalidated configuration. */
export function readBranchSearchConfig(cwd: string, projectTrusted: boolean, agentDir = getAgentDir()): unknown {
	const user = readFile(join(agentDir, CONFIG_FILE));
	return projectTrusted ? merge(user, readFile(join(cwd, ".pi", CONFIG_FILE))) : user;
}

type Check = (value: unknown) => string | undefined;

const integer =
	(min: number): Check =>
	(value) =>
		Number.isInteger(value) && (value as number) >= min ? undefined : `must be an integer ≥ ${min}`;
const boolean: Check = (value) => (typeof value === "boolean" ? undefined : "must be true or false");
const oneOf =
	(...options: string[]): Check =>
	(value) =>
		options.includes(value as string) ? undefined : `must be one of ${options.map((o) => `"${o}"`).join(", ")}`;
const strings: Check = (value) =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string") ? undefined : "must be a list of strings";
const profile: Check = (value) => (typeof value === "string" && value !== "" ? undefined : "must be a profile name");

const relativeDirs: Check = (value) => {
	const problem = strings(value);
	if (problem) return problem;
	const bad = (value as string[]).find((path) => {
		const clean = normalize(path);
		return path === "" || isAbsolute(path) || clean === ".." || clean.startsWith(`..${sep}`);
	});
	return bad === undefined ? undefined : `must hold relative paths inside the workspace ("${bad}" is not)`;
};

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

const REQUIRED: [string, Check][] = [
	["passive.enabled", boolean],
	["passive.repeatThreshold", integer(2)],
	["enumerate.count", integer(2)],
	["branches.perGeneration", integer(1)],
	["branches.maxTotal", integer(1)],
	["generations.maxDepth", integer(0)],
	["generations.rootsPerGeneration", integer(0)],
	["generations.parentsPerGeneration", integer(1)],
	["generations.childrenPerParent", integer(1)],
	["branch.limits", limits],
	["scorer.validationRetries", integer(0)],
	["constraints", strings],
	["workspace.cloneIgnored", relativeDirs],
	["apply", oneOf("auto", "report")],
];

const OPTIONAL: [string, Check][] = [
	["scorer.reviewProfile", profile],
	["fidelity.profile", profile],
	["draw", oneOf("random", "model")],
];

function lookup(config: unknown, key: string): unknown {
	let value = config;
	for (const part of key.split(".")) value = isRecord(value) ? value[part] : undefined;
	return value;
}

/** Every required key present and valid; otherwise text naming each missing or invalid key. */
export function validateBranchSearchConfig(raw: unknown): ConfigResult {
	const problems: string[] = [];
	for (const [key, check] of REQUIRED) {
		const value = lookup(raw, key);
		const problem = value === undefined ? "missing" : check(value);
		if (problem) problems.push(`${key}: ${problem}`);
	}
	for (const [key, check] of OPTIONAL) {
		const value = lookup(raw, key);
		const problem = value === undefined ? undefined : check(value);
		if (problem) problems.push(`${key}: ${problem}`);
	}
	if (problems.length > 0) {
		return {
			ok: false,
			text: `Branch search is not configured. Fix these keys in ${CONFIG_FILE}:\n${problems.map((p) => `  ${p}`).join("\n")}`,
		};
	}
	const config = raw as BranchSearchConfig;
	return { ok: true, config: { ...config, draw: config.draw ?? "random" } };
}
