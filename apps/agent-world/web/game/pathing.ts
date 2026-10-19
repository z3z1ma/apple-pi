// Click-to-walk paths over a place's half-tile walk grid: A* that prefers the middle of aisles, then string-pulled
// into straight runs that keep a body's width from furniture wherever the floor allows it. Pure, so it is tested
// directly; coordinates are in tiles (fractions allowed), like the place data.
import type { PlaceData, Point } from "../theme.js";
import { walkGrid } from "./layout.js";

/** Cells per tile: the walk grid is twice as fine as the tiles. */
const CELLS = 2;
const CELL = 1 / CELLS;
/** A body's half-width plus a margin: a straight run keeps this far from blocked cells where the floor allows. */
export const BODY_CLEARANCE = 0.5;
/** How far from furniture A* prefers to walk, so the raw path already runs down the middle of aisles. */
const PREFERRED_CLEARANCE = 0.8;
/** Extra cost per step at zero clearance, falling to none at the preferred clearance. */
const HUG_COST = 2.5;
/**
 * A step through someone's footprint costs this many times more: the walk goes round people where there is room,
 * and squeezes past them only where they stand in the way (a character in a narrow aisle never cuts a room off).
 */
const PAST_SOMEONE = 8;
/** Clearance is measured only this far; beyond it, the floor is simply open. */
const CLEARANCE_CAP = 1.5;
const SAMPLE = 0.08; // tiles between clearance samples along a straight run
const SQRT2 = Math.SQRT2;

export interface Grid {
	cols: number;
	rows: number;
	/** Furniture and walls, traced in the place data: never walked on. */
	blocked: Uint8Array;
	/** Characters' footprints: walked round, or through only when there is no other way, and never stopped on. */
	occupied: Uint8Array;
	/** Distance in tiles from each cell's centre to the nearest blocked cell or the edge, capped. */
	clearance: Float32Array;
}

/** A place's walk grid, with other characters standing at `occupants` (their feet), each covering its own footprint. */
export function gridFor(place: PlaceData, occupants: Point[] = []): Grid {
	const base = walkGrid(place);
	const blocked = Uint8Array.from(base.blocked, (b) => (b ? 1 : 0));
	const occupied = new Uint8Array(blocked.length);
	for (const [x, y] of occupants)
		for (const cell of footprint(x, y, base.cols, base.rows)) occupied[cell] = blocked[cell] ? 0 : 1;
	return withClearance({ cols: base.cols, rows: base.rows, blocked, occupied, clearance: new Float32Array(0) });
}

/** The cells a standing character's feet cover: those whose centres lie within half a tile across, a third deep. */
function footprint(x: number, y: number, cols: number, rows: number): number[] {
	const cells: number[] = [];
	for (let row = Math.floor((y - 0.35) * CELLS); row <= Math.floor((y + 0.35) * CELLS); row++)
		for (let col = Math.floor((x - 0.5) * CELLS); col <= Math.floor((x + 0.5) * CELLS); col++) {
			if (row < 0 || col < 0 || row >= rows || col >= cols) continue;
			const cx = (col + 0.5) * CELL;
			const cy = (row + 0.5) * CELL;
			if (Math.abs(cx - x) < 0.45 && Math.abs(cy - y) < 0.3) cells.push(row * cols + col);
		}
	return cells;
}

function withClearance(grid: Grid): Grid {
	const clearance = new Float32Array(grid.cols * grid.rows);
	for (let row = 0; row < grid.rows; row++)
		for (let col = 0; col < grid.cols; col++)
			clearance[row * grid.cols + col] = taken(grid, row * grid.cols + col)
				? 0
				: distance(grid, [(col + 0.5) * CELL, (row + 0.5) * CELL], true);
	grid.clearance = clearance;
	return grid;
}

export const cellOf = (grid: Grid, [x, y]: Point): number => {
	const col = Math.floor(x * CELLS);
	const row = Math.floor(y * CELLS);
	return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col;
};

const centre = (grid: Grid, cell: number): Point => [
	((cell % grid.cols) + 0.5) * CELL,
	(Math.floor(cell / grid.cols) + 0.5) * CELL,
];

/** Whether a cell has furniture or someone standing on it. */
const taken = (grid: Grid, cell: number): boolean => grid.blocked[cell] === 1 || grid.occupied[cell] === 1;

/** Open floor: no furniture, and nobody standing there. */
export const isOpen = (grid: Grid, point: Point): boolean => {
	const cell = cellOf(grid, point);
	return cell >= 0 && !taken(grid, cell);
};

/** Distance in tiles from `point` to the nearest furniture or the place's edge, capped at CLEARANCE_CAP. */
export function clearanceAt(grid: Grid, point: Point): number {
	return distance(grid, point, false);
}

/** Whether `point` is inside someone's footprint. */
const pastSomeone = (grid: Grid, point: Point): boolean => {
	const cell = cellOf(grid, point);
	return cell >= 0 && grid.occupied[cell] === 1;
};

/** Distance in tiles from `point` to the nearest furniture (and with `people`, footprint) or the edge, capped. */
function distance(grid: Grid, [x, y]: Point, people: boolean): number {
	let best = Math.min(CLEARANCE_CAP, x, y, grid.cols * CELL - x, grid.rows * CELL - y);
	if (best <= 0) return 0;
	const reach = Math.ceil(best * CELLS);
	const col0 = Math.floor(x * CELLS);
	const row0 = Math.floor(y * CELLS);
	for (let row = Math.max(0, row0 - reach); row <= Math.min(grid.rows - 1, row0 + reach); row++)
		for (let col = Math.max(0, col0 - reach); col <= Math.min(grid.cols - 1, col0 + reach); col++) {
			const cell = row * grid.cols + col;
			if (!grid.blocked[cell] && !(people && grid.occupied[cell])) continue;
			const dx = Math.max(col * CELL - x, 0, x - (col + 1) * CELL);
			const dy = Math.max(row * CELL - y, 0, y - (row + 1) * CELL);
			const d = Math.hypot(dx, dy);
			if (d < best) {
				best = d;
				if (best === 0) return 0;
			}
		}
	return best;
}

const NEIGHBOURS: [number, number, number][] = [
	[1, 0, 1],
	[-1, 0, 1],
	[0, 1, 1],
	[0, -1, 1],
	[1, 1, SQRT2],
	[1, -1, SQRT2],
	[-1, 1, SQRT2],
	[-1, -1, SQRT2],
];

/** A binary min-heap of cells keyed by priority. */
class Heap {
	private cells: number[] = [];
	private keys: number[] = [];
	get size() {
		return this.cells.length;
	}
	push(cell: number, key: number) {
		const cells = this.cells;
		const keys = this.keys;
		let i = cells.length;
		cells.push(cell);
		keys.push(key);
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (keys[parent] <= key) break;
			cells[i] = cells[parent];
			keys[i] = keys[parent];
			i = parent;
		}
		cells[i] = cell;
		keys[i] = key;
	}
	pop(): number {
		const cells = this.cells;
		const keys = this.keys;
		const top = cells[0];
		const lastCell = cells.pop()!;
		const lastKey = keys.pop()!;
		if (cells.length) {
			let i = 0;
			for (;;) {
				const left = 2 * i + 1;
				if (left >= cells.length) break;
				const child = left + 1 < cells.length && keys[left + 1] < keys[left] ? left + 1 : left;
				if (keys[child] >= lastKey) break;
				cells[i] = cells[child];
				keys[i] = keys[child];
				i = child;
			}
			cells[i] = lastCell;
			keys[i] = lastKey;
		}
		return top;
	}
}

/**
 * A* from `start` (a free cell) over 8 neighbours, never cutting a blocked corner. Steps near furniture cost more, so
 * the path keeps to the middle of aisles. With `goal`, it stops there; without, it floods every reachable cell.
 */
function search(grid: Grid, start: number, goal?: number): { cost: Float64Array; parent: Int32Array } {
	const n = grid.cols * grid.rows;
	const cost = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
	const parent = new Int32Array(n).fill(-1);
	const done = new Uint8Array(n);
	const [gx, gy] = goal === undefined ? [0, 0] : [goal % grid.cols, Math.floor(goal / grid.cols)];
	const h = (cell: number) => {
		if (goal === undefined) return 0;
		const dx = Math.abs((cell % grid.cols) - gx);
		const dy = Math.abs(Math.floor(cell / grid.cols) - gy);
		return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * CELL;
	};
	const open = new Heap();
	cost[start] = 0;
	open.push(start, h(start));
	while (open.size) {
		const cell = open.pop();
		if (done[cell]) continue;
		done[cell] = 1;
		if (cell === goal) break;
		const col = cell % grid.cols;
		const row = Math.floor(cell / grid.cols);
		for (const [dx, dy, length] of NEIGHBOURS) {
			const nc = col + dx;
			const nr = row + dy;
			if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
			const next = nr * grid.cols + nc;
			if (grid.blocked[next] || done[next]) continue;
			if (dx && dy && (grid.blocked[row * grid.cols + nc] || grid.blocked[nr * grid.cols + col])) continue;
			const hug = Math.max(0, PREFERRED_CLEARANCE - grid.clearance[next]) / PREFERRED_CLEARANCE;
			const step = length * CELL * (1 + HUG_COST * hug) * (grid.occupied[next] ? PAST_SOMEONE : 1);
			if (cost[cell] + step < cost[next]) {
				cost[next] = cost[cell] + step;
				parent[next] = cell;
				open.push(next, cost[next] + h(next));
			}
		}
	}
	return { cost, parent };
}

/** The cell without furniture nearest `point` (by straight distance), so a walk can start from off the floor. */
function nearestFree(grid: Grid, point: Point): number {
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let cell = 0; cell < grid.blocked.length; cell++) {
		if (grid.blocked[cell]) continue;
		const [cx, cy] = centre(grid, cell);
		const d = Math.hypot(cx - point[0], cy - point[1]);
		if (d < bestDistance) {
			bestDistance = d;
			best = cell;
		}
	}
	return best;
}

export interface Path {
	/** Waypoints from the start (included) to the goal (included): straight runs between them. */
	points: Point[];
	/** Where the walk ends: the clicked point when it is open floor, or the nearest open floor reachable. */
	goal: Point;
}

/**
 * The walk from `from` to `to`, or to whichever of several targets is cheapest to reach (a character's stand points).
 * An open, reachable target is reached exactly; when none is (furniture, or out of reach), the walk ends at the centre
 * of the reachable cell nearest the first target. Undefined only when there is no open floor at all.
 */
export function findPath(grid: Grid, from: Point, to: Point | Point[]): Path | undefined {
	const targets = (Array.isArray(to[0]) ? to : [to]) as Point[];
	const fromCell = cellOf(grid, from);
	const startCell = fromCell >= 0 && !grid.blocked[fromCell] ? fromCell : nearestFree(grid, from);
	if (startCell < 0 || targets.length === 0) return undefined;
	const goals = targets
		.map((point) => ({ point, cell: cellOf(grid, point) }))
		.filter(({ cell }) => cell >= 0 && !taken(grid, cell));
	let found = search(grid, startCell, goals.length === 1 ? goals[0].cell : undefined);
	let goal: { point: Point; cell: number } | undefined;
	for (const candidate of goals)
		if (Number.isFinite(found.cost[candidate.cell]) && (!goal || found.cost[candidate.cell] < found.cost[goal.cell]))
			goal = candidate;
	if (!goal) {
		// Furniture or out of reach: flood what is reachable, and go to the cell nearest the (first) target.
		if (goals.length === 1) found = search(grid, startCell);
		const [tx, ty] = targets[0];
		let best = startCell;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let cell = 0; cell < found.cost.length; cell++) {
			if (!Number.isFinite(found.cost[cell]) || grid.occupied[cell]) continue;
			const [cx, cy] = centre(grid, cell);
			const d = Math.hypot(cx - tx, cy - ty);
			if (d < bestDistance - 1e-9) {
				bestDistance = d;
				best = cell;
			}
		}
		goal = { cell: best, point: centre(grid, best) };
	}
	return pathFrom(grid, found.parent, startCell, from, goal);
}

function pathFrom(
	grid: Grid,
	parent: Int32Array,
	startCell: number,
	from: Point,
	goal: { point: Point; cell: number },
) {
	const cells: number[] = [];
	for (let cell = goal.cell; cell !== -1 && cell !== startCell; cell = parent[cell]) cells.push(cell);
	cells.reverse();
	// The raw path: the exact start, the cells' centres in between, the exact goal.
	const raw: Point[] = [from];
	if (cellOf(grid, from) !== startCell) raw.push(centre(grid, startCell));
	for (const cell of cells.slice(0, -1)) raw.push(centre(grid, cell));
	raw.push(goal.point);
	return { points: pull(grid, raw), goal: goal.point };
}

/**
 * String-pulling with clearance: from each waypoint, run straight to the farthest later waypoint whose straight line
 * keeps clear of furniture. Along the line, the floor must be as clear as a body needs, or, where the raw path itself
 * squeezes by something (a gap between desks, a start beside a table), as clear as the raw path is at the line's two
 * ends, blended between them.
 */
export function pull(grid: Grid, raw: Point[]): Point[] {
	if (raw.length <= 2) return dedupe(raw);
	const need = raw.map((point) => Math.min(BODY_CLEARANCE, clearanceAt(grid, point)));
	const squeeze = raw.map((point) => pastSomeone(grid, point));
	const out: Point[] = [raw[0]];
	let anchor = 0;
	while (anchor < raw.length - 1) {
		let next = anchor + 1;
		let misses = 0;
		let squeezing = squeeze[anchor];
		for (let j = anchor + 2; j < raw.length; j++) {
			squeezing ||= squeeze[j - 1] || squeeze[j];
			if (clearRun(grid, raw[anchor], raw[j], need[anchor], need[j], squeezing)) {
				next = j;
				misses = 0;
			} else if (++misses > 8) break;
		}
		out.push(raw[next]);
		anchor = next;
	}
	return dedupe(out);
}

/**
 * Whether a straight walk from `a` to `b` keeps the blended clearance `needA`..`needB` from furniture, and passes
 * nobody's footprint unless the walk it replaces squeezes past someone there too.
 */
export function clearRun(grid: Grid, a: Point, b: Point, needA: number, needB: number, squeezing = false): boolean {
	const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const steps = Math.max(1, Math.ceil(length / SAMPLE));
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const point: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
		const need = Math.max(1e-3, needA + (needB - needA) * t) - 1e-6;
		if (clearanceAt(grid, point) < need) return false;
		if (!squeezing && pastSomeone(grid, point)) return false;
	}
	return true;
}

function dedupe(points: Point[]): Point[] {
	return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6);
}

/** The total length of a path, in tiles. */
export const pathLength = (points: Point[]): number =>
	points.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0), 0);
