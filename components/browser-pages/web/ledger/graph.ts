import type { Ticket } from "../../src/page-data";

export const NODE = { w: 236, h: 108, gx: 76, gy: 16 };

export interface Edge {
	from: number;
	to: number;
	/** SVG path of the curve and of its arrowhead. */
	d: string;
	head: string;
	/** `bad` for an edge that runs backwards or to a later blocker; `done` once the blocker is done. */
	kind: "" | "done" | "bad";
}

/**
 * Places each ticket in a column by its dependency depth, ordering each column by where its blockers sit so edges
 * cross as little as possible. A cycle cannot be layered; its back edge loops under the graph.
 */
export function layout(tickets: Ticket[]) {
	const byId = new Map(tickets.map((t) => [t.id, t]));
	const depth = new Map<number, number>();
	const visiting = new Set<number>();
	const depthOf = (t: Ticket): number => {
		const known = depth.get(t.id);
		if (known !== undefined) return known;
		if (visiting.has(t.id)) return 0;
		visiting.add(t.id);
		const blockers = t.blockers.flatMap((b) => byId.get(b) ?? []);
		const d = blockers.length ? 1 + Math.max(...blockers.map(depthOf)) : 0;
		visiting.delete(t.id);
		depth.set(t.id, d);
		return d;
	};
	const columns: Ticket[][] = [];
	for (const t of tickets) {
		const d = depthOf(t);
		columns[d] = [...(columns[d] ?? []), t];
	}
	const rows = Math.max(0, ...columns.map((c) => c.length));
	const height = rows * NODE.h + Math.max(0, rows - 1) * NODE.gy;
	const pos = new Map<number, { x: number; y: number }>();
	columns.forEach((column, c) => {
		const y = (t: Ticket) => {
			const placed = t.blockers.flatMap((b) => pos.get(b)?.y ?? []);
			return placed.length ? placed.reduce((sum, v) => sum + v, 0) / placed.length : t.id;
		};
		const sorted = c > 0 ? [...column].sort((a, b) => y(a) - y(b) || a.id - b.id) : column;
		const h = sorted.length * NODE.h + (sorted.length - 1) * NODE.gy;
		for (const [r, t] of sorted.entries())
			pos.set(t.id, { x: c * (NODE.w + NODE.gx), y: (height - h) / 2 + r * (NODE.h + NODE.gy) });
	});
	const width = columns.length * NODE.w + Math.max(0, columns.length - 1) * NODE.gx;
	return { pos, width, height };
}

export function edges(tickets: Ticket[], pos: Map<number, { x: number; y: number }>): Edge[] {
	const done = (id: number) => /^done$/i.test(tickets.find((t) => t.id === id)?.status ?? "");
	return tickets.flatMap((t) =>
		t.blockers.flatMap((b) => {
			const p = pos.get(b);
			const q = pos.get(t.id);
			if (!p || !q) return [];
			const x1 = p.x + NODE.w;
			const y1 = p.y + NODE.h / 2;
			const x2 = q.x;
			const y2 = q.y + NODE.h / 2;
			const back = x2 <= x1;
			const d = back
				? `M ${x1} ${y1} C ${x1 + 60} ${y1 + 120}, ${x2 - 60} ${y2 + 120}, ${x2} ${y2}`
				: `M ${x1} ${y1} C ${x1 + NODE.gx / 2} ${y1}, ${x2 - NODE.gx / 2} ${y2}, ${x2 - 6} ${y2}`;
			const head = `M ${x2 - 7} ${y2 - 4.5} L ${x2} ${y2} L ${x2 - 7} ${y2 + 4.5} Z`;
			const kind = back || b > t.id ? "bad" : done(b) ? "done" : "";
			return [{ from: b, to: t.id, d, head, kind } satisfies Edge];
		}),
	);
}

/** Every ticket `id` waits on, directly or not, and every ticket that waits on it; `id` is in both. */
export function chain(tickets: Ticket[], id: number): { up: Set<number>; down: Set<number> } {
	const up = new Set([id]);
	const down = new Set([id]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const t of tickets) {
			if (up.has(t.id))
				for (const b of t.blockers)
					if (!up.has(b)) {
						up.add(b);
						grew = true;
					}
			if (!down.has(t.id) && t.blockers.some((b) => down.has(b))) {
				down.add(t.id);
				grew = true;
			}
		}
	}
	return { up, down };
}
