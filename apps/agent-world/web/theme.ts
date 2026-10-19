// A theme pack as the world UI reads it: a painting and a hand-authored data file per place, and character looks.
// The pack lives in apps/agent-world/themes/<theme>/, served beside the built UI. Coordinates are in tiles; fractions
// are allowed (traced on a half-tile grid).

export const TILE = 48; // px per tile, shared by every pack

type Rect = [x: number, y: number, w: number, h: number];
type Point = [x: number, y: number];

export interface PlaceData {
	/** The painting's file name in the pack's places/ folder. */
	painting: string;
	cols: number;
	rows: number;
	blocked: Rect[];
	/** Feet positions on open floor where characters stand. */
	spots: Point[];
	/** Keyed by where you come from. */
	entries: Record<string, Point>;
	doors: { name: string; rect: Rect; standAt: Point; to: string }[];
	overlaySlots: { kind: "fire" | "water" | "glow" | "banner" | "fidget"; at: Point }[];
}

export interface Look {
	/** One frame of the 16-frame sheet, in px. */
	frame: [width: number, height: number];
}

export interface Theme {
	url: string;
	places: Record<string, PlaceData>;
	looks: Record<string, Look>;
}

/** Places this build draws. */
export const PLACES = ["headquarters"] as const;

export async function loadTheme(id: string): Promise<Theme> {
	const url = `themes/${id}/`;
	const json = async <T>(path: string): Promise<T> => {
		const response = await fetch(url + path);
		if (!response.ok) throw new Error(`theme ${id}: ${path} answered ${response.status}`);
		return response.json() as Promise<T>;
	};
	const places: Record<string, PlaceData> = {};
	for (const place of PLACES) places[place] = await json<PlaceData>(`places/${place}.json`);
	return { url, places, looks: await json<Record<string, Look>>("characters/looks.json") };
}
