import * as Phaser from "phaser";
import { type Character, type PlaceRef, placeKey } from "../../src/world.js";
import { lookFor } from "../looks.js";
import { pointer } from "../overlay/pointer/pointer-state.js";
import { type Door, type Point, type Theme, TILE } from "../theme.js";
import type { ViewStore, WorldIntent } from "../view-state.js";
import type { WorldStore } from "../world-store.js";
import { type Action, action, type Target } from "./actions.js";
import { assignSpots, charactersIn, type Layout, layoutFor, startPlace, walkGrid } from "./layout.js";
import { findPath, type Grid, gridFor } from "./pathing.js";
import { type Facing, PERSON_TILES, Walker, type WalkerView } from "./walker.js";

const STANDING = 120; // sprite px from head to feet in a standing frame
const STAND_FRAME = 14;
const FADE_OUT_MS = 240;
const FADE_IN_MS = 320;
const PAN_SPEED = 900; // world px per second with the arrow keys
const DRAG_THRESHOLD = 6; // screen px before a press becomes a drag
const SEAM_PX = 24; // painting px over which two strips of a growing place blend
const BANNER_TILES = 1.9; // a banner's width; it hangs in front of the door below it
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

interface Figure {
	character: Character;
	sprite: Phaser.GameObjects.Sprite;
	shadow: Phaser.GameObjects.Ellipse;
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
		this.drawWingDoors();
		this.drawBanners();
		this.doors.unshift(...this.layout.place.doors);
		this.addAvatar();
		this.showCharacters();
		if (showGrid) this.drawGrid();

		const camera = this.cameras.main;
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

	update(_time: number, delta: number) {
		this.avatar.update(delta);
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
		return [...this.figures.values()].map((figure) => figure.character.name);
	}

	figureViews(): FigureView[] {
		return [...this.figures.values()].map(({ character, sprite }) => ({
			id: character.id,
			name: character.name,
			x: sprite.x / TILE,
			y: sprite.y / TILE,
			look: sprite.texture.key.replace(/^look:/, ""),
		}));
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
	galleryView(): { niches: number; wings: { name: string; boarded: boolean }[] } | undefined {
		const { strips, niches } = this.layout;
		if (!strips || !niches) return undefined;
		const base = this.theme.places.gallery.niches!;
		const count = strips.reduce(
			(sum, strip, i) =>
				sum + base.at.filter((x) => x >= strip.from && (x < strip.to || i === strips.length - 1)).length,
			0,
		);
		return { niches: count, wings: niches.map(({ wing }) => ({ name: wing.name, boarded: wing.headcount === 0 })) };
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
	private drawWingDoors() {
		const { niches } = this.layout;
		const template = this.theme.places.gallery.niches;
		if (!niches || !template) return;
		const [dx, dy, dw, dh] = template.door;
		for (const { wing, x } of niches) {
			const boarded = wing.headcount === 0;
			this.add
				.image((x + dx) * TILE, dy * TILE, boarded ? "overlay:door-boarded" : "overlay:door-closed")
				.setOrigin(0)
				.setDisplaySize(dw * TILE, dh * TILE)
				.setDepth((dy + dh) * TILE - TILE);
			if (!boarded) {
				const glow = this.add
					.ellipse(x * TILE, (dy + dh) * TILE - 4, dw * TILE * 0.55, 10, 0xffc06a, 0.3)
					.setDepth((dy + dh) * TILE - TILE + 1);
				this.tweens.add({ targets: glow, alpha: 0.12, yoyo: true, repeat: -1, duration: 1400, ease: "Sine.inOut" });
			}
			this.banner(x, template.banner[1], wing.name);
			this.doors.push({
				name: `${wing.name} wing`,
				rect: [x + dx, dy, dw, dh],
				standAt: [x + template.standAt[0], template.standAt[1]],
				to: "wing",
				repository: wing.repository,
				boarded,
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

	/** A cream banner hung with its rod at (x, top), the name stitched on it at the largest size that fits. */
	private banner(x: number, top: number, name: string) {
		const image = this.add
			.image(x * TILE, top * TILE, "overlay:banner-cream")
			.setOrigin(0.5, 0)
			.setDepth((top + 6) * TILE);
		image.setScale((BANNER_TILES * TILE) / image.width);
		const width = image.displayWidth * 0.62;
		const height = image.displayHeight * 0.5;
		const text = this.add
			.text(x * TILE, top * TILE + image.displayHeight * 0.44, "", {
				fontFamily: 'Georgia, "Iowan Old Style", serif',
				fontStyle: "bold",
				color: INK,
				align: "center",
				lineSpacing: -2,
			})
			.setOrigin(0.5)
			.setResolution(3)
			.setDepth(image.depth + 1);
		for (let size = 15; size >= 7; size--) {
			text.setFontSize(size);
			const lines = bannerLines(name, (line) => {
				text.setText(line);
				return text.width <= width;
			});
			if (!lines) continue;
			text.setText(lines.join("\n"));
			if (text.height <= height) return;
		}
		// Nothing fits: the smallest size, cut to the cloth.
		text.setText(name.length > 12 ? `${name.slice(0, 11)}\u2026` : name);
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

	private showCharacters() {
		const characters = charactersIn(this.layout.ref, this.store.get());
		const ids = new Set(characters.map((character) => character.id));
		for (const [id, figure] of this.figures)
			if (!ids.has(id)) {
				figure.sprite.destroy();
				figure.shadow.destroy();
				this.figures.delete(id);
			}
		const { spots, positions } = assignSpots(
			this.layout.place,
			characters,
			heldSpots.get(this.layout.key) ?? new Map(),
		);
		heldSpots.set(this.layout.key, spots);
		for (const character of characters) {
			const [x, y] = positions.get(character.id)!;
			const figure = this.figures.get(character.id) ?? this.addFigure(character);
			figure.character = character;
			figure.sprite.setPosition(x * TILE, y * TILE).setDepth(y * TILE);
			figure.shadow.setPosition(x * TILE, y * TILE - 2).setDepth(y * TILE - 1);
		}
		this.figures = new Map(characters.map((character) => [character.id, this.figures.get(character.id)!]));
		// Characters block only their own footprint.
		this.walkable = gridFor(
			this.layout.place,
			[...this.figures.values()].map(({ sprite }) => [sprite.x / TILE, sprite.y / TILE]),
		);
	}

	private addFigure(character: Character): Figure {
		const look = lookFor(this.theme, character);
		const { frame, baseline } = this.theme.looks[look];
		const shadow = this.add.ellipse(0, 0, TILE * 0.62, TILE * 0.2, 0x000000, 0.28);
		const sprite = this.add
			.sprite(0, 0, `look:${look}`, STAND_FRAME)
			.setOrigin(0.5, baseline / frame[1])
			.setScale((PERSON_TILES * TILE) / STANDING);
		const figure = { character, sprite, shadow };
		this.figures.set(character.id, figure);
		return figure;
	}

	/** The operator's avatar, at the entry for where it came from (or where it stood, when the place is laid out again). */
	private addAvatar() {
		const looks = Object.entries(this.theme.looks).filter(([, look]) => look.role === "avatar");
		// The first avatar look until Settings lets the operator choose (a later ticket).
		const [name, look] = looks[0];
		this.avatarLook = name;
		const at = this.keep?.avatar ?? this.arrival();
		this.avatar = new Walker(this, name, look, at, this.keep?.facing ?? this.arrivalFacing(at));
	}

	// What the pointer is over, and what can be done with it.

	/** Characters under a point (front first), then doors whose rect holds it. Doors answer only over the door. */
	private targetsAt([x, y]: Point): Target[] {
		const scale = (PERSON_TILES * TILE) / STANDING / TILE;
		const people = [...this.figures.values()]
			.filter(({ sprite }) => {
				const fx = sprite.x / TILE;
				const fy = sprite.y / TILE;
				const half = Math.min(0.42, (sprite.width * scale) / 2);
				return Math.abs(x - fx) <= half && y >= fy - PERSON_TILES * 0.97 && y <= fy + 0.15;
			})
			.sort((a, b) => b.sprite.y - a.sprite.y)
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
		if (!figure) return;
		const at: Point = [figure.sprite.x / TILE, figure.sprite.y / TILE];
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
			const here = this.figures.get(intent.character)?.character;
			if (here && !this.leaving) return this.walkUpTo(here);
			const there = this.store.get()?.characters.find((c) => c.id === intent.character);
			if (there) this.travel(there.place, intent.character);
		}
	}

	// The world changing under the view.

	private worldChanged() {
		if (this.leaving) return;
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
		this.showCharacters();
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

	/** Keep the view on the painting; a place smaller than the view sits in its middle. */
	private clampMid([x, y]: Point, zoom: number): Point {
		const { cols, rows } = this.layout.place;
		const clamp = (v: number, size: number, view: number) =>
			size <= view ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, v));
		return [clamp(x, cols * TILE, this.scale.width / zoom), clamp(y, rows * TILE, this.scale.height / zoom)];
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

/** The name in one to four lines, breaking after `-`, `_`, `.`, `/`, or a space; undefined when none fits. */
function bannerLines(name: string, fits: (line: string) => boolean): string[] | undefined {
	if (fits(name)) return [name];
	const parts = name.split(/(?<=[-_./ ])/);
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
