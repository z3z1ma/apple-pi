import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, DormantAgent, MailItem, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for the rookery and mail (ticket 16): the committed, built world UI in headless Chrome over a fixture backend
// that records the letters the operator sends and answers with receipts.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-16-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const ROOKERY: PlaceData = JSON.parse(
	readFileSync(fileURLToPath(new URL("../themes/fantasy/places/rookery.json", import.meta.url)), "utf8"),
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
				return w.answers.sendMail ?? { ok: true, stage: "applied" };
			},
		};
		w.pushSnapshot = (next: unknown) => {
			current = next as typeof snapshot;
			for (const listener of listeners) listener(next);
		};
	}, first);
	await page.goto(`${ORIGIN}/index.html`);
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

/** Travel to a place from the Places tab, and wait until everyone is at their spot. */
async function travel(page: Page, name: RegExp, key: string) {
	await tab(page, "Places");
	await page.getByRole("button", { name }).click();
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe(key), { timeout: 5000 });
	// Zoom out with the wheel, as far as it goes, so the whole room shows.
	await page.mouse.move(640, 300);
	for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
	await page.waitForTimeout(800);
}

interface BirdView {
	id: string;
	from: string;
	to: string;
	x: number;
	y: number;
	frame: number;
	out: boolean;
}
const birds = (page: Page) => view<BirdView[]>(page, "birds()");

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
const worker = (id: string, n: number): Character => ({
	id,
	name: id,
	role: "worker",
	place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
	startedAt: NOW - 8_000_000 + n,
	facts: facts(),
});
const PARSER = worker("parser", 1);
const LEXER = worker("lexer", 2);
const SLEEPY: DormantAgent = {
	id: "sleepy",
	name: "sleepy",
	role: "worker",
	reportsTo: HQ,
	repository: "/r/apple-pi",
	cwd: "/r/apple-pi",
	task: null,
	stoppedAt: NOW - 3_600_000,
	stopReason: "quit",
	startedAt: NOW - 20_000_000,
};
const letter = (
	id: string,
	from: Character | "operator",
	to: { id: string; name: string },
	body: string,
	minutes: number,
	state: MailItem["state"] = "delivered",
): MailItem => ({
	id,
	from: from === "operator" ? "operator" : from.id,
	fromName: from === "operator" ? "You" : from.name,
	to: to.id,
	toName: to.name,
	body,
	sentAt: NOW - minutes * 60_000,
	deliveredAt: state === "delivered" ? NOW - minutes * 60_000 + 2000 : null,
	state,
	reason: state === "failed" ? "not running" : null,
});
const MAIL: MailItem[] = [
	letter("m3", ORLA, SLEEPY, "When you wake, rebase the docs branch on main and push.", 5, "waiting"),
	letter("m2", PARSER, LEXER, "The parser now needs a token for every comment; can you emit them?", 12),
	letter("m1", LEXER, ORLA, "Lexer is done; all tests pass.", 40),
];
function world(characters: Character[], mail: MailItem[] = MAIL, dormant: DormantAgent[] = [SLEEPY]): WorldSnapshot {
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
		mail,
	};
}

/** Open the rookery keeper's view by talking to the keeper. */
async function talkToKeeper(page: Page) {
	await clickThrough(page);
	const [x, y] = ROOKERY.host!.at;
	const [sx, sy] = await screen(page, x, y - 1.2);
	await page.mouse.click(sx, sy);
	const rookery = page.getByRole("dialog", { name: "The rookery" });
	await rookery.waitFor({ timeout: 8000 });
	await page.addStyleTag({ content: ".aw-place-veil, .aw-place-veil * { pointer-events: auto !important; }" });
	return rookery;
}

test("the rookery keeper shows recent mail and mail waiting for sleepers, each with who, when, a preview, and whether it arrived", async () => {
	const { page, errors } = await openWorld(world([ORLA, PARSER, LEXER]));
	try {
		await travel(page, /^The rookery/, "rookery");
		expect(await view(page, "host()")).toMatchObject({ name: "Rookery keeper", look: "rookery-keeper" });
		// Letters lie on the sorting desk while mail waits.
		expect((await view<{ kind: string }[]>(page, "overlays()")).map((o) => o.kind)).toContain("letters");
		await shot(page, "aw-16-rookery");
		const rookery = await talkToKeeper(page);
		const waiting = rookery.getByRole("region", { name: "Waiting for sleepers" });
		expect(await waiting.getByRole("listitem").count()).toBe(1);
		const waitingRow = await waiting.getByRole("listitem").first().textContent();
		for (const text of ["Orla", "sleepy", "Waiting", "rebase the docs branch"]) expect(waitingRow).toContain(text);
		// Recent mail, newest first, without repeating what waits for sleepers.
		const recent = rookery.getByRole("region", { name: "Recent mail" });
		const rows = recent.getByRole("listitem");
		expect(await rows.count()).toBe(2);
		const first = await rows.first().textContent();
		for (const text of ["parser", "lexer", "Delivered", "12m", "The parser now needs a token"])
			expect(first).toContain(text);
		expect(await rows.nth(1).textContent()).toContain("Lexer is done");
		await shot(page, "aw-16-rookery-mail");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("writing a letter mails any agent, awake or asleep, as the operator, and shows its receipt", async () => {
	const { page, errors } = await openWorld(world([ORLA, PARSER, LEXER]));
	try {
		await travel(page, /^The rookery/, "rookery");
		const rookery = await talkToKeeper(page);
		await rookery.getByRole("button", { name: "Write a letter" }).click();
		const to = rookery.getByRole("combobox", { name: "To" });
		expect(await to.locator("option").allTextContents()).toEqual(
			expect.arrayContaining(["Orla", "parser", "lexer", "sleepy (asleep)"]),
		);
		await to.selectOption("parser");
		await rookery.getByRole("textbox", { name: "Letter" }).fill("Please add the comment tokens today.");
		await shot(page, "aw-16-letter");
		await rookery.getByRole("button", { name: "Send" }).click();
		await rookery.getByText("Delivered to parser.").waitFor({ timeout: 3000 });
		expect(await calls(page)).toContainEqual(["sendMail", "parser", "Please add the comment tokens today."]);
		await shot(page, "aw-16-letter-sent");

		// To a sleeper, the receipt says it waits.
		await page.evaluate(() => {
			(window as any).answers.sendMail = {
				ok: true,
				stage: "accepted",
				note: "not running; the mail waits until it opens",
			};
		});
		await rookery.getByRole("button", { name: "Write another" }).click();
		await rookery.getByRole("combobox", { name: "To" }).selectOption("sleepy");
		await rookery.getByRole("textbox", { name: "Letter" }).fill("Wake up soon.");
		await rookery.getByRole("button", { name: "Send" }).click();
		await rookery.getByText("It waits until sleepy wakes.").waitFor({ timeout: 3000 });
		expect(await calls(page)).toContainEqual(["sendMail", "sleepy", "Wake up soon."]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("the Mail tab lists the same traffic and writes a letter from anywhere", async () => {
	const { page, errors } = await openWorld(world([ORLA, PARSER, LEXER]));
	try {
		await tab(page, "Mail");
		const panel = page.getByRole("tabpanel", { name: "Mail" });
		await panel.getByRole("listitem").first().waitFor({ timeout: 3000 });
		expect(await panel.getByRole("listitem").count()).toBe(3);
		const rows = await panel.getByRole("listitem").allTextContents();
		expect(rows[0]).toContain("Orla");
		expect(rows[0]).toContain("sleepy");
		expect(rows[0]).toContain("Waiting");
		expect(rows[1]).toContain("parser");
		expect(rows[1]).toContain("Delivered");
		await shot(page, "aw-16-mail-tab");
		await panel.getByRole("button", { name: "Write a letter" }).click();
		const rookery = page.getByRole("dialog", { name: "The rookery" });
		await rookery.getByRole("combobox", { name: "To" }).waitFor({ timeout: 3000 });
		expect(await view(page, "place()")).toBe(`headquarters:${HQ}`);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a letter between two characters here flies as a bird from sender to receiver; to someone elsewhere, out by the door", async () => {
	const { page, push, errors } = await openWorld(world([ORLA, PARSER, LEXER]));
	try {
		await travel(page, /^apple-pi wing/, `wing:${HQ}:/r/apple-pi`);
		await vi.waitFor(async () => expect((await figures(page)).every((f) => !f.moving)).toBe(true), { timeout: 8000 });
		// Mail already known when the place opened flies no bird.
		expect(await birds(page)).toEqual([]);
		const fresh = letter("m4", PARSER, LEXER, "Tokens are in.", 0);
		await push(world([ORLA, PARSER, LEXER], [fresh, ...MAIL]));
		await vi.waitFor(async () => expect((await birds(page)).map((b) => b.id)).toEqual(["m4"]), { timeout: 3000 });
		const parser = (await figures(page)).find((f) => f.id === "parser")!;
		const lexer = (await figures(page)).find((f) => f.id === "lexer")!;
		const start = (await birds(page))[0];
		expect(start).toMatchObject({ from: "parser", to: "lexer", out: false });
		expect(Math.hypot(start.x - parser.x, start.y - parser.y)).toBeLessThan(
			Math.hypot(start.x - lexer.x, start.y - lexer.y),
		);
		await page.waitForTimeout(500);
		await shot(page, "aw-16-bird");
		const frames = new Set<number>();
		for (let i = 0; i < 6; i++) {
			for (const bird of await birds(page)) frames.add(bird.frame);
			await page.waitForTimeout(90);
		}
		expect(frames.size).toBeGreaterThan(1); // its wings beat
		await vi.waitFor(async () => expect(await birds(page)).toEqual([]), { timeout: 6000 });

		// To Orla in the hall: it flies out through the door.
		const away = letter("m5", LEXER, ORLA, "Done here.", 0);
		await push(world([ORLA, PARSER, LEXER], [away, fresh, ...MAIL]));
		await vi.waitFor(async () => expect((await birds(page)).map((b) => b.id)).toEqual(["m5"]), { timeout: 3000 });
		expect((await birds(page))[0]).toMatchObject({ from: "lexer", to: "orla", out: true });
		await vi.waitFor(async () => expect(await birds(page)).toEqual([]), { timeout: 6000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);
