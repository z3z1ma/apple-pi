/**
 * A root session's role: taken from `--role` at its first start, recorded as a custom entry in its own transcript, and
 * re-applied at every later start (the stored role wins over a later flag). Applying a role sets the session's mind
 * (the first of the role's models the registry knows, at the role's thinking level), its posture (`writes: false`
 * drops the built-in `edit` and `write` tools, which Pi restores from the transcript on every start, so posture is
 * re-applied before each run), and a `<role>` system prompt section. The first start with a role also draws the
 * person's soul, stored in the same entry and rendered under the role body.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { loadRoles, type Role } from "./roles.js";
import { drawSoul, renderSoul, type Soul, soulLine } from "./soul.js";

export const ROLE_ENTRY = "organization-role";
export const ROLE_SYSTEM_PROMPT_TAG = "role";

interface RoleEntry {
	role: string;
	soul?: Soul;
}

interface Person {
	role: Role;
	soul: Soul | undefined;
}

/** Each session's role and soul as resolved at its start, by session id; a session in it without one is unroled. */
const resolved = new Map<string, Person | undefined>();

/** The role of the session `ctx` runs, resolved at its start; undefined for an unroled session. */
export function sessionRole(ctx: ExtensionContext): Role | undefined {
	return resolved.get(ctx.sessionManager.getSessionId())?.role;
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
		if (typeof data?.role === "string") stored = { role: data.role, ...(data.soul ? { soul: data.soul } : {}) };
	}
	return stored;
}

function applyPosture(pi: ExtensionAPI, role: Role): void {
	if (role.writes) return;
	const active = pi.getActiveTools();
	const next = active.filter((name) => name !== "edit" && name !== "write");
	if (next.length !== active.length) pi.setActiveTools(next);
}

async function applyMind(pi: ExtensionAPI, ctx: ExtensionContext, role: Role, warn: (text: string) => void) {
	for (const id of role.models) {
		const slash = id.indexOf("/");
		const model = ctx.modelRegistry.find(id.slice(0, slash), id.slice(slash + 1));
		if (!model || !(await pi.setModel(model))) continue;
		pi.setThinkingLevel(role.thinking as ThinkingLevel);
		return;
	}
	warn(
		`Role ${role.title}: none of its models is available (${role.models.join(", ")}); staying on ${ctx.model?.id ?? "the default model"}.`,
	);
}

/** Installs the role of root sessions. The `role` flag is registered by the caller, with its other flags. */
export function installSessionRole(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		resolved.set(sessionId, undefined);
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
		const soul = stored ? stored.soul : drawSoul();
		if (!stored) pi.appendEntry<RoleEntry>(ROLE_ENTRY, { role: name, soul });
		resolved.set(sessionId, { role, soul });
		applyPosture(pi, role);
		await applyMind(pi, ctx, role, warn);
	});
	pi.on("before_agent_start", (event, ctx) => {
		const person = resolved.get(ctx.sessionManager.getSessionId());
		if (!person) return;
		applyPosture(pi, person.role);
		const body = person.soul ? `${person.role.body.trimEnd()}\n\n${renderSoul(person.soul)}` : person.role.body;
		setSystemPromptSection(event.systemPromptOptions, ROLE_SYSTEM_PROMPT_TAG, body);
	});
}
