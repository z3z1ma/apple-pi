import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, WorldSnapshot } from "../src/world.js";
import { BODY_CLEARANCE, clearanceAt, clearRun, findPath, gridFor, isOpen } from "../web/game/pathing.js";
import type { PlaceData, Point } from "../web/theme.js";

// Seam 2 (the built world UI in headless Chrome against a fixture backend), for walking, pointing, and the camera.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots, including a frame sequence of one walk, as aw-06-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;

const fantasy = (name: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/fantasy/places/${name}.json`, import.meta.url)), "utf8"));
const HALL = fantasy("headquarters");

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const HQ = "orla";
const ORLA: Character = {
	id: HQ,
	name: "Orla the Wise",
	role: "coordinator",
	place: { kind: "headquarters", headquarters: HQ },
	startedAt: 1_700_000_000_000,
};
const world = (characters: Character[] = [ORLA]): WorldSnapshot => ({
	connected: true,
	headquarters: [{ id: HQ, name: "Orla", wings: [] }],
	characters,
});

async function openWorld(first: WorldSnapshot) {
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
	await page.addInitScript((snapshot) => {
		(window as any).agentWorld = {
			snapshot: async () => snapshot,
			onUpdate: () => () => {},
			feed: async () => [],
			onFeed: () => () => {},
			goToTerminal: async () => ({ ok: true }),
			conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
			markSeen: async () => ({ ok: true }),
		};
		// Whether each context menu the page saw was stopped before the browser could show its own.
		(window as any).contextMenus = [];
		document.addEventListener("contextmenu", (event) => (window as any).contextMenus.push(event.defaultPrevented));
	}, first);
	await page.goto(`${ORIGIN}/index.html`);
	// These tests click the world itself: let clicks pass through the interface's panels (still drawn for screenshots).
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	await vi.waitFor(async () => expect(await avatar(page)).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(400); // the arrival fade
	return { page, errors };
}

interface AvatarView {
	x: number;
	y: number;
	moving: boolean;
	facing: string;
	frame: number;
	path: Point[];
	look: string;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const avatar = (page: Page) => view<AvatarView | undefined>(page, "avatar()");
const place = (page: Page) => view<string | undefined>(page, "place()");
const figure = async (page: Page, id: string) =>
	(await view<{ id: string; x: number; y: number }[]>(page, "figures()")).find((f) => f.id === id)!;
const screen = (page: Page, [x, y]: Point) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<Point>;
const hoverText = (page: Page) => page.locator(".pointer-hover").textContent();

async function pointAt(page: Page, at: Point) {
	const [x, y] = await screen(page, at);
	await page.mouse.move(x, y);
	return [x, y] as Point;
}

async function clickAt(page: Page, at: Point, button: "left" | "right" = "left") {
	const [x, y] = await pointAt(page, at);
	await page.mouse.click(x, y, { button });
}

const arrived = (page: Page, timeout = 12000) =>
	vi.waitFor(async () => expect((await avatar(page))?.moving).toBe(false), { timeout, interval: 50 });

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	// CSS animations stay at their first frame in headless Chrome; "disabled" shows them finished.
	await page.screenshot({ path: join(SHOTS, `aw-06-${name}.png`), animations: "disabled" });
}

/** Every point along a path, every few hundredths of a tile. */
function along(points: Point[]): Point[] {
	const out: Point[] = [];
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1];
		const [bx, by] = points[i];
		const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.02));
		for (let s = 0; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
	}
	return out;
}

/** The avatar in one animation frame, and where the place's corner was on screen. */
interface Frame {
	t: number;
	x: number;
	y: number;
	moving: boolean;
	frame: number;
	goal: Point;
	view: Point;
}

/** Record the avatar every animation frame until `stop()` in the page. */
const record = (page: Page) =>
	page.evaluate(() => {
		const frames: Frame[] = [];
		(window as any).walkFrames = frames;
		(window as any).recording = true;
		const tick = (t: number) => {
			const a = (window as any).agentWorldView.avatar();
			const view = (window as any).agentWorldView.toScreen(0, 0);
			if (a) frames.push({ t, x: a.x, y: a.y, moving: a.moving, frame: a.frame, goal: a.path.at(-1), view });
			if ((window as any).recording) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
const recorded = (page: Page) =>
	page.evaluate(() => {
		(window as any).recording = false;
		return (window as any).walkFrames as Frame[];
	});

test("the avatar starts at the hall's start; a click across the room walks straight runs clear of furniture, ending where clicked", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const start = (await avatar(page))!;
		expect([start.x, start.y]).toEqual(HALL.entries.start);
		expect(start.look).toBe("avatar-traveller");
		await shot(page, "hall-start");
		// Across the hall, round the long table in the south-west to the gap beside the shelves.
		const goal: Point = [4.6, 13];
		await record(page);
		await clickAt(page, goal);
		const walk = (await avatar(page))!;
		const grid = gridFor(HALL);
		for (const point of along(walk.path)) expect(isOpen(grid, point), `${point}`).toBe(true);
		// No zig-zag: every corner is needed, the run that skips it would pass too close to furniture.
		const need = (p: Point) => Math.min(BODY_CLEARANCE, clearanceAt(grid, p));
		for (let i = 1; i < walk.path.length - 1; i++)
			expect(clearRun(grid, walk.path[i - 1], walk.path[i + 1], need(walk.path[i - 1]), need(walk.path[i + 1]))).toBe(
				false,
			);
		// A frame sequence of the walk, for judging the feel.
		for (let i = 1; i <= 6; i++) {
			await page.waitForTimeout(450);
			await shot(page, `walk-${i}`);
		}
		await arrived(page);
		const frames = await recorded(page);
		const end = (await avatar(page))!;
		expect(Math.hypot(end.x - goal[0], end.y - goal[1])).toBeLessThan(0.03);
		// Continuous: from the first step to arrival, every frame moves, and none jumps.
		const moving = frames.filter((f) => f.moving);
		for (let i = 1; i < moving.length; i++) {
			const step = Math.hypot(moving[i].x - moving[i - 1].x, moving[i].y - moving[i - 1].y);
			expect(step).toBeGreaterThan(0);
			expect(step).toBeLessThan(0.3);
		}
		// The walk cycle runs: all four phases show.
		expect(new Set(moving.map((f) => f.frame % 4)).size).toBe(4);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a click on furniture walks to the nearest open floor; a second click mid-walk turns at once without stopping", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const orla = await figure(page, HQ);
		// The long table at the top of the hall, beside Orla seated at it.
		const table: Point = [13.2, 5.4];
		const expected = findPath(gridFor(HALL, [[orla.x, orla.y]]), HALL.entries.start, table)!.goal;
		await clickAt(page, table);
		await arrived(page);
		const end = (await avatar(page))!;
		expect([end.x, end.y]).toEqual(expected);
		expect(isOpen(gridFor(HALL), [end.x, end.y])).toBe(true);
		expect(Math.hypot(end.x - table[0], end.y - table[1])).toBeLessThan(1.6);

		// Walk west, then click east while still walking.
		await record(page);
		await clickAt(page, [5, 11]);
		await page.waitForTimeout(700);
		const before = (await avatar(page))!;
		expect(before.moving).toBe(true);
		await clickAt(page, [24, 11.5]);
		await arrived(page);
		const frames = await recorded(page);
		const final = (await avatar(page))!;
		expect(Math.hypot(final.x - 24, final.y - 11.5)).toBeLessThan(0.03);
		// From the first click to arrival, the avatar never stood still for a frame.
		const first = frames.findIndex((f) => f.moving);
		const last = frames.findLastIndex((f) => f.moving);
		const walk = frames.slice(first, last + 1);
		expect(walk.every((f) => f.moving)).toBe(true);
		const turn = walk.findIndex((f) => f.goal[0] > 20);
		expect(turn).toBeGreaterThan(0);
		for (let i = 1; i < walk.length; i++)
			expect(Math.hypot(walk[i].x - walk[i - 1].x, walk[i].y - walk[i - 1].y)).toBeGreaterThan(0);
		// It turned where it was: the new walk starts from its position then, not from a grid cell.
		expect(Math.hypot(walk[turn].x - walk[turn - 1].x, walk[turn].y - walk[turn - 1].y)).toBeLessThan(0.3);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("hover text names the left-click action; right click lists every action and the browser's menu never opens", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const orla = await figure(page, HQ);
		const body: Point = [orla.x, orla.y - 0.9];
		await pointAt(page, body);
		await vi.waitFor(async () => expect(await hoverText(page)).toBe("Talk to Orla the Wise / 3 more options"));
		await shot(page, "hover-character");
		const archway = HALL.doors.find((d) => d.name === "Archway to the gallery")!;
		const [dx, dy, dw, dh] = archway.rect;
		await page.evaluate(() => (window as any).agentWorldView.lookAt("Archway to the gallery"));
		await pointAt(page, [dx + dw / 2, dy + dh / 2]);
		await vi.waitFor(async () => expect(await hoverText(page)).toBe("Enter Archway to the gallery / 1 more option"));
		await shot(page, "hover-door");
		// Just beside the door, only walking.
		await pointAt(page, [dx - 0.6, dy + dh / 2]);
		await vi.waitFor(async () => expect(await hoverText(page)).toBe("Walk here"));

		await clickAt(page, body, "right");
		const menu = page.getByRole("menu");
		await menu.waitFor({ timeout: 2000 });
		expect(await menu.getByRole("menuitem").allTextContents()).toEqual([
			"Talk to Orla the Wise",
			"Examine Orla the Wise",
			"End session of Orla the Wise",
			"Walk here",
			"Cancel",
		]);
		await shot(page, "menu");
		// Right clicks on the menu, the title, and the hover text are the game's too.
		const box = (await menu.boundingBox())!;
		await page.mouse.click(box.x + 8, box.y + 6, { button: "right" });
		await page.mouse.click(640, 30, { button: "right" });
		await page.mouse.click(30, 20, { button: "right" });
		const seen = await page.evaluate(() => (window as any).contextMenus as boolean[]);
		expect(seen.length).toBeGreaterThanOrEqual(4);
		expect(seen.every(Boolean)).toBe(true);

		await page.keyboard.press("Escape");
		await menu.waitFor({ state: "detached", timeout: 2000 });
		await clickAt(page, body, "right");
		await page.getByRole("menuitem", { name: "Examine Orla the Wise" }).click();
		// The interface's character card answers it.
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).agentWorldInterface.intents())).toContainEqual({
				kind: "examine",
				character: HQ,
			}),
		);
		await shot(page, "examine");
		// Examining does not walk.
		expect((await avatar(page))?.moving).toBe(false);
		expect(await view(page, "talkedTo()")).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("talking to a character and using a door walk up first; walking past a door does not travel", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const orla = await figure(page, HQ);
		await clickAt(page, [orla.x, orla.y - 0.9]);
		await page.waitForTimeout(150);
		expect(await view(page, "talkedTo()")).toEqual([]);
		expect((await avatar(page))?.moving).toBe(true);
		await vi.waitFor(async () => expect(await view(page, "talkedTo()")).toEqual([HQ]), { timeout: 8000 });
		const by = (await avatar(page))!;
		expect(by.moving).toBe(false);
		expect(Math.hypot(by.x - orla.x, by.y - orla.y)).toBeLessThan(1.5);
		// Facing Orla.
		const [fx, fy] = [orla.x - by.x, orla.y - by.y];
		expect(by.facing).toBe(Math.abs(fx) > Math.abs(fy) ? (fx < 0 ? "left" : "right") : fy < 0 ? "up" : "down");
		await shot(page, "talked");
		// The conversation opened over the world; Escape closes it.
		await page.getByRole("dialog", { name: "Conversation with Orla the Wise" }).waitFor({ timeout: 2000 });
		await page.keyboard.press("Escape");

		// Walk to the archway's stand point and past the door: no travel.
		const archway = HALL.doors.find((d) => d.name === "Archway to the gallery")!;
		await clickAt(page, archway.standAt);
		await arrived(page);
		await clickAt(page, [archway.standAt[0], archway.standAt[1] + 2.5]);
		await arrived(page);
		// "Walk here" on the door itself walks, too.
		const [dx, dy, dw, dh] = archway.rect;
		await clickAt(page, [dx + dw / 2, dy + dh / 2], "right");
		await page.getByRole("menuitem", { name: "Walk here" }).click();
		await arrived(page);
		await page.waitForTimeout(400);
		expect(await place(page)).toBe(`headquarters:${HQ}`);

		// Enter: walk to the stand point, then go through and arrive at the gallery's entry from the hall.
		await clickAt(page, [archway.standAt[0], archway.standAt[1] + 3]);
		await arrived(page);
		await record(page);
		await clickAt(page, [dx + dw / 2, dy + dh / 2]);
		await vi.waitFor(async () => expect(await place(page)).toBe(`gallery:${HQ}`), { timeout: 8000 });
		// It comes in through the gallery's archway and walks on to its entry from the hall, facing into the room.
		await arrived(page);
		const frames = await recorded(page);
		const lastInHall = frames.filter((f) => f.x > 20).at(-1)!;
		expect(Math.hypot(lastInHall.x - archway.standAt[0], lastInHall.y - archway.standAt[1])).toBeLessThan(1);
		// Through the hall's doorway without a stop at its stand point: every frame from there on moves.
		const throughHall = frames.filter(
			(f) => f.x > 20 && Math.hypot(f.x - archway.standAt[0], f.y - archway.standAt[1]) < 0.4,
		);
		expect(throughHall.every((f) => f.moving)).toBe(true);
		const gallery = fantasy("gallery");
		const inDoorway = frames.filter((f) => f.x < 3);
		expect(inDoorway[0].y).toBeLessThan(gallery.entries.headquarters[1] - 0.5);
		const inGallery = (await avatar(page))!;
		expect([inGallery.x, inGallery.y]).toEqual(gallery.entries.headquarters);
		expect(inGallery.facing).toBe("down");
		await page.waitForTimeout(400);
		await shot(page, "gallery-arrival");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("the camera follows the avatar across a place larger than the window, and the wheel zooms smoothly", async () => {
	const { page, errors } = await openWorld(world());
	try {
		// Through the hall doors to the square, which is wider than the window.
		const doors = HALL.doors.find((d) => d.name === "Hall doors")!;
		const [dx, dy, dw, dh] = doors.rect;
		await clickAt(page, [dx + dw / 2, dy + dh / 2]);
		await vi.waitFor(async () => expect(await place(page)).toBe("square"), { timeout: 8000 });
		await page.waitForTimeout(400);
		const square = fantasy("square");
		await arrived(page);
		const arrival = (await avatar(page))!;
		expect([arrival.x, arrival.y]).toEqual(square.entries.headquarters);
		await shot(page, "square-arrival");

		// Walk east along the street; the view follows, easing, with the avatar near the middle.
		await record(page);
		await clickAt(page, [24, 10.2]);
		await page.waitForTimeout(1500);
		await shot(page, "square-following");
		await arrived(page);
		await page.waitForTimeout(1500);
		await clickAt(page, [34, 10]);
		await arrived(page, 15000);
		await page.waitForTimeout(1500);
		const frames = await recorded(page);
		// Centred on the avatar: near the painting's east edge, the view may slide the painting out from under the side
		// panel, but no further than the panel reaches.
		const [sx] = await screen(page, [34, 10]);
		expect(sx).toBeCloseTo(640, 0);
		const [east] = await screen(page, [44, 10]);
		const panel = await page.evaluate(() => document.querySelector(".aw-side")!.getBoundingClientRect().left);
		expect(east).toBeGreaterThanOrEqual(panel);
		// The view eased: it never moved more than a walking step's worth of screen in one frame.
		for (let i = 1; i < frames.length; i++)
			expect(
				Math.hypot(frames[i].view[0] - frames[i - 1].view[0], frames[i].view[1] - frames[i - 1].view[1]),
			).toBeLessThan(15);
		await shot(page, "square-east");
		// The square opens at the painting's own scale, larger than the window.
		const opening = await page.evaluate(() => (window as any).agentWorldView.zoom());
		expect(opening.zoom).toBeCloseTo(1, 5);
		expect(frames.length).toBeGreaterThan(10);

		// The wheel: out to the whole place, in to the closest, easing through the values in between.
		const zooms: number[] = [];
		await page.mouse.move(640, 400);
		for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 200);
		for (let i = 0; i < 12; i++) {
			zooms.push((await page.evaluate(() => (window as any).agentWorldView.zoom())).zoom);
			await page.waitForTimeout(30);
		}
		await page.waitForTimeout(600);
		const out = await page.evaluate(() => (window as any).agentWorldView.zoom());
		expect(out.zoom).toBeCloseTo(out.min, 3);
		expect(out.min).toBeCloseTo(Math.min(1280 / (44 * 48), 800 / (22 * 48)), 5);
		expect(new Set(zooms.map((z) => z.toFixed(3))).size).toBeGreaterThan(3);
		await shot(page, "square-zoomed-out");
		for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -200);
		await page.waitForTimeout(900);
		const zoomedIn = await page.evaluate(() => (window as any).agentWorldView.zoom());
		expect(zoomedIn.zoom).toBeCloseTo(zoomedIn.max, 3);
		await shot(page, "square-zoomed-in");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);
