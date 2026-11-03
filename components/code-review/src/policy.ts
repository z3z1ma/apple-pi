import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadRoles, parseRoleModel, type Role } from "../../organization/src/roles.js";
import { isInferenceProfileName, loadModelProfiles, type ModelProfile } from "../../shared/src/model-profiles.js";

import { INSPECT_REVIEW, LINK_DUPLICATES, PLAN_REVIEW, VALIDATE_REVIEW } from "./prompts.js";
import type { ReviewConfiguration } from "./types.js";

export function reviewConfiguration(source: string): ReviewConfiguration {
	const { roles, problems } = loadRoles(source);
	return {
		instructions: {
			planning: PLAN_REVIEW,
			inspection: INSPECT_REVIEW,
			validation: VALIDATE_REVIEW,
			duplicates: LINK_DUPLICATES,
		},
		roleReferences: [...roles.keys()].sort().flatMap((name) => {
			const role = roles.get(name)!;
			return role.writes || role.manages ? [] : [{ role: name, models: [...role.models] }];
		}),
		catalogIssues: problems.length,
	};
}

export function configurationSummary(configuration: ReviewConfiguration | undefined) {
	return configuration
		? {
				hash: createHash("sha256").update(JSON.stringify(configuration)).digest("hex"),
				roleReferences: configuration.roleReferences.length,
				catalogIssues: configuration.catalogIssues,
			}
		: null;
}

export type ReviewDepth = "standard" | "deep";

function rolePolicy(role: Role, depth: ReviewDepth, profiles?: Record<string, ModelProfile>) {
	const text = readFileSync(role.path, "utf8");
	const own = isInferenceProfileName(role.models[0]!) ? role.models[0]! : undefined;
	const profile = !own ? undefined : depth === "deep" ? "deep" : own === "deep" ? "balanced" : own;
	const configured = profile ? (profiles ?? loadModelProfiles({ optional: true }))[profile] : undefined;
	return {
		role: { path: role.path, hash: createHash("sha256").update(text).digest("hex"), text },
		depth,
		profile: profile ?? null,
		selection: configured?.selection ?? "ordered",
		candidates: configured?.models ?? (own ? role.models.slice(1) : role.models).map((entry) => parseRoleModel(entry)!),
	};
}

export function reviewRolePolicy(source: string, name: string, depth: ReviewDepth = "standard") {
	const role = loadRoles(source).roles.get(name);
	if (!role || role.writes || role.manages) throw new Error(`Unavailable advisory review role: ${name}`);
	return rolePolicy(role, depth);
}

export function reviewPolicyFingerprint(policy: ReturnType<typeof reviewRolePolicy>): string {
	return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function reviewRoleCatalog(source: string) {
	const roles = [...loadRoles(source).roles.values()].filter((role) => !role.writes && !role.manages);
	const profiles = roles.some((role) => isInferenceProfileName(role.models[0]!))
		? loadModelProfiles({ optional: true })
		: undefined;
	return roles.map((role) => ({
		name: role.name,
		title: role.title,
		mandate: role.mandate,
		models: role.models,
		policy: reviewPolicyFingerprint(rolePolicy(role, "standard", profiles)),
		deepPolicy: reviewPolicyFingerprint(rolePolicy(role, "deep", profiles)),
	}));
}
