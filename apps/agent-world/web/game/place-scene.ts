import * as Phaser from "phaser";
import { type Character, isOutside, type MailItem, OPERATOR, type PlaceRef, placeKey } from "../../src/world.js";
import { avatarLookIn, lookFor } from "../looks.js";
import { atlassian } from "../overlay/places/atlassian-state.js";
import { forge } from "../overlay/places/forge-state.js";
import { notepad } from "../overlay/places/notepad-state.js";
import { placeActions, placePanels } from "../overlay/places/place-panels.js";
import { recruiterLook, recruiting } from "../overlay/places/recruit-state.js";
import { renaming } from "../overlay/places/rename-state.js";
import { retiring } from "../overlay/places/retire-state.js";
import { squarePanels } from "../overlay/places/square-panels.js";
import { workplacePanels } from "../overlay/places/workplace-state.js";
import { ClickMarks, type MarkView } from "../overlay/pointer/click-marks.js";
import { type CursorArt, type CursorKind, cursorArt, cursorCss } from "../overlay/pointer/cursor.js";
import { pointer } from "../overlay/pointer/pointer-state.js";
import { type Door, type OverlaySlot, type Point, type Rect, say, type Theme, TILE } from "../theme.js";
import { worn } from "../theme-store.js";
import type { ViewStore, WorldIntent } from "../view-state.js";
import type { WorldStore } from "../world-store.js";
import { type Action, action, type Target } from "./actions.js";
import { AmbientCast, type AmbientView } from "./ambient.js";
import { AtmosphereLayer, type AtmosphereView, glowDepth, keepLit } from "./atmosphere.js";
import { Birds, type BirdView, type Perch } from "./birds.js";
import {
	type BadgeKind,
	type BarkShape,
	badgeFor,
	barkFor,
	drawBadge,
	drawBark,
	drawTag,
	drawZzz,
	needsYou,
	poseFor,
	tempoFor,
} from "./character-life.js";
import { floorFidgets } from "./fidget-spots.js";
import { Fidgets, type FidgetView, type Glow } from "./fidgets.js";
import { assignSpots, charactersIn, type Layout, layoutFor, startPlace, walkGrid } from "./layout.js";
import { cellOf, clearanceAt, findPath, type Grid, gridFor, isOpen } from "./pathing.js";
import { ForgeBenches, type WorkView } from "./places/forge.js";
import { type NoticeView, noticeTexture, QuestBoard } from "./places/quest-office.js";
import { drawSigns, type SignView, SquareLife, type TownsfolkView } from "./places/square.js";
import { type Facing, PERSON_TILES, type Pose, Walker, type WalkerView } from "./walker.js";
import { Wander, type WanderView } from "./wander.js";

/** A `#rrggbb` colour as its red, green, and blue. */
const rgb = (hex: string): [number, number, number] => {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const STANDING = 120; // sprite px from head to feet in a standing frame
const FADE_OUT_MS = 240;
const FADE_IN_MS = 320;
const PAN_SPEED = 900; // world px per second with the arrow keys
const DRAG_THRESHOLD = 6; // screen px before a press becomes a drag
const SEAM_PX = 24; // painting px over which two strips of a growing place blend
/** The banner's name, largest first, down to the smallest size that still reads at the default zoom. */
const BANNER_FONT = [15, 12] as const;
/** A name stays on one line down to this size before it is broken onto more. */
const BANNER_ONE_LINE = 13;
/** Abbreviated words keep at most this many letters; abbreviated names may take this many lines (12 px fits five). */
const BANNER_ABBREVIATION = 6;
const BANNER_LINES_SHORT = 5;
/** How quickly the camera catches up with the avatar (per second); higher is tighter. */
const FOLLOW_RATE = 4.5;
/** How quickly the zoom eases to the wheel's choice (per second). */
const ZOOM_RATE = 10;
const MAX_ZOOM = 2;
/** The camera centres on the avatar's chest, not its feet. */
const FOLLOW_LIFT = PERSON_TILES / 2;
/**
 * Where the avatar stands to talk to someone, in tiles from their feet, in order of preference: beside them or a
 * little in front to either side (whichever is quickest), where neither body hides the other; failing those, well in
 * front or just behind.
 */
const TALK_OFFSETS: Point[][] = [
	[
		[-1.1, 0.05],
		[1.1, 0.05],
		[-1, 0.8],
		[1, 0.8],
	],
	[
		[0, 2.1],
		[0, -0.9],
	],
];
/** How far the avatar steps on into a door while the view fades out. */
const STEP_IN = 0.7;
/** How far a walk may end from where it was meant to before the avatar says it cannot reach. */
const REACH = 0.35;
/** Over how many tiles a character fades in after coming through a door, or out going through one. */
const DOOR_FADE = 0.9;
/** Water: how long each ripple frame takes to flow into the next (ms), and how opaque it lies in its basin. */
const WATER_FRAME_MS = 700;
const WATER_ALPHA = 0.92;
/** Over how many world px the water's edge fades into its basin. */
const WATER_FEATHER = 5;
/** Where a badge floats, in tiles above the feet, by pose (a raised hand reaches higher than a head). */
const BADGE_LIFT: Record<Pose, number> = {
	standing: 2.12,
	seated: 2.12,
	busy: 2.16,
	asking: 2.12,
	dozing: 2.12,
	"in-bed": 2.12,
};
/** Where a dozing sleeper's "z" rises from, in tiles above its feet (just over its head at the table). */
const Z_LIFT = 1.3;
/** Sleepers are drawn a little dimmer and cooler, as if the lamps did not reach them. */
const SLEEP_TINT = 0xd2c8dc;
/** A sleeper's head and shoulders, cut from its standing frame: from this far above its feet (sheet px), this tall. */
const HEAD_CUT = [124, 50] as const;
const HEAD_SCALE = 0.84;
/** A character that needs the operator barks this long after it starts to, then every so often; each bark lasts. */
const FIRST_BARK_MS = [1200, 2200] as const;
const BARK_EVERY_MS = [22_000, 38_000] as const;
const BARK_MS = 4200;
/** Below this zoom, badges and barks are drawn larger so they keep this zoom's size on screen. */
const UI_ZOOM = 1;
/**
 * Pixel art stays crisp zoomed in: a texture is drawn with nearest filtering once one of its pixels covers at least this
 * many screen pixels (sprites and overlays from 1; paintings, which are painted rather than pixel-gridded, from 1.5),
 * and smoothed below that, so nothing shimmers or loses its outline when drawn smaller than its source.
 */
const CRISP_FROM = { sprite: 1, painting: 1.5 } as const;
/** How often (ms) textures are looked over for the filtering their size on screen needs, besides on every zoom. */
const REFILTER_EVERY_MS = 500;
/** How often the interface's panels are measured for how far the painting may slide out from under them. */
const INSETS_EVERY_MS = 300;
/** At most this many barks show in a place at once, so a busy room stays calm. */
const BARKS_AT_ONCE = 2;
/** How long a bark takes to fade in or out (ms), and how far it rises as it comes (px). */
const BARK_FADE_MS = 320;
const BARK_RISE = 5;
/** Space kept round a bark on screen (CSS px): from other barks and from the interface. */
const BARK_MARGIN = 6;
/** A focused goal is a small notice held at the hip: its width and its foot relative to the character's feet (tiles). */
const QUEST_TILES = 0.32;
const QUEST_AT: Point = [0.3, -0.42];
/** A bark that has no room waits this long (ms) before it tries again. */
const BARK_RETRY_MS = 2500;

/** A character in the place: walking in, at its spot, or walking out after its session stopped. */
interface Figure {
	character: Character;
	walker: Walker;
	look: string;
	/** Its spot's feet position; undefined while it walks out. */
	spot?: Point;
	/** Its session left this place: it walks out through the door and is gone. */
	leaving: boolean;
	/** Fading in from, or out toward, this point in a doorway. */
	fade?: { at: Point; out: boolean };
	badge?: { kind: BadgeKind; container: Phaser.GameObjects.Container };
	/** The focused goal it carries at its side. */
	quest?: Phaser.GameObjects.Image;
	/**
	 * Its bark: the line, its shape, when it starts to fade out, how far its bubble slides sideways (px) to keep clear,
	 * and how much of it shows (eased toward 1 while it has room, toward 0 while it is covered or going).
	 */
	bark?: { line: string; shape: BarkShape; until: number; shift: number; shown: number; going: boolean };
	/** When it barks next (scene time, ms), while it needs the operator. */
	nextBark?: number;
	barks: number;
	/** The index of the spot it holds. */
	spotIndex?: number;
	/** Asleep at the inn: its rising "z", and in a bed, its head on the pillow under the quilt. */
	sleep?: { z: Phaser.GameObjects.Container; bed?: InBed; breath?: Phaser.Tweens.Tween };
}

/** A sleeper in a bed: its head on the pillow, the quilt drawn over it, and the bed (tiles) that answers the pointer. */
interface InBed {
	head: Phaser.GameObjects.Image;
	quilt: Phaser.GameObjects.Image;
	rect: Rect;
	pillow: Point;
}

/** A door as the scene uses it: a painted door from the place data, or a wing door placed in the gallery. */
interface SceneDoor extends Door {
	repository?: string;
	boarded?: boolean;
}

export interface FigureView {
	id: string;
	name: string;
	x: number;
	y: number;
	look: string;
	pose: Pose;
	moving: boolean;
	frame: number;
	badge: BadgeKind | null;
	quest: string | null;
	bark: string | null;
	/** Where its bark's bubble is on screen (CSS px) while it shows. */
	barkBox: Box | null;
	alpha: number;
	/** The idle it is playing, and where it is in a wander (tickets 06 and 07). */
	idle: string | null;
	wander: WanderView["state"];
	interest: string | null;
}

export interface OverlayView {
	kind: OverlaySlot["kind"];
	x: number;
	y: number;
	/** The animation frame shown (fire, water), else 0. */
	frame: number;
	alpha: number;
}

export interface BannerView {
	name: string;
	/** What is stitched on it, lines joined by newlines. */
	text: string;
	/** Its font size, in px at zoom 1. */
	size: number;
	/** The text stays inside the cloth. */
	fits: boolean;
	/** Some words were cut short to fit (the full name shows on hover). */
	abbreviated: boolean;
}

export interface DoorView {
	name: string;
	to: string;
	boarded?: boolean;
	/** The door's centre on screen, in CSS px. */
	x: number;
	y: number;
}

export interface AvatarView extends WalkerView {
	look: string;
}

// Which spot each character holds, per place, for as long as the app runs; and view choices that outlive a scene.
const heldSpots = new Map<string, Map<string, number>>();
let showGrid = false;
/**
 * Key presses already handled. Phaser's keyboard plugin runs its whole queue of the frame's key events again for each
 * new event, skipping only a repeat of the very last one, so after another key's release (Escape's, closing a panel) a
 * G pressed and released in the same frame came round twice and toggled the grid back off.
 */
const handledKeys = new WeakSet<KeyboardEvent>();

/** A new theme lays its places out its own way: who held which spot no longer means anything. */
export function forgetSpots() {
	heldSpots.clear();
	SquareLife.forget();
}
let lastHeadquarters: string | undefined;
/** The zoom the operator chose with the wheel, per painting: each place keeps its own. */
const chosenZoom = new Map<string, number>();

interface SceneData {
	ref?: PlaceRef;
	/** Where the avatar comes from, keying the entry it arrives at. */
	from?: string;
	/** Laying the same place out again: keep the avatar and the view where they were. */
	keep?: { avatar: Point; facing: Facing; mid: Point };
	/** On arrival, walk up to this character (going to it from the side panel). */
	goTo?: string;
}

/** The current place: its painting, the characters at its spots, the operator's avatar, and doors that lead elsewhere. */
export class PlaceScene extends Phaser.Scene {
	private readonly store: WorldStore;
	private readonly view: ViewStore;
	private layout!: Layout;
	private from?: string;
	private keep?: SceneData["keep"];
	private figures = new Map<string, Figure>();
	/** The banners hung in the place, and how their names were stitched. */
	private banners: BannerView[] = [];
	/** Where each banner's cloth is (tiles), answering the pointer with the full name. */
	private bannerRects: { name: string; rect: Rect }[] = [];
	/** The overlays drawn in the place's slots, for the tests' view. */
	private overlays: { slot: OverlaySlot; object: Phaser.GameObjects.Image; frame?: () => number }[] = [];
	private doors: SceneDoor[] = [];
	/** The painting's images as drawn (the whole painting, or the strips of a growing place), for the tests' view. */
	private paintingImages: Phaser.GameObjects.Image[] = [];
	/** The inn's beds, by the spot whose sleeper lies in each. */
	private beds = new Map<number, { slot: OverlaySlot; image: Phaser.GameObjects.Image }>();
	/** The place's host (the innkeeper), standing at its post. */
	private host?: { walker: Walker; look: string; name: string; at: Point };
	/** The square's recruiter at its booth (ticket 10): talking to it recruits an independent agent. */
	private recruiter?: { walker: Walker; look: string; name: string; at: Point };
	/** In the town square: the townsfolk who stand for Slack channels with unread messages. */
	private square?: SquareLife;
	/** The pack's ambient characters standing here, there only for fun (ticket 08). */
	private ambient?: AmbientCast;
	/** Those standing about wander a little: townsfolk, idle agents, and the host behind its counter (ticket 07). */
	private wander?: Wander;
	/** The names lettered on the buildings' sign boards (the square's). */
	private signs: SignView[] = [];
	/** At the forge: the open pull requests lying on its workbenches. */
	private benches?: ForgeBenches;
	/** At the quest office: the issues assigned to the operator, pinned on its board. */
	private questBoard?: QuestBoard;
	/** Things to fidget with in the place's `fidget` slots: pure play, never work. */
	private fidgets?: Fidgets;
	/** What moves in the place besides its characters, and out of doors the light of the time of day (ticket 11). */
	private atmosphere?: AtmosphereLayer;
	/** The place's own lamps (its `glow` slots), which out of doors glow brighter after dark; and their share now. */
	private lamps: Glow[] = [];
	private lampShare = 1;
	/** At the inn: sleepers beyond its spots, upstairs; one who comes down takes the stairs, not the front door. */
	private upstairs = new Set<string>();
	/** Messenger birds carrying mail through the place. */
	private birds!: Birds;
	/** Mail already known: only mail sent while the operator is here flies as a bird. */
	private mailSeen = new Set<string>();
	/** The rookery's open window, where its own birds come and go; and when the next one does. */
	private window?: Point;
	private nextAmbient = 0;
	private ambientCount = 0;
	/** The pile of letters on the rookery's desk, shown while mail waits. */
	private letters?: Phaser.GameObjects.Image;
	/** The tag on the inn's stairs that says how many more sleep upstairs. */
	private upstairsTag?: { count: number; tag: Phaser.GameObjects.Container };
	private gridOverlay?: Phaser.GameObjects.Graphics;
	/** With the walk grid shown, the avatar's walk: its straight runs and corners. */
	private pathOverlay?: Phaser.GameObjects.Graphics;
	private walkable!: Grid;
	private avatar!: Walker;
	private avatarLook = "";
	/** Coming in through a door: the avatar fades in over its first steps from this point in the doorway. */
	private avatarFade?: Point;
	private leaving = false;
	private drag?: { x: number; y: number; mid: Point; moved: boolean; consumed: boolean };
	private keys?: Record<"left" | "right" | "up" | "down" | "a" | "d" | "w" | "s", Phaser.Input.Keyboard.Key>;
	/** The point the camera centres on, in world px; it eases toward the avatar. */
	private mid: Point = [0, 0];
	/** Looking around (dragging, the arrow keys) holds the camera off the avatar until it walks again. */
	private freeLook?: Point;
	private zoomTarget = 1;
	private pointerAt?: Point;
	/** The cursor over the world (undefined off it) and the CSS last set; the click markers. */
	private cursor?: { kind: CursorKind; art: CursorArt };
	private cursorShown = "";
	private marks!: ClickMarks;
	private goTo?: string;
	/** How far the interface's panels reach in from each edge of the window (CSS px), measured now and then. */
	private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0, panels: [] };
	/** Where the interface's panels, the place's title, and the hover text are on screen (CSS px), measured with them. */
	private uiBoxes: Box[] = [];
	private insetsAt = -Infinity;
	/** Each texture's filtering as last set (true for nearest), and the zoom and time of the last look over them. */
	private filters = new Map<string, boolean>();
	private filteredAt = { zoom: 0, time: -Infinity };
	/** Where the avatar is leaving for, read when the fade ends (a `go-to` may add whom to walk up to). */
	private departure?: SceneData;

	constructor(store: WorldStore, view: ViewStore) {
		super("place");
		this.store = store;
		this.view = view;
	}

	/** The theme worn now: switching theme reopens the scene in the new one. */
	private get theme(): Theme {
		return worn();
	}

	init(data: SceneData) {
		const world = this.store.get();
		const ref = data.ref ?? startPlace(world);
		this.layout = layoutFor(ref, world, this.theme) ?? layoutFor(startPlace(world), world, this.theme)!;
		this.from = data.from;
		this.keep = data.keep;
		this.goTo = data.goTo;
		this.departure = undefined;
		this.filters = new Map();
		this.filteredAt = { zoom: 0, time: -Infinity };
		this.figures = new Map();
		this.banners = [];
		this.paintingImages = [];
		this.bannerRects = [];
		this.doors = [];
		this.beds = new Map();
		this.host = undefined;
		this.recruiter = undefined;
		this.ambient = undefined;
		this.square = undefined;
		this.wander = undefined;
		this.signs = [];
		this.benches = undefined;
		this.questBoard = undefined;
		this.fidgets = undefined;
		this.atmosphere = undefined;
		this.lamps = [];
		this.lampShare = 1;
		this.upstairs = new Set();
		this.upstairsTag = undefined;
		this.window = undefined;
		this.letters = undefined;
		this.nextAmbient = 0;
		this.gridOverlay = undefined;
		this.pathOverlay = undefined;
		this.avatarFade = undefined;
		this.leaving = false;
		this.drag = undefined;
		this.freeLook = undefined;
		this.pointerAt = undefined;
		if (!isOutside(this.layout.ref)) lastHeadquarters = this.layout.ref.headquarters;
	}

	create() {
		const { title, subtitle } = this.layout;
		this.view.update({ title, subtitle, chooser: undefined });
		pointer.closeMenu();
		this.drawPainting();
		this.drawForeground();
		this.drawOverlays();
		this.drawRoomDoors();
		this.drawBanners();
		this.doors.unshift(...this.layout.place.doors);
		this.wander = new Wander({
			place: () => this.layout.place,
			footprints: () => this.footprints(),
			avatar: () => this.avatar && { at: [this.avatar.x, this.avatar.y], goal: this.avatar.view().path.at(-1)! },
		});
		this.addHost();
		this.addRecruiter();
		this.addAmbient();
		this.signs = drawSigns(this, this.layout.place.doors, this.theme);
		// Townsfolk stand in the square, and those it has no room for in the street beyond it (ticket 09).
		const street = this.layout.ref.kind === "street";
		if (this.layout.ref.kind === "square" || street)
			this.square = new SquareLife(this, {
				key: () => this.layout.key,
				...(street ? { before: () => this.squareRoom() } : {}),
				place: () => this.layout.place,
				approach: (at, then) => this.approach(at, then),
				pointer: () => this.worldPointer(),
				changed: () => {
					if (!this.leaving) this.showCharacters(true);
				},
				notify: (text) => this.view.notify(text),
				wander: this.wander,
			});
		if (this.layout.ref.kind === "forge")
			this.benches = new ForgeBenches(this, {
				place: () => this.layout.place,
				walkUp: (at, then) =>
					this.walkTo(at, (reached, goal) => {
						this.avatar.face(at);
						if (reached || dist(goal, at) <= 1.2) then();
						else this.view.notify("I can't reach that bench from here.");
					}),
				pointer: () => this.worldPointer(),
				caption: (line) => this.view.update({ subtitle: line ?? this.layout.subtitle }),
				uiScale: () => Math.max(1, UI_ZOOM / this.cameras.main.zoom),
			});
		if (this.layout.ref.kind === "quest-office")
			this.questBoard = new QuestBoard(this, {
				place: () => this.layout.place,
				walkUp: (at, then) =>
					this.walkTo(at, () => {
						this.avatar.face(at);
						then();
					}),
				pointer: () => this.worldPointer(),
				uiScale: () => Math.max(1, UI_ZOOM / this.cameras.main.zoom),
			});
		this.fidgets = new Fidgets(this, {
			place: () => this.layout.place,
			placeKey: () => this.layout.key,
			walkUp: (stands, at, then) =>
				this.walkToFirst(stands, (reached, goal) => {
					this.avatar.face(at);
					if (reached || dist(goal, at) <= 1.8) then();
					else this.view.notify("I can't reach that from here.");
				}),
			glow: (at, r, level, depth) => this.addGlow({ kind: "glow", at, r }, level, false, depth),
			notify: (text) => this.view.notify(text),
			uiScale: () => Math.max(1, UI_ZOOM / this.cameras.main.zoom),
		});
		this.addAtmosphere();
		// Characters first, so the avatar arrives clear of where they stand.
		this.showCharacters(false);
		this.addAvatar();
		this.birds = new Birds(this);
		this.mailSeen = new Set((this.store.get()?.mail ?? []).map((item) => item.id));
		this.showLetters();
		if (showGrid) this.drawGrid();

		const camera = this.cameras.main;
		this.insets = interfaceInsets();
		this.zoomTarget = this.clampZoom(chosenZoom.get(this.layout.data) ?? this.defaultZoom());
		camera.setZoom(this.zoomTarget);
		this.mid = this.keep?.mid ?? this.followMid(camera.zoom);
		// The quest office's board, the library's desk, and the forge's smith stand on the north wall: arriving, the view
		// looks there first (the painting's top at the window's top), until the avatar walks.
		const kind = this.layout.ref.kind;
		if (!this.keep && (kind === "quest-office" || kind === "library" || kind === "forge")) {
			const view = this.scale.height / camera.zoom;
			this.freeLook = [this.mid[0], Math.min((this.layout.place.rows * TILE) / 2, view / 2)];
			this.mid = this.freeLook;
		}
		this.applyCamera();
		camera.setBackgroundColor(this.theme.world.backdrop);
		if (!this.keep) camera.fadeIn(FADE_IN_MS, ...rgb(this.theme.world.backdrop));

		this.scale.on("resize", this.resized, this);
		const keyboard = this.input.keyboard!;
		this.keys = keyboard.addKeys(
			{ left: "LEFT", right: "RIGHT", up: "UP", down: "DOWN", a: "A", d: "D", w: "W", s: "S" },
			false,
		) as typeof this.keys;
		keyboard.on("keydown-G", this.toggleGrid, this);
		this.input.on("pointerdown", this.pointerDown, this);
		this.input.on("pointermove", this.pointerMove, this);
		this.input.on("pointerup", this.pointerUp, this);
		this.input.on("wheel", this.wheel, this);
		this.input.on("gameout", this.pointerOut, this);
		this.marks = new ClickMarks(this);
		this.cursorShown = "";
		const unsubscribe = this.store.subscribe(() => this.worldChanged());
		const stopIntents = this.view.onIntent((intent) => this.intended(intent));
		if (this.goTo) {
			const character = this.figures.get(this.goTo)?.character;
			if (character) this.walkUpTo(character);
		}
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			unsubscribe();
			stopIntents();
			this.scale.off("resize", this.resized, this);
			keyboard.off("keydown-G", this.toggleGrid, this);
			this.square?.destroy();
			this.benches?.destroy();
			this.questBoard?.destroy();
			this.fidgets?.destroy();
			this.ambient?.destroy();
		});
	}

	update(time: number, delta: number) {
		if (time - this.insetsAt > INSETS_EVERY_MS) {
			this.insetsAt = time;
			this.insets = interfaceInsets();
			this.uiBoxes = interfaceBoxes();
		}
		this.avatar.update(delta);
		if (this.avatarFade) {
			const near = dist([this.avatar.x, this.avatar.y], this.avatarFade) / DOOR_FADE;
			this.avatar.setAlpha(Math.min(1, near));
			// Through the doorway (or off on another walk): fully here.
			if (near >= 1) this.avatarFade = undefined;
		}
		this.wander?.update(delta);
		this.host?.walker.update(delta);
		this.recruiter?.walker.update(delta);
		this.ambient?.update(delta, Math.max(1, UI_ZOOM / this.cameras.main.zoom));
		this.liveCharacters(time, delta);
		this.square?.update(delta, Math.max(1, UI_ZOOM / this.cameras.main.zoom));
		this.benches?.update();
		this.questBoard?.update();
		this.fidgets?.update(time, delta);
		this.atmosphere?.update(delta);
		this.keepTagsClear(delta);
		this.birds.update(delta);
		this.ambientBirds(time);
		if (showGrid) this.drawPath();
		this.lookAround(delta);
		this.followCamera(delta);
		this.refilter(time);
		this.refreshHover();
	}

	/**
	 * Nearest filtering for textures drawn at least as large as their own pixels, smoothing for those drawn smaller: each
	 * texture by the largest of its images on screen. Textures are shared between scenes, so each scene sets them anew.
	 */
	private refilter(time: number) {
		const zoom = this.cameras.main.zoom;
		if (Math.abs(zoom - this.filteredAt.zoom) < 1e-3 && time - this.filteredAt.time < REFILTER_EVERY_MS) return;
		this.filteredAt = { zoom, time };
		const largest = new Map<string, number>();
		for (const object of this.children.list) {
			if (!(object instanceof Phaser.GameObjects.Image || object instanceof Phaser.GameObjects.Sprite)) continue;
			const key = object.texture.key;
			if (!/^(painting|look|overlay|water|bed):/.test(key)) continue;
			largest.set(key, Math.max(largest.get(key) ?? 0, Math.abs(object.scaleX)));
		}
		for (const [key, scale] of largest) {
			const nearest = zoom * scale >= (key.startsWith("painting:") ? CRISP_FROM.painting : CRISP_FROM.sprite);
			if (this.filters.get(key) === nearest) continue;
			this.filters.set(key, nearest);
			this.textures
				.get(key)
				.setFilter(nearest ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
		}
	}

	/** The frames the painting is drawn from: `__BASE` for a whole painting, a strip each for a growing place. */
	paintingFrames(): string[] {
		return this.paintingImages.map((image) => String(image.frame.name));
	}

	/** Each texture's filtering now, for tests: true where its pixels are drawn crisp. */
	filterView(): Record<string, boolean> {
		return Object.fromEntries(this.filters);
	}

	// Read-only hooks for tests and the overlay.

	/** The place shown now, to reopen it (in another theme). */
	placeRef(): PlaceRef {
		return this.layout.ref;
	}

	/** Fade the view out to the backdrop; resolves once it is dark (or at once when nothing is drawn). */
	fadeAway(): Promise<void> {
		const camera = this.cameras?.main;
		if (!camera || !this.scene.isActive()) return Promise.resolve();
		return new Promise((resolve) => {
			camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => resolve());
			camera.fadeOut(FADE_OUT_MS, ...rgb(this.theme.world.backdrop));
			setTimeout(resolve, FADE_OUT_MS + 200);
		});
	}

	placeKey(): string {
		return this.layout.key;
	}

	painting(): string {
		return this.layout.data;
	}

	characterNames(): string[] {
		return this.present().map((figure) => figure.character.name);
	}

	/** Everyone whose session is in this place (not those walking out). */
	figureViews(): FigureView[] {
		return this.present().map((figure) => this.figureView(figure));
	}

	/** Those walking out because their session stopped or moved elsewhere. */
	departingViews(): FigureView[] {
		return [...this.figures.values()].filter((f) => f.leaving).map((figure) => this.figureView(figure));
	}

	private figureView({ character, walker, look, badge, quest, bark, sleep }: Figure): FigureView {
		const view = walker.view();
		return {
			id: character.id,
			name: character.name,
			x: view.x,
			y: view.y,
			look,
			pose: view.pose,
			moving: view.moving,
			frame: view.frame,
			badge: badge?.kind ?? null,
			quest: quest ? (character.facts?.task?.title ?? null) : null,
			bark: (bark && !bark.going ? bark.line : null) ?? (sleep ? "z" : null),
			barkBox: bark && bark.shown > 0 ? this.barkBox(bark) : null,
			alpha: walker.sprite.alpha,
			idle: view.idle,
			...this.wanderView(character.id),
		};
	}

	/** A bark's bubble on screen, from the container as drawn (its tail left out). */
	private barkBox(bark: NonNullable<Figure["bark"]>): Box {
		const { container, body, width, height, tail } = bark.shape;
		const scale = container.scaleX * this.cameras.main.zoom;
		const [x, y] = this.toScreen([container.x / TILE, container.y / TILE]);
		const centre = x + body.x * scale;
		return {
			left: centre - (width / 2) * scale,
			top: y - height * scale,
			right: centre + (width / 2) * scale,
			bottom: y - tail * scale,
		};
	}

	/** At the forge, the pull requests lying on its benches. */
	workViews(): WorkView[] {
		return this.benches?.views() ?? [];
	}

	/** At the quest office, the notices pinned on its board. */
	noticeViews(): NoticeView[] {
		return this.questBoard?.views() ?? [];
	}

	/** The place's fidget objects: what each shows and what it is doing. */
	/** The world's cursor (which kind, which sprite, the CSS on the canvas) and the click markers showing. */
	pointerView(): { cursor: CursorKind | null; art: CursorArt | null; css: string; marks: MarkView[] } {
		const { kind = null, art = null } = this.cursor ?? {};
		return { cursor: kind, art, css: this.cursorShown, marks: this.marks.views() };
	}

	fidgetViews(): FidgetView[] {
		return this.fidgets?.views() ?? [];
	}

	/** In the town square, the townsfolk standing for Slack channels with unread messages. */
	townsfolkViews(): TownsfolkView[] {
		return this.square?.views() ?? [];
	}

	/** The buildings' signs and the names lettered on them. */
	signViews(): SignView[] {
		return this.signs;
	}

	/** The place's host, where it stands, and the idle it plays. */
	hostView(): { name: string; look: string; x: number; y: number; idle: string | null; moving: boolean } | undefined {
		const host = this.host;
		const { idle, moving } = host?.walker.view() ?? {};
		return (
			host && {
				name: host.name,
				look: host.look,
				x: host.walker.x,
				y: host.walker.y,
				idle: idle ?? null,
				moving: !!moving,
			}
		);
	}

	/** Where someone is in a wander. */
	private wanderView(id: string): { wander: WanderView["state"]; interest: string | null } {
		const view = this.wander?.view(id);
		return { wander: view?.state ?? "home", interest: view?.interest ?? null };
	}

	/** The pack's ambient characters standing here (ticket 08). */
	ambientViews(): AmbientView[] {
		return this.ambient?.views() ?? [];
	}

	/** The square's recruiter, where it stands. */
	recruiterView(): { name: string; look: string; x: number; y: number } | undefined {
		const recruiter = this.recruiter;
		return recruiter && { name: recruiter.name, look: recruiter.look, x: recruiter.walker.x, y: recruiter.walker.y };
	}

	private present(): Figure[] {
		return [...this.figures.values()].filter((figure) => !figure.leaving);
	}

	avatarView(): AvatarView {
		return { ...this.avatar.view(), look: this.avatarLook };
	}

	doorViews(): DoorView[] {
		return this.doors.map((door) => {
			const [x, y, w, h] = door.rect;
			const [sx, sy] = this.toScreen([x + w / 2, y + h / 2]);
			return { name: door.name, to: door.to, ...(door.repository ? { boarded: door.boarded } : {}), x: sx, y: sy };
		});
	}

	/** A point in tiles, on screen in CSS px. */
	toScreen([x, y]: Point): Point {
		const camera = this.cameras.main;
		return [
			(x * TILE - camera.scrollX - camera.width / 2) * camera.zoom + camera.width / 2 + camera.x,
			(y * TILE - camera.scrollY - camera.height / 2) * camera.zoom + camera.height / 2 + camera.y,
		];
	}

	/** A point on screen in CSS px, in tiles. */
	toWorld([x, y]: Point): Point {
		const camera = this.cameras.main;
		return [
			((x - camera.x - camera.width / 2) / camera.zoom + camera.scrollX + camera.width / 2) / TILE,
			((y - camera.y - camera.height / 2) / camera.zoom + camera.scrollY + camera.height / 2) / TILE,
		];
	}

	zoomView(): { zoom: number; target: number; min: number; max: number } {
		return { zoom: this.cameras.main.zoom, target: this.zoomTarget, min: this.minZoom(), max: this.maxZoom() };
	}

	/** The gallery's niches and the wings in them, left to right. */
	galleryView():
		| { niches: number; wings: { name: string; boarded: boolean; door: "open" | "closed" | "boarded" }[] }
		| undefined {
		const { strips, niches } = this.layout;
		if (!strips || !niches) return undefined;
		const base = this.theme.places.gallery.niches!;
		const count = strips.reduce(
			(sum, strip, i) =>
				sum + base.at.filter((x) => x >= strip.from && (x < strip.to || i === strips.length - 1)).length,
			0,
		);
		return {
			niches: count,
			wings: niches
				.filter(({ to }) => to.kind === "wing")
				.map(({ name, door }) => ({ name, boarded: door === "boarded", door })),
		};
	}

	bannerViews(): BannerView[] {
		return this.banners.map((banner) => ({ ...banner }));
	}

	/** What animates over the painting: each overlay's kind, place (tiles), and the frame or brightness it shows. */
	overlayViews(): OverlayView[] {
		return this.overlays
			.filter(({ object }) => object.visible)
			.map(({ slot, frame, object }) => ({
				kind: slot.kind,
				x: slot.at[0],
				y: slot.at[1],
				frame: frame?.() ?? 0,
				alpha: object.alpha,
			}));
	}

	walkGridShown(): boolean {
		return showGrid;
	}

	/** Look at a door, as dragging the view there would; the camera returns to the avatar when it next walks. */
	lookAt(doorName: string): boolean {
		const door = this.doors.find((d) => d.name === doorName);
		if (!door) return false;
		const [x, y, w, h] = door.rect;
		this.freeLook = this.clampMid([(x + w / 2) * TILE, (y + h / 2) * TILE], this.cameras.main.zoom);
		this.mid = this.freeLook;
		this.applyCamera();
		return true;
	}

	// Drawing.

	private drawPainting() {
		const { place, strips, data } = this.layout;
		const key = `painting:${data}`;
		if (!strips) {
			this.add;
			// Its whole image by name: once furniture pieces are cut from it as frames, the texture's default frame is the
			// first piece, and a later visit would stretch that piece over the place.
			const whole = this.add
				.image(0, 0, key, "__BASE")
				.setOrigin(0)
				.setDisplaySize(place.cols * TILE, place.rows * TILE)
				.setDepth(-2);
			this.paintingImages.push(whole);
			return;
		}
		// A growing place: the painting cut into strips laid side by side, each seam blended over a few pixels.
		const texture = this.textures.get(key);
		const source = texture.getSourceImage() as HTMLImageElement;
		const base = this.theme.places[data];
		const ppt = source.width / base.cols; // painting px per tile
		const scale = TILE / ppt;
		strips.forEach((strip, i) => {
			const sx = Math.round(strip.from * ppt);
			const sw = Math.round(strip.to * ppt) - sx;
			const frame = `strip:${sx}:${sw}`;
			if (!texture.has(frame)) texture.add(frame, 0, sx, 0, sw, source.height);
			this.paintingImages.push(
				this.add
					.image(strip.at * TILE, 0, key, frame)
					.setOrigin(0)
					.setScale(scale)
					.setDepth(-2),
			);
			const previous = strips[i - 1];
			if (previous) {
				const seam = this.seamTexture(source, Math.round(previous.to * ppt), sx);
				this.add
					.image(strip.at * TILE - (SEAM_PX / 2) * scale, 0, seam)
					.setOrigin(0)
					.setScale(scale)
					.setDepth(-1.5);
			}
		});
	}

	/**
	 * Furniture in front: each piece of the painting drawn again at the depth of its feet line, so a character standing
	 * behind it (feet further north) is hidden where the piece covers it.
	 */
	private drawForeground() {
		const { place, strips, data } = this.layout;
		if (strips || !place.foreground?.length) return;
		const key = `painting:${data}`;
		const texture = this.textures.get(key);
		const source = texture.getSourceImage() as HTMLImageElement;
		const ppt = source.width / place.cols;
		for (const { rect, feet } of place.foreground) {
			const [x, y, w, h] = rect;
			const sx = Math.round(x * ppt);
			const sy = Math.round(y * ppt);
			const frame = `piece:${sx}:${sy}:${Math.round(w * ppt)}:${Math.round(h * ppt)}`;
			if (!texture.has(frame)) texture.add(frame, 0, sx, sy, Math.round(w * ppt), Math.round(h * ppt));
			this.add
				.image((sx / ppt) * TILE, (sy / ppt) * TILE, key, frame)
				.setOrigin(0)
				.setScale(TILE / ppt)
				.setDepth(feet * TILE - 0.5);
		}
	}

	/** A narrow patch that fades the painting at `left` into the painting at `right`. */
	private seamTexture(source: HTMLImageElement, left: number, right: number): string {
		const key = `seam:${left}:${right}`;
		if (this.textures.exists(key)) return key;
		const half = SEAM_PX / 2;
		const height = source.height;
		const canvas = document.createElement("canvas");
		canvas.width = SEAM_PX;
		canvas.height = height;
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(source, left - half, 0, SEAM_PX, height, 0, 0, SEAM_PX, height);
		const over = document.createElement("canvas");
		over.width = SEAM_PX;
		over.height = height;
		const octx = over.getContext("2d")!;
		octx.drawImage(source, right - half, 0, SEAM_PX, height, 0, 0, SEAM_PX, height);
		const fade = octx.createLinearGradient(0, 0, SEAM_PX, 0);
		fade.addColorStop(0, "rgba(0,0,0,0)");
		fade.addColorStop(1, "rgba(0,0,0,1)");
		octx.globalCompositeOperation = "destination-in";
		octx.fillStyle = fade;
		octx.fillRect(0, 0, SEAM_PX, height);
		ctx.drawImage(over, 0, 0);
		this.textures.addCanvas(key, canvas);
		return key;
	}

	/** Each wing's door in its niche: closed while agents work there, boarded up while it is empty. */
	/**
	 * Fire in hearths, water in basins, and warm light at lanterns and candles, each in its slot. The painting leaves
	 * those slots empty or unlit; these bring them to life.
	 */
	private drawOverlays() {
		this.overlays = [];
		for (const slot of this.layout.place.overlaySlots) {
			if (slot.kind === "fire") this.addFire(slot);
			if (slot.kind === "water") this.addWater(slot);
			if (slot.kind === "glow") this.lamps.push(this.addGlow(slot));
			if (slot.kind === "bed") this.addBed(slot);
			if (slot.kind === "window") this.window = slot.at;
			if (slot.kind === "letters") this.addLetters(slot);
		}
	}

	/** Letters waiting on the rookery's desk: drawn while any mail waits (for a sleeper, mostly). */
	private addLetters(slot: OverlaySlot) {
		const [x, y] = slot.at;
		// On the desk: drawn over the desk's own foreground piece, as anything lying on it is.
		const desk = this.layout.place.foreground?.find(
			({ rect: [rx, ry, rw, rh] }) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh,
		);
		const image = this.add
			.image(x * TILE, y * TILE, "overlay:letters")
			.setOrigin(0.5, 1)
			.setDepth((desk ? desk.feet : y) * TILE + 0.1)
			.setVisible(false);
		image.setScale(((slot.w ?? 1) * TILE) / image.width);
		this.letters = image;
		this.overlays.push({ slot, object: image });
	}

	private showLetters() {
		this.letters?.setVisible((this.store.get()?.mail ?? []).some((item) => item.state === "waiting"));
	}

	/** Motes, leaves, birds, steam, and the like, and out of doors the light of the time of day (ticket 11). */
	private addAtmosphere() {
		const floor = gridFor(this.layout.place);
		this.atmosphere = new AtmosphereLayer(this, {
			place: () => this.layout.place,
			key: () => this.layout.key,
			painting: () => `painting:${this.layout.data}`,
			outdoors: () => this.outdoors(),
			open: (at) => isOpen(floor, at),
			lamps: (share) => {
				if (Math.abs(share - this.lampShare) < 0.01) return;
				// Eased over a moment the first time too, so arriving after dark the lamps come up as the place fades in.
				this.lampShare = share;
				for (const lamp of this.lamps) lamp.level(0.5 * share, 900);
			},
			now: () => new Date(),
		});
	}

	/** The place's atmosphere and light now, for tests. */
	atmosphereView(): AtmosphereView | undefined {
		return this.atmosphere?.view();
	}

	/** Messenger birds in flight with mail, for tests. */
	birdViews(): BirdView[] {
		return this.birds?.views() ?? [];
	}

	/**
	 * New mail flies as a bird: between two characters here from one to the other, out by the door to someone elsewhere,
	 * in by it from someone elsewhere; the operator's own letters leave from the avatar. In the rookery every letter
	 * comes in by its window to the keeper.
	 */
	private flyNewMail() {
		for (const item of this.store.get()?.mail ?? []) {
			if (this.mailSeen.has(item.id)) continue;
			this.mailSeen.add(item.id);
			// Mail sent long ago that only now shows (a reconnect) is not news.
			if (Date.now() - item.sentAt > 120_000) continue;
			this.flyLetter(item);
		}
	}

	private flyLetter(item: MailItem) {
		const { door } = this.doorway();
		const [dx, dy, dw, dh] = door.rect;
		// The doorway, at the height of the door's middle above the floor in front of it.
		const doorway: Perch = { at: [dx + dw / 2, door.standAt[1]], lift: Math.max(0.6, door.standAt[1] - (dy + dh / 2)) };
		if (this.layout.ref.kind === "rookery" && this.window && this.host) {
			const [wx, wy] = this.window;
			const keeper: Perch = { at: [this.host.at[0] - 0.5, this.host.at[1]], lift: 1.25 };
			return this.birds.fly(item.id, item.from, item.to, { at: [wx, 5.2], lift: 5.2 - wy }, keeper);
		}
		const sender = this.perchOf(item.from);
		const receiver = this.perchOf(item.to);
		if (sender && receiver) this.birds.fly(item.id, item.from, item.to, sender, receiver);
		else if (sender) this.birds.fly(item.id, item.from, item.to, sender, doorway, { out: true });
		else if (receiver) this.birds.fly(item.id, item.from, item.to, doorway, receiver);
	}

	/** Where a bird takes off from or lands by a character here (its shoulder), or the avatar for the operator. */
	private perchOf(id: string): Perch | undefined {
		if (id === OPERATOR) return { at: [this.avatar.x, this.avatar.y], lift: 1.3 };
		const figure = this.figures.get(id);
		if (!figure || figure.leaving) return undefined;
		return { at: [figure.walker.x, figure.walker.y], lift: figure.walker.pose === "seated" ? 1.05 : 1.3 };
	}

	/** The rookery's own birds: now and then one comes in by the window and goes out by the door, or the other way. */
	private ambientBirds(time: number) {
		if (!this.window) return;
		if (!this.nextAmbient) this.nextAmbient = time + Phaser.Math.Between(2500, 5000);
		if (time < this.nextAmbient || this.birds.count(true) > 1) return;
		this.nextAmbient = time + Phaser.Math.Between(7000, 14_000);
		const [wx, wy] = this.window;
		const { door } = this.doorway();
		const high: Perch = { at: [wx + Phaser.Math.FloatBetween(-1, 1), 5.2], lift: 5.2 - wy };
		const low: Perch = { at: [door.rect[0] + door.rect[2] / 2, door.standAt[1]], lift: 1.2 };
		const id = `ambient:${++this.ambientCount}`;
		if (this.ambientCount % 2) this.birds.fly(id, "window", "door", high, low, { out: true, ambient: true });
		else this.birds.fly(id, "door", "window", low, high, { out: true, ambient: true });
	}

	/** A bed standing on the floor, its foot's bottom centre at the slot; whoever holds its spot sleeps in it. */
	private addBed(slot: OverlaySlot) {
		const [x, y] = slot.at;
		const image = this.add
			.image(x * TILE, y * TILE, "overlay:bed")
			.setOrigin(0.5, 1)
			.setDepth(y * TILE);
		image.setScale(((slot.w ?? 2.2) * TILE) / image.width);
		if (slot.spot !== undefined) this.beds.set(slot.spot, { slot, image });
	}

	/** The bed's quilt and sheet alone, cut along the turned-down sheet, to draw over a sleeper's shoulders. */
	private quiltTexture(): string {
		const key = "bed:quilt";
		if (this.textures.exists(key)) return key;
		const source = this.textures.get("overlay:bed").getSourceImage() as HTMLImageElement;
		const canvas = document.createElement("canvas");
		canvas.width = source.width;
		canvas.height = source.height;
		const ctx = canvas.getContext("2d")!;
		ctx.beginPath();
		const [first, ...rest] = this.theme.world.bed?.covers ?? [
			[0, 0],
			[source.width, 0],
			[source.width, source.height],
		];
		ctx.moveTo(...first);
		for (const point of rest) ctx.lineTo(...point);
		ctx.closePath();
		ctx.clip();
		ctx.drawImage(source, 0, 0);
		this.textures.addCanvas(key, canvas);
		return key;
	}

	/** The host at its post (the innkeeper behind the bar), facing the room; it never walks. */
	/** The square's recruiter at its booth, facing the room; it never walks. */
	private addRecruiter() {
		const at = this.layout.place.recruiter?.at;
		const look = at && recruiterLook(this.theme);
		if (!at || !look) return;
		const walker = new Walker(this, look, this.theme.looks[look], at, "down");
		this.recruiter = { walker, look, name: this.theme.labels.recruiter ?? "Recruiter", at };
		walker.live(`recruiter:${this.layout.key}`);
		this.wander?.add("recruiter", "host", walker, () => at);
	}

	/** The pack's ambient characters who stand here: presentation only, they send nothing anywhere (ticket 08). */
	private addAmbient() {
		if (!this.layout.place.ambient?.length) return;
		this.ambient = new AmbientCast(this, {
			place: () => this.layout.place,
			approach: (at, then) => this.approach(at, then),
			notify: (text) => this.view.notify(text),
			avatar: (): Point | undefined => (this.avatar ? [this.avatar.x, this.avatar.y] : undefined),
			toScreen: (at) => this.toScreen(at),
			zoom: () => this.cameras.main.zoom,
			screen: () => ({ width: this.cameras.main.width, height: this.cameras.main.height }),
			// Clear of the interface and of the agents' barks, which come first.
			covered: (box) =>
				[...this.uiBoxes, ...[...this.figures.values()].flatMap((f) => (f.bark ? [this.barkBox(f.bark)] : []))].some(
					(other) => overlaps(box, other),
				),
			wander: this.wander,
		});
	}

	private addHost() {
		const host = this.layout.place.host;
		const look = host && this.theme.looks[host.look];
		if (!host || !look) return;
		const walker = new Walker(this, host.look, look, host.at, "down");
		this.host = { walker, look: host.look, name: this.theme.labels[host.look] ?? host.look, at: host.at };
		// Standing at its post it idles now and then, and shifts a little behind its counter (tickets 06 and 07).
		walker.live(`host:${this.layout.key}`);
		this.wander?.add("host", "host", walker, () => host.at);
	}

	/** A fire standing on the hearth floor: its four frames flicker in a loose rhythm, with warm light around it. */
	private addFire(slot: OverlaySlot) {
		const [x, y] = slot.at;
		const w = (slot.w ?? 1.2) * TILE;
		const sprite = this.add
			.image(x * TILE, y * TILE, "overlay:fire-0")
			.setOrigin(0.5, 1)
			.setDepth(-1);
		const showFrame = (frame: number) => {
			sprite.setTexture(`overlay:fire-${frame}`);
			sprite.setScale(w / sprite.width);
		};
		let frame = 0;
		showFrame(frame);
		const next = () => {
			frame = (frame + 1 + (Math.random() < 0.2 ? 1 : 0)) % 4;
			showFrame(frame);
			this.time.delayedCall(Phaser.Math.Between(95, 150), next);
		};
		this.time.delayedCall(120, next);
		this.overlays.push({ slot, object: sprite, frame: () => frame });
		this.addGlow({ kind: "glow", at: [x, y - (slot.w ?? 1.2) * 0.45], r: (slot.w ?? 1.2) * 2.1 }, 0.42);
	}

	/** Water filling a basin's ellipse, clipped to it (and around anything standing in it), its ripples cycling. */
	private addWater(slot: OverlaySlot) {
		const [cx, cy] = slot.at;
		const rx = (slot.rx ?? 2) * TILE;
		const ry = (slot.ry ?? 1) * TILE;
		const RES = 2; // canvas px per world px, so the water stays crisp zoomed in
		const keys = [0, 1, 2, 3].map((i) => {
			const key = `water:${this.layout.data}:${cx}:${cy}:${i}`;
			if (this.textures.exists(key)) return key;
			const source = this.textures.get(`overlay:water-${i}`).getSourceImage() as HTMLImageElement;
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(rx * 2 * RES);
			canvas.height = Math.ceil(ry * 2 * RES);
			const ctx = canvas.getContext("2d")!;
			if (slot.hole?.length) {
				// Round anything standing in the water (a fountain's pillar): its edge stays crisp.
				ctx.beginPath();
				ctx.rect(0, 0, canvas.width, canvas.height);
				const [first, ...rest] = slot.hole.map(
					([hx, hy]): Point => [(hx * TILE - (cx * TILE - rx)) * RES, (hy * TILE - (cy * TILE - ry)) * RES],
				);
				ctx.moveTo(...first);
				for (const point of rest) ctx.lineTo(...point);
				ctx.closePath();
				ctx.clip("evenodd");
			}
			// The pool's own oval is a little larger than the basin, so its edge tucks under the rim.
			ctx.drawImage(source, -0.06 * canvas.width, -0.08 * canvas.height, canvas.width * 1.12, canvas.height * 1.16);
			// The basin's oval, its edge feathered over a few pixels so the water meets the stone softly, not in steps.
			ctx.globalCompositeOperation = "destination-in";
			ctx.setTransform(1, 0, 0, ry / rx, rx * RES, ry * RES);
			const edge = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * RES);
			edge.addColorStop(0, "rgba(0,0,0,1)");
			edge.addColorStop(1 - WATER_FEATHER / rx, "rgba(0,0,0,1)");
			edge.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = edge;
			ctx.fillRect(-rx * RES, -rx * RES, rx * RES * 2, rx * RES * 2);
			this.textures.addCanvas(key, canvas);
			return key;
		});
		// A basin traced as a foreground piece (so characters behind it are hidden) would cover its water: the water lies
		// just over that piece instead. Nobody stands in a basin, so nobody is under the water either way.
		const basin = this.layout.place.foreground?.find(
			({ rect: [x, y, w, h] }) => cx >= x && cx <= x + w && cy >= y && cy <= y + h,
		);
		const depth = basin ? basin.feet * TILE - 0.4 : -1;
		// Two layers cross-fade from each ripple frame into the next, so the water moves smoothly rather than jumping.
		const below = this.add
			.image(cx * TILE, cy * TILE, keys[0])
			.setScale(1 / RES)
			.setDepth(depth)
			.setAlpha(WATER_ALPHA);
		const above = this.add
			.image(cx * TILE, cy * TILE, keys[1])
			.setScale(1 / RES)
			.setDepth(depth + 0.01)
			.setAlpha(0);
		let frame = 0;
		this.tweens.addCounter({
			from: 0,
			to: 1,
			duration: WATER_FRAME_MS,
			repeat: -1,
			onUpdate: (tween) => {
				// Eased so each frame rests a moment before the next one comes in.
				above.setAlpha(WATER_ALPHA * Phaser.Math.Easing.Sine.InOut(tween.getValue() ?? 0));
			},
			onRepeat: () => {
				frame = (frame + 1) % keys.length;
				below.setTexture(keys[frame]);
				above.setTexture(keys[(frame + 1) % keys.length]).setAlpha(0);
			},
		});
		this.overlays.push({ slot, object: below, frame: () => frame });
	}

	/**
	 * Warm light around a lantern or a candle: a soft halo added to what is under it, flickering a little. A fidget's
	 * light (`listed` false) turns it up and down through the handle; the place's own glows are listed as overlays.
	 */
	private addGlow(
		slot: OverlaySlot,
		strength = 0.5,
		listed = true,
		depth = glowDepth(this.layout.place, slot.at),
	): Glow {
		const [x, y] = slot.at;
		// Sorted with what it lights (not over everyone), and never darkened by the night.
		const glow = keepLit(
			this.add
				.image(x * TILE, y * TILE, this.glowTexture())
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth(depth)
				.setAlpha(strength),
		);
		const scale = ((slot.r ?? 0.9) * TILE * 2) / glow.width;
		glow.setScale(scale);
		// The flicker eases toward a new brightness and size now and then; the level scales it.
		const light = { level: strength, flicker: 1, size: 1 };
		const apply = () => glow.setAlpha(light.level * light.flicker).setScale(scale * light.size);
		let fade: Phaser.Tweens.Tween | undefined;
		const flicker = () =>
			this.tweens.add({
				targets: light,
				flicker: Phaser.Math.FloatBetween(0.62, 1),
				size: Phaser.Math.FloatBetween(0.97, 1.03),
				duration: Phaser.Math.Between(140, 420),
				ease: "Sine.inOut",
				onUpdate: apply,
				onComplete: () => {
					if (glow.active) flicker();
				},
			});
		flicker();
		if (listed) this.overlays.push({ slot, object: glow });
		return {
			image: glow,
			level: (level, ms = 300) => {
				fade?.remove();
				if (ms <= 0) {
					light.level = level;
					return apply();
				}
				fade = this.tweens.add({ targets: light, level, duration: ms, ease: "Sine.inOut", onUpdate: apply });
			},
			destroy: () => glow.destroy(),
		};
	}

	/** One warm radial light, drawn once and shared by every glow. */
	private glowTexture(): string {
		const key = "glow:warm";
		if (this.textures.exists(key)) return key;
		const size = 128;
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d")!;
		const light = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		const [core, middle, edge] = this.theme.world.glow.map(rgb);
		light.addColorStop(0, `rgba(${core.join(",")}, 0.95)`);
		light.addColorStop(0.12, `rgba(${middle.join(",")}, 0.6)`);
		light.addColorStop(0.4, `rgba(${edge.join(",")}, 0.18)`);
		light.addColorStop(1, `rgba(${edge.join(",")}, 0)`);
		ctx.fillStyle = light;
		ctx.fillRect(0, 0, size, size);
		this.textures.addCanvas(key, canvas);
		return key;
	}

	/**
	 * Each room's door in its niche. Wing doors follow their team's state; the meeting room stays open.
	 */
	private drawRoomDoors() {
		const { niches } = this.layout;
		const template = this.theme.places.gallery.niches;
		if (!niches || !template) return;
		const [dx, dy, dw, dh] = template.door;
		for (const { name, title, to, door, x } of niches) {
			const image = this.add
				.image((x + dx + dw / 2) * TILE, (dy + dh) * TILE, `overlay:door-${door}`)
				.setOrigin(0.5, 1)
				.setDepth((dy + dh) * TILE - TILE);
			// Each state's sprite keeps its own proportions, at the niche's height.
			image.setScale((dh * TILE) / image.height);
			// Without the sprite's outermost pixels: the anime school's door sprites carry a line of magenta keying fringe
			// along their sides and foot, which drew a pink line down the door frame.
			image.setCrop(1, 0, image.width - 2, image.height - 1);
			if (door === "open") this.addGlow({ kind: "glow", at: [x + dx + dw / 2, dy + dh - 0.35], r: dw * 0.75 }, 0.32);
			this.banner(x, template.banner[1], name);
			this.doors.push({
				name: title,
				rect: [x + dx, dy, dw, dh],
				standAt: [x + template.standAt[0], template.standAt[1]],
				to: to.kind,
				...(to.kind === "wing" ? { repository: to.repository } : {}),
				boarded: door === "boarded",
			});
		}
	}

	/** The wing room's own banner on its painted rod. */
	private drawBanners() {
		const { ref, title } = this.layout;
		if (ref.kind !== "wing") return;
		const name = title.replace(new RegExp(` ${this.theme.labels.wing}$`), "");
		for (const slot of this.layout.place.overlaySlots)
			if (slot.kind === "banner") this.banner(slot.at[0], slot.at[1], name);
	}

	/**
	 * A cream banner hung with its rod at (x, top), the name stitched on it at the largest size that fits: on one line,
	 * else broken after `-`, `_`, `.`, `/`, or a space onto up to four lines, never smaller than legible. A name that still
	 * does not fit is abbreviated, word by word (`reconciliation` to `reconc.`), and cut short with an ellipsis only as a
	 * last resort; the banner answers the pointer with the full name.
	 */
	private banner(x: number, top: number, name: string) {
		const image = this.add
			.image(x * TILE, top * TILE, "overlay:banner-cream")
			.setOrigin(0.5, 0)
			.setDepth((top + 6) * TILE);
		const style = this.theme.world.banner;
		image.setScale((style.tiles * TILE) / image.width);
		// The name stays inside the cloth (the pack measures it: inside the fantasy banner's vine border, above its
		// swallowtail).
		const [tx, ty, tw, th] = style.text;
		const width = image.displayWidth * tw;
		const height = image.displayHeight * th;
		const text = this.add
			.text(x * TILE + (tx + tw / 2 - 0.5) * image.displayWidth, top * TILE + (ty + th / 2) * image.displayHeight, "", {
				fontFamily: this.theme.world.font,
				fontStyle: "bold",
				color: style.ink,
				align: "center",
				lineSpacing: -2,
			})
			.setOrigin(0.5)
			.setResolution(4)
			.setDepth(image.depth + 1);
		const view: BannerView = { name, text: "", size: 0, fits: false, abbreviated: false };
		this.banners.push(view);
		// The cloth answers the pointer with the whole name, however it is stitched.
		this.bannerRects.push({
			name,
			rect: [
				x + ((style.hover[0] - 0.5) * image.displayWidth) / TILE,
				top + (style.hover[1] * image.displayHeight) / TILE,
				(style.hover[2] * image.displayWidth) / TILE,
				(style.hover[3] * image.displayHeight) / TILE,
			],
		});
		// A separator may hang just past the edge, as punctuation does.
		const fits = (line: string) => {
			text.setText(line.trim().replace(/[-_./]$/, ""));
			return text.width <= width + 0.5;
		};
		const done = (size: number, lines: string[]) => {
			const shown = lines.map((line) => line.trim()).join("\n");
			text.setFontSize(size);
			text.setText(shown);
			view.text = shown;
			view.size = size;
			view.fits = text.height <= height + 0.5 && lines.every((line) => fits(line));
			text.setText(shown);
		};
		const parts = bannerParts(name);
		// On one line while it reads well, else on as many lines as it takes at the largest size that fits.
		for (let size = BANNER_FONT[0]; size >= BANNER_ONE_LINE; size--) {
			text.setFontSize(size);
			if (fits(name)) return done(size, [name]);
		}
		for (let size = BANNER_FONT[0]; size >= BANNER_FONT[1]; size--) {
			text.setFontSize(size);
			const lines = bannerLines(parts, fits);
			if (!lines) continue;
			text.setText(lines.join("\n"));
			if (text.height <= height) return done(size, lines);
		}
		// Too long whole at the smallest legible size: each word that does not fit its line is cut to the longest start
		// that does, with a full stop ("reconc."), and the words go on as few lines as fit.
		const size = BANNER_FONT[1];
		text.setFontSize(size);
		const fitsExactly = (line: string) => {
			text.setText(line.trim());
			return text.width <= width + 0.5;
		};
		const short = parts.map((part) => {
			const sep = /[-_./ ]$/.test(part) ? part.slice(-1) : "";
			const word = sep ? part.slice(0, -1) : part;
			if (fits(part)) return part;
			// A start of up to six letters that fits and ends on a consonant ("custom.", "reconc."), at least three.
			let n = Math.min(word.length - 1, BANNER_ABBREVIATION);
			while (n > 3 && (!fitsExactly(`${word.slice(0, n)}.`) || /[aeiouy]/i.test(word[n - 1]))) n--;
			view.abbreviated = true;
			// The full stop ends the word; the next one starts after a space, not the separator.
			return `${word.slice(0, n)}.${sep ? " " : ""}`;
		});
		// As many lines as the cloth holds at this size (a short sign plate holds fewer than a banner), at most five.
		const tall = (count: number) => {
			text.setText(Array.from({ length: count }, () => "Ag").join("\n"));
			return text.height <= height + 0.5;
		};
		let most = BANNER_LINES_SHORT;
		while (most > 1 && !tall(most)) most--;
		let lines = bannerLines(short, fits, most);
		if (!lines) {
			// More words than lines: as many as fit, the last line cut short.
			lines = [];
			let line = "";
			for (const part of short) {
				if (line && !fits(line + part)) {
					lines.push(line);
					line = "";
				}
				line += part;
			}
			if (line) lines.push(line);
			if (lines.length > most) {
				lines = lines.slice(0, most);
				let last = lines[most - 1].trim();
				while (last.length > 1 && !fits(`${last}\u2026`)) last = last.slice(0, -1);
				lines[most - 1] = `${last.replace(/[-_./ ]+$/, "")}\u2026`;
			}
			view.abbreviated = true;
		}
		done(size, lines);
	}

	private drawGrid() {
		this.gridOverlay?.destroy();
		const { place } = this.layout;
		const graphics = this.add.graphics().setDepth(1e6);
		const grid = walkGrid(place);
		const half = TILE / 2;
		graphics.fillStyle(0xff3030, 0.34);
		for (let row = 0; row < grid.rows; row++)
			for (let col = 0; col < grid.cols; col++)
				if (grid.blocked[row * grid.cols + col]) graphics.fillRect(col * half, row * half, half, half);
		graphics.lineStyle(1, 0xffffff, 0.16);
		for (let col = 0; col <= grid.cols; col++) graphics.lineBetween(col * half, 0, col * half, grid.rows * half);
		for (let row = 0; row <= grid.rows; row++) graphics.lineBetween(0, row * half, grid.cols * half, row * half);
		for (const door of this.doors) {
			const [x, y, w, h] = door.rect;
			graphics.fillStyle(0x3aa0ff, 0.25).fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
			graphics.lineStyle(2, 0x5ab4ff, 1).strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
			graphics.fillStyle(0x5ab4ff, 1).fillCircle(door.standAt[0] * TILE, door.standAt[1] * TILE, 6);
		}
		graphics.fillStyle(0x30ff70, 1);
		for (const [x, y] of place.spots) graphics.fillCircle(x * TILE, y * TILE, 6);
		graphics.fillStyle(0xffd400, 1);
		for (const [x, y] of Object.values(place.entries)) graphics.fillRect(x * TILE - 5, y * TILE - 5, 10, 10);
		this.gridOverlay = graphics;
	}

	private toggleGrid(event: KeyboardEvent) {
		if (handledKeys.has(event)) return;
		handledKeys.add(event);
		this.setGrid(!showGrid);
	}

	private setGrid(shown: boolean) {
		if (shown === showGrid) return;
		showGrid = shown;
		this.view.update({ walkGrid: shown });
		if (showGrid) this.drawGrid();
		else {
			this.gridOverlay?.destroy();
			this.gridOverlay = undefined;
			this.pathOverlay?.destroy();
			this.pathOverlay = undefined;
		}
	}

	private drawPath() {
		const graphics = this.pathOverlay ?? this.add.graphics().setDepth(1e6 + 1);
		this.pathOverlay = graphics;
		graphics.clear();
		const { path } = this.avatar.view();
		if (path.length < 2) return;
		graphics.lineStyle(3, 0xffffff, 0.9);
		graphics.beginPath();
		graphics.moveTo(path[0][0] * TILE, path[0][1] * TILE);
		for (const [x, y] of path.slice(1)) graphics.lineTo(x * TILE, y * TILE);
		graphics.strokePath();
		graphics.fillStyle(0xffffff, 1);
		for (const [x, y] of path.slice(1)) graphics.fillCircle(x * TILE, y * TILE, 4);
	}

	// Characters.

	/**
	 * Put the place's characters at their spots. With `animate`, a character new to the place walks in through its
	 * door to its spot, and one whose session left walks out by it; otherwise they are simply there.
	 */
	private showCharacters(animate: boolean) {
		const world = this.store.get();
		const room = this.layout.place.spots.length;
		const characters = charactersIn(this.layout.ref, world, room);
		const ids = new Set(characters.map((character) => character.id));
		// At the inn, a sleeper still asleep but no longer among the newest goes upstairs; one who woke goes out.
		const stillAsleep = new Set((world?.dormant ?? []).map((agent) => agent.id));
		const inn = this.layout.ref.kind === "inn";
		for (const figure of this.figures.values())
			if (!ids.has(figure.character.id) && !figure.leaving)
				this.leave(figure, animate, inn && stillAsleep.has(figure.character.id) ? this.stairs() : undefined);
		const { spots, positions } = assignSpots(
			this.layout.place,
			characters,
			heldSpots.get(this.layout.key) ?? new Map(),
		);
		heldSpots.set(this.layout.key, spots);
		const arrivals: Figure[] = [];
		for (const character of characters) {
			const spot = positions.get(character.id)!;
			let figure = this.figures.get(character.id);
			if (!figure) {
				figure = this.addFigure(character, animate ? this.doorway().inside : spot);
				if (animate) arrivals.push(figure);
			}
			const returning = figure.leaving;
			figure.leaving = false;
			figure.character = character;
			figure.spotIndex = spots.get(character.id);
			const moved = !figure.spot || figure.spot[0] !== spot[0] || figure.spot[1] !== spot[1];
			figure.spot = spot;
			if (returning || (moved && (animate || figure.walker.moving))) this.walkToSpot(figure);
			else if (moved) figure.walker.moveTo(spot);
			this.dress(figure);
		}
		// In the square, townsfolk stand on the painted spots agents left free.
		const held = new Set(spots.values());
		this.square?.arrange(
			this.layout.place.spots.map((_, i) => i).filter((i) => !held.has(i)),
			animate,
		);
		// Characters block only their own footprint, at the spot they stand on or are walking to; so do the host and
		// the townsfolk.
		this.walkable = gridFor(this.layout.place, [
			...this.present().map(({ spot }) => spot!),
			...(this.host ? [this.host.at] : []),
			...(this.recruiter ? [this.recruiter.at] : []),
			...(this.square?.occupied() ?? []),
			...(this.ambient?.occupied() ?? []),
			// A cat on the floor is walked round, as a body is.
			...floorFidgets(this.layout.place),
		]);
		for (const figure of arrivals)
			this.enter(figure, inn && this.upstairs.has(figure.character.id) ? this.stairs() : undefined);
		if (inn) {
			this.upstairs = new Set((world?.dormant ?? []).slice(room).map((agent) => agent.id));
			this.tagUpstairs(this.upstairs.size);
		}
	}

	/** On the stairs, how many more sleep upstairs than the inn below has spots for. */
	private tagUpstairs(count: number) {
		if (this.upstairsTag?.count === count) return;
		this.upstairsTag?.tag.destroy();
		this.upstairsTag = undefined;
		const stairs = this.stairs();
		if (!count || !stairs) return;
		const [x, , w] = stairs.rect;
		const tag = drawTag(this, say(this.theme, "upstairs-count", { count }))
			.setPosition((x + w / 2) * TILE, (stairs.standAt[1] - 0.55) * TILE)
			.setDepth(9e4 + 1);
		this.upstairsTag = { count, tag };
	}

	/** A tag in the world (the inn's upstairs count) fades while a panel or the title covers it, like a bark. */
	private keepTagsClear(delta: number) {
		const tag = this.upstairsTag?.tag;
		if (!tag) return;
		const bounds = tag.getBounds();
		const [left, top] = this.toScreen([bounds.left / TILE, bounds.top / TILE]);
		const [right, bottom] = this.toScreen([bounds.right / TILE, bounds.bottom / TILE]);
		const covered = this.uiBoxes.some((box) => overlaps({ left, top, right, bottom }, box));
		const step = Math.min(delta, 100) / BARK_FADE_MS;
		tag.setAlpha(Phaser.Math.Clamp(tag.alpha + (covered ? -step : step), 0, 1));
	}

	/** The inn's stairs up to the rooms, where sleepers beyond its spots rest. */
	private stairs(): Door | undefined {
		return this.layout.place.doors.find((door) => door.to === "rooms");
	}

	private addFigure(character: Character, [x, y]: Point): Figure {
		const look = lookFor(this.theme, character);
		const walker = new Walker(this, look, this.theme.looks[look], [x, y], "down");
		const figure: Figure = { character, walker, look, leaving: false, barks: 0 };
		this.figures.set(character.id, figure);
		// Standing about, it idles now and then, and an idle agent steps out to somewhere near and back (06, 07).
		walker.live(character.id);
		this.wander?.add(
			character.id,
			"agent",
			walker,
			() => (figure.leaving ? undefined : figure.spot),
			() => this.mayWander(figure),
		);
		return figure;
	}

	/**
	 * An agent may step out only while it stands about: not at work or asking, not waiting to show you what it finished
	 * (you find it at its spot), not coming in or asleep at the inn.
	 */
	private mayWander(figure: Figure): boolean {
		const { character } = figure;
		return (
			!figure.leaving &&
			!figure.fade &&
			this.layout.ref.kind !== "inn" &&
			poseFor(character, this.outdoors()) === "standing" &&
			!needsYou(character)
		);
	}

	/** Where others stand (their spots, the host, the recruiter, townsfolk, floor fidgets): walked round by wanderers. */
	private footprints(): Point[] {
		return [
			...this.present().map(({ spot }) => spot!),
			...(this.host ? [this.host.at] : []),
			...(this.recruiter ? [this.recruiter.at] : []),
			...(this.square?.occupied() ?? []),
			...(this.ambient?.occupied() ?? []),
			...floorFidgets(this.layout.place),
		];
	}

	/** The door characters come in and go out by (or `via`), and a point just inside its doorway where they appear. */
	private doorway(via?: Door): { door: Door; inside: Point } {
		const { place } = this.layout;
		const door = via ?? place.doors.find((d) => d.name === place.enterBy) ?? place.doors[0];
		const [x, y, w, h] = door.rect;
		const [sx, sy] = door.standAt;
		// From the stand point, a short step into the door's rect, toward its middle.
		const mid: Point = [x + w / 2, y + h / 2];
		const length = Math.hypot(mid[0] - sx, mid[1] - sy) || 1;
		const step = Math.min(DOOR_FADE, length);
		return { door, inside: [sx + ((mid[0] - sx) / length) * step, sy + ((mid[1] - sy) / length) * step] };
	}

	/** A newcomer comes through the door, fading in on the threshold, and walks to its spot. */
	private enter(figure: Figure, via?: Door) {
		const { door, inside } = this.doorway(via);
		figure.walker.moveTo(inside);
		figure.walker.setAlpha(0);
		figure.fade = { at: inside, out: false };
		const onward = this.pathFor(figure, door.standAt, figure.spot!);
		figure.walker.walk([inside, door.standAt, ...onward.slice(1)], () => this.settle(figure));
	}

	/** Its session stopped or moved on: it walks to the door and fades through it, then is gone. */
	private leave(figure: Figure, animate: boolean, via?: Door) {
		figure.leaving = true;
		this.wander?.remove(figure.character.id);
		figure.spot = undefined;
		figure.nextBark = undefined;
		this.dropBadge(figure);
		figure.quest?.destroy();
		figure.quest = undefined;
		if (animate) this.hushBark(figure);
		this.wakeUp(figure);
		const gone = () => {
			if (!figure.leaving) return;
			this.dropBark(figure);
			figure.walker.destroy();
			if (this.figures.get(figure.character.id) === figure) this.figures.delete(figure.character.id);
		};
		if (!animate) return gone();
		const { door, inside } = this.doorway(via);
		const from: Point = [figure.walker.x, figure.walker.y];
		const way = this.pathFor(figure, from, door.standAt);
		figure.fade = { at: inside, out: true };
		figure.walker.walk([...way, inside], gone);
	}

	/** Walk a figure from where it is to its spot. */
	private walkToSpot(figure: Figure) {
		const from: Point = [figure.walker.x, figure.walker.y];
		figure.walker.walk(this.pathFor(figure, from, figure.spot!), () => this.settle(figure));
	}

	/** A path for a character, around furniture and everyone else's spot (not its own). */
	private pathFor(figure: Figure, from: Point, to: Point): Point[] {
		const others = this.present()
			.filter((f) => f !== figure && f.spot)
			.map(({ spot }) => spot!);
		const path = findPath(gridFor(this.layout.place, [...others, ...floorFidgets(this.layout.place)]), from, [to]);
		if (!path) return [from, to];
		const points = path.points;
		const last = points.at(-1)!;
		return Math.hypot(last[0] - to[0], last[1] - to[1]) > 0.01 ? [...points, to] : points;
	}

	/** At its spot: face the room (seated and asking poses are drawn their own way). */
	private settle(figure: Figure) {
		figure.fade = undefined;
		figure.walker.setAlpha(1);
		figure.walker.face([figure.walker.x, figure.walker.y + 1]);
	}

	/** Out of doors (the square, the street): no desks, so those at work stand. */
	private outdoors(): boolean {
		return this.layout.ref.kind === "square" || this.layout.ref.kind === "street";
	}

	/** How many townsfolk stand in the square: its painted spots no agent holds (agents take spots first). */
	private squareRoom(): number {
		const square = this.theme.places.square;
		return Math.max(0, square.spots.length - charactersIn({ kind: "square" }, this.store.get()).length);
	}

	/** Pose, badge, and the seated beat by the character's state; at the inn, asleep. */
	private dress(figure: Figure) {
		if (this.layout.ref.kind === "inn") return this.sleep(figure);
		const { character, walker } = figure;
		const pose = poseFor(character, this.outdoors());
		// Called to work (or to ask) while out wandering: it walks back first, and sits or asks at its spot.
		if (figure.spot && (pose !== "standing" || needsYou(character))) this.wander?.recall(figure.spot);
		walker.setPose(pose);
		walker.tempo = tempoFor(character);
		const kind = badgeFor(character);
		if (figure.badge?.kind !== kind) {
			this.dropBadge(figure);
			if (kind) figure.badge = { kind, container: drawBadge(this, kind) };
		}
		if (character.facts?.task && !figure.quest) {
			figure.quest = this.add.image(0, 0, noticeTexture(this, "progress")).setOrigin(0.5, 1);
			figure.quest.setScale((QUEST_TILES * TILE) / figure.quest.width);
		} else if (!character.facts?.task && figure.quest) {
			figure.quest.destroy();
			figure.quest = undefined;
		}
		if (!needsYou(character)) {
			figure.nextBark = undefined;
			this.hushBark(figure);
		}
	}

	/**
	 * A sleeper dozes at its table (the seated frame, still) or lies in the bed whose spot it holds, with a "z" rising.
	 * Both show once it has walked to its spot; the walker itself is hidden while it lies in bed.
	 */
	private sleep(figure: Figure) {
		const bed = figure.spotIndex === undefined ? undefined : this.beds.get(figure.spotIndex);
		figure.walker.setPose(bed ? "in-bed" : "dozing");
		figure.walker.tempo = 1;
		if (figure.sleep && !!figure.sleep.bed !== !!bed) this.wakeUp(figure);
		if (figure.sleep) return;
		const sprite = figure.walker.sprite.setTint(SLEEP_TINT);
		// Breathing: the dozing figure rises and settles a touch, slowly.
		const breath = bed
			? undefined
			: this.tweens.add({
					targets: sprite,
					scaleY: sprite.scaleY * 0.982,
					duration: 1700 + Math.random() * 500,
					yoyo: true,
					repeat: -1,
					ease: "Sine.inOut",
				});
		figure.sleep = {
			z: drawZzz(this).setVisible(false),
			bed: bed && this.inBed(figure, bed.slot, bed.image),
			breath,
		};
	}

	/** The sleeper's head on the bed's pillow, tucked in under the quilt. */
	private inBed(figure: Figure, slot: OverlaySlot, bed: Phaser.GameObjects.Image): InBed {
		const { frame, baseline } = this.theme.looks[figure.look];
		const scale = bed.scaleX;
		const toTiles = ([px, py]: Point): Point => [
			(bed.x + (px - bed.width / 2) * scale) / TILE,
			(bed.y + (py - bed.height) * scale) / TILE,
		];
		const pillow = toTiles(this.theme.world.bed?.pillow ?? [0, 0]);
		const headScale = ((PERSON_TILES * TILE) / STANDING) * HEAD_SCALE;
		const [above, tall] = HEAD_CUT;
		const top = Math.max(0, baseline - above);
		// The face looks out of the pillow: the cut's middle sits on the pillow's middle.
		const head = this.add
			.image(pillow[0] * TILE, pillow[1] * TILE, `look:${figure.look}`, 14)
			.setCrop(0, top, frame[0], tall)
			.setOrigin(0.5, (top + tall * 0.62) / frame[1])
			.setScale(headScale)
			.setAngle(-14)
			.setTint(SLEEP_TINT)
			.setDepth(bed.depth + 0.1)
			.setVisible(false);
		const quilt = this.add
			.image(bed.x, bed.y, this.quiltTexture())
			.setOrigin(0.5, 1)
			.setScale(scale)
			.setDepth(bed.depth + 0.2)
			.setVisible(false);
		const w = slot.w ?? 2.2;
		const h = (bed.height * scale) / TILE;
		return { head, quilt, pillow, rect: [slot.at[0] - w / 2, slot.at[1] - h * 0.8, w, h * 0.8] };
	}

	/** Out of bed and no longer asleep: its "z" and its place in bed go. */
	private wakeUp(figure: Figure) {
		if (figure.sleep?.breath) {
			figure.sleep.breath.remove();
			figure.walker.sprite.setScale(figure.walker.sprite.scaleX);
		}
		if (figure.sleep) figure.walker.sprite.clearTint();
		figure.sleep?.z.destroy();
		figure.sleep?.bed?.head.destroy();
		figure.sleep?.bed?.quilt.destroy();
		figure.sleep = undefined;
	}

	private dropBadge(figure: Figure) {
		figure.badge?.container.destroy();
		figure.badge = undefined;
	}

	private dropBark(figure: Figure) {
		figure.bark?.shape.container.destroy();
		figure.bark = undefined;
	}

	/** Let a bark go: it fades out, then is gone. */
	private hushBark(figure: Figure) {
		if (figure.bark) figure.bark.going = true;
	}

	/** Every frame: walk, fade in doorways, keep badges and barks over heads, and let those who need you bark. */
	private liveCharacters(time: number, delta: number) {
		// Badges and barks keep at least their own size on screen when the view zooms out, so they stay legible.
		const ui = Math.max(1, UI_ZOOM / this.cameras.main.zoom);
		for (const figure of this.figures.values()) {
			const { walker } = figure;
			walker.update(delta);
			if (figure.fade) {
				const [fx, fy] = figure.fade.at;
				const near = Math.min(1, Math.hypot(walker.x - fx, walker.y - fy) / DOOR_FADE);
				walker.setAlpha(figure.fade.out && !walker.moving ? 0 : near);
			}
			const x = walker.x * TILE;
			const top = (walker.y - BADGE_LIFT[walker.pose]) * TILE;
			const depth = 1e5 + walker.y;
			if (figure.sleep) {
				const resting = !walker.moving && !figure.leaving;
				const bed = figure.sleep.bed;
				bed?.head.setVisible(resting);
				bed?.quilt.setVisible(resting);
				const [zx, zy] = bed ? [bed.pillow[0] + 0.2, bed.pillow[1] - 0.35] : [walker.x + 0.32, walker.y - Z_LIFT];
				figure.sleep.z
					.setVisible(resting)
					.setPosition(zx * TILE, zy * TILE)
					.setDepth(depth)
					.setScale(ui);
			}
			figure.badge?.container.setPosition(x, top).setDepth(depth).setScale(ui).setAlpha(walker.sprite.alpha);
			figure.quest
				?.setPosition((walker.x + QUEST_AT[0]) * TILE, (walker.y + QUEST_AT[1]) * TILE)
				.setDepth(depth + 0.01)
				.setAlpha(walker.sprite.alpha);
		}
		this.liveBarks(time, delta, ui);
	}

	/**
	 * Barks: each over its speaker's head, fading in and out. A bark never covers another bark, the place's title, or
	 * the interface's panels: its bubble slides sideways over the tail to find room, and with none it fades until room
	 * returns. A new bark waits its turn when there is no room for it, and at most `BARKS_AT_ONCE` show.
	 */
	private liveBarks(time: number, delta: number, ui: number) {
		const camera = this.cameras.main;
		const scale = ui * camera.zoom;
		const placed: Box[] = [];
		const anchor = (figure: Figure): Point => {
			const { walker } = figure;
			return [walker.x, walker.y - BADGE_LIFT[walker.pose] - ((figure.badge ? 14 : 2) * ui) / TILE];
		};
		/** The first slide (px) at which the bark's bubble has room on screen, preferring where it already is. */
		const room = (shape: BarkShape, at: Point, prefer: number): number | undefined => {
			const [sx, sy] = this.toScreen(at);
			const slides = [prefer, 0, -shape.slide / 2, shape.slide / 2, -shape.slide, shape.slide];
			return slides.find((slide) => {
				const box: Box = {
					left: sx + (slide - shape.width / 2) * scale - BARK_MARGIN,
					top: sy - (shape.height + BARK_RISE) * scale - BARK_MARGIN,
					right: sx + (slide + shape.width / 2) * scale + BARK_MARGIN,
					bottom: sy + BARK_MARGIN,
				};
				if (box.left < 0 || box.top < 0 || box.right > camera.width || box.bottom > camera.height) return false;
				const cast = this.ambient?.barkBoxes() ?? [];
				if ([...this.uiBoxes, ...placed, ...cast].some((other) => overlaps(box, other))) return false;
				placed.push(box);
				return true;
			});
		};
		const step = Math.min(delta, 100) / BARK_FADE_MS;
		const barking = [...this.figures.values()].filter((figure) => figure.bark);
		for (const figure of barking) {
			const bark = figure.bark!;
			if (time >= bark.until || figure.leaving) bark.going = true;
			const at = anchor(figure);
			const slide = bark.going ? undefined : room(bark.shape, at, bark.shift);
			if (slide !== undefined) bark.shift += (slide - bark.shift) * Math.min(1, step * 2.5);
			bark.shown = Phaser.Math.Clamp(bark.shown + (slide === undefined ? -step : step), 0, 1);
			if (bark.going && bark.shown <= 0) {
				this.dropBark(figure);
				continue;
			}
			const eased = Phaser.Math.Easing.Sine.InOut(bark.shown);
			bark.shape.body.setX(bark.shift);
			bark.shape.container
				.setPosition(at[0] * TILE, at[1] * TILE - BARK_RISE * (1 - eased) * ui)
				.setDepth(1e5 + figure.walker.y + 0.5)
				.setScale(ui)
				.setAlpha(eased * figure.walker.sprite.alpha);
		}
		let count = barking.filter((figure) => figure.bark && !figure.bark.going).length;
		for (const figure of this.figures.values()) {
			if (figure.leaving || figure.sleep || !needsYou(figure.character)) continue;
			figure.nextBark ??= time + Phaser.Math.Between(...FIRST_BARK_MS);
			if (time < figure.nextBark || figure.bark || figure.walker.moving) continue;
			const line = barkFor(figure.character, figure.barks);
			if (!line) continue;
			const shape = drawBark(this, line);
			const slide = count < BARKS_AT_ONCE ? room(shape, anchor(figure), 0) : undefined;
			if (slide === undefined) {
				// No room now (or enough barks already): try again a little later.
				shape.container.destroy();
				figure.nextBark = time + BARK_RETRY_MS;
				continue;
			}
			figure.barks++;
			shape.container.setAlpha(0);
			figure.bark = { line, shape, until: time + BARK_MS, shift: slide, shown: 0, going: false };
			figure.nextBark = time + Phaser.Math.Between(...BARK_EVERY_MS);
			count++;
		}
	}

	/**
	 * The operator's avatar. Coming through a door, it steps in from the doorway, fading in, and walks on to the entry
	 * for where it came from (kept clear of anyone standing there), facing into the room; laid out again, it stands
	 * where it stood.
	 */
	private addAvatar() {
		const name = avatarLookIn(this.theme, this.store.get());
		this.avatarLook = name;
		if (this.keep) {
			this.avatar = new Walker(this, name, this.theme.looks[name], this.keep.avatar, this.keep.facing);
			return;
		}
		const at = this.clearOfOthers(this.arrival());
		const door = this.from ? this.arrivalDoor(this.arrival()) : undefined;
		if (!door) {
			this.avatar = new Walker(this, name, this.theme.looks[name], at, "down");
			return;
		}
		const { inside } = this.doorway(door);
		this.avatar = new Walker(this, name, this.theme.looks[name], inside, this.arrivalFacing(at, door));
		this.avatar.setAlpha(0);
		this.avatarFade = inside;
		const path = findPath(this.walkable, inside, at)?.points ?? [inside, at];
		this.avatar.walk(
			[inside, door.standAt, ...path.slice(1)].filter((p, i, all) => i === 0 || dist(p, all[i - 1]) > 1e-6),
			() => {
				this.avatarFade = undefined;
				this.avatar.setAlpha(1);
			},
		);
	}

	/** The door the avatar came in by: the one whose stand point is at (or near) where it arrives. */
	private arrivalDoor([ax, ay]: Point): SceneDoor | undefined {
		return this.doors
			.filter(({ standAt: [x, y] }) => Math.hypot(x - ax, y - ay) < 1.6)
			.sort((a, b) => dist(a.standAt, [ax, ay]) - dist(b.standAt, [ax, ay]))[0];
	}

	/** A point near `at` where the avatar stands clear of everyone at their spots (and the host), on open floor. */
	private clearOfOthers(at: Point): Point {
		const others = [
			...this.present().map(({ spot }) => spot!),
			...(this.host ? [this.host.at] : []),
			...(this.recruiter ? [this.recruiter.at] : []),
			...(this.square?.occupied() ?? []),
			...(this.ambient?.occupied() ?? []),
			...floorFidgets(this.layout.place),
		];
		// Too close: beside them, or in front of them (south) by less than a body's height, where the avatar would cover
		// them, or just behind them, where they would cover it.
		const crowded = ([x, y]: Point) =>
			others.some(([ox, oy]) => Math.abs(ox - x) < 0.95 && y - oy > -0.9 && y - oy < PERSON_TILES + 0.1);
		if (!crowded(at)) return at;
		for (const reach of [0.75, 1.1, 1.5, 2])
			for (const [dx, dy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[1, 0.5],
				[-1, 0.5],
				[0, -1],
			]) {
				const point: Point = [at[0] + dx * reach, at[1] + dy * reach];
				if (isOpen(this.walkable, point) && clearanceAt(this.walkable, point) >= 0.3 && !crowded(point)) return point;
			}
		return at;
	}
	/** The operator chose another look in Settings: the avatar wears it where it stands. */
	private dressAvatar() {
		const name = avatarLookIn(this.theme, this.store.get());
		if (name === this.avatarLook) return;
		this.avatarLook = name;
		this.avatar.setLook(name, this.theme.looks[name]);
	}

	// What the pointer is over, and what can be done with it.

	/** Characters under a point (front first), then doors whose rect holds it. Doors answer only over the door. */
	private targetsAt([x, y]: Point): Target[] {
		const scale = (PERSON_TILES * TILE) / STANDING / TILE;
		const over = (walker: Walker) => {
			const half = Math.min(0.42, (walker.sprite.width * scale) / 2);
			return Math.abs(x - walker.x) <= half && y >= walker.y - PERSON_TILES * 0.97 && y <= walker.y + 0.15;
		};
		const inside = ([rx, ry, rw, rh]: Rect) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;
		const people = this.present()
			.filter(({ walker, sleep }) =>
				sleep?.bed && !walker.moving ? inside(sleep.bed.rect) : walker.sprite.visible && over(walker),
			)
			.sort((a, b) => b.walker.y - a.walker.y)
			.map(({ character }) => this.characterTarget(character));
		const host = this.host && over(this.host.walker) ? [this.hostTarget()] : [];
		if (this.recruiter && over(this.recruiter.walker)) host.push(this.recruiterTarget());
		const townsfolk = [...(this.square?.targetsAt([x, y]) ?? []), ...(this.ambient?.targetsAt([x, y]) ?? [])];
		const work = this.benches?.targetsAt([x, y]) ?? [];
		const notices = this.questBoard?.targetsAt([x, y]) ?? [];
		const fidgets = this.fidgets?.targetsAt([x, y]) ?? [];
		const doors = this.doors.filter(({ rect }) => inside(rect)).map((door) => this.doorTarget(door));
		const furniture = (this.layout.place.furniture ?? [])
			// Over someone at the recruiting desk, the coordinator's own Recruit says it once.
			.filter(({ rect, use }) => inside(rect) && !(use === "recruit" && people.length))
			.map((piece) => this.furnitureTarget(piece));
		const banners = this.bannerRects.filter(({ rect }) => inside(rect)).map(({ name }) => this.bannerTarget(name));
		return [...people, ...townsfolk, ...host, ...work, ...notices, ...fidgets, ...doors, ...banners, ...furniture];
	}

	/** A banner: its whole name, however short it had to be stitched. */
	private bannerTarget(name: string): Target {
		const ref = this.layout.ref;
		const notices =
			ref.kind === "wing"
				? [
						action(say(this.theme, "team-board"), () =>
							workplacePanels.open({ kind: "team", headquarters: ref.headquarters, team: ref.headquarters }),
						),
					]
				: [];
		return {
			name,
			tone: "object",
			actions: [
				...notices,
				action("Read", () => this.view.notify(say(this.theme, "banner-reads", { name })), name, "object"),
			],
		};
	}

	private workplaceActions(): Action[] {
		const ref = this.layout.ref;
		if (isOutside(ref)) return [];
		return [
			action(say(this.theme, "task-board"), () =>
				workplacePanels.open({ kind: "tasks", headquarters: ref.headquarters }),
			),
			action(say(this.theme, "team-board"), () =>
				workplacePanels.open({ kind: "team", headquarters: ref.headquarters, team: ref.headquarters }),
			),
		];
	}

	private agendaAction(): Action[] {
		const ref = this.layout.ref;
		if (isOutside(ref)) return [];
		return [
			action(say(this.theme, "meeting-agenda"), () =>
				workplacePanels.open({ kind: "meetings", headquarters: ref.headquarters }),
			),
		];
	}

	private giveAction(character: Character, walk: boolean): Action[] {
		const carried = workplacePanels.get().carrying;
		if (!carried) return [];
		const give = () => void workplacePanels.give(character);
		return [
			action(
				`${say(this.theme, "give-task")} \u201c${carried.title}\u201d to`,
				walk ? () => this.walkUpTo(character, give) : give,
				character.name,
				"character",
			),
		];
	}

	/** The host: talking to it opens its place's panel (the innkeeper's register). */
	private hostTarget(): Target {
		const host = this.host!;
		const open = () => this.openHostPanel();
		return {
			name: host.name,
			tone: "character",
			actions: [action("Talk to", () => this.approach(host.at, open), host.name, "character")],
		};
	}

	/** The square's recruiter: talking to it, or asking it at once, opens the form for an independent agent. */
	private recruiterTarget(): Target {
		const { name, at } = this.recruiter!;
		const open = () => recruiting.open({ kind: "independent" });
		return {
			name,
			tone: "character",
			actions: [
				action("Talk to", () => this.approach(at, open), name, "character"),
				action(say(this.theme, "recruit-independent"), () => this.approach(at, open)),
			],
		};
	}

	/** Recruiting a worker for the coordinator of the headquarters the operator is in, while it is awake. */
	private recruitWorker(): Action[] {
		const ref = this.layout.ref;
		const id = isOutside(ref) ? undefined : ref.headquarters;
		const coordinator = this.store.get()?.characters.find((c) => c.id === id && c.role === "coordinator");
		if (!coordinator) return [];
		return [
			action(say(this.theme, "recruit-worker"), () =>
				recruiting.open({ kind: "worker", coordinator: { id: coordinator.id, name: coordinator.name } }),
			),
		];
	}

	/** The notepad of the coordinator whose headquarters the operator is in, while it is awake. */
	private readNotes(): Action[] {
		const ref = this.layout.ref;
		const id = isOutside(ref) ? undefined : ref.headquarters;
		const coordinator = this.store.get()?.characters.find((c) => c.id === id && c.role === "coordinator");
		if (!coordinator) return [];
		return [action("Read the notes", () => notepad.open({ id: coordinator.id, name: coordinator.name }))];
	}

	private openHostPanel() {
		if (this.layout.ref.kind === "inn") placePanels.open("innkeeper");
		if (this.layout.ref.kind === "rookery") placePanels.open("rookery");
		if (this.layout.ref.kind === "square") squarePanels.openCrier();
		if (this.layout.ref.kind === "forge") forge.open();
		if (this.layout.ref.kind === "quest-office") atlassian.open({ kind: "clerk" });
		if (this.layout.ref.kind === "library") atlassian.open({ kind: "librarian" });
	}

	/** Furniture that answers the pointer: asking at an inn table opens the innkeeper's register at once. */
	private furnitureTarget(piece: { name: string; rect: Rect; use: string }): Target {
		// The coordinator's desk recruits a worker (ticket 10).
		if (piece.use === "recruit") return { name: piece.name, tone: "object", actions: this.recruitWorker() };
		if (piece.use === "notes")
			return { name: piece.name, tone: "object", actions: [...this.workplaceActions(), ...this.readNotes()] };
		const actions =
			piece.use === "innkeeper"
				? [action(say(this.theme, "ask-host"), () => placePanels.open("innkeeper"))]
				: piece.use === "smith"
					? [action(say(this.theme, "ask-smith"), () => forge.open())]
					: piece.use === "clerk" || piece.use === "librarian"
						? this.atlassianFurniture(piece)
						: piece.use === "rookery"
							? [
									action("Read the mail", () => placePanels.open("rookery")),
									action(say(this.theme, "write-letter"), () => placePanels.open("rookery", { write: true })),
								]
							: [];
		return { name: piece.name, tone: "object", actions };
	}

	/**
	 * The quest office's board (the piece holding its notices) reads as the clerk's list; its counter and the library's
	 * desks ask the host.
	 */
	private atlassianFurniture(piece: { name: string; rect: Rect; use: string }) {
		const [x, y, w, h] = piece.rect;
		const holdsNotices = this.layout.place.overlaySlots.some(
			({ kind, at: [sx, sy] }) => kind === "notice" && sx >= x && sx <= x + w && sy >= y && sy <= y + h,
		);
		const panel = piece.use === "clerk" ? ({ kind: "clerk" } as const) : ({ kind: "librarian" } as const);
		return [action(holdsNotices ? "Read" : "Ask at", () => atlassian.open(panel))];
	}

	/** A sleeper at the inn: read its last conversation (the default), or wake it. */
	private sleeperTarget(character: Character): Target {
		const name = character.name;
		const agent = () => this.store.get()?.dormant?.find((sleeper) => sleeper.id === character.id);
		return {
			name,
			tone: "character",
			actions: [
				// A former member must be rehired before it can take work.
				...(agent()?.retiredAt ? [] : this.giveAction(character, false)),
				action(
					"Read last talk with",
					() => {
						const sleeper = agent();
						if (sleeper) placeActions.readConversation(sleeper);
					},
					name,
					"character",
				),
				action("Wake", () => void placeActions.wake(character), name, "character"),
				action("Look up", () => placePanels.open("innkeeper"), name, "character"),
			],
		};
	}

	private characterTarget(character: Character): Target {
		if (this.layout.ref.kind === "inn") return this.sleeperTarget(character);
		const name = character.name;
		return {
			name,
			tone: "character",
			actions: [
				...this.giveAction(character, true),
				// The conversation panel and the interface's character card answer these intents.
				action(
					"Talk to",
					() => this.walkUpTo(character, () => this.view.intend({ kind: "talk-to", character: character.id })),
					name,
					"character",
				),
				action("Examine", () => this.view.intend({ kind: "examine", character: character.id }), name, "character"),
				...(this.layout.ref.kind === "meeting-room" ? this.agendaAction() : []),
				// A coordinator recruits workers who report to it (ticket 10).
				...(character.role === "coordinator"
					? [
							action(say(this.theme, "recruit-worker"), () =>
								this.walkUpTo(character, () =>
									recruiting.open({ kind: "worker", coordinator: { id: character.id, name } }),
								),
							),
							action("Read the notes of", () => notepad.open({ id: character.id, name }), name, "character"),
						]
					: []),
				// Renaming and retiring need no walk: each opens its form at once (ticket 12).
				action("Rename", () => renaming.open(character), name, "character"),
				...(character.facts?.title
					? [action(say(this.theme, "retire"), () => retiring.open(character), name, "character")]
					: []),
				// Ending its session asks first while it is busy (the interface's confirmation).
				action("End session of", () => void placeActions.endSession(character), name, "character"),
			],
		};
	}

	private doorTarget(door: SceneDoor): Target {
		// The inn's stairs lead to the rooms of sleepers beyond its spots: the innkeeper keeps their list.
		if (door.to === "rooms")
			return {
				name: door.name,
				tone: "object",
				actions: [action(say(this.theme, "ask-upstairs"), () => placePanels.open("innkeeper"), door.name, "object")],
			};
		// Between the square and the street there is no door to enter, only the way on.
		const open = [this.layout.ref.kind, door.to].every((kind) => kind === "square" || kind === "street");
		return {
			name: door.name,
			tone: "object",
			actions: [
				action(open ? "Go to" : "Enter", () => this.useDoor(door), door.name, "object"),
				...(door.to === "meeting-room" ? this.agendaAction() : []),
			],
		};
	}

	/** Every action at a point, the default first: the targets' actions, then walking there. */
	private actionsAt(point: Point): Action[] {
		return [
			...this.targetsAt(point).flatMap((target) => target.actions),
			action("Walk here", () => this.walkTo(point)),
		];
	}

	private refreshHover() {
		const at = this.worldPointer();
		if (!at || this.leaving) {
			this.showCursor("walk");
			this.cursor = undefined;
			return pointer.hover(undefined);
		}
		const actions = this.actionsAt(at);
		pointer.hover(actions);
		this.showCursor(actions.length > 1 ? "act" : this.blockedAt(at) ? "blocked" : "walk");
	}

	/** The pack's hand on the canvas: it taps over something to do, is a fist over walls, and points over floor. */
	private showCursor(kind: CursorKind) {
		const art = cursorArt(kind, this.time.now);
		this.cursor = { kind, art };
		const css = cursorCss(this.theme.url, art);
		if (css === this.cursorShown) return;
		this.cursorShown = css;
		this.input.setDefaultCursor(css);
	}

	/** Floor nobody can walk to: furniture, walls, or off the place (someone standing there does not count). */
	private blockedAt(at: Point): boolean {
		const cell = cellOf(this.walkable, at);
		return cell < 0 || this.walkable.blocked[cell] === 1;
	}

	/**
	 * The pointer over the world, in tiles; undefined when it is off the canvas or over the interface or a panel. A
	 * panel opened under a still pointer sends the canvas no `gameout`, so the hover text and a piece's sign stayed
	 * drawn under it; asking the page what is under the pointer catches that.
	 */
	private worldPointer(): Point | undefined {
		const at = this.pointerAt;
		if (!at) return undefined;
		const canvas = this.game.canvas;
		const box = canvas.getBoundingClientRect();
		if (document.elementFromPoint(box.left + at[0], box.top + at[1]) !== canvas) return undefined;
		return this.toWorld(at);
	}

	// Walking.

	/** Walk to a point, or the nearest open floor to it; `then` runs on arrival, with whether it got there. */
	private walkTo(to: Point | Point[], then?: (reached: boolean, goal: Point) => void) {
		this.walkToFirst([(Array.isArray(to[0]) ? to : [to]) as Point[]], then);
	}

	/** Walk to the first group of targets that can be reached (the quickest within it), else as near as possible. */
	private walkToFirst(groups: Point[][], then?: (reached: boolean, goal: Point) => void) {
		const from: Point = [this.avatar.x, this.avatar.y];
		this.freeLook = undefined;
		let walk: { points: Point[]; goal: Point; reached: boolean } | undefined;
		for (const targets of groups) {
			const path = findPath(this.walkable, from, targets);
			if (!path) break;
			const reached = targets.some(([x, y]) => Math.hypot(x - path.goal[0], y - path.goal[1]) <= REACH);
			if (!walk || reached) walk = { ...path, reached };
			if (reached) break;
		}
		if (!walk) return this.avatar.stop();
		const { points, goal, reached } = walk;
		this.avatar.walk(points, then && (() => then(reached, goal)));
	}

	/** Walk up to a character, to whichever side is quickest, face it, and then act. */
	private walkUpTo(character: Character, then?: () => void) {
		const figure = this.figures.get(character.id);
		if (!figure || figure.leaving) return;
		this.approach(figure.spot ?? [figure.walker.x, figure.walker.y], then);
	}

	/** Walk up to whoever stands at `at`, to whichever side is quickest, face them, and then act. */
	private approach(at: Point, then?: () => void) {
		// Whoever belongs there and is out wandering comes back to meet the avatar.
		this.wander?.recall(at);
		const stands = TALK_OFFSETS.map((group) => group.map(([dx, dy]): Point => [at[0] + dx, at[1] + dy]));
		this.walkToFirst(stands, (reached, goal) => {
			this.avatar.face(at);
			if (reached || Math.hypot(goal[0] - at[0], goal[1] - at[1]) <= 1.6) then?.();
			else this.view.notify("I can't reach them from here.");
		});
	}

	/**
	 * Walk to a door's stand point and on into it without stopping: going through starts as the avatar reaches the stand
	 * point, and the view fades while it steps in. A door that leads nowhere yet stops it at the stand point.
	 */
	private useDoor(door: SceneDoor) {
		const from: Point = [this.avatar.x, this.avatar.y];
		this.freeLook = undefined;
		const path = findPath(this.walkable, from, [door.standAt]);
		if (!path) return this.avatar.stop();
		if (dist(path.goal, door.standAt) > REACH) {
			this.avatar.walk(path.points, () => this.view.notify("I can't reach that door from here."));
			return;
		}
		const [x, y, w, h] = door.rect;
		const inside: Point = [x + w / 2, y + h / 2];
		const [sx, sy] = door.standAt;
		const length = dist(inside, door.standAt);
		const step = Math.min(STEP_IN, length) / (length || 1);
		const through: Point = [sx + (inside[0] - sx) * step, sy + (inside[1] - sy) * step];
		const points = path.points.length > 1 ? path.points : [from, door.standAt];
		this.avatar.walk(
			[...points, through],
			() => this.avatar.face(inside),
			() => {
				if (this.openDoor(door)) return;
				this.avatar.stop();
				this.avatar.face(inside);
			},
		);
	}

	// The pointer.

	private pointerDown(pointerEvent: Phaser.Input.Pointer) {
		if (this.leaving) return;
		const at: Point = [pointerEvent.x, pointerEvent.y];
		this.pointerAt = at;
		// Clicking off an open menu only closes it, as in RuneScape.
		const consumed = pointer.menuOpen();
		pointer.closeMenu();
		if (pointerEvent.rightButtonDown()) {
			this.drag = undefined;
			pointer.openMenu(at[0], at[1], this.actionsAt(this.toWorld(at)));
			return;
		}
		this.drag = { x: at[0], y: at[1], mid: this.mid, moved: false, consumed };
	}

	private pointerMove(pointerEvent: Phaser.Input.Pointer) {
		this.pointerAt = [pointerEvent.x, pointerEvent.y];
		const drag = this.drag;
		if (!drag || !pointerEvent.isDown) return;
		const dx = pointerEvent.x - drag.x;
		const dy = pointerEvent.y - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		drag.moved = true;
		const zoom = this.cameras.main.zoom;
		this.freeLook = this.clampMid([drag.mid[0] - dx / zoom, drag.mid[1] - dy / zoom], zoom);
		this.mid = this.freeLook;
		this.applyCamera();
	}

	private pointerUp(pointerEvent: Phaser.Input.Pointer) {
		const drag = this.drag;
		this.drag = undefined;
		if (!drag || drag.moved || drag.consumed || this.leaving || pointerEvent.button !== 0) return;
		const at = this.toWorld([pointerEvent.x, pointerEvent.y]);
		const actions = this.actionsAt(at);
		actions[0].run();
		// RuneScape's markers: a red X on what it acts on, a yellow X where the avatar is heading.
		if (actions.length > 1) return this.marks.drop("act", at);
		const path = this.avatar.view().path;
		this.marks.drop("walk", this.avatar.moving ? path[path.length - 1] : at);
	}

	private pointerOut() {
		this.pointerAt = undefined;
		pointer.hover(undefined);
	}

	private wheel(_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) {
		this.zoomTarget = this.clampZoom(this.zoomTarget * Math.exp(-dy * 0.0015));
		chosenZoom.set(this.layout.data, this.zoomTarget);
	}

	// What the interface asks of the world.

	/**
	 * The interface's walking intents: a minimap click walks there, Go to walks up to a character (travelling to its
	 * place first), and Settings shows the walk grid. Travel, talking from the panel, examining, and the terminal are
	 * carried out where the interface wires them (main.tsx and the interface itself).
	 */
	private intended(intent: WorldIntent) {
		if (intent.kind === "walk-to" && intent.place === this.layout.key && !this.leaving) this.walkTo(intent.at);
		if (intent.kind === "walk-grid") this.setGrid(intent.shown);
		if (intent.kind === "go-to") {
			const figure = this.figures.get(intent.character);
			const here = figure && !figure.leaving ? figure.character : undefined;
			if (here && !this.leaving) return this.walkUpTo(here);
			const there = this.store.get()?.characters.find((c) => c.id === intent.character);
			if (there) this.travel(there.place, intent.character);
		}
	}

	// The world changing under the view.

	private worldChanged() {
		if (this.leaving) return;
		this.dressAvatar();
		const world = this.store.get();
		const next = layoutFor(this.layout.ref, world, this.theme);
		if (!next) {
			// Its headquarters closed: go where the world opens now.
			this.travel(startPlace(world));
			return;
		}
		if (next.signature !== this.layout.signature) {
			this.scene.restart({
				ref: this.layout.ref,
				keep: { avatar: [this.avatar.x, this.avatar.y], facing: this.avatar.facing, mid: this.mid },
			} satisfies SceneData);
			return;
		}
		this.layout = next;
		this.showCharacters(true);
		this.showLetters();
		this.flyNewMail();
	}

	// Travel.

	/** Go through a door; false when it leads nowhere yet. */
	private openDoor(door: SceneDoor): boolean {
		const here = this.layout.ref;
		const headquarters = isOutside(here) ? lastHeadquarters : here.headquarters;
		const world = this.store.get();
		if (door.to === "square") return this.travel({ kind: "square" });
		if (door.to === "street" && this.theme.places.street) return this.travel({ kind: "street" });
		if (
			(door.to === "inn" ||
				door.to === "rookery" ||
				door.to === "forge" ||
				door.to === "quest-office" ||
				door.to === "library") &&
			this.theme.places[door.to]
		)
			return this.travel({ kind: door.to });
		if (door.to === "wing" && door.repository && !isOutside(here))
			return this.travel({ kind: "wing", headquarters: here.headquarters, repository: door.repository });
		if (door.to === "headquarters" && here.kind === "square") {
			const all = world?.headquarters ?? [];
			if (all.length === 0) {
				this.view.notify(say(this.theme, "headquarters-empty"));
				return false;
			}
			if (all.length === 1) return this.travel({ kind: "headquarters", headquarters: all[0].id });
			this.view.update({
				chooser: {
					title: "Whose headquarters?",
					choices: all.map((hq) => ({
						label: hq.name,
						detail: `${hq.wings.length} ${this.theme.labels.wing}${hq.wings.length === 1 ? "" : "s"}`,
						choose: () => this.travel({ kind: "headquarters", headquarters: hq.id }),
					})),
				},
			});
			return false;
		}
		if (
			(door.to === "headquarters" ||
				door.to === "common-room" ||
				door.to === "meeting-room" ||
				door.to === "gallery") &&
			headquarters
		)
			return this.travel({ kind: door.to, headquarters });
		this.view.notify(`${this.theme.labels[door.to] ?? door.name} is not open yet.`);
		return false;
	}

	/**
	 * Leave for another place with a short fade; the avatar arrives at the entry for where it came from. Asked again
	 * for the same place while leaving (the interface and the world both answering a Go to), it only adds `goTo`.
	 */
	travel(ref: PlaceRef, goTo?: string): boolean {
		if (this.leaving) {
			if (goTo && this.departure?.ref && placeKey(this.departure.ref) === placeKey(ref)) this.departure.goTo = goTo;
			return false;
		}
		this.leaving = true;
		this.view.update({ chooser: undefined });
		pointer.closeMenu();
		pointer.hover(undefined);
		const from = this.layout.ref.kind === "wing" ? `wing:${this.layout.ref.repository}` : this.layout.ref.kind;
		this.departure = { ref, from, goTo };
		const camera = this.cameras.main;
		camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart(this.departure));
		camera.fadeOut(FADE_OUT_MS, ...rgb(this.theme.world.backdrop));
		return true;
	}

	/** Where the avatar arrives: the entry for where it came from, a wing's own door, or the place's start. */
	private arrival(): Point {
		const { place, niches } = this.layout;
		if (niches && this.from) {
			const door =
				this.from === "meeting-room"
					? this.doors.find((d) => d.to === "meeting-room")
					: this.from.startsWith("wing:")
						? this.doors.find((d) => d.repository === this.from!.slice("wing:".length))
						: undefined;
			if (door) return door.standAt;
		}
		return (this.from && place.entries[this.from]) || place.entries.start || [place.cols / 2, place.rows / 2];
	}

	/** Arriving through a door, the avatar faces away from it, into the room. */
	private arrivalFacing([ax, ay]: Point, door: Door): Facing {
		const [x, y, w, h] = door.rect;
		const dx = ax - (x + w / 2);
		const dy = ay - (y + h / 2);
		return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
	}

	// The camera.

	/**
	 * The whole place fits the window at the smallest zoom: a place of another shape than the window then shows the
	 * backdrop beside it, as RuneScape shows the void past the map's edge. Only the operator's wheel goes there; the
	 * default zoom and the camera's follow always fill the window.
	 */
	private minZoom(): number {
		const { cols, rows } = this.layout.place;
		return Math.min(this.scale.width / (cols * TILE), this.scale.height / (rows * TILE));
	}

	/** The zoom at which the place just fills the window. */
	private coverZoom(): number {
		const { cols, rows } = this.layout.place;
		return Math.max(this.scale.width / (cols * TILE), this.scale.height / (rows * TILE));
	}

	private maxZoom(): number {
		return Math.max(MAX_ZOOM, this.coverZoom());
	}

	/** At first, the place fills the window, and never smaller than the painting's own size. */
	private defaultZoom(): number {
		return Math.max(1, this.coverZoom());
	}

	private clampZoom(zoom: number): number {
		return Math.min(this.maxZoom(), Math.max(this.minZoom(), zoom));
	}

	private resized() {
		this.zoomTarget = this.clampZoom(this.zoomTarget);
		this.cameras.main.setZoom(this.clampZoom(this.cameras.main.zoom));
		this.mid = this.clampMid(this.mid, this.cameras.main.zoom);
		this.applyCamera();
	}

	/**
	 * Where the view centres to follow the avatar: on it, kept on the painting (a side the whole place fits stays
	 * centred). Only where a panel covers the avatar does the painting slide out from under the panel, as far as it
	 * takes to bring the avatar into the open and no further than the panel reaches; so near an edge the painting still
	 * fills the window, and a room seen whole does not drift with every step.
	 */
	private followMid(zoom: number): Point {
		const { cols, rows } = this.layout.place;
		const { width, height } = this.scale;
		const { top, right, bottom, left, panels } = this.insets;
		const onPainting = (v: number, size: number, view: number) =>
			size <= view ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, v));
		const [ax0, ay0] = this.avatarMid();
		let mx = onPainting(ax0, cols * TILE, width / zoom);
		let my = onPainting(ay0, rows * TILE, height / zoom);
		// The avatar's box on screen (CSS px) with the view at (mx, my); it stays this far inside the uncovered part.
		const margin = 16;
		// What must show: the avatar, and a door it stands at (walking up to a door under a panel brings it out).
		const { x, y } = this.avatar;
		let [x0, y0, x1, y1] = [x - 0.5, y - PERSON_TILES, x + 0.5, y + 0.25];
		const door = this.doors.find(({ standAt }) => dist(standAt, [x, y]) <= 0.6);
		if (door) {
			const [rx, ry, rw, rh] = door.rect;
			[x0, y0, x1, y1] = [Math.min(x0, rx), Math.min(y0, ry), Math.max(x1, rx + rw), Math.max(y1, ry + rh)];
		}
		const box = () => ({
			left: (x0 * TILE - mx) * zoom + width / 2,
			right: (x1 * TILE - mx) * zoom + width / 2,
			top: (y0 * TILE - my) * zoom + height / 2,
			bottom: (y1 * TILE - my) * zoom + height / 2,
		});
		for (const panel of panels) {
			const b = box();
			const overlaps =
				b.right > panel.left - margin &&
				b.left < panel.right + margin &&
				b.bottom > panel.top - margin &&
				b.top < panel.bottom + margin;
			if (!overlaps) continue;
			if (panel.edge === "bottom") my += (b.bottom - (panel.top - margin)) / zoom;
			else if (panel.edge === "right") mx += (b.right - (panel.left - margin)) / zoom;
			else my -= (panel.bottom + margin - b.top) / zoom;
		}
		// No further than the panels reach.
		const reach = (v: number, size: number, view: number, low: number, high: number) => {
			const centred = size <= view;
			const least = centred ? size / 2 - Math.max(0, low / zoom - (view - size) / 2) : view / 2 - low / zoom;
			const most = centred ? size / 2 + Math.max(0, high / zoom - (view - size) / 2) : size - view / 2 + high / zoom;
			return Math.min(most, Math.max(least, v));
		};
		return [reach(mx, cols * TILE, width / zoom, left, right), reach(my, rows * TILE, height / zoom, top, bottom)];
	}

	private avatarMid(): Point {
		return [this.avatar.x * TILE, (this.avatar.y - FOLLOW_LIFT) * TILE];
	}

	/**
	 * Keep the view on the painting; a place smaller than the view sits in its middle. At an edge the interface covers,
	 * the painting may slide out from under it, so a door or a character there can be brought into the open.
	 */
	private clampMid([x, y]: Point, zoom: number): Point {
		const { cols, rows } = this.layout.place;
		const { top, right, bottom, left } = this.insets;
		const clamp = (v: number, size: number, view: number, low: number, high: number) =>
			size <= view ? size / 2 : Math.min(size - view / 2 + high / zoom, Math.max(view / 2 - low / zoom, v));
		return [
			clamp(x, cols * TILE, this.scale.width / zoom, left, right),
			clamp(y, rows * TILE, this.scale.height / zoom, top, bottom),
		];
	}

	private lookAround(delta: number) {
		const keys = this.keys;
		if (!keys) return;
		const dx = (keys.right.isDown || keys.d.isDown ? 1 : 0) - (keys.left.isDown || keys.a.isDown ? 1 : 0);
		const dy = (keys.down.isDown || keys.s.isDown ? 1 : 0) - (keys.up.isDown || keys.w.isDown ? 1 : 0);
		if (!dx && !dy) return;
		const step = (PAN_SPEED * delta) / 1000 / this.cameras.main.zoom;
		const zoom = this.cameras.main.zoom;
		this.freeLook = this.clampMid(
			[(this.freeLook ?? this.mid)[0] + dx * step, (this.freeLook ?? this.mid)[1] + dy * step],
			zoom,
		);
	}

	/** Ease the zoom to the wheel's choice and the view to the avatar (or where the operator is looking). */
	private followCamera(delta: number) {
		const camera = this.cameras.main;
		const seconds = Math.min(delta, 100) / 1000;
		if (Math.abs(camera.zoom - this.zoomTarget) > 1e-4)
			camera.setZoom(camera.zoom + (this.zoomTarget - camera.zoom) * (1 - Math.exp(-ZOOM_RATE * seconds)));
		else if (camera.zoom !== this.zoomTarget) camera.setZoom(this.zoomTarget);
		const [tx, ty] = this.freeLook ? this.clampMid(this.freeLook, camera.zoom) : this.followMid(camera.zoom);
		const ease = this.freeLook ? 1 - Math.exp(-FOLLOW_RATE * 3 * seconds) : 1 - Math.exp(-FOLLOW_RATE * seconds);
		const [mx, my] = this.clampMid(this.mid, camera.zoom);
		this.mid = [mx + (tx - mx) * ease, my + (ty - my) * ease];
		this.applyCamera();
	}

	/**
	 * Scroll to `mid`, rounded so the painting lands on whole screen pixels: as the view eases, the picture moves by
	 * whole pixels instead of being resampled at a new fraction each frame, which made fine pixel art shimmer.
	 */
	private applyCamera() {
		const camera = this.cameras.main;
		const { zoom, width, height } = camera;
		const snap = (mid: number, size: number) => (Math.round(mid * zoom - size / 2) + size / 2) / zoom - size / 2;
		camera.setScroll(snap(this.mid[0], width), snap(this.mid[1], height));
		Walker.snap = zoom;
	}
}

interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
	/** Each panel at an edge, in CSS px, with the edge it reaches: the view slides only for what it covers. */
	panels: { edge: "top" | "right" | "bottom"; left: number; top: number; right: number; bottom: number }[];
}

/** A box on screen, in CSS px. */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const dist = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(ax - bx, ay - by);

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** What of the HTML interface covers the world: panels, the place's title, notices, and the hover text. */
function interfaceBoxes(): Box[] {
	const selector = ".place-title, .aw-side, .aw-top-right, .aw-chat, .aw-card, .notice, .pointer-hover";
	return [...document.querySelectorAll(selector)]
		.map((element) => element.getBoundingClientRect())
		.filter((r) => r.width && r.height)
		.map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
}

/**
 * How far the HTML interface reaches into the window from each edge (CSS px): the side panel and minimap on the
 * right, the chatbox at the bottom, the place's title at the top. Panels that are folded reach less far.
 */
function interfaceInsets(): Insets {
	const width = window.innerWidth;
	const height = window.innerHeight;
	const boxes = (selector: string) =>
		[...document.querySelectorAll(selector)].map((element) => element.getBoundingClientRect()).filter((r) => r.width);
	const gap = 8;
	const right = boxes(".aw-side, .aw-top-right").filter((r) => r.right > width - 40);
	const bottom = boxes(".aw-chat").filter((r) => r.bottom > height - 40);
	const top = boxes(".place-title").filter((r) => r.top < 40);
	const panel = (edge: Insets["panels"][number]["edge"]) => (r: DOMRect) => ({
		edge,
		left: r.left,
		top: r.top,
		right: r.right,
		bottom: r.bottom,
	});
	return {
		right: right.length ? width - Math.min(...right.map((r) => r.left)) + gap : 0,
		bottom: bottom.length ? height - Math.min(...bottom.map((r) => r.top)) + gap : 0,
		top: top.length ? Math.max(...top.map((r) => r.bottom)) + gap : 0,
		left: 0,
		panels: [...right.map(panel("right")), ...bottom.map(panel("bottom")), ...top.map(panel("top"))],
	};
}

/** A name's pieces, each with the separator after it; a one- or two-letter piece ("a-") stays with the next. */
function bannerParts(name: string): string[] {
	const parts: string[] = [];
	for (const part of name.split(/(?<=[-_./ ])/)) {
		const last = parts.at(-1);
		if (last !== undefined && last.trim().length <= 2) parts[parts.length - 1] = last + part;
		else parts.push(part);
	}
	return parts;
}

/** The pieces on one to `most` lines, broken between pieces; undefined when none fits. */
function bannerLines(parts: string[], fits: (line: string) => boolean, most = 4): string[] | undefined {
	const whole = parts.join("");
	if (fits(whole)) return [whole];
	for (let lines = 2; lines <= most; lines++) {
		const split = splitInto(parts, lines, fits);
		if (split) return split.map((line) => line.trim());
	}
	return undefined;
}

/** Join `parts` into `count` lines that all fit, the longest line as short as possible; undefined when none do. */
function splitInto(parts: string[], count: number, fits: (line: string) => boolean): string[] | undefined {
	if (count === 1) {
		const line = parts.join("");
		return fits(line.trim()) ? [line] : undefined;
	}
	let best: string[] | undefined;
	for (let i = 1; i <= parts.length - count + 1; i++) {
		const head = parts.slice(0, i).join("");
		if (!fits(head.trim())) break;
		const rest = splitInto(parts.slice(i), count - 1, fits);
		if (!rest) continue;
		const split = [head, ...rest];
		const longest = (lines: string[]) => Math.max(...lines.map((line) => line.length));
		if (!best || longest(split) < longest(best)) best = split;
	}
	return best;
}
