import { gridFor, isOpen } from "../web/game/pathing.js";

export const TILE = 48;
export const STANDING_HEIGHT = 120;
export const SHEET_FRAMES = 16;
export const PORTRAIT_HEIGHT = 360;

export const IDLE_POSES = ["look-left", "look-right", "stretch", "wave", "laugh", "shrug", "nod", "yawn"] as const;

export const EXPRESSIONS = ["neutral", "happy", "thinking", "worried"] as const;

export const PLACE_FILES = [
	"headquarters",
	"common-room",
	"gallery",
	"wing-small",
	"wing-large",
	"square",
	"street",
	"inn",
	"rookery",
	"forge",
	"quest-office",
	"library",
] as const;

export const PLACE_LABELS = [
	"headquarters",
	"common-room",
	"meeting-room",
	"gallery",
	"wing",
	"square",
	"street",
	"forge",
	"quest-office",
	"library",
	"inn",
	"rookery",
] as const;

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
	"recruiter",
] as const;

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

export const REQUIRED_OVERLAYS = [
	"cursor-point",
	"cursor-tap",
	"cursor-blocked",
	"mark-walk",
	"mark-act",
	"door-open",
	"door-closed",
	"door-boarded",
	"banner-cream",
	"bird-0",
	"bird-1",
	"bird-2",
	"bird-3",
] as const;

export const SLOT_OVERLAYS: Record<string, readonly string[]> = {
	fire: ["fire-0", "fire-1", "fire-2", "fire-3"],
	water: ["water-0", "water-1", "water-2", "water-3"],
	bed: ["bed"],
	letters: ["letters"],
	work: ["blade-passing", "blade-failing", "blade-running"],
	notice: ["notice-open", "notice-urgent", "notice-progress", "notice-done"],
};

export const FIDGETS = {
	pet: { art: ["pet-0", "pet-1", "pet-2", "pet-3"], plays: ["pet", "play"], w: 0.95 },
	spin: { art: ["spin-0", "spin-1", "spin-2", "spin-3"], plays: ["spin", "nudge"], w: 0.65 },
	bell: { art: ["bell-still", "bell-ringing"], plays: ["ring", "peal"], w: 0.6 },
	handbell: { art: ["bell"], plays: ["ring", "peal"], w: 0.32 },
	light: { art: ["light-off", "light-on"], plays: ["on", "off"], w: 0.5 },
	box: { art: ["box-closed", "box-open"], plays: ["open", "close"], w: 0.7 },
	sleeper: { art: ["cat-sleeping"], plays: ["pet", "boop"], w: 0.95 },
	candle: { art: ["candle"], plays: ["blow", "cup"], w: 0.36 },
	tome: { art: ["tome"], plays: ["leaf"], w: 0.75 },
} as const satisfies Record<string, { art: readonly string[]; plays: readonly string[]; w: number }>;

export type FidgetKind = keyof typeof FIDGETS;

export const FIDGET_PARTICLES = ["hearts", "notes", "sparkles", "steam", "bubbles", "smoke", "zzz"] as const;
export type FidgetParticle = (typeof FIDGET_PARTICLES)[number];

export const PET_FRAMES = ["sit", "petted", "play", "stretch", "sleep"] as const;
export type PetFrame = (typeof PET_FRAMES)[number];
export const PET_FRAME_ORDER: readonly PetFrame[] = ["sit", "petted", "play", "sleep"];

export const petArt = (look?: string): string[] =>
	look ? [0, 1, 2, 3].map((frame) => `pet-${look}-${frame}`) : [...FIDGETS.pet.art];

export function slotStyle(style: FidgetStyle, slot: Pick<OverlaySlot, "look">): FidgetStyle {
	const own = slot.look ? style.looks?.[slot.look] : undefined;
	if (!own) return style;
	return { ...style, ...own, verbs: { ...style.verbs, ...own.verbs }, frames: own.frames, looks: undefined };
}

export interface FidgetStyle {
	name: string;
	examine: string;
	verbs: Record<string, string>;
	w?: number;
	particle?: FidgetParticle;
	lines?: string[];
	height?: number;
	frames?: PetFrame[];
	looks?: Record<string, PetLook>;
}

export type PetLook = Pick<FidgetStyle, "name" | "examine" | "particle" | "height" | "frames"> & {
	verbs?: Record<string, string>;
};

export const AMBIENT_GESTURES = ["look-around", "stretch", "wave", "laugh", "shrug", "nod", "yawn"] as const;
export type AmbientGesture = (typeof AMBIENT_GESTURES)[number];
export const AMBIENT_LINES = 3;

export interface AmbientMember {
	name: string;
	look: string;
	examine: string;
	lines: string[];
	reactions: string[];
	barks?: string[];
	gesture?: AmbientGesture;
	crew?: boolean;
}

export interface AmbientPlacement {
	cast: string;
	at: Point;
	face?: "up" | "down" | "left" | "right";
	stay?: boolean;
}

export const PLACE_NEEDS: Record<
	string,
	{ host?: string; slots?: Record<string, string>; recruiter?: string; furniture?: Record<string, string> }
> = {
	forge: { host: "smith", slots: { work: "the forge lays its pull requests on them" } },
	"quest-office": { host: "clerk", slots: { notice: "the quest office pins the operator's issues on them" } },
	library: { host: "librarian" },
	square: { host: "crier", recruiter: "the square's recruiter recruits independent agents at its booth" },
	headquarters: {
		furniture: {
			recruit: "the coordinator's desk recruits workers there",
			notes: "the operator's notepad opens there",
		},
	},
};

export const TEXT_KEYS = [
	"banner-reads",
	"headquarters-empty",
	"ask-host",
	"ask-upstairs",
	"upstairs-count",
	"asleep-here",
	"asleep-count",
	"nobody-asleep",
	"register-title",
	"register-greeting",
	"register-upstairs",
	"register-empty",
	"register-search",
	"sleeper-upstairs",
	"sleeper-bed",
	"sleeper-table",
	"letter",
	"letter-placeholder",
	"letter-for-sleeper",
	"write-letter",
	"letter-waits",
	"letters-wait",
	"rookery-greeting",
	"rookery-waiting",
	"rookery-empty",
	"waiting-for-sleepers",
	"letter-sending",
	"letter-reached",
	"end-session-after",
	"session-ended",
	"conversation-opening",
	"conversation-older",
	"conversation-asleep",
	"quest-greeting",
	"quest-greeting-one",
	"quest-empty",
	"quest-signed-out",
	"quest-search",
	"quest-more",
	"library-greeting",
	"library-signed-out",
	"library-search",
	"library-recent",
	"library-recent-empty",
	"crier-greeting",
	"crier-quiet",
	"crier-signed-out",
	"crier-search",
	"forge-greeting",
	"forge-empty",
	"forge-loading",
	"ask-smith",
	"forge-more",
	"recruit-worker",
	"recruit-independent",
	"recruit-worker-title",
	"recruit-independent-title",
	"recruit-worker-greeting",
	"recruit-independent-greeting",
	"recruit-brief",
	"recruit-send",
	"recruit-sending",
	"recruit-joined",
	"recruit-role",
	"recruit-no-role",
	"retire",
	"retire-title",
	"retire-reason",
	"retire-send",
	"retire-done",
	"retired",
	"task-board",
	"team-board",
	"meeting-agenda",
	"work-notes",
	"carrying-task",
	"carry-task",
	"give-task",
	"task-giving",
	"task-given",
] as const;

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

export const TAB_ICONS = ["agents", "needs-you", "work", "mail", "slack", "places", "settings"] as const;

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

export interface WorldStyle {
	backdrop: string;
	font: string;
	bark: { paper: string; ink: string; outline: string };
	tag: { plate: string; rim: string; rivet: string; ink: string };
	sleep: { fill: string; stroke: string };
	badge: { rim: string; edge: string } & Record<
		"asking" | "unseen" | "working",
		{ fill: string; light: string; ink: string }
	>;
	glow: [core: string, middle: string, edge: string];
	banner: {
		tiles: number;
		text: [number, number, number, number];
		hover: [number, number, number, number];
		ink: string;
	};
	bed?: { pillow: [number, number]; covers: [number, number][] };
	notice?: { paper: [number, number, number, number]; cutOut?: boolean };
	sign?: {
		font: string;
		ink: string;
		shadow?: string;
		upper?: boolean;
		plate?: { fill: string; rim: string; edge: string };
	};
}

export interface ThemeManifest {
	id: string;
	name: string;
	description?: string;
	labels: Record<string, string>;
	text: Record<string, string>;
	style: Record<string, string>;
	skin: string;
	world: WorldStyle;
	fidgets?: Partial<Record<FidgetKind, FidgetStyle>>;
	ambient?: Record<string, AmbientMember>;
}

export type Rect = [x: number, y: number, w: number, h: number];
export type Point = [x: number, y: number];

export interface Door {
	name: string;
	rect: Rect;
	standAt: Point;
	to: string;
	sign?: { rect: Rect; plate?: boolean };
}

export interface PlaceData {
	painting: string;
	cols: number;
	rows: number;
	blocked: Rect[];
	spots: Point[];
	entries: Record<string, Point>;
	doors: Door[];
	enterBy?: string;
	foreground?: { rect: Rect; feet: number }[];
	overlaySlots: OverlaySlot[];
	host?: { look: string; at: Point };
	recruiter?: { look?: string; at: Point };
	furniture?: { name: string; rect: Rect; use: string }[];
	interest?: { name: string; at: Point; face?: "up" | "down" | "left" | "right" }[];
	ambient?: AmbientPlacement[];
	atmosphere?: Atmosphere[];
	niches?: {
		at: number[];
		door: Rect;
		banner: Point;
		standAt: Point;
		layouts: Record<string, [from: number, to: number][]>;
		repeat: [from: number, to: number];
	};
}

export interface OverlaySlot {
	kind: "fire" | "water" | "glow" | "banner" | "fidget" | "bed" | "window" | "letters" | "work" | "notice";
	at: Point;
	spot?: number;
	w?: number;
	r?: number;
	rx?: number;
	ry?: number;
	hole?: Point[];
	turn?: number;
	name?: string;
	fidget?: FidgetKind;
	look?: string;
	asleep?: boolean;
	on?: boolean;
}

export const ATMOSPHERE_KINDS = [
	"motes",
	"fall",
	"sky",
	"steam",
	"sparks",
	"blink",
	"screens",
	"shimmer",
	"lights",
] as const;
export const ATMOSPHERE_WHAT: Partial<Record<(typeof ATMOSPHERE_KINDS)[number], readonly string[]>> = {
	fall: ["leaves", "petals"],
	sky: ["birds", "plane"],
};

export interface Atmosphere {
	kind: (typeof ATMOSPHERE_KINDS)[number];
	rect?: Rect;
	rects?: Rect[];
	at?: Point;
	w?: number;
	count?: number;
	what?: string;
	colors?: string[];
}

export interface Look {
	role: "agent" | "coordinator" | "avatar" | "townsfolk" | (string & {});
	frame: [width: number, height: number];
	baseline: number;
	idle?: { frame: [width: number, height: number]; baseline: number };
}

export interface PackProblem {
	file: string;
	fault: string;
}

export interface PackImage {
	width: number;
	height: number;
	alpha?: Uint8Array;
}

export interface PackReader {
	text(path: string): Promise<string | undefined>;
	image(path: string, pixels?: boolean): Promise<PackImage | undefined>;
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

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

const ASPECT_TOLERANCE = 0.02;
const BASELINE_TOLERANCE = 1;
const HEIGHT_TOLERANCE = 3;
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

function urls(css: string): string[] {
	const found: string[] = [];
	const plain = css.replace(/url\(\s*(["'])data:.*?\1\s*\)/gs, "");
	for (const match of plain.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
		const url = match[2].trim();
		if (!/^(data:|https?:|#)/i.test(url)) found.push(url);
	}
	return found;
}

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
	for (const [token, css] of Object.entries(isObject(value.style) ? value.style : {})) {
		if (!token.startsWith("--aw-icon-")) continue;
		const tab = token.slice("--aw-icon-".length);
		if (!(TAB_ICONS as readonly string[]).includes(tab))
			fault(`style ${token} names no tab (a tab icon is one of ${TAB_ICONS.map((t) => `--aw-icon-${t}`).join(", ")})`);
		else if (typeof css !== "string" || !/^url\(\s*['"]?[^'")]+\.svg['"]?\s*\)$/i.test(css.trim()))
			fault(`style ${token} is not url(...) of an SVG in the pack: ${JSON.stringify(css)}`);
	}
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
	const sign = world.sign;
	if (sign !== undefined) {
		if (!isObject(sign)) fault("world.sign is not an object");
		else {
			if (!isText(sign.font)) fault("world.sign has no font");
			colours("sign", sign, ["ink", ...(sign.shadow === undefined ? [] : ["shadow"])]);
			if (sign.plate !== undefined) colours("sign.plate", sign.plate, ["fill", "rim", "edge"]);
		}
	}
	checkFidgetStyles(value.fidgets, fault);
	checkCast(value.ambient, fault);
	return value as unknown as ThemeManifest;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isFidget = (kind: unknown): kind is FidgetKind => typeof kind === "string" && Object.hasOwn(FIDGETS, kind);

function checkFidgetStyles(fidgets: unknown, fault: (text: string) => void) {
	if (fidgets === undefined) return;
	if (!isObject(fidgets)) return fault("fidgets is not an object of fidget kinds");
	for (const [kind, style] of Object.entries(fidgets)) {
		if (!isFidget(kind)) {
			fault(
				`fidgets names ${JSON.stringify(kind)}, which is not a kind of fidget (${Object.keys(FIDGETS).join(", ")})`,
			);
			continue;
		}
		if (!isObject(style)) {
			fault(`fidgets.${kind} is not an object`);
			continue;
		}
		if (!isText(style.name)) fault(`fidgets.${kind} has no name`);
		if (!isText(style.examine)) fault(`fidgets.${kind} has no examine line`);
		const verbs = isObject(style.verbs) ? style.verbs : {};
		const missing = FIDGETS[kind].plays.filter((play) => !isText(verbs[play]));
		if (missing.length) fault(`fidgets.${kind} has no verb for ${missing.join(", ")}`);
		if (style.w !== undefined && !(isNumber(style.w) && style.w > 0))
			fault(`fidgets.${kind}.w is not a width in tiles`);
		if (style.particle !== undefined && !FIDGET_PARTICLES.includes(style.particle as FidgetParticle))
			fault(`fidgets.${kind}.particle is not one of ${FIDGET_PARTICLES.join(", ")}`);
		if (kind === "tome" && !(Array.isArray(style.lines) && style.lines.length > 0 && style.lines.every(isText)))
			fault("fidgets.tome has no lines to show when it is leafed through");
		if (kind === "pet") checkPetStyles(style, fault);
	}
}

function checkPetStyles(style: Record<string, unknown>, fault: (text: string) => void) {
	checkPetLook("fidgets.pet", style, fault);
	if (style.looks === undefined) return;
	if (!isObject(style.looks)) return fault("fidgets.pet.looks is not an object of looks");
	for (const [look, own] of Object.entries(style.looks)) {
		const where = `fidgets.pet.looks.${look}`;
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(look)) fault(`${where} is not a look name (lowercase words joined by -)`);
		if (!isObject(own)) {
			fault(`${where} is not an object`);
			continue;
		}
		if (!isText(own.name)) fault(`${where} has no name`);
		if (!isText(own.examine)) fault(`${where} has no examine line`);
		if (own.verbs !== undefined) {
			const verbs = isObject(own.verbs) ? own.verbs : {};
			const odd = Object.keys(verbs).filter((play) => !(FIDGETS.pet.plays as readonly string[]).includes(play));
			if (!isObject(own.verbs) || odd.length || !Object.values(verbs).every(isText))
				fault(`${where}.verbs names a verb for each of ${FIDGETS.pet.plays.join(", ")} only`);
		}
		if (own.particle !== undefined && !FIDGET_PARTICLES.includes(own.particle as FidgetParticle))
			fault(`${where}.particle is not one of ${FIDGET_PARTICLES.join(", ")}`);
		checkPetLook(where, own, fault);
	}
}

function checkPetLook(where: string, style: Record<string, unknown>, fault: (text: string) => void) {
	if (style.height !== undefined && !(isNumber(style.height) && style.height > 0 && style.height <= 1.2))
		fault(`${where}.height is not a share of a standing character's height (above 0, at most 1.2)`);
	if (style.frames === undefined) return;
	const frames = Array.isArray(style.frames) ? style.frames : [];
	const known = frames.every((frame) => PET_FRAMES.includes(frame as PetFrame));
	if (
		frames.length !== 4 ||
		!known ||
		new Set(frames).size !== 4 ||
		!["sit", "petted", "play"].every((frame) => frames.includes(frame))
	)
		fault(`${where}.frames is not four different frames of ${PET_FRAMES.join(", ")}, with sit, petted, and play`);
}

type PetsPlaced = { file: string; slot: OverlaySlot }[];

function checkPets(placed: PetsPlaced, pet: unknown, problems: PackProblem[]): string[] {
	const style = isObject(pet) ? (pet as unknown as FidgetStyle) : undefined;
	const perPlace = new Map<string, number>();
	const lookAt = new Map<string, string>();
	const art: string[] = [];
	for (const { file, slot } of placed) {
		perPlace.set(file, (perPlace.get(file) ?? 0) + 1);
		if (perPlace.get(file) === 2) problems.push({ file, fault: "holds more than one pet (a sleeper counts)" });
		const look = slot.fidget === "sleeper" ? "a sleeper" : slot.look ? `pet look ${slot.look}` : "the pet's own look";
		const first = lookAt.get(look);
		if (first) problems.push({ file, fault: `holds ${look}, as ${first} does: no two places share a pet` });
		else lookAt.set(look, file);
		if (slot.fidget !== "pet") continue;
		if (!style) {
			art.push(...petArt(typeof slot.look === "string" ? slot.look : undefined));
			continue;
		}
		if (slot.look !== undefined && !(typeof slot.look === "string" && isObject(style.looks?.[slot.look]))) {
			problems.push({
				file,
				fault: `a pet at ${fmt(slot.at)} wears look ${JSON.stringify(slot.look)}, which fidgets.pet.looks does not name`,
			});
			continue;
		}
		const frames = slotStyle(style, slot).frames ?? PET_FRAME_ORDER;
		if (slot.asleep && !frames.includes("sleep"))
			problems.push({ file, fault: `a pet at ${fmt(slot.at)} is asleep, but its look has no sleep frame` });
		art.push(...petArt(slot.look));
	}
	return art;
}

function checkSign(door: Door, rectInside: (rect: Rect) => boolean, fault: (text: string) => void) {
	if (door.sign === undefined) return;
	if (!isObject(door.sign) || !isRect(door.sign.rect)) fault(`door ${door.name}'s sign has no rect [x, y, w, h]`);
	else if (!rectInside(door.sign.rect)) fault(`door ${door.name}'s sign ${fmt(door.sign.rect)} lies outside its grid`);
}

function checkSlot(slot: OverlaySlot, place: PlaceData, fault: (text: string) => void) {
	if (slot.kind === "bed" && slot.spot !== undefined && !place.spots[slot.spot])
		fault(`a bed at ${fmt(slot.at)} names spot ${slot.spot}, which it does not have`);
	if (slot.kind !== "fidget") return;
	if (!isFidget(slot.fidget))
		fault(
			`a fidget slot at ${fmt(slot.at)} names ${slot.fidget === undefined ? "no kind" : JSON.stringify(slot.fidget)}; ` +
				`fidget is one of ${Object.keys(FIDGETS).join(", ")}`,
		);
	else if (slot.w !== undefined && !(isNumber(slot.w) && slot.w > 0))
		fault(`a fidget slot at ${fmt(slot.at)} has a width (w) that is not a number of tiles`);
	if ((slot.look !== undefined || slot.asleep !== undefined) && slot.fidget !== "pet")
		fault(`a fidget slot at ${fmt(slot.at)} gives a look or asleep, which only a pet has`);
}

function checkRecruiting(
	place: PlaceData,
	needs: (typeof PLACE_NEEDS)[string] | undefined,
	fault: (text: string) => void,
	onFloor: (what: string, point: Point) => void,
) {
	if (place.recruiter === undefined) {
		if (needs?.recruiter) fault(`has no recruiter; ${needs.recruiter}`);
	} else if (!isObject(place.recruiter) || !isPoint(place.recruiter.at)) fault("its recruiter has no place (at)");
	else onFloor("its recruiter", place.recruiter.at);
	const furniture = Array.isArray(place.furniture) ? place.furniture : [];
	for (const [use, why] of Object.entries(needs?.furniture ?? {}))
		if (!furniture.some((piece) => isObject(piece) && piece.use === use && isRect(piece.rect)))
			fault(`has no furniture whose use is ${use}; ${why}`);
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
	for (const door of place.doors) {
		if (!rectInside(door.rect)) fault(`door ${door.name}'s rect ${fmt(door.rect)} lies outside its grid`);
		checkSign(door, rectInside, fault);
	}
	place.overlaySlots.forEach((slot, i) => {
		if (!inside(slot.at)) fault(`overlay slot ${i} (${slot.kind}) at ${fmt(slot.at)} lies outside its grid`);
	});
	for (const piece of place.foreground ?? [])
		if (!isRect(piece.rect) || !rectInside(piece.rect))
			fault(`foreground piece ${fmt(piece.rect ?? [])} lies outside its grid`);
	if (place.host && !inside(place.host.at)) fault(`its host stands at ${fmt(place.host.at)}, outside its grid`);

	const grid = gridFor(place);
	const onFloor = (what: string, point: Point) => {
		if (!inside(point)) fault(`${what} ${fmt(point)} lies outside its grid`);
		else if (!isOpen(grid, point)) fault(`${what} ${fmt(point)} is not on open floor`);
	};
	for (const [i, spot] of place.spots.entries()) onFloor(`spot ${i}`, spot);
	for (const [from, point] of Object.entries(place.entries)) onFloor(`entry from ${from}`, point);
	for (const door of place.doors) onFloor(`door ${door.name}'s stand point`, door.standAt);
	checkRecruiting(place, PLACE_NEEDS[name], fault, onFloor);
	checkInterest(place, grid, fault);
	checkAmbientPlaces(place, grid, fault);
	checkAtmosphere(place, rectInside, inside, fault);
	if (place.enterBy !== undefined && !place.doors.some((door) => door.name === place.enterBy))
		fault(`enterBy names ${JSON.stringify(place.enterBy)}, which is not one of its doors`);
	const needs = PLACE_NEEDS[name];
	if (needs?.host && !isObject(place.host)) fault(`has no host; the ${name} needs its ${needs.host}`);
	for (const [kind, why] of Object.entries(needs?.slots ?? {}))
		if (!place.overlaySlots.some((slot) => slot.kind === kind)) fault(`has no ${kind} slots; ${why}`);
	for (const slot of place.overlaySlots) checkSlot(slot, place, fault);
	if (place.niches) {
		const { at, layouts, repeat } = place.niches;
		if (!Array.isArray(at) || !at.every((x) => isNumber(x) && x >= 0 && x <= place.cols))
			fault("has niches outside its grid");
		const strips = [...Object.values(layouts ?? {}).flat(), repeat];
		if (!strips.every((s) => Array.isArray(s) && s.length === 2 && s[0] >= 0 && s[1] <= place.cols && s[0] < s[1]))
			fault("cuts its painting into strips outside its grid");
	}
}

function checkAtmosphere(
	place: PlaceData,
	rectInside: (rect: Rect) => boolean,
	inside: (point: Point) => boolean,
	fault: (text: string) => void,
) {
	if (place.atmosphere === undefined) return;
	if (!Array.isArray(place.atmosphere)) return fault("has an atmosphere that is not a list");
	for (const [i, effect] of place.atmosphere.entries()) {
		if (!isObject(effect) || !ATMOSPHERE_KINDS.includes(effect.kind as Atmosphere["kind"])) {
			fault(
				`atmosphere ${i} is ${JSON.stringify(isObject(effect) ? effect.kind : effect)}; kind is one of ${ATMOSPHERE_KINDS.join(", ")}`,
			);
			continue;
		}
		const what = `atmosphere ${i} (${effect.kind})`;
		const rects = [...(effect.rect === undefined ? [] : [effect.rect]), ...(effect.rects ?? [])];
		for (const rect of rects)
			if (!isRect(rect)) fault(`${what} has a rect that is not [x, y, w, h]`);
			else if (!rectInside(rect)) fault(`${what} ${fmt(rect)} lies outside its grid`);
		if (
			(effect.kind === "screens" || effect.kind === "lights") &&
			!(Array.isArray(effect.rects) && effect.rects.length)
		)
			fault(`${what} has no rects [[x, y, w, h], ...]`);
		if ((effect.kind === "blink" || effect.kind === "shimmer") && effect.rect === undefined)
			fault(`${what} has no rect [x, y, w, h]`);
		if (effect.kind === "steam" || effect.kind === "sparks") {
			if (!isPoint(effect.at)) fault(`${what} has no place (at)`);
			else if (!inside(effect.at)) fault(`${what} at ${fmt(effect.at)} lies outside its grid`);
		}
		const names = ATMOSPHERE_WHAT[effect.kind];
		if (names && !names.includes(effect.what as string))
			fault(`${what} names ${JSON.stringify(effect.what)}; what is one of ${names.join(", ")}`);
		if (effect.count !== undefined && !(isNumber(effect.count) && effect.count > 0))
			fault(`${what} has a count that is not a positive number`);
		const colours = effect.colors ?? [];
		const wrong = Array.isArray(colours) ? colours.filter((c) => !/^#[0-9a-f]{6}$/i.test(String(c))) : [colours];
		if (wrong.length)
			fault(`${what} has colours that are not #rrggbb: ${wrong.map((c) => JSON.stringify(c)).join(", ")}`);
	}
}

async function checkIdle(reader: PackReader, name: string, idle: unknown, pixels: boolean, problems: PackProblem[]) {
	const file = `characters/${name}-idle.png`;
	if (!isObject(idle) || !isPoint(idle.frame) || !isNumber(idle.baseline))
		return problems.push({
			file: "characters/looks.json",
			fault: `look ${name}'s idle needs a frame [w, h] and a baseline`,
		});
	const [w, h] = idle.frame;
	const frames = IDLE_POSES.length;
	const sheet = await reader.image(file, pixels);
	if (!sheet) return problems.push({ file, fault: "is missing (the idle sheet looks.json names)" });
	if (sheet.width !== w * frames || sheet.height !== h)
		return problems.push({
			file,
			fault: `is ${sheet.width} x ${sheet.height} px, but ${frames} idle frames of ${w} x ${h} (looks.json) make ${w * frames} x ${h}`,
		});
	const baseline = idle.baseline;
	if (baseline <= 0 || baseline > h)
		return problems.push({
			file: "characters/looks.json",
			fault: `look ${name}'s idle baseline ${baseline} lies outside its ${h} px frame`,
		});
	if (!sheet.alpha) return;
	const off = feetRows(sheet, w, frames)
		.map((row, frame) => ({ frame, row }))
		.filter(({ row }) => Math.abs(row + 1 - baseline) > BASELINE_TOLERANCE);
	if (off.length)
		problems.push({
			file,
			fault: `idle frames ${off.map((o) => o.frame).join(", ")} stand off the baseline ${baseline} (feet at rows ${off.map((o) => o.row + 1).join(", ")})`,
		});
}

function checkInterest(place: PlaceData, grid: ReturnType<typeof gridFor>, fault: (text: string) => void) {
	if (place.interest === undefined) return;
	if (!Array.isArray(place.interest)) return fault("has points of interest that are not a list");
	const near = (a: Point, b: Point, least: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < least;
	const clear: [string, Point, number][] = [
		...place.doors.map((door): [string, Point, number] => [`door ${door.name}'s stand point`, door.standAt, 1]),
		...Object.entries(place.entries).map(([from, at]): [string, Point, number] => [`the entry from ${from}`, at, 1]),
		...place.spots.map((at, i): [string, Point, number] => [`spot ${i}`, at, 0.9]),
		...(isObject(place.host) && isPoint(place.host.at)
			? [["its host", place.host.at, 0.9] as [string, Point, number]]
			: []),
		...(isObject(place.recruiter) && isPoint(place.recruiter.at)
			? [["its recruiter", place.recruiter.at, 0.9] as [string, Point, number]]
			: []),
	];
	for (const [i, point] of place.interest.entries()) {
		if (!isObject(point) || !isText(point.name)) {
			fault(`point of interest ${i} has no name`);
			continue;
		}
		if (!isPoint(point.at)) {
			fault(`point of interest ${i} has no place (at)`);
			continue;
		}
		const what = `point of interest ${point.name} ${fmt(point.at)}`;
		const [x, y] = point.at;
		if (x < 0 || y < 0 || x > place.cols || y > place.rows) {
			fault(`${what} lies outside its grid`);
			continue;
		}
		if (!isOpen(grid, point.at)) {
			fault(`${what} is not on open floor`);
			continue;
		}
		if (point.face !== undefined && !["up", "down", "left", "right"].includes(point.face))
			fault(`${what} faces ${JSON.stringify(point.face)}, not up, down, left, or right`);
		for (const [other, at, least] of clear)
			if (near(point.at, at, least))
				fault(`${what} is within ${least === 1 ? "a tile" : `${least} tiles`} of ${other}`);
	}
}

function checkCast(ambient: unknown, fault: (text: string) => void) {
	if (ambient === undefined) return;
	if (!isObject(ambient)) return fault("ambient is not an object of cast members");
	const lines = (value: unknown) => Array.isArray(value) && value.every(isText);
	for (const [id, member] of Object.entries(ambient)) {
		const where = `ambient.${id}`;
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fault(`${where} is not a cast name (lowercase words joined by -)`);
		if (!isObject(member)) {
			fault(`${where} is not an object`);
			continue;
		}
		if (!isText(member.name)) fault(`${where} has no name`);
		if (!isText(member.look)) fault(`${where} has no look`);
		if (!isText(member.examine)) fault(`${where} has no examine line`);
		if (!lines(member.lines) || (member.lines as string[]).length < AMBIENT_LINES)
			fault(`${where} has fewer than ${AMBIENT_LINES} lines to say when talked to`);
		if (!lines(member.reactions) || !(member.reactions as string[]).length)
			fault(`${where} has no reaction to say when clicked again and again`);
		if (member.barks !== undefined && !lines(member.barks)) fault(`${where}.barks is not a list of lines`);
		if (member.gesture !== undefined && !AMBIENT_GESTURES.includes(member.gesture as AmbientGesture))
			fault(`${where}.gesture is not one of ${AMBIENT_GESTURES.join(", ")}`);
		if (member.crew !== undefined && typeof member.crew !== "boolean") fault(`${where}.crew is not true or false`);
	}
}

function checkAmbientPlaces(place: PlaceData, grid: ReturnType<typeof gridFor>, fault: (text: string) => void) {
	if (place.ambient === undefined) return;
	if (!Array.isArray(place.ambient)) return fault("has ambient characters that are not a list");
	const near = (a: Point, b: Point, least: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < least;
	const point = (what: string, at: unknown, least: number): [string, Point, number][] =>
		isPoint(at) ? [[what, at, least]] : [];
	const clear: [string, Point, number][] = [
		...place.doors.flatMap((door) => point(`door ${door.name}'s stand point`, door.standAt, 1)),
		...Object.entries(place.entries).flatMap(([from, at]) => point(`the entry from ${from}`, at, 1)),
		...place.spots.flatMap((at, i) => point(`spot ${i}`, at, 0.9)),
		...point("its host", isObject(place.host) ? place.host.at : undefined, 0.9),
		...point("its recruiter", isObject(place.recruiter) ? place.recruiter.at : undefined, 0.9),
		...(Array.isArray(place.interest) ? place.interest : []).flatMap((p) =>
			isObject(p) ? point(`point of interest ${p.name}`, p.at, 0.9) : [],
		),
	];
	for (const [i, entry] of place.ambient.entries()) {
		if (!isObject(entry) || !isText(entry.cast)) {
			fault(`ambient ${i} names no cast member`);
			continue;
		}
		if (!isPoint(entry.at)) {
			fault(`ambient ${entry.cast} has no place (at)`);
			continue;
		}
		const what = `ambient ${entry.cast} ${fmt(entry.at)}`;
		const [x, y] = entry.at;
		if (x < 0 || y < 0 || x > place.cols || y > place.rows) fault(`${what} lies outside its grid`);
		else if (!isOpen(grid, entry.at)) fault(`${what} is not on open floor`);
		if (entry.face !== undefined && !["up", "down", "left", "right"].includes(entry.face))
			fault(`${what} faces ${JSON.stringify(entry.face)}, not up, down, left, or right`);
		if (entry.stay !== undefined && typeof entry.stay !== "boolean")
			fault(`${what} has a stay that is not true or false`);
		for (const [other, at, least] of clear)
			if (near(entry.at, at, least))
				fault(`${what} is within ${least === 1 ? "a tile" : `${least} tiles`} of ${other}`);
		clear.push([`ambient ${entry.cast}`, entry.at, 0.9]);
	}
}

type CastPlaced = { file: string; cast: string }[];
const REPEATING_ROOMS = ["headquarters", "common-room", "wing-small", "wing-large"].map(
	(name) => `places/${name}.json`,
);
const CREW_ROOMS = ["headquarters", "common-room"].map((name) => `places/${name}.json`);
const CREW_LOOK_ROLES = ["townsfolk", "ambient"];

function checkCastPlaced(manifest: ThemeManifest, looks: unknown, placed: CastPlaced, problems: PackProblem[]) {
	const cast = isObject(manifest.ambient) ? manifest.ambient : {};
	const isCrew = (name: string) => isObject(cast[name]) && cast[name].crew === true;
	const lookOf = (name: string) => (isObject(cast[name]) && isText(cast[name].look) ? cast[name].look : undefined);
	const first = new Map<string, string>();
	const wornIn = new Map<string, string>();
	for (const { file, cast: name } of placed) {
		if (!Object.hasOwn(cast, name)) {
			problems.push({ file, fault: `ambient ${name} stands here, but theme.json's ambient does not name it` });
			continue;
		}
		if (isCrew(name) && !CREW_ROOMS.includes(file))
			problems.push({
				file,
				fault: `ambient ${name} is headquarters crew, who stand only in the headquarters or its common room`,
			});
		else if (!isCrew(name) && REPEATING_ROOMS.includes(file))
			problems.push({ file, fault: `ambient ${name} stands in a room the world shows once per coordinator or wing` });
		const look = lookOf(name);
		const other = look && wornIn.get(`${file}|${look}`);
		if (other && other !== name)
			problems.push({
				file,
				fault: `ambient ${name} wears ${look}, as ${other} here does: one look per person in a place`,
			});
		else if (look) wornIn.set(`${file}|${look}`, name);
		const before = first.get(name);
		if (before === undefined) first.set(name, file);
		else if (before !== file)
			problems.push({ file, fault: `ambient ${name} stands here and in ${before}: one person, one place` });
		else problems.push({ file, fault: `ambient ${name} stands here twice: one person, one place` });
	}
	const fault = (text: string) => problems.push({ file: "theme.json", fault: text });
	for (const name of Object.keys(cast)) if (!first.has(name)) fault(`ambient.${name} stands in no place`);
	if (isObject(looks)) checkCastLooks(cast, looks, isCrew, fault);
}

function checkCastLooks(
	cast: Record<string, unknown>,
	looks: Record<string, unknown>,
	isCrew: (name: string) => boolean,
	fault: (text: string) => void,
) {
	const town = new Map<string, string>();
	for (const [name, member] of Object.entries(cast))
		if (!isCrew(name) && isObject(member) && isText(member.look) && !town.has(member.look)) town.set(member.look, name);
	for (const [name, member] of Object.entries(cast)) {
		if (!isObject(member) || !isText(member.look)) continue;
		const look = looks[member.look];
		const crew = isCrew(name);
		if (!isObject(look)) fault(`ambient.${name} wears ${member.look}, which looks.json does not name`);
		else if (crew && !CREW_LOOK_ROLES.includes(String(look.role)))
			fault(`ambient.${name} wears ${member.look}, which is not a townsfolk or ambient look`);
		else if (!crew && look.role !== "ambient")
			fault(`ambient.${name} wears ${member.look}, which is not an ambient look`);
		else if (crew && town.has(member.look))
			fault(`ambient.${name} wears ${member.look}, which ambient.${town.get(member.look)} wears too`);
	}
}

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
			if (look.idle !== undefined) await checkIdle(reader, name, look.idle, pixels, problems);
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

async function checkPlaces(reader: PackReader, problems: PackProblem[]) {
	const hosts: string[] = [];
	const hostOf: Record<string, string> = {};
	const recruiterOf: Record<string, string> = {};
	const slotKinds = new Set<string>();
	const fidgets = new Map<FidgetKind, string>();
	const pets: PetsPlaced = [];
	const cast: CastPlaced = [];
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
		if (Array.isArray(data.ambient))
			for (const entry of data.ambient)
				if (isObject(entry) && isText(entry.cast)) cast.push({ file, cast: entry.cast });
		if (isObject(data.recruiter) && typeof data.recruiter.look === "string") {
			hosts.push(data.recruiter.look);
			recruiterOf[name] = data.recruiter.look;
		}
		for (const slot of Array.isArray(data.overlaySlots) ? data.overlaySlots : []) {
			if (!isObject(slot)) continue;
			slotKinds.add(String(slot.kind));
			if (slot.kind === "fidget" && isFidget(slot.fidget) && !fidgets.has(slot.fidget)) fidgets.set(slot.fidget, file);
			if (slot.kind === "fidget" && (slot.fidget === "pet" || slot.fidget === "sleeper"))
				pets.push({ file, slot: slot as unknown as OverlaySlot });
		}
	}
	return { hosts, hostOf, recruiterOf, slotKinds, fidgets, pets, cast };
}

export async function checkPack(reader: PackReader, id: string, { pixels = true } = {}): Promise<PackProblem[]> {
	const problems: PackProblem[] = [];
	const manifest = checkManifest(await json(reader, "theme.json", problems), id, problems);
	if (manifest && typeof manifest.skin === "string") await checkSkin(reader, manifest, problems);
	const { hosts, hostOf, recruiterOf, slotKinds, fidgets, pets, cast } = await checkPlaces(reader, problems);
	const looks = await json(reader, "characters/looks.json", problems);
	if (looks !== undefined) await checkLooks(reader, looks, hosts, pixels, problems);
	if (manifest) checkCastPlaced(manifest, looks, cast, problems);
	for (const [place, look] of Object.entries(hostOf)) {
		const role = PLACE_NEEDS[place]?.host;
		const worn = isObject(looks) && isObject(looks[look]) ? looks[look].role : undefined;
		if (role && worn !== undefined && worn !== role)
			problems.push({ file: `places/${place}.json`, fault: `its host wears ${look}, which is not a ${role} look` });
	}
	for (const [place, look] of Object.entries(recruiterOf)) {
		const worn = isObject(looks) && isObject(looks[look]) ? looks[look].role : undefined;
		if (worn !== undefined && worn !== "recruiter")
			problems.push({
				file: `places/${place}.json`,
				fault: `its recruiter wears ${look}, which is not a recruiter look`,
			});
	}
	if (slotKinds.has("bed") && manifest && isObject(manifest.world) && manifest.world.bed === undefined)
		problems.push({ file: "theme.json", fault: "has no world.bed, which its places' bed slots need" });
	const styles = manifest && isObject(manifest.fidgets) ? manifest.fidgets : {};
	for (const [kind, place] of fidgets)
		if (manifest && !isObject(styles[kind]))
			problems.push({ file: "theme.json", fault: `has no fidgets.${kind}, which ${place} places` });
	const overlays = [
		...REQUIRED_OVERLAYS,
		...[...slotKinds].flatMap((kind) => SLOT_OVERLAYS[kind] ?? []),
		...[...fidgets.keys()].flatMap((kind) => (kind === "pet" ? [] : FIDGETS[kind].art)),
		...checkPets(pets, styles.pet, problems),
	];
	for (const name of new Set(overlays)) {
		const file = `overlays/${name}.png`;
		if (!(await reader.image(file))) problems.push({ file, fault: "is missing" });
	}
	return problems.sort((a, b) => a.file.localeCompare(b.file) || a.fault.localeCompare(b.fault));
}

export function describeProblems(problems: PackProblem[]): string[] {
	return problems.map(({ file, fault }) => `${file}: ${fault}`);
}
