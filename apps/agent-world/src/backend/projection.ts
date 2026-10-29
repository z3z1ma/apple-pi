// The world projection: who is a character, what role each has, and where each one is. Pure, so the rules read in
// one place; the backend feeds it rows from the session-state database and the wings it remembers.
import { basename } from "node:path";
import { type Character, type Headquarters, isOutside, type PlaceRef, type Role, type Workplace } from "../world.js";

/** One top-level session as the projection needs it. */
export interface SessionRow {
	id: string;
	name: string | null;
	cwd: string;
	/** The coordinator it reports to (`--reports-to`). */
	reportsTo: string | null;
	/** Its git repository (the main checkout's directory); null outside a repository. */
	repository: string | null;
	/** Holds a managing role (its `manages` fact). */
	manages: boolean;
	/** The title of its role, or null without one. */
	title: string | null;
	/** Retired: it left the organization. */
	retiredAt: number | null;
	retiredReason: string | null;
	/** Its current incarnation is alive. */
	awake: boolean;
	/** When it first started (ms), or undefined when it never had an incarnation. */
	firstStartedAt: number | undefined;
	hiredAt?: number | null;
	/** When its current incarnation ended (ms); undefined while it runs or when unknown. */
	stoppedAt?: number;
}

/** A stopped session as the projection places it: asleep at the inn. */
export interface Sleeper {
	id: string;
	name: string;
	role: Role;
	title: string | null;
	hiredAt?: number | null;
	startedAt: number;
	stoppedAt: number | null;
	retiredAt: number | null;
	retiredReason: string | null;
}

/** The key of a manager's team room among a headquarters' wings. */
export const teamRoom = (manager: string) => `team:${manager}`;

/** Remembered wings: repositories by coordinator id, in first-seen order. */
export type RememberedWings = Record<string, string[]>;

export interface Projection {
	headquarters: Headquarters[];
	characters: Character[];
	/** Each shown headquarters' wings, remembered ones first, then repositories seen for the first time. */
	wings: RememberedWings;
	/** Stopped sessions, asleep at the inn: the most recently stopped first. */
	dormant: Sleeper[];
}

/** The organization each person belongs to, including sleepers; missing parents and cycles end the walk. */
export function organizationRoots(people: { id: string; reportsTo: string | null }[]): Map<string, string> {
	const parents = new Map(people.map((person) => [person.id, person.reportsTo]));
	return new Map(
		people.map(({ id }) => {
			const seen = new Set<string>([id]);
			let root = id;
			for (
				let parent = parents.get(root);
				parent && parents.has(parent) && !seen.has(parent);
				parent = parents.get(root)
			) {
				seen.add(parent);
				root = parent;
			}
			return [id, root];
		}),
	);
}

const byStart = (a: { firstStartedAt?: number; id: string }, b: { firstStartedAt?: number; id: string }) =>
	(a.firstStartedAt ?? Number.MAX_SAFE_INTEGER) - (b.firstStartedAt ?? Number.MAX_SAFE_INTEGER) ||
	(a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The organization is a tree of managers: a session reports to the one named by `reportsTo`, and the tree ends at a
 * root. A root with a managing role or anyone under it (awake or asleep) is a coordinator and keeps the headquarters,
 * standing in its hall; a person it manages directly stands in the wing of its repository, or the common room outside
 * one; a manager below the root, and everyone reporting to that manager, stand in the manager's team room off the same
 * headquarters. A root with nobody under it and no managing role is independent, in the square. Dormant sessions
 * sleep at the inn, the most recently stopped first, each in the role it had, a retired one marked so.
 */
export function projectWorld(sessions: SessionRow[], remembered: RememberedWings): Projection {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const managerOf = (session: SessionRow) =>
		session.reportsTo && session.reportsTo !== session.id && byId.has(session.reportsTo)
			? byId.get(session.reportsTo)!
			: undefined;
	const roots = organizationRoots(sessions);
	const rootOf = (session: SessionRow): SessionRow => byId.get(roots.get(session.id)!)!;
	const managers = new Set<string>();
	for (const session of sessions) {
		if (session.manages) managers.add(session.id);
		const manager = managerOf(session);
		if (manager) managers.add(manager.id);
	}

	const roleOf = (session: SessionRow): Role =>
		managers.has(session.id) ? "coordinator" : managerOf(session) ? "worker" : "independent";
	const nameOf = (session: SessionRow) => session.name || basename(session.cwd) || session.id;
	/** Where a session stands or would stand: a root in its hall, a direct report of the root in a repository wing or the common room, anyone else in its nearest manager's team room. */
	const placeOf = (session: SessionRow): PlaceRef => {
		const manager = managerOf(session);
		if (!manager)
			return managers.has(session.id) ? { kind: "headquarters", headquarters: session.id } : { kind: "square" };
		const root = rootOf(session);
		if (manager.id === root.id) {
			if (managers.has(session.id)) return { kind: "wing", headquarters: root.id, repository: teamRoom(session.id) };
			return session.repository
				? { kind: "wing", headquarters: root.id, repository: session.repository }
				: { kind: "common-room", headquarters: root.id };
		}
		const room = managers.has(session.id) ? session.id : manager.id;
		return { kind: "wing", headquarters: root.id, repository: teamRoom(room) };
	};

	const dormant: Sleeper[] = sessions
		.filter((session) => !session.awake)
		.sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0) || byStart(b, a))
		.map((session) => ({
			id: session.id,
			name: nameOf(session),
			role: roleOf(session),
			title: session.title,
			hiredAt: session.hiredAt ?? null,
			startedAt: session.firstStartedAt ?? 0,
			stoppedAt: session.stoppedAt ?? null,
			retiredAt: session.retiredAt,
			retiredReason: session.retiredReason,
		}));

	const awake = sessions.filter((session) => session.awake).sort(byStart);
	const characters: Character[] = awake.map((session) => ({
		id: session.id,
		name: nameOf(session),
		role: roleOf(session),
		place: placeOf(session),
		hiredAt: session.hiredAt ?? null,
		startedAt: session.firstStartedAt ?? 0,
	}));

	const shown = new Set<string>();
	for (const { place } of characters) if (!isOutside(place)) shown.add(place.headquarters);
	const order = [...shown]
		.map((id) => ({ id, firstStartedAt: byId.get(id)?.firstStartedAt }))
		.sort(byStart)
		.map(({ id }) => id);

	const wings: RememberedWings = {};
	const headquarters = order.map((id): Headquarters => {
		const inRooms = characters.filter(
			(character) => character.place.kind === "wing" && character.place.headquarters === id,
		);
		const inRoom = (repository: string) =>
			inRooms.filter((character) => (character.place as { repository: string }).repository === repository);
		// Team rooms exist while their manager is in the organization, awake or asleep; repository wings are remembered.
		const teams = sessions
			.filter(
				(session) => managers.has(session.id) && !session.retiredAt && rootOf(session).id === id && session.id !== id,
			)
			.sort(byStart);
		const list = [...(remembered[id] ?? [])];
		for (const character of inRooms) {
			const { repository } = character.place as { repository: string };
			if (!repository.startsWith("team:") && !list.includes(repository)) list.push(repository);
		}
		if (list.length) wings[id] = list;
		const coordinator = byId.get(id);
		const dormantIn = (test: (session: SessionRow) => boolean) =>
			sessions.filter((session) => !session.awake && !session.retiredAt && test(session)).length;
		return {
			id,
			name: coordinator ? coordinator.name || basename(coordinator.cwd) || id : id,
			wings: [
				...list.map((repository) => ({
					repository,
					name: basename(repository) || repository,
					headcount: inRoom(repository).length,
					dormant: dormantIn((session) => session.reportsTo === id && session.repository === repository),
				})),
				...teams.map((manager) => ({
					repository: teamRoom(manager.id),
					team: manager.id,
					name: nameOf(manager),
					headcount: inRoom(teamRoom(manager.id)).length,
					dormant: dormantIn(
						(session) =>
							(session.id === manager.id || session.reportsTo === manager.id) &&
							(placeOf(session) as { repository?: string }).repository === teamRoom(manager.id),
					),
				})),
			],
		};
	});
	return { headquarters, characters, wings, dormant };
}

/** Meetings and escalations change where a person is drawn, not its role, manager, or assignments. */
export function placeWorkplace(world: Projection, sessions: SessionRow[], workplace: Workplace): Projection {
	const people = new Map(sessions.map((person) => [person.id, person]));
	const headquarters = new Map(world.headquarters.map((hq) => [hq.id, hq]));
	const roomFor = (id: string) => {
		const owner = people.get(id);
		if (!owner) return false;
		if (!headquarters.has(id)) headquarters.set(id, { id, name: owner.name || basename(owner.cwd) || id, wings: [] });
		return true;
	};
	// Work keeps its board reachable even when its whole organization sleeps.
	for (const task of workplace.tasks) roomFor(task.headquarters);
	const places = new Map<string, PlaceRef>();
	for (const meeting of [...workplace.threads].sort(
		(a, b) => b.lastSeq - a.lastSeq || b.lastAt - a.lastAt || a.id.localeCompare(b.id),
	)) {
		if (meeting.kind !== "meeting" || meeting.closed || !roomFor(meeting.headquarters)) continue;
		for (const person of meeting.participants)
			if (!places.has(person)) places.set(person, { kind: "meeting-room", headquarters: meeting.headquarters });
	}
	for (const escalation of workplace.escalations)
		if (roomFor(escalation.headquarters))
			places.set(escalation.person, { kind: "headquarters", headquarters: escalation.headquarters });
	return {
		...world,
		headquarters: [...headquarters.values()],
		characters: world.characters.map((person) =>
			places.has(person.id) ? { ...person, place: places.get(person.id)! } : person,
		),
	};
}
