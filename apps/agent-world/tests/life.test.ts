import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdleClock, type IdleName } from "../web/game/character-life.js";
import { findPath, gridFor } from "../web/game/pathing.js";
import { Wander, type WanderBody, type WanderHooks } from "../web/game/wander.js";
import type { PlaceData, Point } from "../web/theme.js";

// Life (tickets 06 and 07) as plain logic: the idle rhythm each character keeps, and wandering over a real place's
// data with walkers that walk their paths at walking speed. The built UI's side is in world-life.test.ts.
const themes = fileURLToPath(new URL("../themes/", import.meta.url));
const load = (id: string, name: string): PlaceData =>
	JSON.parse(readFileSync(`${themes}${id}/places/${name}.json`, "utf8"));
const FRAME = 16;

beforeAll(() => {
	(globalThis as any).agentWorldLife = { pace: 1 };
});
afterAll(() => {
	delete (globalThis as any).agentWorldLife;
});

describe("idles", () => {
	/** When each idle starts, over `ms` of standing, ticked a frame at a time. */
	const schedule = (seed: string, ms: number) => {
		const clock = new IdleClock(seed);
		const starts: { t: number; name: IdleName }[] = [];
		for (let t = 0; t < ms; t += FRAME) {
			const name = clock.tick(FRAME);
			if (name) starts.push({ t, name });
		}
		return starts;
	};

	it("come now and then at irregular intervals, never the same twice running", () => {
		const starts = schedule("agent-1", 10 * 60_000);
		expect(starts.length).toBeGreaterThan(20);
		expect(starts[0].t).toBeLessThan(12_000);
		const gaps = starts.slice(1).map((s, i) => s.t - starts[i].t);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(7000);
		expect(Math.max(...gaps)).toBeLessThanOrEqual(21_100);
		expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(5000);
		for (let i = 1; i < starts.length; i++) expect(starts[i].name).not.toBe(starts[i - 1].name);
		expect(new Set(starts.map((s) => s.name)).size).toBe(7);
	});

	it("keep each character's own rhythm: the same seed the same, neighbours never in step", () => {
		expect(schedule("orla", 120_000)).toEqual(schedule("orla", 120_000));
		const ids = ["docs", "tests", "solo", "orla", "C01", "C02", "C03", "host:square", "recruiter"];
		// Standing in one room: each idle plays about a second and a half, and nobody starts one another is playing.
		const clocks = ids.map((id) => new IdleClock(id));
		const playing = new Map<string, { name: IdleName; until: number }>();
		const starts: { id: string; t: number; name: IdleName }[] = [];
		for (let t = 0; t < 10 * 60_000; t += FRAME) {
			for (const [id, { until }] of playing) if (t >= until) playing.delete(id);
			const busy = new Set([...playing.values()].map((p) => p.name));
			clocks.forEach((clock, i) => {
				const name = clock.tick(FRAME, 1, busy);
				if (!name) return;
				starts.push({ id: ids[i], t, name });
				playing.set(ids[i], { name, until: t + 1500 });
				busy.add(name);
			});
		}
		for (const start of starts)
			expect(
				starts.some((o) => o.id !== start.id && o.name === start.name && Math.abs(o.t - start.t) < 1500),
				`${start.id} starts ${start.name} with a neighbour at ${start.t}`,
			).toBe(false);
		// And their rhythms differ: no two start their first idle at the same moment.
		const firsts = ids.map((id) => starts.find((s) => s.id === id)!.t);
		expect(new Set(firsts).size).toBe(ids.length);
	});

	it("are still when life is paused (pace 0)", () => {
		const clock = new IdleClock("still");
		for (let t = 0; t < 60_000; t += FRAME) expect(clock.tick(FRAME, 0)).toBeUndefined();
	});
});

/** A walker as wandering sees it: walks its path at walking speed, faces, and plays idles. */
class Body implements WanderBody {
	x: number;
	y: number;
	facing = "down";
	idles = 0;
	private path: Point[] = [];
	constructor([x, y]: Point) {
		this.x = x;
		this.y = y;
	}
	get moving() {
		return this.path.length > 0;
	}
	walk(path: Point[]) {
		this.path = path.slice(1);
	}
	face([x, y]: Point) {
		const dx = x - this.x;
		const dy = y - this.y;
		this.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
	}
	playIdle() {
		this.idles++;
		return true;
	}
	step(ms: number) {
		let budget = (3.3 * ms) / 1000;
		while (budget > 0 && this.path.length) {
			const [tx, ty] = this.path[0];
			const d = Math.hypot(tx - this.x, ty - this.y);
			if (d <= budget) {
				[this.x, this.y] = [tx, ty];
				budget -= d;
				this.path.shift();
			} else {
				this.x += ((tx - this.x) / d) * budget;
				this.y += ((ty - this.y) / d) * budget;
				budget = 0;
			}
		}
	}
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A place with wanderers in it, run frame by frame; `avatar` is where the operator's avatar stands. */
function world(place: PlaceData, avatar?: Point) {
	const bodies = new Map<string, { body: Body; home: Point }>();
	const hooks: WanderHooks = {
		place: () => place,
		footprints: () => [...bodies.values()].map(({ home }) => home),
		avatar: () => (state.avatar ? { at: state.avatar, goal: state.avatar } : undefined),
	};
	const state = { avatar, wander: new Wander(hooks) };
	return {
		state,
		add(id: string, kind: "townsfolk" | "agent" | "host", home: Point, may: () => boolean = () => true) {
			const body = new Body(home);
			bodies.set(id, { body, home });
			state.wander.add(id, kind, body, () => home, may);
			return body;
		},
		/** Run for `ms`, calling `each` after every frame. */
		run(ms: number, each?: (t: number) => void) {
			for (let t = 0; t < ms; t += FRAME) {
				state.wander.update(FRAME);
				for (const { body } of bodies.values()) body.step(FRAME);
				each?.(t);
			}
		},
	};
}

describe.each(["fantasy", "tech-office", "anime-school"])("wandering in %s", (id) => {
	const square = load(id, "square");
	const interest = square.interest ?? [];
	const doors = square.doors.map((door) => door.standAt);

	it("townsfolk stroll along walkable paths, pause only at points of interest, and come home", () => {
		const w = world(square, Object.values(square.entries)[0]);
		const folk = square.spots.slice(2).map((spot, i) => ({ spot, body: w.add(`C0${i}`, "townsfolk", spot) }));
		const grid = gridFor(square);
		const paused = new Set<string>();
		let away = 0;
		w.run(4 * 60_000, () => {
			for (const { spot, body } of folk) {
				const at: Point = [body.x, body.y];
				// Every step is on walkable floor.
				expect(grid.blocked[Math.floor(at[1] * 2) * grid.cols + Math.floor(at[0] * 2)], `${at}`).toBe(0);
				if (body.moving || dist(at, spot) < 0.05) continue;
				away++;
				const point = interest.find((p) => dist(p.at, at) < 0.05);
				expect(point, `resting at ${at}, not a point of interest`).toBeDefined();
				paused.add(point!.name);
				for (const door of doors) expect(dist(door, at)).toBeGreaterThanOrEqual(1);
			}
		});
		expect(away).toBeGreaterThan(0);
		expect(paused.size).toBeGreaterThanOrEqual(3);
		const views = w.state.wander.views();
		expect(views.length).toBe(folk.length);
	});

	it("an idle agent steps out and comes back; one at work or asking never leaves its spot", () => {
		const hq = load(id, "headquarters");
		const w = world(hq);
		let idle = true;
		const idler = w.add("solo", "agent", hq.spots[0], () => idle);
		const worker = w.add("busy", "agent", hq.spots[1], () => false);
		let left = -1;
		let back = -1;
		let again = -1;
		w.run(5 * 60_000, (t) => {
			expect([worker.x, worker.y]).toEqual(hq.spots[1]);
			const home = dist([idler.x, idler.y], hq.spots[0]) < 0.05;
			if (!home && left < 0) left = t;
			if (home && left >= 0 && back < 0 && !idler.moving) back = t;
			if (!home && back >= 0 && again < 0) again = t;
		});
		expect(left, "the idle agent left its spot").toBeGreaterThanOrEqual(0);
		expect(back - left, "and came back within a while").toBeLessThan(20_000);
		// Back home, it stays a good while before it goes out again.
		if (again >= 0) expect(again - back).toBeGreaterThanOrEqual(45_000);
		// Called to work while out: it heads straight back.
		w.run(5 * 60_000, () => {
			if (idle && dist([idler.x, idler.y], hq.spots[0]) > 0.3 && !idler.moving) idle = false;
		});
		expect(idle, "it went out again").toBe(false);
		let still = 0;
		w.run(20_000, () => {
			if (!idler.moving && dist([idler.x, idler.y], hq.spots[0]) < 0.05) still++;
		});
		expect(still).toBeGreaterThan(0);
		expect([idler.x, idler.y]).toEqual(hq.spots[0]);
	});

	it("gives way to the avatar: it goes home when the avatar comes near, and the avatar's path stays found", () => {
		const w = world(square);
		const body = w.add("C01", "townsfolk", square.spots[4]);
		let met = false;
		const after: string[] = [];
		w.run(6 * 60_000, () => {
			const avatar = w.state.avatar;
			if (met && avatar) {
				after.push(w.state.wander.view("C01").state);
				// From then on it never stops in the avatar's way.
				if (!body.moving) expect(dist([body.x, body.y], avatar)).toBeGreaterThanOrEqual(1.2);
			}
			if (met || body.moving || w.state.wander.view("C01").state !== "there") return;
			met = true;
			// The avatar walks up beside it: there is a way (wanderers never block the avatar's grid).
			const beside: Point = [body.x + 0.8, body.y];
			const grid = gridFor(square, [square.spots[4]]);
			const path = findPath(grid, Object.values(square.entries)[0], [beside]);
			expect(path).toBeDefined();
			w.state.avatar = path!.goal;
		});
		expect(met).toBe(true);
		expect(after[0]).toBe("back");
		expect(after).toContain("home");
	});

	it("a host shifts a little behind its counter and back", () => {
		const host = square.host!;
		const w = world(square);
		const body = w.add("host", "host", host.at);
		let furthest = 0;
		w.run(3 * 60_000, () => {
			furthest = Math.max(furthest, dist([body.x, body.y], host.at));
		});
		expect(furthest).toBeGreaterThan(0.3);
		expect(furthest).toBeLessThanOrEqual(0.56);
	});
});
