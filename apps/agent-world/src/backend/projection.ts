// The world projection: who is a character, what role each has, and where each one is. Pure, so the rules read in
// one place; the backend feeds it rows from the session-state database and the wings it remembers.
import { basename } from "node:path";
import { type Character, type Headquarters, isOutside, type PlaceRef, type Role } from "../world.js";

/** One top-level session as the projection needs it. */
export interface SessionRow {
	id: string;
	name: string | null;
	cwd: string;
	/** The coordinator it reports to (`--reports-to`). */
	reportsTo: string | null;
	/** Its git repository (the main checkout's directory); null outside a repository. */
	repository: string | null;
	/** Started with `--coordinator`. */
	coordinatorFlag: boolean;
	/** Its current incarnation is alive. */
	awake: boolean;
	/** When it first started (ms), or undefined when it never had an incarnation. */
	firstStartedAt: number | undefined;
	/** When its current incarnation ended (ms); undefined while it runs or when unknown. */
	stoppedAt?: number;
}

/** A stopped session as the projection places it: asleep at the inn. */
export interface Sleeper {
	id: string;
	name: string;
	role: Role;
	startedAt: number;
	stoppedAt: number | null;
}

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

const byStart = (a: { firstStartedAt?: number; id: string }, b: { firstStartedAt?: number; id: string }) =>
	(a.firstStartedAt ?? Number.MAX_SAFE_INTEGER) - (b.firstStartedAt ?? Number.MAX_SAFE_INTEGER) ||
	(a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A coordinator was started with `--coordinator` or has a session reporting to it; a worker reports to one; any
 * other session is independent. Each awake coordinator, and each coordinator with an awake worker, has a
 * headquarters. Workers stand in the wing of their repository, or the common room outside one; independents stand
 * in the square. Dormant sessions sleep at the inn, the most recently stopped first, each in the role it had.
 */
export function projectWorld(sessions: SessionRow[], remembered: RememberedWings): Projection {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const coordinators = new Set<string>();
	for (const session of sessions) {
		if (session.coordinatorFlag) coordinators.add(session.id);
		if (session.reportsTo && session.reportsTo !== session.id) coordinators.add(session.reportsTo);
	}

	const roleOf = (session: SessionRow): Role =>
		coordinators.has(session.id)
			? "coordinator"
			: session.reportsTo && coordinators.has(session.reportsTo)
				? "worker"
				: "independent";
	const nameOf = (session: SessionRow) => session.name || basename(session.cwd) || session.id;
	const dormant: Sleeper[] = sessions
		.filter((session) => !session.awake)
		.sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0) || byStart(b, a))
		.map((session) => ({
			id: session.id,
			name: nameOf(session),
			role: roleOf(session),
			startedAt: session.firstStartedAt ?? 0,
			stoppedAt: session.stoppedAt ?? null,
		}));

	const awake = sessions.filter((session) => session.awake).sort(byStart);
	const characters: Character[] = awake.map((session) => {
		let role: Role;
		let place: PlaceRef;
		if (coordinators.has(session.id)) {
			role = "coordinator";
			place = { kind: "headquarters", headquarters: session.id };
		} else if (session.reportsTo && coordinators.has(session.reportsTo)) {
			role = "worker";
			place = session.repository
				? { kind: "wing", headquarters: session.reportsTo, repository: session.repository }
				: { kind: "common-room", headquarters: session.reportsTo };
		} else {
			role = "independent";
			place = { kind: "square" };
		}
		return {
			id: session.id,
			name: nameOf(session),
			role,
			place,
			startedAt: session.firstStartedAt ?? 0,
		};
	});

	const shown = new Set<string>();
	for (const { place } of characters) if (!isOutside(place)) shown.add(place.headquarters);
	const order = [...shown]
		.map((id) => ({ id, firstStartedAt: byId.get(id)?.firstStartedAt }))
		.sort(byStart)
		.map(({ id }) => id);

	const wings: RememberedWings = {};
	const headquarters = order.map((id): Headquarters => {
		const workers = characters.filter(
			(character) => character.place.kind === "wing" && character.place.headquarters === id,
		);
		const list = [...(remembered[id] ?? [])];
		for (const worker of workers) {
			const { repository } = worker.place as { repository: string };
			if (!list.includes(repository)) list.push(repository);
		}
		wings[id] = list;
		const coordinator = byId.get(id);
		return {
			id,
			name: coordinator ? coordinator.name || basename(coordinator.cwd) || id : id,
			wings: list.map((repository) => ({
				repository,
				name: basename(repository) || repository,
				headcount: workers.filter((worker) => (worker.place as { repository: string }).repository === repository)
					.length,
				dormant: sessions.filter(
					(session) => !session.awake && session.reportsTo === id && session.repository === repository,
				).length,
			})),
		};
	});
	return { headquarters, characters, wings, dormant };
}
