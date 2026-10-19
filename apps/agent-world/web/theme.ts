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
	overlaySlots: { kind: "fire" | "water" | "glow" | "banner" | "fidget"; at: Point }[];
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

export interface Look {
	role: "agent" | "coordinator" | "avatar";
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
export const PLACE_FILES = ["headquarters", "common-room", "gallery", "wing-small", "wing-large", "square"] as const;

/** Overlay sprites the world places over paintings. */
export const OVERLAYS = ["door-closed", "door-boarded", "banner-cream"] as const;

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
