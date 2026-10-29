import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, ThemeChoice, WorldSnapshot } from "../src/world.js";

// Seam 2 for theme packs: the committed, built world UI in headless Chrome against a fixture backend. A broken pack
// fails safely (the world opens in the last good theme and says why); Settings switches theme live, changing only
// presentation; and the same world reads the same in every theme.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there, as aw-<ticket>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(500);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const HQ = "orla";
const T0 = Date.now() - 3_600_000;
const at = (n: number) => T0 + n * 60_000;
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
		git: { repository: "/r/apple-pi", worktree: "/r/apple-pi", branch: "main" },
		cwd: "/r/apple-pi",
		reportsTo: HQ,
		model: null,
		contextTokens: null,
		contextWindow: null,
		cost: 0,
		tmux: null,
		...over,
	};
}
const CAST: Character[] = [
	{
		id: HQ,
		name: "Orla",
		role: "coordinator",
		place: { kind: "headquarters", headquarters: HQ },
		startedAt: at(0),
		facts: facts({ reportsTo: null, git: null }),
	},
	{
		id: "pi-tests",
		name: "pi-tests",
		role: "worker",
		place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
		startedAt: at(1),
		facts: facts({ run: "running_tool", status: "working", tool: { name: "bash", arg: "npm test", since: at(2) } }),
	},
	{
		id: "pi-docs",
		name: "pi-docs",
		role: "worker",
		place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
		startedAt: at(2),
		facts: facts({ status: "asking", asking: { kind: "select", text: "Which branch?" }, needsYouSince: at(3) }),
	},
	{
		id: "solo",
		name: "solo",
		role: "independent",
		place: { kind: "square" },
		startedAt: at(3),
		facts: facts({ reportsTo: null, unseen: true, needsYouSince: at(4) }),
	},
];
const world = (theme?: string): WorldSnapshot => ({
	connected: true,
	theme: theme ?? null,
	headquarters: [{ id: HQ, name: "Orla", wings: [{ repository: "/r/apple-pi", name: "apple-pi", headcount: 2 }] }],
	characters: CAST,
	dormant: [],
	mail: [],
});

/**
 * Open the world with a fixture backend. `themes` is what its pack check reports (left out, the backend has no list);
 * `serve` replaces files of the served packs (null answers 404), as a broken pack on disk would.
 */
async function openWorld(
	first: WorldSnapshot,
	options: { themes?: ThemeChoice[]; serve?: Record<string, string | null>; lastGood?: string } = {},
) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route(`${ORIGIN}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		const served = options.serve?.[path.slice(1)];
		if (served === null) return route.fulfill({ status: 404 });
		if (served !== undefined) return route.fulfill({ body: served, contentType: contentType(path) });
		// A pack copied from fantasy under another name serves fantasy's files.
		const file = appFile(appDir, path.replace(/^\/themes\/broken-[a-z]+\//, "/themes/fantasy/"));
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		([snapshot, themes, lastGood]) => {
			const listeners = new Set<(s: unknown) => void>();
			let current = snapshot as any;
			const w = window as any;
			w.chosenThemes = [];
			if (lastGood) localStorage.setItem("agent-world:last-good-theme", lastGood as string);
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
				...(themes ? { themes: async () => themes } : {}),
				async setTheme(id: string) {
					w.chosenThemes.push(id);
					current = { ...current, theme: id };
					for (const listener of listeners) listener(current);
					return { ok: true };
				},
			};
		},
		[first, options.themes ?? null, options.lastGood ?? null] as const,
	);
	await page.goto(`${ORIGIN}/index.html?world`);
	await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).agentWorldView.place())).toBeTruthy(), {
		timeout: 20000,
	});
	await page.locator(".aw-side").waitFor({ timeout: 5000 });
	return { page, errors };
}

const wearing = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const title = (page: Page) => page.locator(".place-title strong").textContent();
const fantasyManifest = readFileSync(fileURLToPath(new URL("../themes/fantasy/theme.json", import.meta.url)), "utf8");
const good = (id: string, name: string): ThemeChoice => ({ id, name, description: null, problems: [] });

test("a pack with a missing file falls back to the first theme and says on screen which file and why", {
	timeout: 30_000,
}, async () => {
	const { page, errors } = await openWorld(world("broken-inn"), {
		serve: {
			"themes/broken-inn/theme.json": fantasyManifest.replace('"id": "fantasy"', '"id": "broken-inn"'),
			"themes/broken-inn/places/inn.json": null,
		},
	});
	try {
		expect(await wearing(page)).toBe("fantasy");
		expect(await title(page)).toBe("Guild hall");
		const notice = page.getByRole("alert");
		await expect(notice.textContent()).resolves.toContain(
			"The broken inn theme is broken, so the world wears Fantasy.",
		);
		await expect(notice.textContent()).resolves.toContain("places/inn.json: is missing");
		await shot(page, "aw-18-fallback-notice");
		// It stays until dismissed.
		await page.waitForTimeout(3000);
		expect(await notice.isVisible()).toBe(true);
		await notice.getByRole("button", { name: "Dismiss" }).click();
		expect(await page.getByRole("alert").count()).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("a pack the backend's check found broken is not loaded; the world wears the last good theme instead", {
	timeout: 30_000,
}, async () => {
	const { page, errors } = await openWorld(world("broken-bed"), {
		themes: [
			good("fantasy", "Fantasy"),
			{
				id: "broken-bed",
				name: "Broken bed",
				description: null,
				problems: [{ file: "overlays/bed.png", fault: "is missing" }],
			},
		],
	});
	try {
		expect(await wearing(page)).toBe("fantasy");
		await expect(page.getByRole("alert").textContent()).resolves.toContain("overlays/bed.png: is missing");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("a manifest that is not JSON fails the same way", { timeout: 30_000 }, async () => {
	const { page } = await openWorld(world("broken-json"), {
		serve: { "themes/broken-json/theme.json": "{ id: broken" },
	});
	try {
		expect(await wearing(page)).toBe("fantasy");
		await expect(page.getByRole("alert").textContent()).resolves.toContain("theme.json: is not valid JSON");
	} finally {
		await page.close();
	}
});

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
type Figure = { id: string; badge: string | null; pose: string; moving: boolean };
/** Who is in the place and how each shows its state, once everyone stands still. */
async function cast(page: Page) {
	let figures: Figure[] = [];
	await vi.waitFor(
		async () => {
			figures = await view<Figure[]>(page, "figures()");
			expect(figures.length).toBeGreaterThan(0);
			expect(figures.every((f) => !f.moving)).toBe(true);
		},
		{ timeout: 10000 },
	);
	return figures.map(({ id, badge, pose }) => ({ id, badge, pose })).sort((a, b) => a.id.localeCompare(b.id));
}
async function tab(page: Page, name: string) {
	const button = page.getByRole("tab", { name, exact: true });
	if ((await button.getAttribute("aria-selected")) !== "true") await button.click();
}
async function travel(page: Page, title: string, place: string) {
	await tab(page, "Places");
	await page.locator(`.aw-place .aw-row-main[title="Travel to ${title}"]`).click();
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe(place), { timeout: 10000 });
}
/** The icon a side-panel tab wears: the pack's SVG (its mask) or "built in" for the world's own drawing. */
const tabIcon = (page: Page, name: string) =>
	page.getByRole("tab", { name, exact: true }).evaluate((tab) => {
		const icon = tab.querySelector<HTMLElement>(".aw-tab-icon");
		if (!icon) return tab.querySelector("svg") ? "built in" : "none";
		return getComputedStyle(icon).maskImage;
	});
const manifest = (id: string) =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${id}/theme.json`, import.meta.url)), "utf8"));

test("Settings switches theme live: the same place, characters, states, selection, and open panel; only the look changes", {
	timeout: 60_000,
}, async () => {
	const tech = manifest("tech-office");
	const { page, errors } = await openWorld(world(), {
		themes: [good("fantasy", "Fantasy"), good("tech-office", tech.name)],
	});
	try {
		await travel(page, "apple-pi wing", `wing:${HQ}:/r/apple-pi`);
		const before = await cast(page);
		await tab(page, "Agents");
		await page.locator(".aw-row-main", { hasText: "pi-tests" }).click();
		await tab(page, "Settings");
		await shot(page, "aw-19-settings-fantasy");
		// The tabs wear the pack's own icons where it draws one (Work and Places); the rest wear the world's own.
		expect(await tabIcon(page, "Work")).toContain("themes/fantasy/interface/icons/work.svg");
		expect(await tabIcon(page, "Places")).toContain("themes/fantasy/interface/icons/places.svg");
		expect(await tabIcon(page, "Agents")).toBe("built in");

		await page.locator("label", { hasText: tech.name }).click();
		await vi.waitFor(async () => expect(await wearing(page)).toBe("tech-office"), { timeout: 10000 });
		// Kept once worn.
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).chosenThemes)).toEqual(["tech-office"]),
		);
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe(`wing:${HQ}:/r/apple-pi`), {
			timeout: 10000,
		});
		expect(await cast(page)).toEqual(before);
		await vi.waitFor(async () => expect(await title(page)).toBe(`apple-pi ${tech.labels.wing}`), { timeout: 5000 });
		// The skin and the pack's own lines are the new theme's.
		expect(await page.evaluate(() => document.querySelector("link.aw-theme-skin")?.getAttribute("href"))).toContain(
			"themes/tech-office/",
		);
		expect(await tabIcon(page, "Work")).toContain("themes/tech-office/interface/icons/work.svg");
		expect(await tabIcon(page, "Places")).toContain("themes/tech-office/interface/icons/places.svg");
		// The open tab and the selection stay.
		expect(await page.getByRole("tab", { name: "Settings", exact: true }).getAttribute("aria-selected")).toBe("true");
		await shot(page, "aw-19-settings-tech");
		await tab(page, "Agents");
		await expect(page.locator(".aw-row-selected .aw-row-name").textContent()).resolves.toBe("pi-tests");

		// A conversation open while the theme changes stays open, in the new look.
		await page.locator(".aw-row-main", { hasText: "pi-docs" }).click();
		await page.getByRole("button", { name: "Talk to pi-docs" }).first().click();
		const panel = page.getByRole("dialog", { name: "Conversation with pi-docs" });
		await panel.waitFor({ timeout: 5000 });
		await expect(panel.getByRole("img").getAttribute("src")).resolves.toContain("themes/tech-office/");
		await page.evaluate(() => (window as any).agentWorld.setTheme("fantasy"));
		await vi.waitFor(async () => expect(await wearing(page)).toBe("fantasy"), { timeout: 10000 });
		expect(await panel.isVisible()).toBe(true);
		await expect(panel.getByRole("img").getAttribute("src")).resolves.toContain("themes/fantasy/");
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe(`wing:${HQ}:/r/apple-pi`), {
			timeout: 10000,
		});
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("a theme found broken when chosen leaves the world as it was and says why", { timeout: 30_000 }, async () => {
	const { page, errors } = await openWorld(world(), {
		themes: [good("fantasy", "Fantasy"), good("broken-inn", "Broken inn")],
		serve: {
			"themes/broken-inn/theme.json": fantasyManifest.replace('"id": "fantasy"', '"id": "broken-inn"'),
			"themes/broken-inn/places/inn.json": null,
		},
	});
	try {
		await tab(page, "Settings");
		await page.locator("label", { hasText: "Broken inn" }).click();
		await expect(page.getByRole("alert").textContent()).resolves.toContain("places/inn.json: is missing");
		expect(await wearing(page)).toBe("fantasy");
		expect(await title(page)).toBe("Guild hall");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("the world opens in the theme the operator kept, and a broken one falls back to the last good theme", {
	timeout: 60_000,
}, async () => {
	const kept = await openWorld(world("tech-office"));
	try {
		expect(await wearing(kept.page)).toBe("tech-office");
		expect(await title(kept.page)).toBe(manifest("tech-office").labels.headquarters);
		expect(kept.errors).toEqual([]);
	} finally {
		await kept.page.close();
	}
	const fallback = await openWorld(world("broken-inn"), {
		lastGood: "tech-office",
		serve: { "themes/broken-inn/theme.json": null },
	});
	try {
		expect(await wearing(fallback.page)).toBe("tech-office");
		await expect(fallback.page.getByRole("alert").textContent()).resolves.toContain("so the world wears Tech office");
	} finally {
		await fallback.page.close();
	}
});

/** What the world shows of `character`'s actions: its right-click menu over it in the world, then closed. */
async function menuOn(page: Page, id: string) {
	const figure = (await view<{ id: string; x: number; y: number }[]>(page, "figures()")).find((f) => f.id === id)!;
	const [x, y] = (await view<[number, number]>(page, `toScreen(${figure.x}, ${figure.y - 0.8})`))!;
	await page.mouse.click(x, y, { button: "right" });
	const menu = page.getByRole("menu");
	await menu.waitFor({ timeout: 3000 });
	const items = await menu.getByRole("menuitem").allTextContents();
	await page.keyboard.press("Escape");
	return items;
}

test("the same world reads the same in all three themes: the same characters, states, and actions", {
	timeout: 120_000,
}, async () => {
	const seen: Record<string, unknown> = {};
	for (const theme of ["fantasy", "tech-office", "anime-school"]) {
		const { page, errors } = await openWorld(world(theme));
		try {
			expect(await wearing(page)).toBe(theme);
			const labels = manifest(theme).labels;
			await travel(page, `apple-pi ${labels.wing}`, `wing:${HQ}:/r/apple-pi`);
			await shot(page, `aw-20-${theme}-wing`);
			const figures = await cast(page);
			// Zoomed out to see the whole room, so every character is on screen.
			await page.mouse.move(500, 400);
			for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
			await page.waitForTimeout(700);
			// The world's own panels cover part of it; right-click the characters themselves.
			const through = await page.addStyleTag({
				content: ".aw-interface, .aw-interface * { pointer-events: none !important; }",
			});
			const menus = { "pi-tests": await menuOn(page, "pi-tests"), "pi-docs": await menuOn(page, "pi-docs") };
			await through.evaluate((element) => (element as Element).remove());
			await tab(page, "Agents");
			const rows = await page
				.locator(".aw-row")
				.evaluateAll((items) =>
					items.map((item) => [
						item.querySelector(".aw-row-name")?.textContent,
						item.className.replace(/ aw-row-selected/, ""),
					]),
				);
			const orbs = await page.locator(".aw-orb .aw-num").allTextContents();
			seen[theme] = { figures, menus, rows, orbs };
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	}
	expect(seen["tech-office"]).toEqual(seen.fantasy);
	expect(seen["anime-school"]).toEqual(seen.fantasy);
	const fantasy = seen.fantasy as { figures: unknown[]; menus: Record<string, string[]>; rows: unknown[] };
	expect(fantasy.figures).toHaveLength(2);
	expect(fantasy.menus["pi-docs"]).toEqual(expect.arrayContaining(["Talk to pi-docs", "Examine pi-docs"]));
	expect(fantasy.rows).toHaveLength(4);
});
