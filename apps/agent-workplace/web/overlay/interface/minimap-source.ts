import type { PlaceRef, WorldSnapshot } from "../../../src/world.js";
import { placeKey } from "../../../src/world.js";
import { layoutFor } from "../../game/layout.js";
import type { Door, PlaceData, Theme } from "../../theme.js";
import type { MinimapView } from "../../view-state.js";
import { placesOf } from "./model.js";

export function placeRef(key: string, world: WorldSnapshot | undefined): PlaceRef | undefined {
	return placesOf(world).find((ref) => placeKey(ref) === key);
}

export function minimapFor(
	key: string,
	world: WorldSnapshot | undefined,
	theme: Theme,
	dots: MinimapView["dots"],
	view?: MinimapView["view"],
): MinimapView | undefined {
	const ref = placeRef(key, world);
	const layout = ref && layoutFor(ref, world, theme);
	if (!layout) return undefined;
	const painted = theme.places[layout.data];
	const exits = exitsOf(layout.ref.kind, layout.place, theme.labels);
	return {
		place: key,
		painting: `${theme.url}places/${painted.painting}`,
		cols: layout.place.cols,
		rows: layout.place.rows,
		paintingCols: painted.cols,
		...(layout.strips ? { strips: layout.strips } : {}),
		dots,
		...(view ? { view } : {}),
		...(exits.length ? { exits } : {}),
	};
}

const OPEN_AIR = new Set(["square", "street"]);

function exitsOf(kind: string, place: PlaceData, labels: Record<string, string>): NonNullable<MinimapView["exits"]> {
	if (!OPEN_AIR.has(kind)) return [];
	return place.doors
		.filter((door) => OPEN_AIR.has(door.to))
		.map((door) => ({ name: labels[door.to] ?? door.name, ...atEdge(door, place) }));
}

function atEdge(door: Door, place: PlaceData): { x: number; y: number; edge: "left" | "right" | "top" | "bottom" } {
	const [x, y, w, h] = door.rect;
	const mid = [x + w / 2, y + h / 2];
	const gaps = {
		left: x,
		right: place.cols - (x + w),
		top: y,
		bottom: place.rows - (y + h),
	} as const;
	const edge = (Object.keys(gaps) as (keyof typeof gaps)[]).reduce((a, b) => (gaps[b] < gaps[a] ? b : a));
	if (edge === "left") return { x: 0, y: mid[1], edge };
	if (edge === "right") return { x: place.cols, y: mid[1], edge };
	if (edge === "top") return { x: mid[0], y: 0, edge };
	return { x: mid[0], y: place.rows, edge };
}
