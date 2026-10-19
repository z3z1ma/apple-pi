// A theme pack as the world UI reads it: a painting and a hand-authored data file per place, overlays, and character
// looks. The pack lives in apps/agent-world/themes/<theme>/, served beside the built UI. Coordinates are in tiles,
// traced on a half-tile grid; fractions are allowed.

export const TILE = 48; // px per tile, shared by every pack

export type Rect = [x: number, y: number, w: number, h: number];
export type Point = [x: number, y: number];

export interface Door {
	name: string;
	/** Over the door itself: only this answers the pointer. */
	rect: Rect;
	/** Open floor in front of the door, where a character stands to use it. */
	standAt: Point;
	/** The kind of place it leads to. */
	to: string;
}

export interface PlaceData {
	/** The painting's file name in the pack's places/ folder. */
	painting: string;
	cols: number;
	rows: number;
	blocked: Rect[];
	/** Feet positions on open floor where characters stand, in the order they fill. */
	spots: Point[];
	/** Keyed by the kind of place you come from; `start` when you come from nowhere. */
	entries: Record<string, Point>;
	doors: Door[];
	/** The door characters walk in by when they wake, and out by when they stop; the first door when absent. */
	enterBy?: string;
	/**
	 * Furniture that stands in front of whoever is behind it: a rect of the painting (tiles) drawn again over any
	 * character whose feet are north of `feet`, the line where the piece meets the floor.
	 */
	foreground?: { rect: Rect; feet: number }[];
	overlaySlots: OverlaySlot[];
	/**
	 * The place's host (the innkeeper, the rookery keeper): a theme look whose `role` names it, standing at `at` (its
	 * feet, which may be behind a counter) and facing the room. Talking to the host opens the place's own panel.
	 */
	host?: { look: string; at: Point };
	/** Furniture that answers the pointer, such as the inn's tables: `use` names what the place does with it. */
	furniture?: { name: string; rect: Rect; use: string }[];
	/**
	 * A place that grows with what it holds (the gallery): the painting's niches, and how to cut it into vertical
	 * strips for a given number of them. Beyond the largest layout, the `repeat` strip is inserted once per extra
	 * niche, just before its right edge. Positions inside a niche are relative to its centre.
	 */
	niches?: {
		at: number[];
		door: Rect;
		banner: Point;
		standAt: Point;
		layouts: Record<string, [from: number, to: number][]>;
		repeat: [from: number, to: number];
	};
}

/**
 * Where an overlay goes over a painting. `fire` stands on the hearth floor at `at` (its bottom centre), `w` tiles
 * wide; `water` fills the ellipse at `at` with radii `rx`, `ry`, except `hole` (a polygon, such as a fountain's
 * pillar); `glow` is warm light around a lantern or candle at `at`, `r` tiles across its halo; `banner` hangs its rod
 * at `at`; `fidget` is a bare spot for something to play with; `bed` stands a bed `w` tiles wide with its foot's
 * bottom centre at `at`, in which whoever takes spot `spot` sleeps (the spot is where it climbs in); `window` is where
 * birds fly in and out; `letters` is where a pile of letters (`w` tiles wide) lies while mail waits.
 */
export interface OverlaySlot {
	kind: "fire" | "water" | "glow" | "banner" | "fidget" | "bed" | "window" | "letters";
	at: Point;
	spot?: number;
	w?: number;
	r?: number;
	rx?: number;
	ry?: number;
	hole?: Point[];
}

export interface Look {
	/** Who wears it: agents, the coordinator, the operator's avatar, townsfolk, or a host such as the innkeeper. */
	role: "agent" | "coordinator" | "avatar" | "townsfolk" | (string & {});
	/** One frame of the 16-frame strip, in px. */
	frame: [width: number, height: number];
	/** The feet's row in each frame, in px from the top. */
	baseline: number;
}

export interface Theme {
	url: string;
	places: Record<string, PlaceData>;
	looks: Record<string, Look>;
	/** What each kind of place is called in this theme. */
	labels: Record<string, string>;
}

/** Every painted place of a pack, by data file. */
export const PLACE_FILES = [
	"headquarters",
	"common-room",
	"gallery",
	"wing-small",
	"wing-large",
	"square",
	"inn",
	"rookery",
] as const;

/** Overlay sprites the world places over paintings. */
export const OVERLAYS = [
	"door-open",
	"door-closed",
	"door-boarded",
	"banner-cream",
	"fire-0",
	"fire-1",
	"fire-2",
	"fire-3",
	"water-0",
	"water-1",
	"water-2",
	"water-3",
	"bed",
	"bird-0",
	"bird-1",
	"bird-2",
	"bird-3",
	"letters",
] as const;

// The fantasy names until packs carry their own labels (theme pack format, a later ticket).
const FANTASY_LABELS: Record<string, string> = {
	headquarters: "Guild hall",
	"common-room": "Common room",
	gallery: "Gallery of wings",
	wing: "wing",
	square: "Village square",
	forge: "The forge",
	"quest-office": "The quest office",
	library: "The library",
	inn: "The inn",
	rookery: "The rookery",
	innkeeper: "Innkeeper",
	"rookery-keeper": "Rookery keeper",
};

export async function loadTheme(id: string): Promise<Theme> {
	const url = `themes/${id}/`;
	const json = async <T>(path: string): Promise<T> => {
		const response = await fetch(url + path);
		if (!response.ok) throw new Error(`theme ${id}: ${path} answered ${response.status}`);
		return response.json() as Promise<T>;
	};
	const places: Record<string, PlaceData> = {};
	await Promise.all(
		PLACE_FILES.map(async (place) => {
			places[place] = await json<PlaceData>(`places/${place}.json`);
		}),
	);
	return { url, places, looks: await json<Record<string, Look>>("characters/looks.json"), labels: FANTASY_LABELS };
}
