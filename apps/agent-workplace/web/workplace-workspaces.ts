import { createContext, useSyncExternalStore } from "react";
import type { WorldSnapshot } from "../src/world.js";
import { organizationName } from "./workplace-names.js";
import { descendants, orgPeople } from "./workplace-org.js";

export type Workspace = { id: string; name: string; members: Set<string> };

export const WorkspaceContext = createContext<{ current?: Workspace; all: Workspace[] }>({ all: [] });

const storageKey = "workplace-workspace";
const listeners = new Set<() => void>();
let chosen = read();

function read(): string | null {
	try {
		return localStorage.getItem(storageKey);
	} catch {
		return null;
	}
}

export function chooseWorkspace(id: string): void {
	chosen = id;
	try {
		localStorage.setItem(storageKey, id);
	} catch {}
	for (const listener of listeners) listener();
}

export function useChosenWorkspace(): string | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => chosen,
	);
}

function parentsOf(world: WorldSnapshot): Map<string, string | null> {
	const parents = new Map<string, string | null>();
	for (const person of world.dormant ?? []) parents.set(person.id, person.reportsTo);
	for (const person of world.characters) parents.set(person.id, person.facts?.reportsTo ?? null);
	return parents;
}

export function workspaces(world: WorldSnapshot): Workspace[] {
	const people = orgPeople(world);
	const lasting = new Set(people.map((person) => person.character.id));
	const parents = parentsOf(world);
	for (const person of people) if (person.parent && !lasting.has(person.parent)) parents.set(person.character.id, null);
	const size = (workspace: Workspace) => [...workspace.members].filter((id) => lasting.has(id)).length;
	return people
		.filter((person) => !person.parent || !lasting.has(person.parent))
		.map((root) => ({
			id: root.character.id,
			name: organizationName(root.character.id, root.character.name),
			members: new Set(descendants(root.character.id, parents)),
		}))
		.sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name));
}

export function currentWorkspace(all: Workspace[], id: string | null): Workspace | undefined {
	return all.find((workspace) => workspace.id === id) ?? all[0];
}

export function workspaceOf(all: Workspace[], person: string): Workspace | undefined {
	return all.find((workspace) => workspace.members.has(person));
}

function touches(members: Set<string>, people: (string | null | undefined)[]): boolean {
	return people.some((person) => !!person && members.has(person));
}

function belongs(members: Set<string>, people: (string | null | undefined)[]): boolean {
	const named = people.filter((person) => !!person && person !== "operator" && person !== "harness");
	return !named.length || touches(members, named);
}

function headOf(id: string): string | undefined {
	return /^(?:organization|team):(.+)$/.exec(id)?.[1];
}

export function scopeWorld(world: WorldSnapshot, workspace: Workspace | undefined): WorldSnapshot {
	if (!workspace) return world;
	const { members } = workspace;
	const channels = new Set<string>();
	const workplace = world.workplace && {
		...world.workplace,
		threads: world.workplace.threads.filter((thread) => {
			const inside =
				thread.id === world.desk?.thread ||
				belongs(members, [thread.scopeHead, headOf(thread.id), thread.createdBy, ...thread.participants]);
			if (inside) channels.add(thread.id);
			return inside;
		}),
		tasks: world.workplace.tasks.filter(
			(task) =>
				members.has(task.headquarters) ||
				touches(
					members,
					task.assignees.map((each) => each.person),
				),
		),
		escalations: world.workplace.escalations.filter((escalation) => members.has(escalation.person)),
		workHistory: world.workplace.workHistory?.filter(
			(task) =>
				members.has(task.headquarters) ||
				touches(
					members,
					task.participants.map((each) => each.person),
				),
		),
	};
	return {
		...world,
		characters: world.characters.filter((person) => members.has(person.id)),
		dormant: world.dormant?.filter((person) => members.has(person.id)),
		mail: world.mail?.filter((item) => belongs(members, [item.from, item.to])),
		operatorMail: world.operatorMail?.filter(
			(thread) => channels.has(thread.id) || belongs(members, thread.participants ?? []),
		),
		...(workplace ? { workplace } : {}),
	};
}

export function workspaceUnread(world: WorldSnapshot, workspace: Workspace): number {
	const scoped = scopeWorld(world, workspace);
	return (
		scoped.characters.filter((person) => person.facts?.unseen).length +
		(scoped.operatorMail ?? []).reduce((sum, thread) => sum + thread.unread, 0)
	);
}
