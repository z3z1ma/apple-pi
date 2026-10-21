/**
 * A root session's role: taken from `--role` at its first start, recorded as a custom entry in its own transcript, and
 * re-applied at every later start (the stored role wins over a later flag). Applying a role sets the session's mind
 * (the first of the role's models the registry knows, at the role's thinking level), its posture (`writes: false`
 * drops the built-in `edit` and `write` tools, which Pi restores from the transcript on every start, so posture is
 * re-applied before each run), and a `<role>` system prompt section.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { loadRoles, type Role } from "./roles.js";

export const ROLE_ENTRY = "organization-role";
export const ROLE_SYSTEM_PROMPT_TAG = "role";

interface RoleEntry {
	role: string;
}

/** Each session's role as resolved at its start, by session id; a session in it without a role is unroled. */
const resolved = new Map<string, Role | undefined>();

/** The role of the session `ctx` runs, resolved at its start; undefined for an unroled session. */
export function sessionRole(ctx: ExtensionContext): Role | undefined {
	return resolved.get(ctx.sessionManager.getSessionId());
}

function storedRoleName(ctx: ExtensionContext): string | undefined {
	let name: string | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== ROLE_ENTRY) continue;
		const data = entry.data as Partial<RoleEntry> | undefined;
		if (typeof data?.role === "string") name = data.role;
	}
	return name;
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
	if (inChildSessionContext()) return;
	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		resolved.set(sessionId, undefined);
		const warn = (text: string) => {
			if (ctx.hasUI) ctx.ui.notify(text, "warning");
			else process.stderr.write(`${text}\n`);
		};
		const stored = storedRoleName(ctx);
		const flag = pi.getFlag("role");
		const name = stored ?? (typeof flag === "string" && flag ? flag : undefined);
		if (!name) return;
		const catalog = loadRoles(ctx.cwd);
		for (const problem of catalog.problems) warn(`Role file skipped: ${problem}`);
		const role = catalog.roles.get(name);
		if (!role) {
			warn(`Unknown role "${name}"; known roles: ${[...catalog.roles.keys()].join(", ")}.`);
			return;
		}
		if (!stored) pi.appendEntry<RoleEntry>(ROLE_ENTRY, { role: name });
		resolved.set(sessionId, role);
		applyPosture(pi, role);
		await applyMind(pi, ctx, role, warn);
	});
	pi.on("before_agent_start", (event, ctx) => {
		const role = sessionRole(ctx);
		if (!role) return;
		applyPosture(pi, role);
		setSystemPromptSection(event.systemPromptOptions, ROLE_SYSTEM_PROMPT_TAG, role.body);
	});
}
