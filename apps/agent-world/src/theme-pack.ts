// The theme pack contract (decision 14): what every pack supplies, in which shared conventions, and the pack check
// that names the file and the fault for anything missing or wrong. Shared by the backend's pack loader, the
// `check-theme` CLI, and the world UI, which checks a pack before it switches to it. No Node or DOM imports: each side
// reads files through its own `PackReader`.
//
// A pack is a directory `themes/<id>/`:
//   theme.json             the manifest (`ThemeManifest`): id, name, labels, text, style tokens, world style
//   interface/skin.css     how the world's HTML looks (the manifest's `skin`), plus any textures it uses
//   places/<place>.json    each place's data over its painting `places/<painting>.png` (`PlaceData`)
//   characters/looks.json  every look (`Look`); `<look>.png` its 16-frame sheet, `<look>-portrait-0..3.png` its faces
//   overlays/<name>.png    doors, banners, beds, letters, birds, and (where a place has the slot) fire and water
import { gridFor, isOpen } from "../web/game/pathing.js";

/** World px per tile, shared by every pack. Place data is in tiles, traced on a half-tile grid. */
export const TILE = 48;
/** Sprite px from head to feet in a standing frame (frame 14), shared by every look. */
export const STANDING_HEIGHT = 120;
/** Frames in a character sheet: walking down, up, and left (four each), seated twice, standing, asking. */
export const SHEET_FRAMES = 16;
/** Portrait px tall, every expression in the same framing. */
export const PORTRAIT_HEIGHT = 360;

/** The four painted expressions every look has, in the order of their files (`<look>-portrait-0..3.png`). */
export const EXPRESSIONS = ["neutral", "happy", "thinking", "worried"] as const;

/** Every place a pack paints, by data file. */
export const PLACE_FILES = [
	"headquarters",
	"common-room",
	"gallery",
	"wing-small",
	"wing-large",
	"square",
	"inn",
	"rookery",
	"forge",
	"quest-office",
	"library",
] as const;

/** What the world calls each kind of place: every pack names them all (`wing` follows a repository's name). */
export const PLACE_LABELS = [
	"headquarters",
	"common-room",
	"gallery",
	"wing",
	"square",
	"forge",
	"quest-office",
	"library",
	"inn",
	"rookery",
] as const;

/** Roles every pack names: the three kinds of character, and each place's host and the townsfolk. */
export const ROLE_LABELS = [
	"coordinator",
	"worker",
	"independent",
	"innkeeper",
	"rookery-keeper",
	"smith",
	"clerk",
	"librarian",
	"crier",
	"townsfolk",
] as const;

/** Every look role a pack must wear, with how many looks at least (agents need a few to tell apart). */
export const LOOK_ROLES: Record<string, number> = {
	agent: 3,
	coordinator: 1,
	avatar: 1,
	townsfolk: 1,
	innkeeper: 1,
	"rookery-keeper": 1,
	smith: 1,
	clerk: 1,
	librarian: 1,
	crier: 1,
};

/** Overlays every pack draws: doors in three states, the wing banner, and the birds that carry mail. */
export const REQUIRED_OVERLAYS = [
	"door-open",
	"door-closed",
	"door-boarded",
	"banner-cream",
	"bird-0",
	"bird-1",
	"bird-2",
	"bird-3",
] as const;

/**
 * Overlays a pack needs only when one of its places has a slot of that kind: ambient animation is optional, and an inn
 * may seat its sleepers at tables rather than in beds.
 */
export const SLOT_OVERLAYS: Record<string, readonly string[]> = {
	fire: ["fire-0", "fire-1", "fire-2", "fire-3"],
	water: ["water-0", "water-1", "water-2", "water-3"],
	bed: ["bed"],
	letters: ["letters"],
	work: ["blade-passing", "blade-failing", "blade-running"],
	notice: ["notice-open", "notice-urgent", "notice-progress", "notice-done"],
};

/** What a place must have beyond the shared format: its host's look role, and slots it cannot do without. */
export const PLACE_NEEDS: Record<string, { host?: string; slots?: Record<string, string> }> = {
	forge: { host: "smith", slots: { work: "the forge lays its pull requests on them" } },
	"quest-office": { host: "clerk", slots: { notice: "the quest office pins the operator's issues on them" } },
	library: { host: "librarian" },
	square: { host: "crier" },
};

/**
 * Theme-flavoured lines the world says, by key; `{name}`, `{count}`, and the like are filled in. Everything else the
 * world says is plain and the same in every theme.
 */
export const TEXT_KEYS = [
	/** Reading a wing's banner: {name}. */
	"banner-reads",
	/** The headquarters door with no coordinator running. */
	"headquarters-empty",
	/** The inn's counter: asking its host for the list of sleepers. */
	"ask-host",
	/** The inn's stairs up to the rooms. */
	"ask-upstairs",
	/** On the inn's stairs: {count} more sleepers than the inn has spots. */
	"upstairs-count",
	/** Where a dormant agent is, in lists and the conversation panel. */
	"asleep-here",
	/** The Places tab: {count} asleep; and nobody. */
	"asleep-count",
	"nobody-asleep",
	/** The inn host's list: its title, what the host says with {here} sleepers (and {upstairs}), and with none. */
	"register-title",
	"register-greeting",
	"register-upstairs",
	"register-empty",
	"register-search",
	/** Where each sleeper rests: above the inn's spots, in a bed, at a table. */
	"sleeper-upstairs",
	"sleeper-bed",
	"sleeper-table",
	/** Mail as the theme says it: a letter's field, its placeholder for {name}, one to sleeping {name}, writing one. */
	"letter",
	"letter-placeholder",
	"letter-for-sleeper",
	"write-letter",
	/** Mail waiting: {count} letter, letters. */
	"letter-waits",
	"letters-wait",
	/** The rookery host: with mail ({waiting} is the waiting part), and with none. */
	"rookery-greeting",
	"rookery-waiting",
	"rookery-empty",
	"waiting-for-sleepers",
	/** A letter on its way to {name}, and one that reached {name}. */
	"letter-sending",
	"letter-reached",
	/** Ending a session: where it goes afterwards, and once {name}'s has ended. */
	"end-session-after",
	"session-ended",
	/** The conversation panel while it opens, while older entries load, and for a sleeper {name}. */
	"conversation-opening",
	"conversation-older",
	"conversation-asleep",
	/**
	 * The quest office's host: over {count} issues assigned to the operator (and one), with none, and before he signs in
	 * to Atlassian; its search's placeholder; and the board's tag for {count} issues beyond its notices.
	 */
	"quest-greeting",
	"quest-greeting-one",
	"quest-empty",
	"quest-signed-out",
	"quest-search",
	"quest-more",
	/** The library's host, and before sign-in; its search's placeholder; the pages read lately, and none yet. */
	"library-greeting",
	"library-signed-out",
	"library-search",
	"library-recent",
	"library-recent-empty",
	/** The square's crier: with {count} channels unread, with none, before Slack is signed in; its search's placeholder. */
	"crier-greeting",
	"crier-quiet",
	"crier-signed-out",
	"crier-search",
	/** The forge's host: what it says over the open pull requests, with none, and while it reads them. */
	"forge-greeting",
	"forge-empty",
	"forge-loading",
	/** A workbench: asking the forge's host for the list; and the tag for {count} pull requests beyond its benches. */
	"ask-smith",
	"forge-more",
] as const;

/**
 * Style tokens every pack sets: CSS custom properties put on the page's root, which the pack's skin and the world
 * UI's own CSS read. Fonts, the inks, the accent, and the main surfaces of the interface frame and the conversation
 * panel. A value may name a file in the pack with `url(...)`, relative to the pack.
 */
export const STYLE_TOKENS = [
	"--aw-font-body",
	"--aw-font-display",
	"--aw-font-figures",
	"--aw-font-mono",
	"--aw-backdrop",
	"--aw-ink",
	"--aw-ink-soft",
	"--aw-ink-faint",
	"--aw-accent",
	"--aw-accent-light",
	"--aw-danger",
	"--aw-frame-background",
	"--aw-frame-shadow",
	"--aw-surface-background",
	"--aw-panel-cover",
	"--aw-panel-page",
	"--aw-veil",
] as const;

/**
 * Classes a skin must style: the interface's frames and surfaces, its tabs and buttons, the conversation panel and
 * its panes, the places' panels, and the pointer's menu. A skin that leaves one out draws a bare browser widget.
 */
export const SKIN_CLASSES = [
	"aw-interface",
	"aw-frame",
	"aw-surface",
	"aw-tab",
	"aw-button",
	"aw-orb-glass",
	"aw-pip",
	"aw-filter",
	"aw-conv-veil",
	"aw-conv-panel",
	"aw-conv-pane",
	"aw-conv-close",
	"aw-cta",
	"aw-conv-input",
	"aw-md-code",
	"aw-place-veil",
	"aw-place-close",
	"aw-mail-row",
	"pointer-menu",
	"place-title",
	"notice",
] as const;

/** Colours and type for what the world draws on its canvas, where CSS does not reach. Colours are `#rrggbb`. */
export interface WorldStyle {
	/** Behind and around the paintings, and the fade between places. */
	backdrop: string;
	/** The canvas's text face. */
	font: string;
	/** Speech bubbles over characters that need the operator. */
	bark: { paper: string; ink: string; outline: string };
	/** The small sign in a place (the inn's "more upstairs"). */
	tag: { plate: string; rim: string; rivet: string; ink: string };
	/** A sleeper's rising "z". */
	sleep: { fill: string; stroke: string };
	/** State badges over characters, in the colours of the interface's state pips, each in a rim with a dark edge. */
	badge: { rim: string; edge: string } & Record<
		"asking" | "unseen" | "working",
		{ fill: string; light: string; ink: string }
	>;
	/** Light around lanterns and lamps: its colour at the centre, the middle, and the edge. */
	glow: [core: string, middle: string, edge: string];
	/**
	 * A wing's banner (`overlays/banner-cream.png`): drawn `tiles` wide from its rod; the name goes in `text`, the
	 * cloth answers the pointer over `hover`, both as fractions of the sprite `[x, y, w, h]`; in `ink`.
	 */
	banner: {
		tiles: number;
		text: [number, number, number, number];
		hover: [number, number, number, number];
		ink: string;
	};
	/**
	 * The inn's bed (`overlays/bed.png`), in its px: where a sleeper's head rests, and the edge of the covers as a
	 * polygon, below which they hide the sleeper. Needed only when a place has a `bed` slot.
	 */
	bed?: { pillow: [number, number]; covers: [number, number][] };
	/**
	 * The quest office's notices (`overlays/notice-*.png`): the part of the sprite that is the notice itself (`paper`, a
	 * fraction `[x, y, w, h]`), when the sprite also paints board around it; with `cutOut`, the board left inside that
	 * part (cork or wood touching its edge) is cut away. Absent: the whole sprite is the notice.
	 */
	notice?: { paper: [number, number, number, number]; cutOut?: boolean };
}

export interface ThemeManifest {
	id: string;
	/** Its name in Settings. */
	name: string;
	/** One line about it for Settings. */
	description?: string;
	/** Every place (`PLACE_LABELS`) and role (`ROLE_LABELS`). */
	labels: Record<string, string>;
	/** Every line of `TEXT_KEYS`. */
	text: Record<string, string>;
	/** Every token of `STYLE_TOKENS`, and any more the skin reads. */
	style: Record<string, string>;
	/** The skin's stylesheet, relative to the pack. */
	skin: string;
	world: WorldStyle;
}

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
 * birds fly in and out; `letters` is where a pile of letters (`w` tiles wide) lies while mail waits; `work` is a place
 * on a workbench where a piece of work (a pull request at the forge) lies, `w` tiles wide, its bottom centre at `at`;
 * `notice` is a place on the quest office's board where an issue's notice is pinned, `w` tiles wide, centred on `at`.
 */
export interface OverlaySlot {
	kind: "fire" | "water" | "glow" | "banner" | "fidget" | "bed" | "window" | "letters" | "work" | "notice";
	at: Point;
	spot?: number;
	w?: number;
	r?: number;
	rx?: number;
	ry?: number;
	hole?: Point[];
	/**
	 * A `work` piece turned clockwise by this many degrees: a diagonal piece (a blade, pommel at the bottom left) laid
	 * flatter along its bench; `at` stays the bottom centre of what it covers.
	 */
	turn?: number;
	/** Brief-named slots (a forge's mats, a notice board) carry a name; the world draws only the kinds above. */
	name?: string;
}

export interface Look {
	/** Who wears it: agents, the coordinator, the operator's avatar, townsfolk, or a host such as the innkeeper. */
	role: "agent" | "coordinator" | "avatar" | "townsfolk" | (string & {});
	/** One frame of the 16-frame strip, in px. */
	frame: [width: number, height: number];
	/** The feet's row in each frame, in px from the top. */
	baseline: number;
}

/** One fault in a pack: the file (relative to the pack) and what is wrong with it. */
export interface PackProblem {
	file: string;
	fault: string;
}

/** An image as the check needs it: its size, and its alpha channel (row by row) when pixels were asked for. */
export interface PackImage {
	width: number;
	height: number;
	alpha?: Uint8Array;
}

/** How the check reads a pack's files: each answers undefined for a file that is missing or cannot be read. */
export interface PackReader {
	text(path: string): Promise<string | undefined>;
	image(path: string, pixels?: boolean): Promise<PackImage | undefined>;
}

/** A PNG's size from its header, or undefined when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Fill `{key}` placeholders in a pack's line. */
export function fill(line: string, values: Record<string, string | number> = {}): string {
	return line.replace(/\{([a-z-]+)\}/gi, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every(isNumber);
const isRect = (value: unknown): value is Rect => Array.isArray(value) && value.length === 4 && value.every(isNumber);
const isColour = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const isFraction = (value: unknown) => isNumber(value) && value >= 0 && value <= 1;
const fmt = (p: readonly number[]) => `[${p.join(", ")}]`;

/** How far an image's sides may stray from the place's tile grid before the grid no longer lies on the painting. */
const ASPECT_TOLERANCE = 0.02;
/** How far a frame's feet may be from the look's baseline, and its standing height from `STANDING_HEIGHT` (px). */
const BASELINE_TOLERANCE = 1;
const HEIGHT_TOLERANCE = 3;
/** Alpha at or above this counts as drawn. */
const OPAQUE = 128;

async function json(reader: PackReader, file: string, problems: PackProblem[]): Promise<unknown> {
	const text = await reader.text(file);
	if (text === undefined) {
		problems.push({ file, fault: "is missing" });
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		problems.push({ file, fault: `is not valid JSON (${(error as Error).message})` });
		return undefined;
	}
}

/** Files a CSS value names with `url(...)`, other than data URLs, relative to where the value lives. */
function urls(css: string): string[] {
	const found: string[] = [];
	const plain = css.replace(/url\(\s*(["'])data:.*?\1\s*\)/gs, "");
	for (const match of plain.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
		const url = match[2].trim();
		if (!/^(data:|https?:|#)/i.test(url)) found.push(url);
	}
	return found;
}

/** A path inside the pack, from `dir` (pack-relative, '' for its root) and a relative reference. */
function within(dir: string, ref: string): string | undefined {
	const parts = dir ? dir.split("/") : [];
	for (const part of ref.split("/")) {
		if (part === "..") {
			if (!parts.length) return undefined;
			parts.pop();
		} else if (part && part !== ".") parts.push(part);
	}
	return parts.join("/");
}

function checkManifest(value: unknown, id: string, problems: PackProblem[]): ThemeManifest | undefined {
	const file = "theme.json";
	if (!isObject(value)) {
		problems.push({ file, fault: "is not an object" });
		return undefined;
	}
	const fault = (text: string) => problems.push({ file, fault: text });
	if (value.id !== id) fault(`names the theme ${JSON.stringify(value.id)}, but its directory is ${id}`);
	if (typeof value.name !== "string" || !value.name.trim()) fault("has no name");
	const table = (key: string, names: readonly string[], what: string) => {
		const entries = value[key];
		if (!isObject(entries)) return fault(`has no ${key}`);
		const missing = names.filter((name) => typeof entries[name] !== "string" || !(entries[name] as string).trim());
		if (missing.length) fault(`has no ${what} for ${missing.join(", ")}`);
	};
	table("labels", [...PLACE_LABELS, ...ROLE_LABELS], "label");
	table("text", TEXT_KEYS, "line");
	table("style", STYLE_TOKENS, "style token");
	if (typeof value.skin !== "string" || !value.skin.endsWith(".css")) fault("names no skin stylesheet (skin: *.css)");
	const world = value.world;
	if (!isObject(world)) {
		fault("has no world style");
		return value as unknown as ThemeManifest;
	}
	const colours = (path: string, object: unknown, keys: string[]) => {
		if (!isObject(object)) return fault(`has no world.${path}`);
		for (const key of keys)
			if (!isColour(object[key])) fault(`world.${path}.${key} is not a #rrggbb colour: ${JSON.stringify(object[key])}`);
	};
	if (!isColour(world.backdrop)) fault(`world.backdrop is not a #rrggbb colour: ${JSON.stringify(world.backdrop)}`);
	if (typeof world.font !== "string" || !world.font.trim()) fault("has no world.font");
	colours("bark", world.bark, ["paper", "ink", "outline"]);
	colours("tag", world.tag, ["plate", "rim", "rivet", "ink"]);
	colours("sleep", world.sleep, ["fill", "stroke"]);
	colours("badge", world.badge, ["rim", "edge"]);
	for (const kind of ["asking", "unseen", "working"])
		colours(`badge.${kind}`, isObject(world.badge) ? world.badge[kind] : undefined, ["fill", "light", "ink"]);
	if (!Array.isArray(world.glow) || world.glow.length !== 3 || !world.glow.every(isColour))
		fault("world.glow is not three #rrggbb colours");
	const banner = world.banner;
	if (
		!isObject(banner) ||
		!isNumber(banner.tiles) ||
		banner.tiles <= 0 ||
		!isRect(banner.text) ||
		!banner.text.every(isFraction) ||
		!isRect(banner.hover) ||
		!banner.hover.every(isFraction) ||
		!isColour(banner.ink)
	)
		fault("world.banner needs tiles, text and hover as fractions [x, y, w, h], and a #rrggbb ink");
	const bed = world.bed;
	if (
		bed !== undefined &&
		(!isObject(bed) ||
			!isPoint(bed.pillow) ||
			!Array.isArray(bed.covers) ||
			bed.covers.length < 3 ||
			!bed.covers.every(isPoint))
	)
		fault("world.bed needs a pillow point and a covers polygon (px in bed.png)");
	const notice = world.notice;
	if (notice !== undefined && (!isObject(notice) || !isRect(notice.paper) || !notice.paper.every(isFraction)))
		fault("world.notice needs paper as fractions [x, y, w, h] of the notice sprites");
	return value as unknown as ThemeManifest;
}

function checkPlace(name: string, value: unknown, painting: PackImage | undefined, problems: PackProblem[]) {
	const file = `places/${name}.json`;
	const fault = (text: string) => problems.push({ file, fault: text });
	if (!isObject(value)) return fault("is not an object");
	const place = value as unknown as PlaceData;
	if (!isNumber(place.cols) || !isNumber(place.rows) || place.cols <= 0 || place.rows <= 0)
		return fault("has no grid size (cols, rows)");
	if (!Array.isArray(place.blocked) || !place.blocked.every(isRect)) return fault("has no blocked rects [x, y, w, h]");
	if (!Array.isArray(place.spots) || !place.spots.every(isPoint)) return fault("has no spots [x, y]");
	if (!isObject(place.entries) || !Object.values(place.entries).every(isPoint)) return fault("has no entries");
	if (!Array.isArray(place.doors) || !place.doors.every((d) => isObject(d) && isRect(d.rect) && isPoint(d.standAt)))
		return fault("has doors without a rect or a stand point");
	if (!Array.isArray(place.overlaySlots) || !place.overlaySlots.every((s) => isObject(s) && isPoint(s.at)))
		return fault("has overlay slots without a place (at)");

	if (painting) {
		const across = painting.width / place.cols;
		const down = painting.height / place.rows;
		if (Math.abs(across / down - 1) > ASPECT_TOLERANCE)
			fault(
				`grid of ${place.cols} x ${place.rows} tiles does not fit its painting (${painting.width} x ${painting.height} px): ` +
					`${across.toFixed(1)} px per tile across but ${down.toFixed(1)} down`,
			);
	}
	const inside = ([x, y]: Point) => x >= 0 && y >= 0 && x <= place.cols && y <= place.rows;
	const rectInside = ([x, y, w, h]: Rect) => w >= 0 && h >= 0 && inside([x, y]) && inside([x + w, y + h]);
	place.blocked.forEach((rect, i) => {
		if (!rectInside(rect)) fault(`blocked rect ${i} ${fmt(rect)} lies outside its ${place.cols} x ${place.rows} grid`);
	});
	for (const door of place.doors)
		if (!rectInside(door.rect)) fault(`door ${door.name}'s rect ${fmt(door.rect)} lies outside its grid`);
	place.overlaySlots.forEach((slot, i) => {
		if (!inside(slot.at)) fault(`overlay slot ${i} (${slot.kind}) at ${fmt(slot.at)} lies outside its grid`);
	});
	for (const piece of place.foreground ?? [])
		if (!isRect(piece.rect) || !rectInside(piece.rect))
			fault(`foreground piece ${fmt(piece.rect ?? [])} lies outside its grid`);
	if (place.host && !inside(place.host.at)) fault(`its host stands at ${fmt(place.host.at)}, outside its grid`);

	// Where characters stand must be open floor: what the avatar can walk to.
	const grid = gridFor(place);
	const onFloor = (what: string, point: Point) => {
		if (!inside(point)) fault(`${what} ${fmt(point)} lies outside its grid`);
		else if (!isOpen(grid, point)) fault(`${what} ${fmt(point)} is not on open floor`);
	};
	for (const [i, spot] of place.spots.entries()) onFloor(`spot ${i}`, spot);
	for (const [from, point] of Object.entries(place.entries)) onFloor(`entry from ${from}`, point);
	for (const door of place.doors) onFloor(`door ${door.name}'s stand point`, door.standAt);
	if (place.enterBy !== undefined && !place.doors.some((door) => door.name === place.enterBy))
		fault(`enterBy names ${JSON.stringify(place.enterBy)}, which is not one of its doors`);
	const needs = PLACE_NEEDS[name];
	if (needs?.host && !isObject(place.host)) fault(`has no host; the ${name} needs its ${needs.host}`);
	for (const [kind, why] of Object.entries(needs?.slots ?? {}))
		if (!place.overlaySlots.some((slot) => slot.kind === kind)) fault(`has no ${kind} slots; ${why}`);
	for (const slot of place.overlaySlots)
		if (slot.kind === "bed" && slot.spot !== undefined && !place.spots[slot.spot])
			fault(`a bed at ${fmt(slot.at)} names spot ${slot.spot}, which it does not have`);
	if (place.niches) {
		const { at, layouts, repeat } = place.niches;
		if (!Array.isArray(at) || !at.every((x) => isNumber(x) && x >= 0 && x <= place.cols))
			fault("has niches outside its grid");
		const strips = [...Object.values(layouts ?? {}).flat(), repeat];
		if (!strips.every((s) => Array.isArray(s) && s.length === 2 && s[0] >= 0 && s[1] <= place.cols && s[0] < s[1]))
			fault("cuts its painting into strips outside its grid");
	}
}

/** Where each frame's feet are: the lowest drawn row, per frame. */
function feetRows(image: PackImage, frameWidth: number, frames: number): number[] {
	const alpha = image.alpha!;
	const rows: number[] = [];
	for (let f = 0; f < frames; f++) {
		let lowest = -1;
		for (let y = image.height - 1; y >= 0 && lowest < 0; y--) {
			const row = y * image.width;
			for (let x = f * frameWidth; x < (f + 1) * frameWidth; x++)
				if (alpha[row + x] >= OPAQUE) {
					lowest = y;
					break;
				}
		}
		rows.push(lowest);
	}
	return rows;
}

function topRow(image: PackImage, frameWidth: number, frame: number): number {
	const alpha = image.alpha!;
	for (let y = 0; y < image.height; y++) {
		const row = y * image.width;
		for (let x = frame * frameWidth; x < (frame + 1) * frameWidth; x++) if (alpha[row + x] >= OPAQUE) return y;
	}
	return -1;
}

async function checkLooks(
	reader: PackReader,
	value: unknown,
	hosts: string[],
	pixels: boolean,
	problems: PackProblem[],
) {
	const file = "characters/looks.json";
	if (!isObject(value)) return problems.push({ file, fault: "is not an object" });
	const looks = value as Record<string, Look>;
	for (const [role, least] of Object.entries(LOOK_ROLES)) {
		const count = Object.values(looks).filter((look) => isObject(look) && look.role === role).length;
		if (count < least) problems.push({ file, fault: `has ${count} ${role} looks; a pack needs at least ${least}` });
	}
	for (const host of hosts)
		if (!looks[host]) problems.push({ file, fault: `has no look ${host}, which a place's host wears` });
	await Promise.all(
		Object.entries(looks).map(async ([name, look]) => {
			if (!isObject(look) || typeof look.role !== "string" || !isPoint(look.frame) || !isNumber(look.baseline))
				return problems.push({ file, fault: `look ${name} needs a role, a frame [w, h], and a baseline` });
			const [w, h] = look.frame;
			const sheetFile = `characters/${name}.png`;
			const sheet = await reader.image(sheetFile, pixels);
			if (!sheet) problems.push({ file: sheetFile, fault: "is missing" });
			else if (sheet.width !== w * SHEET_FRAMES || sheet.height !== h)
				problems.push({
					file: sheetFile,
					fault: `is ${sheet.width} x ${sheet.height} px, but ${SHEET_FRAMES} frames of ${w} x ${h} (looks.json) make ${w * SHEET_FRAMES} x ${h}`,
				});
			else if (look.baseline <= 0 || look.baseline > h)
				problems.push({ file, fault: `look ${name}'s baseline ${look.baseline} lies outside its ${h} px frame` });
			else if (sheet.alpha) {
				const off = feetRows(sheet, w, SHEET_FRAMES)
					.map((row, frame) => ({ frame, row }))
					.filter(({ row }) => Math.abs(row + 1 - look.baseline) > BASELINE_TOLERANCE);
				if (off.length)
					problems.push({
						file: sheetFile,
						fault: `frames ${off.map((o) => o.frame).join(", ")} stand off the baseline ${look.baseline} (feet at rows ${off.map((o) => o.row + 1).join(", ")})`,
					});
				const standing = look.baseline - topRow(sheet, w, 14);
				if (Math.abs(standing - STANDING_HEIGHT) > HEIGHT_TOLERANCE)
					problems.push({
						file: sheetFile,
						fault: `stands ${standing} px tall in its standing frame (14), not ${STANDING_HEIGHT}`,
					});
			}
			for (let i = 0; i < EXPRESSIONS.length; i++) {
				const portraitFile = `characters/${name}-portrait-${i}.png`;
				const portrait = await reader.image(portraitFile);
				if (!portrait) problems.push({ file: portraitFile, fault: `is missing (the ${EXPRESSIONS[i]} portrait)` });
				else if (portrait.height !== PORTRAIT_HEIGHT)
					problems.push({ file: portraitFile, fault: `is ${portrait.height} px tall, not ${PORTRAIT_HEIGHT}` });
			}
		}),
	);
}

/**
 * Check the pack `id` read through `reader`: its manifest and skin, every place over its painting, every look's sheet
 * and portraits, and the overlays it needs. `pixels` also checks each sheet's frames stand on its baseline at the
 * standing height (it reads every sheet's pixels). Returns every problem found, in a stable order; none means good.
 */
/** The skin's stylesheet: there, styling every class a skin must, and naming only files the pack has. */
async function checkSkin(reader: PackReader, manifest: ThemeManifest, problems: PackProblem[]) {
	const skin = within("", manifest.skin);
	const css = skin && (await reader.text(skin));
	if (!skin || css === undefined) return problems.push({ file: manifest.skin, fault: "is missing (the skin)" });
	const dir = skin.split("/").slice(0, -1).join("/");
	const unstyled = SKIN_CLASSES.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
	if (unstyled.length)
		problems.push({ file: skin, fault: `does not style ${unstyled.map((c) => `.${c}`).join(", ")}` });
	for (const ref of urls(css)) {
		const asset = within(dir, ref);
		if (!asset || (await reader.text(asset)) === undefined)
			problems.push({ file: skin, fault: `names ${ref}, which is not in the pack` });
	}
	for (const [token, value] of Object.entries(isObject(manifest.style) ? manifest.style : {}))
		for (const ref of typeof value === "string" ? urls(value) : []) {
			const asset = within("", ref);
			if (!asset || (await reader.text(asset)) === undefined)
				problems.push({ file: "theme.json", fault: `style ${token} names ${ref}, which is not in the pack` });
		}
}

/** Every place over its painting; returns the looks its hosts wear and the kinds of overlay slot it has. */
async function checkPlaces(reader: PackReader, problems: PackProblem[]) {
	const hosts: string[] = [];
	/** Each place's host look, by place. */
	const hostOf: Record<string, string> = {};
	const slotKinds = new Set<string>();
	for (const name of PLACE_FILES) {
		const file = `places/${name}.json`;
		const place = await json(reader, file, problems);
		if (place === undefined) continue;
		if (!isObject(place) || typeof place.painting !== "string") {
			problems.push({ file, fault: "names no painting" });
			checkPlace(name, place, undefined, problems);
			continue;
		}
		const painting = await reader.image(`places/${place.painting}`);
		if (!painting) problems.push({ file: `places/${place.painting}`, fault: `is missing (the painting of ${name})` });
		checkPlace(name, place, painting, problems);
		const data = place as unknown as PlaceData;
		if (isObject(data.host) && typeof data.host.look === "string") {
			hosts.push(data.host.look);
			hostOf[name] = data.host.look;
		}
		for (const slot of Array.isArray(data.overlaySlots) ? data.overlaySlots : [])
			if (isObject(slot)) slotKinds.add(String(slot.kind));
	}
	return { hosts, hostOf, slotKinds };
}

/**
 * Check the pack `id` read through `reader`: its manifest and skin, every place over its painting, every look's sheet
 * and portraits, and the overlays it needs. `pixels` also checks each sheet's frames stand on its baseline at the
 * standing height (it reads every sheet's pixels). Returns every problem found, in a stable order; none means good.
 */
export async function checkPack(reader: PackReader, id: string, { pixels = true } = {}): Promise<PackProblem[]> {
	const problems: PackProblem[] = [];
	const manifest = checkManifest(await json(reader, "theme.json", problems), id, problems);
	if (manifest && typeof manifest.skin === "string") await checkSkin(reader, manifest, problems);
	const { hosts, hostOf, slotKinds } = await checkPlaces(reader, problems);
	const looks = await json(reader, "characters/looks.json", problems);
	if (looks !== undefined) await checkLooks(reader, looks, hosts, pixels, problems);
	// A function place's host wears a look made for its role (the quest office's clerk, not an agent).
	for (const [place, look] of Object.entries(hostOf)) {
		const role = PLACE_NEEDS[place]?.host;
		const worn = isObject(looks) && isObject(looks[look]) ? looks[look].role : undefined;
		if (role && worn !== undefined && worn !== role)
			problems.push({ file: `places/${place}.json`, fault: `its host wears ${look}, which is not a ${role} look` });
	}
	if (slotKinds.has("bed") && manifest && isObject(manifest.world) && manifest.world.bed === undefined)
		problems.push({ file: "theme.json", fault: "has no world.bed, which its places' bed slots need" });
	const overlays = [...REQUIRED_OVERLAYS, ...[...slotKinds].flatMap((kind) => SLOT_OVERLAYS[kind] ?? [])];
	for (const name of overlays) {
		const file = `overlays/${name}.png`;
		if (!(await reader.image(file))) problems.push({ file, fault: "is missing" });
	}
	return problems.sort((a, b) => a.file.localeCompare(b.file) || a.fault.localeCompare(b.fault));
}

/** A pack's problems as lines a theme author reads: `file: fault`. */
export function describeProblems(problems: PackProblem[]): string[] {
	return problems.map(({ file, fault }) => `${file}: ${fault}`);
}
