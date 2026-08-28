import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const MODEL_PROFILES_FILENAME = "model-profiles.json";
export const MODEL_PROFILE_THINKING_LEVELS: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export const INFERENCE_PROFILE_NAMES = [
	"quick",
	"balanced",
	"pair",
	"deep",
	"coding",
	"visual-engineering",
	"background",
] as const;
export type InferenceProfileName = (typeof INFERENCE_PROFILE_NAMES)[number];

export interface InferenceProfileCatalogEntry {
	profile: InferenceProfileName;
	description: string;
}

export const INFERENCE_PROFILE_CATALOG: readonly InferenceProfileCatalogEntry[] = [
	{
		profile: "quick",
		description:
			"Latency-first inference intended for a fast, economical model with light-to-moderate reasoning effort.",
	},
	{
		profile: "balanced",
		description:
			"General-purpose inference intended for a broadly capable model with substantial but measured reasoning effort.",
	},
	{
		profile: "pair",
		description:
			"Economical persistent supervision intended to track trajectories, detect concrete risk, and route rare deep consultations.",
	},
	{
		profile: "deep",
		description:
			"Maximum-depth inference intended for the strongest reasoning model available with high reasoning effort.",
	},
	{
		profile: "coding",
		description: "Software-engineering inference intended for a code-strong model with high reasoning effort.",
	},
	{
		profile: "visual-engineering",
		description:
			"Visual-engineering inference intended for a model strong in UI, spatial, and multimodal reasoning with moderate-to-high effort.",
	},
	{
		profile: "background",
		description: "Low-cost asynchronous inference intended for an economical model with low reasoning effort.",
	},
];

const THINKING_LEVELS = new Set<string>(MODEL_PROFILE_THINKING_LEVELS);
const PROFILE_NAMES = new Set<string>(INFERENCE_PROFILE_NAMES);
const PROFILE_FIELDS = new Set(["model", "thinking"]);

export function isInferenceProfileName(value: string): value is InferenceProfileName {
	return PROFILE_NAMES.has(value);
}

export interface ModelProfile {
	model: string;
	thinking: ModelThinkingLevel;
}

export interface ResolvedModelProfile {
	name: string;
	model: Model<any>;
	thinking: ModelThinkingLevel;
}

export class ModelProfileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelProfileError";
	}
}

export function modelProfilesPath(): string {
	return join(getAgentDir(), MODEL_PROFILES_FILENAME);
}

function fail(path: string, message: string): never {
	throw new ModelProfileError(`${path}: ${message}`);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Read and validate the complete user-global model profile authority. */
export function loadModelProfiles(): Record<string, ModelProfile> {
	const path = modelProfilesPath();
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		fail(path, `cannot read model profiles (${reason})`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		fail(path, `invalid JSON (${reason})`);
	}
	const root = record(parsed);
	if (!root || Object.keys(root).length !== 1 || !Object.hasOwn(root, "profiles")) {
		fail(path, 'expected exactly one top-level "profiles" object');
	}
	const rawProfiles = record(root.profiles);
	if (!rawProfiles) fail(path, '"profiles" must be an object');

	const profiles: Record<string, ModelProfile> = Object.create(null) as Record<string, ModelProfile>;
	for (const [name, raw] of Object.entries(rawProfiles)) {
		if (!name || name.trim() !== name)
			fail(path, `profile names must be non-empty and unpadded (got ${JSON.stringify(name)})`);
		if (!isInferenceProfileName(name)) {
			fail(path, `unsupported profile ${JSON.stringify(name)}; expected one of: ${INFERENCE_PROFILE_NAMES.join(", ")}`);
		}
		const profile = record(raw);
		if (!profile) fail(path, `profile ${JSON.stringify(name)} must be an object`);
		const unknown = Object.keys(profile).filter((field) => !PROFILE_FIELDS.has(field));
		if (unknown.length > 0) {
			fail(
				path,
				`profile ${JSON.stringify(name)} has unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
			);
		}
		if (typeof profile.model !== "string" || !profile.model.trim()) {
			fail(path, `profile ${JSON.stringify(name)} requires a non-empty "model"`);
		}
		if (profile.model.trim() !== profile.model) {
			fail(path, `profile ${JSON.stringify(name)} model must not have surrounding whitespace`);
		}
		const slash = profile.model.indexOf("/");
		if (slash <= 0 || slash === profile.model.length - 1) {
			fail(path, `profile ${JSON.stringify(name)} model must be "provider/model"`);
		}
		if (typeof profile.thinking !== "string" || !THINKING_LEVELS.has(profile.thinking)) {
			fail(
				path,
				`profile ${JSON.stringify(name)} thinking must be one of: ${MODEL_PROFILE_THINKING_LEVELS.join(", ")}`,
			);
		}
		profiles[name] = { model: profile.model, thinking: profile.thinking as ModelThinkingLevel };
	}
	return profiles;
}

/** Resolve one exact profile bundle against Pi's model registry. */
export function resolveModelProfile(
	name: string,
	registry: { find(provider: string, modelId: string): Model<any> | undefined },
): ResolvedModelProfile {
	const normalized = name.trim();
	if (!normalized || normalized !== name) {
		throw new ModelProfileError("model profile name must be a non-empty, unpadded string");
	}
	if (!isInferenceProfileName(name)) {
		throw new ModelProfileError(`model profile must be one of: ${INFERENCE_PROFILE_NAMES.join(", ")}`);
	}
	const profiles = loadModelProfiles();
	const profile = Object.hasOwn(profiles, name) ? profiles[name] : undefined;
	if (!profile) {
		throw new ModelProfileError(`${modelProfilesPath()}: model profile ${JSON.stringify(name)} is not defined`);
	}
	const slash = profile.model.indexOf("/");
	const provider = profile.model.slice(0, slash);
	const modelId = profile.model.slice(slash + 1);
	const model = registry.find(provider, modelId);
	if (!model) {
		throw new ModelProfileError(
			`${modelProfilesPath()}: model profile ${JSON.stringify(name)} selects unavailable model ${JSON.stringify(profile.model)}`,
		);
	}
	return { name, model, thinking: profile.thinking };
}
