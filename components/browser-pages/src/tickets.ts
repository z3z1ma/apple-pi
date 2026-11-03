import type { Ticket } from "./page-data.js";

const TICKET = /^tickets\/(\d+)[-_][^/]*\.md$/;
const REFERENCE = /(?:^|[,;([#]|\band\b|\btickets?\b)\s*(\d{1,3})(?=\s*[:(),;.\]]|\s*$|\s+and\b)/gi;
const NUMBER = /(?<![\w.])(\d{2,3})(?![\w.])/g;

export function ticketNumber(path: string): number | undefined {
	const match = TICKET.exec(path);
	return match ? Number(match[1]) : undefined;
}

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

export function ticketState(t: Ticket, all: Ticket[]): TicketState {
	if (isDone(t)) return "done";
	if (/progress/i.test(t.status)) return "progress";
	const ready = !t.unknown.length && t.blockers.every((b) => isDone(all.find((x) => x.id === b)));
	return ready ? "frontier" : "blocked";
}

const pad = (n: number) => String(n).padStart(2, "0");

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
