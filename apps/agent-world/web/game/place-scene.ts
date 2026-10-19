import * as Phaser from "phaser";
import type { Character, PlaceRef } from "../../src/world.js";
import { type Door, type Point, type Theme, TILE } from "../theme.js";
import type { ViewStore } from "../view-state.js";
import type { WorldStore } from "../world-store.js";
import { assignSpots, charactersIn, type Layout, layoutFor, startPlace, walkGrid } from "./layout.js";

const PERSON_TILES = 1.8; // a standing character is drawn this many tiles tall
const STANDING = 120; // sprite px from head to feet in a standing frame
const STAND_FRAME = 14;
const FADE_MS = 160;
const PAN_SPEED = 900; // world px per second with the arrow keys
const DRAG_THRESHOLD = 6; // screen px before a press becomes a drag
const SEAM_PX = 24; // painting px over which two strips of a growing place blend
const BANNER_TILES = 1.9; // a banner's width; it hangs in front of the door below it
const INK = "#4a2a14";

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

function hash(text: string): number {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
	return h;
}

// Which spot each character holds, per place, for as long as the app runs; and view choices that outlive a scene.
const heldSpots = new Map<string, Map<string, number>>();
let showGrid = false;
let lastHeadquarters: string | undefined;

/** The current place: its painting, the characters standing at its spots, and doors that lead elsewhere. */
export class PlaceScene extends Phaser.Scene {
	private readonly theme: Theme;
	private readonly store: WorldStore;
	private readonly view: ViewStore;
	private layout!: Layout;
	private from?: string;
	private figures = new Map<string, Figure>();
	private doors: SceneDoor[] = [];
	private grid?: Phaser.GameObjects.Graphics;
	private leaving = false;
	private drag?: { x: number; y: number; scrollX: number; scrollY: number; moved: boolean };
	private keys?: Record<"left" | "right" | "up" | "down" | "a" | "d" | "w" | "s", Phaser.Input.Keyboard.Key>;
	private keepScroll?: { x: number; y: number };

	constructor(theme: Theme, store: WorldStore, view: ViewStore) {
		super("place");
		this.theme = theme;
		this.store = store;
		this.view = view;
	}

	init(data: { ref?: PlaceRef; from?: string; scroll?: { x: number; y: number } }) {
		const world = this.store.get();
		const ref = data.ref ?? startPlace(world);
		this.layout = layoutFor(ref, world, this.theme) ?? layoutFor(startPlace(world), world, this.theme)!;
		this.from = data.from;
		this.keepScroll = data.scroll;
		this.figures = new Map();
		this.doors = [];
		this.grid = undefined;
		this.leaving = false;
		this.drag = undefined;
		if (this.layout.ref.kind !== "square") lastHeadquarters = this.layout.ref.headquarters;
	}

	create() {
		const { place, title, subtitle } = this.layout;
		this.view.update({ title, subtitle, chooser: undefined });
		this.drawPainting();
		this.drawWingDoors();
		this.drawBanners();
		this.addDoors();
		this.showCharacters();
		if (showGrid) this.drawGrid();

		const camera = this.cameras.main;
		camera.setBounds(0, 0, place.cols * TILE, place.rows * TILE);
		this.fitCamera();
		if (this.keepScroll) camera.setScroll(this.keepScroll.x, this.keepScroll.y);
		else {
			const [x, y] = this.arrival();
			camera.centerOn(x * TILE, y * TILE - TILE);
			camera.fadeIn(FADE_MS * 1.4, 20, 14, 24);
		}

		this.scale.on("resize", this.fitCamera, this);
		const keyboard = this.input.keyboard!;
		this.keys = keyboard.addKeys(
			{ left: "LEFT", right: "RIGHT", up: "UP", down: "DOWN", a: "A", d: "D", w: "W", s: "S" },
			false,
		) as typeof this.keys;
		keyboard.on("keydown-G", this.toggleGrid, this);
		this.input.on("pointerdown", this.pointerDown, this);
		this.input.on("pointermove", this.pointerMove, this);
		this.input.on("pointerup", this.pointerUp, this);
		const unsubscribe = this.store.subscribe(() => this.worldChanged());
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			unsubscribe();
			this.scale.off("resize", this.fitCamera, this);
			keyboard.off("keydown-G", this.toggleGrid, this);
		});
	}

	update(_time: number, delta: number) {
		const keys = this.keys;
		if (!keys) return;
		const step = (PAN_SPEED * delta) / 1000 / this.cameras.main.zoom;
		const dx = (keys.right.isDown || keys.d.isDown ? 1 : 0) - (keys.left.isDown || keys.a.isDown ? 1 : 0);
		const dy = (keys.down.isDown || keys.s.isDown ? 1 : 0) - (keys.up.isDown || keys.w.isDown ? 1 : 0);
		if (dx || dy) {
			this.cameras.main.scrollX += dx * step;
			this.cameras.main.scrollY += dy * step;
		}
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

	doorViews(): DoorView[] {
		const camera = this.cameras.main;
		const view = camera.worldView;
		return this.doors.map((door) => {
			const [x, y, w, h] = door.rect;
			return {
				name: door.name,
				to: door.to,
				...(door.repository ? { boarded: door.boarded } : {}),
				x: ((x + w / 2) * TILE - view.x) * camera.zoom + camera.x,
				y: ((y + h / 2) * TILE - view.y) * camera.zoom + camera.y,
			};
		});
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

	/** Centre the view on a door, as panning there would. */
	lookAt(doorName: string): boolean {
		const door = this.doors.find((d) => d.name === doorName);
		if (!door) return false;
		const [x, y, w, h] = door.rect;
		this.cameras.main.centerOn((x + w / 2) * TILE, (y + h / 2) * TILE);
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

	private addDoors() {
		this.doors.unshift(...this.layout.place.doors);
		for (const door of this.doors) {
			const [x, y, w, h] = door.rect;
			const zone = this.add
				.zone(x * TILE, y * TILE, w * TILE, h * TILE)
				.setOrigin(0)
				.setInteractive({ useHandCursor: true });
			zone.on("pointerup", () => {
				if (!this.drag?.moved) this.openDoor(door);
			});
		}
	}

	private drawGrid() {
		this.grid?.destroy();
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
		this.grid = graphics;
	}

	private toggleGrid() {
		showGrid = !showGrid;
		if (showGrid) this.drawGrid();
		else {
			this.grid?.destroy();
			this.grid = undefined;
		}
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
	}

	private lookFor(character: Character): string {
		const looks = Object.entries(this.theme.looks);
		const role = character.role === "coordinator" ? "coordinator" : "agent";
		const choices = looks
			.filter(([, look]) => look.role === role)
			.map(([name]) => name)
			.sort();
		return choices[hash(character.id) % choices.length];
	}

	private addFigure(character: Character): Figure {
		const look = this.lookFor(character);
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
			const camera = this.cameras.main;
			this.scene.restart({ ref: this.layout.ref, scroll: { x: camera.scrollX, y: camera.scrollY } });
			return;
		}
		this.layout = next;
		this.showCharacters();
	}

	// Travel.

	private openDoor(door: SceneDoor) {
		const here = this.layout.ref;
		const headquarters = here.kind === "square" ? lastHeadquarters : here.headquarters;
		const world = this.store.get();
		if (door.to === "square") return this.travel({ kind: "square" });
		if (door.to === "wing" && door.repository && here.kind !== "square")
			return this.travel({ kind: "wing", headquarters: here.headquarters, repository: door.repository });
		if (door.to === "headquarters" && here.kind === "square") {
			const all = world?.headquarters ?? [];
			if (all.length === 0) return this.view.notify("The guild hall is empty: no coordinator is running.");
			if (all.length === 1) return this.travel({ kind: "headquarters", headquarters: all[0].id });
			return this.view.update({
				chooser: {
					title: "Whose headquarters?",
					choices: all.map((hq) => ({
						label: hq.name,
						detail: `${hq.wings.length} ${hq.wings.length === 1 ? "wing" : "wings"}`,
						choose: () => this.travel({ kind: "headquarters", headquarters: hq.id }),
					})),
				},
			});
		}
		if ((door.to === "headquarters" || door.to === "common-room" || door.to === "gallery") && headquarters)
			return this.travel({ kind: door.to, headquarters });
		this.view.notify(`${this.theme.labels[door.to] ?? door.name} is not open yet.`);
	}

	/** Leave for another place with a short fade. */
	travel(ref: PlaceRef) {
		if (this.leaving) return;
		this.leaving = true;
		this.view.update({ chooser: undefined });
		const from = this.layout.ref.kind === "wing" ? `wing:${this.layout.ref.repository}` : this.layout.ref.kind;
		const camera = this.cameras.main;
		camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ ref, from }));
		camera.fadeOut(FADE_MS, 20, 14, 24);
	}

	/** Where the view arrives: the entry for where you came from, a wing's own door, or the place's start. */
	private arrival(): Point {
		const { place, niches } = this.layout;
		if (this.from?.startsWith("wing:") && niches) {
			const repository = this.from.slice("wing:".length);
			const door = this.doors.find((d) => d.repository === repository);
			if (door) return door.standAt;
		}
		return (this.from && place.entries[this.from]) || place.entries.start || [place.cols / 2, place.rows / 2];
	}

	// The camera.

	/** Fill the window with the place; the arrow keys and dragging look around a place larger than the window. */
	private fitCamera() {
		const { cols, rows } = this.layout.place;
		const camera = this.cameras.main;
		const centre = camera.midPoint.clone();
		camera.setZoom(Math.max(this.scale.width / (cols * TILE), this.scale.height / (rows * TILE)));
		if (centre.x || centre.y) camera.centerOn(centre.x, centre.y);
	}

	private pointerDown(pointer: Phaser.Input.Pointer) {
		const camera = this.cameras.main;
		this.drag = { x: pointer.x, y: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY, moved: false };
	}

	private pointerMove(pointer: Phaser.Input.Pointer) {
		const drag = this.drag;
		if (!drag || !pointer.isDown) return;
		const dx = pointer.x - drag.x;
		const dy = pointer.y - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		drag.moved = true;
		const camera = this.cameras.main;
		camera.setScroll(drag.scrollX - dx / camera.zoom, drag.scrollY - dy / camera.zoom);
	}

	private pointerUp() {
		// Doors read `drag.moved` in their own pointerup, which Phaser delivers before the scene's.
		setTimeout(() => {
			this.drag = undefined;
		}, 0);
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
