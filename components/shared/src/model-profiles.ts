import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const THINKING_LEVELS = new Set<string>(MODEL_PROFILE_THINKING_LEVELS);
const PROFILE_FIELDS = new Set(["model", "thinking"]);

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
