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

/**
 * Frames in a look's idle sheet (`<look>-idle.png`, optional): standing poses played now and then by someone standing
 * about, in this order.
 */
export const IDLE_POSES = ["look-left", "look-right", "stretch", "wave", "laugh", "shrug", "nod", "yawn"] as const;

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
	/** The second exterior, joined to the square (ticket 09 of the alive pass): a harbour lane, a shop street. */
	"street",
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
	"street",
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
	/** The square's recruiter, who recruits independent agents at its booth (ticket 10). */
	"recruiter",
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

/**
 * Overlays every pack draws: doors in three states, the wing banner, the birds that carry mail, and the pointer's art
 * (the cursor's hand pointing, tapping, and as a fist, and the yellow and red click markers).
 */
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

/**
 * Fidget objects (decision 27): pure play in a place's `fidget` slots, never work. Each kind names its sprites and its
 * plays, the first of which is what a left click does (a toggle offers the one that fits its state). A pack that
 * places a kind draws its sprites and names it in `theme.json`'s `fidgets` (its name, an Examine line, and a verb for
 * each play); a pack that places none needs neither. `w` is how wide it stands, in tiles, unless the pack or the slot
 * says otherwise.
 */
export const FIDGETS = {
	/**
	 * A pet (a cat, a dog, an owl): four poses (`FidgetStyle.frames`). A slot's `look` draws one of the pack's other
	 * pets (`pet-<look>-0..3`) instead of these.
	 */
	pet: { art: ["pet-0", "pet-1", "pet-2", "pet-3"], plays: ["pet", "play"], w: 0.95 },
	/** A globe, a spinner, a goldfish bowl: four frames of one loop. */
	spin: { art: ["spin-0", "spin-1", "spin-2", "spin-3"], plays: ["spin", "nudge"], w: 0.65 },
	/** A bell on a stand, still and ringing. */
	bell: { art: ["bell-still", "bell-ringing"], plays: ["ring", "peal"], w: 0.6 },
	/** A bell in the hand, rung by swinging it. */
	handbell: { art: ["bell"], plays: ["ring", "peal"], w: 0.32 },
	/** A candelabra, a lamp, a lantern: off and on, with a glow. */
	light: { art: ["light-off", "light-on"], plays: ["on", "off"], w: 0.5 },
	/** A music box, an espresso machine, a bento: closed and open. */
	box: { art: ["box-closed", "box-open"], plays: ["open", "close"], w: 0.7 },
	/** A pet curled up asleep. */
	sleeper: { art: ["cat-sleeping"], plays: ["pet", "boop"], w: 0.95 },
	/** A lit candle or lamp that stays lit. */
	candle: { art: ["candle"], plays: ["blow", "cup"], w: 0.36 },
	/** A book, a tablet, a notebook: leafed through, it shows a line. */
	tome: { art: ["tome"], plays: ["leaf"], w: 0.75 },
} as const satisfies Record<string, { art: readonly string[]; plays: readonly string[]; w: number }>;

export type FidgetKind = keyof typeof FIDGETS;

/** The little drawn things a play gives off. */
export const FIDGET_PARTICLES = ["hearts", "notes", "sparkles", "steam", "bubbles", "smoke", "zzz"] as const;
export type FidgetParticle = (typeof FIDGET_PARTICLES)[number];

/**
 * What a pet's sprites show, one each: sitting (how it rests), petted with its eyes closed, a playful pose, stretching,
 * and curled up asleep. A pet has four, `sit`, `petted`, and `play` among them.
 */
export const PET_FRAMES = ["sit", "petted", "play", "stretch", "sleep"] as const;
export type PetFrame = (typeof PET_FRAMES)[number];
/** The order of a pet's sprites where its style does not say. */
export const PET_FRAME_ORDER: readonly PetFrame[] = ["sit", "petted", "play", "sleep"];

/** A pet's four sprites: the kind's own (`pet-0..3`), or those of one of the pack's other pets (`pet-<look>-0..3`). */
export const petArt = (look?: string): string[] =>
	look ? [0, 1, 2, 3].map((frame) => `pet-${look}-${frame}`) : [...FIDGETS.pet.art];

/**
 * A fidget slot's style: for a pet with a `look`, that look's own name, Examine line, size, frames, and reactions over
 * the kind's (its verbs fall back to the kind's, play by play).
 */
export function slotStyle(style: FidgetStyle, slot: Pick<OverlaySlot, "look">): FidgetStyle {
	const own = slot.look ? style.looks?.[slot.look] : undefined;
	if (!own) return style;
	// Its frames are its own sprites' (the kind's describe `pet-0..3`).
	return { ...style, ...own, verbs: { ...style.verbs, ...own.verbs }, frames: own.frames, looks: undefined };
}

/** How a pack names and dresses one kind of fidget object (`theme.json`'s `fidgets`). */
export interface FidgetStyle {
	/** What it is called in hover text and the menu ("Ginger cat"); a slot's own `name` wins. */
	name: string;
	/** What Examine says; `{name}` is filled in. */
	examine: string;
	/** The verb for each of the kind's plays ("Pet", "Play with"). */
	verbs: Record<string, string>;
	/** Its width in tiles where a slot gives none. */
	w?: number;
	/** What its main play gives off, instead of the kind's own. */
	particle?: FidgetParticle;
	/** A tome's lines, one shown each time it is leafed through. */
	lines?: string[];
	/**
	 * A pet's height sitting (its `sit` sprite), as a share of a standing character's: a cat about a third, a dog about
	 * half, an owl or a hamster less. It sets the pet's size where a slot gives no width.
	 */
	height?: number;
	/** What each of a pet's four sprites shows, in order (`PET_FRAMES`). Default: sit, petted, play, sleep. */
	frames?: PetFrame[];
	/**
	 * The pack's other pets, by look (`pet-<look>-0..3`): each its own animal or coat, with its own name and Examine
	 * line, and its own verbs, particle, height, and frames where they differ from the kind's.
	 */
	looks?: Record<string, PetLook>;
}

/** One of a pack's other pets (`FidgetStyle.looks`). */
export type PetLook = Pick<FidgetStyle, "name" | "examine" | "particle" | "height" | "frames"> & {
	verbs?: Record<string, string>;
};

/** The idles a cast member may play as its gesture when it reacts (the world's idles, `character-life.ts`). */
export const AMBIENT_GESTURES = ["look-around", "stretch", "wave", "laugh", "shrug", "nod", "yawn"] as const;
export type AmbientGesture = (typeof AMBIENT_GESTURES)[number];
/** A cast member says at least this many lines in turn. */
export const AMBIENT_LINES = 3;

/**
 * One of a pack's ambient characters (ticket 08, `theme.json`'s `ambient`, by cast name): there only for fun and
 * immersion. Talked to, it says its `lines` in turn in the small dialogue box; clicked several times in a row, one of
 * its `reactions`; now and then, standing about, one of its `barks` in a speech bubble. It sends no command and makes
 * no outside call. Its place data (`PlaceData.ambient`) says where it stands.
 */
export interface AmbientMember {
	/** What hover text and the menu call it ("Pip the bard"). */
	name: string;
	/** Its look, one whose role is `ambient` (for the headquarters crew, `ambient` or `townsfolk`). */
	look: string;
	/** What Examine says. */
	examine: string;
	lines: string[];
	reactions: string[];
	barks?: string[];
	/** The idle it plays when it reacts (default: a shrug). */
	gesture?: AmbientGesture;
	/**
	 * The headquarters crew: the staff of every headquarters, standing in the headquarters or its common room, which the
	 * world shows once per coordinator, so it stands in each one.
	 */
	crew?: boolean;
}

/**
 * Where a cast member stands in a place (`PlaceData.ambient`): its feet at `at`, on open floor clear of doors' stand
 * points, entries, spots, the host, the recruiter, points of interest, and the rest of the cast, facing `face` (else
 * the room). It strolls to the place's points of interest unless it `stay`s at its post.
 */
export interface AmbientPlacement {
	cast: string;
	at: Point;
	face?: "up" | "down" | "left" | "right";
	stay?: boolean;
}

/**
 * What a place must have beyond the shared format: its host's look role, slots it cannot do without, a recruiter (and
 * why), and furniture by its `use` (and why).
 */
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
	/**
	 * Recruiting (ticket 10): the action at the coordinator's desk (a worker) and at the square's recruiter (an
	 * independent agent); each form's title ({coordinator} names the worker's) and what its host says; the brief's
	 * placeholder; the send button; while it opens; and once {name} has joined.
	 */
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
	/**
	 * The organization: the hire form's role field and its line for a session hired into no role; retiring a person
	 * (the action, the form's title for {name}, the reason's placeholder, the send button, and once it has left); and
	 * the mark on a former member at the inn.
	 */
	"recruit-role",
	"recruit-no-role",
	"retire",
	"retire-title",
	"retire-reason",
	"retire-send",
	"retire-done",
	"retired",
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
 * The side panel's tabs whose icon a pack may draw: an optional style token `--aw-icon-<tab>` naming an SVG in the pack
 * (`url(interface/icons/work.svg)`), drawn in the tab's ink through a mask. A tab without one wears the world's own.
 */
export const TAB_ICONS = ["agents", "needs-you", "work", "mail", "slack", "places", "settings"] as const;

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
	/**
	 * The names on the square's building signs (a door's `sign`): their face, `ink`, and an optional `shadow` under the
	 * letters; `upper` sets them in capitals. `plate` colours the board the world draws where a sign asks for one (its
	 * `fill`, its `rim`, and the dark `edge` around it). Absent: the small sign's colours (`tag`).
	 */
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
	/** Each kind of fidget object its places hold (`FIDGETS`), by kind; optional. */
	fidgets?: Partial<Record<FidgetKind, FidgetStyle>>;
	/** Its ambient characters (ticket 08), by cast name; optional. */
	ambient?: Record<string, AmbientMember>;
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
	/**
	 * The building's sign board (tiles), where the world letters the place's name. With `plate`, the world draws the
	 * board as well: where the painting has none, or one too small for a name to read.
	 */
	sign?: { rect: Rect; plate?: boolean };
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
	/**
	 * The square's recruiter (ticket 10), standing at its booth with its feet at `at`, on open floor in sight, facing the
	 * room: talking to it recruits an independent agent. It wears `look` when given, else the pack's first `recruiter`
	 * look, else a townsperson's.
	 */
	recruiter?: { look?: string; at: Point };
	/**
	 * Furniture that answers the pointer, such as the inn's tables: `use` names what the place does with it (`recruit`:
	 * the coordinator's desk, which recruits a worker; `notes`: the board that opens the coordinator's notepad).
	 */
	furniture?: { name: string; rect: Rect; use: string }[];
	/**
	 * A place that grows with what it holds (the gallery): the painting's niches, and how to cut it into vertical
	 * strips for a given number of them. Beyond the largest layout, the `repeat` strip is inserted once per extra
	 * niche, just before its right edge. Positions inside a niche are relative to its centre.
	 */
	/**
	 * Points of interest (a stall, the fountain, a bench, a window): where those standing about stroll to and pause,
	 * facing `face` when given (else the room). Each is open floor, a tile clear of doors' stand points and entries and
	 * clear of where others stand.
	 */
	interest?: { name: string; at: Point; face?: "up" | "down" | "left" | "right" }[];
	/** The pack's ambient characters standing here (ticket 08), each named in `theme.json`'s `ambient`. */
	ambient?: AmbientPlacement[];
	/** What moves in the place besides its characters, and its lit windows out of doors (ticket 11): `Atmosphere`. */
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

/**
 * Where an overlay goes over a painting. `fire` stands on the hearth floor at `at` (its bottom centre), `w` tiles
 * wide; `water` fills the ellipse at `at` with radii `rx`, `ry`, except `hole` (a polygon, such as a fountain's
 * pillar); `glow` is warm light around a lantern or candle at `at`, `r` tiles across its halo; `banner` hangs its rod
 * at `at`; `fidget` is a bare spot (floor or a furniture top) where a `fidget` object stands, its bottom centre at `at`,
 * `w` tiles wide; `bed` stands a bed `w` tiles wide with its foot's
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
	/** Brief-named slots (a forge's mats, a notice board) carry a name; a fidget's names it ("Biscuit"). */
	name?: string;
	/** A `fidget` slot's kind of object (`FIDGETS`): drawn standing with its bottom centre at `at`, `w` tiles wide. */
	fidget?: FidgetKind;
	/** A pet's look, one of `fidgets.pet.looks` (absent: the kind's own `pet-0..3`). No two places share one. */
	look?: string;
	/** A pet curled up asleep at rest (on its `sleep` sprite), which play wakes for a while. */
	asleep?: boolean;
	/** A light (or a box) that starts on (or open) when the app starts. */
	on?: boolean;
}

/** The kinds of atmosphere a place may have (`Atmosphere`). */
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
/** What a `fall` lets fall and what crosses a `sky`. */
export const ATMOSPHERE_WHAT: Partial<Record<(typeof ATMOSPHERE_KINDS)[number], readonly string[]>> = {
	fall: ["leaves", "petals"],
	sky: ["birds", "plane"],
};

/**
 * Ambient motion that is not a character, drawn by the world in code (ticket 11). `motes`: dust drifting in the light
 * over `rect` (the whole place without one); `fall`: `what` (leaves or petals) drifting down over the place, or over
 * `rect`; `sky`: `what` (a flock of birds or a plane) crossing now and then; `steam`: wisps rising from `at` (a cup, a
 * kettle, a quench trough), `w` tiles wide; `sparks`: embers rising from a fire at `at`; `blink`: small lights blinking
 * over `rect` (a server rack's LEDs), in `colors`; `screens`: the soft, flickering light of each screen in `rects`;
 * `shimmer`: glints on the water inside `rect` (only where the painting is water); `lights`: out of doors, the painted
 * windows and lamps inside `rects` (their bright, warm pixels) lit above the evening and night tint. `count` is how
 * many at once where that applies.
 */
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
	/** Who wears it: agents, the coordinator, the operator's avatar, townsfolk, or a host such as the innkeeper. */
	role: "agent" | "coordinator" | "avatar" | "townsfolk" | (string & {});
	/** One frame of the 16-frame strip, in px. */
	frame: [width: number, height: number];
	/** The feet's row in each frame, in px from the top. */
	baseline: number;
	/** Its idle sheet (`<look>-idle.png`, the `IDLE_POSES` in a strip), when it has one: a frame's size and baseline. */
	idle?: { frame: [width: number, height: number]; baseline: number };
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

/** The manifest's `fidgets`, when there: each a known kind with its name, Examine line, and a verb for every play. */
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

/** A pet's height and frames, and each of its other looks: a name, an Examine line, and verbs only for its plays. */
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

/** A pet's height (a share of a standing character's) and its four frames, when given. */
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

/** Where a pack's pets are: each place's pets (and sleepers), by place file. */
type PetsPlaced = { file: string; slot: OverlaySlot }[];

/**
 * Fewer pets, each its own: a place holds at most one pet (a curled-up sleeper counts), no two places share a pet's
 * look (nor two hold a sleeper), each look is one the pack names, and an asleep pet has a sleep frame. Returns the
 * sprites the placed looks need.
 */
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
		// Without the pack's pet names (reported on their own), its sprites are still needed.
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

/** A door's sign board, when it has one: a rect inside the grid. */
function checkSign(door: Door, rectInside: (rect: Rect) => boolean, fault: (text: string) => void) {
	if (door.sign === undefined) return;
	if (!isObject(door.sign) || !isRect(door.sign.rect)) fault(`door ${door.name}'s sign has no rect [x, y, w, h]`);
	else if (!rectInside(door.sign.rect)) fault(`door ${door.name}'s sign ${fmt(door.sign.rect)} lies outside its grid`);
}

/** A bed names a spot the place has; a `fidget` slot names a known kind, and a width in tiles if it gives one. */
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

/**
 * Recruiting (ticket 10): a recruiter stands on open floor, and a place that needs one (the square) has it; a place
 * that needs furniture of a `use` (the headquarters' recruiting desk) has a piece of it.
 */
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

	// Where characters stand must be open floor: what the avatar can walk to.
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

/** A place's atmosphere (ticket 11): each entry a known kind, inside the grid, naming what it may. */
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

/**
 * A look's idle sheet, when looks.json names one: its strip of `IDLE_POSES` frames in the size it gives, each on its
 * baseline (with pixels).
 */
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

/**
 * A place's points of interest: each named, on open floor inside its grid, a tile clear of every door's stand point and
 * every entry (a wanderer never stands in a doorway), and clear of every spot, the host, and the recruiter.
 */
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

/** The manifest's ambient cast (ticket 08), when there: each a cast name with its name, look, Examine line, and lines. */
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

/**
 * Where a place's cast members stand: each names one, on open floor inside the grid, a tile clear of every door's stand
 * point and entry, and clear of every spot, the host, the recruiter, the points of interest, and one another.
 */
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

/** Which cast member stands in which place file. */
type CastPlaced = { file: string; cast: string }[];
/** Rooms the world shows once per coordinator or per wing: a cast member there would stand in every copy. */
const REPEATING_ROOMS = ["headquarters", "common-room", "wing-small", "wing-large"].map(
	(name) => `places/${name}.json`,
);
/** Where the headquarters crew stands (in every coordinator's copy), and the looks it may wear. */
const CREW_ROOMS = ["headquarters", "common-room"].map((name) => `places/${name}.json`);
const CREW_LOOK_ROLES = ["townsfolk", "ambient"];

/**
 * The cast against its places and looks: every member stands in exactly one place (one person, one place), every one
 * standing is a member, each wears a look of the `ambient` role, and no two in one place wear the same look. The
 * headquarters crew (`crew`) stands only in the headquarters or its common room, which repeat per coordinator, in an
 * `ambient` or `townsfolk` look that no one outside the crew wears; everyone else stays out of rooms that repeat.
 */
function checkCastPlaced(manifest: ThemeManifest, looks: unknown, placed: CastPlaced, problems: PackProblem[]) {
	const cast = isObject(manifest.ambient) ? manifest.ambient : {};
	const isCrew = (name: string) => isObject(cast[name]) && cast[name].crew === true;
	const lookOf = (name: string) => (isObject(cast[name]) && isText(cast[name].look) ? cast[name].look : undefined);
	const first = new Map<string, string>();
	/** Who wears which look, per place file. */
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

/** Each cast member's look: an `ambient` one, or for the crew a townsperson's too, never one the rest of the cast wears. */
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
	/** The look each place's recruiter names, by place. */
	const recruiterOf: Record<string, string> = {};
	const slotKinds = new Set<string>();
	/** The kinds of fidget object placed, and the first place file placing each. */
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

/**
 * Check the pack `id` read through `reader`: its manifest and skin, every place over its painting, every look's sheet
 * and portraits, and the overlays it needs. `pixels` also checks each sheet's frames stand on its baseline at the
 * standing height (it reads every sheet's pixels). Returns every problem found, in a stable order; none means good.
 */
export async function checkPack(reader: PackReader, id: string, { pixels = true } = {}): Promise<PackProblem[]> {
	const problems: PackProblem[] = [];
	const manifest = checkManifest(await json(reader, "theme.json", problems), id, problems);
	if (manifest && typeof manifest.skin === "string") await checkSkin(reader, manifest, problems);
	const { hosts, hostOf, recruiterOf, slotKinds, fidgets, pets, cast } = await checkPlaces(reader, problems);
	const looks = await json(reader, "characters/looks.json", problems);
	if (looks !== undefined) await checkLooks(reader, looks, hosts, pixels, problems);
	if (manifest) checkCastPlaced(manifest, looks, cast, problems);
	// A function place's host wears a look made for its role (the quest office's clerk, not an agent).
	for (const [place, look] of Object.entries(hostOf)) {
		const role = PLACE_NEEDS[place]?.host;
		const worn = isObject(looks) && isObject(looks[look]) ? looks[look].role : undefined;
		if (role && worn !== undefined && worn !== role)
			problems.push({ file: `places/${place}.json`, fault: `its host wears ${look}, which is not a ${role} look` });
	}
	// A recruiter named a look wears one made for it; without one it borrows the pack's recruiter or a townsperson.
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
	// Fidget objects are optional, but one a place holds is drawn and named by the pack.
	// A manifest that did not read is reported once, not again for every kind its places hold.
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

/** A pack's problems as lines a theme author reads: `file: fault`. */
export function describeProblems(problems: PackProblem[]): string[] {
	return problems.map(({ file, fault }) => `${file}: ${fault}`);
}
