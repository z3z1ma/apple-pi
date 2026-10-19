// Messenger birds (ticket 16): a letter between two characters in the place flies as a pigeon from sender to receiver
// in a low arc, its four wing frames beating, with a small shadow on the floor beneath it; a letter for someone
// elsewhere flies out by the door, and one from elsewhere flies in by it. The rookery also has birds of its own coming
// and going by its window. Decorative: the mail itself is the runtime's.
import type * as Phaser from "phaser";
import { type Point, TILE } from "../theme.js";

/** One end of a flight: a point on the floor (tiles), and how high above it the bird is there. */
export interface Perch {
	at: Point;
	lift: number;
}

export interface BirdView {
	/** The mail it carries (or `ambient:<n>` for the rookery's own birds). */
	id: string;
	from: string;
	to: string;
	/** Where it is drawn, in tiles. */
	x: number;
	y: number;
	frame: number;
	/** It leaves the place (by the door or the window). */
	out: boolean;
}

interface Bird extends Omit<BirdView, "x" | "y" | "frame"> {
	sprite: Phaser.GameObjects.Image;
	shadow: Phaser.GameObjects.Ellipse;
	start: Perch;
	end: Perch;
	arc: number;
	duration: number;
	elapsed: number;
	frame: number;
	beat: number;
	ambient: boolean;
}

/** Tiles per second, and the longest and shortest flights (ms). */
const SPEED = 4.2;
const MIN_MS = 1100;
const MAX_MS = 3200;
/** One wing frame, ms; the strip is bird-0..3 (wings up, level, down, level). */
const BEAT_MS = 85;
/** The pigeon's width in tiles at its level-wing frame (403 px wide in the pack). */
const WIDTH = 0.95;
const LEVEL_WIDTH = 403;

export class Birds {
	private readonly scene: Phaser.Scene;
	private flying: Bird[] = [];

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
	}

	fly(
		id: string,
		from: string,
		to: string,
		start: Perch,
		end: Perch,
		options: { out?: boolean; ambient?: boolean } = {},
	) {
		const distance = Math.hypot(end.at[0] - start.at[0], end.at[1] - start.at[1]);
		const sprite = this.scene.add
			.image(0, 0, "overlay:bird-1")
			.setOrigin(0.5, 0.55)
			.setScale((WIDTH * TILE) / LEVEL_WIDTH)
			.setAlpha(0);
		const shadow = this.scene.add.ellipse(0, 0, TILE * 0.42, TILE * 0.13, 0x000000, 0.22).setAlpha(0);
		this.flying.push({
			id,
			from,
			to,
			out: options.out === true,
			ambient: options.ambient === true,
			sprite,
			shadow,
			start,
			end,
			arc: Math.min(1.7, 0.45 + distance * 0.28),
			duration: Math.min(MAX_MS, Math.max(MIN_MS, (distance / SPEED) * 1000)),
			elapsed: 0,
			frame: 1,
			beat: Math.random() * BEAT_MS,
		});
	}

	/** Mail birds in flight, for tests (the rookery's own birds are left out). */
	views(): BirdView[] {
		return this.flying
			.filter((bird) => !bird.ambient)
			.map(({ id, from, to, out, frame, sprite }) => ({
				id,
				from,
				to,
				out,
				frame,
				x: sprite.x / TILE,
				y: sprite.y / TILE,
			}));
	}

	/** Mail birds in flight right now. */
	count(ambient = false): number {
		return this.flying.filter((bird) => bird.ambient === ambient).length;
	}

	update(delta: number) {
		const step = Math.min(delta, 100);
		for (const bird of [...this.flying]) {
			bird.elapsed += step;
			const t = Math.min(1, bird.elapsed / bird.duration);
			// Ease in and out a little, so it lifts off and settles rather than snapping.
			const s = t * t * (3 - 2 * t) * 0.6 + t * 0.4;
			const [x0, y0] = bird.start.at;
			const [x1, y1] = bird.end.at;
			const gx = x0 + (x1 - x0) * s;
			const gy = y0 + (y1 - y0) * s;
			const lift = bird.start.lift + (bird.end.lift - bird.start.lift) * s + bird.arc * Math.sin(Math.PI * s);
			bird.beat += step;
			if (bird.beat >= BEAT_MS) {
				bird.beat %= BEAT_MS;
				bird.frame = (bird.frame + 1) % 4;
				bird.sprite.setTexture(`overlay:bird-${bird.frame}`);
			}
			// The strip flies right; flying left is the same bird mirrored.
			bird.sprite.setFlipX(x1 < x0);
			const fade = Math.min(1, t / 0.1, (1 - t) / (bird.out ? 0.18 : 0.08));
			bird.sprite
				.setPosition(gx * TILE, (gy - lift) * TILE)
				.setDepth(1e5 + gy + 3)
				.setAlpha(fade);
			bird.shadow
				.setPosition(gx * TILE, gy * TILE)
				.setDepth(gy * TILE - 1)
				.setAlpha(fade * Math.max(0.25, 1 - lift / 3.2));
			if (t >= 1) {
				bird.sprite.destroy();
				bird.shadow.destroy();
				this.flying.splice(this.flying.indexOf(bird), 1);
			}
		}
	}
}
