import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	BODY_CLEARANCE,
	clearanceAt,
	clearRun,
	findPath,
	type Grid,
	gridFor,
	isOpen,
	pathLength,
} from "../web/game/pathing.js";
import type { PlaceData, Point, Rect } from "../web/theme.js";

const fantasy = (name: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/fantasy/places/${name}.json`, import.meta.url)), "utf8"));

const room = (cols: number, rows: number, blocked: Rect[]): PlaceData => ({
	painting: "",
	cols,
	rows,
	blocked,
	spots: [],
	entries: {},
	doors: [],
	overlaySlots: [],
});

/** Every point along the path, every few hundredths of a tile. */
function samples(points: Point[]): Point[] {
	const out: Point[] = [];
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1];
		const [bx, by] = points[i];
		const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.02);
		for (let s = 0; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
	}
	return out;
}

/** No waypoint could be dropped: the run that skips it would pass closer to furniture than the path allows. */
function everyCornerNeeded(grid: Grid, points: Point[]) {
	const need = (p: Point) => Math.min(BODY_CLEARANCE, clearanceAt(grid, p));
	for (let i = 1; i < points.length - 1; i++)
		expect(
			clearRun(grid, points[i - 1], points[i + 1], need(points[i - 1]), need(points[i + 1])),
			`corner ${i} at ${points[i]}`,
		).toBe(false);
}

describe("paths over a walk grid", () => {
	it("crosses open floor in one straight run, ending exactly where clicked", () => {
		const grid = gridFor(room(20, 12, []));
		const path = findPath(grid, [2.3, 2.1], [17.7, 9.35]);
		expect(path?.points).toEqual([
			[2.3, 2.1],
			[17.7, 9.35],
		]);
	});

	it("goes round a wall through its gap down the middle, never entering a blocked cell", () => {
		// A wall across the room with a 2-tile gap at x 9..11.
		const grid = gridFor(
			room(20, 14, [
				[0, 6, 9, 1],
				[11, 6, 9, 1],
			]),
		);
		const path = findPath(grid, [3, 2], [16, 12])!;
		expect(path.goal).toEqual([16, 12]);
		for (const point of samples(path.points)) expect(isOpen(grid, point), `${point}`).toBe(true);
		// Through the gap's middle, a body's width from both sides.
		const atWall = samples(path.points).filter(([, y]) => y >= 6 && y <= 7);
		for (const [x] of atWall) expect(Math.min(x - 9, 11 - x)).toBeGreaterThanOrEqual(BODY_CLEARANCE - 1e-6);
		expect(path.points.length).toBeLessThanOrEqual(4);
		everyCornerNeeded(grid, path.points);
	});

	it("keeps a body's width from furniture along an aisle", () => {
		// Two long tables with a 2-tile aisle between them.
		const grid = gridFor(
			room(24, 10, [
				[2, 2, 20, 2],
				[2, 6, 20, 2],
			]),
		);
		const path = findPath(grid, [1, 5], [23, 5])!;
		for (const point of samples(path.points)) expect(clearanceAt(grid, point)).toBeGreaterThanOrEqual(0.9);
		everyCornerNeeded(grid, path.points);
	});

	it("squeezes through a gap narrower than a body's clearance instead of giving up", () => {
		// A 1-tile gap: clearance at its middle is 0.5; a 0.5-tile gap leaves only 0.25.
		const grid = gridFor(
			room(12, 10, [
				[0, 4, 6, 1],
				[6.5, 4, 5.5, 1],
			]),
		);
		const path = findPath(grid, [3, 1.5], [9, 8.5])!;
		expect(path.goal).toEqual([9, 8.5]);
		for (const point of samples(path.points)) expect(isOpen(grid, point), `${point}`).toBe(true);
	});

	it("walks to the nearest open floor when the click is on furniture", () => {
		const grid = gridFor(room(20, 12, [[8, 4, 4, 4]]));
		const path = findPath(grid, [2, 2], [10.2, 4.6])!;
		expect(isOpen(grid, path.goal)).toBe(true);
		// The nearest open cell to the click is just above the table, by the click's column.
		expect(path.goal).toEqual([10.25, 3.75]);
		for (const point of samples(path.points)) expect(isOpen(grid, point)).toBe(true);
	});

	it("walks to the nearest reachable floor when the click is in a closed-off area", () => {
		// A closed box from 10..16 x 3..9 (walls half a tile thick).
		const grid = gridFor(
			room(20, 12, [
				[10, 3, 6, 0.5],
				[10, 8.5, 6, 0.5],
				[10, 3, 0.5, 6],
				[15.5, 3, 0.5, 6],
			]),
		);
		const path = findPath(grid, [2, 6], [11.5, 6.1])!;
		expect(path.goal).toEqual([9.75, 6.25]);
	});

	it("leaves a footprint it starts inside, and picks the cheapest of several targets", () => {
		const grid = gridFor(room(20, 12, []), [[5, 5]]);
		expect(isOpen(grid, [5, 5])).toBe(false);
		const out = findPath(grid, [5, 5], [5, 9])!;
		expect(out.points[0]).toEqual([5, 5]);
		expect(out.goal).toEqual([5, 9]);
		const near = findPath(
			grid,
			[2, 2],
			[
				[18, 10],
				[3, 3],
			],
		)!;
		expect(near.goal).toEqual([3, 3]);
	});

	it("walks round someone standing in the open, and never ends on them", () => {
		const grid = gridFor(room(20, 12, []), [[10, 6]]);
		const path = findPath(grid, [4, 6], [16, 6])!;
		for (const point of samples(path.points)) expect(isOpen(grid, point), `${point}`).toBe(true);
		expect(findPath(grid, [4, 6], [10, 6])!.goal).not.toEqual([10, 6]);
		expect(isOpen(grid, findPath(grid, [4, 6], [10, 6])!.goal)).toBe(true);
	});

	it("squeezes past people standing in a narrow aisle rather than finding the room cut off", () => {
		// The large wing, full: people at the lower desks stand in the one-tile aisle along the south wall.
		const wing = fantasy("wing-large");
		const grid = gridFor(wing, wing.spots.slice(0, 12));
		for (const to of [
			[9.5, 9.5],
			[3.5, 15.8],
			[25.5, 12],
		] as Point[]) {
			const path = findPath(grid, wing.entries.gallery, to)!;
			expect(path.goal, `${to}`).toEqual(to);
			const static_ = gridFor(wing);
			for (const point of samples(path.points)) expect(isOpen(static_, point), `${to} at ${point}`).toBe(true);
		}
	});

	it("crosses the painted guild hall without entering furniture or zig-zagging", () => {
		const hall = fantasy("headquarters");
		const grid = gridFor(hall);
		const trips: [Point, Point][] = [
			[hall.entries.start, hall.doors[1].standAt], // to the gallery archway
			[hall.entries.square, hall.entries["common-room"]],
			[hall.entries["common-room"], hall.entries.gallery],
			[
				[3, 14.5],
				[25, 7.6],
			],
		];
		for (const [from, to] of trips) {
			const path = findPath(grid, from, to)!;
			expect(path.goal).toEqual(to);
			for (const point of samples(path.points)) expect(isOpen(grid, point), `${from}->${to} at ${point}`).toBe(true);
			everyCornerNeeded(grid, path.points);
			// Close to the straight-line distance: no detours.
			expect(pathLength(path.points)).toBeLessThan(Math.hypot(to[0] - from[0], to[1] - from[1]) * 1.35 + 1);
		}
	});

	it("walks through doorways and round corners without half-tile jogs", () => {
		// From every entry and door to every door and the place beside every spot, in the painted places: no run between
		// two corners is a sidestep of a cell or so.
		for (const name of ["headquarters", "common-room", "square", "inn", "wing-small", "wing-large"]) {
			const place = fantasy(name);
			const grid = gridFor(place);
			const starts: Point[] = [...Object.values(place.entries), ...place.doors.map((door) => door.standAt)];
			const goals: Point[] = [
				...place.spots.map(([x, y]): Point => [x + 1.1, y + 0.05]),
				...place.doors.map((door) => door.standAt),
			];
			for (const from of starts)
				for (const to of goals) {
					const points = findPath(grid, from, to)?.points ?? [];
					for (let i = 2; i < points.length - 1; i++)
						expect(
							pathLength([points[i - 1], points[i]]),
							`${name} ${from}->${to}: ${points.join(" | ")}`,
						).toBeGreaterThanOrEqual(0.6);
				}
		}
	});

	it("finds paths quickly enough to answer a click within a frame", () => {
		const square = fantasy("square");
		const grid = gridFor(square);
		const t = performance.now();
		for (let i = 0; i < 10; i++) findPath(grid, [2, 9], [43, 12]);
		// Well under the time a click can take before it feels late, with room for a loaded machine.
		expect((performance.now() - t) / 10).toBeLessThan(50);
	});
});
