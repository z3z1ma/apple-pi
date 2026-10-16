import type { Ticket } from "./page-data.js";

const TICKET = /^tickets\/(\d+)[-_][^/]*\.md$/;
/**
 * A number written as a ticket reference: it starts the line or a list item (`01: Title`, `01 (Title)`, `#01`, `[01](…)`,
 * `and 02`, `ticket 03`), not a phrase such as "Retry 408".
 */
const REFERENCE = /(?:^|[,;([#]|\band\b|\btickets?\b)\s*(\d{1,3})(?=\s*[:(),;.\]]|\s*$|\s+and\b)/gi;
/** Any two- or three-digit number, as ticket numbers are written (`01`, `12`); single digits are prose, such as "Phase 2". */
const NUMBER = /(?<![\w.])(\d{2,3})(?![\w.])/g;

/** The number of a `tickets/NN-slug.md` path, or undefined for any other file. */
export function ticketNumber(path: string): number | undefined {
	const match = TICKET.exec(path);
	return match ? Number(match[1]) : undefined;
}

/** The bundle's tickets, in number order, as their files state them. */
export function parseTickets(files: { path: string; source: string }[]): Ticket[] {
	const numbered = files.flatMap((f) => {
		const id = ticketNumber(f.path);
		return id === undefined ? [] : [{ ...f, id }];
	});
	const ids = new Set(numbered.map((f) => f.id));
	return numbered
		.map(({ path, source, id }) => {
			const heading = /^#\s+(.+)$/m.exec(source)?.[1] ?? path;
			const blockedBy = /\*\*Blocked by:\*\*\s*([^\n]*)/.exec(source)?.[1] ?? "";
			// A ticket of the bundle counts wherever its number appears; another number counts only where it reads as a
			// reference, so "Retry 408" in a title is not a missing ticket.
			const shaped = [...blockedBy.matchAll(REFERENCE)].map((m) => Number(m[1]));
			const known = [...blockedBy.matchAll(NUMBER)].map((m) => Number(m[1])).filter((n) => ids.has(n));
			const named = [...new Set([...shaped, ...known])];
			return {
				id,
				path,
				title: heading.replace(/^\d+\s*[:.\-–]\s*/, ""),
				status: (/\*\*Status:\*\*\s*([^\n]+)/.exec(source)?.[1] ?? "").trim().replace(/\.$/, ""),
				blockers: named.filter((n) => ids.has(n)),
				unknown: named.filter((n) => !ids.has(n)),
				done: (source.match(/^\s*[-*] \[x\]/gim) ?? []).length,
				total: (source.match(/^\s*[-*] \[[ x]\]/gim) ?? []).length,
			};
		})
		.sort((a, b) => a.id - b.id);
}

export type TicketState = "done" | "progress" | "frontier" | "blocked";

const isDone = (t: Ticket | undefined) => !!t && /^done$/i.test(t.status);

/** Done, in progress, ready to start (every blocker done), or blocked; a ticket waiting on a missing ticket is blocked. */
export function ticketState(t: Ticket, all: Ticket[]): TicketState {
	if (isDone(t)) return "done";
	if (/progress/i.test(t.status)) return "progress";
	const ready = !t.unknown.length && t.blockers.every((b) => isDone(all.find((x) => x.id === b)));
	return ready ? "frontier" : "blocked";
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Where the graph breaks the `to-tickets` rules: a blocker that is not a ticket here, a blocker numbered after its
 * dependent, a cycle, or no ticket that can start.
 */
export function graphProblems(tickets: Ticket[]): string[] {
	const problems: string[] = [];
	for (const t of tickets)
		for (const u of t.unknown) problems.push(`${pad(t.id)} waits on ${pad(u)}, which is not a ticket in this bundle.`);
	for (const t of tickets)
		for (const b of t.blockers)
			if (b > t.id) problems.push(`${pad(t.id)} waits on a later ticket, ${pad(b)}; blockers come first.`);
	const state = new Map<number, "open" | "closed">();
	const walk = (t: Ticket, path: number[]) => {
		state.set(t.id, "open");
		for (const b of t.blockers) {
			if (state.get(b) === "open") {
				const loop = [...path.slice(path.indexOf(b)), b];
				problems.push(
					loop.length === 2
						? `${pad(b)} waits on itself.`
						: `Cycle: ${loop.map(pad).join(" → ")}. None of these can start.`,
				);
			} else if (!state.has(b)) {
				const blocker = tickets.find((x) => x.id === b);
				if (blocker) walk(blocker, [...path, b]);
			}
		}
		state.set(t.id, "closed");
	};
	for (const t of tickets) if (!state.has(t.id)) walk(t, [t.id]);
	if (tickets.length && tickets.every((t) => t.blockers.length))
		problems.push("No ticket can start: every ticket waits on another.");
	return problems;
}
