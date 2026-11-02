// Fidget objects (ticket 29, decision 27): things to play with in every place, designed with the place: pet the cat,
// ring the bell, light the candles, spin the globe. Pure play: a fidget never changes work, sends no command, makes
// no outside call, and stores nothing in the runtime. What it is doing (a light left on, a box left open) lasts while
// the app runs, here in the world UI. Each answers the pointer as any thing in the world does: hover text, its default
// play on a left click, every play and Examine on a right click; the avatar walks up first.
import * as Phaser from "phaser";
import { chatLines } from "../overlay/interface/chat-lines.js";
import {
	FIDGETS,
	type FidgetKind,
	type FidgetParticle,
	type FidgetStyle,
	type OverlaySlot,
	PET_FRAME_ORDER,
	type PetFrame,
	type PlaceData,
	type Point,
	petArt,
	type Rect,
	slotStyle,
	TILE,
} from "../theme.js";
import { worn } from "../theme-store.js";
import { action, type Target } from "./actions.js";
import { drawTag } from "./character-life.js";
import { fidgetScale, fidgetSlots, onFloor, standPoints, surfaceOf } from "./fidget-spots.js";
import { PERSON_TILES } from "./walker.js";

/** A soft light the scene draws (its lantern glow), whose brightness a fidget turns up and down. */
export interface Glow {
	/** Ease its brightness to `level` (0 is dark) over `ms`. */
	level(level: number, ms?: number): void;
	destroy(): void;
	readonly image: Phaser.GameObjects.Image;
}

export interface FidgetHost {
	place(): PlaceData;
	/** The place's key: what a fidget left on or open is remembered under. */
	placeKey(): string;
	/** Walk up to the first group of stand points that can be reached, face `at`, then play. */
	walkUp(stands: Point[][], at: Point, then: () => void): void;
	/** The scene's warm glow at a point (tiles), `r` tiles across its halo, drawn at `depth` (just over its fidget). */
	glow(at: Point, r: number, level: number, depth: number): Glow;
	notify(text: string): void;
	/** The view's zoom correction for things drawn at a steady size on screen. */
	uiScale(): number;
}

export interface FidgetView {
	index: number;
	kind: FidgetKind;
	name: string;
	/** Its bottom centre, in tiles, and its size. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** The sprite it shows (`pet-1`, `light-on`). */
	art: string;
	/** A pet's look (`hound`), null for the kind's own sprites or another kind; and whether it rests asleep. */
	look: string | null;
	asleep: boolean;
	/** A light on, a box open. */
	on: boolean;
	/** The play under way, or null at rest. */
	playing: string | null;
	/** Its turn in degrees (a swinging handbell) and how fast a spinner turns (frames per second). */
	angle: number;
	speed: number;
	/** Little drawn things it gives off, in the air now (hearts, notes). */
	particles: number;
	/** Its light's brightness, when it has one. */
	glow: number | null;
	/** The line a tome shows, while it shows. */
	line: string | null;
	onFloor: boolean;
}

/** What a fidget left on or open stays, per theme, place, and slot, while the app runs. */
const kept = new Map<string, boolean>();

/** The particle each kind gives off by default; a pack may name its own for the main play. */
const PARTICLE: Record<FidgetKind, FidgetParticle> = {
	pet: "hearts",
	spin: "sparkles",
	bell: "sparkles",
	handbell: "sparkles",
	light: "sparkles",
	box: "notes",
	sleeper: "zzz",
	candle: "smoke",
	tome: "sparkles",
};
/** A spinner's spin: frames per second added by a spin and by a nudge, the most, and how fast it slows (per second). */
const SPIN = { spin: 15, nudge: 5, most: 24, slowing: 0.62, rest: 0.5 } as const;
/** World px per pixel of a particle's pattern. */
const FX_PX = 1.7;
/** Rising over the place's characters and furniture (puffs and sparkles in the air), under the signs. */
const FX_DEPTH = 9.3e4;

interface Fidget {
	index: number;
	slot: OverlaySlot;
	kind: FidgetKind;
	style: FidgetStyle;
	name: string;
	image: Phaser.GameObjects.Image;
	/** A pet's sprites by what each shows, and the one it shows at rest (a pet asleep, its sleep sprite). */
	frames: Partial<Record<PetFrame, string>>;
	rest: string;
	/** A pet curled up asleep at rest: play wakes it for a while. */
	asleep: boolean;
	/** World px per px of sprite, from its first frame, so every frame keeps one pixel size. */
	scale: number;
	depth: number;
	onFloor: boolean;
	on: boolean;
	playing: string | null;
	/** When the current play is over (scene time, ms), and what happens then. */
	timers: Phaser.Time.TimerEvent[];
	tweens: Phaser.Tweens.Tween[];
	spin: { phase: number; speed: number };
	glow?: Glow;
	/** A tome's line on its sign, and which line comes next. */
	sign?: { line: string; tag: Phaser.GameObjects.Container };
	next: number;
	/** When it fidgets on its own next (a cat licking its paw, a sleeper's "z"). */
	idleAt: number;
	bob?: Phaser.Tweens.Tween;
}

export class Fidgets {
	private readonly scene: Phaser.Scene;
	private readonly host: FidgetHost;
	private fidgets: Fidget[] = [];
	/** The particles in the air, by the fidget giving them off. */
	private particles = new Map<Phaser.GameObjects.Image, Fidget>();

	constructor(scene: Phaser.Scene, host: FidgetHost) {
		this.scene = scene;
		this.host = host;
		this.particleTextures();
		const place = host.place();
		fidgetSlots(place).forEach((slot, index) => {
			const kind = slot.fidget!;
			const style = worn().fidgets[kind];
			// A pet wears its look's sprites, name, and reactions (`pet-hound-0`, "Hound").
			const art = kind === "pet" ? petArt(slot.look) : [...FIDGETS[kind].art];
			if (!style || !scene.textures.exists(`overlay:${art[0]}`)) return;
			this.fidgets.push(this.add(index, slot, kind, slotStyle(style, slot), art, place));
		});
	}

	destroy() {
		for (const fidget of this.fidgets) this.stop(fidget);
	}

	private keyOf(fidget: { index: number }) {
		return `${worn().id}:${this.host.placeKey()}:${fidget.index}`;
	}

	private add(
		index: number,
		slot: OverlaySlot,
		kind: FidgetKind,
		style: FidgetStyle,
		art: string[],
		place: PlaceData,
	): Fidget {
		const [x, y] = slot.at;
		const first = this.scene.textures.get(`overlay:${art[0]}`).getSourceImage() as HTMLImageElement;
		// A pet to scale with the characters (a cat about a third of one standing); other things by their width.
		const scale = fidgetScale(kind, style, slot, first, PERSON_TILES) * TILE;
		const frames: Fidget["frames"] =
			kind === "pet" ? Object.fromEntries((style.frames ?? PET_FRAME_ORDER).map((frame, i) => [frame, art[i]])) : {};
		const asleep = kind === "pet" && !!slot.asleep && !!frames.sleep;
		const rest = asleep ? frames.sleep! : art[0];
		// On a piece of furniture it lies just over that piece (which the foreground pass draws again); on the floor it
		// stands among the characters by its feet.
		const surface = surfaceOf(place, slot.at);
		const depth = surface ? surface.feet * TILE + 0.2 : y * TILE;
		const on = kept.get(`${worn().id}:${this.host.placeKey()}:${index}`) ?? slot.on ?? false;
		const image = this.scene.add
			.image(x * TILE, y * TILE, `overlay:${rest}`)
			.setOrigin(0.5, 1)
			.setScale(scale)
			.setDepth(depth);
		const fidget: Fidget = {
			index,
			slot,
			kind,
			style,
			name: slot.name ?? style.name,
			image,
			frames,
			rest,
			asleep,
			scale,
			depth,
			onFloor: onFloor(place, slot),
			on,
			playing: null,
			timers: [],
			tweens: [],
			spin: { phase: 0, speed: 0 },
			next: 0,
			idleAt: this.scene.time.now + Phaser.Math.Between(2500, 9000),
		};
		if (kind === "handbell") {
			// Swung from its grip: turned about the top of the handle, standing where it would.
			image.setOrigin(0.5, 0.12).setY((y - (image.displayHeight * 0.88) / TILE) * TILE);
		}
		this.dress(fidget);
		return fidget;
	}

	/** Its look at rest for its state: a light on or off (with its glow), a box open or shut, a sleeper breathing. */
	private dress(fidget: Fidget) {
		const { kind, image } = fidget;
		const [x, y] = fidget.slot.at;
		const h = this.height(fidget);
		if (kind === "light" || kind === "box") this.show(fidget, FIDGETS[kind].art[fidget.on ? 1 : 0]);
		if (kind === "light" || kind === "candle") {
			const r = Math.max(0.9, fidget.slot.r ?? this.width(fidget) * 1.9);
			fidget.glow ??= this.host.glow([x, y - h * (kind === "light" ? 0.78 : 0.8)], r, 0, fidget.depth + 0.05);
			fidget.glow.level(kind === "candle" || fidget.on ? 0.55 : 0, 0);
		}
		if (kind === "sleeper" || fidget.asleep)
			fidget.bob = this.scene.tweens.add({
				targets: image,
				scaleY: fidget.scale * 0.965,
				duration: 1600 + Math.random() * 500,
				yoyo: true,
				repeat: -1,
				ease: "Sine.inOut",
			});
	}

	private width(fidget: Fidget) {
		return fidget.image.displayWidth / TILE;
	}

	/** Its height at rest, in tiles. */
	private height(fidget: Fidget) {
		const rest = this.scene.textures.get(`overlay:${fidget.rest}`).getSourceImage() as HTMLImageElement;
		return (rest.height * fidget.scale) / TILE;
	}

	/** Show one of its sprites, keeping one pixel size across them. */
	private show(fidget: Fidget, art: string) {
		fidget.image.setTexture(`overlay:${art}`);
	}

	/** Where it answers the pointer (tiles): the sprite's box, never smaller than a small hand's width. */
	private rectOf(fidget: Fidget): Rect {
		const [x, y] = fidget.slot.at;
		const w = Math.max(0.5, this.width(fidget));
		const h = Math.max(0.5, this.height(fidget));
		return [x - w / 2, y - h, w, h];
	}

	// What the pointer offers.

	/** Every fidget under a point, the front one first: its default play, its other plays, and Examine. */
	targetsAt([px, py]: Point): Target[] {
		return this.fidgets
			.filter((fidget) => {
				const [x, y, w, h] = this.rectOf(fidget);
				return px >= x && px < x + w && py >= y && py < y + h;
			})
			.sort((a, b) => b.depth - a.depth)
			.map((fidget) => ({ name: fidget.name, tone: "object", actions: this.actions(fidget) }));
	}

	private actions(fidget: Fidget) {
		const { kind, style, name } = fidget;
		const plays: string[] =
			kind === "light"
				? [fidget.on ? "off" : "on"]
				: kind === "box"
					? [fidget.on ? "close" : "open"]
					: [...FIDGETS[kind].plays];
		return [
			...plays.map((play) =>
				action(style.verbs[play] ?? play, () => this.walkUp(fidget, () => this.play(fidget, play)), name, "object"),
			),
			action("Examine", () => this.examine(fidget), name, "object"),
		];
	}

	private walkUp(fidget: Fidget, then: () => void) {
		this.host.walkUp(standPoints(this.host.place(), fidget.slot, this.width(fidget)), fidget.slot.at, then);
	}

	private examine(fidget: Fidget) {
		const line = fidget.style.examine.replace(/\{name\}/g, fidget.name);
		chatLines.add(line, "game");
		this.host.notify(line);
	}

	// Plays.

	/** Play with it: each kind its own way; a new play cuts the last one short. */
	play(fidget: Fidget, play: string) {
		const kind = fidget.kind;
		if (kind !== "spin") this.settle(fidget);
		fidget.playing = play;
		const particle = fidget.style.particle ?? PARTICLE[kind];
		if (kind === "pet") return play === "pet" ? this.pet(fidget, particle) : this.romp(fidget);
		if (kind === "spin") return this.twirl(fidget, play === "spin" ? SPIN.spin : SPIN.nudge, particle);
		if (kind === "bell" || kind === "handbell") return this.ring(fidget, play === "peal" ? 3 : 1, particle);
		if (kind === "light") return this.toggleLight(fidget, play === "on");
		if (kind === "box") return this.toggleBox(fidget, play === "open", particle);
		if (kind === "sleeper") return play === "pet" ? this.stroke(fidget) : this.boop(fidget);
		if (kind === "candle") return play === "blow" ? this.blow(fidget) : this.cup(fidget);
		if (kind === "tome") return this.leaf(fidget);
	}

	/** Back at rest at once: its timers and tweens stopped, its first sprite (or its state's) shown. */
	private settle(fidget: Fidget) {
		for (const timer of fidget.timers) timer.remove();
		for (const tween of fidget.tweens) tween.remove();
		fidget.timers = [];
		fidget.tweens = [];
		fidget.image
			.setScale(fidget.scale)
			.setAngle(0)
			.setX(fidget.slot.at[0] * TILE);
		if (fidget.kind === "sleeper" || fidget.asleep) {
			fidget.bob?.remove();
			this.dress(fidget);
		}
		if (fidget.kind === "pet" || fidget.kind === "bell") this.show(fidget, fidget.rest);
		fidget.playing = null;
	}

	/** The scene is going: its images are already gone, so only the timers and tweens are stopped. */
	private stop(fidget: Fidget) {
		for (const timer of fidget.timers) timer.remove();
		for (const tween of fidget.tweens) tween.remove();
		fidget.bob?.remove();
		fidget.timers = [];
		fidget.tweens = [];
	}

	private after(fidget: Fidget, ms: number, then: () => void) {
		fidget.timers.push(this.scene.time.delayedCall(ms, then));
	}

	private tween(fidget: Fidget, config: Phaser.Types.Tweens.TweenBuilderConfig) {
		fidget.tweens.push(this.scene.tweens.add(config));
	}

	private done(fidget: Fidget, ms: number) {
		this.after(fidget, ms, () => this.settle(fidget));
	}

	/**
	 * Petted: it leans into the hand, eyes closed, purring (a little shiver), hearts rise; then it stretches, if it does,
	 * and sits again. Asleep, it purrs in its sleep and sleeps on.
	 */
	private pet(fidget: Fidget, particle: FidgetParticle) {
		const { frames } = fidget;
		if (fidget.asleep) {
			const x = fidget.image.x;
			this.tween(fidget, { targets: fidget.image, x: x + 0.7, duration: 55, yoyo: true, repeat: 11 });
			this.burst(fidget, particle, 3, 0.6);
			this.done(fidget, 1500);
			return;
		}
		this.show(fidget, frames.petted!);
		this.tween(fidget, {
			targets: fidget.image,
			scaleY: fidget.scale * 0.96,
			duration: 230,
			yoyo: true,
			repeat: 3,
			ease: "Sine.inOut",
		});
		this.burst(fidget, particle, 4, 0.75);
		if (!frames.stretch) {
			this.after(fidget, 1700, () => this.show(fidget, frames.sit!));
			this.done(fidget, 1800);
			return;
		}
		this.after(fidget, 1500, () => this.show(fidget, frames.stretch!));
		this.after(fidget, 2300, () => this.show(fidget, frames.sit!));
		this.done(fidget, 2400);
	}

	/**
	 * Played with: its playful pose, hopping twice (as high as it is small or big), with a sparkle. Asleep, it wakes
	 * first (sits up with a start), plays, and curls up again.
	 */
	private romp(fidget: Fidget) {
		const { frames } = fidget;
		const rest = fidget.image.y;
		const hop = Math.max(0.08, Math.min(0.2, this.height(fidget) * 0.35));
		const play = () => {
			this.show(fidget, frames.play!);
			this.tween(fidget, {
				targets: fidget.image,
				y: rest - hop * TILE,
				duration: 170,
				yoyo: true,
				repeat: 1,
				ease: "Quad.out",
			});
			this.burst(fidget, "sparkles", 3, 0.8);
		};
		if (!fidget.asleep) {
			play();
			this.done(fidget, 1500);
			return;
		}
		fidget.bob?.remove();
		fidget.image.setScale(fidget.scale);
		this.show(fidget, frames.sit!);
		this.pop(fidget);
		this.after(fidget, 600, play);
		this.after(fidget, 1900, () => this.show(fidget, frames.sit!));
		this.done(fidget, 3200);
	}

	/** Spun: it turns fast and slows down to rest (`update` turns it). A nudge turns it gently. */
	private twirl(fidget: Fidget, push: number, particle: FidgetParticle) {
		fidget.spin.speed = Math.min(SPIN.most, fidget.spin.speed + push);
		this.burst(fidget, particle, push > SPIN.nudge ? 3 : 1, 0.6);
	}

	/** Rung: the ringing sprite with a shake (a handbell swings), sparkles at the top; a peal rings three times. */
	private ring(fidget: Fidget, times: number, particle: FidgetParticle) {
		const once = (at: number) =>
			this.after(fidget, at, () => {
				if (fidget.kind === "bell") this.show(fidget, "bell-ringing");
				const swing = fidget.kind === "handbell" ? 16 : 0;
				this.tween(fidget, {
					targets: fidget.image,
					angle: { from: swing, to: -swing },
					x: fidget.kind === "bell" ? { from: fidget.image.x - 1.2, to: fidget.image.x + 1.2 } : fidget.image.x,
					duration: 90,
					yoyo: true,
					repeat: 2,
					ease: "Sine.inOut",
					onComplete: () => {
						fidget.image.setAngle(0).setX(fidget.slot.at[0] * TILE);
						if (fidget.kind === "bell") this.show(fidget, "bell-still");
					},
				});
				this.burst(fidget, particle, 3, fidget.kind === "handbell" ? 0.2 : 0.85);
			});
		for (let i = 0; i < times; i++) once(i * 620);
		this.done(fidget, times * 620 + 200);
	}

	private keep(fidget: Fidget) {
		kept.set(this.keyOf(fidget), fidget.on);
	}

	/** Lit or put out: its sprite and its glow, fading; a wisp of smoke as it goes out. */
	private toggleLight(fidget: Fidget, on: boolean) {
		fidget.on = on;
		this.keep(fidget);
		this.show(fidget, on ? "light-on" : "light-off");
		fidget.glow?.level(on ? 0.55 : 0, on ? 420 : 300);
		this.pop(fidget);
		this.burst(fidget, on ? "sparkles" : "smoke", on ? 2 : 3, 0.9);
		this.done(fidget, 500);
	}

	/** Opened or shut: its sprite with a little pop; open, it gives off notes (or steam, or sparkles) until shut. */
	private toggleBox(fidget: Fidget, open: boolean, particle: FidgetParticle) {
		fidget.on = open;
		this.keep(fidget);
		this.show(fidget, open ? "box-open" : "box-closed");
		this.pop(fidget);
		if (open) this.burst(fidget, particle, 2, 0.9);
		this.done(fidget, 400);
	}

	/** A little squash and rebound, as something handled does. */
	private pop(fidget: Fidget) {
		this.tween(fidget, {
			targets: fidget.image,
			scaleX: { from: fidget.scale * 1.06, to: fidget.scale },
			scaleY: { from: fidget.scale * 0.94, to: fidget.scale },
			duration: 260,
			ease: "Back.out",
		});
	}

	/** A sleeper stroked: it purrs (a soft shiver) with hearts, and sleeps on. */
	private stroke(fidget: Fidget) {
		const x = fidget.image.x;
		this.tween(fidget, { targets: fidget.image, x: x + 0.7, duration: 55, yoyo: true, repeat: 11 });
		this.burst(fidget, "hearts", 3, 0.6);
		this.done(fidget, 1500);
	}

	/** A sleeper booped: it startles (squash and rebound), a sparkle, and settles back to sleep. */
	private boop(fidget: Fidget) {
		fidget.bob?.remove();
		this.tween(fidget, {
			targets: fidget.image,
			scaleY: { from: fidget.scale * 0.86, to: fidget.scale * 1.04 },
			scaleX: { from: fidget.scale * 1.06, to: fidget.scale },
			duration: 240,
			yoyo: true,
			ease: "Back.out",
		});
		this.burst(fidget, "sparkles", 2, 0.7);
		fidget.idleAt = this.scene.time.now + 2600;
		this.done(fidget, 900);
	}

	/** A candle blown on: its light gutters low and steadies again, with a wisp of smoke. */
	private blow(fidget: Fidget) {
		fidget.glow?.level(0.1, 140);
		this.tween(fidget, { targets: fidget.image, angle: -3, duration: 160, yoyo: true, ease: "Sine.out" });
		this.burst(fidget, "smoke", 2, 0.95);
		this.after(fidget, 420, () => fidget.glow?.level(0.55, 900));
		this.done(fidget, 1400);
	}

	/** Hands cupped round a candle: its light swells warm, then settles. */
	private cup(fidget: Fidget) {
		fidget.glow?.level(0.95, 400);
		this.burst(fidget, "sparkles", 2, 0.9);
		this.after(fidget, 1500, () => fidget.glow?.level(0.55, 700));
		this.done(fidget, 2300);
	}

	/** A tome leafed through: it ruffles (two quick squashes), sparkles, and shows one of its lines on a sign. */
	private leaf(fidget: Fidget) {
		this.tween(fidget, {
			targets: fidget.image,
			scaleY: fidget.scale * 0.93,
			duration: 110,
			yoyo: true,
			repeat: 1,
		});
		this.burst(fidget, "sparkles", 3, 0.7);
		const lines = fidget.style.lines ?? [];
		const line = lines[fidget.next++ % Math.max(1, lines.length)];
		fidget.sign?.tag.destroy();
		fidget.sign = undefined;
		if (line) {
			const [x, y] = fidget.slot.at;
			const tag = drawTag(this.scene, line)
				.setPosition(x * TILE, (y - this.height(fidget) - 0.15) * TILE)
				.setDepth(9.6e4);
			fidget.sign = { line, tag };
			const shown = fidget.sign;
			this.scene.time.delayedCall(3600, () => {
				if (fidget.sign !== shown) return;
				shown.tag.destroy();
				fidget.sign = undefined;
			});
		}
		this.done(fidget, 600);
	}

	// Each frame.

	update(time: number, delta: number) {
		const seconds = Math.min(delta, 100) / 1000;
		for (const fidget of this.fidgets) {
			if (fidget.kind === "spin") this.turn(fidget, seconds);
			if (fidget.kind === "box" && fidget.on && time >= fidget.idleAt) {
				fidget.idleAt = time + Phaser.Math.Between(520, 820);
				this.burst(fidget, fidget.style.particle ?? PARTICLE.box, 1, 0.9);
			}
			if ((fidget.kind === "sleeper" || fidget.asleep) && !fidget.playing && time >= fidget.idleAt) {
				fidget.idleAt = time + Phaser.Math.Between(2600, 4200);
				this.burst(fidget, "zzz", 1, 0.55);
			}
			if (fidget.kind === "pet" && !fidget.asleep && !fidget.playing && time >= fidget.idleAt) this.idle(fidget, time);
			fidget.sign?.tag.setScale(this.host.uiScale());
		}
	}

	/** A pet awake now and then plays, stretches, or closes its eyes by itself; one that curls up naps a while. */
	private idle(fidget: Fidget, time: number) {
		const { frames } = fidget;
		fidget.idleAt = time + Phaser.Math.Between(8000, 15_000);
		const choices = [frames.play, frames.stretch ?? frames.petted, frames.sleep].filter((art) => art !== undefined);
		const art = choices[Math.floor(Math.random() * choices.length)];
		fidget.playing = "idle";
		this.show(fidget, art);
		if (art === frames.sleep) {
			this.after(fidget, 700, () => this.burst(fidget, "zzz", 1, 0.55));
			this.done(fidget, 4200);
			return;
		}
		this.done(fidget, art === frames.play ? 1300 : 900);
	}

	/** A spinner turns by its speed, slowing to rest on a frame. */
	private turn(fidget: Fidget, seconds: number) {
		const spin = fidget.spin;
		if (spin.speed <= 0) return;
		spin.phase = (spin.phase + spin.speed * seconds) % 4;
		spin.speed *= Math.exp(-SPIN.slowing * seconds);
		if (spin.speed < SPIN.rest) {
			spin.speed = 0;
			fidget.playing = null;
		}
		this.show(fidget, FIDGETS.spin.art[Math.floor(spin.phase) % 4]);
		// Wobbling a little on its stand while it turns fast.
		fidget.image.setAngle(Math.sin(spin.phase * Math.PI * 2) * Math.min(1.6, spin.speed / 10));
	}

	// Particles.

	/** `count` little drawn things rising from the fidget, from `lift` of its height (0 its feet, 1 its top). */
	private burst(fidget: Fidget, particle: FidgetParticle, count: number, lift: number) {
		const [x, y] = fidget.slot.at;
		const top = y - this.height(fidget) * lift;
		const spread = Math.max(0.25, this.width(fidget) * 0.45);
		for (let i = 0; i < count; i++) {
			const image = this.scene.add
				.image((x + Phaser.Math.FloatBetween(-spread, spread)) * TILE, top * TILE, `overlay:fx-${particle}`)
				.setDepth(FX_DEPTH)
				.setScale(FX_PX * 0.6)
				.setAlpha(0);
			const soft = particle === "steam" || particle === "smoke";
			this.particles.set(image, fidget);
			this.scene.tweens.add({
				targets: image,
				y: image.y - Phaser.Math.FloatBetween(0.55, 0.95) * TILE,
				x: image.x + Phaser.Math.FloatBetween(-0.25, 0.25) * TILE,
				scale: FX_PX * (soft ? 1.6 : 1),
				alpha: { from: soft ? 0.7 : 1, to: 0 },
				delay: i * 150,
				duration: soft ? 1500 : 1150,
				ease: "Sine.out",
				onStart: () => image.setAlpha(soft ? 0.7 : 1),
				onComplete: () => {
					this.particles.delete(image);
					image.destroy();
				},
			});
		}
	}

	/** Every particle's little pixel sprite, drawn once per scene from a pattern in the pack's outline style. */
	private particleTextures() {
		for (const [name, { rows, colours }] of Object.entries(PATTERNS)) {
			const key = `overlay:fx-${name}`;
			if (this.scene.textures.exists(key)) continue;
			const canvas = document.createElement("canvas");
			canvas.width = rows[0].length;
			canvas.height = rows.length;
			const ctx = canvas.getContext("2d")!;
			rows.forEach((row, py) => {
				[...row].forEach((cell, px) => {
					const colour = colours[cell];
					if (!colour) return;
					ctx.fillStyle = colour;
					ctx.fillRect(px, py, 1, 1);
				});
			});
			this.scene.textures.addCanvas(key, canvas);
			this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
		}
	}

	views(): FidgetView[] {
		return this.fidgets.map((fidget) => ({
			index: fidget.index,
			kind: fidget.kind,
			name: fidget.name,
			x: fidget.slot.at[0],
			y: fidget.slot.at[1],
			w: this.width(fidget),
			// What it shows now, at its pixel size (a pet sitting up: its sitting height).
			h: (fidget.image.height * fidget.scale) / TILE,
			art: fidget.image.texture.key.replace(/^overlay:/, ""),
			look: fidget.slot.look ?? null,
			asleep: fidget.asleep,
			on: fidget.on,
			playing: fidget.playing,
			angle: fidget.image.angle,
			speed: fidget.spin.speed,
			particles: [...this.particles.values()].filter((owner) => owner === fidget).length,
			glow: fidget.glow ? fidget.glow.image.alpha : null,
			line: fidget.sign?.line ?? null,
			onFloor: fidget.onFloor,
		}));
	}
}

/**
 * Particles as pixel patterns: `K` the dark outline (a deep tone, never black), the rest their colours. Steam and
 * smoke are soft puffs.
 */
const PATTERNS: Record<FidgetParticle, { rows: string[]; colours: Record<string, string> }> = {
	hearts: {
		rows: [".KK...KK.", "KRRK.KRLK", "KRRRKRRLK", "KRRRRRRRK", ".KRRRRRK.", "..KRRRK..", "...KRK...", "....K...."],
		colours: { K: "#6e1a2c", R: "#e8466a", L: "#ffb3c4" },
	},
	notes: {
		rows: ["....KK..", "....KLK.", "....KKLK", "....K.KK", "....K...", ".KKKK...", "KNNNK...", "KNLNK...", ".KKK...."],
		colours: { K: "#2a1d3c", N: "#6a4fb0", L: "#c9b6ff" },
	},
	sparkles: {
		rows: ["...K...", "..KLK..", ".KLWLK.", "KLWWWLK", ".KLWLK.", "..KLK..", "...K..."],
		colours: { K: "#8a5a10", L: "#ffd34e", W: "#fffbe0" },
	},
	bubbles: {
		rows: [".KKKK.", "KWB..K", "KB...K", "K....K", "K...BK", ".KKKK."],
		colours: { K: "#3d7fb0", W: "#ffffff", B: "#bfe6ff" },
	},
	zzz: {
		rows: ["KKKKKK", "KWWWWK", "KKKWKK", ".KWKK.", "KWKKKK", "KWWWWK", "KKKKKK"],
		colours: { K: "#3c3566", W: "#e8e4ff" },
	},
	steam: {
		rows: ["..WW..", ".WWWW.", "WWWWWW", "WWWWWW", ".WWWW.", "..WW.."],
		colours: { W: "rgba(255,255,255,0.55)" },
	},
	smoke: {
		rows: ["..GG..", ".GGGG.", "GGGGGG", "GGGGGG", ".GGGG.", "..GG.."],
		colours: { G: "rgba(120,112,108,0.5)" },
	},
};
