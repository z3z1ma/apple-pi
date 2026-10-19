import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { ThemeManifest } from "../src/theme-pack.js";
import type { Character, WorldSnapshot } from "../src/world.js";
import type { AtmosphereView } from "../web/game/atmosphere.js";

// Seam 2 for the aliveness pass (ticket 11 of the alive pass): the committed, built world UI in headless Chrome over a
// fixture backend, with the page's clock set (`setSystemTime`: `setFixedTime` would stop Phaser's tweens, which time by `Date.now()`). Out of doors the light follows the local time of day (a tint over the
// painting, lit windows and brighter lamps after dark); every place has motion that is not a character, which moves
// with life and holds still (but drawn) without it.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-alive-11-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
const labels = (theme: string): Record<string, string> =>
	(
		JSON.parse(
			readFileSync(fileURLToPath(new URL(`../themes/${theme}/theme.json`, import.meta.url)), "utf8"),
		) as ThemeManifest
	).labels;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const NOW = Date.now();
const AGENTS: Character[] = [
	{ id: "wren", name: "Wren", role: "independent", place: { kind: "square" }, startedAt: NOW - 8_000_000 },
];
const world = (theme: string): WorldSnapshot => ({
	connected: true,
	headquarters: [],
	characters: AGENTS,
	dormant: [],
	mail: [],
	theme,
});
/** The local time on the page's clock (the page runs in UTC). */
const at = (hours: number, minutes = 0) => Date.UTC(2026, 9, 19, hours, minutes);

async function openWorld(theme: string, clock: number, life?: number) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, timezoneId: "UTC" });
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
	await page.clock.setSystemTime(clock);
	await page.addInitScript(
		([snapshot, pace]) => {
			const w = window as any;
			if (pace !== null) w.agentWorldLife = { pace };
			w.agentWorld = {
				snapshot: async () => snapshot,
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				goToTerminal: async () => ({ ok: true }),
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
				setAvatarLook: async () => ({ ok: true }),
			};
		},
		[world(theme), life ?? null] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(
		async () => expect(await page.evaluate(() => (window as any).agentWorldView?.place())).toBeTruthy(),
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500); // the arrival fade
	return { page, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const atmosphere = (page: Page) => view<AtmosphereView>(page, "atmosphere()");
const glows = async (page: Page) =>
	(await view<{ kind: string; alpha: number }[]>(page, "overlays()")).filter((o) => o.kind === "glow");
const brightness = (tint: string) => {
	const n = Number.parseInt(tint.slice(1), 16);
	return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
};

async function travel(page: Page, theme: string, kind: string) {
	await page.getByRole("tab", { name: "Places", exact: true }).click();
	await page.getByTitle(`Travel to ${labels(theme)[kind]}`, { exact: true }).dispatchEvent("click");
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe(kind), { timeout: 8000 });
	await page.getByRole("tab", { name: "Places", exact: true }).click();
	await page.waitForTimeout(600);
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `aw-alive-11-${name}.png`), animations: "disabled" });
}

test.each(THEMES)(
	"in the %s pack the square's light follows the clock: as painted in the afternoon, dark blue at night with windows lit and lamps up",
	{ timeout: 60_000 },
	async (theme) => {
		const { page, errors } = await openWorld(theme, at(13));
		expect(await view(page, "place()")).toBe("square");
		const day = await atmosphere(page);
		expect(day.daylight).toMatchObject({ phase: "afternoon", windows: 0 });
		expect(brightness(day.daylight!.tint)).toBeGreaterThan(235);
		// The lamps' glow by day, to compare with the night's below.
		await page.waitForTimeout(1200);
		const dayGlows = await glows(page);
		expect(dayGlows.length).toBeGreaterThan(0);
		await shot(page, `${theme}-square-afternoon`);

		// The clock moves on to the night; within a second or two the light follows.
		await page.clock.setSystemTime(at(22));
		await vi.waitFor(async () => expect((await atmosphere(page)).daylight?.phase).toBe("night"), { timeout: 4000 });
		const night = await atmosphere(page);
		expect(brightness(night.daylight!.tint)).toBeLessThan(140);
		expect(night.daylight!.windows).toBe(1);
		expect(night.daylight!.lamps).toBeGreaterThan(1.5);
		await page.waitForTimeout(1200); // the lamps ease up
		const nightGlows = await glows(page);
		expect(Math.min(...nightGlows.map((g) => g.alpha))).toBeGreaterThan(Math.max(...dayGlows.map((g) => g.alpha)));
		expect(night.effects.map((e) => e.kind)).toEqual(expect.arrayContaining(["sky", "lights"]));
		await shot(page, `${theme}-square-night`);

		// Golden hour, the hour the paintings are painted in, leaves the square as painted.
		await page.clock.setSystemTime(at(17));
		await vi.waitFor(async () => expect((await atmosphere(page)).daylight?.tint).toBe("#ffffff"), { timeout: 4000 });
		await shot(page, `${theme}-square-golden`);
		expect(errors).toEqual([]);
		await page.close();
	},
);

test.each(THEMES)(
	"in the %s pack the light passes smoothly through the evening, and indoors it keeps its own",
	{ timeout: 60_000 },
	async (theme) => {
		const { page, errors } = await openWorld(theme, at(18, 30));
		const seen: number[] = [];
		for (const [h, m] of [
			[18, 30],
			[19, 0],
			[19, 30],
			[20, 0],
			[20, 30],
		]) {
			await page.clock.setSystemTime(at(h, m));
			await vi.waitFor(async () => expect((await atmosphere(page)).daylight?.hour).toBeCloseTo(h + m / 60, 2), {
				timeout: 4000,
			});
			seen.push(brightness((await atmosphere(page)).daylight!.tint));
		}
		// Darker at each step, in several steps rather than one.
		for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1]);
		expect(new Set(seen.map(Math.round)).size).toBe(seen.length);
		await shot(page, `${theme}-square-dusk`);
		// Indoors: no tint by the clock.
		await travel(page, theme, "inn");
		expect((await atmosphere(page)).daylight).toBeNull();
		expect(errors).toEqual([]);
		await page.close();
	},
);

test.each(THEMES)(
	"in the %s pack things move in the air of each place, drawn even with life still and moving with it",
	{ timeout: 90_000 },
	async (theme) => {
		// Without life (the headless default): drawn, but still.
		const still = await openWorld(theme, at(16));
		for (const kind of ["square", "street", "inn", "forge", "library"]) {
			if (kind !== "square") await travel(still.page, theme, kind);
			const { effects } = await atmosphere(still.page);
			const drawn = effects.filter((e) => e.kind !== "sky" && e.kind !== "lights");
			expect(drawn.length, `${kind}'s atmosphere`).toBeGreaterThan(0);
			for (const effect of drawn) expect(effect.shown.length, `${kind}'s ${effect.kind}`).toBeGreaterThan(0);
			const before = JSON.stringify(effects.map((e) => e.shown));
			await still.page.waitForTimeout(400);
			expect(JSON.stringify((await atmosphere(still.page)).effects.map((e) => e.shown))).toBe(before);
			await shot(still.page, `${theme}-${kind}`);
		}
		expect(still.errors).toEqual([]);
		await still.page.close();

		// With life: it moves, and the sky is crossed soon after arriving.
		const lively = await openWorld(theme, at(16), 3);
		const first = await atmosphere(lively.page);
		await lively.page.waitForTimeout(600);
		const later = await atmosphere(lively.page);
		const moved = first.effects
			.filter((e) => e.kind !== "sky" && e.kind !== "lights")
			.some((e, i) => JSON.stringify(e.shown) !== JSON.stringify(later.effects[i].shown));
		expect(moved).toBe(true);
		await vi.waitFor(
			async () =>
				expect((await atmosphere(lively.page)).effects.find((e) => e.kind === "sky")?.shown.length).toBeGreaterThan(0),
			{ timeout: 8000 },
		);
		await shot(lively.page, `${theme}-square-sky`);
		// Cheap: every effect of the place together takes a small part of a frame (measured ~0.02 ms of 16.7 ms).
		const { cost } = await atmosphere(lively.page);
		expect(cost.updates).toBeGreaterThan(0);
		expect(cost.mean).toBeLessThan(1);
		expect(lively.errors).toEqual([]);
		await lively.page.close();
	},
);
