import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadRoles, parseRoleModel, type Role } from "../../organization/src/roles.js";
import { isInferenceProfileName, loadModelProfiles, type ModelProfile } from "../../shared/src/model-profiles.js";

function rolePolicy(role: Role, profiles?: Record<string, ModelProfile>) {
	const text = readFileSync(role.path, "utf8");
	const profile = isInferenceProfileName(role.models[0]!) ? role.models[0]! : undefined;
	const configured = profile ? (profiles ?? loadModelProfiles({ optional: true }))[profile] : undefined;
	return {
		role: { path: role.path, hash: createHash("sha256").update(text).digest("hex"), text },
		profile: profile ?? null,
		selection: configured?.selection ?? "ordered",
		candidates:
			configured?.models ?? (profile ? role.models.slice(1) : role.models).map((entry) => parseRoleModel(entry)!),
	};
}

export function reviewRolePolicy(source: string, name: string) {
	const role = loadRoles(source).roles.get(name);
	if (!role || role.writes || role.manages) throw new Error(`Unavailable advisory review role: ${name}`);
	return rolePolicy(role);
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
		policy: reviewPolicyFingerprint(rolePolicy(role, profiles)),
	}));
}
