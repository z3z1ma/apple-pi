// What the minimap draws for a place: its painting (cut into strips for a growing place) and its size, from the same
// layout the world draws, plus the dots and view the world reports.
import type { PlaceRef, WorldSnapshot } from "../../../src/world.js";
import { placeKey } from "../../../src/world.js";
import { layoutFor } from "../../game/layout.js";
import type { Theme } from "../../theme.js";
import type { MinimapView } from "../../view-state.js";
import { placesOf } from "./model.js";

/** The place with this key, as a reference. */
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
	return {
		place: key,
		painting: `${theme.url}places/${painted.painting}`,
		cols: layout.place.cols,
		rows: layout.place.rows,
		paintingCols: painted.cols,
		...(layout.strips ? { strips: layout.strips } : {}),
		dots,
		...(view ? { view } : {}),
	};
}
