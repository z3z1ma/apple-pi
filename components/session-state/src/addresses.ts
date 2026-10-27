import { organizationOf, reportingOf } from "../../organization/src/directory.js";
import { OPERATOR } from "./threads.js";

/**
 * Turn addresses into session ids: `my-manager`, `my-team` (your reports, or your teammates under your manager when
 * you have none), a person's name in your organization, or any session id. Throws naming the address it cannot place.
 */
export function resolveAddresses(self: string, addresses: string[]): string[] {
	const members = organizationOf(self).members;
	const me = reportingOf(self);
	const ids: string[] = [];
	for (const raw of addresses) {
		const address = raw.trim();
		if (address.toLowerCase() === OPERATOR) {
			ids.push(OPERATOR);
			continue;
		}
		if (address === "my-manager") {
			if (!me?.reportsTo) throw new Error("You have no manager.");
			ids.push(me.reportsTo);
			continue;
		}
		if (address === "my-team") {
			const live = members.filter((member) => !member.retired);
			const reports = live.filter((member) => member.reportsTo === self);
			const team = reports.length
				? reports
				: live.filter((member) => me?.reportsTo && member.reportsTo === me.reportsTo);
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
		if (members.some((member) => member.id === address) || reportingOf(address)) {
			ids.push(address);
			continue;
		}
		throw new Error(`Nobody in your organization is named ${address}, and no session has that id.`);
	}
	return [...new Set(ids)].filter((id) => id !== self);
}

export function managerAddress(self: string): string {
	return reportingOf(self)?.reportsTo ?? OPERATOR;
}

/** One person, by name in your organization or by session id; aliases such as my-team are refused. */
export function resolvePerson(self: string, address: string): string {
	if (address.toLowerCase() === OPERATOR) throw new Error("The operator is a person, not a Pi session to manage.");
	if (address === "my-team") throw new Error("Name one person, not my-team.");
	const [id] = address === self ? [self] : resolveAddresses(self, [address]);
	if (!id) throw new Error(`Nobody to act on in ${address}.`);
	return id;
}
