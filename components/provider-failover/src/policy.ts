import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ROLE_ENTRY, sessionRole } from "../../organization/src/session-role.js";
import {
	isInferenceProfileName,
	loadModelProfiles,
	ModelProfileError,
	type ResolvedModelProfile,
	resolveModelProfileCandidates,
} from "../../shared/src/model-profiles.js";

export function failoverCandidates(ctx: ExtensionContext): ResolvedModelProfile[] {
	const role = sessionRole(ctx);
	const hasRecordedRole = ctx.sessionManager
		.getEntries()
		.some((entry) => entry.type === "custom" && entry.customType === ROLE_ENTRY);
	if (!role && hasRecordedRole) throw new ModelProfileError("Cannot resolve the recorded role for provider failover.");
	const name = role ? role.models[0] : "coordination";
	if (!name || !isInferenceProfileName(name)) {
		throw new ModelProfileError("Provider failover requires a workload profile for this role.");
	}
	const profile = loadModelProfiles()[name];
	if (!profile) throw new ModelProfileError(`Provider failover profile ${JSON.stringify(name)} is not configured.`);
	return resolveModelProfileCandidates(name, profile, {
		find: (provider, id) => {
			const model = ctx.modelRegistry.find(provider, id);
			return model && model.provider !== "xai" && model.api !== "pi-virtual" ? model : undefined;
		},
		hasConfiguredAuth: (model) => ctx.modelRegistry.hasConfiguredAuth(model),
	}).map((candidate) => ({ ...candidate, model: structuredClone(candidate.model) }));
}

export function requiresImages(messages: readonly AgentMessage[]): boolean {
	return messages.some(
		(message) =>
			"content" in message &&
			Array.isArray(message.content) &&
			message.content.some(
				(part: unknown) => typeof part === "object" && part !== null && "type" in part && part.type === "image",
			),
	);
}

export function nextFailoverCandidate(
	candidates: readonly ResolvedModelProfile[],
	attemptedProviders: ReadonlySet<string>,
	needsImages: boolean,
): ResolvedModelProfile | undefined {
	return candidates.find(
		({ model }) => !attemptedProviders.has(model.provider) && (!needsImages || model.input.includes("image")),
	);
}
