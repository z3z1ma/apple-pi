import * as Phaser from "phaser";
import { type Character, type PlaceRef, placeKey } from "../../src/world.js";
import { avatarLookIn, lookFor } from "../looks.js";
import { pointer } from "../overlay/pointer/pointer-state.js";
import { type Door, type OverlaySlot, type Point, type Theme, TILE } from "../theme.js";
import type { ViewStore, WorldIntent } from "../view-state.js";
import type { WorldStore } from "../world-store.js";
import { type Action, action, type Target } from "./actions.js";
import {
	type BadgeKind,
	badgeFor,
	barkFor,
	drawBadge,
	drawBark,
	needsYou,
	poseFor,
	tempoFor,
} from "./character-life.js";
import { assignSpots, charactersIn, doorOf, type Layout, layoutFor, startPlace, walkGrid } from "./layout.js";
import { findPath, type Grid, gridFor } from "./pathing.js";
import { type Facing, PERSON_TILES, type Pose, Walker, type WalkerView } from "./walker.js";

const STANDING = 120; // sprite px from head to feet in a standing frame
const FADE_OUT_MS = 240;
const FADE_IN_MS = 320;
const PAN_SPEED = 900; // world px per second with the arrow keys
const DRAG_THRESHOLD = 6; // screen px before a press becomes a drag
const SEAM_PX = 24; // painting px over which two strips of a growing place blend
const BANNER_TILES = 2.3; // a banner's width; it hangs in front of the door below it
/** The banner's name, largest first, down to the smallest size that still reads at the default zoom. */
const BANNER_FONT = [15, 10] as const;
const INK = "#4a2a14";
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
/** Where a badge floats, in tiles above the feet, by pose (a raised hand reaches higher than a head). */
const BADGE_LIFT: Record<Pose, number> = { standing: 2.12, seated: 2.12, asking: 2.12 };
/** A character that needs the operator barks this long after it starts to, then every so often; each bark lasts. */
const FIRST_BARK_MS = [1200, 2200] as const;
const BARK_EVERY_MS = [22_000, 38_000] as const;
const BARK_MS = 4200;
/** Below this zoom, badges and barks are drawn larger so they keep this zoom's size on screen. */
const UI_ZOOM = 1;
/** How often the interface's panels are measured for how far the painting may slide out from under them. */
const INSETS_EVERY_MS = 300;
/** At most this many barks show in a place at once, so a busy room stays calm. */
const BARKS_AT_ONCE = 2;

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
	bark?: { line: string; container: Phaser.GameObjects.Container; until: number };
	/** When it barks next (scene time, ms), while it needs the operator. */
	nextBark?: number;
	barks: number;
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
	bark: string | null;
	alpha: number;
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
	private readonly theme: Theme;
	private readonly store: WorldStore;
	private readonly view: ViewStore;
	private layout!: Layout;
	private from?: string;
	private keep?: SceneData["keep"];
	private figures = new Map<string, Figure>();
	/** The banners hung in the place, and how their names were stitched. */
	private banners: BannerView[] = [];
	/** The overlays drawn in the place's slots, for the tests' view. */
	private overlays: { slot: OverlaySlot; object: Phaser.GameObjects.Image; frame?: () => number }[] = [];
	private doors: SceneDoor[] = [];
	private gridOverlay?: Phaser.GameObjects.Graphics;
	/** With the walk grid shown, the avatar's walk: its straight runs and corners. */
	private pathOverlay?: Phaser.GameObjects.Graphics;
	private walkable!: Grid;
	private avatar!: Walker;
	private avatarLook = "";
	private leaving = false;
	private drag?: { x: number; y: number; mid: Point; moved: boolean; consumed: boolean };
	private keys?: Record<"left" | "right" | "up" | "down" | "a" | "d" | "w" | "s", Phaser.Input.Keyboard.Key>;
	/** The point the camera centres on, in world px; it eases toward the avatar. */
	private mid: Point = [0, 0];
	/** Looking around (dragging, the arrow keys) holds the camera off the avatar until it walks again. */
	private freeLook?: Point;
	private zoomTarget = 1;
	private pointerAt?: Point;
	private goTo?: string;
	/** How far the interface's panels reach in from each edge of the window (CSS px), measured now and then. */
	private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
	private insetsAt = -Infinity;
	/** Where the avatar is leaving for, read when the fade ends (a `go-to` may add whom to walk up to). */
	private departure?: SceneData;

	constructor(theme: Theme, store: WorldStore, view: ViewStore) {
		super("place");
		this.theme = theme;
		this.store = store;
		this.view = view;
	}

	init(data: SceneData) {
		const world = this.store.get();
		const ref = data.ref ?? startPlace(world);
		this.layout = layoutFor(ref, world, this.theme) ?? layoutFor(startPlace(world), world, this.theme)!;
		this.from = data.from;
		this.keep = data.keep;
		this.goTo = data.goTo;
		this.departure = undefined;
		this.figures = new Map();
		this.banners = [];
		this.doors = [];
		this.gridOverlay = undefined;
		this.pathOverlay = undefined;
		this.leaving = false;
		this.drag = undefined;
		this.freeLook = undefined;
		this.pointerAt = undefined;
		if (this.layout.ref.kind !== "square") lastHeadquarters = this.layout.ref.headquarters;
	}

	create() {
		const { title, subtitle } = this.layout;
		this.view.update({ title, subtitle, chooser: undefined });
		pointer.closeMenu();
		this.drawPainting();
		this.drawForeground();
		this.drawOverlays();
		this.drawWingDoors();
		this.drawBanners();
		this.doors.unshift(...this.layout.place.doors);
		this.addAvatar();
		this.showCharacters(false);
		if (showGrid) this.drawGrid();

		const camera = this.cameras.main;
		this.insets = interfaceInsets();
		this.zoomTarget = this.clampZoom(chosenZoom.get(this.layout.data) ?? this.defaultZoom());
		camera.setZoom(this.zoomTarget);
		this.mid = this.keep?.mid ?? this.clampMid(this.avatarMid(), camera.zoom);
		this.applyCamera();
		if (!this.keep) camera.fadeIn(FADE_IN_MS, 20, 14, 24);

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
		});
	}

	update(time: number, delta: number) {
		if (time - this.insetsAt > INSETS_EVERY_MS) {
			this.insetsAt = time;
			this.insets = interfaceInsets();
		}
		this.avatar.update(delta);
		this.liveCharacters(time, delta);
		if (showGrid) this.drawPath();
		this.lookAround(delta);
		this.followCamera(delta);
		this.refreshHover();
	}

	// Read-only hooks for tests and the overlay.

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

	private figureView({ character, walker, look, badge, bark }: Figure): FigureView {
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
			bark: bark?.line ?? null,
			alpha: walker.sprite.alpha,
		};
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
			wings: niches.map(({ wing }) => ({ name: wing.name, boarded: doorOf(wing) === "boarded", door: doorOf(wing) })),
		};
	}

	bannerViews(): BannerView[] {
		return this.banners.map((banner) => ({ ...banner }));
	}

	/** What animates over the painting: each overlay's kind, place (tiles), and the frame or brightness it shows. */
	overlayViews(): OverlayView[] {
		return this.overlays.map(({ slot, frame, object }) => ({
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
			this.add
				.image(0, 0, key)
				.setOrigin(0)
				.setDisplaySize(place.cols * TILE, place.rows * TILE)
				.setDepth(-2);
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
			this.add
				.image(strip.at * TILE, 0, key, frame)
				.setOrigin(0)
				.setScale(scale)
				.setDepth(-2);
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
			if (slot.kind === "glow") this.addGlow(slot);
		}
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
			ctx.beginPath();
			ctx.ellipse(rx * RES, ry * RES, rx * RES, ry * RES, 0, 0, Math.PI * 2);
			if (slot.hole?.length) {
				const [first, ...rest] = slot.hole.map(
					([hx, hy]): Point => [(hx * TILE - (cx * TILE - rx)) * RES, (hy * TILE - (cy * TILE - ry)) * RES],
				);
				ctx.moveTo(...first);
				for (const point of rest) ctx.lineTo(...point);
				ctx.closePath();
			}
			ctx.clip("evenodd");
			// The pool's own oval is a little larger than the basin, so its edge tucks under the rim.
			ctx.drawImage(source, -0.06 * canvas.width, -0.08 * canvas.height, canvas.width * 1.12, canvas.height * 1.16);
			this.textures.addCanvas(key, canvas);
			return key;
		});
		const water = this.add
			.image(cx * TILE, cy * TILE, keys[0])
			.setScale(1 / RES)
			.setDepth(-1)
			.setAlpha(0.92);
		let frame = 0;
		this.time.addEvent({
			delay: 260,
			loop: true,
			callback: () => {
				frame = (frame + 1) % 4;
				water.setTexture(keys[frame]);
			},
		});
		this.overlays.push({ slot, object: water, frame: () => frame });
	}

	/** Warm light around a lantern or a candle: a soft halo added to what is under it, flickering a little. */
	private addGlow(slot: OverlaySlot, strength = 0.5) {
		const [x, y] = slot.at;
		const glow = this.add
			.image(x * TILE, y * TILE, this.glowTexture())
			.setBlendMode(Phaser.BlendModes.ADD)
			.setDepth(9e4)
			.setAlpha(strength);
		const scale = ((slot.r ?? 0.9) * TILE * 2) / glow.width;
		glow.setScale(scale);
		const flicker = () =>
			this.tweens.add({
				targets: glow,
				alpha: strength * Phaser.Math.FloatBetween(0.62, 1),
				scale: scale * Phaser.Math.FloatBetween(0.97, 1.03),
				duration: Phaser.Math.Between(140, 420),
				ease: "Sine.inOut",
				onComplete: flicker,
			});
		flicker();
		this.overlays.push({ slot, object: glow });
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
		light.addColorStop(0, "rgba(255, 226, 160, 0.95)");
		light.addColorStop(0.12, "rgba(255, 196, 110, 0.6)");
		light.addColorStop(0.4, "rgba(255, 150, 60, 0.18)");
		light.addColorStop(1, "rgba(255, 120, 40, 0)");
		ctx.fillStyle = light;
		ctx.fillRect(0, 0, size, size);
		this.textures.addCanvas(key, canvas);
		return key;
	}

	/**
	 * Each wing's door in its niche: open while agents work there, closed while its agents sleep at the inn, and
	 * boarded up while it is remembered with nobody at all.
	 */
	private drawWingDoors() {
		const { niches } = this.layout;
		const template = this.theme.places.gallery.niches;
		if (!niches || !template) return;
		const [dx, dy, dw, dh] = template.door;
		for (const { wing, x } of niches) {
			const door = doorOf(wing);
			const image = this.add
				.image((x + dx + dw / 2) * TILE, (dy + dh) * TILE, `overlay:door-${door}`)
				.setOrigin(0.5, 1)
				.setDepth((dy + dh) * TILE - TILE);
			// Each state's sprite keeps its own proportions, at the niche's height.
			image.setScale((dh * TILE) / image.height);
			if (door === "open") this.addGlow({ kind: "glow", at: [x + dx + dw / 2, dy + dh - 0.35], r: dw * 0.75 }, 0.32);
			this.banner(x, template.banner[1], wing.name);
			this.doors.push({
				name: `${wing.name} wing`,
				rect: [x + dx, dy, dw, dh],
				standAt: [x + template.standAt[0], template.standAt[1]],
				to: "wing",
				repository: wing.repository,
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
	 * A cream banner hung with its rod at (x, top), the name stitched on it at the largest size that fits, broken after
	 * `-`, `_`, `.`, `/`, or a space onto up to four lines; a name that fits nowhere is cut short at the smallest
	 * legible size.
	 */
	private banner(x: number, top: number, name: string) {
		const image = this.add
			.image(x * TILE, top * TILE, "overlay:banner-cream")
			.setOrigin(0.5, 0)
			.setDepth((top + 6) * TILE);
		image.setScale((BANNER_TILES * TILE) / image.width);
		// The stitching stays inside the cloth's vine border, above the swallowtail.
		const width = image.displayWidth * 0.48;
		const height = image.displayHeight * 0.48;
		const text = this.add
			.text(x * TILE, top * TILE + image.displayHeight * 0.44, "", {
				fontFamily: 'Georgia, "Iowan Old Style", serif',
				fontStyle: "bold",
				color: INK,
				align: "center",
				lineSpacing: -2,
			})
			.setOrigin(0.5)
			.setResolution(4)
			.setDepth(image.depth + 1);
		const view: BannerView = { name, text: "", size: 0, fits: false };
		this.banners.push(view);
		const done = (size: number) => {
			const shown = text.text;
			view.text = shown;
			view.size = size;
			const tall = text.height;
			// Each line inside the border (a trailing separator may hang past it), and all of them above the tail.
			view.fits =
				tall <= height + 0.5 &&
				shown.split("\n").every((line) => {
					text.setText(line.replace(/[-_./]$/, ""));
					return text.width <= width + 0.5;
				});
			text.setText(shown);
		};
		// On one line while it reads well (from 12 px), else on as many as it takes at the largest size that fits.
		for (let size = BANNER_FONT[0]; size >= 12; size--) {
			text.setFontSize(size);
			text.setText(name);
			if (text.width <= width) return done(size);
		}
		for (let size = BANNER_FONT[0]; size >= BANNER_FONT[1]; size--) {
			text.setFontSize(size);
			const lines = bannerLines(name, (line) => {
				text.setText(line);
				return text.width <= width;
			});
			if (!lines) continue;
			text.setText(lines.join("\n"));
			if (text.height <= height) return done(size);
		}
		// Nothing fits whole: the smallest legible size, words that are too long broken with a hyphen (‐), on up to
		// four lines, the last cut short if there is still more.
		const size = BANNER_FONT[1];
		text.setFontSize(size);
		// A separator may hang just past the edge, as punctuation does.
		const fitsLine = (candidate: string) => {
			text.setText(candidate.trim().replace(/[-_./]$/, ""));
			return text.width <= width;
		};
		const lines: string[] = [];
		let line = "";
		for (let word of name.split(/(?<=[-_./ ])/)) {
			if (fitsLine(line + word)) {
				line += word;
				continue;
			}
			if (line) lines.push(line.trim());
			line = "";
			while (word.length > 6 && !fitsLine(word)) {
				// Never leave fewer than three letters on either side of the break.
				let n = word.replace(/[-_./ ]$/, "").length - 3;
				while (n > 3 && !fitsLine(`${word.slice(0, n)}\u2010`)) n--;
				lines.push(`${word.slice(0, n)}\u2010`);
				word = word.slice(n);
			}
			line = word;
		}
		if (line) lines.push(line.trim());
		const kept = lines.slice(0, 4);
		if (lines.length > kept.length) {
			let last = kept.pop()!.replace(/\u2010$/, "");
			while (last.length > 1 && !fitsLine(`${last}\u2026`)) last = last.slice(0, -1);
			kept.push(`${last}\u2026`);
		}
		text.setText(kept.join("\n"));
		done(size);
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

	private toggleGrid() {
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
		const characters = charactersIn(this.layout.ref, this.store.get());
		const ids = new Set(characters.map((character) => character.id));
		for (const figure of this.figures.values())
			if (!ids.has(figure.character.id) && !figure.leaving) this.leave(figure, animate);
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
			const moved = !figure.spot || figure.spot[0] !== spot[0] || figure.spot[1] !== spot[1];
			figure.spot = spot;
			if (returning || (moved && (animate || figure.walker.moving))) this.walkToSpot(figure);
			else if (moved) figure.walker.moveTo(spot);
			this.dress(figure);
		}
		// Characters block only their own footprint, at the spot they stand on or are walking to.
		this.walkable = gridFor(
			this.layout.place,
			this.present().map(({ spot }) => spot!),
		);
		for (const figure of arrivals) this.enter(figure);
	}

	private addFigure(character: Character, [x, y]: Point): Figure {
		const look = lookFor(this.theme, character);
		const walker = new Walker(this, look, this.theme.looks[look], [x, y], "down");
		const figure: Figure = { character, walker, look, leaving: false, barks: 0 };
		this.figures.set(character.id, figure);
		return figure;
	}

	/** The door characters come in and go out by, and a point just inside its doorway where they appear. */
	private doorway(): { door: Door; inside: Point } {
		const { place } = this.layout;
		const door = place.doors.find((d) => d.name === place.enterBy) ?? place.doors[0];
		const [x, y, w, h] = door.rect;
		const [sx, sy] = door.standAt;
		// From the stand point, a short step into the door's rect, toward its middle.
		const mid: Point = [x + w / 2, y + h / 2];
		const length = Math.hypot(mid[0] - sx, mid[1] - sy) || 1;
		const step = Math.min(DOOR_FADE, length);
		return { door, inside: [sx + ((mid[0] - sx) / length) * step, sy + ((mid[1] - sy) / length) * step] };
	}

	/** A newcomer comes through the door, fading in on the threshold, and walks to its spot. */
	private enter(figure: Figure) {
		const { door, inside } = this.doorway();
		figure.walker.setAlpha(0);
		figure.fade = { at: inside, out: false };
		const onward = this.pathFor(figure, door.standAt, figure.spot!);
		figure.walker.walk([inside, door.standAt, ...onward.slice(1)], () => this.settle(figure));
	}

	/** Its session stopped or moved on: it walks to the door and fades through it, then is gone. */
	private leave(figure: Figure, animate: boolean) {
		figure.leaving = true;
		figure.spot = undefined;
		figure.nextBark = undefined;
		this.dropBadge(figure);
		this.dropBark(figure);
		const gone = () => {
			if (!figure.leaving) return;
			figure.walker.destroy();
			if (this.figures.get(figure.character.id) === figure) this.figures.delete(figure.character.id);
		};
		if (!animate) return gone();
		const { door, inside } = this.doorway();
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
		const path = findPath(gridFor(this.layout.place, others), from, [to]);
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

	/** Pose, badge, and the seated beat by the character's state. */
	private dress(figure: Figure) {
		const { character, walker } = figure;
		walker.setPose(poseFor(character));
		walker.tempo = tempoFor(character);
		const kind = badgeFor(character);
		if (figure.badge?.kind !== kind) {
			this.dropBadge(figure);
			if (kind) figure.badge = { kind, container: drawBadge(this, kind) };
		}
		if (!needsYou(character)) {
			figure.nextBark = undefined;
			this.dropBark(figure);
		}
	}

	private dropBadge(figure: Figure) {
		figure.badge?.container.destroy();
		figure.badge = undefined;
	}

	private dropBark(figure: Figure) {
		figure.bark?.container.destroy();
		figure.bark = undefined;
	}

	/** Every frame: walk, fade in doorways, keep badges and barks over heads, and let those who need you bark. */
	private liveCharacters(time: number, delta: number) {
		let barking = [...this.figures.values()].filter((f) => f.bark).length;
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
			figure.badge?.container.setPosition(x, top).setDepth(depth).setScale(ui).setAlpha(walker.sprite.alpha);
			if (figure.bark) {
				if (time >= figure.bark.until) this.dropBark(figure);
				else
					figure.bark.container
						.setPosition(x, top - (figure.badge ? 14 : 2) * ui)
						.setDepth(depth + 0.5)
						.setScale(ui);
			}
			if (figure.leaving || !needsYou(figure.character)) continue;
			figure.nextBark ??= time + Phaser.Math.Between(...FIRST_BARK_MS);
			if (time < figure.nextBark || figure.bark || walker.moving) continue;
			if (barking >= BARKS_AT_ONCE) {
				figure.nextBark = time + 3000;
				continue;
			}
			const line = barkFor(figure.character, figure.barks++);
			if (!line) continue;
			const container = drawBark(this, line).setAlpha(0);
			this.tweens.add({ targets: container, alpha: 1, duration: 180 });
			figure.bark = { line, container, until: time + BARK_MS };
			figure.nextBark = time + Phaser.Math.Between(...BARK_EVERY_MS);
			barking++;
		}
	}

	/** The operator's avatar, at the entry for where it came from (or where it stood, when the place is laid out again). */
	private addAvatar() {
		const name = avatarLookIn(this.theme, this.store.get());
		this.avatarLook = name;
		const at = this.keep?.avatar ?? this.arrival();
		this.avatar = new Walker(this, name, this.theme.looks[name], at, this.keep?.facing ?? this.arrivalFacing(at));
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
		const people = this.present()
			.filter(({ walker }) => {
				const half = Math.min(0.42, (walker.sprite.width * scale) / 2);
				return Math.abs(x - walker.x) <= half && y >= walker.y - PERSON_TILES * 0.97 && y <= walker.y + 0.15;
			})
			.sort((a, b) => b.walker.y - a.walker.y)
			.map(({ character }) => this.characterTarget(character));
		const doors = this.doors
			.filter(({ rect: [dx, dy, dw, dh] }) => x >= dx && x < dx + dw && y >= dy && y < dy + dh)
			.map((door) => this.doorTarget(door));
		return [...people, ...doors];
	}

	private characterTarget(character: Character): Target {
		const name = character.name;
		return {
			name,
			tone: "character",
			actions: [
				// The conversation panel and the interface's character card answer these intents.
				action(
					"Talk to",
					() => this.walkUpTo(character, () => this.view.intend({ kind: "talk-to", character: character.id })),
					name,
					"character",
				),
				action("Examine", () => this.view.intend({ kind: "examine", character: character.id }), name, "character"),
			],
		};
	}

	private doorTarget(door: SceneDoor): Target {
		return {
			name: door.name,
			tone: "object",
			actions: [action("Enter", () => this.useDoor(door), door.name, "object")],
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
		if (!this.pointerAt || this.leaving) return pointer.hover(undefined);
		pointer.hover(this.actionsAt(this.toWorld(this.pointerAt)));
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
		const at: Point = figure.spot ?? [figure.walker.x, figure.walker.y];
		const stands = TALK_OFFSETS.map((group) => group.map(([dx, dy]): Point => [at[0] + dx, at[1] + dy]));
		this.walkToFirst(stands, (reached, goal) => {
			this.avatar.face(at);
			if (reached || Math.hypot(goal[0] - at[0], goal[1] - at[1]) <= 1.6) then?.();
			else this.view.notify("I can't reach them from here.");
		});
	}

	/** Walk to a door's stand point, step on into it, and go through. */
	private useDoor(door: SceneDoor) {
		this.walkTo(door.standAt, (reached) => {
			if (!reached) return this.view.notify("I can't reach that door from here.");
			const [x, y, w, h] = door.rect;
			const inside: Point = [x + w / 2, y + h / 2];
			this.avatar.face(inside);
			if (!this.openDoor(door)) return;
			// Step on toward the door as the view fades.
			const dx = inside[0] - this.avatar.x;
			const dy = inside[1] - this.avatar.y;
			const length = Math.hypot(dx, dy);
			if (length > 0.05) {
				const step = Math.min(STEP_IN, length) / length;
				this.avatar.walk([
					[this.avatar.x, this.avatar.y],
					[this.avatar.x + dx * step, this.avatar.y + dy * step],
				]);
			}
		});
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
		this.actionsAt(this.toWorld([pointerEvent.x, pointerEvent.y]))[0].run();
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
	}

	// Travel.

	/** Go through a door; false when it leads nowhere yet. */
	private openDoor(door: SceneDoor): boolean {
		const here = this.layout.ref;
		const headquarters = here.kind === "square" ? lastHeadquarters : here.headquarters;
		const world = this.store.get();
		if (door.to === "square") return this.travel({ kind: "square" });
		if (door.to === "wing" && door.repository && here.kind !== "square")
			return this.travel({ kind: "wing", headquarters: here.headquarters, repository: door.repository });
		if (door.to === "headquarters" && here.kind === "square") {
			const all = world?.headquarters ?? [];
			if (all.length === 0) {
				this.view.notify("The guild hall is empty: no coordinator is running.");
				return false;
			}
			if (all.length === 1) return this.travel({ kind: "headquarters", headquarters: all[0].id });
			this.view.update({
				chooser: {
					title: "Whose headquarters?",
					choices: all.map((hq) => ({
						label: hq.name,
						detail: `${hq.wings.length} ${hq.wings.length === 1 ? "wing" : "wings"}`,
						choose: () => this.travel({ kind: "headquarters", headquarters: hq.id }),
					})),
				},
			});
			return false;
		}
		if ((door.to === "headquarters" || door.to === "common-room" || door.to === "gallery") && headquarters)
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
		camera.fadeOut(FADE_OUT_MS, 20, 14, 24);
		return true;
	}

	/** Where the avatar arrives: the entry for where it came from, a wing's own door, or the place's start. */
	private arrival(): Point {
		const { place, niches } = this.layout;
		if (this.from?.startsWith("wing:") && niches) {
			const repository = this.from.slice("wing:".length);
			const door = this.doors.find((d) => d.repository === repository);
			if (door) return door.standAt;
		}
		return (this.from && place.entries[this.from]) || place.entries.start || [place.cols / 2, place.rows / 2];
	}

	/** Arriving through a door, the avatar faces away from it, into the room. */
	private arrivalFacing([ax, ay]: Point): Facing {
		const door = this.doors.find(({ standAt: [x, y] }) => Math.hypot(x - ax, y - ay) < 0.6);
		if (!this.from || !door) return "down";
		const [x, y, w, h] = door.rect;
		const dx = ax - (x + w / 2);
		const dy = ay - (y + h / 2);
		return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
	}

	// The camera.

	/** The whole place fits the window at the smallest zoom. */
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
		const [tx, ty] = this.clampMid(this.freeLook ?? this.avatarMid(), camera.zoom);
		const ease = this.freeLook ? 1 - Math.exp(-FOLLOW_RATE * 3 * seconds) : 1 - Math.exp(-FOLLOW_RATE * seconds);
		const [mx, my] = this.clampMid(this.mid, camera.zoom);
		this.mid = [mx + (tx - mx) * ease, my + (ty - my) * ease];
		this.applyCamera();
	}

	private applyCamera() {
		const camera = this.cameras.main;
		camera.setScroll(this.mid[0] - camera.width / 2, this.mid[1] - camera.height / 2);
	}
}

interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
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
	return {
		right: right.length ? width - Math.min(...right.map((r) => r.left)) + gap : 0,
		bottom: bottom.length ? height - Math.min(...bottom.map((r) => r.top)) + gap : 0,
		top: top.length ? Math.max(...top.map((r) => r.bottom)) + gap : 0,
		left: 0,
	};
}

/** The name in one to four lines, breaking after `-`, `_`, `.`, `/`, or a space; undefined when none fits. */
function bannerLines(name: string, fits: (line: string) => boolean): string[] | undefined {
	if (fits(name)) return [name];
	// A one- or two-letter piece ("a-") never stands on a line alone; it stays with the piece after it.
	const parts: string[] = [];
	for (const part of name.split(/(?<=[-_./ ])/)) {
		const last = parts.at(-1);
		if (last !== undefined && last.trim().length <= 2) parts[parts.length - 1] = last + part;
		else parts.push(part);
	}
	for (let lines = 2; lines <= 4; lines++) {
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
