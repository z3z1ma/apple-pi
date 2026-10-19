// A character that walks: any figure in a place (the operator's avatar now, agents later) follows a path of straight
// runs at a steady speed, its walk cycle advanced by the distance it covers so the feet never slide, and ends exactly
// on the path's last point. A new path takes over at once, from wherever the walker is, without a stop.
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

export type Facing = keyof typeof WALK_FRAMES;

export interface WalkerView {
	x: number;
	y: number;
	moving: boolean;
	facing: Facing;
	frame: number;
	/** The rest of the current walk: where it is now, then each corner, then the goal. */
	path: Point[];
}

export class Walker {
	readonly sprite: Phaser.GameObjects.Sprite;
	readonly shadow: Phaser.GameObjects.Ellipse;
	x: number;
	y: number;
	facing: Facing = "down";
	private waypoints: Point[] = [];
	private travelled = 0;
	private arrive?: () => void;

	constructor(scene: Phaser.Scene, look: string, { frame, baseline }: Look, [x, y]: Point, facing: Facing = "down") {
		this.x = x;
		this.y = y;
		this.facing = facing;
		this.shadow = scene.add.ellipse(0, 0, TILE * 0.62, TILE * 0.2, 0x000000, 0.28);
		this.sprite = scene.add
			.sprite(0, 0, `look:${look}`, REST_FRAMES[facing])
			.setOrigin(0.5, baseline / frame[1])
			.setScale((PERSON_TILES * TILE) / STANDING);
		this.place();
	}

	get moving(): boolean {
		return this.waypoints.length > 0;
	}

	/** Walk `path` (its first point is where the walker is now); `then` runs on arrival, unless another walk replaces it. */
	walk(path: Point[], then?: () => void) {
		const fromRest = !this.moving;
		this.waypoints = path.slice(1);
		this.arrive = then;
		if (!this.moving) return this.finish();
		// From rest, start on a passing frame so the first step shows at once; mid-walk, keep the stride going.
		if (fromRest) this.travelled = STRIDE / 4;
		this.turnToward(this.waypoints[0]);
		this.place();
	}

	/** Stop where it stands, dropping what it was walking to do. */
	stop() {
		this.waypoints = [];
		this.arrive = undefined;
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

	update(deltaMs: number) {
		if (!this.moving) return;
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
			path: [[this.x, this.y], ...this.waypoints],
		};
	}

	destroy() {
		this.sprite.destroy();
		this.shadow.destroy();
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
			: REST_FRAMES[this.facing];
		if (Number(this.sprite.frame.name) !== frame) this.sprite.setFrame(frame);
		this.sprite.setFlipX(this.facing === "right");
		this.sprite.setPosition(this.x * TILE, this.y * TILE).setDepth(this.y * TILE);
		this.shadow.setPosition(this.x * TILE, this.y * TILE - 2).setDepth(this.y * TILE - 1);
	}
}
