import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { SlackChannel } from "../src/integrations.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import type { PlaceData, Point } from "../web/theme.js";

// Seam 2 for life in the places (tickets 06 and 07): the committed, built world UI in headless Chrome over a fixture
// backend, with life sped up (`window.agentWorldLife`). Standing characters idle now and then, never in step; townsfolk
// stroll between the square's points of interest; an idle agent steps out and back while a working one stays; the host
// shifts behind its counter; and nobody pauses on a door's stand point or keeps the avatar from its way.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-life-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
const placeOf = (theme: string, name: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${theme}/places/${name}.json`, import.meta.url)), "utf8"));
/** How much faster than life (idles, outings, pauses); walking keeps its speed. */
const PACE = 10;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
}, 30_000);
afterAll(() => browser?.close());

const NOW = Date.now();
const facts = (over: Partial<CharacterFacts> = {}): CharacterFacts => ({
	run: "idle",
	status: "idle",
	asking: null,
	needsYouSince: null,
	unseen: false,
	seenAt: null,
	settledAt: null,
	tool: null,
	task: null,
	git: null,
	cwd: "/Users/op/code/apple-pi",
	reportsTo: null,
	model: "claude-opus-4",
	contextTokens: 48_000,
	contextWindow: 200_000,
	cost: 0.42,
	tmux: null,
	...over,
});
const independent = (id: string, n: number, over: Partial<CharacterFacts> = {}): Character => ({
	id,
	name: id[0].toUpperCase() + id.slice(1),
	role: "independent",
	place: { kind: "square" },
	startedAt: NOW - 8_000_000 + n,
	facts: facts(over),
});
const WREN = independent("wren", 1);
const BRAM = independent("bram", 2, { run: "running_tool", status: "working" });
const IVY = independent("ivy", 3, { status: "asking", asking: { kind: "question", text: "Which branch?" } });
const world = (theme: string, characters = [WREN, BRAM, IVY]): WorldSnapshot =>
	({ connected: true, headquarters: [], characters, dormant: [], mail: [], theme }) as WorldSnapshot;
const channel = (id: string, name: string, unread: number): SlackChannel => ({
	id,
	name,
	kind: "channel",
	unread,
	more: false,
	mentions: 0,
	latest: `${Math.floor(NOW / 1000) - unread * 60}.000100`,
	url: null,
});
const UNREAD = ["general", "deploys", "design", "random", "support"].map((name, i) =>
	channel(`C0${name.toUpperCase()}`, name, i + 2),
);

async function openWorld(first: WorldSnapshot, pace = PACE) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(appDir, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		([snapshot, unread, speed]) => {
			const w = window as any;
			w.agentWorldLife = { pace: speed };
			const listeners = new Set<(s: unknown) => void>();
			let current = snapshot;
			const account = { team: "Acme", url: "https://acme.slack.com/", user: "op" };
			w.agentWorld = {
				snapshot: async () => current,
				onUpdate(listener: (s: unknown) => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				feed: async () => [],
				onFeed: () => () => {},
				goToTerminal: async () => ({ ok: true }),
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
				setAvatarLook: async () => ({ ok: true }),
				onReceipt: () => () => {},
				watchReplies: async () => {},
				onReply: () => () => {},
				credentialStatus: async () => ({ atlassian: null, slack: account }),
				slackUnread: async () => ({ ok: true, channels: unread }),
				outsideWrites: async () => [],
				onOutsideWrite: () => () => {},
			};
			w.pushSnapshot = (next: unknown) => {
				current = next as typeof snapshot;
				for (const listener of listeners) listener(next);
			};
		},
		[first, UNREAD, pace] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(500);
	return { page, errors };
}

interface Walking {
	x: number;
	y: number;
	moving: boolean;
	idle: string | null;
}
interface FigureView extends Walking {
	id: string;
	pose: string;
	frame: number;
	wander: string;
	interest: string | null;
}
interface FolkView extends Walking {
	id: string;
}
interface Sample {
	t: number;
	figures: FigureView[];
	folk: FolkView[];
	host: (Walking & { look: string }) | undefined;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const sample = (page: Page): Promise<Omit<Sample, "t">> =>
	page.evaluate(() => {
		const v = (window as any).agentWorldView;
		return { figures: v.figures(), folk: v.townsfolk(), host: v.host() };
	});
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;

async function closeup(page: Page, name: string, [x, y]: Point) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.addStyleTag({ content: ".aw-interface { visibility: hidden; }" });
	const [sx, sy] = await screen(page, x, y);
	const clip = { x: Math.max(0, sx - 220), y: Math.max(0, sy - 200), width: 440, height: 260 };
	await page.screenshot({ path: join(SHOTS, `${name}.png`), clip, animations: "disabled" });
	await page.addStyleTag({ content: ".aw-interface { visibility: visible; }" });
}

describe.each(THEMES)("%s", (theme) => {
	const square = placeOf(theme, "square");
	const interest = square.interest ?? [];
	const doors = square.doors.map((door) => door.standAt);

	test("in the square, life goes on: idles never in step, strolls to points of interest, work stays put", {
		timeout: 90_000,
	}, async () => {
		const { page, errors } = await openWorld(world(theme));
		try {
			await vi.waitFor(async () => expect((await view<FolkView[]>(page, "townsfolk()")).length).toBe(5), {
				timeout: 8000,
			});
			// Agents hold the first spots in the order they started; townsfolk stand on spots too (any of the rest).
			const homes = new Map<string, Point>([
				["wren", square.spots[0]],
				["bram", square.spots[1]],
				["ivy", square.spots[2]],
			]);
			const atSpot = (at: Point) => square.spots.some((spot) => dist(spot, at) < 0.05);
			const hostHome = square.host!.at;
			const samples: Sample[] = [];
			const start = Date.now();
			let shotIdle = false;
			let shotStroll = false;
			while (Date.now() - start < 24_000) {
				samples.push({ t: Date.now() - start, ...(await sample(page)) });
				const last = samples.at(-1)!;
				const idler = [...last.folk, ...last.figures].find((f) => f.idle && !f.moving);
				if (!shotIdle && idler) {
					shotIdle = true;
					await closeup(page, `aw-life-${theme}-idle`, [idler.x, idler.y]);
				}
				const paused = last.folk.find((f) => !f.moving && !atSpot([f.x, f.y]));
				if (!shotStroll && paused && samples.length > 30) {
					shotStroll = true;
					await closeup(page, `aw-life-${theme}-stroll`, [paused.x, paused.y]);
				}
				await page.waitForTimeout(90);
			}

			// Idles: several play, and at no moment do two characters play the same one.
			const idles = new Set<string>();
			for (const { figures, folk, host } of samples) {
				const playing = [...figures, ...folk, ...(host ? [host] : [])].map((w) => w.idle).filter((i) => i);
				expect(new Set(playing).size, `two play the same idle: ${playing}`).toBe(playing.length);
				for (const name of playing) idles.add(name!);
			}
			expect(idles.size).toBeGreaterThanOrEqual(3);
			// Working and asking keep their poses and their spots; their frames are the working and asking ones.
			for (const { figures } of samples) {
				const bram = figures.find((f) => f.id === "bram")!;
				const ivy = figures.find((f) => f.id === "ivy")!;
				expect([bram.x, bram.y]).toEqual(homes.get("bram"));
				expect([ivy.x, ivy.y]).toEqual(homes.get("ivy"));
				expect(bram).toMatchObject({ pose: "busy", idle: null, wander: "home" });
				expect(ivy).toMatchObject({ pose: "asking", frame: 15, idle: null, wander: "home" });
			}
			// Townsfolk stroll: they leave their spots, pause only at points of interest, and never on a doorstep.
			const visited = new Set<string>();
			for (const { folk } of samples)
				for (const f of folk) {
					const at: Point = [f.x, f.y];
					if (f.moving || atSpot(at)) continue;
					const point = interest.find((p) => dist(p.at, at) < 0.05);
					expect(point, `${f.id} rests at ${at}, which is no point of interest`).toBeDefined();
					visited.add(point!.name);
					for (const door of doors) expect(dist(door, at)).toBeGreaterThanOrEqual(1);
				}
			expect(visited.size).toBeGreaterThanOrEqual(2);
			// The idle agent steps out and comes back.
			const wren = samples.map((s) => s.figures.find((f) => f.id === "wren")!);
			const out = wren.findIndex((f) => dist([f.x, f.y], homes.get("wren")!) > 0.3);
			expect(out, "Wren leaves her spot").toBeGreaterThanOrEqual(0);
			expect(
				wren.slice(out).some((f) => !f.moving && dist([f.x, f.y], homes.get("wren")!) < 0.05),
				`and comes back: ${JSON.stringify(
					wren
						.slice(out)
						.filter((_, i) => i % 10 === 0)
						.map((f) => [f.x.toFixed(2), f.y.toFixed(2), f.moving, f.wander]),
				)}`,
			).toBe(true);
			// The crier shifts a little behind its counter.
			const shifts = samples.map((s) => dist([s.host!.x, s.host!.y], hostHome));
			expect(Math.max(...shifts)).toBeGreaterThan(0.3);
			expect(Math.max(...shifts)).toBeLessThan(0.6);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});
});

test("a wanderer never keeps the avatar from its way: the avatar walks up beside one paused at a point of interest", {
	timeout: 60_000,
}, async () => {
	const square = placeOf("fantasy", "square");
	const { page, errors } = await openWorld(world("fantasy", [BRAM]));
	try {
		await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
		let paused: FolkView | undefined;
		await vi.waitFor(
			async () => {
				const folk = await view<FolkView[]>(page, "townsfolk()");
				paused = folk.find((f) => !f.moving && (square.interest ?? []).some((p) => dist(p.at, [f.x, f.y]) < 0.05));
				expect(paused).toBeDefined();
			},
			{ timeout: 30_000, interval: 100 },
		);
		// Click just beside it: the avatar's walk is found, and the wanderer heads home out of its way.
		const goal: Point = [paused!.x + 0.9, paused!.y + 0.3];
		const [sx, sy] = await screen(page, ...goal);
		await page.mouse.click(sx, sy);
		await vi.waitFor(
			async () => {
				const avatar = await view<Walking>(page, "avatar()");
				expect(avatar.moving).toBe(false);
				expect(dist([avatar.x, avatar.y], goal)).toBeLessThan(0.8);
			},
			{ timeout: 20_000, interval: 100 },
		);
		const folk = (await view<FolkView[]>(page, "townsfolk()")).find((f) => f.id === paused!.id)!;
		const avatar = await view<Walking>(page, "avatar()");
		expect(folk.moving || dist([folk.x, folk.y], [avatar.x, avatar.y]) >= 1.2).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("life is still unless asked for: under a driven browser nobody idles or wanders", {
	timeout: 40_000,
}, async () => {
	const { page, errors } = await openWorld(world("fantasy"), Number.NaN);
	try {
		await page.evaluate(() => {
			delete (window as any).agentWorldLife;
		});
		const first = await sample(page);
		for (let i = 0; i < 40; i++) {
			const now = await sample(page);
			for (const f of [...now.figures, ...now.folk]) {
				const was = [...first.figures, ...first.folk].find((o) => o.id === f.id)!;
				expect([f.x, f.y]).toEqual([was.x, was.y]);
				expect(f.idle).toBeNull();
			}
			await page.waitForTimeout(200);
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
