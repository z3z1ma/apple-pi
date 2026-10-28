/**
 * A root session's role: taken from `--role` at its first start, recorded as a custom entry in its own transcript, and
 * re-applied at every later start (the stored role wins over a later flag). Applying a role sets the session's mind
 * (selected once and retained in that entry), its posture (`writes: false`
 * drops the built-in `edit` and `write` tools, which Pi restores from the transcript on every start, so posture is
 * re-applied before each run), and a `<role>` system prompt section. The first start with a role also draws the
 * person's soul, stored in the same entry and rendered under the role body; a start whose draw fails warns and draws
 * again at the next start.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	isInferenceProfileName,
	loadModelProfiles,
	MODEL_PROFILE_THINKING_LEVELS,
	resolveModelProfileCandidates,
	selectModelProfile,
} from "../../shared/src/model-profiles.js";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { loadRoles, parseRoleModel, type Role } from "./roles.js";
import { drawSoul, isSoul, renderSoul, type Soul, soulLine } from "./soul.js";

export const ROLE_ENTRY = "organization-role";
export const ROLE_SYSTEM_PROMPT_TAG = "role";

interface Mind {
	model: string;
	thinking: ThinkingLevel;
}

interface RoleEntry {
	role: string;
	soul?: Soul;
	mind?: Mind;
}

interface Person {
	role: Role;
	soul: Soul | undefined;
}

/** Each session's role and soul as resolved at its start, by session id; a session in it without one is unroled. */
const resolved = new Map<string, Person | undefined>();
const mindFailures = new Map<string, string>();

/** The role of the session `ctx` runs, resolved at its start; undefined for an unroled session. */
export function sessionRole(ctx: ExtensionContext): Role | undefined {
	const id = ctx.sessionManager.getSessionId();
	if (resolved.has(id)) return resolved.get(id)?.role;
	// Separate extension-loader graphs do not share this cache; the transcript carries the role across them.
	const stored = storedRole(ctx);
	if (!stored) return undefined;
	const role = loadRoles(ctx.cwd).roles.get(stored.role);
	resolved.set(id, role ? { role, soul: isSoul(stored.soul) ? stored.soul : undefined } : undefined);
	return role;
}

/** The one-line soul of the session `ctx` runs, for the directory; undefined without a role. */
export function sessionSoulLine(ctx: ExtensionContext): string | undefined {
	const soul = resolved.get(ctx.sessionManager.getSessionId())?.soul;
	return soul && soulLine(soul);
}

function storedRole(ctx: ExtensionContext): RoleEntry | undefined {
	let stored: RoleEntry | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== ROLE_ENTRY) continue;
		const data = entry.data as Partial<RoleEntry> | undefined;
		if (typeof data?.role === "string") {
			const mind = data.mind;
			stored = {
				role: data.role,
				...(data.soul ? { soul: data.soul } : {}),
				...(mind &&
				typeof mind.model === "string" &&
				mind.model.includes("/") &&
				MODEL_PROFILE_THINKING_LEVELS.includes(mind.thinking)
					? { mind }
					: {}),
			};
		}
	}
	return stored;
}

function applyPosture(pi: ExtensionAPI, role: Role): void {
	if (role.writes) return;
	const active = pi.getActiveTools();
	const next = active.filter((name) => name !== "edit" && name !== "write");
	if (next.length !== active.length) pi.setActiveTools(next);
}

async function applySelectedMind(pi: ExtensionAPI, ctx: ExtensionContext, mind: Mind): Promise<Mind> {
	const slash = mind.model.indexOf("/");
	const model = ctx.modelRegistry.find(mind.model.slice(0, slash), mind.model.slice(slash + 1));
	if (!model || !(await pi.setModel(model))) throw new Error(`Selected role model ${mind.model} is unavailable.`);
	pi.setThinkingLevel(mind.thinking);
	return { model: `${model.provider}/${model.id}`, thinking: pi.getThinkingLevel() };
}

async function applyMind(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	role: Role,
	warn: (text: string) => void,
	stored?: Mind,
): Promise<Mind | undefined> {
	if (stored) return applySelectedMind(pi, ctx, stored);
	const first = role.models[0]!;
	const profileName = isInferenceProfileName(first) ? first : undefined;
	const profile = profileName ? loadModelProfiles({ optional: true })[profileName] : undefined;
	if (profile && profileName) {
		const selected = selectModelProfile(
			profileName,
			profile,
			resolveModelProfileCandidates(profileName, profile, ctx.modelRegistry),
		);
		return applySelectedMind(pi, ctx, {
			model: `${selected.model.provider}/${selected.model.id}`,
			thinking: selected.thinking as ThinkingLevel,
		});
	}
	for (const entry of profileName ? role.models.slice(1) : role.models) {
		const candidate = parseRoleModel(entry)!;
		const slash = candidate.model.indexOf("/");
		const model = ctx.modelRegistry.find(candidate.model.slice(0, slash), candidate.model.slice(slash + 1));
		if (!model || !(await pi.setModel(model))) continue;
		pi.setThinkingLevel(candidate.thinking as ThinkingLevel);
		return { model: `${model.provider}/${model.id}`, thinking: pi.getThinkingLevel() };
	}
	warn(
		`Role ${role.title}: none of its models is available (${role.models.join(", ")}); staying on ${ctx.model?.id ?? "the default model"}.`,
	);
	if (ctx.model) return { model: `${ctx.model.provider}/${ctx.model.id}`, thinking: pi.getThinkingLevel() };
}

/** Installs the role of root sessions. The `role` flag is registered by the caller, with its other flags. */
export function installSessionRole(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		resolved.set(sessionId, undefined);
		mindFailures.delete(sessionId);
		const warn = (text: string) => {
			if (ctx.hasUI) ctx.ui.notify(text, "warning");
			else process.stderr.write(`${text}\n`);
		};
		const stored = storedRole(ctx);
		const flag = pi.getFlag("role");
		const name = stored?.role ?? (typeof flag === "string" && flag ? flag : undefined);
		if (!name) return;
		const catalog = loadRoles(ctx.cwd);
		for (const problem of catalog.problems) warn(`Role file skipped: ${problem}`);
		const role = catalog.roles.get(name);
		if (!role) {
			warn(`Unknown role "${name}"; known roles: ${[...catalog.roles.keys()].join(", ")}.`);
			return;
		}
		let mind: Mind | undefined;
		try {
			mind = await applyMind(pi, ctx, role, warn, stored?.mind);
		} catch (error) {
			const message = `Role ${role.title}: ${error instanceof Error ? error.message : String(error)}`;
			mindFailures.set(sessionId, message);
			warn(message);
			return;
		}
		let soul = isSoul(stored?.soul) ? stored.soul : undefined;
		if (!soul) {
			soul = await drawSoul().catch((error: unknown) => {
				warn(`No soul drawn; the next start tries again: ${error instanceof Error ? error.message : String(error)}`);
				return undefined;
			});
		}
		if (!stored || soul !== stored.soul || (mind && !stored.mind)) {
			pi.appendEntry<RoleEntry>(ROLE_ENTRY, { role: name, ...(soul ? { soul } : {}), ...(mind ? { mind } : {}) });
		}
		resolved.set(sessionId, { role, soul });
		applyPosture(pi, role);
	});
	pi.on("before_agent_start", (event, ctx) => {
		const failure = mindFailures.get(ctx.sessionManager.getSessionId());
		if (failure) {
			ctx.abort();
			throw new Error(failure);
		}
		const person = resolved.get(ctx.sessionManager.getSessionId());
		if (!person) return;
		applyPosture(pi, person.role);
		const body = person.soul ? `${person.role.body.trimEnd()}\n\n${renderSoul(person.soul)}` : person.role.body;
		setSystemPromptSection(event.systemPromptOptions, ROLE_SYSTEM_PROMPT_TAG, body);
	});
}
