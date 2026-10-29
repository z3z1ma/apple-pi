import { useSyncExternalStore } from "react";
import type { WorldSnapshot } from "../src/world.js";

const storageKey = "workplace-organization-names";
function readNames(): Record<string, string> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
			),
		);
	} catch {
		return {};
	}
}
let names = readNames();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
export function useWorkplaceNames() {
	return useSyncExternalStore(subscribe, () => names);
}
export function organizationName(id: string, personName: string, defaultName = `${personName} organization`): string {
	return Object.hasOwn(names, id) ? names[id] : defaultName;
}
export function saveOrganizationName(id: string, value: string): void {
	const next = { ...names };
	if (value.trim()) next[id] = value.trim();
	else delete next[id];
	localStorage.setItem(storageKey, JSON.stringify(next));
	names = next;
	for (const listener of listeners) listener();
}
export function channelName(id: string, fallback: string, world: WorldSnapshot): string {
	const match = /^(organization|team):(.+)$/.exec(id);
	if (!match) return fallback;
	const personId = match[2];
	const personName =
		world.characters.find((person) => person.id === personId)?.name ??
		world.dormant?.find((person) => person.id === personId)?.name ??
		world.headquarters.find((team) => team.id === personId)?.name;
	const value = Object.hasOwn(names, personId) ? names[personId] : personName;
	if (!value) return fallback;
	const slug = value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return slug ? `${match[1] === "organization" ? "org" : "team"}-${slug}` : id;
}
