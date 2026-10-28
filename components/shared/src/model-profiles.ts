import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Model, ModelThinkingLevel, Usage } from "@earendil-works/pi-ai";
import { type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

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
	"coordination",
	"routine",
	"writing",
] as const;
export type InferenceProfileName = (typeof INFERENCE_PROFILE_NAMES)[number];

export interface InferenceProfileCatalogEntry {
	profile: InferenceProfileName;
	description: string;
}

export const INFERENCE_PROFILE_CATALOG: readonly InferenceProfileCatalogEntry[] = [
	{ profile: "quick", description: "Fast, economical model with workload-appropriate reasoning." },
	{ profile: "balanced", description: "Broadly capable model with measured reasoning." },
	{ profile: "pair", description: "Economical, attentive model that follows the work and notices concrete risk." },
	{ profile: "deep", description: "Strongest available model with high reasoning effort." },
	{ profile: "coding", description: "Code-strong model for implementation and tool use." },
	{
		profile: "visual-engineering",
		description: "Model strong in UI, spatial, and multimodal reasoning, with model-specific effort.",
	},
	{ profile: "coordination", description: "Model suited to planning, delegation, and coordinating work." },
	{ profile: "routine", description: "Economical model for routine, well-defined work." },
	{ profile: "writing", description: "Model suited to clear technical writing with measured reasoning." },
];

const THINKING_LEVELS = new Set<string>(MODEL_PROFILE_THINKING_LEVELS);
const PROFILE_NAMES = new Set<string>(INFERENCE_PROFILE_NAMES);
const CANDIDATE_FIELDS = new Set(["model", "thinking"]);
const POOL_FIELDS = new Set(["selection", "models"]);
const SELECTIONS = new Set(["ordered", "random", "round-robin"]);

export function isInferenceProfileName(value: string): value is InferenceProfileName {
	return PROFILE_NAMES.has(value);
}

export interface ModelProfileCandidate {
	model: string;
	thinking: ModelThinkingLevel;
}

export interface ModelProfile {
	selection: "ordered" | "random" | "round-robin";
	models: ModelProfileCandidate[];
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

function validateFields(path: string, label: string, value: Record<string, unknown>, fields: Set<string>): void {
	const unknown = Object.keys(value).filter((field) => !fields.has(field));
	if (unknown.length > 0) {
		fail(path, `${label} has unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
	}
}

function parseCandidate(path: string, label: string, raw: unknown): ModelProfileCandidate {
	const candidate = record(raw);
	if (!candidate) fail(path, `${label} must be an object`);
	validateFields(path, label, candidate, CANDIDATE_FIELDS);
	if (typeof candidate.model !== "string" || !candidate.model.trim()) {
		fail(path, `${label} requires a non-empty "model"`);
	}
	if (candidate.model.trim() !== candidate.model) {
		fail(path, `${label} model must not have surrounding whitespace`);
	}
	const slash = candidate.model.indexOf("/");
	if (slash <= 0 || slash === candidate.model.length - 1) {
		fail(path, `${label} model must be "provider/model"`);
	}
	if (typeof candidate.thinking !== "string" || !THINKING_LEVELS.has(candidate.thinking)) {
		fail(path, `${label} thinking must be one of: ${MODEL_PROFILE_THINKING_LEVELS.join(", ")}`);
	}
	return { model: candidate.model, thinking: candidate.thinking as ModelThinkingLevel };
}

/** Read and validate the complete user-global model profile authority. */
export function loadModelProfiles(options: { optional?: boolean } = {}): Record<string, ModelProfile> {
	const path = modelProfilesPath();
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (options.optional && (error as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null);
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
		const label = `profile ${JSON.stringify(name)}`;
		if (!Object.hasOwn(profile, "selection") && !Object.hasOwn(profile, "models")) {
			profiles[name] = { selection: "ordered", models: [parseCandidate(path, label, profile)] };
			continue;
		}
		validateFields(path, label, profile, POOL_FIELDS);
		if (typeof profile.selection !== "string" || !SELECTIONS.has(profile.selection)) {
			fail(path, `${label} selection must be one of: ${[...SELECTIONS].join(", ")}`);
		}
		if (!Array.isArray(profile.models) || profile.models.length === 0) {
			fail(path, `${label} requires a non-empty "models" array`);
		}
		profiles[name] = {
			selection: profile.selection as ModelProfile["selection"],
			models: profile.models.map((candidate, index) => parseCandidate(path, `${label} models[${index}]`, candidate)),
		};
	}
	return profiles;
}

export interface ModelProfileRegistry {
	find(provider: string, modelId: string): Model<any> | undefined;
	hasConfiguredAuth?(model: Model<any>): boolean;
}

/** Use registered candidates with configured authentication when the registry can check it. */
export function resolveModelProfileCandidates(
	name: string,
	profile: ModelProfile,
	registry: ModelProfileRegistry,
): ResolvedModelProfile[] {
	const candidates = profile.models.flatMap((candidate) => {
		const slash = candidate.model.indexOf("/");
		const model = registry.find(candidate.model.slice(0, slash), candidate.model.slice(slash + 1));
		return model && (registry.hasConfiguredAuth?.(model) ?? true)
			? [{ name, model, thinking: candidate.thinking }]
			: [];
	});
	if (candidates.length === 0) unavailableProfile(name, profile);
	return candidates;
}

function roundRobinIndex(name: string, count: number): number {
	const stateDir = join(getAgentDir(), "state");
	mkdirSync(stateDir, { recursive: true, mode: 0o700 });
	const database = new DatabaseSync(join(stateDir, "model-profile-selection.sqlite"));
	try {
		database.exec(`
			PRAGMA busy_timeout = 5000;
			CREATE TABLE IF NOT EXISTS selections (name TEXT PRIMARY KEY, next INTEGER NOT NULL);
			BEGIN IMMEDIATE;
		`);
		const row = database.prepare("SELECT next FROM selections WHERE name = ?").get(name);
		const index = Number(row?.next ?? 0) % count;
		database
			.prepare("INSERT INTO selections (name, next) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next = excluded.next")
			.run(name, (index + 1) % count);
		database.exec("COMMIT;");
		return index;
	} finally {
		database.close();
	}
}

function unavailableProfile(name: string, profile: ModelProfile): never {
	throw new ModelProfileError(
		`${modelProfilesPath()}: model profile ${JSON.stringify(name)} selects unavailable model ${profile.models.map((candidate) => JSON.stringify(candidate.model)).join(", ")}`,
	);
}

/** Select only from the caller's eligible candidates, retaining each candidate's thinking level. */
export function selectModelProfile(
	name: string,
	profile: ModelProfile,
	candidates: ResolvedModelProfile[],
): ResolvedModelProfile {
	if (candidates.length === 0) unavailableProfile(name, profile);
	const index =
		profile.selection === "random"
			? Math.floor(Math.random() * candidates.length)
			: profile.selection === "round-robin"
				? roundRobinIndex(name, candidates.length)
				: 0;
	return candidates[index]!;
}

/** Resolve and select one profile bundle against Pi's model registry. */
export function resolveModelProfile(name: string, registry: ModelProfileRegistry): ResolvedModelProfile {
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
	return selectModelProfile(name, profile, resolveModelProfileCandidates(name, profile, registry));
}

/** One request on a user-global model profile, without the conversation or tools. */
export type ProfileRequest = (
	profile: string,
	prompt: string,
	signal: AbortSignal,
) => Promise<{ text: string; usage: Usage }>;

/** A one-shot {@link ProfileRequest} against Pi's model registry: one user prompt, the reply's text. */
export function profileRequest(
	registry: Pick<ExtensionContext["modelRegistry"], "find" | "streamSimple">,
): ProfileRequest {
	return async (profile, prompt, signal) => {
		const { model, thinking } = resolveModelProfile(profile, registry);
		const reply = await registry
			.streamSimple(
				model,
				{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
				{ signal, ...(thinking === "off" ? {} : { reasoning: thinking }) },
			)
			.result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted")
			throw new Error(reply.errorMessage ?? reply.stopReason);
		const text = reply.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n")
			.trim();
		return { text, usage: reply.usage };
	};
}
