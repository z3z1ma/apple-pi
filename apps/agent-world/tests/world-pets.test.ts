import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import {
	type OverlaySlot,
	PET_FRAME_ORDER,
	type PlaceData,
	petArt,
	slotStyle,
	type ThemeManifest,
} from "../src/theme-pack.js";
import type { Character, WorldSnapshot } from "../src/world.js";
import { PERSON_TILES } from "../web/game/walker.js";

// Seam 2 for pets varied and to scale (alive pass, ticket 03): the committed, built world UI in headless Chrome over a
// fixture backend. In each theme every pet is its own animal in its own place, drawn at its kind's height beside a
// standing character (a cat about a third, a dog about half, a small animal less), and each answers hover, a left
// click, and its menu with its own verbs, poses, and Examine line; a pet asleep purrs on in its sleep when petted and
// wakes to play. None of it calls the backend.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves close-ups there as aw-03-<theme>-<look>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
const read = <T>(path: string): T => JSON.parse(readFileSync(join(appDir, path), "utf8"));

/** How tall each kind of pet sits beside a standing character (shares of its height). */
const SIZES = { cat: [0.28, 0.38], dog: [0.4, 0.56], small: [0.12, 0.3], perched: [0.36, 0.5] } as const;
const ANIMAL: Record<string, Record<string, keyof typeof SIZES>> = {
	fantasy: { "": "cat", "cat-black": "cat", hound: "dog", owl: "small", rabbit: "small" },
	"tech-office": { "": "dog", "cat-grey": "cat", parrot: "perched", hamster: "small", hedgehog: "small" },
	"anime-school": { "": "cat", shiba: "dog", "rabbit-white": "small", crow: "small", tanuki: "cat" },
};

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const HQ = "orla";
const ORLA = {
	id: HQ,
	name: "Orla",
	role: "coordinator",
	place: { kind: "headquarters", headquarters: HQ },
	startedAt: Date.now() - 9_000_000,
	facts: {
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
	},
} as unknown as Character;
const world = (theme: string) =>
	({
		connected: true,
		theme,
		headquarters: [{ id: HQ, name: "Orla", wings: [] }],
		characters: [ORLA],
		dormant: [],
		mail: [],
	}) as unknown as WorldSnapshot;

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
			openLink: async () => ({ ok: true }),
			// The forge reads its benches on entering: none open.
			pullRequests: async () => ({ ok: true, pullRequests: [] }),
			outsideWrites: async () => [],
			onOutsideWrite: () => () => {},
		};
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
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	return { page, errors };
}

interface PetView {
	index: number;
	kind: string;
	name: string;
	x: number;
	y: number;
	h: number;
	art: string;
	look: string | null;
	asleep: boolean;
	playing: string | null;
	particles: number;
	onFloor: boolean;
}
interface AvatarView {
	x: number;
	y: number;
	moving: boolean;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const petShown = async (page: Page) => (await view<PetView[]>(page, "fidgets()")).find((f) => f.kind === "pet");
const calls = (page: Page) => page.evaluate(() => (window as any).calls.slice()) as Promise<string[]>;
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const hoverText = (page: Page) => page.evaluate(() => document.querySelector(".pointer-hover")?.textContent ?? null);
const menuItems = (page: Page) => page.locator(".pointer-menu [role=menuitem]").allTextContents();

async function travel(page: Page, label: string, key: string) {
	if ((await view(page, "place()")) !== key) {
		const places = page.getByRole("tab", { name: "Places", exact: true });
		if ((await places.getAttribute("aria-selected")) !== "true" || (await page.locator(".aw-side.aw-folded").count()))
			await places.dispatchEvent("click");
		await page.locator(`button[title="Travel to ${label}"]`).first().dispatchEvent("click");
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe(key), { timeout: 6000 });
	}
	await page.mouse.move(640, 400);
	for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 500);
	await page.waitForTimeout(900);
}

async function closeUp(page: Page, pet: PetView, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	const [x, y] = await screen(page, pet.x, pet.y - 0.6);
	await page.screenshot({
		path: join(SHOTS, `${name}.png`),
		animations: "disabled",
		clip: { x: Math.max(0, x - 160), y: Math.max(0, y - 130), width: 320, height: 220 },
	});
}

/** Wait until the pet shows `art` and return what it shows then. */
const showing = (page: Page, art: string, what: string) =>
	vi.waitFor(
		async () => {
			const now = (await petShown(page))!;
			expect(now.art, what).toBe(art);
			return now;
		},
		{ timeout: 5000, interval: 40 },
	);

describe.each(THEMES)("in the %s theme", (theme) => {
	const manifest = read<ThemeManifest>(`themes/${theme}/theme.json`);
	const pet = manifest.fidgets!.pet!;
	const placed = readdirSync(join(appDir, "themes", theme, "places"))
		.filter((file) => file.endsWith(".json"))
		.flatMap((file) =>
			read<PlaceData>(`themes/${theme}/places/${file}`)
				.overlaySlots.filter((slot) => slot.kind === "fidget" && slot.fidget === "pet")
				.map((slot): [string, OverlaySlot] => [file.slice(0, -5), slot]),
		);

	test("every pet is drawn to its kind's size and answers hover, a left click, and its menu its own way", {
		timeout: 240_000,
	}, async () => {
		const { page, errors } = await openWorld(theme);
		expect(placed.length).toBe(5);
		for (const [place, slot] of placed) {
			const style = slotStyle(pet, slot);
			const art = petArt(slot.look);
			const frames = Object.fromEntries((style.frames ?? PET_FRAME_ORDER).map((frame, i) => [frame, art[i]]));
			const name = slot.name ?? style.name;
			const what = `${name} (${slot.look ?? "the pack's own pet"}) in ${place}`;
			await travel(page, manifest.labels[place], place);
			const before = (await petShown(page))!;
			expect(before, what).toMatchObject({ name, look: slot.look ?? null, asleep: !!slot.asleep });
			await closeUp(page, before, `aw-03-${theme}-${slot.look ?? "own"}-0`);

			// Sitting up (awake at rest; asleep, once woken), its height beside a standing character is its kind's.
			const quiet = (await calls(page)).length;
			const at = () => screen(page, before.x, before.y - Math.min(before.h / 2, 0.25));
			let [sx, sy] = await at();
			if (slot.asleep) {
				expect(before.art, what).toBe(frames.sleep);
				await page.mouse.click(sx, sy, { button: "right" });
				await page
					.locator(".pointer-menu [role=menuitem]", { hasText: `${style.verbs.play} ${name}` })
					.first()
					.click();
			}
			const sitting = await showing(page, frames.sit, `${what} sits up`);
			const [low, high] = SIZES[ANIMAL[theme][slot.look ?? ""]];
			const share = sitting.h / PERSON_TILES;
			expect(share, `${what}: ${share.toFixed(2)} of a character's height`).toBeGreaterThanOrEqual(low);
			expect(share, what).toBeLessThanOrEqual(high);
			if (slot.asleep) {
				// Woken, it plays, then curls up asleep again.
				await showing(page, frames.play, `${what} plays once woken`);
				await showing(page, frames.sleep, `${what} goes back to sleep`);
			}

			// Hover: its own verb and name.
			[sx, sy] = await at();
			await page.mouse.move(sx, sy);
			await vi.waitFor(async () => expect(await hoverText(page), what).toContain(`${style.verbs.pet} ${name}`), {
				timeout: 3000,
			});
			// The menu: its own plays, then Examine.
			await page.mouse.click(sx, sy, { button: "right" });
			expect(await menuItems(page), what).toEqual(
				expect.arrayContaining([`${style.verbs.pet} ${name}`, `${style.verbs.play} ${name}`, `Examine ${name}`]),
			);
			await page.keyboard.press("Escape");

			// A left click: the avatar walks up, then pets it (eyes closed; asleep, it purrs on in its sleep).
			await page.mouse.click(sx, sy);
			await vi.waitFor(
				async () => {
					const now = (await petShown(page))!;
					const where = JSON.stringify({ avatar: await view(page, "avatar()"), now, hover: await hoverText(page) });
					expect(now.playing, `${what}: ${where}`).toBe("pet");
					expect(now.particles, what).toBeGreaterThan(0);
					expect(now.art, what).toBe(slot.asleep ? frames.sleep : frames.petted);
				},
				{ timeout: 20_000, interval: 40 },
			);
			const avatar = await view<AvatarView>(page, "avatar()");
			expect(Math.hypot(avatar.x - slot.at[0], avatar.y - slot.at[1]), `${what}: walked up`).toBeLessThan(2.3);
			// On the floor, the avatar stands beside it (or behind), never in front, where its figure would hide the pet.
			if (before.onFloor)
				expect(
					Math.abs(avatar.x - slot.at[0]) >= 0.9 || avatar.y < slot.at[1],
					`${what}: the avatar at ${avatar.x.toFixed(2)}, ${avatar.y.toFixed(2)} hides it`,
				).toBe(true);
			await closeUp(page, (await petShown(page))!, `aw-03-${theme}-${slot.look ?? "own"}-1`);
			await vi.waitFor(async () => expect((await petShown(page))!.playing, what).not.toBe("pet"), {
				timeout: 5000,
			});

			if (!slot.asleep) {
				// Played with from the menu: its own playful pose.
				[sx, sy] = await at();
				await page.mouse.click(sx, sy, { button: "right" });
				await page
					.locator(".pointer-menu [role=menuitem]", { hasText: `${style.verbs.play} ${name}` })
					.first()
					.click();
				await showing(page, frames.play, `${what} plays`);
				await closeUp(page, (await petShown(page))!, `aw-03-${theme}-${slot.look ?? "own"}-2`);
				await page.waitForTimeout(1600);
			}

			// Examine: its own line.
			[sx, sy] = await at();
			await page.mouse.click(sx, sy, { button: "right" });
			await page.locator(".pointer-menu [role=menuitem]", { hasText: `Examine ${name}` }).click();
			await vi.waitFor(
				async () =>
					expect(await page.locator(".notice").first().textContent()).toContain(
						style.examine.replace("{name}", name).slice(0, 30),
					),
				{ timeout: 3000 },
			);
			// (The forge reads its benches again while you are there: that is the forge, not the pet.)
			const made = (await calls(page)).slice(quiet).filter((call) => !["pullRequests", "outsideWrites"].includes(call));
			expect(made, `${what}: calls to the backend`).toEqual([]);
		}
		expect(errors).toEqual([]);
		await page.close();
	});
});
