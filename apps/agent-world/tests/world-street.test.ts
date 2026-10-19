import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { SlackChannel } from "../src/integrations.js";
import type { ThemeManifest } from "../src/theme-pack.js";
import type { Character, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for the second exterior (ticket 09 of the alive pass): the committed, built world UI in headless Chrome over a
// fixture backend. The street beyond the square is a place of its own in every pack: listed in the Places tab, shown
// on the square's minimap as an arrow at its edge, reached by walking out of the square and left by walking back, and
// it holds the townsfolk (unread Slack channels) the square has no room for.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-alive-09-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
const read = <T>(path: string): T =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${path}`, import.meta.url)), "utf8"));
const place = (theme: string, name: string) => read<PlaceData>(`${theme}/places/${name}.json`);
const labels = (theme: string) => read<ThemeManifest>(`${theme}/theme.json`).labels;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const NOW = Date.now();
const independent = (id: string, name: string, n: number): Character => ({
	id,
	name,
	role: "independent",
	place: { kind: "square" },
	startedAt: NOW - 8_000_000 + n,
});
const AGENTS = [independent("wren", "Wren", 1), independent("bram", "Bram", 2)];
const world = (theme: string): WorldSnapshot => ({
	connected: true,
	headquarters: [],
	characters: AGENTS,
	dormant: [],
	mail: [],
	theme,
});
/** Forty unread channels, the most pressing first: more than the square and the street hold together. */
const CHANNELS: SlackChannel[] = Array.from({ length: 40 }, (_, i) => ({
	id: `C${String(i).padStart(4, "0")}`,
	name: `team-${i}`,
	kind: "channel",
	unread: 40 - i,
	more: false,
	mentions: 0,
	latest: `${Math.floor(NOW / 1000) - i * 60}.000100`,
	url: null,
}));

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
	await page.addInitScript(
		([snapshot, channels]) => {
			const w = window as any;
			const account = { team: "Acme", url: "https://acme.slack.com/", user: "op" };
			w.agentWorld = {
				snapshot: async () => snapshot,
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				goToTerminal: async () => ({ ok: true }),
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
				setAvatarLook: async () => ({ ok: true }),
				credentialStatus: async () => ({ atlassian: null, slack: account }),
				slackUnread: async () => ({ ok: true, channels }),
				outsideWrites: async () => [],
				onOutsideWrite: () => () => {},
			};
		},
		[first, CHANNELS] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(500); // the arrival fade
	return { page, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const here = (page: Page) => view<string>(page, "place()");
const townsfolk = (page: Page) => view<{ id: string; x: number; y: number }[]>(page, "townsfolk()");
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `aw-alive-09-${name}.png`), animations: "disabled" });
}

/** Wait until the avatar has stopped walking. */
async function stopped(page: Page) {
	await vi.waitFor(async () => expect((await view<{ moving: boolean }>(page, "avatar()")).moving).toBe(false), {
		timeout: 15000,
	});
}

test.each(THEMES)(
	"the %s pack lists its street in the Places tab, after the square, and stands there the townsfolk the square has no room for",
	{
		timeout: 60_000,
	},
	async (theme) => {
		const square = place(theme, "square");
		const street = place(theme, "street");
		const { page, errors } = await openWorld(world(theme));
		expect(await here(page)).toBe("square");
		// The square: its spots less the two agents' hold the first channels.
		const room = square.spots.length - AGENTS.length;
		await vi.waitFor(async () => expect(await townsfolk(page)).toHaveLength(room), { timeout: 10000 });
		await page.getByRole("tab", { name: "Places", exact: true }).click();
		const outside = page.getByRole("region", { name: "Outside" });
		const names = await outside.locator(".aw-row-name").allTextContents();
		expect(names.slice(0, 2)).toEqual([labels(theme).square, labels(theme).street]);
		await outside.getByTitle(`Travel to ${labels(theme).street}`, { exact: true }).dispatchEvent("click");
		await vi.waitFor(async () => expect(await here(page)).toBe("street"), { timeout: 5000 });
		// The street: the next channels, one on each of its spots.
		await vi.waitFor(async () => expect(await townsfolk(page)).toHaveLength(street.spots.length), { timeout: 10000 });
		const ids = (await townsfolk(page)).map((f) => f.id).sort();
		expect(ids).toEqual(CHANNELS.slice(room, room + street.spots.length).map((c) => c.id));
		await page.getByRole("tab", { name: "Places", exact: true }).click();
		await page.waitForTimeout(400);
		await shot(page, `${theme}-street`);
		expect(errors).toEqual([]);
		await page.close();
	},
);

test.each(THEMES)(
	"in the %s pack the avatar walks out of the square to the street and back, and the minimap shows the way",
	{
		timeout: 90_000,
	},
	async (theme) => {
		const square = place(theme, "square");
		const street = place(theme, "street");
		const { page, errors } = await openWorld(world(theme));
		await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
		// The square's minimap marks the exit at the edge it leaves by, named for the street.
		const exit = page.locator(".aw-minimap-exit");
		await exit.waitFor({ timeout: 5000 });
		expect(await exit.getAttribute("title")).toBe(`To ${labels(theme).street}`);
		const door = square.doors.find((d) => d.to === "street")!;
		// Hovering the way out offers to go there; clicking it walks out of the square.
		await page.evaluate((name) => (window as any).agentWorldView.lookAt(name), door.name);
		await page.waitForTimeout(800);
		const [x, y, w, h] = door.rect;
		const [sx, sy] = await screen(page, x + w / 2, y + h / 2);
		await page.mouse.move(sx, sy);
		await page.locator(".pointer-hover").getByText(`Go to ${door.name}`).waitFor({ timeout: 3000 });
		await shot(page, `${theme}-square-exit`);
		await page.mouse.click(sx, sy);
		await vi.waitFor(async () => expect(await here(page)).toBe("street"), { timeout: 20000 });
		await stopped(page);
		const arrived = await view<{ x: number; y: number }>(page, "avatar()");
		expect(Math.hypot(arrived.x - street.entries.square[0], arrived.y - street.entries.square[1])).toBeLessThan(0.3);
		await page.locator(".aw-minimap-exit").waitFor({ timeout: 5000 });
		expect(await page.locator(".aw-minimap-exit").getAttribute("title")).toBe(`To ${labels(theme).square}`);
		await shot(page, `${theme}-street-arrived`);
		// And back the way it came.
		const back = street.doors.find((d) => d.to === "square")!;
		const [bx, by, bw, bh] = back.rect;
		const [tx, ty] = await screen(page, bx + bw / 2, by + bh / 2);
		await page.mouse.click(tx, ty);
		await vi.waitFor(async () => expect(await here(page)).toBe("square"), { timeout: 20000 });
		await stopped(page);
		const home = await view<{ x: number; y: number }>(page, "avatar()");
		expect(Math.hypot(home.x - square.entries.street[0], home.y - square.entries.street[1])).toBeLessThan(0.3);
		expect(errors).toEqual([]);
		await page.close();
	},
);
