import type * as Phaser from "phaser";
import { type Look, type Point, TILE } from "../theme.js";
import { IDLES, IdleClock, type IdleName, type IdleStep } from "./character-life.js";

export const PERSON_TILES = 1.8;
const STANDING = 120;

export const WALK_SPEED = 3.3;

const STRIDE = 1.45;

const WALK_FRAMES = { down: 0, up: 4, left: 8, right: 8 } as const;
const STAND_FRAME = 14;

const REST_FRAMES = { down: STAND_FRAME, up: 7, left: 11, right: 11 } as const;

const FACING_BIAS = 1.15;

const SEATED_FRAMES = [12, 13] as const;
const ASKING_FRAME = 15;

const SEATED_BEAT = [1300, 650] as const;

export type Facing = keyof typeof WALK_FRAMES;

const BUSY_BREATH = 0.014;

const BUSY_BEAT = 2200;

export type Pose = "standing" | "seated" | "busy" | "asking" | "dozing" | "in-bed";

export interface WalkerView {
	x: number;
	y: number;
	moving: boolean;
	facing: Facing;
	frame: number;
	pose: Pose;

	path: Point[];

	idle: IdleName | null;
	idleFrame: number;
}

export class Walker {
	static snap = 1;
	readonly sprite: Phaser.GameObjects.Sprite;
	readonly shadow: Phaser.GameObjects.Ellipse;
	x: number;
	y: number;
	facing: Facing = "down";

	pose: Pose = "standing";

	tempo = 1;
	private waypoints: Point[] = [];
	private travelled = 0;
	private arrive?: () => void;

	private onLastRun?: () => void;

	private beat = Math.random() * (SEATED_BEAT[0] + SEATED_BEAT[1]);

	private readonly scale: number;
	private look: string;
	private lookData: Look;

	private idles?: IdleClock;
	private idling?: { name: IdleName; steps: readonly IdleStep[]; step: number; left: number };

	constructor(scene: Phaser.Scene, look: string, data: Look, [x, y]: Point, facing: Facing = "down") {
		const { frame, baseline } = data;
		this.x = x;
		this.y = y;
		this.facing = facing;
		this.look = look;
		this.lookData = data;
		this.shadow = scene.add.ellipse(0, 0, TILE * 0.62, TILE * 0.2, 0x000000, 0.28);
		this.sprite = scene.add
			.sprite(0, 0, `look:${look}`, REST_FRAMES[facing])
			.setOrigin(0.5, baseline / frame[1])
			.setScale((PERSON_TILES * TILE) / STANDING);
		this.scale = this.sprite.scaleX;
		this.place();
	}

	setLook(look: string, data: Look) {
		this.endIdle();
		const shown = this.sprite.texture.key === `look:${this.look}` ? Number(this.sprite.frame.name) : STAND_FRAME;
		this.look = look;
		this.lookData = data;
		this.sprite.setTexture(`look:${look}`, shown).setOrigin(0.5, data.baseline / data.frame[1]);
		this.place();
	}

	live(seed: string) {
		this.idles = new IdleClock(seed);
	}

	private static playing = new Map<Walker, IdleName>();

	private readonly busy = {
		has: (name: IdleName): boolean => {
			let found = false;
			for (const [walker, playing] of Walker.playing) {
				if (!walker.sprite.active) Walker.playing.delete(walker);
				else if (walker !== this && playing === name) found = true;
			}
			return found;
		},
	};

	private endIdle() {
		this.idling = undefined;
		Walker.playing.delete(this);
	}

	playIdle(name?: IdleName): boolean {
		if (!this.canIdle()) return false;
		const chosen = name ?? (this.idles ? this.idles.pick(this.busy) : "look-around");
		if (!chosen || this.busy.has(chosen)) return false;
		const steps = IDLES[chosen];
		this.idling = { name: chosen, steps, step: 0, left: steps[0][1] };
		Walker.playing.set(this, chosen);
		this.place();
		return true;
	}

	private canIdle(): boolean {
		return (
			!this.moving &&
			this.pose === "standing" &&
			this.facing === "down" &&
			!!this.lookData.idle &&
			this.sprite.scene?.textures.exists(`look:${this.look}:idle`) === true
		);
	}

	get moving(): boolean {
		return this.waypoints.length > 0;
	}

	walk(path: Point[], then?: () => void, lastRun?: () => void) {
		const fromRest = !this.moving;
		this.endIdle();
		this.waypoints = path.slice(1);
		this.arrive = then;
		this.onLastRun = lastRun;
		if (!this.moving) return this.finish();

		if (fromRest) this.travelled = STRIDE / 4;
		this.turnToward(this.waypoints[0]);
		this.place();
		if (this.waypoints.length === 1) this.lastRun();
	}

	moveTo([x, y]: Point) {
		this.endIdle();
		this.waypoints = [];
		this.arrive = undefined;
		this.onLastRun = undefined;
		this.x = x;
		this.y = y;
		this.place();
	}

	stop() {
		this.waypoints = [];
		this.arrive = undefined;
		this.onLastRun = undefined;
		this.place();
	}

	face([x, y]: Point) {
		const dx = x - this.x;
		const dy = y - this.y;
		if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
		this.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
		if (this.facing !== "down") this.endIdle();
		this.place();
	}

	setAlpha(alpha: number) {
		this.sprite.setAlpha(alpha);
		this.shadow.setAlpha(alpha);
	}

	setPose(pose: Pose) {
		if (pose === this.pose) return;
		this.pose = pose;
		this.endIdle();
		this.place();
	}

	update(deltaMs: number) {
		if (!this.moving) {
			if (this.pose === "standing") return this.standAbout(deltaMs);
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

	private standAbout(deltaMs: number) {
		const idle = this.idling;
		if (idle) {
			idle.left -= Math.min(deltaMs, 100);
			while (idle.left <= 0 && this.idling) {
				idle.step++;
				if (idle.step >= idle.steps.length) this.endIdle();
				else idle.left += idle.steps[idle.step][1];
			}
			return this.place();
		}
		if (!this.idles) return;
		if (!this.canIdle()) return this.idles.putOff();
		const name = this.idles.tick(deltaMs, undefined, this.busy);
		if (name) this.playIdle(name);
	}

	view(): WalkerView {
		const idle = this.idling;
		return {
			x: this.x,
			y: this.y,
			moving: this.moving,
			facing: this.facing,
			frame: this.sprite.texture.key === `look:${this.look}` ? Number(this.sprite.frame.name) : STAND_FRAME,
			pose: this.pose,
			path: [[this.x, this.y], ...this.waypoints],
			idle: idle?.name ?? null,
			idleFrame: idle ? idle.steps[idle.step][0] : -1,
		};
	}

	destroy() {
		this.endIdle();
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
		else if (this.facing !== horizontal && this.facing !== vertical) this.facing = horizontal;
	}

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

		const idleFrame = this.idling && !this.moving ? this.idling.steps[this.idling.step][0] : -1;
		const sheet = idleFrame >= 0 ? `look:${this.look}:idle` : `look:${this.look}`;
		const showing = idleFrame >= 0 ? idleFrame : frame;
		if (this.sprite.texture.key !== sheet) {
			const { frame: size, baseline } = idleFrame >= 0 && this.lookData.idle ? this.lookData.idle : this.lookData;
			this.sprite.setTexture(sheet, showing).setOrigin(0.5, baseline / size[1]);
		} else if (Number(this.sprite.frame.name) !== showing) this.sprite.setFrame(showing);

		const breath =
			!this.moving && this.pose === "busy"
				? 1 + BUSY_BREATH * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.beat) / BUSY_BEAT))
				: 1;
		if (this.sprite.scaleY !== this.scale * breath && this.pose !== "dozing")
			this.sprite.setScale(this.scale, this.scale * breath);

		this.sprite.setFlipX(this.facing === "right" && idleFrame < 0 && (this.moving || this.pose === "standing"));
		const zoom = Walker.snap;
		const at = (v: number) => (this.moving ? Math.round(v * TILE * zoom) / zoom : v * TILE);
		this.sprite.setPosition(at(this.x), at(this.y)).setDepth(this.y * TILE);
		this.shadow.setPosition(this.x * TILE, this.y * TILE - 2).setDepth(this.y * TILE - 1);
		const shown = this.moving || this.pose !== "in-bed";
		this.sprite.setVisible(shown);
		this.shadow.setVisible(shown);
	}
}
