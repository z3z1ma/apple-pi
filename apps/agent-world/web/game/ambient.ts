// Ambient characters (ticket 08): each pack's cast of people who are there only for fun and immersion (a bard, a
// sleepy guard, a barista, a lunch lady), written in its manifest (`theme.json`'s `ambient`) and placed in its places'
// data (`PlaceData.ambient`). They stand about with the world's own life (idles, and strolls to the place's points of
// interest unless posted), answer the pointer like anyone else (Talk to, Examine), say their lines in turn in the small
// dialogue box, react when clicked several times in a row, and now and then say something to nobody in a speech
// bubble. They are presentation only: nothing here sends a command or calls anything outside the page.
import type * as Phaser from "phaser";
import type { AmbientMember, AmbientPlacement } from "../../src/theme-pack.js";
import type { PlaceData, Point } from "../theme.js";
import { TILE } from "../theme.js";
import { worn } from "../theme-store.js";
import { action, type Target } from "./actions.js";
import { type BarkShape, drawBark, lifePace, seeded } from "./character-life.js";
import { PERSON_TILES, Walker } from "./walker.js";
import type { Wander, WanderView } from "./wander.js";

/** Clicks on a cast member each within this long of the one before (ms) count as clicking it again and again. */
export const STREAK_MS = 1500;
/** The click in a row that gets a reaction instead of its next line (and every click in the row after it). */
export const REACT_AFTER = 3;
/** A bark comes this long after the place opens (ms of life), then one every so often, and lasts this long (ms). */
const FIRST_BARK = [9000, 32_000] as const;
const BARK_EVERY = [35_000, 80_000] as const;
const BARK_MS = 4200;
/** A bark that has no room now tries again this much later (ms of life). */
const BARK_RETRY = 4000;
const BARK_FADE_MS = 320;
const BARK_RISE = 5;
const BARK_MARGIN = 6;
/** Where a bark's tail points, in tiles above the feet (just over the head, as an agent's bark). */
const BARK_LIFT = 2.12;
const STANDING = 120;

/** Where each cast member is in its lines and reactions, per theme and cast name, for as long as the app runs. */
type Said = { line: number; reaction: number };
const said = new Map<string, Said>();

/**
 * What a cast member says next: its lines in turn, round and round (remembered across visits), and one of its
 * reactions once it has been clicked `REACT_AFTER` times in a row. Clicks are counted as they are made (`click`), even
 * while the avatar is still walking up, and what to say is chosen when it arrives (`next`).
 */
export class Patter {
	private readonly key: string;
	private readonly member: Pick<AmbientMember, "lines" | "reactions">;
	private readonly memory: Map<string, Said>;
	private streak = 0;
	private last = Number.NEGATIVE_INFINITY;

	constructor(key: string, member: Pick<AmbientMember, "lines" | "reactions">, memory: Map<string, Said> = said) {
		this.key = key;
		this.member = member;
		this.memory = memory;
	}

	/** The operator clicked Talk to at `now` (ms). */
	click(now: number) {
		this.streak = now - this.last <= STREAK_MS ? this.streak + 1 : 1;
		this.last = now;
	}

	next(): { line: string; reaction: boolean } {
		const at = this.memory.get(this.key) ?? { line: 0, reaction: 0 };
		this.memory.set(this.key, at);
		const { lines, reactions } = this.member;
		if (this.streak >= REACT_AFTER && reactions.length)
			return { line: reactions[at.reaction++ % reactions.length], reaction: true };
		return { line: lines[at.line++ % lines.length], reaction: false };
	}
}

/** A bark's bubble on screen, in CSS px. */
export interface ScreenBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** What the scene gives its cast. */
export interface AmbientHooks {
	place(): PlaceData;
	/** Walk up to whoever stands at `at`, then act. */
	approach(at: Point, then: () => void): void;
	/** Show a line in the small dialogue box. */
	notify(text: string): void;
	/** Where the avatar is. */
	avatar(): Point | undefined;
	/** A point in tiles, on screen in CSS px; and the camera's zoom. */
	toScreen(at: Point): Point;
	zoom(): number;
	/** The screen's size, and whether a box on it is covered by the interface or by another bark. */
	screen(): { width: number; height: number };
	covered(box: ScreenBox): boolean;
	/** The place's wandering: those not posted stroll between its points of interest and come back. */
	wander?: Wander;
}

export interface AmbientView {
	/** Its cast name in the pack (`bard`). */
	id: string;
	name: string;
	look: string;
	x: number;
	y: number;
	moving: boolean;
	idle: string | null;
	/** Where it is in a stroll (always home when posted). */
	wander: WanderView["state"];
	interest: string | null;
	/** The bark showing over its head. */
	bark: string | null;
	/** Where it belongs. */
	home: Point;
	stays: boolean;
}

interface Bark {
	line: string;
	shape: BarkShape;
	/** Ms of the bark left before it fades, how much of it shows, and whether it is going. */
	left: number;
	shown: number;
	going: boolean;
}

interface Member {
	id: string;
	member: AmbientMember;
	placement: AmbientPlacement;
	walker: Walker;
	patter: Patter;
	random: () => number;
	/** Ms of life until it barks next. */
	nextBark: number;
	barks: number;
	bark?: Bark;
}

/** The cast standing in one place; the scene owns one while it shows the place. */
export class AmbientCast {
	private readonly scene: Phaser.Scene;
	private readonly hooks: AmbientHooks;
	private readonly members: Member[] = [];

	constructor(scene: Phaser.Scene, hooks: AmbientHooks) {
		this.scene = scene;
		this.hooks = hooks;
		const theme = worn();
		const cast = theme.ambient ?? {};
		for (const placement of hooks.place().ambient ?? []) {
			const member = cast[placement.cast];
			const look = member && theme.looks[member.look];
			if (!member || !look) continue;
			const walker = new Walker(scene, member.look, look, placement.at, placement.face ?? "down");
			const id = placement.cast;
			const random = seeded(`ambient:${theme.id}:${id}`);
			const one: Member = {
				id,
				member,
				placement,
				walker,
				patter: new Patter(`${theme.id}:${id}`, member),
				random,
				nextBark: between(random, FIRST_BARK),
				barks: 0,
			};
			this.members.push(one);
			// Standing about it idles now and then; unless posted, it strolls to the place's points of interest (06, 07).
			walker.live(`ambient:${id}`);
			if (!placement.stay) hooks.wander?.add(`ambient:${id}`, "townsfolk", walker, () => placement.at);
		}
	}

	/** Where the cast belongs: the avatar and everyone else walk round them, as round anyone at their spot. */
	occupied(): Point[] {
		return this.members.map(({ placement }) => placement.at);
	}

	update(delta: number, ui: number) {
		const life = Math.min(delta, 100) * lifePace();
		for (const one of this.members) {
			one.walker.update(delta);
			this.liveBark(one, delta, life, ui);
		}
	}

	/** Cast members under a point, front first, with what can be done with each. */
	targetsAt([x, y]: Point): Target[] {
		const scale = (PERSON_TILES * TILE) / STANDING / TILE;
		return this.members
			.filter(({ walker }) => {
				const half = Math.min(0.42, (walker.sprite.width * scale) / 2);
				return Math.abs(x - walker.x) <= half && y >= walker.y - PERSON_TILES * 0.97 && y <= walker.y + 0.15;
			})
			.sort((a, b) => b.walker.y - a.walker.y)
			.map((one) => this.target(one));
	}

	views(): AmbientView[] {
		return this.members.map(({ id, member, placement, walker, bark }) => {
			const wander = this.hooks.wander?.view(`ambient:${id}`);
			return {
				id,
				name: member.name,
				look: member.look,
				x: walker.x,
				y: walker.y,
				moving: walker.moving,
				idle: walker.view().idle,
				wander: placement.stay ? "home" : (wander?.state ?? "home"),
				interest: placement.stay ? null : (wander?.interest ?? null),
				bark: bark && !bark.going ? bark.line : null,
				home: placement.at,
				stays: !!placement.stay,
			};
		});
	}

	/** Where the cast's barks are on screen, so the agents' barks keep clear of them. */
	barkBoxes(): ScreenBox[] {
		return this.members.flatMap((one) => {
			const box = one.bark && one.bark.shown > 0 ? this.barkBox(one, one.bark.shape) : undefined;
			return box ? [box] : [];
		});
	}

	destroy() {
		for (const one of this.members) {
			this.hooks.wander?.remove(`ambient:${one.id}`);
			one.bark?.shape.container.destroy();
			one.walker.destroy();
		}
		this.members.length = 0;
	}

	private target(one: Member): Target {
		const { name, examine } = one.member;
		return {
			name,
			tone: "character",
			actions: [
				action("Talk to", () => this.talk(one), name, "character"),
				action("Examine", () => this.hooks.notify(examine), name, "character"),
			],
		};
	}

	/** Walk up and hear its next line (or, clicked again and again, its reaction). */
	private talk(one: Member) {
		one.patter.click(this.scene.time.now);
		this.hooks.approach(one.placement.at, () => this.say(one));
	}

	private say(one: Member) {
		const { line, reaction } = one.patter.next();
		this.hooks.notify(`${one.member.name}: \u201c${line}\u201d`);
		const { walker } = one;
		if (walker.moving) return;
		if (reaction) {
			// Pestered, it turns to the room and shows it: a shrug, a laugh, the guard's yawn.
			walker.face([walker.x, walker.y + 1]);
			walker.playIdle(one.member.gesture ?? "shrug");
			return;
		}
		const avatar = this.hooks.avatar();
		if (avatar) walker.face(avatar);
	}

	/**
	 * Now and then, standing still, it says one of its barks to nobody in a speech bubble over its head, where the bubble
	 * has room on screen (clear of the interface and of other barks), one cast member at a time.
	 */
	private liveBark(one: Member, delta: number, life: number, ui: number) {
		const { walker } = one;
		const anchor: Point = [walker.x, walker.y - BARK_LIFT - (2 * ui) / TILE];
		const bark = one.bark;
		if (bark) {
			bark.left -= delta;
			if (bark.left <= 0 || walker.moving) bark.going = true;
			const step = Math.min(delta, 100) / BARK_FADE_MS;
			const box = this.barkBox(one, bark.shape, false);
			const room = !bark.going && !!box && !this.hooks.covered(box);
			bark.shown = Math.max(0, Math.min(1, bark.shown + (room ? step : -step)));
			if (bark.going && bark.shown <= 0) {
				bark.shape.container.destroy();
				one.bark = undefined;
				return;
			}
			const eased = 0.5 - Math.cos(Math.PI * bark.shown) / 2;
			bark.shape.container
				.setPosition(anchor[0] * TILE, anchor[1] * TILE - BARK_RISE * (1 - eased) * ui)
				.setDepth(1e5 + walker.y + 0.5)
				.setScale(ui)
				.setAlpha(eased * walker.sprite.alpha);
			return;
		}
		const lines = one.member.barks ?? [];
		if (!lines.length || life <= 0) return;
		one.nextBark -= life;
		if (one.nextBark > 0) return;
		if (walker.moving || this.members.some((other) => other.bark)) {
			one.nextBark = BARK_RETRY;
			return;
		}
		const line = lines[one.barks % lines.length];
		const shape = drawBark(this.scene, line);
		shape.container.setAlpha(0).setScale(ui);
		shape.container.setPosition(anchor[0] * TILE, anchor[1] * TILE);
		const box = this.barkBox(one, shape);
		if (!box || this.hooks.covered(box)) {
			shape.container.destroy();
			one.nextBark = BARK_RETRY;
			return;
		}
		one.barks++;
		one.bark = { line, shape, left: BARK_MS, shown: 0, going: false };
		one.nextBark = between(one.random, BARK_EVERY);
	}

	/** A bark's bubble on screen over its speaker's head (with its margin, unless asked without); none off screen. */
	private barkBox(one: Member, shape: BarkShape, margin = true): ScreenBox | undefined {
		const { walker } = one;
		const ui = shape.container.scaleX || 1;
		const scale = ui * this.hooks.zoom();
		const [sx, sy] = this.hooks.toScreen([walker.x, walker.y - BARK_LIFT - (2 * ui) / TILE]);
		const pad = margin ? BARK_MARGIN : 0;
		const box = {
			left: sx - (shape.width / 2) * scale - pad,
			top: sy - (shape.height + BARK_RISE) * scale - pad,
			right: sx + (shape.width / 2) * scale + pad,
			bottom: sy + pad,
		};
		const { width, height } = this.hooks.screen();
		// Off screen, nobody hears it.
		return box.left < 0 || box.top < 0 || box.right > width || box.bottom > height ? undefined : box;
	}
}

const between = (random: () => number, [least, most]: readonly [number, number]) => least + random() * (most - least);
