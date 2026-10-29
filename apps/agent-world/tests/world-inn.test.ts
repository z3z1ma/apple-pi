import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, DormantAgent, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for the inn (ticket 15): the committed, built world UI in headless Chrome over a fixture backend that records
// what the world asks of it (wakes, ended sessions) and answers with receipts.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-15-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const INN: PlaceData = JSON.parse(
	readFileSync(fileURLToPath(new URL("../themes/fantasy/places/inn.json", import.meta.url)), "utf8"),
);

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

/** Open the world over a fixture backend; `push` sends a new snapshot; `window.calls` records what it was asked. */
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
		const listeners = new Set<(s: unknown) => void>();
		let current = snapshot;
		const w = window as any;
		w.calls = [];
		// What the next call of each kind answers; a test changes it before acting.
		w.answers = {
			wake: { ok: true, stage: "applied" },
			endSession: { ok: true, stage: "applied" },
			endSessionBusy: { ok: false, confirm: true, reason: "It is in the middle of a turn." },
		};
		w.agentWorld = {
			snapshot: async () => current,
			onUpdate(listener: (s: unknown) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			feed: async () => [],
			onFeed: () => () => {},
			goToTerminal: async () => ({ ok: true }),
			conversation: async (id: string) => {
				w.calls.push(["conversation", id]);
				return {
					ok: true,
					entries: [{ kind: "user", id: "e1", at: Date.now() - 7_200_000, text: "Write the style guide.", images: 0 }],
					before: null,
					missing: 0,
				};
			},
			markSeen: async () => ({ ok: true }),
			setAvatarLook: async () => ({ ok: true }),
			instruct: async () => ({ ok: true }),
			onReceipt: () => () => {},
			watchReplies: async () => {},
			onReply: () => () => {},
			wake: async (id: string) => {
				w.calls.push(["wake", id]);
				return w.answers.wake;
			},
			endSession: async (id: string, confirmed?: boolean) => {
				w.calls.push(["endSession", id, confirmed ?? false]);
				const busy = (current as any).characters.find((c: any) => c.id === id)?.facts?.run !== "idle";
				return busy && !confirmed ? w.answers.endSessionBusy : w.answers.endSession;
			},
			sendMail: async (id: string, body: string) => {
				w.calls.push(["sendMail", id, body]);
				return { ok: true, stage: "applied" };
			},
		};
		w.pushSnapshot = (next: unknown) => {
			current = next as typeof snapshot;
			for (const listener of listeners) listener(next);
		};
	}, first);
	await page.goto(`${ORIGIN}/index.html?world`);
	const push = (snapshot: WorldSnapshot) => page.evaluate((s) => (window as any).pushSnapshot(s), snapshot);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(400); // the arrival fade
	return { page, push, errors };
}

interface FigureView {
	id: string;
	name: string;
	x: number;
	y: number;
	pose: string;
	moving: boolean;
	bark: string | null;
	alpha: number;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const figures = (page: Page) => view<FigureView[]>(page, "figures()");
const calls = (page: Page) => page.evaluate(() => (window as any).calls) as Promise<unknown[][]>;
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();
/** Clicks reach the world through the interface's panels (they still draw for screenshots). */
const clickThrough = (page: Page) =>
	page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Travel to the inn from the Places tab, and wait until everyone is at their spot. */
async function toInn(page: Page) {
	await tab(page, "Places");
	await page.getByRole("button", { name: /^The inn/ }).click();
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe("inn"), { timeout: 5000 });
	// Zoom out with the wheel, as far as it goes, so the whole room shows.
	await page.mouse.move(640, 300);
	for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
	await page.waitForTimeout(800);
}

const HQ = "orla";
const NOW = Date.now();
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
	startedAt: NOW - 9_000_000,
	facts: facts({ reportsTo: null }),
};
const worker = (id: string, over: Partial<CharacterFacts> = {}): Character => ({
	id,
	name: id,
	role: "worker",
	place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
	startedAt: NOW - 8_000_000,
	facts: facts(over),
});
const NAMES = ["docs-writer", "test-fixer", "ci-watcher", "pr-review", "notch-polish", "sidebar"];
/** Twelve stopped sessions, the most recently stopped first. */
const SLEEPERS: DormantAgent[] = Array.from({ length: 12 }, (_, i) => ({
	id: `s-${i}`,
	name: i < NAMES.length ? NAMES[i] : `sleeper-${i}`,
	role: "worker",
	reportsTo: HQ,
	repository: i % 3 === 0 ? "/r/handbook" : "/r/apple-pi",
	cwd: "/r/apple-pi",
	task: i % 2 === 0 ? { title: `Task number ${i}`, status: "in-progress", bundle: `/b/${i}` } : null,
	stoppedAt: NOW - (i + 1) * 3_600_000,
	stopReason: "quit",
	startedAt: NOW - 20_000_000 + i,
	// The second sleeper is a former member: it retired, and the register marks it so.
	...(i === 1
		? { title: "Scientific Skeptic", retiredAt: NOW - 2 * 3_600_000, retiredReason: "the burst passed" }
		: {}),
}));
function world(characters: Character[], dormant: DormantAgent[] = SLEEPERS): WorldSnapshot {
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
		dormant,
	};
}

test("the newest dormant agents sleep at the inn's tables and in its beds, each with a z; the rest are upstairs", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		await toInn(page);
		expect(await view(page, "painting()")).toBe("inn");
		const sleeping = await figures(page);
		// As many as the inn has spots, the most recently stopped first, each on its spot.
		expect(sleeping.map((f) => f.id)).toEqual(SLEEPERS.slice(0, INN.spots.length).map((s) => s.id));
		const beds = new Set(INN.overlaySlots.filter((slot) => slot.kind === "bed").map((slot) => slot.spot));
		sleeping.forEach((f, i) => {
			expect(f.pose).toBe(beds.has(i) ? "in-bed" : "dozing");
			expect(f.bark).toBe("z");
		});
		// The innkeeper stands behind the bar.
		expect(await view(page, "host()")).toMatchObject({ name: "Innkeeper", look: "innkeeper" });
		await shot(page, "aw-15-inn");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("an update that leaves out an unchanged inn keeps the sleepers; one that carries the inn changes them", async () => {
	const { page, push, errors } = await openWorld(world([ORLA]));
	const sleeping = async () => (await figures(page)).map((f) => f.id);
	try {
		await toInn(page);
		const shown = SLEEPERS.slice(0, INN.spots.length).map((s) => s.id);
		expect(await sleeping()).toEqual(shown);
		// A worker starts elsewhere: the update leaves the inn and the mail out, as the main process sends it.
		const { dormant: _inn, ...rest } = world([ORLA, worker("w-new")]);
		await push({ ...rest, unchanged: ["dormant", "mail"] } as WorldSnapshot);
		await tab(page, "Agents");
		await vi.waitFor(async () => expect(await page.getByRole("button", { name: /^w-new/ }).count()).toBeGreaterThan(0));
		await page.waitForTimeout(500);
		expect(await sleeping()).toEqual(shown);
		// The newest sleeper wakes: the inn comes whole, and the room follows it.
		await push(world([ORLA, worker("w-new")], SLEEPERS.slice(1)));
		await vi.waitFor(async () => expect((await sleeping())[0]).toBe(SLEEPERS[1].id), { timeout: 5000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("the innkeeper's register lists every dormant agent, newest first, with its repository and last task, and searches", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		await toInn(page);
		await clickThrough(page);
		const [x, y] = INN.host!.at;
		const [sx, sy] = await screen(page, x, y - 1.2);
		await page.mouse.click(sx, sy);
		const register = page.getByRole("dialog", { name: "The innkeeper's register" });
		await register.waitFor({ timeout: 8000 });
		const rows = register.getByRole("listitem");
		await vi.waitFor(async () => expect(await rows.count()).toBe(12), { timeout: 3000 });
		expect(await rows.first().textContent()).toContain("docs-writer");
		expect(await rows.first().textContent()).toContain("handbook");
		expect(await rows.first().textContent()).toContain("Task number 0");
		expect(await rows.nth(1).textContent()).toContain("No focused task");
		expect(await rows.nth(1).textContent()).toContain("Scientific Skeptic");
		expect(await rows.nth(1).textContent()).toContain("Left the guild: the burst passed");
		expect(await rows.nth(1).getByRole("button", { name: "Wake test-fixer" }).count()).toBe(0);
		expect(await rows.nth(1).getByRole("button", { name: "Read test-fixer's last conversation" }).count()).toBe(1);
		expect(await rows.first().textContent()).not.toContain("Left the guild");
		await register.getByText("10 asleep here, 2 upstairs").waitFor({ timeout: 2000 });
		expect(await rows.nth(11).textContent()).toContain("Upstairs");
		await shot(page, "aw-15-register");

		await register.getByRole("searchbox").fill("handbook");
		await vi.waitFor(async () => expect(await rows.count()).toBe(4), { timeout: 2000 });
		await register.getByRole("searchbox").fill("task number 4");
		await vi.waitFor(async () => expect(await rows.count()).toBe(1), { timeout: 2000 });
		expect(await rows.first().textContent()).toContain("notch-polish");
		await page.keyboard.press("Escape");
		await register.waitFor({ state: "detached", timeout: 2000 });

		// Right-clicking an inn table asks the innkeeper too.
		const [tx, ty, tw, th] = INN.furniture![0].rect;
		const [cx, cy] = await screen(page, tx + tw / 2, ty + th / 2);
		await page.mouse.click(cx, cy, { button: "right" });
		await page.getByRole("menuitem", { name: "Ask the innkeeper" }).click();
		await register.waitFor({ timeout: 3000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("waking from the register shows the receipt, and the woken character gets up and walks out of the inn", async () => {
	const { page, push, errors } = await openWorld(world([ORLA]));
	try {
		await toInn(page);
		await tab(page, "Places"); // fold the panel out of the way of the register
		await clickThrough(page);
		const [x, y] = INN.host!.at;
		const [sx, sy] = await screen(page, x, y - 1.2);
		await page.mouse.click(sx, sy);
		const register = page.getByRole("dialog", { name: "The innkeeper's register" });
		await register.waitFor({ timeout: 8000 });
		await page.addStyleTag({ content: ".aw-place-veil, .aw-place-veil * { pointer-events: auto !important; }" });
		await register.getByRole("button", { name: "Wake ci-watcher" }).click();
		await register.getByText("Awake in a new window beside your current one.").waitFor({ timeout: 3000 });
		expect(await calls(page)).toContainEqual(["wake", "s-2"]);
		await shot(page, "aw-15-woken-receipt");

		// The runtime reports it awake in its wing: it stands up and walks out by the door.
		const woken = { ...worker("s-2"), name: "ci-watcher" };
		await push(
			world(
				[ORLA, woken],
				SLEEPERS.filter((agent) => agent.id !== "s-2"),
			),
		);
		await page.keyboard.press("Escape");
		await vi.waitFor(async () => expect((await figures(page)).map((f) => f.id)).not.toContain("s-2"), {
			timeout: 3000,
		});
		const departing = await view<FigureView[]>(page, "departing()");
		expect(departing.map((f) => f.id)).toContain("s-2");
		expect(departing.find((f) => f.id === "s-2")?.moving).toBe(true);
		// The next sleeper from upstairs takes the free spot.
		expect((await figures(page)).map((f) => f.id)).toContain("s-10");
		await shot(page, "aw-15-woken-walks-out");
		await vi.waitFor(async () => expect(await view<FigureView[]>(page, "departing()")).toEqual([]), {
			timeout: 15000,
		});

		// A failed wake says why.
		await page.evaluate(() => {
			(window as any).answers.wake = { ok: false, reason: "No terminal is attached to tmux." };
		});
		const [hx, hy] = await screen(page, x, y - 1.2);
		await page.mouse.click(hx, hy);
		await register.waitFor({ timeout: 8000 });
		await register.getByRole("button", { name: "Wake pr-review" }).click();
		await register.getByText("No terminal is attached to tmux.").waitFor({ timeout: 3000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a sleeper's menu reads its last conversation in the conversation panel, or wakes it", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		await toInn(page);
		await clickThrough(page);
		const sleeper = (await figures(page))[0];
		const [sx, sy] = await screen(page, sleeper.x, sleeper.y - 0.6);
		await page.mouse.click(sx, sy, { button: "right" });
		const menu = page.getByRole("menu");
		expect(await menu.getByRole("menuitem").allTextContents()).toEqual(
			expect.arrayContaining(["Read last talk with docs-writer", "Wake docs-writer"]),
		);
		await menu.getByRole("menuitem", { name: "Read last talk with docs-writer" }).click();
		await page.getByRole("dialog", { name: "Conversation with docs-writer" }).waitFor({ timeout: 8000 });
		await page.getByText("Write the style guide.").waitFor({ timeout: 3000 });
		expect(await calls(page)).toContainEqual(["conversation", "s-0"]);
		// Asleep, it has no terminal to go to: the panel offers to wake it instead, and says how it wakes.
		const panel = page.getByRole("dialog", { name: "Conversation with docs-writer" });
		await expect(panel.getByRole("button", { name: "Go to its terminal" }).count()).resolves.toBe(0);
		await expect(panel.textContent()).resolves.toContain("Asleep at the inn");
		await expect(panel.textContent()).resolves.toContain("Wake it to talk");
		await shot(page, "aw-15-last-conversation");
		await panel.getByRole("button", { name: "Wake docs-writer" }).click();
		await vi.waitFor(async () => expect(await calls(page)).toContainEqual(["wake", "s-0"]), { timeout: 3000 });
		await panel
			.getByRole("status")
			.getByText("Awake in a new window beside your current one.")
			.waitFor({ timeout: 3000 });
		await page.keyboard.press("Escape");
		await page.evaluate(() => {
			(window as any).calls.length = 0;
		});

		await page.mouse.click(sx, sy, { button: "right" });
		await page.getByRole("menuitem", { name: "Wake docs-writer" }).click();
		await vi.waitFor(async () => expect(await calls(page)).toContainEqual(["wake", "s-0"]), { timeout: 8000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a legacy former person's bed and conversation remain readable without wake actions", async () => {
	const { page, errors } = await openWorld(world([ORLA]));
	try {
		await toInn(page);
		await clickThrough(page);
		const former = (await figures(page)).find((figure) => figure.id === "s-1")!;
		const [x, y] = await screen(page, former.x, former.y - 0.6);
		await page.mouse.click(x, y, { button: "right" });
		const menu = page.getByRole("menu");
		expect(await menu.getByRole("menuitem", { name: "Wake test-fixer" }).count()).toBe(0);
		await menu.getByRole("menuitem", { name: "Read last talk with test-fixer" }).click();
		const panel = page.getByRole("dialog", { name: "Conversation with test-fixer" });
		await panel.waitFor({ timeout: 8000 });
		expect(await panel.textContent()).toContain("read-only");
		expect(await panel.getByRole("button", { name: "Wake test-fixer" }).count()).toBe(0);
		expect(await panel.getByRole("button", { name: "Go to its terminal" }).count()).toBe(0);
		expect(await calls(page)).toContainEqual(["conversation", "s-1"]);
		expect((await calls(page)).some((call) => call[0] === "wake")).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("ending a session: an idle one at once, a busy one only after a themed confirmation; its character comes to the inn to sleep", async () => {
	const busy = worker("pi-busy", { run: "running_tool", status: "working" });
	const idle = worker("pi-idle");
	const { page, push, errors } = await openWorld(world([ORLA, busy, idle]));
	try {
		// The Agents tab is open from the start.
		await page.getByRole("button", { name: /^pi-idle/ }).click();
		await page.getByRole("button", { name: "End pi-idle's session" }).click();
		await vi.waitFor(async () => expect(await calls(page)).toContainEqual(["endSession", "pi-idle", false]), {
			timeout: 3000,
		});
		expect(await page.getByRole("alertdialog").count()).toBe(0);

		await page.getByRole("button", { name: /^pi-busy/ }).click();
		await page.getByRole("button", { name: "End pi-busy's session" }).click();
		const confirm = page.getByRole("alertdialog", { name: "End pi-busy's session?" });
		await confirm.waitFor({ timeout: 3000 });
		await confirm.getByText("It is in the middle of a turn.").waitFor({ timeout: 2000 });
		await shot(page, "aw-15-end-confirm");
		await confirm.getByRole("button", { name: "Let it work" }).click();
		await confirm.waitFor({ state: "detached", timeout: 2000 });
		expect((await calls(page)).filter((c) => c[0] === "endSession" && c[1] === "pi-busy")).toEqual([
			["endSession", "pi-busy", false],
		]);
		await page.getByRole("button", { name: "End pi-busy's session" }).click();
		await confirm.getByRole("button", { name: "End the session" }).click();
		await vi.waitFor(async () => expect(await calls(page)).toContainEqual(["endSession", "pi-busy", true]), {
			timeout: 3000,
		});

		// In the inn, the ended session's character comes in by the door and sits down to sleep.
		await toInn(page);
		const asleep = { ...SLEEPERS[0], id: "pi-idle", name: "pi-idle", stoppedAt: Date.now() };
		await push(world([ORLA, busy], [asleep, ...SLEEPERS]));
		const arriving = async () => (await figures(page)).find((f) => f.id === "pi-idle");
		await vi.waitFor(async () => expect(await arriving()).toBeDefined(), { timeout: 3000 });
		expect((await arriving())?.moving).toBe(true);
		const [doorX, doorY] = INN.doors[0].standAt;
		const first = (await arriving())!;
		expect(Math.hypot(first.x - doorX, first.y - doorY)).toBeLessThan(1.5);
		// The oldest sleeper shown goes upstairs to make room; the newcomer takes its spot and dozes off.
		expect((await figures(page)).map((f) => f.id)).not.toContain("s-9");
		await vi.waitFor(async () => expect(await arriving()).toMatchObject({ moving: false, pose: "dozing" }), {
			timeout: 15000,
		});
		const [spotX, spotY] = INN.spots[9];
		const settled = (await arriving())!;
		expect(Math.hypot(settled.x - spotX, settled.y - spotY)).toBeLessThan(0.05);
		await shot(page, "aw-15-ended-sleeps");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 90000);
