import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import { gridFor, isOpen } from "../web/game/pathing.js";
import type { Look, PlaceData } from "../web/theme.js";

// Seam 2 for characters (looks, poses, badges, barks, walking in and out): the committed, built world UI in headless
// Chrome, with the preload API replaced by a fixture backend that records what the world asks of it.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-05-*.png and aw-07-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const LOOKS: Record<string, Look> = JSON.parse(
	readFileSync(fileURLToPath(new URL("../themes/fantasy/characters/looks.json", import.meta.url)), "utf8"),
);
const looksFor = (role: string) => Object.keys(LOOKS).filter((look) => LOOKS[look].role === role);

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
interface FigureView {
	id: string;
	x: number;
	y: number;
	look: string;
	pose: string;
	frame: number;
	badge: string | null;
	bark: string | null;
	barkBox: Box | null;
	moving: boolean;
	alpha: number;
}
interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const avatar = (page: Page) => view<AvatarView | undefined>(page, "avatar()");
const figures = (page: Page) => view<FigureView[]>(page, "figures()");
const figure = async (page: Page, id: string) => (await figures(page)).find((f) => f.id === id);
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** A close-up of the world around a point (tiles), for judging a character's pose, badge, and bark. */
async function closeup(page: Page, name: string, x: number, y: number) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.addStyleTag({ content: ".aw-interface { visibility: hidden; }" });
	const [sx, sy] = await screen(page, x, y);
	const clip = { x: Math.max(0, sx - 170), y: Math.max(0, sy - 230), width: 340, height: 280 };
	await page.screenshot({ path: join(SHOTS, `${name}.png`), clip, animations: "disabled" });
	await page.addStyleTag({ content: ".aw-interface { visibility: visible; }" });
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

test("the avatar look chosen in Settings is worn at once, sent to the backend, and worn again on the next start", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		expect((await avatar(page))?.look).toBe("avatar-traveller");
		await tab(page, "Settings");
		const looks = page.getByRole("group", { name: "Avatar look" });
		const names = await looks.locator("label").allTextContents();
		expect(names).toEqual(["Traveller", "Knight", "Bard"]);
		// Each look shows its portrait.
		const portraits = await looks.locator("img").evaluateAll((images) =>
			images.map((image) => {
				const img = image as HTMLImageElement;
				return { src: img.getAttribute("src"), loaded: img.complete && img.naturalWidth > 0 };
			}),
		);
		expect(portraits.map((p) => p.src)).toEqual(
			["traveller", "knight", "bard"].map((name) => `themes/fantasy/characters/avatar-${name}-portrait-0.png`),
		);
		await vi.waitFor(
			async () =>
				expect(
					await looks.locator("img").evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth)),
				).toBe(true),
			{ timeout: 3000 },
		);
		await expect(looks.getByRole("radio", { name: "Traveller" }).isChecked()).resolves.toBe(true);
		await shot(page, "aw-05-settings-looks");

		await looks.locator("label", { hasText: "Knight" }).click();
		await vi.waitFor(async () => expect((await avatar(page))?.look).toBe("avatar-knight"), { timeout: 2000 });
		await expect(looks.getByRole("radio", { name: "Knight" }).isChecked()).resolves.toBe(true);
		expect(await page.evaluate(() => (window as any).avatarLooks)).toEqual(["avatar-knight"]);
		await page.getByRole("log").getByText("You now look like the knight.").waitFor({ timeout: 2000 });
		await shot(page, "aw-05-settings-knight");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}

	// The next start wears the look the backend kept; a look the theme lacks falls back to its first.
	const again = await openWorld(world([ORLA], { avatarLook: "avatar-bard" }));
	try {
		expect((await avatar(again.page))?.look).toBe("avatar-bard");
		await tab(again.page, "Settings");
		const bard = again.page.getByRole("group", { name: "Avatar look" }).getByRole("radio", { name: "Bard" });
		await expect(bard.isChecked()).resolves.toBe(true);
		await again.push(world([ORLA], { avatarLook: "avatar-gone" }));
		await vi.waitFor(async () => expect((await avatar(again.page))?.look).toBe("avatar-traveller"), { timeout: 2000 });
		expect(again.errors).toEqual([]);
	} finally {
		await again.page.close();
	}
}, 60000);

test("a character keeps its look when its process restarts and when the app restarts; workers wear agent looks", async () => {
	const cast = [ORLA, ...["pi-docs", "pi-tests", "ledger"].map((id, i) => worker(id, i + 1))];
	const looksIn = async (page: Page) =>
		Object.fromEntries((await figures(page)).map((f) => [f.id, f.look])) as Record<string, string>;
	const first = await openWorld(world(cast));
	let before: Record<string, string>;
	try {
		await vi.waitFor(async () => expect(await looksIn(first.page)).toHaveProperty(HQ), { timeout: 3000 });
		expect((await looksIn(first.page))[HQ]).toBe("coordinator");
		// The workers: travel to their wing.
		await tab(first.page, "Places");
		await first.page.getByRole("button", { name: /^apple-pi wing/ }).click();
		await vi.waitFor(async () => expect(Object.keys(await looksIn(first.page))).toHaveLength(3), { timeout: 5000 });
		before = await looksIn(first.page);
		for (const look of Object.values(before)) expect(looksFor("agent")).toContain(look);
		// pi-tests's process stops and starts again: the same session, the same look.
		await first.push(world(cast.filter((c) => c.id !== "pi-tests")));
		await vi.waitFor(async () => expect(await figure(first.page, "pi-tests")).toBeUndefined(), { timeout: 8000 });
		await first.push(world(cast));
		await vi.waitFor(async () => expect((await looksIn(first.page))["pi-tests"]).toBe(before["pi-tests"]), {
			timeout: 3000,
		});
		expect(first.errors).toEqual([]);
	} finally {
		await first.page.close();
	}
	const second = await openWorld(world(cast));
	try {
		await tab(second.page, "Places");
		await second.page.getByRole("button", { name: /^apple-pi wing/ }).click();
		await vi.waitFor(async () => expect(await looksIn(second.page)).toEqual(before), { timeout: 5000 });
		expect(second.errors).toEqual([]);
	} finally {
		await second.page.close();
	}
}, 60000);

test("walking shows the four-phase stride in every direction", async () => {
	const { page, errors } = await openWorld(world([ORLA]), { clickThrough: true });
	try {
		// From the hall's start, walk down, up, left, and right in turn, recording every animation frame.
		const legs: [string, number, number][] = [
			["down", 15, 13.6],
			["up", 15, 8.8],
			["left", 8.6, 8.8],
			["right", 14.6, 8.8],
		];
		for (const [facing, x, y] of legs) {
			await page.evaluate(() => {
				const frames: { frame: number; facing: string; moving: boolean }[] = [];
				(window as any).strideFrames = frames;
				(window as any).recording = true;
				const tick = () => {
					const a = (window as any).agentWorldView.avatar();
					if (a) frames.push({ frame: a.frame, facing: a.facing, moving: a.moving });
					if ((window as any).recording) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			});
			const [sx, sy] = await screen(page, x, y);
			await page.mouse.click(sx, sy);
			// A short recording of the stride: the avatar, close up, every few hundredths of a second.
			if (SHOTS)
				for (let i = 0; i < 8; i++) {
					const a = (await avatar(page))!;
					const [ax, ay] = await screen(page, a.x, a.y);
					await page.screenshot({
						path: join(SHOTS, `aw-05-stride-${facing}-${i}.png`),
						clip: { x: ax - 50, y: ay - 110, width: 100, height: 120 },
					});
				}
			await vi.waitFor(
				async () => {
					const a = (await avatar(page))!;
					expect(a.moving).toBe(false);
					expect(Math.hypot(a.x - x, a.y - y)).toBeLessThan(0.05);
				},
				{ timeout: 8000, interval: 50 },
			);
			const frames = (await page.evaluate(() => {
				(window as any).recording = false;
				return (window as any).strideFrames;
			})) as { frame: number; facing: string; moving: boolean }[];
			const walking = frames.filter((f) => f.moving && f.facing === facing);
			const first = { down: 0, up: 4, left: 8, right: 8 }[facing]!;
			expect(new Set(walking.map((f) => f.frame)), facing).toEqual(new Set([first, first + 1, first + 2, first + 3]));
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

/** Open the world and go to the apple-pi wing through the Places tab; clicks then reach the world itself. */
async function inTheWing(snapshot: WorldSnapshot) {
	const opened = await openWorld(snapshot);
	await tab(opened.page, "Places");
	await opened.page.getByRole("button", { name: /^apple-pi wing/ }).click();
	await vi.waitFor(async () => expect(await view(opened.page, "place()")).toBe(`wing:${HQ}:/r/apple-pi`), {
		timeout: 5000,
	});
	await opened.page.waitForTimeout(400);
	return opened;
}

const working = (tool = "bash"): Partial<CharacterFacts> => ({
	run: "running_tool",
	status: "working",
	tool: { name: tool, arg: "npm test", since: T0 },
});
const asking = (text: string | null = "Which branch should I rebase on?"): Partial<CharacterFacts> => ({
	run: "idle",
	status: "asking",
	asking: { kind: "questionnaire", text },
	needsYouSince: T0,
});
const finished: Partial<CharacterFacts> = { unseen: true, needsYouSince: T0, settledAt: T0 };

test("a session moving from idle to working to asking changes pose and badge each time, and the badge clears once seen", async () => {
	const { page, push, errors } = await inTheWing(world([ORLA, worker("pi-docs", 1)]));
	try {
		await zoomOut(page);
		const docs = () => figure(page, "pi-docs");
		await vi.waitFor(async () => expect(await docs()).toMatchObject({ pose: "standing", badge: null }), {
			timeout: 3000,
		});
		const spot = await docs();
		expect((await docs())?.frame).toBe(14);

		await push(world([ORLA, worker("pi-docs", 1, working())]));
		await vi.waitFor(async () => expect(await docs()).toMatchObject({ pose: "seated", badge: "working" }), {
			timeout: 2000,
		});
		// Seated at work: the two seated frames alternate, at the same spot.
		const seen = new Set<number>();
		for (let i = 0; i < 30 && seen.size < 2; i++) {
			seen.add((await docs())!.frame);
			await page.waitForTimeout(100);
		}
		expect(seen).toEqual(new Set([12, 13]));
		expect([(await docs())!.x, (await docs())!.y]).toEqual([spot!.x, spot!.y]);
		await closeup(page, "aw-07-working", spot!.x, spot!.y);

		await push(world([ORLA, worker("pi-docs", 1, asking())]));
		await vi.waitFor(async () => expect(await docs()).toMatchObject({ pose: "asking", frame: 15, badge: "asking" }), {
			timeout: 2000,
		});
		await closeup(page, "aw-07-asking", spot!.x, spot!.y);

		await push(world([ORLA, worker("pi-docs", 1, finished)]));
		await vi.waitFor(async () => expect(await docs()).toMatchObject({ pose: "standing", frame: 14, badge: "unseen" }), {
			timeout: 2000,
		});
		await closeup(page, "aw-07-unseen", spot!.x, spot!.y);
		// Seen (the conversation opened, or the sidebar marked it): the badge clears.
		await push(world([ORLA, worker("pi-docs", 1)]));
		await vi.waitFor(async () => expect(await docs()).toMatchObject({ pose: "standing", badge: null }), {
			timeout: 2000,
		});
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a newly started session's character comes in by the door and walks to its spot; a stopped one walks out", async () => {
	const DOOR: [number, number] = [9, 13.2]; // the small wing's door to the gallery, where one stands to use it
	const { page, push, errors } = await inTheWing(world([ORLA, worker("pi-docs", 1)]));
	try {
		await vi.waitFor(async () => expect(await figure(page, "pi-docs")).toBeDefined(), { timeout: 3000 });
		// Record every animation frame of the newcomer.
		await page.evaluate(() => {
			const track: { x: number; y: number; alpha: number; moving: boolean }[] = [];
			(window as any).track = track;
			const tick = () => {
				const f = (window as any).agentWorldView.figures().find((g: { id: string }) => g.id === "pi-tests");
				const d = (window as any).agentWorldView.departing().find((g: { id: string }) => g.id === "pi-docs");
				const it = (window as any).trackDeparture ? d : f;
				if (it) track.push({ x: it.x, y: it.y, alpha: it.alpha, moving: it.moving });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		await push(world([ORLA, worker("pi-docs", 1), worker("pi-tests", 2, working())]));
		await vi.waitFor(async () => expect(await figure(page, "pi-tests")).toBeDefined(), { timeout: 2000 });
		await page.waitForTimeout(250);
		await shot(page, "aw-07-arriving");
		await vi.waitFor(
			async () => expect(await figure(page, "pi-tests")).toMatchObject({ moving: false, alpha: 1, pose: "seated" }),
			{ timeout: 10000 },
		);
		const arrival = (await page.evaluate(() => (window as any).track.splice(0))) as {
			x: number;
			y: number;
			alpha: number;
			moving: boolean;
		}[];
		// It appeared in the doorway, faded in, passed where one stands to use the door, and walked to its spot.
		expect(arrival[0].alpha).toBeLessThan(0.5);
		expect(Math.hypot(arrival[0].x - DOOR[0], arrival[0].y - DOOR[1])).toBeLessThan(1.2);
		expect(arrival[0].y).toBeGreaterThan(DOOR[1]);
		expect(arrival.some((p) => Math.hypot(p.x - DOOR[0], p.y - DOOR[1]) < 0.2)).toBe(true);
		expect(arrival.filter((p) => p.moving).length).toBeGreaterThan(20);

		// pi-docs stops: it walks out the same way, and is gone.
		await page.evaluate(() => {
			(window as any).trackDeparture = true;
		});
		await push(world([ORLA, worker("pi-tests", 2, working())]));
		await vi.waitFor(async () => expect(await view(page, "departing()")).toHaveLength(1), { timeout: 2000 });
		expect((await figures(page)).map((f) => f.id)).toEqual(["pi-tests"]);
		await page.waitForTimeout(300);
		await shot(page, "aw-07-leaving");
		await vi.waitFor(async () => expect(await view(page, "departing()")).toHaveLength(0), { timeout: 10000 });
		const departure = (await page.evaluate(() => (window as any).track.splice(0))) as typeof arrival;
		expect(departure.some((p) => Math.hypot(p.x - DOOR[0], p.y - DOOR[1]) < 0.2)).toBe(true);
		expect(departure.at(-1)!.y).toBeGreaterThan(DOOR[1]);
		expect(departure.at(-1)!.alpha).toBeLessThan(0.5);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("out of doors a working character stands at work with its badge, breathing; indoors it sits at its desk", async () => {
	const out: Character = {
		...worker("solo", 1, working()),
		role: "independent",
		place: { kind: "square" },
		facts: facts({ ...working(), reportsTo: null }),
	};
	const { page, errors } = await inTheWing(world([ORLA, worker("pi-docs", 2, working()), out]));
	try {
		await vi.waitFor(
			async () => expect(await figure(page, "pi-docs")).toMatchObject({ pose: "seated", badge: "working" }),
			{
				timeout: 3000,
			},
		);
		// The Places tab is still open from going to the wing.
		await page.getByRole("button", { name: /^Village square/ }).click();
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe("square"), { timeout: 5000 });
		await vi.waitFor(async () => expect(await figure(page, "solo")).toMatchObject({ pose: "busy", badge: "working" }), {
			timeout: 3000,
		});
		// Standing, not on a stool (the seated frames 12 and 13 bring one), the whole time it works.
		for (let i = 0; i < 10; i++) {
			expect((await figure(page, "solo"))!.frame).toBe(14);
			await page.waitForTimeout(120);
		}
		const solo = (await figure(page, "solo"))!;
		await closeup(page, "aw-17-working-outdoors", solo.x, solo.y);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("barks appear now and then, only over characters that need the operator", async () => {
	const cast = [
		ORLA,
		worker("asker", 1, asking()),
		worker("done", 2, finished),
		worker("busy", 3, working()),
		worker("resting", 4),
	];
	const { page, errors } = await inTheWing(world(cast));
	try {
		await zoomOut(page);
		const barking = new Map<string, Set<string>>();
		let shown = false;
		const ui = await page.$$eval(".place-title, .aw-side, .aw-top-right, .aw-chat", (elements) =>
			elements.map((e) => e.getBoundingClientRect().toJSON() as Box),
		);
		const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
		for (let i = 0; i < 40; i++) {
			const now = await figures(page);
			for (const f of now) if (f.bark) barking.set(f.id, (barking.get(f.id) ?? new Set()).add(f.bark));
			// A bark never covers another, the place's title, or a panel.
			const boxes = now.flatMap((f) => (f.barkBox ? [f.barkBox] : []));
			boxes.forEach((box, j) => {
				for (const other of [...ui, ...boxes.slice(j + 1)])
					expect(overlap(box, other), JSON.stringify(box)).toBe(false);
			});
			const asker = now.find((f) => f.id === "asker" && f.bark);
			if (asker && !shown) {
				shown = true;
				await page.waitForTimeout(250); // the bubble fades in
				await shot(page, "aw-07-barks");
				await closeup(page, "aw-07-bark", asker.x, asker.y);
			}
			await page.waitForTimeout(150);
		}
		expect([...barking.keys()].sort()).toEqual(["asker", "done"]);
		expect([...barking.get("asker")!][0]).toBe("Which branch should I rebase on?");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("furniture in front hides the part of a character behind it; asking characters stand on the floor", async () => {
	const SMALL: PlaceData = JSON.parse(
		readFileSync(fileURLToPath(new URL("../themes/fantasy/places/wing-small.json", import.meta.url)), "utf8"),
	);
	const { page, errors } = await inTheWing(world([ORLA, worker("pi-docs", 1, asking())]));
	try {
		await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
		// The whole room in view, so the camera holds still.
		await zoomOut(page);
		// The asking character stands on open floor at its spot, in front of its table.
		const docs = (await figure(page, "pi-docs"))!;
		expect(docs).toMatchObject({ pose: "asking", frame: 15 });
		expect(SMALL.spots).toContainEqual([docs.x, docs.y]);
		expect(isOpen(gridFor(SMALL), [docs.x, docs.y])).toBe(true);
		const table = SMALL.foreground!.find((piece) => piece.rect[0] < 4 && piece.rect[1] < 7)!;
		expect(docs.y).toBeGreaterThan(table.feet);

		// Behind the table (north of it), the table hides the avatar's legs and not its head.
		const behind: [number, number] = [4, 5.95];
		const walkTo = async ([x, y]: [number, number]) => {
			const [sx, sy] = await screen(page, x, y);
			await page.mouse.click(sx, sy);
			await vi.waitFor(
				async () => {
					const a = (await avatar(page))!;
					expect(a.moving).toBe(false);
					expect(Math.hypot(a.x - x, a.y - y)).toBeLessThan(0.05);
				},
				{ timeout: 10000, interval: 50 },
			);
			await page.waitForTimeout(600); // the camera settles
		};
		const clips = async () => {
			const [left, top] = await screen(page, behind[0] - 0.25, table.rect[1] + 0.02);
			const [right, feet] = await screen(page, behind[0] + 0.25, behind[1] - 0.02);
			const [, head] = await screen(page, behind[0], behind[1] - 1.7);
			const legs = await page.screenshot({ clip: { x: left, y: top, width: right - left, height: feet - top } });
			const upper = await page.screenshot({ clip: { x: left, y: head, width: right - left, height: top - head } });
			return { legs, upper };
		};
		await walkTo(behind);
		const there = await clips();
		await closeup(page, "aw-07-behind-table", behind[0], behind[1]);
		await walkTo([9, 13]);
		const away = await clips();
		expect(there.legs.equals(away.legs)).toBe(true);
		expect(there.upper.equals(away.upper)).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);
