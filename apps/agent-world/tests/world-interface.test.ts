import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, FeedLine, PlaceRef, WorldSnapshot } from "../src/world.js";

// Seam 2 for the interface (minimap, orbs, side panel, chatbox): the committed, built world UI in headless Chrome,
// with the preload API replaced by a fixture backend that records what the interface asks of it.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots of each tab and the chatbox there, as aw-08-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

/** Open the world over a fixture backend; `push` and `pushFeed` send it news, `terminals` lists terminal requests. */
async function openWorld(first: WorldSnapshot, backlog: FeedLine[] = []) {
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
		([snapshot, lines]) => {
			const listeners = new Set<(s: unknown) => void>();
			const feedListeners = new Set<(l: unknown) => void>();
			let current = snapshot;
			const w = window as any;
			w.terminals = [];
			w.agentWorld = {
				snapshot: async () => current,
				onUpdate(listener: (s: unknown) => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				feed: async () => lines,
				onFeed(listener: (l: unknown) => void) {
					feedListeners.add(listener);
					return () => feedListeners.delete(listener);
				},
				goToTerminal: async (id: string) => {
					w.terminals.push(id);
					return id === "solo" ? { ok: false, reason: "No terminal is attached to solo's tmux server." } : { ok: true };
				},
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
			};
			w.pushSnapshot = (next: unknown) => {
				current = next as typeof snapshot;
				for (const listener of listeners) listener(next);
			};
			w.pushFeed = (next: unknown) => {
				for (const listener of feedListeners) listener(next);
			};
		},
		[first, backlog] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	const push = (snapshot: WorldSnapshot) => page.evaluate((s) => (window as any).pushSnapshot(s), snapshot);
	const pushFeed = (lines: FeedLine[]) => page.evaluate((l) => (window as any).pushFeed(l), lines);
	await vi.waitFor(async () => expect(await place(page)).toBeTruthy(), { timeout: 15000 });
	await page.locator(".aw-side").waitFor({ timeout: 5000 });
	return { page, push, pushFeed, errors };
}

const place = (page: Page) => page.evaluate(() => (window as any).agentWorldView.place() as string | undefined);
const intents = (page: Page) => page.evaluate(() => (window as any).agentWorldInterface.intents() as unknown[]);
const terminals = (page: Page) => page.evaluate(() => (window as any).terminals as string[]);

/** The open tab's groups: each heading with the names of its rows, in order. */
const groups = (page: Page) =>
	page.$$eval(".aw-panel-body section", (sections) =>
		sections.map((section) => ({
			title: section.getAttribute("aria-label") ?? "",
			names: [...section.querySelectorAll(".aw-row-name")].map((n) => n.textContent),
		})),
	);
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();
const orb = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}: `) });

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(450);
	await page.screenshot({ path: join(SHOTS, `aw-08-${name}.png`), animations: "disabled" });
}

// A fixture world: Orla coordinates; her workers are in two wings and the common room; solo is in the square.
const HQ = "orla";
// Minutes since an hour ago, so times read as they would live ("waiting 30m").
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
		git: null,
		cwd: "/Users/op/code/apple-pi",
		reportsTo: HQ,
		model: "claude-opus-4",
		contextTokens: 48_000,
		contextWindow: 200_000,
		cost: 0.42,
		tmux: { socket: "/private/tmp/tmux-501/default", pane: "%3", session: "main", window: 2 },
		...over,
	};
}
const wing = (repository: string): PlaceRef => ({ kind: "wing", headquarters: HQ, repository });
const person = (id: string, place: PlaceRef, n: number, f: Partial<CharacterFacts> = {}): Character => ({
	id,
	name: id,
	role: place.kind === "headquarters" ? "coordinator" : place.kind === "square" ? "independent" : "worker",
	place,
	startedAt: at(n),
	facts: facts(f),
});
const DOCS_TASK = { title: "Document the interface", status: "in-progress", bundle: "/l/202610190001-docs" };
const RETRY_TASK = { title: "Retry failed invoices", status: "ready", bundle: "/l/202610190002-retry" };
const working = (tool: string, arg: string): Partial<CharacterFacts> => ({
	run: "running_tool",
	status: "working",
	tool: { name: tool, arg, since: at(50) },
});
const asking = (text: string, since: number): Partial<CharacterFacts> => ({
	status: "asking",
	asking: { kind: "questionnaire", text },
	needsYouSince: at(since),
});
const finished = (since: number): Partial<CharacterFacts> => ({
	unseen: true,
	needsYouSince: at(since),
	settledAt: at(since),
});

const CAST: Character[] = [
	{ ...person("Orla", { kind: "headquarters", headquarters: HQ }, 0, { reportsTo: null }), id: HQ },
	person("pi-docs", wing("/r/apple-pi"), 1, { ...working("bash", "npm test"), task: DOCS_TASK }),
	person("pi-tests", wing("/r/apple-pi"), 2, { ...asking("Which branch should I rebase on?", 30), task: DOCS_TASK }),
	person("ledger", wing("/r/billing-service"), 3, {
		...finished(20),
		task: RETRY_TASK,
		title: "Technical Writer",
		soul: "You quote the source before you paraphrase it.",
		selfHeadings: ["Teammates", "Who has done what"],
		tasks: ["202610190002-retry", "202610180009-invoices"],
	}),
	person("loose", { kind: "common-room", headquarters: HQ }, 4, working("read", "docs/session-state.md")),
	person("solo", { kind: "square" }, 5, { ...asking("Deploy now?", 40), reportsTo: null }),
];
function world(characters = CAST): WorldSnapshot {
	const count = (repository: string) =>
		characters.filter((c) => c.place.kind === "wing" && c.place.repository === repository).length;
	return {
		connected: true,
		headquarters: [
			{
				id: HQ,
				name: "Orla",
				wings: ["/r/apple-pi", "/r/billing-service", "/r/legacy-auth"].map((repository) => ({
					repository,
					name: repository.split("/").pop()!,
					headcount: count(repository),
				})),
			},
		],
		characters,
	};
}

test("the orbs count who needs you and who is working, leave a slot for Slack, and open their tabs", async () => {
	const { page, push, errors } = await openWorld(world());
	try {
		// Needs you: two questions and one finished; working: two.
		await expect(orb(page, "Needs you").getAttribute("aria-label")).resolves.toBe("Needs you: 3");
		await expect(orb(page, "Working").getAttribute("aria-label")).resolves.toBe("Working: 2");
		await expect(page.locator(".aw-orb-slack").count()).resolves.toBe(1);
		await orb(page, "Needs you").click();
		await expect(page.getByRole("tab", { name: "Needs you", exact: true }).getAttribute("aria-selected")).resolves.toBe(
			"true",
		);
		await orb(page, "Working").click();
		await expect(page.getByRole("tab", { name: "Agents", exact: true }).getAttribute("aria-selected")).resolves.toBe(
			"true",
		);
		// Counts follow the world.
		await push(world(CAST.map((c) => (c.id === "ledger" ? { ...c, facts: facts({ task: RETRY_TASK }) } : c))));
		await vi.waitFor(async () => expect(await orb(page, "Needs you").getAttribute("aria-label")).toBe("Needs you: 2"), {
			timeout: 2000,
		});
		await shot(page, "orbs-minimap");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("a finished character that starts working again shows as working at once, with its unseen result marked beside", async () => {
	const { page, push, errors } = await openWorld(world());
	try {
		const row = () => page.locator(".aw-row").filter({ hasText: "ledger" });
		await expect(row().locator(".aw-sr").first().textContent()).resolves.toBe(", Finished, unseen: ");
		// Mail starts a run without the operator: the earlier settle is still unseen, and needs_you_since is kept.
		const again = (f: Partial<CharacterFacts>) =>
			world(CAST.map((c) => (c.id === "ledger" ? { ...c, facts: { ...c.facts!, ...f } } : c)));
		await push(again({ ...working("bash", "git fetch -q origin main"), unseen: true }));
		await vi.waitFor(
			async () => expect(await row().locator(".aw-sr").first().textContent()).toBe(", Working, result unseen: "),
			{ timeout: 2000 },
		);
		await expect(row().locator(".aw-pip-working .aw-pip-mark").count()).resolves.toBe(1);
		await expect(row().textContent()).resolves.toContain("bash \u00b7 git fetch -q origin main");
		// It waits for nobody while it works: it leaves Needs you and counts as working.
		await expect(orb(page, "Needs you").getAttribute("aria-label")).resolves.toBe("Needs you: 2");
		await expect(orb(page, "Working").getAttribute("aria-label")).resolves.toBe("Working: 3");
		await tab(page, "Needs you");
		expect(await groups(page)).toEqual([{ title: "Questions", names: ["pi-tests", "solo"] }]);
		await tab(page, "Agents");
		await row().locator(".aw-row-main").click();
		await page.getByRole("button", { name: "Examine ledger" }).click();
		const card = page.getByRole("dialog", { name: "Examine ledger" });
		await expect(card.locator(".aw-card-status").textContent()).resolves.toContain("Working");
		await expect(card.locator(".aw-card-unseen").textContent()).resolves.toBe("An earlier result unseen for 40m");
		await shot(page, "working-unseen");
		// When that run settles too, it is finished and unseen again, waiting since its first unseen settle.
		await push(again({ run: "idle", status: "idle", tool: null, unseen: true }));
		await vi.waitFor(
			async () => expect(await row().locator(".aw-sr").first().textContent()).toBe(", Finished, unseen: "),
			{
				timeout: 2000,
			},
		);
		await expect(row().locator(".aw-pip-mark").count()).resolves.toBe(0);
		await expect(card.locator(".aw-card-unseen").count()).resolves.toBe(0);
		await expect(orb(page, "Needs you").getAttribute("aria-label")).resolves.toBe("Needs you: 3");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("Agents groups everyone by place; Needs you lists questions first, then finished work; Work groups by ledger task", async () => {
	const { page, errors } = await openWorld(world());
	try {
		expect(await groups(page)).toEqual([
			{ title: "Guild hall", names: ["Orla"] },
			{ title: "Common room", names: ["loose"] },
			{ title: "apple-pi wing", names: ["pi-docs", "pi-tests"] },
			{ title: "billing-service wing", names: ["ledger"] },
			{ title: "Village square", names: ["solo"] },
		]);
		await shot(page, "tab-agents");
		await tab(page, "Needs you");
		// Questions, the longest-waiting first; then finished and unseen. Working and idle agents are not listed.
		expect(await groups(page)).toEqual([
			{ title: "Questions", names: ["pi-tests", "solo"] },
			{ title: "Finished, unseen", names: ["ledger"] },
		]);
		await expect(page.locator(".aw-panel-body").textContent()).resolves.toContain(
			"Asks: Which branch should I rebase on?",
		);
		await shot(page, "tab-needs-you");
		await tab(page, "Work");
		expect(await groups(page)).toEqual([
			{ title: "Document the interface", names: ["pi-docs", "pi-tests"] },
			{ title: "Retry failed invoices", names: ["ledger"] },
			{ title: "No ledger task", names: ["Orla", "loose", "solo"] },
		]);
		await expect(page.getByRole("region", { name: "Document the interface" }).textContent()).resolves.toContain(
			"in-progress",
		);
		await shot(page, "tab-work");
		// Clicking the open tab folds the panel to its tabs; clicking again opens it.
		await tab(page, "Work");
		await expect(page.locator(".aw-panel-body").count()).resolves.toBe(0);
		await tab(page, "Work");
		await expect(page.locator(".aw-panel-body").count()).resolves.toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("every row offers Talk to, Examine, Go to, and Go to its terminal, which work on a character in another place without walking", async () => {
	const { page, errors } = await openWorld(world());
	try {
		expect(await place(page)).toBe(`headquarters:${HQ}`);
		await page.getByRole("button", { name: /^ledger/ }).click();
		const actions = page.getByRole("group", { name: "Actions on ledger" });
		// ledger holds a role, so it can retire, in the theme's words; the operator's own sessions cannot.
		await expect(actions.getByRole("button").allTextContents()).resolves.toEqual([
			"Talk to",
			"Examine",
			"Go to",
			"Terminal",
			"Rename",
			"Leave the guild",
			"End session",
		]);
		await expect(page.getByRole("button", { name: "Retire Orla" }).count()).resolves.toBe(0);
		await shot(page, "row-actions");
		await actions.getByRole("button", { name: "Talk to ledger" }).click();
		// Talking opens the conversation over everything; Escape closes it.
		await page.getByRole("dialog", { name: "Conversation with ledger" }).waitFor({ timeout: 2000 });
		await page.keyboard.press("Escape");
		await actions.getByRole("button", { name: "Go to ledger's terminal" }).click();
		await vi.waitFor(async () => expect(await terminals(page)).toEqual(["ledger"]), { timeout: 2000 });
		// Nothing so far moved the view: the operator is still in the hall.
		expect(await place(page)).toBe(`headquarters:${HQ}`);
		await page.getByRole("log").getByText("You go to ledger's terminal.").waitFor({ timeout: 2000 });

		// Examining shows the observed facts.
		await actions.getByRole("button", { name: "Examine ledger" }).click();
		const card = page.getByRole("dialog", { name: "Examine ledger" });
		await card.waitFor({ timeout: 2000 });
		const text = await card.textContent();
		for (const fact of [
			"Finished, unseen",
			"Retry failed invoices (ready)",
			"claude-opus-4",
			"48k of 200k (24%)",
			"$0.42",
			"main:2 (%3)",
			"Reports to",
			"Orla",
			"billing-service wing",
			"Technical Writer",
			"You quote the source before you paraphrase it.",
			"Teammates \u00b7 Who has done what",
		])
			expect(text).toContain(fact);
		// The record: its other ledger tasks, besides the one it holds now.
		expect(text).toContain("202610180009-invoices");
		expect(text).not.toContain("202610190002-retry");
		await shot(page, "examine");
		await card.getByRole("button", { name: "Close" }).click();
		await card.waitFor({ state: "detached", timeout: 2000 });

		// A failed terminal says why.
		await tab(page, "Needs you");
		await page.getByRole("button", { name: /^solo/ }).click();
		await page.getByRole("button", { name: "Go to solo's terminal" }).click();
		await page.getByRole("log").getByText("No terminal is attached to solo's tmux server.").waitFor({ timeout: 2000 });

		// Go to travels to the character's place.
		await page.getByRole("button", { name: "Go to solo", exact: true }).click();
		await vi.waitFor(async () => expect(await place(page)).toBe("square"), { timeout: 3000 });
		expect(await intents(page)).toEqual([
			{ kind: "talk-to", character: "ledger" },
			{ kind: "terminal", character: "ledger" },
			{ kind: "examine", character: "ledger" },
			{ kind: "terminal", character: "solo" },
			{ kind: "go-to", character: "solo" },
		]);
		expect(await page.evaluate(() => (window as any).agentWorldView.talkedTo())).toEqual(["ledger"]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

const line = (seq: number, kind: FeedLine["kind"], character: string, text: string): FeedLine => ({
	seq,
	at: Date.now() - (100 - seq) * 1000,
	kind,
	character,
	name: character,
	text,
});

test("runtime events appear in the chatbox within a second, and the filters hide and show each kind", async () => {
	const backlog = [
		line(1, "agents", "pi-docs", "pi-docs started."),
		line(2, "mail", "ledger", "Mail from Orla to ledger: Pause the backfill."),
	];
	const { page, pushFeed, errors } = await openWorld(world(), backlog);
	try {
		const log = page.getByRole("log");
		await log.getByText("pi-docs started.").waitFor({ timeout: 2000 });
		await log.getByText("Mail from Orla to ledger: Pause the backfill.").waitFor({ timeout: 1000 });
		await pushFeed([
			line(3, "agents", "pi-tests", "pi-tests asks: Which branch should I rebase on?"),
			line(4, "commands", "pi-docs", "Message for pi-docs: Run the tests."),
			line(5, "agents", "ledger", "ledger finished its turn."),
		]);
		await log.getByText("ledger finished its turn.").waitFor({ timeout: 1000 });
		await shot(page, "chatbox");
		const kinds = () => page.$$eval(".aw-chat-line", (lines) => lines.map((l) => (l as HTMLElement).dataset.kind));
		const filters = page.getByRole("toolbar", { name: "Chat filters" });
		const toggle = (name: string) => filters.getByRole("button", { name, exact: true }).click();
		expect(new Set(await kinds())).toEqual(new Set(["game", "agents", "mail", "commands"]));
		for (const [name, kind] of [
			["Agents", "agents"],
			["Mail", "mail"],
			["Commands", "commands"],
			["Game", "game"],
		]) {
			await toggle(name);
			expect(await kinds()).not.toContain(kind);
			await expect(filters.getByRole("button", { name, exact: true }).getAttribute("aria-pressed")).resolves.toBe(
				"false",
			);
			await toggle(name);
			expect(await kinds()).toContain(kind);
		}
		await toggle("Agents");
		await toggle("Mail");
		await shot(page, "chatbox-filtered");
		await toggle("All");
		expect(new Set(await kinds())).toEqual(new Set(["game", "agents", "mail", "commands"]));
		// A name in a line examines that character.
		await log.getByRole("button", { name: "ledger" }).first().click();
		await page.getByRole("dialog", { name: "Examine ledger" }).waitFor({ timeout: 2000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("Places travels anywhere at once, and Settings toggles the walk grid", async () => {
	const { page, errors } = await openWorld(world());
	try {
		await tab(page, "Places");
		expect(await groups(page)).toEqual([
			{
				title: "Orla's headquarters",
				names: [
					"Guild hall",
					"Common room",
					"Gallery of wings",
					"apple-pi wing",
					"billing-service wing",
					"legacy-auth wing",
				],
			},
			{
				title: "Outside",
				names: [
					"Village square",
					"Harbour lane",
					"The forge",
					"The quest office",
					"The library",
					"The inn",
					"The rookery",
				],
			},
		]);
		await shot(page, "tab-places");
		await page.getByRole("button", { name: /^billing-service wing/ }).click();
		await vi.waitFor(async () => expect(await place(page)).toBe(`wing:${HQ}:/r/billing-service`), { timeout: 3000 });
		await page.getByRole("log").getByText("You enter the billing-service wing.").waitFor({ timeout: 2000 });

		await tab(page, "Settings");
		const grid = page.getByRole("switch", { name: /Walk grid/ });
		await expect(grid.getAttribute("aria-checked")).resolves.toBe("false");
		await grid.click();
		await vi.waitFor(async () => expect(await grid.getAttribute("aria-checked")).toBe("true"), { timeout: 2000 });
		expect(await page.evaluate(() => (window as any).agentWorldView.walkGrid())).toBe(true);
		await shot(page, "tab-settings");
		await grid.click();
		await vi.waitFor(async () => expect(await grid.getAttribute("aria-checked")).toBe("false"), { timeout: 2000 });
		expect((await intents(page)).filter((i: any) => i.kind !== "go-to")).toEqual([
			{ kind: "travel", place: wing("/r/billing-service") },
			{ kind: "walk-grid", shown: true },
			{ kind: "walk-grid", shown: false },
		]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the minimap shows the place with a dot for each character and the avatar, and a click asks to walk there", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const dots = () =>
			page.$$eval(".aw-dot", (all) =>
				all.map((d) => `${[...d.classList].find((c) => c.startsWith("aw-dot-"))}:${(d as HTMLElement).dataset.id}`),
			);
		await vi.waitFor(async () => expect((await dots()).sort()).toEqual(["aw-dot-agent:orla", "aw-dot-avatar:avatar"]), {
			timeout: 3000,
		});
		await tab(page, "Places");
		await page.getByRole("button", { name: /^apple-pi wing/ }).click();
		await vi.waitFor(
			async () =>
				expect((await dots()).sort()).toEqual([
					"aw-dot-agent:pi-docs",
					"aw-dot-agent:pi-tests",
					"aw-dot-avatar:avatar",
				]),
			{ timeout: 3000 },
		);
		// pi-tests asks: its dot calls.
		await expect(page.locator('.aw-dot[data-id="pi-tests"]').getAttribute("class")).resolves.toContain(
			"aw-dot-calling",
		);
		const map = page.getByRole("button", { name: /^Minimap/ });
		const box = (await map.boundingBox())!;
		await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
		const walk = (await intents(page)).find((i: any) => i.kind === "walk-to") as any;
		expect(walk.place).toBe(`wing:${HQ}:/r/apple-pi`);
		const painted = await page.evaluate(() => (window as any).agentWorldView.painting());
		expect(painted).toBe("wing-small");
		// The centre of the map is the centre of the place, within half a tile.
		const { cols, rows } = JSON.parse(readFileSync(join(appDir, "themes/fantasy/places/wing-small.json"), "utf8"));
		expect(Math.abs(walk.at[0] - cols / 2)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(walk.at[1] - rows / 2)).toBeLessThanOrEqual(0.5);
		await shot(page, "minimap-wing");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the chatbox is compact (five lines), shows more on demand, and folds to its bar; the side panel folds from its header", async () => {
	const backlog = Array.from({ length: 14 }, (_, i) => line(i + 1, "agents", "pi-docs", `pi-docs line ${i + 1}.`));
	const { page, errors } = await openWorld(world(), backlog);
	try {
		const chatLog = page.getByRole("log", { name: "World events" });
		await chatLog.getByText("pi-docs line 14.").waitFor({ timeout: 2000 });
		// Five lines show, the newest at the bottom; the world keeps the rest of the window.
		const shown = () =>
			chatLog.evaluate((el) => {
				const box = el.getBoundingClientRect();
				return [...el.querySelectorAll(".aw-chat-line")].filter((l) => {
					const r = l.getBoundingClientRect();
					return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
				}).length;
			});
		await expect(shown()).resolves.toBe(5);
		const compact = (await page.locator(".aw-chat").boundingBox())!.height;
		expect(compact).toBeLessThan(160);
		await shot(page, "chat-compact");
		await page.getByRole("button", { name: "Show more lines" }).click();
		await expect(shown()).resolves.toBeGreaterThanOrEqual(12);
		await shot(page, "chat-tall");
		await page.getByRole("button", { name: "Show fewer lines" }).click();
		await expect(shown()).resolves.toBe(5);
		await page.getByRole("button", { name: "Fold the chatbox" }).click();
		await expect(chatLog.count()).resolves.toBe(0);
		await page.getByRole("button", { name: "Open the chatbox" }).click();
		await expect(shown()).resolves.toBe(5);

		// The side panel folds to its tabs from its header; a tab opens it again.
		await page.getByRole("button", { name: "Fold the side panel" }).click();
		await expect(page.locator(".aw-panel-body").count()).resolves.toBe(0);
		await expect(page.getByRole("tab", { name: "Agents", exact: true }).getAttribute("title")).resolves.toBe(
			"Open Agents",
		);
		await shot(page, "folded");
		await tab(page, "Agents");
		await expect(page.locator(".aw-panel-body").count()).resolves.toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("tool lines leave out a leading `cd <dir> &&` and the working directory, in the rows and the examine card alike", async () => {
	const busy = person("pi-build", wing("/r/apple-pi"), 6, {
		...working("bash", "cd /Users/op/code/apple-pi && npx vitest run /Users/op/code/apple-pi/tests/a.test.ts"),
	});
	const reading = person("pi-read", wing("/r/apple-pi"), 7, working("read", "/Users/op/code/apple-pi/docs/x.md"));
	const elsewhere = person(
		"pi-else",
		wing("/r/apple-pi"),
		8,
		working("bash", "cd /tmp/scratch && ls /tmp/scratch/out"),
	);
	const { page, errors } = await openWorld(world([...CAST, busy, reading, elsewhere]));
	try {
		const detail = (name: string) =>
			page
				.getByRole("button", { name: new RegExp(`^${name}`) })
				.locator(".aw-row-detail")
				.textContent();
		await expect(detail("pi-build")).resolves.toBe("bash \u00b7 npx vitest run tests/a.test.ts");
		await expect(detail("pi-read")).resolves.toBe("read \u00b7 docs/x.md");
		await expect(detail("pi-else")).resolves.toBe("bash \u00b7 ls out");
		await page.getByRole("button", { name: /^pi-build/ }).click();
		await page.getByRole("button", { name: "Examine pi-build" }).click();
		const card = page.getByRole("dialog", { name: "Examine pi-build" });
		await expect(card.locator("dd").first().textContent()).resolves.toBe("bash \u00b7 npx vitest run tests/a.test.ts");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the Mail tab shows conversations needing the operator, reads them, and sends a thread reply", async () => {
	const snapshot = {
		...world(),
		operatorMail: [{ id: "approval", subject: "Release approval", unread: 1, lastAt: Date.now() }],
	};
	const { page, push, errors } = await openWorld(snapshot);
	try {
		await page.evaluate(() => {
			const w = window as any;
			w.mailCalls = [];
			const thread = {
				id: "approval",
				subject: "Release approval",
				closed: false,
				participants: [
					{ id: "operator", name: "Operator" },
					{ id: "ada", name: "Ada" },
				],
				messages: [{ seq: 1, from: "ada", name: "Ada", body: "May we release?", at: Date.now() }],
			};
			w.agentWorld.readThread = async (id: string) => {
				w.mailCalls.push(["read", id]);
				return { ok: true, thread };
			};
			w.agentWorld.replyThread = async (id: string, body: string) => {
				w.mailCalls.push(["reply", id, body]);
				thread.messages.push({ seq: 2, from: "operator", name: "Operator", body, at: Date.now() });
				return { ok: true, stage: "applied" };
			};
		});
		await tab(page, "Mail");
		expect(await page.getByRole("status", { name: "1 conversations need you" }).count()).toBe(1);
		await page.getByRole("button", { name: /Release approval.*Needs you/ }).click();
		await page.getByText("May we release?", { exact: true }).waitFor();
		await push({ ...snapshot, operatorMail: [{ ...snapshot.operatorMail[0], unread: 0 }] });
		await vi.waitFor(async () =>
			expect(await page.getByRole("status", { name: "1 conversations need you" }).count()).toBe(0),
		);
		await page.getByRole("textbox", { name: "Reply to everyone" }).fill("Approved. Keep the rollback ready.");
		await page.getByRole("button", { name: "Send reply", exact: true }).click();
		await page.getByText("Approved. Keep the rollback ready.", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).mailCalls)).toEqual([
			["read", "approval"],
			["reply", "approval", "Approved. Keep the rollback ready."],
			["read", "approval"],
		]);
		if (SHOTS) {
			mkdirSync(SHOTS, { recursive: true });
			await page.screenshot({ path: join(SHOTS, "operator-inbox.png"), animations: "disabled" });
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the Places tab lists every function place as open, the inn with who sleeps and the rookery with what mail waits", async () => {
	const sleeper = (id: string) => ({
		id,
		name: id,
		role: "worker" as const,
		reportsTo: HQ,
		repository: null,
		cwd: "/r",
		task: null,
		stoppedAt: at(10),
		stopReason: "exited",
		startedAt: at(1),
	});
	const letter = {
		id: "m1",
		from: HQ,
		fromName: "Orla",
		to: "sleepy",
		toName: "sleepy",
		body: "Wake up.",
		sentAt: at(30),
		deliveredAt: null,
		state: "waiting" as const,
		reason: "asleep",
	};
	const { page, errors } = await openWorld({
		...world(),
		dormant: [sleeper("sleepy"), sleeper("dozy")],
		mail: [letter],
	});
	try {
		await tab(page, "Places");
		const outside = page.getByRole("region", { name: "Outside" });
		await expect(outside.locator(".aw-row-name").allTextContents()).resolves.toEqual([
			"Village square",
			"Harbour lane",
			"The forge",
			"The quest office",
			"The library",
			"The inn",
			"The rookery",
		]);
		await expect(outside.getByRole("button", { name: /^The inn/ }).textContent()).resolves.toContain("2 asleep");
		await expect(outside.getByRole("button", { name: /^The rookery/ }).textContent()).resolves.toContain(
			"1 letter waits",
		);
		// Every function place is open now: nothing waits under "Not open yet".
		expect(await page.getByRole("region", { name: "Not open yet" }).count()).toBe(0);
		await outside.getByRole("button", { name: /^The rookery/ }).click();
		await vi.waitFor(async () => expect(await place(page)).toBe("rookery"), { timeout: 3000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);
