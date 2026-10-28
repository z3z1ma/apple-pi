/**
 * The role catalog: one Markdown file per role, with front matter for the role's title, mind, posture, and whether
 * it manages, and a body that is the role's obligation. The package's `roles/` directory holds the catalog; a file of
 * the same name under `~/.pi/agent/roles/` or `<cwd>/.pi/roles/` replaces it, later directories winning.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
	isInferenceProfileName,
	MODEL_PROFILE_THINKING_LEVELS,
	type ModelProfileCandidate,
} from "../../shared/src/model-profiles.js";

export interface Role {
	/** The file name without `.md`; the name a hire or `--role` uses. */
	name: string;
	title: string;
	/** One line a manager hires by: what the role is for. */
	mandate: string;
	/** Optional leading profile, then ordered `provider/id:effort` recommendations. */
	models: string[];
	/** Whether the person keeps the built-in `edit` and `write` tools. */
	writes: boolean;
	/** Whether the person gets the manager tools and charter. */
	manages: boolean;
	body: string;
	path: string;
}

export interface RoleCatalog {
	roles: Map<string, Role>;
	/** Files skipped, each named with its reason. */
	problems: string[];
}

export const PACKAGE_ROLES_DIR = fileURLToPath(new URL("../../../roles/", import.meta.url));

/** The catalog directories in override order: the package, then the user, then the project. */
export function roleDirectories(cwd: string): string[] {
	return [PACKAGE_ROLES_DIR, join(getAgentDir(), "roles"), join(cwd, ".pi", "roles")];
}

export function loadRoles(cwd: string): RoleCatalog {
	const roles = new Map<string, Role>();
	const problems: string[] = [];
	for (const dir of roleDirectories(cwd)) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.sort()) {
			const path = join(dir, file);
			const result = readRole(path, file.slice(0, -3));
			if (typeof result === "string") problems.push(result);
			else roles.set(result.name, result);
		}
	}
	return { roles, problems };
}

const MODEL_ID = /^[a-z0-9-]+\/[a-z0-9][a-z0-9.:-]*$/i;

/** The final colon separates effort from a model identity, which can itself contain colons. */
export function parseRoleModel(value: string): ModelProfileCandidate | undefined {
	const colon = value.lastIndexOf(":");
	if (colon < 0) return undefined;
	const model = value.slice(0, colon);
	const thinking = value.slice(colon + 1) as ModelThinkingLevel;
	if (!MODEL_ID.test(model) || !MODEL_PROFILE_THINKING_LEVELS.includes(thinking)) return undefined;
	return { model, thinking };
}

/** One role file, or the reason it is skipped. */
export function readRole(path: string, name: string): Role | string {
	let parsed: { frontmatter: Record<string, unknown>; body: string };
	try {
		parsed = parseFrontmatter<Record<string, unknown>>(readFileSync(path, "utf-8"));
	} catch (error) {
		return `${path}: ${error instanceof Error ? error.message : String(error)}`;
	}
	const { frontmatter: fm } = parsed;
	const body = parsed.body.trim();
	const title = typeof fm.title === "string" ? fm.title.trim() : "";
	if (!title) return `${path}: title must be a non-empty string`;
	const mandate = typeof fm.mandate === "string" ? fm.mandate.trim() : "";
	if (!mandate || mandate.includes("\n")) return `${path}: mandate must be one non-empty line`;
	const models = Array.isArray(fm.models) ? fm.models : [];
	const recommendations = typeof models[0] === "string" && isInferenceProfileName(models[0]) ? models.slice(1) : models;
	if (recommendations.length === 0 || !recommendations.every((m) => typeof m === "string" && parseRoleModel(m)))
		return `${path}: models must be provider/id:effort recommendations, optionally preceded by one known profile; effort must be one of ${MODEL_PROFILE_THINKING_LEVELS.join(", ")}`;
	if (Object.hasOwn(fm, "thinking")) return `${path}: put effort in each models entry instead of a thinking field`;
	if (typeof fm.writes !== "boolean") return `${path}: writes must be true or false`;
	if (typeof fm.manages !== "boolean") return `${path}: manages must be true or false`;
	if (!body) return `${path}: the body (the role's obligation) is empty`;
	return {
		name,
		title,
		mandate,
		models: models as string[],
		writes: fm.writes,
		manages: fm.manages,
		body,
		path,
	};
}
