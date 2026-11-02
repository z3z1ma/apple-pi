// Where a fidget object (ticket 29) sits and where the avatar stands to play with it: on open floor (a cat by the
// hearth), where it also stands in everyone's way like a small body, or on a piece of furniture (a music box on a
// table), reached from the floor in front of that furniture, else beside or behind it. Pure, so the place data's
// tests check every pack's fidgets the way the scene uses them.
import {
	FIDGETS,
	type FidgetKind,
	type FidgetStyle,
	type OverlaySlot,
	type PlaceData,
	type Point,
	type Rect,
} from "../theme.js";
import { gridFor, isOpen } from "./pathing.js";

/** How far in front of furniture (or beside a floor fidget) the avatar stands, in tiles past its edge. */
const STAND_OFF = 0.45;

export const fidgetSlots = (place: PlaceData): OverlaySlot[] =>
	place.overlaySlots.filter((slot) => slot.kind === "fidget" && slot.fidget);

/**
 * Tiles per sprite px for a fidget, from its first sprite's size, so every frame keeps one pixel size. A slot's width
 * wins; else a pet stands at its height (a share of a standing character, `person` tiles tall) so it is to scale with
 * the characters, whatever size its art was drawn; else the pack's width for the kind, else the kind's own.
 */
export function fidgetScale(
	kind: FidgetKind,
	style: Pick<FidgetStyle, "w" | "height"> | undefined,
	slot: Pick<OverlaySlot, "w">,
	first: { width: number; height: number },
	person: number,
): number {
	if (slot.w !== undefined) return slot.w / first.width;
	if (style?.height !== undefined) return (style.height * person) / first.height;
	return (style?.w ?? FIDGETS[kind].w) / first.width;
}

/** Whether the slot stands on open floor (else it sits on furniture). */
export function onFloor(place: PlaceData, slot: OverlaySlot): boolean {
	return isOpen(gridFor(place), slot.at);
}

/** Fidgets on the floor, whose feet block a body's width as a character's do. */
export function floorFidgets(place: PlaceData): Point[] {
	const grid = gridFor(place);
	return fidgetSlots(place)
		.filter((slot) => isOpen(grid, slot.at))
		.map((slot) => slot.at);
}

/** The foreground piece a fidget lies on (its rect holds the slot's bottom centre), drawn just over it. */
export function surfaceOf(place: PlaceData, [x, y]: Point): { rect: Rect; feet: number } | undefined {
	return place.foreground?.find(
		({ rect: [rx, ry, rw, rh] }) => x >= rx && x <= rx + rw && y - 0.05 >= ry && y - 0.05 <= ry + rh,
	);
}

/**
 * Where the avatar stands to play, in groups by preference: beside a floor fidget (either side) or just in front of
 * it; in front of the furniture under a fidget on a top (to one side, then square in front), then beside or behind
 * that furniture.
 */
export function standPoints(place: PlaceData, slot: OverlaySlot, width: number): Point[][] {
	const [x, y] = slot.at;
	if (onFloor(place, slot)) {
		// Beside it, a body's width off, never square in front: there the avatar's figure hides a small pet whole.
		const side = Math.max(1, width / 2 + STAND_OFF + 0.2);
		return [
			[
				[x - side, y + 0.05],
				[x + side, y + 0.05],
			],
			[
				[x - side, y + 0.6],
				[x + side, y + 0.6],
				[x, y - 0.6],
			],
			[[x, y + 0.75]],
		];
	}
	// The blocked rects under it, as one piece of furniture.
	const under = place.blocked.filter(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry - 0.05 && y <= ry + rh);
	// Close round it, for a fidget at the back of a deep piece or on a wall's shelf, where the front edge is out of reach.
	const round = [1, 1.35, 1.7].flatMap((r) =>
		[90, 45, 135, 0, 180, 315, 225, 270].map((deg): Point => {
			const a = (deg * Math.PI) / 180;
			return [x + Math.cos(a) * r, y + Math.sin(a) * r];
		}),
	);
	if (!under.length) return [[[x, y + STAND_OFF]], round];
	const left = Math.min(...under.map(([rx]) => rx));
	const right = Math.max(...under.map(([rx, , rw]) => rx + rw));
	const top = Math.min(...under.map(([, ry]) => ry));
	const bottom = Math.max(...under.map(([, ry, , rh]) => ry + rh));
	const beside = Math.min(bottom - 0.3, Math.max(top + 0.3, y));
	// In front, a little to one side: straight in front, the avatar's own figure would hide what it plays with.
	const aside = 0.75;
	return [
		[
			[x - aside, bottom + STAND_OFF],
			[x + aside, bottom + STAND_OFF],
		],
		[
			[x, bottom + STAND_OFF],
			[x, bottom + STAND_OFF + 0.35],
		],
		([[left - STAND_OFF, beside], [right + STAND_OFF, beside], [x, top - STAND_OFF], ...round] as Point[]).filter(
			([sx, sy]) => Math.hypot(sx - x, sy - y) <= 2.2,
		),
	];
}
