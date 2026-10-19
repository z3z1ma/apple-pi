import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for the places themselves (overlays in their slots, wing doors, banners, the view around the interface): the
// committed, built world UI in headless Chrome, with the preload API replaced by a fixture backend.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-04-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const fantasy = (name: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/fantasy/places/${name}.json`, import.meta.url)), "utf8"));

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

/** Open the world over a fixture backend; `push` sends it a new snapshot; `window.avatarLooks` lists looks chosen. */
async function openWorld(first: WorldSnapshot, options: { clickThrough?: boolean } = {}) {
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
		const listeners = new Set<(s: unknown) => void>();
		let current = snapshot;
		const w = window as any;
		w.avatarLooks = [];
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
			setAvatarLook: async (look: string) => {
				w.avatarLooks.push(look);
				return { ok: true };
			},
		};
		w.pushSnapshot = (next: unknown) => {
			current = next as typeof snapshot;
			for (const listener of listeners) listener(next);
		};
	}, first);
	await page.goto(`${ORIGIN}/index.html`);
	if (options.clickThrough)
		await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	const push = (snapshot: WorldSnapshot) => page.evaluate((s) => (window as any).pushSnapshot(s), snapshot);
	await vi.waitFor(async () => expect(await avatar(page)).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(400); // the arrival fade
	return { page, push, errors };
}

interface AvatarView {
	x: number;
	y: number;
	moving: boolean;
	facing: string;
	frame: number;
	look: string;
}
const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const avatar = (page: Page) => view<AvatarView | undefined>(page, "avatar()");
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Zoom the view out with the wheel, as far as it goes, so the whole room shows. */
async function zoomOut(page: Page) {
	await page.mouse.move(640, 300);
	for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
	await page.waitForTimeout(700);
}

// A fixture world: Orla coordinates; her workers are in the apple-pi wing.
const HQ = "orla";
const T0 = Date.now() - 3_600_000;
function facts(over: Partial<CharacterFacts> = {}): CharacterFacts {
	return {
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
		reportsTo: HQ,
		model: "claude-opus-4",
		contextTokens: 48_000,
		contextWindow: 200_000,
		cost: 0.42,
		tmux: null,
		...over,
	};
}
const ORLA: Character = {
	id: HQ,
	name: "Orla",
	role: "coordinator",
	place: { kind: "headquarters", headquarters: HQ },
	startedAt: T0,
	facts: facts({ reportsTo: null }),
};
const worker = (id: string, n: number, over: Partial<CharacterFacts> = {}): Character => ({
	id,
	name: id,
	role: "worker",
	place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
	startedAt: T0 + n * 1000,
	facts: facts(over),
});
function world(characters: Character[], extra: Partial<WorldSnapshot> = {}): WorldSnapshot {
	return {
		connected: true,
		headquarters: [
			{
				id: HQ,
				name: "Orla",
				wings: [
					{
						repository: "/r/apple-pi",
						name: "apple-pi",
						headcount: characters.filter((c) => c.place.kind === "wing").length,
					},
				],
			},
		],
		characters,
		...extra,
	};
}

interface OverlayView {
	kind: string;
	x: number;
	y: number;
	frame: number;
	alpha: number;
}
const overlays = (page: Page) => view<OverlayView[]>(page, "overlays()");

/** Travel to a place from the Places tab (opening the tab when it is not open), and wait to arrive. */
async function travel(page: Page, label: RegExp, key: string) {
	if (!(await page.getByRole("tabpanel", { name: "Places" }).count())) await tab(page, "Places");
	await page.getByRole("button", { name: label }).click();
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe(key), { timeout: 5000 });
	await page.waitForTimeout(500);
}

const wing = (repository: string, headcount: number, dormant = 0) => ({
	repository,
	name: repository.split("/").pop()!,
	headcount,
	dormant,
});

test("fire, water, and warm lights animate in their slots in every place", async () => {
	const cast = [ORLA, worker("pi-docs", 1, { run: "running_tool", status: "working" })];
	const { page, errors } = await openWorld(world(cast));
	try {
		const places: [string, RegExp, string, string][] = [
			["headquarters", /^Guild hall/, `headquarters:${HQ}`, "aw-04-hall"],
			["common-room", /^Common room/, `common-room:${HQ}`, "aw-04-common-room"],
			["gallery", /^Gallery of wings/, `gallery:${HQ}`, "aw-04-gallery"],
			["wing-small", /^apple-pi wing/, `wing:${HQ}:/r/apple-pi`, "aw-04-wing-small"],
			["square", /^Village square/, "square", "aw-04-square"],
		];
		for (const [data, label, key, name] of places) {
			if (data !== "headquarters") await travel(page, label, key);
			// Fidget objects are drawn by their own module and read through `fidgets()` (world-fidgets.test.ts).
			const slots = fantasy(data).overlaySlots.filter((slot) => slot.kind !== "banner" && slot.kind !== "fidget");
			const before = await overlays(page);
			// One overlay per slot (the gallery shows the niches it has room for).
			const kinds = (list: { kind: string }[]) => list.map((o) => o.kind).sort();
			if (data === "gallery") expect(before.length).toBeGreaterThan(0);
			else
				expect(kinds(before)).toEqual(
					kinds(slots)
						.concat(slots.filter((s) => s.kind === "fire").map(() => "glow"))
						.sort(),
				);
			const seen = new Map<number, Set<string>>();
			for (let i = 0; i < 12; i++) {
				for (const [k, o] of (await overlays(page)).entries())
					seen.set(k, (seen.get(k) ?? new Set()).add(`${o.frame}:${o.alpha.toFixed(3)}`));
				await page.waitForTimeout(90);
			}
			// Every fire, water, and glow changes while we watch.
			for (const [k, states] of seen) expect(states.size, `${data} overlay ${k}`).toBeGreaterThan(1);
			await zoomOut(page);
			await shot(page, name);
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 90000);

test("a wing's door is open while agents work there, closed while they sleep at the inn, and boarded with nobody", async () => {
	const snapshot: WorldSnapshot = {
		connected: true,
		headquarters: [
			{
				id: HQ,
				name: "Orla",
				wings: [wing("/r/apple-pi", 1), wing("/r/billing-service", 0, 2), wing("/r/legacy-auth", 0, 0)],
			},
		],
		characters: [ORLA, worker("pi-docs", 1)],
	};
	const { page, push, errors } = await openWorld(snapshot);
	try {
		await travel(page, /^Gallery of wings/, `gallery:${HQ}`);
		const doors = async () =>
			((await view(page, "gallery()")) as { wings: { name: string; door: string }[] }).wings.map(
				(w) => `${w.name}:${w.door}`,
			);
		expect(await doors()).toEqual(["apple-pi:open", "billing-service:closed", "legacy-auth:boarded"]);
		await shot(page, "aw-04-gallery-doors");
		// apple-pi's last agent stops: its door closes.
		await push({
			...snapshot,
			headquarters: [
				{ ...snapshot.headquarters[0], wings: [wing("/r/apple-pi", 0, 1), ...snapshot.headquarters[0].wings.slice(1)] },
			],
			characters: [ORLA],
		});
		await vi.waitFor(async () => expect((await doors())[0]).toBe("apple-pi:closed"), { timeout: 3000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("banner names fit their banners and stay legible, even for long repository names", async () => {
	const names = [
		"api",
		"apple-pi",
		"billing-service",
		"a-very-long-repository-name",
		"customer_identity_and_access_management",
		"monorepo.frontend.web-app",
		"supercalifragilisticexpialidocious",
	];
	const snapshot: WorldSnapshot = {
		connected: true,
		headquarters: [{ id: HQ, name: "Orla", wings: names.map((n) => wing(`/r/${n}`, 0, 1)) }],
		characters: [ORLA],
	};
	const { page, errors } = await openWorld(snapshot);
	try {
		await travel(page, /^Gallery of wings/, `gallery:${HQ}`);
		const banners = (await view(page, "banners()")) as {
			name: string;
			text: string;
			size: number;
			fits: boolean;
			abbreviated: boolean;
		}[];
		expect(banners.map((b) => b.name)).toEqual(names);
		for (const banner of banners) {
			expect(banner.fits, banner.name).toBe(true);
			// Never smaller than reads at the default zoom.
			expect(banner.size, banner.name).toBeGreaterThanOrEqual(12);
			// What is stitched is the name itself, broken into lines, or with words cut short ("repos.") in order, each the
			// start of the word it stands for.
			const words = banner.name.split(/[-_./ ]/);
			if (!banner.abbreviated) expect(banner.text.replace(/\n/g, "")).toBe(banner.name);
			else {
				// Word by word: whole, or its first three or more letters and a full stop; at the very end, cut short with
				// an ellipsis only when nothing else fits.
				let rest = banner.text.replace(/\n/g, "");
				for (const word of words) {
					rest = rest.replace(/^[-_./ ]+/, "");
					const cut = /^(\w{3,})\./.exec(rest);
					if (rest.startsWith(word)) rest = rest.slice(word.length);
					else if (cut && word.startsWith(cut[1])) rest = rest.slice(cut[0].length);
					else {
						expect(rest, banner.name).toMatch(/^\w+\u2026$/);
						expect(word.startsWith(rest.slice(0, -1)), banner.name).toBe(true);
						rest = "";
						break;
					}
				}
				expect(rest.replace(/^[-_./ ]+/, ""), banner.name).toBe("");
			}
		}
		// Short names are stitched whole and large: a short word on one line, a short name broken after its separator.
		expect(banners.find((b) => b.name === "api")).toMatchObject({ text: "api", size: 15 });
		expect(banners.find((b) => b.name === "apple-pi")).toMatchObject({ text: "apple-\npi", size: 15 });
		// The cloth answers the pointer with the whole name, however short it was stitched.
		const long = "customer_identity_and_access_management";
		expect(banners.find((b) => b.name === long)!.abbreviated).toBe(true);
		await page.evaluate((name) => (window as any).agentWorldView.lookAt(`${name} wing`), long);
		await page.waitForTimeout(400);
		const door = ((await view(page, "doors()")) as { name: string; x: number; y: number }[]).find(
			(d) => d.name === `${long} wing`,
		)!;
		const zoom = ((await view(page, "zoom()")) as { zoom: number }).zoom;
		await page.mouse.move(door.x, door.y - 2.4 * 48 * zoom);
		await page.locator(".pointer-hover").getByText(long).waitFor({ timeout: 2000 });
		await page.evaluate(() => (window as any).agentWorldView.lookAt("a-very-long-repository-name wing"));
		await page.waitForTimeout(400);
		await shot(page, "aw-04-banners");
		await page.evaluate(() => (window as any).agentWorldView.lookAt("supercalifragilisticexpialidocious wing"));
		await page.waitForTimeout(400);
		await shot(page, "aw-04-banners-east");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a door at the edge under the interface comes out from under the panels when the avatar walks to it", async () => {
	const { page, errors } = await openWorld(world([ORLA]), { clickThrough: true });
	const covered = async (door: string) => {
		const target = ((await view(page, "doors()")) as { name: string; x: number; y: number }[]).find(
			(d) => d.name === door,
		)!;
		// The panels let clicks through in this test, so look at where they are drawn rather than hit-testing.
		return page.evaluate(
			([x, y]) =>
				[...document.querySelectorAll(".aw-side, .aw-top-right, .aw-chat")].some((element) => {
					const r = element.getBoundingClientRect();
					return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
				}),
			[target.x, target.y],
		);
	};
	try {
		// The archway to the gallery is at the hall's east edge, under the side panel at first sight of it.
		const hall = fantasy("headquarters");
		const archway = hall.doors.find((d) => d.name === "Archway to the gallery")!;
		const [sx, sy] = await screen(page, ...archway.standAt);
		await page.mouse.click(sx, sy);
		await vi.waitFor(async () => expect((await avatar(page))!.moving).toBe(false), { timeout: 10000 });
		await page.waitForTimeout(1500); // the camera eases over
		expect(await covered("Archway to the gallery")).toBe(false);
		await shot(page, "aw-04-archway-uncovered");
		// The hall doors at the bottom, past the chatbox.
		const doors = hall.doors.find((d) => d.name === "Hall doors")!;
		const [hx, hy] = await screen(page, ...doors.standAt);
		await page.mouse.click(hx, hy);
		await vi.waitFor(async () => expect((await avatar(page))!.moving).toBe(false), { timeout: 10000 });
		await page.waitForTimeout(1500);
		expect(await covered("Hall doors")).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("coming back to a place draws its whole painting again, not one of the furniture pieces cut from it", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		expect(await view(page, "paintingFrames()")).toEqual(["__BASE"]);
		await travel(page, /^Common room/, `common-room:${HQ}`);
		await travel(page, /^Guild hall/, `headquarters:${HQ}`);
		// The hall's furniture pieces are frames of its painting; the painting itself is still drawn whole.
		expect(await view(page, "paintingFrames()")).toEqual(["__BASE"]);
		await shot(page, "aw-17-hall-again");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("zoomed in, character sprites are drawn crisp; zoomed out, they and the painting are smoothed", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		const filters = () => view(page, "filters()") as Promise<Record<string, boolean>>;
		const zoomTo = async (dy: number) => {
			await page.mouse.move(500, 300);
			for (let i = 0; i < 6; i++) await page.mouse.wheel(0, dy);
			await vi.waitFor(async () => {
				const { zoom, target } = (await view(page, "zoom()")) as { zoom: number; target: number };
				expect(Math.abs(zoom - target)).toBeLessThan(1e-3);
			});
			await page.waitForTimeout(600);
		};
		await zoomTo(-400);
		const near = await filters();
		// The avatar's and Orla's sheets: drawn larger than their own pixels, so nearest, never blurred.
		const sprites = Object.keys(near).filter((key) => key.startsWith("look:"));
		expect(sprites.length).toBeGreaterThan(1);
		for (const key of sprites) expect(near[key], key).toBe(true);
		await zoomTo(400);
		const far = await filters();
		for (const key of [...sprites, "painting:headquarters"]) expect(far[key], key).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("in the tech office the corridor's sign plates hang clear of the door frames, and long names stay on the plate", async () => {
	const names = ["apple-pi", "customer-billing-reconciliation-service", "supercalifragilisticexpialidocious"];
	const snapshot: WorldSnapshot = {
		connected: true,
		theme: "tech-office",
		headquarters: [{ id: HQ, name: "Orla", wings: names.map((n) => wing(`/r/${n}`, 0, 1)) }],
		characters: [ORLA],
	};
	const { page, errors } = await openWorld(snapshot);
	try {
		await travel(page, /^Project corridor/, `gallery:${HQ}`);
		const banners = (await view(page, "banners()")) as { name: string; fits: boolean; size: number }[];
		expect(banners.map((b) => b.name)).toEqual(names);
		for (const banner of banners) {
			expect(banner.fits, banner.name).toBe(true);
			expect(banner.size, banner.name).toBeGreaterThanOrEqual(12);
		}
		// The plate (drawn `tiles` wide from its rod, as tall as its sprite's shape) ends above the door frame.
		const read = (file: string) =>
			JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/tech-office/${file}`, import.meta.url)), "utf8"));
		const gallery = read("places/gallery.json");
		const { tiles } = read("theme.json").world.banner;
		const [w, h] = [277, 156]; // overlays/banner-cream.png
		expect(gallery.niches.banner[1] + (tiles * h) / w).toBeLessThanOrEqual(gallery.niches.door[1] - 0.15);
		await shot(page, "aw-31-tech-corridor-plates");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);
