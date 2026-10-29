import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import { FIDGETS, type FidgetKind, slotStyle, type ThemeManifest } from "../src/theme-pack.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for fidget objects (ticket 29): the committed, built world UI in headless Chrome over a fixture backend that
// records every call made to it. In each theme, every kind of fidget object answers hover text, a left click (the
// avatar walks up, then its default play changes how it looks), and the right-click menu (every play and Examine);
// and none of it calls the backend: a fidget sends no command and makes no outside call.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves close-ups there as aw-29-<theme>-<kind>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
/** Where to look for each kind first: places the Places tab reaches without a function place's own backend. */
const PLACES = ["headquarters", "common-room", "square", "inn", "rookery", "library"] as const;

const read = <T>(path: string): T => JSON.parse(readFileSync(join(appDir, path), "utf8"));

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const HQ = "orla";
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
const ORLA: Character = {
	id: HQ,
	name: "Orla",
	role: "coordinator",
	place: { kind: "headquarters", headquarters: HQ },
	startedAt: NOW - 9_000_000,
	facts: facts(),
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

/** Open the world over a fixture backend; `window.calls` records every call made to it, by name. */
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
		const w = window as any;
		w.calls = [];
		const api: Record<string, (...args: any[]) => unknown> = {
			snapshot: async () => snapshot,
			onUpdate: () => () => {},
			feed: async () => [],
			onFeed: () => () => {},
			goToTerminal: async () => ({ ok: true }),
			conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
			markSeen: async () => ({ ok: true }),
			setAvatarLook: async () => ({ ok: true }),
			instruct: async () => ({ ok: true }),
			onReceipt: () => () => {},
			watchReplies: async () => {},
			onReply: () => () => {},
			wake: async () => ({ ok: true, stage: "applied" }),
			endSession: async () => ({ ok: true, stage: "applied" }),
			sendMail: async () => ({ ok: true, stage: "applied" }),
			openLink: async () => ({ ok: true }),
		};
		// Every call the world makes to its backend is recorded by name.
		w.agentWorld = new Proxy(api, {
			get(target, key) {
				const value = target[key as string];
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					w.calls.push(String(key));
					return value(...args);
				};
			},
		});
	}, world(theme));
	await page.goto(`${ORIGIN}/index.html?world`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(500);
	// Clicks reach the world through the interface's panels (they still draw for screenshots).
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	return { page, errors };
}

interface FidgetView {
	index: number;
	kind: FidgetKind;
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	art: string;
	on: boolean;
	playing: string | null;
	angle: number;
	speed: number;
	particles: number;
	glow: number | null;
	line: string | null;
}
interface AvatarView {
	x: number;
	y: number;
	moving: boolean;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const calls = (page: Page) => page.evaluate(() => (window as any).calls.slice()) as Promise<string[]>;
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const hoverText = (page: Page) => page.evaluate(() => document.querySelector(".pointer-hover")?.textContent ?? null);
const menuItems = (page: Page) => page.locator(".pointer-menu [role=menuitem]").allTextContents();

async function fidget(page: Page, index: number): Promise<FidgetView> {
	const all = await view<FidgetView[]>(page, "fidgets()");
	return all.find((f) => f.index === index)!;
}

/** Travel by the Places tab (unless there already), and zoom out to see the place whole. */
async function travel(page: Page, label: string, key: string, errors: string[] = []) {
	if ((await view(page, "place()")) !== key) {
		const places = page.getByRole("tab", { name: "Places", exact: true });
		if ((await places.getAttribute("aria-selected")) !== "true" || (await page.locator(".aw-side.aw-folded").count()))
			await places.dispatchEvent("click");
		await page.locator(`button[title="Travel to ${label}"]`).first().dispatchEvent("click");
		await vi.waitFor(async () => expect(await view(page, "place()"), errors.join("; ")).toBe(key), { timeout: 6000 });
	}
	await page.mouse.move(640, 400);
	for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 500);
	await page.waitForTimeout(900);
}

/** Send the avatar a few tiles off, so walking up to the fidget is a walk. */
async function walkAway(page: Page, place: PlaceData, at: [number, number]) {
	const [ex, ey] = place.entries.start ?? Object.values(place.entries)[0];
	const far = Math.hypot(ex - at[0], ey - at[1]) > 3 ? [ex, ey] : place.spots[0];
	const [sx, sy] = await screen(page, far[0], far[1] + 0.6);
	await page.mouse.click(sx, sy);
	await vi.waitFor(async () => expect((await view<AvatarView>(page, "avatar()")).moving).toBe(false), {
		timeout: 8000,
	});
}

async function closeUp(page: Page, f: FidgetView, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	const [x, y] = await screen(page, f.x, f.y - f.h / 2);
	await page.screenshot({
		path: join(SHOTS, `${name}.png`),
		animations: "disabled",
		clip: { x: Math.max(0, x - 140), y: Math.max(0, y - 120), width: 280, height: 220 },
	});
}

/** Whether its default play shows on it (each kind its own way). */
function playedDefault(kind: FidgetKind, f: FidgetView): boolean {
	// A pet (whichever look) is being petted: its own frame for it, with hearts.
	if (kind === "pet") return f.playing === "pet" && f.particles > 0;
	if (kind === "spin") return f.speed > 0;
	if (kind === "bell") return f.art === "bell-ringing";
	if (kind === "handbell") return Math.abs(f.angle) > 2;
	if (kind === "light" || kind === "box") return f.on && f.art.endsWith(kind === "light" ? "-on" : "-open");
	if (kind === "sleeper") return f.playing === "pet" && f.particles > 0;
	if (kind === "candle") return (f.glow ?? 1) < 0.35;
	return f.line !== null;
}

describe.each(THEMES)("in the %s theme", (theme) => {
	const manifest = read<ThemeManifest>(`themes/${theme}/theme.json`);
	const placeData = (name: string) => read<PlaceData>(`themes/${theme}/places/${name}.json`);
	// Each kind the pack places, where it is first found in the places tried.
	const found = new Map<FidgetKind, { place: string; index: number }>();
	for (const name of PLACES)
		placeData(name)
			.overlaySlots.filter((slot) => slot.kind === "fidget")
			.forEach((slot, index) => {
				if (slot.fidget && !found.has(slot.fidget)) found.set(slot.fidget, { place: name, index });
			});

	test("places a mix of fidget kinds, every kind it draws in a place the Places tab reaches", () => {
		expect(found.size).toBeGreaterThanOrEqual(6);
	});

	test("every kind answers hover, its default play after the avatar walks up, and every play and Examine in its menu", {
		timeout: 240_000,
	}, async () => {
		const { page, errors } = await openWorld(theme);
		for (const [kind, { place, index }] of found) {
			const data = placeData(place);
			const slot = data.overlaySlots.filter((s) => s.kind === "fidget")[index];
			const key = place === "headquarters" || place === "common-room" ? `${place}:${HQ}` : place;
			await travel(page, manifest.labels[place], key, errors);
			// A pet wears its look's name and verbs (alive pass, ticket 03).
			const style = slotStyle(manifest.fidgets![kind]!, slot);
			const name = slot.name ?? style.name;
			const before = await fidget(page, index);
			expect(before, `${kind} in ${place}`).toMatchObject({ kind, name });
			await walkAway(page, data, slot.at);
			const [sx, sy] = await screen(page, before.x, before.y - Math.min(before.h / 2, 0.4));
			const shot = `aw-29-${theme}-${kind}`;
			await closeUp(page, before, `${shot}-0`);

			// Hover: its default play, named.
			const plays: string[] = kind === "light" ? ["on"] : kind === "box" ? ["open"] : [...FIDGETS[kind].plays];
			await page.mouse.move(sx, sy);
			await vi.waitFor(
				async () =>
					expect(
						await hoverText(page).catch(() => null),
						`hover over ${kind} at ${sx}, ${sy}: ${JSON.stringify(await view(page, "avatar()"))}`,
					).toContain(`${style.verbs[plays[0]]} ${name}`),
				{ timeout: 3000 },
			);

			// The right-click menu: every play, then Examine.
			const quiet = (await calls(page)).length;
			await page.mouse.click(sx, sy, { button: "right" });
			expect(await menuItems(page)).toEqual(
				expect.arrayContaining([...plays.map((play) => `${style.verbs[play]} ${name}`), `Examine ${name}`]),
			);
			await page.keyboard.press("Escape");

			// Left click: the avatar walks up first, and only then does it play.
			const start = await view<AvatarView>(page, "avatar()");
			expect(Math.hypot(start.x - slot.at[0], start.y - slot.at[1]), `${kind}: starts away`).toBeGreaterThan(1.9);
			await page.mouse.click(sx, sy);
			let walked = false;
			let early = false;
			for (let i = 0; i < 80; i++) {
				// Both in one frame's look, so an arrival between two reads is not taken for an early play.
				const [avatar, now] = (await page.evaluate((i) => {
					const world = (window as any).agentWorldView;
					return [world.avatar(), world.fidgets().find((f: { index: number }) => f.index === i)];
				}, index)) as [AvatarView, FidgetView];
				if (avatar.moving) walked = true;
				if (avatar.moving && now.playing && now.playing !== "idle") early = true;
				if (walked && !avatar.moving) break;
				await page.waitForTimeout(60);
			}
			expect(walked, `${kind}: the avatar walks up`).toBe(true);
			expect(early, `${kind}: plays only once the avatar is there`).toBe(false);
			const there = await view<AvatarView>(page, "avatar()");
			expect(Math.hypot(there.x - slot.at[0], there.y - slot.at[1]), `${kind}: beside it`).toBeLessThan(2.3);
			await vi.waitFor(async () => expect(playedDefault(kind, await fidget(page, index)), kind).toBe(true), {
				timeout: 4000,
				interval: 40,
			});
			await closeUp(page, await fidget(page, index), `${shot}-1`);

			// Its other play from the menu (a toggle offers the way back), then Examine.
			// Where it is on screen now: the view follows the avatar.
			const point = () => screen(page, before.x, before.y - Math.min(before.h / 2, 0.4));
			await page.waitForTimeout(2600);
			let [mx, my] = await point();
			await page.mouse.click(mx, my, { button: "right" });
			const items = await menuItems(page);
			const other =
				kind === "light"
					? style.verbs.off
					: kind === "box"
						? style.verbs.close
						: style.verbs[FIDGETS[kind].plays[1] ?? FIDGETS[kind].plays[0]];
			expect(items).toContain(`${other} ${name}`);
			await page
				.locator(".pointer-menu [role=menuitem]", { hasText: `${other} ${name}` })
				.first()
				.click();
			await vi.waitFor(
				async () => {
					const f = await fidget(page, index);
					if (kind === "light" || kind === "box") expect(f.on).toBe(false);
					else expect(f.playing !== null || f.speed > 0 || f.line !== null).toBe(true);
				},
				{ timeout: 4000, interval: 40 },
			);
			await page.waitForTimeout(600);
			[mx, my] = await point();
			await page.mouse.click(mx, my, { button: "right" });
			await page.locator(".pointer-menu [role=menuitem]", { hasText: `Examine ${name}` }).click();
			await vi.waitFor(
				async () =>
					expect(await page.locator(".notice").first().textContent()).toContain(
						style.examine.replace("{name}", name).slice(0, 24),
					),
				{ timeout: 3000 },
			);

			// None of it reached the backend.
			expect((await calls(page)).slice(quiet), `${kind}: calls to the backend`).toEqual([]);
		}
		expect(errors).toEqual([]);
		await page.close();
	});
});
