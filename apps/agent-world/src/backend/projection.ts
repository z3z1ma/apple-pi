// The world projection: who is a character, what role each has, and where each one is. Pure, so the rules read in
// one place; the backend feeds it rows from the session-state database and the wings it remembers.
import { basename } from "node:path";
import type { Character, Headquarters, PlaceRef, Role } from "../world.js";

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
}

/** Remembered wings: repositories by coordinator id, in first-seen order. */
export type RememberedWings = Record<string, string[]>;

export interface Projection {
	headquarters: Headquarters[];
	characters: Character[];
	/** Each shown headquarters' wings, remembered ones first, then repositories seen for the first time. */
	wings: RememberedWings;
}

const byStart = (a: { firstStartedAt?: number; id: string }, b: { firstStartedAt?: number; id: string }) =>
	(a.firstStartedAt ?? Number.MAX_SAFE_INTEGER) - (b.firstStartedAt ?? Number.MAX_SAFE_INTEGER) ||
	(a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A coordinator was started with `--coordinator` or has a session reporting to it; a worker reports to one; any
 * other session is independent. Each awake coordinator, and each coordinator with an awake worker, has a
 * headquarters. Workers stand in the wing of their repository, or the common room outside one; independents stand
 * in the square. Dormant sessions are in no awake place.
 */
export function projectWorld(sessions: SessionRow[], remembered: RememberedWings): Projection {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const coordinators = new Set<string>();
	for (const session of sessions) {
		if (session.coordinatorFlag) coordinators.add(session.id);
		if (session.reportsTo && session.reportsTo !== session.id) coordinators.add(session.reportsTo);
	}

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
			name: session.name || basename(session.cwd) || session.id,
			role,
			place,
			startedAt: session.firstStartedAt ?? 0,
		};
	});

	const shown = new Set<string>();
	for (const character of characters) if (character.place.kind !== "square") shown.add(character.place.headquarters);
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
	return { headquarters, characters, wings };
}
