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

const STAND_OFF = 0.45;

export const fidgetSlots = (place: PlaceData): OverlaySlot[] =>
	place.overlaySlots.filter((slot) => slot.kind === "fidget" && slot.fidget);

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

export function onFloor(place: PlaceData, slot: OverlaySlot): boolean {
	return isOpen(gridFor(place), slot.at);
}

export function floorFidgets(place: PlaceData): Point[] {
	const grid = gridFor(place);
	return fidgetSlots(place)
		.filter((slot) => isOpen(grid, slot.at))
		.map((slot) => slot.at);
}

export function surfaceOf(place: PlaceData, [x, y]: Point): { rect: Rect; feet: number } | undefined {
	return place.foreground?.find(
		({ rect: [rx, ry, rw, rh] }) => x >= rx && x <= rx + rw && y - 0.05 >= ry && y - 0.05 <= ry + rh,
	);
}

export function standPoints(place: PlaceData, slot: OverlaySlot, width: number): Point[][] {
	const [x, y] = slot.at;
	if (onFloor(place, slot)) {
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

	const under = place.blocked.filter(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry - 0.05 && y <= ry + rh);

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
