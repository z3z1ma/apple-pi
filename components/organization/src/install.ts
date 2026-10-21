/**
 * The organization in a root session: its role (mind, posture, `<role>`), the `<org>` section everyone gets, and the
 * `<manager>` charter of a managing role. A session with no manager is the root of its organization and holds the
 * manager tools as the operator's seat, whether or not its role manages.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import {
	CATALOG_SYSTEM_PROMPT_TAG,
	catalogSection,
	MANAGER_SYSTEM_PROMPT_TAG,
	managerCharter,
	ORG_SYSTEM_PROMPT_TAG,
	orgSection,
} from "./charters.js";
import { organizationOf } from "./directory.js";
import { loadRoles } from "./roles.js";
import { installSelf } from "./self.js";
import { installSessionRole, sessionRole } from "./session-role.js";

/** The manager this session reports to (`--reports-to`), or null for a root. */
export function managerOf(pi: ExtensionAPI): string | null {
	const flag = pi.getFlag("reports-to");
	return typeof flag === "string" && flag ? flag : null;
}

/** Whether this session may hire, reopen, close, and rename people: its role manages, or it is a root. */
export function managesPeople(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
	return sessionRole(ctx)?.manages === true || managerOf(pi) === null;
}

export function installOrganization(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	installSessionRole(pi);
	installSelf(pi);
	pi.on("before_agent_start", (event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		const role = sessionRole(ctx);
		const managerId = managerOf(pi);
		setSystemPromptSection(
			event.systemPromptOptions,
			ORG_SYSTEM_PROMPT_TAG,
			orgSection({
				id,
				name: ctx.sessionManager.getSessionName() ?? null,
				title: role?.title ?? null,
				managerId,
				rootId: managerId ? organizationOf(id).root : id,
			}),
		);
		if (role?.manages)
			setSystemPromptSection(event.systemPromptOptions, MANAGER_SYSTEM_PROMPT_TAG, managerCharter(managerId));
		if (managesPeople(pi, ctx))
			setSystemPromptSection(
				event.systemPromptOptions,
				CATALOG_SYSTEM_PROMPT_TAG,
				catalogSection(loadRoles(ctx.cwd).roles.values()),
			);
	});
}
