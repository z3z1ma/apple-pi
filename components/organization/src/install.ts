/**
 * The organization in a root session: its role (mind, posture, `<role>`), the `<org>` section everyone gets, and the
 * `<manager>` charter of a managing role. Managing roles and unroled organization roots hold management capabilities.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import {
	CATALOG_SYSTEM_PROMPT_TAG,
	catalogSection,
	MANAGER_SYSTEM_PROMPT_TAG,
	managerCharter,
	ORG_SYSTEM_PROMPT_TAG,
	orgSection,
} from "./charters.js";
import { organizationOf, reportingOf } from "./directory.js";
import { loadRoles } from "./roles.js";
import { installSelf } from "./self.js";
import { installSessionRole, sessionRole } from "./session-role.js";

/** Current manager, null for a recorded root, or undefined before the runtime records the person. */
export function managerOf(ctx: ExtensionContext): string | null | undefined {
	return reportingOf(ctx.sessionManager.getSessionId())?.reportsTo;
}

/** A role defines capabilities; an unroled person can manage only as a recorded organization root. */
export function managesPeople(ctx: ExtensionContext): boolean {
	const role = sessionRole(ctx);
	return role ? role.manages : managerOf(ctx) === null;
}

/** `reflects` is false for a person with no future to carry a self into, such as a program's temporary peer. */
export function installOrganization(pi: ExtensionAPI, { reflects }: { reflects: boolean } = { reflects: true }): void {
	installSessionRole(pi);
	installSelf(pi, { reflects });
	pi.on("before_agent_start", (event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		const role = sessionRole(ctx);
		const managerId = managerOf(ctx) ?? null;
		setSystemPromptSection(
			event.systemPromptOptions,
			ORG_SYSTEM_PROMPT_TAG,
			orgSection({
				id,
				name: ctx.sessionManager.getSessionName() ?? null,
				title: role?.title ?? null,
				manages: managesPeople(ctx),
				managerId,
				rootId: managerId ? organizationOf(id).root : id,
			}),
		);
		if (role?.manages)
			setSystemPromptSection(event.systemPromptOptions, MANAGER_SYSTEM_PROMPT_TAG, managerCharter(managerId));
		if (managesPeople(ctx))
			setSystemPromptSection(
				event.systemPromptOptions,
				CATALOG_SYSTEM_PROMPT_TAG,
				catalogSection(loadRoles(ctx.cwd).roles.values()),
			);
	});
}
