import type * as Phaser from "phaser";
import type { AmbientMember, AmbientPlacement } from "../../src/theme-pack.js";
import type { PlaceData, Point } from "../theme.js";
import { TILE } from "../theme.js";
import { worn } from "../theme-store.js";
import { action, type Target } from "./actions.js";
import { type BarkShape, drawBark, lifePace, seeded } from "./character-life.js";
import { PERSON_TILES, Walker } from "./walker.js";
import type { Wander, WanderView } from "./wander.js";

export const STREAK_MS = 1500;

export const REACT_AFTER = 3;

const FIRST_BARK = [9000, 32_000] as const;
const BARK_EVERY = [35_000, 80_000] as const;
const BARK_MS = 4200;

const BARK_RETRY = 4000;
const BARK_FADE_MS = 320;
const BARK_RISE = 5;
const BARK_MARGIN = 6;

const BARK_LIFT = 2.12;
const STANDING = 120;

type Said = { line: number; reaction: number };
const said = new Map<string, Said>();

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

export interface ScreenBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface AmbientHooks {
	place(): PlaceData;

	approach(at: Point, then: () => void): void;

	notify(text: string): void;

	avatar(): Point | undefined;

	toScreen(at: Point): Point;
	zoom(): number;

	screen(): { width: number; height: number };
	covered(box: ScreenBox): boolean;

	wander?: Wander;
}

export interface AmbientView {
	id: string;
	name: string;
	look: string;
	x: number;
	y: number;
	moving: boolean;
	idle: string | null;

	wander: WanderView["state"];
	interest: string | null;

	bark: string | null;

	home: Point;
	stays: boolean;
}

interface Bark {
	line: string;
	shape: BarkShape;

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

	nextBark: number;
	barks: number;
	bark?: Bark;
}

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

			walker.live(`ambient:${id}`);
			if (!placement.stay) hooks.wander?.add(`ambient:${id}`, "townsfolk", walker, () => placement.at);
		}
	}

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
			walker.face([walker.x, walker.y + 1]);
			walker.playIdle(one.member.gesture ?? "shrug");
			return;
		}
		const avatar = this.hooks.avatar();
		if (avatar) walker.face(avatar);
	}

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

		return box.left < 0 || box.top < 0 || box.right > width || box.bottom > height ? undefined : box;
	}
}

const between = (random: () => number, [least, most]: readonly [number, number]) => least + random() * (most - least);
