// A character that walks: any figure in a place (the operator's avatar and every agent) follows a path of straight
// runs at a steady speed, its walk cycle advanced by the distance it covers so the feet never slide, and ends exactly
// on the path's last point. A new path takes over at once, from wherever the walker is, without a stop. At rest it
// holds a pose: standing, seated at work (its two seated frames alternating gently), or asking with a raised hand.
import type * as Phaser from "phaser";
import { type Look, type Point, TILE } from "../theme.js";

export const PERSON_TILES = 1.8; // a standing character is drawn this many tiles tall
const STANDING = 120; // sprite px from head to feet in a standing frame
/** Walking speed, in tiles per second. */
export const WALK_SPEED = 3.3;
/** Ground covered by one whole walk cycle (two steps), in tiles: the cycle's four phases are a quarter each. */
const STRIDE = 1.45;
/** Frames in the 16-frame strip: the first of each walk direction (four phases each), and standing. */
const WALK_FRAMES = { down: 0, up: 4, left: 8, right: 8 } as const;
const STAND_FRAME = 14;
/**
 * At rest. Sheets have a standing frame only from the front; facing away or sideways, the last passing frame (feet
 * under the body) stands in, so a character that stops facing a door or a person keeps facing it.
 */
const REST_FRAMES = { down: STAND_FRAME, up: 7, left: 11, right: 11 } as const;
/** How much more one axis must lead before a diagonal run switches facing, so a 45-degree run does not flicker. */
const FACING_BIAS = 1.15;
/** Seated at work, seen from behind with the seat drawn: two frames; and asking with a raised hand. */
const SEATED_FRAMES = [12, 13] as const;
const ASKING_FRAME = 15;
/** How long each seated frame holds at tempo 1 (ms): mostly the first, a shorter beat on the second. */
const SEATED_BEAT = [1300, 650] as const;

export type Facing = keyof typeof WALK_FRAMES;

/** Standing at work (outdoors, with no desk): the breath of its beat, as deep as this (a share of its height). */
const BUSY_BREATH = 0.014;
/** One breath at tempo 1 (ms); a busier tool breathes a little quicker. */
const BUSY_BEAT = 2200;

/**
 * How a walker holds itself at rest. Busy is standing at work where there is no desk (outdoors): the standing frame,
 * breathing with the beat of its work. Asleep at the inn, it dozes in its seated frame without the beat of work, or
 * lies in a bed (the scene draws it there; the walker itself is hidden).
 */
export type Pose = "standing" | "seated" | "busy" | "asking" | "dozing" | "in-bed";

export interface WalkerView {
	x: number;
	y: number;
	moving: boolean;
	facing: Facing;
	frame: number;
	pose: Pose;
	/** The rest of the current walk: where it is now, then each corner, then the goal. */
	path: Point[];
}

export class Walker {
	/**
	 * The view's zoom: a walking figure is drawn at whole screen pixels, so its pixels do not crawl as it moves. The scene
	 * sets it with the camera.
	 */
	static snap = 1;
	readonly sprite: Phaser.GameObjects.Sprite;
	readonly shadow: Phaser.GameObjects.Ellipse;
	x: number;
	y: number;
	facing: Facing = "down";
	/** How it holds itself when not walking. */
	pose: Pose = "standing";
	/** How quickly the seated frames alternate (decorative: a busier tool, a quicker beat); 1 is gentle. */
	tempo = 1;
	private waypoints: Point[] = [];
	private travelled = 0;
	private arrive?: () => void;
	/** Runs as the walker sets off on its last run (stepping on through a door after reaching it). */
	private onLastRun?: () => void;
	/** Time (ms) into the seated beat; each walker starts somewhere else in it, so a room does not move as one. */
	private beat = Math.random() * (SEATED_BEAT[0] + SEATED_BEAT[1]);
	/** The sprite's scale when standing still, which a busy breath stretches a little upward from the feet. */
	private readonly scale: number;

	constructor(scene: Phaser.Scene, look: string, { frame, baseline }: Look, [x, y]: Point, facing: Facing = "down") {
		this.x = x;
		this.y = y;
		this.facing = facing;
		this.shadow = scene.add.ellipse(0, 0, TILE * 0.62, TILE * 0.2, 0x000000, 0.28);
		this.sprite = scene.add
			.sprite(0, 0, `look:${look}`, REST_FRAMES[facing])
			.setOrigin(0.5, baseline / frame[1])
			.setScale((PERSON_TILES * TILE) / STANDING);
		this.scale = this.sprite.scaleX;
		this.place();
	}

	/** Wear another look (the operator chose one in Settings), keeping the pose, facing, and stride. */
	setLook(look: string, { frame, baseline }: Look) {
		const shown = Number(this.sprite.frame.name);
		this.sprite.setTexture(`look:${look}`, shown).setOrigin(0.5, baseline / frame[1]);
		this.place();
	}

	get moving(): boolean {
		return this.waypoints.length > 0;
	}

	/**
	 * Walk `path` (its first point is where the walker is now); `then` runs on arrival, unless another walk replaces it,
	 * and `lastRun` as it sets off on the path's last run, without stopping there.
	 */
	walk(path: Point[], then?: () => void, lastRun?: () => void) {
		const fromRest = !this.moving;
		this.waypoints = path.slice(1);
		this.arrive = then;
		this.onLastRun = lastRun;
		if (!this.moving) return this.finish();
		// From rest, start on a passing frame so the first step shows at once; mid-walk, keep the stride going.
		if (fromRest) this.travelled = STRIDE / 4;
		this.turnToward(this.waypoints[0]);
		this.place();
		if (this.waypoints.length === 1) this.lastRun();
	}

	/** Stand at a point at once, without walking there. */
	moveTo([x, y]: Point) {
		this.waypoints = [];
		this.arrive = undefined;
		this.onLastRun = undefined;
		this.x = x;
		this.y = y;
		this.place();
	}

	/** Stop where it stands, dropping what it was walking to do. */
	stop() {
		this.waypoints = [];
		this.arrive = undefined;
		this.onLastRun = undefined;
		this.place();
	}

	/** Turn to look at a point (what it walked up to). */
	face([x, y]: Point) {
		const dx = x - this.x;
		const dy = y - this.y;
		if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
		this.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
		this.place();
	}

	/** Fade it (arriving through a door or leaving by one); 1 is fully there. */
	setAlpha(alpha: number) {
		this.sprite.setAlpha(alpha);
		this.shadow.setAlpha(alpha);
	}

	/** Hold a pose at rest (it shows once any walk ends). */
	setPose(pose: Pose) {
		if (pose === this.pose) return;
		this.pose = pose;
		this.place();
	}

	update(deltaMs: number) {
		if (!this.moving) {
			if (this.pose !== "seated" && this.pose !== "busy") return;
			const cycle = this.pose === "busy" ? BUSY_BEAT : SEATED_BEAT[0] + SEATED_BEAT[1];
			this.beat = (this.beat + Math.min(deltaMs, 100) * this.tempo) % cycle;
			return this.place();
		}
		let budget = (WALK_SPEED * Math.min(deltaMs, 100)) / 1000;
		this.travelled += budget;
		while (budget > 0 && this.waypoints.length) {
			const [tx, ty] = this.waypoints[0];
			const dx = tx - this.x;
			const dy = ty - this.y;
			const distance = Math.hypot(dx, dy);
			if (distance <= budget) {
				// Round the corner without losing the rest of this frame's distance: no stall at corners.
				this.x = tx;
				this.y = ty;
				budget -= distance;
				this.waypoints.shift();
				if (this.waypoints.length) this.turnToward(this.waypoints[0]);
				if (this.waypoints.length === 1) this.lastRun();
			} else {
				this.x += (dx / distance) * budget;
				this.y += (dy / distance) * budget;
				budget = 0;
			}
		}
		if (!this.moving) return this.finish();
		this.place();
	}

	view(): WalkerView {
		return {
			x: this.x,
			y: this.y,
			moving: this.moving,
			facing: this.facing,
			frame: Number(this.sprite.frame.name),
			pose: this.pose,
			path: [[this.x, this.y], ...this.waypoints],
		};
	}

	destroy() {
		this.sprite.destroy();
		this.shadow.destroy();
	}

	private lastRun() {
		const run = this.onLastRun;
		this.onLastRun = undefined;
		run?.();
	}

	private finish() {
		this.travelled = 0;
		this.place();
		const then = this.arrive;
		this.arrive = undefined;
		then?.();
	}

	private turnToward([x, y]: Point) {
		const dx = x - this.x;
		const dy = y - this.y;
		const side = Math.abs(dx) > Math.abs(dy) * FACING_BIAS;
		const upright = Math.abs(dy) > Math.abs(dx) * FACING_BIAS;
		const horizontal = dx < 0 ? "left" : "right";
		const vertical = dy < 0 ? "up" : "down";
		if (side) this.facing = horizontal;
		else if (upright) this.facing = vertical;
		// Near 45 degrees: keep facing one of the run's two directions, preferring the one already faced.
		else if (this.facing !== horizontal && this.facing !== vertical) this.facing = horizontal;
	}

	/** Draw it where it is: feet on the point, depth by feet, the frame for its facing and stride. */
	private place() {
		const frame = this.moving
			? WALK_FRAMES[this.facing] + (Math.floor((this.travelled / STRIDE) * 4) % 4)
			: this.pose === "seated"
				? SEATED_FRAMES[this.beat < SEATED_BEAT[0] ? 0 : 1]
				: this.pose === "dozing" || this.pose === "in-bed"
					? SEATED_FRAMES[0]
					: this.pose === "asking"
						? ASKING_FRAME
						: this.pose === "busy"
							? STAND_FRAME
							: REST_FRAMES[this.facing];
		if (Number(this.sprite.frame.name) !== frame) this.sprite.setFrame(frame);
		// Busy on its feet: a slow breath from the feet up (the feet stay on the floor); otherwise its own height.
		const breath =
			!this.moving && this.pose === "busy"
				? 1 + BUSY_BREATH * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.beat) / BUSY_BEAT))
				: 1;
		if (this.sprite.scaleY !== this.scale * breath && this.pose !== "dozing")
			this.sprite.setScale(this.scale, this.scale * breath);
		// Poses are drawn facing one way; only walking and resting sideways mirror.
		this.sprite.setFlipX(this.facing === "right" && (this.moving || this.pose === "standing"));
		const zoom = Walker.snap;
		const at = (v: number) => (this.moving ? Math.round(v * TILE * zoom) / zoom : v * TILE);
		this.sprite.setPosition(at(this.x), at(this.y)).setDepth(this.y * TILE);
		this.shadow.setPosition(this.x * TILE, this.y * TILE - 2).setDepth(this.y * TILE - 1);
		const shown = this.moving || this.pose !== "in-bed";
		this.sprite.setVisible(shown);
		this.shadow.setVisible(shown);
	}
}
