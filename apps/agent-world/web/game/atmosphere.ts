// What moves in a place besides its characters (ticket 11 of the alive pass): dust motes in the light, leaves or petals
// drifting down, birds or a plane crossing the sky, steam from cups and troughs, sparks from a forge, blinking lights,
// flickering screens, glints on water; and out of doors the light of the time of day, with lit windows and brighter
// lamps after dark. Each place names its own in its data (`atmosphere`); everything is drawn here in code, small and
// slow so it never pulls the eye from the characters. It moves on `lifePace()` like idles and strolls, so the headless
// suites see it still (but drawn) unless a test asks for life.
import * as Phaser from "phaser";
import type { Atmosphere, OverlaySlot, PlaceData, Point, Rect } from "../theme.js";
import { TILE } from "../theme.js";
import { lifePace, seeded } from "./character-life.js";
import { type Daylight, daylightAt, hex } from "./daylight.js";

/** What the atmosphere asks of the scene. */
export interface AtmosphereHost {
	place(): PlaceData;
	/** The layout's key: each place's motion has its own seeded rhythm. */
	key(): string;
	/** The painting's texture key, for the lit windows and the water under glints. */
	painting(): string;
	/** Out of doors (the square, the street): the light follows the time of day. */
	outdoors(): boolean;
	/** Open floor, where a falling leaf may come to rest. */
	open(at: Point): boolean;
	/** Turn the place's lamps to this share of their own strength. */
	lamps(share: number): void;
	/** The local time now. */
	now(): Date;
}

export interface AtmosphereView {
	/** Out of doors, the light now; null indoors. */
	daylight: {
		phase: Daylight["phase"];
		hour: number;
		tint: string;
		lamps: number;
		windows: number;
	} | null;
	/** Each effect the place names, with where its particles are drawn now (tiles). */
	effects: { kind: Atmosphere["kind"]; what: string | null; shown: Point[] }[];
	/** The mean time (ms) one update of every effect has taken, and how many updates that covers. */
	cost: { mean: number; updates: number };
}

/** The tint over everything in the place but its glows, the badges, and the bubbles. */
const TINT_DEPTH = 8e4;
/** Things in the air over the place's characters, under its tint. */
const AIR_DEPTH = 7.5e4;
/** On the floor, over the painting and its water, under everyone. */
const FLOOR_DEPTH = -0.9;
/** How often the light of the time of day is looked at again, ms. */
const DAYLIGHT_EVERY_MS = 1000;
/** World px per pixel of a drawn particle's pattern: about a painting's pixel. */
const PX = 1.2;

interface Particle {
	image: Phaser.GameObjects.Image;
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
	phase: number;
	peak: number;
	/** A leaf's spin (degrees per second), where it comes to rest, and how long it has lain there. */
	spin?: number;
	ground?: number;
	lain?: number;
}

/** One kind of motion in a place. */
interface Effect {
	readonly kind: Atmosphere["kind"];
	readonly what: string | null;
	step(seconds: number): void;
	shown(): Point[];
	destroy(): void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class AtmosphereLayer {
	private readonly scene: Phaser.Scene;
	private readonly host: AtmosphereHost;
	private readonly effects: Effect[] = [];
	private tint?: Phaser.GameObjects.Rectangle;
	private lights?: { image: Phaser.GameObjects.Image; halo: Phaser.GameObjects.Image };
	private daylight?: Daylight;
	private sinceDaylight = 0;
	private spent = 0;
	private updates = 0;

	constructor(scene: Phaser.Scene, host: AtmosphereHost) {
		this.scene = scene;
		this.host = host;
		drawTextures(scene);
		const place = host.place();
		for (const [i, effect] of (place.atmosphere ?? []).entries()) {
			const random = seeded(`atmosphere:${host.key()}:${i}`);
			const made = this.make(effect, random);
			if (made) this.effects.push(made);
		}
		if (host.outdoors()) {
			const { cols, rows } = place;
			this.tint = scene.add
				.rectangle(0, 0, cols * TILE, rows * TILE, 0xffffff)
				.setOrigin(0)
				.setBlendMode(Phaser.BlendModes.MULTIPLY)
				.setDepth(TINT_DEPTH);
			const lit = (place.atmosphere ?? []).find((effect) => effect.kind === "lights");
			if (lit?.rects?.length) this.lights = this.addLights(lit.rects);
			this.refreshDaylight();
		}
	}

	private make(effect: Atmosphere, random: () => number): Effect | undefined {
		const place = this.host.place();
		const whole: Rect = [0, 0, place.cols, place.rows];
		switch (effect.kind) {
			case "motes":
				return new Motes(this.scene, effect.rect ?? whole, effect, random);
			case "fall":
				return new Fall(this.scene, effect.rect ?? whole, effect, random, (at) => this.host.open(at));
			case "sky":
				return new Sky(this.scene, whole, effect, random);
			case "steam":
				return new Steam(this.scene, effect, random, this.depthOn(effect.at!));
			case "sparks":
				return new Sparks(this.scene, effect, random);
			case "blink":
				return new Blink(this.scene, effect, random);
			case "screens":
				return new Screens(this.scene, effect, random, (rect) =>
					this.depthOn([rect[0] + rect[2] / 2, rect[1] + rect[3]]),
				);
			case "shimmer":
				return new Shimmer(this.scene, effect, random, this.waterTest(effect.rect!), this.waterDepth(effect.rect!));
			default:
				return undefined;
		}
	}

	/** Just over what something lies on: the foreground piece (a table, a bench) under `at`, else the floor line at it. */
	private depthOn([x, y]: Point): number {
		const piece = this.host
			.place()
			.foreground?.find(({ rect: [rx, ry, rw, rh] }) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
		return (piece ? piece.feet : y) * TILE + 0.1;
	}

	/** Glints lie on the water: over a basin's water overlay when there is one, else just over the painting. */
	private waterDepth([x, y, w, h]: Rect): number {
		const [cx, cy] = [x + w / 2, y + h / 2];
		const basin = this.host
			.place()
			.foreground?.find(({ rect: [rx, ry, rw, rh] }) => cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh);
		return basin ? basin.feet * TILE - 0.35 : FLOOR_DEPTH;
	}

	/** Where a glint may show: inside a water slot's oval (clear of its hole), or where the painting is water-blue. */
	private waterTest(rect: Rect): (at: Point) => boolean {
		const pools = this.host.place().overlaySlots.filter((slot) => slot.kind === "water");
		const source = this.scene.textures.get(this.host.painting()).getSourceImage() as HTMLImageElement;
		const ppt = source.width / this.host.place().cols;
		const [x, y, w, h] = rect;
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(w * ppt));
		canvas.height = Math.max(1, Math.round(h * ppt));
		const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
		ctx.drawImage(source, -x * ppt, -y * ppt);
		const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		return ([px, py]) => {
			if (pools.some((slot) => inPool(slot, [px, py]))) return true;
			const ix = Math.floor((px - x) * ppt);
			const iy = Math.floor((py - y) * ppt);
			if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) return false;
			const at = (iy * canvas.width + ix) * 4;
			const [r, g, b] = [pixels[at], pixels[at + 1], pixels[at + 2]];
			return b > r + 12 && b >= g - 6;
		};
	}

	/**
	 * The painting's lit windows and lamps inside `rects` (its bright, warm pixels), drawn over the tint as painted, with
	 * a soft halo added around them: after dark they glow while the rest of the place dims.
	 */
	private addLights(rects: Rect[]) {
		const key = `atmosphere:lights:${this.host.painting()}`;
		const haloKey = `${key}:halo`;
		const source = this.scene.textures.get(this.host.painting()).getSourceImage() as HTMLImageElement;
		const ppt = source.width / this.host.place().cols;
		if (!this.scene.textures.exists(key)) {
			const canvas = document.createElement("canvas");
			canvas.width = source.width;
			canvas.height = source.height;
			const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
			for (const [x, y, w, h] of rects) {
				const [sx, sy, sw, sh] = [x, y, w, h].map((v) => Math.round(v * ppt));
				if (sw <= 0 || sh <= 0) continue;
				ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
				const image = ctx.getImageData(sx, sy, sw, sh);
				const data = image.data;
				for (let i = 0; i < data.length; i += 4) {
					const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
					const light = Math.max(r, g, b) / 255;
					const warm = (r - b) / 255;
					data[i + 3] = Math.round(255 * clamp01((light - 0.7) / 0.18) * clamp01((warm - 0.22) / 0.18));
				}
				ctx.putImageData(image, sx, sy);
			}
			this.scene.textures.addCanvas(key, canvas);
			const halo = document.createElement("canvas");
			halo.width = source.width;
			halo.height = source.height;
			const hctx = halo.getContext("2d")!;
			hctx.filter = `blur(${Math.round(ppt * 0.12)}px)`;
			hctx.drawImage(canvas, 0, 0);
			hctx.drawImage(canvas, 0, 0);
			this.scene.textures.addCanvas(haloKey, halo);
		}
		const scale = TILE / ppt;
		const image = this.scene.add
			.image(0, 0, key)
			.setOrigin(0)
			.setScale(scale)
			.setDepth(TINT_DEPTH + 1)
			.setAlpha(0);
		const halo = this.scene.add
			.image(0, 0, haloKey)
			.setOrigin(0)
			.setScale(scale)
			.setBlendMode(Phaser.BlendModes.ADD)
			.setDepth(TINT_DEPTH + 2)
			.setAlpha(0);
		return { image, halo };
	}

	private refreshDaylight() {
		if (!this.tint) return;
		const light = daylightAt(this.host.now());
		this.daylight = light;
		this.tint.setFillStyle(light.tint);
		this.tint.setVisible(light.tint !== 0xffffff);
		this.lights?.image.setAlpha(light.windows);
		this.lights?.halo.setAlpha(light.windows * 0.55);
		this.host.lamps(light.lamps);
	}

	update(deltaMs: number) {
		this.sinceDaylight += deltaMs;
		if (this.sinceDaylight >= DAYLIGHT_EVERY_MS) {
			this.sinceDaylight = 0;
			this.refreshDaylight();
		}
		const seconds = (Math.min(deltaMs, 100) / 1000) * lifePace();
		if (seconds <= 0) return;
		const start = performance.now();
		for (const effect of this.effects) effect.step(seconds);
		this.spent += performance.now() - start;
		this.updates++;
	}

	view(): AtmosphereView {
		const light = this.daylight;
		return {
			daylight:
				this.tint && light
					? { phase: light.phase, hour: light.hour, tint: hex(light.tint), lamps: light.lamps, windows: light.windows }
					: null,
			effects: [
				...this.effects.map((effect) => ({ kind: effect.kind, what: effect.what, shown: effect.shown() })),
				...(this.lights ? [{ kind: "lights" as const, what: null, shown: [] }] : []),
			],
			cost: { mean: this.updates ? this.spent / this.updates : 0, updates: this.updates },
		};
	}

	destroy() {
		for (const effect of this.effects) effect.destroy();
	}
}

/** Inside a water slot's oval and outside its hole (a fountain's pillar). */
function inPool(slot: OverlaySlot, [x, y]: Point): boolean {
	const [cx, cy] = slot.at;
	const rx = slot.rx ?? 2;
	const ry = slot.ry ?? 1;
	if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 0.8) return false;
	if (!slot.hole?.length) return true;
	let inside = false;
	const hole = slot.hole;
	for (let i = 0, j = hole.length - 1; i < hole.length; j = i++) {
		const [xi, yi] = hole[i];
		const [xj, yj] = hole[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return !inside;
}

const between = (random: () => number, low: number, high: number) => low + (high - low) * random();
const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)];

/** Particles that live and die in turn: each, when its life is over, is born again elsewhere. */
abstract class Particles implements Effect {
	abstract readonly kind: Atmosphere["kind"];
	readonly what: string | null = null;
	protected readonly scene: Phaser.Scene;
	protected readonly random: () => number;
	protected readonly particles: Particle[] = [];

	constructor(scene: Phaser.Scene, random: () => number) {
		this.scene = scene;
		this.random = random;
	}

	protected abstract born(particle: Particle, first: boolean): void;
	protected abstract move(particle: Particle, seconds: number): void;

	protected add(texture: string, count: number, setUp?: (image: Phaser.GameObjects.Image) => void) {
		for (let i = 0; i < count; i++) {
			const image = this.scene.add.image(0, 0, texture);
			setUp?.(image);
			const particle: Particle = { image, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, phase: 0, peak: 1 };
			this.born(particle, true);
			this.particles.push(particle);
			this.move(particle, 0);
		}
	}

	step(seconds: number) {
		for (const particle of this.particles) {
			particle.age += seconds;
			if (particle.age >= particle.life) this.born(particle, false);
			this.move(particle, seconds);
		}
	}

	shown(): Point[] {
		return this.particles
			.filter((p) => p.image.visible && p.image.alpha > 0.02)
			.map((p) => [p.image.x / TILE, p.image.y / TILE]);
	}

	destroy() {
		for (const particle of this.particles) particle.image.destroy();
	}
}

/** Dust drifting in the light: soft specks that wander slowly and come and go. */
class Motes extends Particles {
	readonly kind = "motes";
	private readonly rect: Rect;

	constructor(scene: Phaser.Scene, rect: Rect, effect: Atmosphere, random: () => number) {
		super(scene, random);
		this.rect = rect;
		const count = effect.count ?? Math.round(Math.max(6, Math.min(22, (rect[2] * rect[3]) / 5)));
		const colour = Phaser.Display.Color.HexStringToColor(effect.colors?.[0] ?? "#fff1cc").color;
		this.add("atmosphere:mote", count, (image) =>
			image.setBlendMode(Phaser.BlendModes.ADD).setDepth(AIR_DEPTH).setTint(colour),
		);
	}

	protected born(p: Particle, first: boolean) {
		const [x, y, w, h] = this.rect;
		p.x = x + this.random() * w;
		p.y = y + this.random() * h;
		p.vx = between(this.random, -0.07, 0.07);
		p.vy = between(this.random, -0.05, 0.03);
		p.life = between(this.random, 6, 12);
		p.age = first ? this.random() * p.life : 0;
		p.phase = this.random() * Math.PI * 2;
		p.peak = between(this.random, 0.45, 0.85);
		p.image.setScale(between(this.random, 0.4, 0.7));
	}

	protected move(p: Particle, seconds: number) {
		p.x += p.vx * seconds;
		p.y += p.vy * seconds;
		const t = p.age / p.life;
		const sway = Math.sin(p.age * 0.8 + p.phase) * 0.12;
		p.image.setPosition((p.x + sway) * TILE, p.y * TILE).setAlpha(p.peak * Math.sin(Math.PI * t) ** 1.5);
	}
}

/** Leaves or petals drifting down on the wind, swaying and turning, to lie a while on open floor. */
class Fall extends Particles {
	readonly kind = "fall";
	readonly what: string;
	private readonly rect: Rect;
	private readonly open: (at: Point) => boolean;
	private readonly petals: boolean;

	constructor(scene: Phaser.Scene, rect: Rect, effect: Atmosphere, random: () => number, open: (at: Point) => boolean) {
		super(scene, random);
		this.rect = rect;
		this.open = open;
		this.what = effect.what ?? "leaves";
		this.petals = this.what === "petals";
		const count = effect.count ?? (this.petals ? 16 : 11);
		const colours = (effect.colors ?? (this.petals ? PETAL_COLOURS : LEAF_COLOURS)).map(
			(c) => Phaser.Display.Color.HexStringToColor(c).color,
		);
		let n = 0;
		this.add(this.petals ? "atmosphere:petal" : "atmosphere:leaf", count, (image) =>
			image.setScale(PX * 1.25).setTint(colours[n++ % colours.length]),
		);
	}

	protected born(p: Particle, first: boolean) {
		const [x, y, w, h] = this.rect;
		p.x = x - 2 + this.random() * (w + 2);
		p.y = first ? y + this.random() * h : y + this.random() * h * 0.45;
		p.ground = Math.min(y + h - 0.2, p.y + between(this.random, 2.5, 7));
		p.vx = between(this.random, 0.15, 0.4);
		p.vy = this.petals ? between(this.random, 0.28, 0.48) : between(this.random, 0.4, 0.7);
		p.spin = between(this.random, -140, 140);
		p.phase = this.random() * Math.PI * 2;
		p.peak = between(this.random, 0.8, 1);
		p.life = 60;
		// Those in the air on arrival are already in full view.
		p.age = first ? 1 + this.random() : 0;
		p.lain = undefined;
		p.image.setDepth(AIR_DEPTH).setAngle(this.random() * 360);
	}

	protected move(p: Particle, seconds: number) {
		if (p.lain === undefined) {
			p.x += p.vx * seconds;
			p.y += p.vy * seconds;
			p.image.setAngle(p.image.angle + (p.spin ?? 0) * seconds);
			if (p.y >= (p.ground ?? Infinity)) {
				if (this.open([p.x, p.y])) {
					p.lain = 0;
					p.image.setDepth(FLOOR_DEPTH);
				} else p.lain = -1; // over a roof or a wall: it fades on its way down, behind
			}
		} else if (p.lain >= 0) p.lain += seconds;
		else {
			p.x += p.vx * seconds;
			p.y += p.vy * seconds;
		}
		const sway = p.lain === undefined || p.lain < 0 ? Math.sin(p.age * 1.3 + p.phase) * 0.35 : 0;
		// It fades in where it is born, lies a few seconds once down, and fades away.
		const fadeIn = clamp01(p.age / 0.8);
		const fadeOut =
			p.lain === undefined
				? 1
				: p.lain < 0
					? clamp01(1 - (p.y - (p.ground ?? p.y)) / 1.2)
					: clamp01((7 - p.lain) / 1.5);
		if (fadeOut <= 0) this.born(p, false);
		p.image.setPosition((p.x + sway) * TILE, p.y * TILE).setAlpha(p.peak * fadeIn * fadeOut);
	}
}

/** A small flock of birds, or a plane with its trail, crossing high over the place now and then. */
class Sky implements Effect {
	readonly kind = "sky";
	readonly what: string;
	private readonly scene: Phaser.Scene;
	private readonly random: () => number;
	private readonly rect: Rect;
	private wait: number;
	private flight?: {
		from: Point;
		to: Point;
		seconds: number;
		age: number;
		members: { image: Phaser.GameObjects.Image; shadow?: Phaser.GameObjects.Ellipse; off: Point; beat: number }[];
	};
	private trail: Particle[] = [];
	private sinceTrail = 0;

	constructor(scene: Phaser.Scene, rect: Rect, effect: Atmosphere, random: () => number) {
		this.scene = scene;
		this.random = random;
		this.rect = rect;
		this.what = effect.what ?? "birds";
		// The first soon after arriving, so a visit sees one.
		this.wait = between(random, 3, 8);
	}

	private start() {
		const [x, y, w, h] = this.rect;
		const leftward = this.random() < 0.5;
		const plane = this.what === "plane";
		const y0 = y + between(this.random, 0.5, h * (plane ? 0.8 : 0.55));
		const y1 = Math.max(y + 0.3, y0 + between(this.random, plane ? -6 : -2.5, plane ? -2 : 2.5));
		const from: Point = [leftward ? x + w + 2 : x - 2, y0];
		const to: Point = [leftward ? x - 2 : x + w + 2, y1];
		const speed = plane ? 2.6 : 3.4;
		const seconds = Math.hypot(to[0] - from[0], to[1] - from[1]) / speed;
		const members: NonNullable<typeof this.flight>["members"] = [];
		if (plane) {
			const angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
			members.push({
				image: this.scene.add
					.image(0, 0, "atmosphere:plane")
					.setScale(PX)
					.setAngle(angle)
					.setDepth(AIR_DEPTH + 2),
				off: [0, 0],
				beat: 0,
			});
		} else {
			const flock = 3 + Math.floor(this.random() * 3);
			const birds = this.scene.textures.exists("overlay:bird-1");
			for (let i = 0; i < flock; i++) {
				const image = this.scene.add
					.image(0, 0, birds ? "overlay:bird-1" : "atmosphere:bird")
					.setDepth(AIR_DEPTH + 2)
					.setFlipX(leftward);
				// About half a tile across: birds high overhead, smaller than a messenger landing by someone.
				image.setScale(birds ? (0.5 * TILE) / 403 : PX);
				const shadow = this.scene.add.ellipse(0, 0, TILE * 0.3, TILE * 0.1, 0x000000, 0.14).setDepth(FLOOR_DEPTH);
				// A loose V: each behind and to one side of the one before.
				const rank = Math.ceil(i / 2);
				const side = i % 2 ? 1 : -1;
				members.push({
					image,
					shadow,
					off: [
						(leftward ? 1 : -1) * rank * between(this.random, 0.7, 1),
						side * rank * between(this.random, 0.45, 0.6),
					],
					beat: this.random() * 4,
				});
			}
		}
		this.flight = { from, to, seconds, age: 0, members };
	}

	step(seconds: number) {
		this.stepTrail(seconds);
		if (!this.flight) {
			this.wait -= seconds;
			if (this.wait <= 0) this.start();
			return;
		}
		const flight = this.flight;
		flight.age += seconds;
		const t = flight.age / flight.seconds;
		const [x0, y0] = flight.from;
		const [x1, y1] = flight.to;
		const [x, y] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
		for (const member of flight.members) {
			const [ox, oy] = member.off;
			const bob = this.what === "birds" ? Math.sin(flight.age * 2 + member.beat) * 0.12 : 0;
			member.image.setPosition((x + ox) * TILE, (y + oy + bob) * TILE);
			if (this.what === "birds") {
				member.beat += seconds * 11;
				// Flapping, with a glide now and then.
				const glide = Math.sin(flight.age * 0.9 + member.beat * 0.05) > 0.55;
				member.image.setTexture(
					this.scene.textures.exists("overlay:bird-1")
						? `overlay:bird-${glide ? 1 : Math.floor(member.beat) % 4}`
						: "atmosphere:bird",
				);
				// Their shadows on the ground, well south of the birds high above.
				member.shadow?.setPosition((x + ox + 1.2) * TILE, (y + oy + 4.5) * TILE);
			}
		}
		if (this.what === "plane") {
			this.sinceTrail += seconds;
			if (this.sinceTrail > 0.12) {
				this.sinceTrail = 0;
				const image = this.scene.add
					.image(x * TILE, y * TILE, "atmosphere:mote")
					.setDepth(AIR_DEPTH + 1)
					.setTint(0xffffff);
				this.trail.push({ image, x, y, vx: 0, vy: 0, age: 0, life: 4, phase: 0, peak: 0.3 });
			}
		}
		if (t >= 1) {
			for (const member of flight.members) {
				member.image.destroy();
				member.shadow?.destroy();
			}
			this.flight = undefined;
			this.wait = this.what === "plane" ? between(this.random, 40, 75) : between(this.random, 18, 40);
		}
	}

	private stepTrail(seconds: number) {
		for (const puff of [...this.trail]) {
			puff.age += seconds;
			const t = puff.age / puff.life;
			if (t >= 1) {
				puff.image.destroy();
				this.trail.splice(this.trail.indexOf(puff), 1);
				continue;
			}
			puff.image.setScale(0.45 + t * 0.9).setAlpha(puff.peak * (1 - t));
		}
	}

	shown(): Point[] {
		return (this.flight?.members ?? []).map(({ image }) => [image.x / TILE, image.y / TILE]);
	}

	destroy() {
		for (const member of this.flight?.members ?? []) {
			member.image.destroy();
			member.shadow?.destroy();
		}
		for (const puff of this.trail) puff.image.destroy();
	}
}

/** Wisps rising from a cup, a kettle, or a trough: soft, slow, and faint. */
class Steam extends Particles {
	readonly kind = "steam";
	private readonly at: Point;
	private readonly w: number;

	constructor(scene: Phaser.Scene, effect: Atmosphere, random: () => number, depth: number) {
		super(scene, random);
		this.at = effect.at!;
		this.w = effect.w ?? 0.25;
		this.add("atmosphere:puff", effect.count ?? 5, (image) => image.setDepth(depth));
	}

	protected born(p: Particle, first: boolean) {
		p.x = this.at[0] + (this.random() - 0.5) * this.w;
		p.y = this.at[1];
		p.vx = between(this.random, -0.06, 0.06);
		p.vy = -between(this.random, 0.3, 0.45);
		p.life = between(this.random, 2.2, 3.2);
		p.age = first ? this.random() * p.life : 0;
		p.phase = this.random() * Math.PI * 2;
		p.peak = between(this.random, 0.4, 0.55);
	}

	protected move(p: Particle, seconds: number) {
		p.x += p.vx * seconds;
		p.y += p.vy * seconds;
		const t = p.age / p.life;
		const sway = Math.sin(p.age * 1.7 + p.phase) * 0.08 * t;
		p.image
			.setPosition((p.x + sway) * TILE, p.y * TILE)
			.setScale(0.4 + t * 0.8)
			.setAlpha(p.peak * Math.min(1, t / 0.15) * (1 - t));
	}
}

/** Embers rising quick and bright from a forge's fire, flickering out. */
class Sparks extends Particles {
	readonly kind = "sparks";
	private readonly at: Point;
	private readonly w: number;

	constructor(scene: Phaser.Scene, effect: Atmosphere, random: () => number) {
		super(scene, random);
		this.at = effect.at!;
		this.w = effect.w ?? 1;
		const colours = (effect.colors ?? ["#ffd27a", "#ff9a3c", "#ffe9b0"]).map(
			(c) => Phaser.Display.Color.HexStringToColor(c).color,
		);
		let n = 0;
		this.add("atmosphere:spark", effect.count ?? 7, (image) =>
			image
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth(this.at[1] * TILE + 0.05)
				.setScale(PX)
				.setTint(colours[n++ % colours.length]),
		);
	}

	protected born(p: Particle, first: boolean) {
		p.x = this.at[0] + (this.random() - 0.5) * this.w;
		p.y = this.at[1] - 0.2;
		p.vx = between(this.random, -0.35, 0.35);
		p.vy = -between(this.random, 0.9, 1.7);
		// Now and then a pause between embers, so they come in little bursts.
		p.life = between(this.random, 0.6, 1.3) + (this.random() < 0.3 ? between(this.random, 0.5, 1.5) : 0);
		p.age = first ? this.random() * p.life : 0;
		p.phase = this.random() * Math.PI * 2;
		p.peak = between(this.random, 0.7, 1);
	}

	protected move(p: Particle, seconds: number) {
		p.x += p.vx * seconds;
		p.y += p.vy * seconds;
		p.vy *= 1 - 0.6 * seconds;
		const t = clamp01(p.age / Math.min(p.life, 1.3));
		const flicker = 0.7 + 0.3 * Math.sin(p.age * 30 + p.phase);
		p.image.setPosition(p.x * TILE, p.y * TILE).setAlpha(p.peak * (1 - t) * flicker * (t < 1 ? 1 : 0));
	}
}

/** Small lights blinking each in its own rhythm: a server rack's LEDs, a console's lamps. */
class Blink implements Effect {
	readonly kind = "blink";
	readonly what = null;
	private readonly lights: {
		image: Phaser.GameObjects.Image;
		period: number;
		duty: number;
		age: number;
		peak: number;
	}[] = [];

	constructor(scene: Phaser.Scene, effect: Atmosphere, random: () => number) {
		const [x, y, w, h] = effect.rect!;
		const count = effect.count ?? Math.round(Math.max(6, Math.min(30, w * h * 2)));
		const colours = (effect.colors ?? ["#5cf08e", "#62c8ff", "#ffbf52"]).map(
			(c) => Phaser.Display.Color.HexStringToColor(c).color,
		);
		for (let i = 0; i < count; i++) {
			const image = scene.add
				.image((x + random() * w) * TILE, (y + random() * h) * TILE, "atmosphere:led")
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth((y + h) * TILE + 0.05)
				.setScale(PX)
				.setTint(pick(random, colours));
			this.lights.push({
				image,
				period: between(random, 0.25, 2.6),
				duty: between(random, 0.25, 0.85),
				age: random() * 3,
				peak: between(random, 0.55, 0.95),
			});
		}
		this.step(0);
	}

	step(seconds: number) {
		for (const light of this.lights) {
			light.age += seconds;
			const on = (light.age / light.period) % 1 < light.duty;
			light.image.setAlpha(on ? light.peak : light.peak * 0.12);
		}
	}

	shown(): Point[] {
		return this.lights.filter((l) => l.image.alpha > 0.3).map(({ image }) => [image.x / TILE, image.y / TILE]);
	}

	destroy() {
		for (const light of this.lights) light.image.destroy();
	}
}

/** Each screen's soft light, breathing a little and flickering now and then. */
class Screens implements Effect {
	readonly kind = "screens";
	readonly what = null;
	private readonly random: () => number;
	private readonly screens: {
		image: Phaser.GameObjects.Image;
		age: number;
		phase: number;
		dip: number;
		next: number;
	}[] = [];

	constructor(scene: Phaser.Scene, effect: Atmosphere, random: () => number, depthOf: (rect: Rect) => number) {
		this.random = random;
		const colour = Phaser.Display.Color.HexStringToColor(effect.colors?.[0] ?? "#9fd8ff").color;
		for (const rect of effect.rects ?? []) {
			const [x, y, w, h] = rect;
			const image = scene.add
				.image((x + w / 2) * TILE, (y + h / 2) * TILE, "atmosphere:screen")
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth(depthOf(rect))
				.setTint(colour);
			image.setScale((w * TILE * 1.25) / image.width, (h * TILE * 1.4) / image.height);
			this.screens.push({
				image,
				age: random() * 10,
				phase: random() * Math.PI * 2,
				dip: 0,
				next: between(random, 2, 9),
			});
		}
		this.step(0);
	}

	step(seconds: number) {
		for (const screen of this.screens) {
			screen.age += seconds;
			screen.next -= seconds;
			if (screen.next <= 0) {
				// A flicker: a moment dimmer, as a screen changes what it shows.
				screen.dip = between(this.random, 0.08, 0.18);
				screen.next = between(this.random, 3, 11);
			}
			screen.dip = Math.max(0, screen.dip - seconds);
			const breath = 0.2 + 0.05 * Math.sin(screen.age * 1.6 + screen.phase);
			screen.image.setAlpha(screen.dip > 0 ? breath * 0.35 : breath);
		}
	}

	shown(): Point[] {
		return this.screens.map(({ image }) => [image.x / TILE, image.y / TILE]);
	}

	destroy() {
		for (const screen of this.screens) screen.image.destroy();
	}
}

/** Glints of light on water: little stars that wink and are gone. */
class Shimmer extends Particles {
	readonly kind = "shimmer";
	private readonly rect: Rect;
	private readonly water: (at: Point) => boolean;

	constructor(
		scene: Phaser.Scene,
		effect: Atmosphere,
		random: () => number,
		water: (at: Point) => boolean,
		depth: number,
	) {
		super(scene, random);
		this.rect = effect.rect!;
		this.water = water;
		const count = effect.count ?? Math.round(Math.max(4, Math.min(16, (this.rect[2] * this.rect[3]) / 6)));
		this.add("atmosphere:glint", count, (image) => image.setBlendMode(Phaser.BlendModes.ADD).setDepth(depth));
	}

	protected born(p: Particle, first: boolean) {
		const [x, y, w, h] = this.rect;
		// A few tries for a point on water; a glint with none waits its turn unseen.
		p.peak = 0;
		for (let tries = 0; tries < 8; tries++) {
			const at: Point = [x + this.random() * w, y + this.random() * h];
			if (this.water(at)) {
				[p.x, p.y] = at;
				p.peak = between(this.random, 0.5, 0.9);
				break;
			}
		}
		p.life = between(this.random, 0.5, 1.1) + between(this.random, 0.2, 1.6);
		p.phase = between(this.random, 0.5, 1.1); // how long it shows; the rest of its life it waits
		p.age = first ? this.random() * p.life : 0;
	}

	protected move(p: Particle) {
		const t = clamp01(p.age / p.phase);
		const glint = t < 1 ? Math.sin(Math.PI * t) : 0;
		p.image
			.setPosition(p.x * TILE, p.y * TILE)
			.setScale(PX * (0.5 + 0.5 * glint))
			.setAlpha(p.peak * glint);
	}
}

const LEAF_COLOURS = ["#c8582a", "#e3a03c", "#a9442a", "#d9b44a", "#b86a2c"];
const PETAL_COLOURS = ["#f8c9d6", "#f4b0c4", "#fde3ea", "#f9bfd0"];

/**
 * The particles' little sprites, drawn once: pixel patterns in the art's manner (a dark tone of the fill as outline,
 * never black) for leaves, petals, the plane, a spark, and an LED; soft round gradients for motes, steam, glints, and
 * screens' light. Leaves and petals are drawn in white shades and tinted.
 */
function drawTextures(scene: Phaser.Scene) {
	const pattern = (key: string, rows: string[], colours: Record<string, string>) => {
		if (scene.textures.exists(key)) return;
		const canvas = document.createElement("canvas");
		canvas.width = rows[0].length;
		canvas.height = rows.length;
		const ctx = canvas.getContext("2d")!;
		rows.forEach((row, y) => {
			[...row].forEach((cell, x) => {
				if (!colours[cell]) return;
				ctx.fillStyle = colours[cell];
				ctx.fillRect(x, y, 1, 1);
			});
		});
		scene.textures.addCanvas(key, canvas);
		scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
	};
	const soft = (key: string, size: number, stops: [number, string][], w = size, h = size) => {
		if (scene.textures.exists(key)) return;
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d")!;
		ctx.setTransform(w / size, 0, 0, h / size, 0, 0);
		const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		for (const [at, colour] of stops) gradient.addColorStop(at, colour);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size, size);
		scene.textures.addCanvas(key, canvas);
	};
	// Tinted at draw time: W the leaf, L its light side, D its dark edge.
	pattern("atmosphere:leaf", ["....DD.", "..DDWLD", ".DWWWLD", "DWWWLD.", ".DWDD..", "D......"], {
		D: "#8c8c8c",
		W: "#e6e6e6",
		L: "#ffffff",
	});
	pattern("atmosphere:petal", ["..DD..", ".DWLD.", "DWWWLD", ".DWWD.", "..DD.."], {
		D: "#c4c4c4",
		W: "#ececec",
		L: "#ffffff",
	});
	pattern("atmosphere:plane", ["...D...", "...W...", "DWWWWWD", "..DWD..", "...W...", "..DWD.."], {
		D: "#7d8696",
		W: "#eef2f8",
	});
	pattern("atmosphere:bird", ["D...D", ".D.D.", "..D.."], { D: "#3b3540" });
	pattern("atmosphere:spark", ["LW", "WL"], { W: "#ffffff", L: "rgba(255,255,255,0.6)" });
	pattern("atmosphere:led", ["W"], { W: "#ffffff" });
	soft("atmosphere:mote", 16, [
		[0, "rgba(255,255,255,1)"],
		[0.35, "rgba(255,255,255,0.55)"],
		[1, "rgba(255,255,255,0)"],
	]);
	soft("atmosphere:puff", 32, [
		[0, "rgba(255,255,255,0.9)"],
		[0.5, "rgba(255,255,255,0.45)"],
		[1, "rgba(255,255,255,0)"],
	]);
	soft("atmosphere:screen", 32, [
		[0, "rgba(255,255,255,0.9)"],
		[0.55, "rgba(255,255,255,0.5)"],
		[1, "rgba(255,255,255,0)"],
	]);
	pattern("atmosphere:glint", ["..L..", "..W..", "LWWWL", "..W..", "..L.."], {
		W: "#fffbe8",
		L: "rgba(255,246,214,0.55)",
	});
}
