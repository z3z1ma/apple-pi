// Where things go in a place: which painting and data a place uses, the gallery cut to its number of wings, the walk
// grid, and which spot each character stands on. Pure, so the scene only draws.
import type { Character, Headquarters, PlaceRef, Wing, WorldSnapshot } from "../../src/world.js";
import { placeKey } from "../../src/world.js";
import type { PlaceData, Point, Rect, Theme } from "../theme.js";

/** A vertical strip of the painting, in tiles: source columns `from`..`to`, drawn starting at `at`. */
export interface Strip {
	from: number;
	to: number;
	at: number;
}

/** A wing door in the gallery, in the composed place's tiles. */
export interface NicheDoor {
	wing: Wing;
	/** The niche's centre. */
	x: number;
}

/** A place ready to draw: its data in its own tiles, and for the gallery, how the painting is cut. */
export interface Layout {
	ref: PlaceRef;
	key: string;
	/** The data file it uses, such as `wing-large`. */
	data: string;
	place: PlaceData;
	title: string;
	subtitle?: string;
	strips?: Strip[];
	niches?: NicheDoor[];
	/** Changes when the place must be laid out again (a wing added, boarded, or outgrowing the small room). */
	signature: string;
}

const clipRect = ([x, y, w, h]: Rect, strip: Strip): Rect | undefined => {
	const from = Math.max(x, strip.from);
	const to = Math.min(x + w, strip.to);
	return to > from ? [from - strip.from + strip.at, y, to - from, h] : undefined;
};

const inStrip = (x: number, strip: Strip, last: boolean) =>
	x >= strip.from && (x < strip.to || (last && x <= strip.to));
const shift = ([x, y]: Point, strip: Strip): Point => [x - strip.from + strip.at, y];

/** The strips that show `count` niches of a growing place (at least one). */
export function stripsFor(niches: NonNullable<PlaceData["niches"]>, count: number): Strip[] {
	const sizes = Object.keys(niches.layouts)
		.map(Number)
		.sort((a, b) => a - b);
	const largest = sizes.at(-1)!;
	const n = Math.max(count, sizes[0]);
	let cuts: [number, number][];
	if (n <= largest) cuts = niches.layouts[String(sizes.find((size) => size >= n))];
	else {
		// Cut the largest layout at the repeat's right edge and insert the repeat once per extra niche.
		const [from, to] = niches.repeat;
		cuts = [];
		for (const [a, b] of niches.layouts[String(largest)]) {
			if (a < to && to < b) {
				cuts.push([a, to]);
				for (let k = 0; k < n - largest; k++) cuts.push([from, to]);
				cuts.push([to, b]);
			} else cuts.push([a, b]);
		}
	}
	let at = 0;
	return cuts.map(([from, to]) => {
		const strip = { from, to, at };
		at += to - from;
		return strip;
	});
}

/** The place's data moved into the strips' coordinates: what falls in a dropped part of the painting is gone. */
export function composeStrips(place: PlaceData, strips: Strip[]): PlaceData {
	const last = strips.length - 1;
	const pointIn = (point: Point): Point | undefined => {
		const index = strips.findIndex((strip, i) => inStrip(point[0], strip, i === last));
		return index < 0 ? undefined : shift(point, strips[index]);
	};
	const width = strips.reduce((sum, strip) => sum + strip.to - strip.from, 0);
	return {
		...place,
		cols: width,
		blocked: strips.flatMap((strip) =>
			place.blocked.map((rect) => clipRect(rect, strip)).filter((r) => r !== undefined),
		),
		spots: place.spots.map(pointIn).filter((p) => p !== undefined),
		entries: Object.fromEntries(
			Object.entries(place.entries)
				.map(([k, p]) => [k, pointIn(p)] as const)
				.filter(([, p]) => p),
		) as Record<string, Point>,
		doors: place.doors.flatMap((door) => {
			const at = pointIn([door.rect[0] + door.rect[2] / 2, door.rect[1]]);
			const stand = pointIn(door.standAt);
			if (!at || !stand) return [];
			return [{ ...door, rect: [at[0] - door.rect[2] / 2, door.rect[1], door.rect[2], door.rect[3]], standAt: stand }];
		}),
		overlaySlots: place.overlaySlots.flatMap((slot) => {
			const at = pointIn(slot.at);
			return at ? [{ ...slot, at }] : [];
		}),
	};
}

/** The headquarters a place belongs to, if any. */
export function headquartersOf(ref: PlaceRef, world: WorldSnapshot | undefined): Headquarters | undefined {
	return ref.kind === "square" ? undefined : world?.headquarters.find((hq) => hq.id === ref.headquarters);
}

/** How to draw `ref` now; undefined when it no longer exists (its headquarters closed). */
export function layoutFor(ref: PlaceRef, world: WorldSnapshot | undefined, theme: Theme): Layout | undefined {
	const key = placeKey(ref);
	const labels = theme.labels;
	if (ref.kind === "square")
		return { ref, key, data: "square", place: theme.places.square, title: labels.square, signature: "square" };
	const hq = headquartersOf(ref, world);
	if (!hq) return undefined;
	const owner = `${hq.name}'s headquarters`;
	if (ref.kind === "headquarters" || ref.kind === "common-room") {
		const data = ref.kind;
		return { ref, key, data, place: theme.places[data], title: labels[data], subtitle: owner, signature: key };
	}
	if (ref.kind === "gallery") {
		const base = theme.places.gallery;
		const strips = stripsFor(base.niches!, hq.wings.length);
		const place = composeStrips(base, strips);
		const centres = strips.flatMap((strip, i) =>
			base.niches!.at.filter((x) => inStrip(x, strip, i === strips.length - 1)).map((x) => x - strip.from + strip.at),
		);
		const niches = hq.wings.slice(0, centres.length).map((wing, i) => ({ wing, x: centres[i] }));
		const signature = `${key}|${hq.wings.map((w) => `${w.repository}:${w.headcount > 0}`).join("|")}`;
		return { ref, key, data: "gallery", place, title: labels.gallery, subtitle: owner, strips, niches, signature };
	}
	if (ref.kind !== "wing") return undefined;
	const wing = hq.wings.find((w) => w.repository === ref.repository);
	if (!wing) return undefined;
	const data = wing.headcount > theme.places["wing-small"].spots.length ? "wing-large" : "wing-small";
	return {
		ref,
		key,
		data,
		place: theme.places[data],
		title: `${wing.name} ${labels.wing}`,
		subtitle: owner,
		signature: `${key}|${data}`,
	};
}

/** Where the world opens: the first headquarters' hall, or the square when no coordinator runs. */
export function startPlace(world: WorldSnapshot | undefined): PlaceRef {
	const first = world?.headquarters[0];
	return first ? { kind: "headquarters", headquarters: first.id } : { kind: "square" };
}

/** The characters in a place, in the snapshot's order (by session start). */
export function charactersIn(ref: PlaceRef, world: WorldSnapshot | undefined): Character[] {
	const key = placeKey(ref);
	return (world?.characters ?? []).filter((character) => placeKey(character.place) === key);
}

/** The walk grid: half-tile cells, true where blocked. A cell is blocked when its centre is inside a blocked rect. */
export function walkGrid(place: PlaceData): { cols: number; rows: number; blocked: boolean[] } {
	const cols = Math.round(place.cols * 2);
	const rows = Math.round(place.rows * 2);
	const blocked = new Array<boolean>(cols * rows).fill(false);
	for (const [x, y, w, h] of place.blocked)
		for (let row = Math.max(0, Math.floor(y * 2)); row < Math.min(rows, Math.ceil((y + h) * 2)); row++)
			for (let col = Math.max(0, Math.floor(x * 2)); col < Math.min(cols, Math.ceil((x + w) * 2)); col++) {
				const cx = (col + 0.5) / 2;
				const cy = (row + 0.5) / 2;
				if (cx >= x && cx < x + w && cy >= y && cy < y + h) blocked[row * cols + col] = true;
			}
	return { cols, rows, blocked };
}

/**
 * Keep each character on the spot it had while it stays, so nobody moves when another leaves; newcomers take the
 * first free spots in order. Characters beyond the spots stand on free floor near the place's start.
 */
export function assignSpots(
	place: PlaceData,
	characters: Character[],
	previous: Map<string, number>,
): { spots: Map<string, number>; positions: Map<string, Point> } {
	const spots = new Map<string, number>();
	const taken = new Set<number>();
	const present = new Set(characters.map((c) => c.id));
	for (const [id, spot] of previous)
		if (present.has(id) && spot < place.spots.length) {
			spots.set(id, spot);
			taken.add(spot);
		}
	let next = 0;
	const overflow: Character[] = [];
	for (const character of characters) {
		if (spots.has(character.id)) continue;
		while (taken.has(next)) next++;
		if (next >= place.spots.length) {
			overflow.push(character);
			continue;
		}
		spots.set(character.id, next);
		taken.add(next);
	}
	const positions = new Map<string, Point>();
	for (const [id, spot] of spots) positions.set(id, place.spots[spot]);
	if (overflow.length) {
		const used = [...positions.values()];
		for (const [character, point] of overflow.map((c, i) => [c, freeFloor(place, used, i)] as const)) {
			positions.set(character.id, point);
			used.push(point);
		}
	}
	return { spots, positions };
}

/** Open floor near the place's start, at least a body's width from anyone already standing. */
function freeFloor(place: PlaceData, used: Point[], seed: number): Point {
	const grid = walkGrid(place);
	const [sx, sy] = place.entries.start ?? [place.cols / 2, place.rows / 2];
	const cells: Point[] = [];
	for (let row = 0; row < grid.rows; row++)
		for (let col = 0; col < grid.cols; col++)
			if (!grid.blocked[row * grid.cols + col]) cells.push([(col + 0.5) / 2, (row + 0.5) / 2]);
	cells.sort((a, b) => Math.hypot(a[0] - sx, a[1] - sy) - Math.hypot(b[0] - sx, b[1] - sy));
	const clear = cells.find(([x, y]) => used.every(([ux, uy]) => Math.abs(ux - x) >= 1.2 || Math.abs(uy - y) >= 1));
	return clear ?? cells[seed % Math.max(1, cells.length)] ?? [sx, sy];
}
