import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { AmbientMember, ThemeManifest } from "../src/theme-pack.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import type { PlaceData, Point } from "../web/theme.js";

// Seam 2 for ambient characters (ticket 08): the committed, built world UI in headless Chrome over a fixture backend.
// Each pack's cast stands where its place data says, answers the pointer (Talk to, Examine), says its lines in turn in
// the small dialogue box, reacts when clicked several times in a row, and with life on, strolls (unless posted) and
// now and then barks.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-ambient-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
const placeOf = (theme: string, name: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${theme}/places/${name}.json`, import.meta.url)), "utf8"));
const manifestOf = (theme: string): ThemeManifest =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${theme}/theme.json`, import.meta.url)), "utf8"));

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
const BRAM: Character = {
	id: "bram",
	name: "Bram",
	role: "independent",
	place: { kind: "square" },
	startedAt: NOW - 8_000_000,
	facts: facts({ run: "running_tool", status: "working" }),
};
const world = (theme: string): WorldSnapshot =>
	({ connected: true, headquarters: [], characters: [BRAM], dormant: [], mail: [], theme }) as WorldSnapshot;

async function openWorld(first: WorldSnapshot, pace?: number) {
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
		([snapshot, speed]) => {
			const w = window as any;
			if (speed !== null) w.agentWorldLife = { pace: speed };
			w.agentWorld = {
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
				credentialStatus: async () => ({ atlassian: null, slack: null }),
				outsideWrites: async () => [],
				onOutsideWrite: () => () => {},
			};
		},
		[first, pace ?? null] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(
		async () =>
			expect(await page.evaluate(() => (window as any).agentWorldView?.avatar()), errors.join("; ")).toBeTruthy(),
		{ timeout: 15000 },
	);
	await page.waitForTimeout(500);
	// Clicks reach the world through the interface's panels (they still draw for screenshots).
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	return { page, errors };
}

interface Cast {
	id: string;
	name: string;
	look: string;
	x: number;
	y: number;
	moving: boolean;
	idle: string | null;
	wander: string;
	interest: string | null;
	bark: string | null;
	home: Point;
	stays: boolean;
}
interface Walking {
	x: number;
	y: number;
	moving: boolean;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const cast = (page: Page) => view<Cast[]>(page, "ambient()");
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const hoverText = (page: Page) => page.evaluate(() => document.querySelector(".pointer-hover")?.textContent ?? null);
const noticeText = (page: Page) => page.evaluate(() => document.querySelector(".notice")?.textContent ?? null);
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const said = (member: AmbientMember, line: string) => `${member.name}: \u201c${line}\u201d`;

/** Zoom out as far as the wheel goes, so the whole place shows. */
async function zoomOut(page: Page) {
	await page.mouse.move(640, 400);
	for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 500);
	await page.waitForTimeout(900);
}

/** The middle of someone's body on screen. */
const bodyOf = async (page: Page, id: string) => {
	const one = (await cast(page)).find((c) => c.id === id)!;
	return screen(page, one.x, one.y - 0.8);
};

async function stillAvatar(page: Page) {
	await vi.waitFor(async () => expect((await view<Walking>(page, "avatar()")).moving).toBe(false), {
		timeout: 20_000,
		interval: 100,
	});
}

async function shot(page: Page, name: string, around?: Point) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(200);
	if (!around) return page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
	const [sx, sy] = await screen(page, ...around);
	const clip = { x: Math.max(0, sx - 300), y: Math.max(0, sy - 230), width: 600, height: 330 };
	await page.screenshot({ path: join(SHOTS, `${name}.png`), clip, animations: "disabled" });
}

describe.each(THEMES)("%s", (theme) => {
	const manifest = manifestOf(theme);
	const members = manifest.ambient ?? {};
	const square = placeOf(theme, "square");

	test("the square's cast stands at home, answers the pointer, talks in turn, and reacts when pestered", {
		timeout: 90_000,
	}, async () => {
		const { page, errors } = await openWorld(world(theme));
		try {
			await zoomOut(page);
			const here = await cast(page);
			expect(here.map((c) => c.id).sort()).toEqual((square.ambient ?? []).map((e) => e.cast).sort());
			for (const one of here) {
				const placement = square.ambient!.find((e) => e.cast === one.id)!;
				expect(one).toMatchObject({ name: members[one.id].name, look: members[one.id].look, moving: false });
				expect([one.x, one.y]).toEqual(placement.at);
				// The pointer over it offers Talk to first, and Examine.
				await page.mouse.move(...(await bodyOf(page, one.id)));
				await vi.waitFor(async () => expect(await hoverText(page)).toBe(`Talk to ${one.name} / 2 more options`), {
					timeout: 3000,
				});
				expect((await view<{ cursor: string }>(page, "pointer()")).cursor).toBe("act");
			}
			await shot(page, `aw-ambient-${theme}-square`);

			// A left click talks: the avatar walks up and it says its first line, then its next.
			const talker = here.find((c) => !c.stays)!;
			const member = members[talker.id];
			await page.mouse.click(...(await bodyOf(page, talker.id)));
			await stillAvatar(page);
			await vi.waitFor(async () => expect(await noticeText(page)).toBe(said(member, member.lines[0])), {
				timeout: 3000,
			});
			const avatar = await view<Walking>(page, "avatar()");
			expect(dist([avatar.x, avatar.y], talker.home)).toBeLessThan(2.2);
			await shot(page, `aw-ambient-${theme}-talk`, talker.home);
			await page.waitForTimeout(2000);
			await page.mouse.click(...(await bodyOf(page, talker.id)));
			await vi.waitFor(async () => expect(await noticeText(page)).toBe(said(member, member.lines[1])), {
				timeout: 3000,
			});
			// Clicked again and again: its reaction (and a gesture).
			await page.waitForTimeout(2000);
			for (let i = 0; i < 3; i++) {
				await page.mouse.click(...(await bodyOf(page, talker.id)));
				await page.waitForTimeout(250);
			}
			await vi.waitFor(async () => expect(await noticeText(page)).toBe(said(member, member.reactions[0])), {
				timeout: 3000,
			});
			const reacting = (await cast(page)).find((c) => c.id === talker.id)!;
			expect(reacting.idle).toBe(member.gesture ?? "shrug");
			await shot(page, `aw-ambient-${theme}-reaction`, talker.home);

			// The menu: Talk to and Examine; Examine says what it is.
			await page.waitForTimeout(2000);
			await page.mouse.click(...(await bodyOf(page, talker.id)), { button: "right" });
			const items = page.locator(".pointer-menu [role=menuitem]");
			await items.first().waitFor({ timeout: 3000 });
			const texts = await items.allTextContents();
			expect(texts.filter((t) => t.endsWith(member.name))).toEqual([
				`Talk to ${member.name}`,
				`Examine ${member.name}`,
			]);
			await items
				.filter({ hasText: `Examine ${member.name}` })
				.first()
				.dispatchEvent("click");
			await vi.waitFor(async () => expect(await noticeText(page)).toBe(member.examine), { timeout: 3000 });
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test.each(["inn", "street"])(
		"the %s has its own cast member, who talks there too",
		{ timeout: 60_000 },
		async (place) => {
			const data = placeOf(theme, place);
			const { page, errors } = await openWorld(world(theme));
			try {
				await page.getByRole("tab", { name: "Places", exact: true }).dispatchEvent("click");
				const label = manifest.labels[place];
				await page.getByRole("button", { name: new RegExp(`^${label}`) }).dispatchEvent("click");
				await vi.waitFor(async () => expect(await view(page, "place()")).toBe(place), { timeout: 8000 });
				await page.keyboard.press("Escape");
				await zoomOut(page);
				const here = await cast(page);
				expect(here.map((c) => c.id)).toEqual((data.ambient ?? []).map((e) => e.cast));
				const [one] = here;
				const member = members[one.id];
				await page.mouse.click(...(await bodyOf(page, one.id)));
				await stillAvatar(page);
				await vi.waitFor(async () => expect(await noticeText(page)).toBe(said(member, member.lines[0])), {
					timeout: 3000,
				});
				await shot(page, `aw-ambient-${theme}-${place}`, one.home);
				expect(errors).toEqual([]);
			} finally {
				await page.close();
			}
		},
	);
});

test("with life on, the cast strolls to points of interest (the posted guard stays) and barks now and then", {
	timeout: 90_000,
}, async () => {
	const square = placeOf("fantasy", "square");
	const members = manifestOf("fantasy").ambient ?? {};
	const { page, errors } = await openWorld(world("fantasy"), 12);
	try {
		await zoomOut(page);
		const interest = square.interest ?? [];
		const visited = new Set<string>();
		const barks = new Map<string, string>();
		let shotBark = false;
		const start = Date.now();
		while (Date.now() - start < 30_000) {
			const now = await cast(page);
			for (const one of now) {
				if (one.stays) expect([one.x, one.y], `${one.id} stays at its post`).toEqual(one.home);
				const at: Point = [one.x, one.y];
				if (!one.moving && dist(at, one.home) > 0.05) {
					const point = interest.find((p) => dist(p.at, at) < 0.05);
					expect(point, `${one.id} rests at ${at}, which is no point of interest`).toBeDefined();
					visited.add(`${one.id}@${point!.name}`);
				}
				if (one.bark) {
					barks.set(one.id, one.bark);
					if (!shotBark) {
						shotBark = true;
						await shot(page, "aw-ambient-fantasy-bark", [one.x, one.y - 1]);
					}
				}
			}
			if (visited.size >= 2 && barks.size >= 1 && Date.now() - start > 12_000) break;
			await page.waitForTimeout(120);
		}
		expect(visited.size, "the cast strolls to points of interest").toBeGreaterThanOrEqual(1);
		expect(barks.size, "someone barks").toBeGreaterThanOrEqual(1);
		for (const [id, line] of barks) expect(members[id].barks).toContain(line);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
