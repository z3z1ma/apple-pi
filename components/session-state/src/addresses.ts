import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { organizationOf } from "../../organization/src/directory.js";
import { statePaths } from "./paths.js";

/** The session row of `id`, read-only; undefined when the database or the session is missing. */
function sessionRow(id: string): { id: string; reports_to: string | null } | undefined {
	const path = statePaths().db;
	if (!existsSync(path)) return undefined;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		return db.prepare("select id, reports_to from sessions where id = ?").get(id) as
			| { id: string; reports_to: string | null }
			| undefined;
	} finally {
		db.close();
	}
}

/**
 * Turn addresses into session ids: `my-manager`, `my-team` (your reports, or your teammates under your manager when
 * you have none), a person's name in your organization, or any session id. Throws naming the address it cannot place.
 */
export function resolveAddresses(self: string, addresses: string[]): string[] {
	const members = organizationOf(self).members;
	const me = sessionRow(self);
	const ids: string[] = [];
	for (const raw of addresses) {
		const address = raw.trim();
		if (address === "my-manager") {
			if (!me?.reports_to) throw new Error("You have no manager.");
			ids.push(me.reports_to);
			continue;
		}
		if (address === "my-team") {
			const live = members.filter((member) => !member.retired);
			const reports = live.filter((member) => member.reportsTo === self);
			const team = reports.length
				? reports
				: live.filter((member) => me?.reports_to && member.reportsTo === me.reports_to);
			if (!team.length) throw new Error("You have no team: nobody reports to you, and you have no teammates.");
			ids.push(...team.map((member) => member.id));
			continue;
		}
		const byName = members.filter((member) => member.name?.toLowerCase() === address.toLowerCase());
		if (byName.length === 1) {
			ids.push(byName[0].id);
			continue;
		}
		if (byName.length > 1) throw new Error(`More than one person is named ${address}; use the session id.`);
		if (members.some((member) => member.id === address) || sessionRow(address)) {
			ids.push(address);
			continue;
		}
		throw new Error(`Nobody in your organization is named ${address}, and no session has that id.`);
	}
	return [...new Set(ids)].filter((id) => id !== self);
}

/** One person, by name in your organization or by session id; aliases such as my-team are refused. */
export function resolvePerson(self: string, address: string): string {
	if (address === "my-team") throw new Error("Name one person, not my-team.");
	const [id] = address === self ? [self] : resolveAddresses(self, [address]);
	if (!id) throw new Error(`Nobody to act on in ${address}.`);
	return id;
}
