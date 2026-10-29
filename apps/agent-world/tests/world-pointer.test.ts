import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, WorldSnapshot } from "../src/world.js";
import type { PlaceData, Point } from "../web/theme.js";

// Seam 2 for the cursor and click markers (ticket 01 of the aliveness task): the committed, built world UI in headless
// Chrome over a fixture backend. In each theme the world's cursor is the pack's hand (never the default arrow): it taps
// over something to do, is a fist over floor nobody can walk to, and points over open floor; a left click drops a
// yellow X where the avatar is heading or a red X on what it acts on, gone within about half a second.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots as aw-alive-01-<theme>-*.png, the cursor drawn where the pointer is.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;

const read = <T>(path: string): T => JSON.parse(readFileSync(join(appDir, path), "utf8"));

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const HQ = "orla";
const ORLA: Character = {
	id: HQ,
	name: "Orla",
	role: "coordinator",
	place: { kind: "headquarters", headquarters: HQ },
	startedAt: Date.now() - 9_000_000,
};
const world = (theme: string): WorldSnapshot =>
	({
		connected: true,
		theme,
		headquarters: [{ id: HQ, name: "Orla", wings: [] }],
		characters: [ORLA],
		dormant: [],
		mail: [],
	}) as unknown as WorldSnapshot;

interface Mark {
	kind: "walk" | "act";
	x: number;
	y: number;
	alpha: number;
}
interface PointerView {
	cursor: "walk" | "act" | "blocked" | null;
	art: "cursor-point" | "cursor-tap" | "cursor-blocked" | null;
	css: string;
	marks: Mark[];
}

async function openWorld(theme: string) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
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
			setAvatarLook: async () => ({ ok: true }),
			onReceipt: () => () => {},
			watchReplies: async () => {},
			onReply: () => () => {},
		};
	}, world(theme));
	await page.goto(`${ORIGIN}/index.html?world`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(500);
	await page.mouse.move(640, 400);
	for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 500);
	await page.waitForTimeout(900);
	return { page, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const pointerView = (page: Page) => view<PointerView>(page, "pointer()");
const screen = (page: Page, [x, y]: Point) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const hoverText = (page: Page) => page.evaluate(() => document.querySelector(".pointer-hover")?.textContent ?? null);
const canvasCursor = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector("canvas")!).cursor);
const passThrough = (page: Page) =>
	page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
const onScreen = ([x, y]: [number, number]) => x > 60 && x < 1220 && y > 60 && y < 740;

/** Draw the hand where the pointer is (screenshots leave the system cursor out), then take the shot. */
async function shot(page: Page, name: string, at: [number, number]) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.evaluate(
		([x, y]) => {
			const css = getComputedStyle(document.querySelector("canvas")!).cursor;
			const url = /url\("?([^")]+)/.exec(css)?.[1];
			const hotspot = /\)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*,\s*pointer$/.exec(css);
			if (!url || !hotspot) throw new Error(`no hand in ${css.slice(0, 40)}...${css.slice(-40)}`);
			const found = [css, url, hotspot[1], hotspot[2]];
			const img = document.createElement("img");
			img.id = "shot-cursor";
			img.src = found[1];
			img.style.cssText = `position:fixed;z-index:99999;pointer-events:none;left:${x - Number(found[2])}px;top:${y - Number(found[3])}px`;
			document.body.append(img);
		},
		[at[0], at[1]],
	);
	await page.waitForTimeout(50);
	await page.screenshot({
		path: join(SHOTS, `${name}.png`),
		animations: "disabled",
		clip: { x: Math.max(0, at[0] - 220), y: Math.max(0, at[1] - 160), width: 440, height: 320 },
	});
	await page.evaluate(() => document.getElementById("shot-cursor")?.remove());
}

/** A blocked spot on screen with nothing to do there (its hover text is only Walk here), found by pointing at each. */
async function wallOnScreen(page: Page, hall: PlaceData) {
	for (const [x, y, w, h] of hall.blocked) {
		const at: Point = [x + w / 2, y + h / 2];
		const screenAt = await screen(page, at);
		if (!onScreen(screenAt)) continue;
		await page.mouse.move(screenAt[0], screenAt[1]);
		await page.waitForTimeout(80);
		if ((await hoverText(page)) === "Walk here" && (await pointerView(page)).cursor === "blocked")
			return { at, screen: screenAt };
	}
	return undefined;
}

describe.each(THEMES)("in the %s theme", (theme) => {
	const hall = read<PlaceData>(`themes/${theme}/places/headquarters.json`);

	test("the world's cursor is the pack's hand: pointing over open floor, tapping over something to do, a fist over walls", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(theme);
		await passThrough(page);

		// Open floor: the plain pointing hand, the pack's art scaled to a cursor (never the default arrow).
		const floor = await screen(page, hall.entries.start);
		await page.mouse.move(floor[0], floor[1]);
		await vi.waitFor(async () => expect((await pointerView(page)).cursor).toBe("walk"), { timeout: 3000 });
		expect((await pointerView(page)).art).toBe("cursor-point");
		await vi.waitFor(async () => expect(await canvasCursor(page)).toMatch(/image-set\(url\("?data:image\/png/), {
			timeout: 3000,
		});
		await shot(page, `aw-alive-01-${theme}-floor`, floor);

		// A character: the hand taps, alternating the pointing and tapping art.
		const orla = (await view<{ x: number; y: number }[]>(page, "figures()"))[0];
		const over = await screen(page, [orla.x, orla.y - 0.6]);
		await page.mouse.move(over[0], over[1]);
		await vi.waitFor(async () => expect((await pointerView(page)).cursor).toBe("act"), { timeout: 3000 });
		const arts = new Set<string | null>();
		const csses = new Set<string>();
		for (let i = 0; i < 16; i++) {
			arts.add((await pointerView(page)).art);
			csses.add(await canvasCursor(page));
			await page.waitForTimeout(70);
		}
		expect([...arts].sort()).toEqual(["cursor-point", "cursor-tap"]);
		expect(csses.size).toBe(2);
		await shot(page, `aw-alive-01-${theme}-act`, over);

		// Floor nobody can walk to, with nothing to do there: the fist.
		const wall = (await wallOnScreen(page, hall))?.screen;
		expect(wall, "a blocked spot with nothing to do on screen").toBeDefined();
		expect((await pointerView(page)).art).toBe("cursor-blocked");
		expect(await canvasCursor(page)).toMatch(/image-set\(url\("?data:image\/png/);
		await shot(page, `aw-alive-01-${theme}-blocked`, wall!);
		expect(errors).toEqual([]);
		await page.close();
	});

	test("the interface's panels keep their own cursors", { timeout: 60_000 }, async () => {
		const { page, errors } = await openWorld(theme);
		const tab = page.getByRole("tab", { name: "Places", exact: true });
		const box = (await tab.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		expect(await tab.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
		expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe("auto");
		expect(errors).toEqual([]);
		await page.close();
	});

	test("a left click drops a yellow X where the avatar heads and a red X on what it acts on, each gone in about half a second", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(theme);
		await passThrough(page);

		// Open floor: the yellow X at the destination.
		const [sx, sy] = hall.entries.start;
		const to: Point = [sx + 2, sy - 1];
		const floor = await screen(page, to);
		await page.mouse.click(floor[0], floor[1]);
		const walk = (await pointerView(page)).marks;
		expect(walk).toHaveLength(1);
		expect(walk[0].kind).toBe("walk");
		expect(Math.hypot(walk[0].x - to[0], walk[0].y - to[1])).toBeLessThan(0.3);
		await shot(page, `aw-alive-01-${theme}-mark-walk`, floor);
		await page.waitForTimeout(650);
		expect((await pointerView(page)).marks).toEqual([]);

		// Floor nobody can walk to: the yellow X where the avatar is heading instead, the nearest open floor.
		await vi.waitFor(async () => expect((await view<{ moving: boolean }>(page, "avatar()")).moving).toBe(false), {
			timeout: 8000,
		});
		const wall = await wallOnScreen(page, hall);
		expect(wall, "a blocked spot with nothing to do on screen").toBeDefined();
		await page.mouse.click(wall!.screen[0], wall!.screen[1]);
		const heading = (await pointerView(page)).marks;
		expect(heading.map((mark) => mark.kind)).toEqual(["walk"]);
		await vi.waitFor(async () => expect((await view<{ moving: boolean }>(page, "avatar()")).moving).toBe(false), {
			timeout: 8000,
		});
		const stopped = await view<{ x: number; y: number }>(page, "avatar()");
		expect(Math.hypot(heading[0].x - stopped.x, heading[0].y - stopped.y)).toBeLessThan(0.2);
		expect(Math.hypot(heading[0].x - wall!.at[0], heading[0].y - wall!.at[1])).toBeGreaterThan(0.2);

		// A character: the red X on it.
		await vi.waitFor(async () => expect((await view<{ moving: boolean }>(page, "avatar()")).moving).toBe(false), {
			timeout: 8000,
		});
		const orla = (await view<{ x: number; y: number }[]>(page, "figures()"))[0];
		const target: Point = [orla.x, orla.y - 0.6];
		const over = await screen(page, target);
		await page.mouse.click(over[0], over[1]);
		const act = (await pointerView(page)).marks;
		expect(act).toHaveLength(1);
		expect(act[0].kind).toBe("act");
		expect(Math.hypot(act[0].x - target[0], act[0].y - target[1])).toBeLessThan(0.3);
		await page.waitForTimeout(120);
		await shot(page, `aw-alive-01-${theme}-mark-act`, over);
		await page.waitForTimeout(550);
		expect((await pointerView(page)).marks).toEqual([]);
		expect(errors).toEqual([]);
		await page.close();
	});
});
