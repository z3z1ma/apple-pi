// Wandering (ticket 07): characters standing about move a little on their own. Townsfolk stroll between the place's
// points of interest (a stall, the fountain, a bench) and pause there; an idle agent now and then gets up, takes a few
// steps to a point of interest nearby (a window, a shelf), and comes back to its spot; a host shifts a little behind
// its counter. Everyone walks with the shared walker and pathing, pauses only at points the pack check keeps off doors'
// stand points, and gives way to the avatar. Those at work or asking never leave their spot: the scene says who may.
import type { PlaceData, Point } from "../theme.js";
import { type IdleName, lifePace, seeded } from "./character-life.js";
import { findPath, gridFor, isOpen, pathLength } from "./pathing.js";
import type { Facing } from "./walker.js";

/** What wandering needs of a walker (the scene's `Walker`). */
export interface WanderBody {
	readonly x: number;
	readonly y: number;
	readonly moving: boolean;
	walk(path: Point[], then?: () => void): void;
	face(point: Point): void;
	playIdle(name?: IdleName): boolean;
}

/** Townsfolk stroll the place; agents step out to somewhere near and back; hosts shift behind their counter. */
export type WanderKind = "townsfolk" | "agent" | "host";

/** Where a wanderer is in its outing: at home (its spot), walking out, pausing there, or walking back. */
export type WanderState = "home" | "out" | "there" | "back";

export interface WanderView {
	id: string;
	kind: WanderKind;
	state: WanderState;
	/** The point of interest it is walking to or pausing at (a host's shift has none). */
	interest: string | null;
}

/** What the scene gives wandering. */
export interface WanderHooks {
	place(): PlaceData;
	/** Where others stand (their spots, the host, townsfolk, floor fidgets): walked round, never stopped on. */
	footprints(): Point[];
	/** Where the avatar is and where its walk ends, when it is in the place. */
	avatar(): { at: Point; goal: Point } | undefined;
}

interface Timing {
	/** The first outing comes this long after it is first home (ms), then one every so often. */
	first: readonly [number, number];
	every: readonly [number, number];
	/** How long it pauses where it went (ms). */
	pause: readonly [number, number];
	/** How far it goes (tiles, as the crow flies), and the chance it goes on to another point before going home. */
	reach: number;
	onward: number;
}

const TIMING: Record<WanderKind, Timing> = {
	townsfolk: { first: [5000, 22_000], every: [14_000, 40_000], pause: [4000, 9000], reach: 16, onward: 0.4 },
	agent: { first: [18_000, 60_000], every: [45_000, 120_000], pause: [3500, 7500], reach: 9, onward: 0 },
	host: { first: [7000, 26_000], every: [14_000, 36_000], pause: [2500, 6000], reach: 0.6, onward: 0 },
};
/** A host's shift: this far to one side behind its counter (tiles). */
const SHIFT = [0.4, 0.55] as const;
/** The avatar this close to a wanderer (or ending its walk this close) sends it home: it never stands in the way. */
const GIVE_WAY = 1.2;
/** Points of interest this close to someone else out wandering are taken. */
const TAKEN = 1.1;
/** After the operator walks up to someone, it stays home at least this long (ms). */
const STAY_HOME_MS = 30_000;
const AT = 0.05;

interface Wanderer {
	id: string;
	kind: WanderKind;
	body: WanderBody;
	home: () => Point | undefined;
	may: () => boolean;
	random: () => number;
	state: WanderState;
	/** Until the next outing, in ms of life (counted at home). */
	wait: number;
	/** How long its pause where it went is, and how much of it is left. */
	pause: number;
	left: number;
	turned: boolean;
	target?: { name: string | null; at: Point; face?: Facing };
	visits: number;
}

const near = (a: Point, b: Point, within: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < within;

/** The wanderers of one place; the scene owns one for as long as it shows the place. */
export class Wander {
	private readonly hooks: WanderHooks;
	private readonly wanderers = new Map<string, Wanderer>();

	constructor(hooks: WanderHooks) {
		this.hooks = hooks;
	}

	/**
	 * Let `body` wander: `home` is where it belongs (undefined once it is leaving the place), and `may` says whether it
	 * may go out now (standing about, not at work, not asking). Seeded by `id`, so each has its own rhythm.
	 */
	add(id: string, kind: WanderKind, body: WanderBody, home: () => Point | undefined, may: () => boolean = () => true) {
		const random = seeded(`wander:${id}`);
		const wanderer: Wanderer = {
			id,
			kind,
			body,
			home,
			may,
			random,
			state: "home",
			wait: 0,
			pause: 0,
			left: 0,
			turned: false,
			visits: 0,
		};
		wanderer.wait = this.between(wanderer, TIMING[kind].first);
		this.wanderers.set(id, wanderer);
	}

	remove(id: string) {
		this.wanderers.delete(id);
	}

	/** The operator walks up to whoever belongs at `at`: it goes home (if out) and stays there a while. */
	recall(at: Point) {
		for (const wanderer of this.wanderers.values()) {
			const home = wanderer.home();
			if (!home || !near(home, at, AT)) continue;
			wanderer.wait = Math.max(wanderer.wait, STAY_HOME_MS);
			if (wanderer.state !== "home") this.goHome(wanderer, home);
		}
	}

	update(deltaMs: number) {
		const life = Math.min(deltaMs, 100) * lifePace();
		for (const wanderer of this.wanderers.values()) this.live(wanderer, life);
	}

	views(): WanderView[] {
		return [...this.wanderers.values()].map((w) => this.view(w));
	}

	view(id: string | Wanderer): WanderView {
		const w = typeof id === "string" ? this.wanderers.get(id) : id;
		if (!w) return { id: String(id), kind: "agent", state: "home", interest: null };
		return { id: w.id, kind: w.kind, state: w.state, interest: w.state === "home" ? null : (w.target?.name ?? null) };
	}

	private live(w: Wanderer, life: number) {
		const home = w.home();
		if (!home) return;
		const { body } = w;
		const at: Point = [body.x, body.y];
		// Called to work (or to answer): straight home.
		if (w.state !== "home" && w.state !== "back" && !w.may()) return this.goHome(w, home);
		switch (w.state) {
			case "home": {
				if (body.moving) return;
				w.wait -= life;
				if (w.wait > 0) return;
				w.wait = this.between(w, TIMING[w.kind].every);
				if (w.may() && near(at, home, AT)) this.setOut(w, home);
				return;
			}
			case "out": {
				if (body.moving) {
					// The avatar is walking to where it is going: it turns back instead.
					const avatar = this.hooks.avatar();
					if (avatar && w.target && near(avatar.goal, w.target.at, GIVE_WAY)) this.goHome(w, home);
					return;
				}
				if (w.target && near(at, w.target.at, AT)) return this.arrive(w);
				return this.goHome(w, home);
			}
			case "there": {
				if (body.moving) {
					w.state = "back";
					return;
				}
				const avatar = this.hooks.avatar();
				if (avatar && (near(avatar.at, at, GIVE_WAY) || near(avatar.goal, at, GIVE_WAY))) return this.goHome(w, home);
				w.left -= life;
				// Halfway through a pause spent looking at something, it turns back to the room and idles.
				if (!w.turned && w.left < w.pause / 2) {
					w.turned = true;
					if (w.target?.face && w.target.face !== "down") {
						body.face([at[0], at[1] + 1]);
						body.playIdle();
					}
				}
				if (w.left > 0) return;
				if (w.kind === "townsfolk" && w.visits < 3 && w.random() < TIMING[w.kind].onward && w.may())
					return this.setOut(w, home, at);
				return this.goHome(w, home);
			}
			case "back": {
				if (body.moving) return;
				if (near(at, home, AT)) {
					w.state = "home";
					w.target = undefined;
					w.visits = 0;
					// The next outing is a good while after it is back, however long this one took.
					w.wait = Math.max(w.wait, this.between(w, TIMING[w.kind].every));
					body.face([home[0], home[1] + 1]);
					return;
				}
				return this.goHome(w, home);
			}
		}
	}

	/** Set off to a point of interest (or, for a host, a step to one side), from home or from the last point. */
	private setOut(w: Wanderer, home: Point, from: Point = home) {
		const target = w.kind === "host" ? this.shift(w, home) : this.pick(w, home, from);
		if (!target) return;
		const path = w.kind === "host" ? [from, target.at] : this.pathFor(w, from, target.at, home, true);
		if (!path) return;
		w.target = target;
		w.state = "out";
		w.visits++;
		w.body.walk(path);
	}

	private arrive(w: Wanderer) {
		const { body, target } = w;
		w.state = "there";
		w.pause = this.between(w, TIMING[w.kind].pause);
		w.left = w.pause;
		w.turned = false;
		const face = target?.face ?? "down";
		const [x, y] = [body.x, body.y];
		const step: Record<Facing, Point> = { up: [x, y - 1], down: [x, y + 1], left: [x - 1, y], right: [x + 1, y] };
		body.face(step[face]);
		if (face === "down") body.playIdle();
	}

	private goHome(w: Wanderer, home: Point) {
		const { body } = w;
		const at: Point = [body.x, body.y];
		w.target = undefined;
		if (near(at, home, AT) && !body.moving) {
			w.state = "home";
			w.visits = 0;
			return;
		}
		w.state = "back";
		body.walk((w.kind !== "host" && this.pathFor(w, at, home, home, false)) || [at, home]);
	}

	/** A point of interest to go to: near enough, not taken by another wanderer, and out of the avatar's way. */
	private pick(w: Wanderer, home: Point, from: Point): Wanderer["target"] {
		const reach = TIMING[w.kind].reach;
		const avatar = this.hooks.avatar();
		const taken = [...this.wanderers.values()]
			.filter((other) => other !== w && other.state !== "home")
			.flatMap((other) => [other.target?.at, [other.body.x, other.body.y] as Point].filter((p): p is Point => !!p));
		const choices = (this.hooks.place().interest ?? []).filter(
			({ at }) =>
				near(at, home, reach) &&
				!near(at, from, 1) &&
				!taken.some((point) => near(point, at, TAKEN)) &&
				!(avatar && (near(avatar.at, at, GIVE_WAY + 0.3) || near(avatar.goal, at, GIVE_WAY + 0.3))),
		);
		if (!choices.length) return undefined;
		// Nearer points more often: an agent steps to the window beside it more than across the room.
		const weights = choices.map(({ at }) => 1 / (1 + Math.hypot(at[0] - from[0], at[1] - from[1]) / 4));
		let roll = w.random() * weights.reduce((a, b) => a + b, 0);
		let index = 0;
		while (index < choices.length - 1 && roll > weights[index]) roll -= weights[index++];
		const { name, at, face } = choices[index];
		return { name, at, face };
	}

	/**
	 * A host's step to one side of its post, behind its counter: a straight step along floor like its post's (a post
	 * traced inside the counter's footprint steps within it), never onto a door's stand point.
	 */
	private shift(w: Wanderer, home: Point): Wanderer["target"] {
		const place = this.hooks.place();
		const grid = gridFor(place);
		const open = isOpen(grid, home);
		const side = w.random() < 0.5 ? -1 : 1;
		const reach = SHIFT[0] + w.random() * (SHIFT[1] - SHIFT[0]);
		for (const dx of [side * reach, -side * reach]) {
			const at: Point = [home[0] + dx, home[1]];
			const alike = [0.25, 0.5, 0.75, 1].every((t) => isOpen(grid, [home[0] + dx * t, home[1]]) === open);
			if (alike && at[0] > 0.3 && at[0] < place.cols - 0.3 && !place.doors.some((d) => near(d.standAt, at, 1)))
				return { name: null, at };
		}
		return undefined;
	}

	/** A walk from `from` to `to` round everyone else, or none when it does not get there in a short way. */
	private pathFor(w: Wanderer, from: Point, to: Point, home: Point, short: boolean): Point[] | undefined {
		const others = this.hooks.footprints().filter((point) => !near(point, home, AT) && !near(point, to, AT));
		const path = findPath(gridFor(this.hooks.place(), others), from, [to]);
		if (!path || !near(path.goal, to, AT)) return undefined;
		const points = near(path.points.at(-1)!, to, 1e-3) ? path.points : [...path.points, to];
		return !short || pathLength(points) <= Math.max(3, TIMING[w.kind].reach * 2.2) ? points : undefined;
	}

	private between(w: Wanderer, [least, most]: readonly [number, number]): number {
		return least + w.random() * (most - least);
	}
}
