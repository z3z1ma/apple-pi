import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { SlackChannel, SlackMessage } from "../src/integrations.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for the town square and the crier (tickets 27 and 28): the committed, built world UI in headless Chrome over
// a fixture backend that answers Slack like the integrations backend does (`src/integrations.ts`), records every call,
// and gives a confirmation token only through `describeWrite`, as the outside-write gate does.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-27-*.png and aw-28-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const square = (theme: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${theme}/places/square.json`, import.meta.url)), "utf8"));
const SQUARE = square("fantasy");
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

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
		reportsTo: null,
		model: "claude-opus-4",
		contextTokens: 48_000,
		contextWindow: 200_000,
		cost: 0.42,
		tmux: null,
		...over,
	};
}
const independent = (id: string, name: string, n: number, over: Partial<CharacterFacts> = {}): Character => ({
	id,
	name,
	role: "independent",
	place: { kind: "square" },
	startedAt: NOW - 8_000_000 + n,
	facts: facts(over),
});
const WREN = independent("wren", "Wren", 1);
const BRAM = independent("bram", "Bram", 2, { run: "running_tool", status: "working" });

function world(characters: Character[] = [WREN, BRAM], theme?: string): WorldSnapshot {
	return { connected: true, headquarters: [], characters, dormant: [], mail: [], ...(theme ? { theme } : {}) };
}

const channel = (id: string, name: string, unread: number | null, over: Partial<SlackChannel> = {}): SlackChannel => ({
	id,
	name,
	kind: "channel",
	unread,
	more: false,
	mentions: 0,
	latest: `${Math.floor(NOW / 1000) - unread! * 60}.000100`,
	url: `https://acme.slack.com/archives/${id}`,
	...over,
});
const UNREAD: SlackChannel[] = [
	channel("C0DEPLOY", "deploys", 4, { mentions: 2 }),
	channel("C0GENERAL", "general", 12),
	channel("D0MAYA", "Maya Lin", 1, { kind: "dm", url: null }),
];
/** A channel with nothing unread, found only by the crier. */
const QUIET = channel("C0RELEASE", "release-notes", null, { latest: null });
const msg = (ts: number, name: string, text: string, over: Partial<SlackMessage> = {}): SlackMessage => ({
	ts: `${Math.floor(NOW / 1000) - ts * 60}.000${String(ts).padStart(3, "0")}`,
	threadTs: null,
	user: `U${name.toUpperCase()}`,
	name,
	text,
	replies: 0,
	at: (Math.floor(NOW / 1000) - ts * 60) * 1000,
	...over,
});
const PARENT = msg(50, "Ines", "Is the 2.4 release going out today? The changelog still says draft.", { replies: 2 });
PARENT.threadTs = PARENT.ts;
const HISTORY: SlackMessage[] = [
	msg(90, "Tomas", "Morning! Release train leaves at 3."),
	PARENT,
	msg(20, "Maya", "Docs are merged; see https://example.com/docs/2.4 for the notes."),
];
const REPLIES: SlackMessage[] = [
	{ ...PARENT },
	msg(45, "Tomas", "Yes, once CI is green.", { threadTs: PARENT.ts }),
	msg(40, "Ines", "Great, thanks.", { threadTs: PARENT.ts }),
];

interface SlackFixture {
	signedIn: boolean;
	unread: SlackChannel[];
	quiet?: SlackChannel[];
	/** A channel's messages, instead of `HISTORY`. */
	history?: Record<string, SlackMessage[]>;
	/** Where the operator last read each channel, and each thread (by its parent's ts); null when Slack does not say. */
	lastRead?: Record<string, string | null>;
}

/** Open the world over a fixture backend; `window.calls` records what it was asked. */
async function openWorld(first: WorldSnapshot, slack: SlackFixture, viewport = { width: 1280, height: 800 }) {
	const page = await browser.newPage({ viewport });
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
		([snapshot, fixture, history, replies]) => {
			const listeners = new Set<(s: unknown) => void>();
			const writes = new Set<(e: unknown) => void>();
			const receipts = new Set<(r: unknown) => void>();
			let current = snapshot;
			const w = window as any;
			w.calls = [];
			w.slack = fixture;
			const account = { team: "Acme", url: "https://acme.slack.com/", user: "op" };
			let tokens = 0;
			const described = new Map<string, string>();
			const signedIn = () => w.slack.signedIn;
			const refuse = { ok: false, reason: "Sign in to Slack in Settings first.", signIn: "slack" };
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
				instruct: async () => ({ ok: true }),
				onReceipt(listener: (r: unknown) => void) {
					receipts.add(listener);
					return () => receipts.delete(listener);
				},
				watchReplies: async () => {},
				onReply: () => () => {},
				openLink: async (url: string) => {
					w.calls.push(["openLink", url]);
					return { ok: true };
				},
				credentialStatus: async () => {
					w.calls.push(["credentialStatus"]);
					return { atlassian: null, slack: signedIn() ? account : null };
				},
				signInSlack: async () => {
					w.calls.push(["signInSlack"]);
					await new Promise((resolve) => setTimeout(resolve, 300));
					w.slack.signedIn = true;
					return { ok: true, team: "Acme" };
				},
				signOutSlack: async () => {
					w.calls.push(["signOutSlack"]);
					w.slack.signedIn = false;
					return { ok: true };
				},
				slackUnread: async () => {
					w.calls.push(["slackUnread"]);
					return signedIn() ? { ok: true, channels: w.slack.unread } : refuse;
				},
				slackFindChannels: async (text: string) => {
					w.calls.push(["slackFindChannels", text]);
					if (!signedIn()) return refuse;
					const all = [...w.slack.unread, ...(w.slack.quiet ?? [])];
					const wanted = text.replace(/^#/, "").toLowerCase();
					return {
						ok: true,
						channels: all
							.filter((c: any) => c.name.toLowerCase().includes(wanted))
							.map((c: any) => ({ ...c, unread: null, more: false, mentions: 0, latest: null })),
					};
				},
				slackChannel: async (id: string) => {
					w.calls.push(["slackChannel", id]);
					if (!signedIn()) return refuse;
					const found = [...w.slack.unread, ...(w.slack.quiet ?? [])].find((c: any) => c.id === id);
					return {
						ok: true,
						thread: {
							channel: { id, name: found?.name ?? id },
							messages: w.slack.history?.[id] ?? history,
							url: found?.url ?? null,
							lastRead: w.slack.lastRead?.[id] ?? null,
						},
					};
				},
				slackThread: async (id: string, ts: string) => {
					w.calls.push(["slackThread", id, ts]);
					return {
						ok: true,
						thread: {
							channel: { id, name: id },
							messages: replies,
							url: `https://acme.slack.com/archives/${id}/p1`,
							lastRead: w.slack.lastRead?.[ts] ?? null,
						},
					};
				},
				slackMarkRead: async (id: string, ts: string, threadTs?: string) => {
					w.calls.push(["slackMarkRead", id, ts, threadTs]);
					const found = [...w.slack.unread, ...(w.slack.quiet ?? [])].find((c: any) => c.id === id);
					const where = threadTs ? `#${found?.name}, in Ines's thread` : `#${found?.name}`;
					// Slack no longer lists it as unread.
					if (!threadTs) w.slack.unread = w.slack.unread.filter((c: any) => c.id !== id);
					const entry = {
						at: Date.now(),
						kind: "slack-mark-read",
						what: "Mark read in Slack",
						where,
						text: "",
						url: null,
						ok: true,
						line: threadTs
							? `You marked Ines's thread in #${found?.name} read in Slack.`
							: `You marked #${found?.name} read in Slack.`,
					};
					for (const listener of writes) listener(entry);
					return { ok: true, entry };
				},
				describeWrite: async (intent: any) => {
					w.calls.push(["describeWrite", intent]);
					const token = `t${++tokens}`;
					described.set(token, JSON.stringify(intent));
					return {
						ok: true,
						token,
						description: {
							what: "Reply in a Slack thread",
							where: `#release-notes, in Ines's thread: Is the 2.4 release going out today?`,
							text: intent.text,
							url: "https://acme.slack.com/archives/C0RELEASE/p1",
						},
					};
				},
				confirmWrite: async (intent: any, token: string) => {
					w.calls.push(["confirmWrite", intent, token]);
					if (described.get(token) !== JSON.stringify(intent)) return { ok: false, reason: "Not confirmed." };
					described.delete(token);
					const entry = {
						at: Date.now(),
						kind: intent.kind,
						what: "Reply in a Slack thread",
						where: "#release-notes",
						text: intent.text,
						url: null,
						ok: true,
						line: "You replied in a Slack thread in #release-notes.",
					};
					for (const listener of writes) listener(entry);
					return { ok: true, entry };
				},
				outsideWrites: async () => [],
				onOutsideWrite(listener: (e: unknown) => void) {
					writes.add(listener);
					return () => writes.delete(listener);
				},
				delegate: async (commandId: string, delegation: unknown) => {
					w.calls.push(["delegate", commandId, delegation]);
					setTimeout(() => {
						for (const listener of receipts)
							listener({ commandId, characterId: (delegation as any).to, stage: "applied" });
					}, 200);
					return { ok: true, to: (delegation as any).to, command: "talk" };
				},
			};
			w.pushSnapshot = (next: unknown) => {
				current = next as typeof snapshot;
				for (const listener of listeners) listener(next);
			};
		},
		[first, slack, HISTORY, REPLIES] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(500); // the arrival fade
	return { page, errors };
}

interface TownsfolkView {
	id: string;
	name: string;
	look: string;
	x: number;
	y: number;
	moving: boolean;
	badge: string;
	mentions: number;
	sign: boolean;
	alpha: number;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const townsfolk = (page: Page) => view<TownsfolkView[]>(page, "townsfolk()");
const calls = (page: Page) => page.evaluate(() => (window as any).calls) as Promise<unknown[][]>;
const called = async (page: Page, name: string) => (await calls(page)).filter((call) => call[0] === name);
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();
/** Clicks reach the world through the interface's panels (they still draw for screenshots). */
const clickThrough = (page: Page) =>
	page.addStyleTag({
		content:
			".aw-interface, .aw-interface * { pointer-events: none !important; } .aw-place-veil, .aw-place-veil * { pointer-events: auto !important; }",
	});

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(350);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Playwright's locator checks, waiting as its own `expect` would. */
const shows = (locator: Locator, timeout = 5000) => locator.first().waitFor({ state: "visible", timeout });
const hidden = (locator: Locator) => locator.first().waitFor({ state: "hidden", timeout: 5000 });
const reads = (locator: Locator, text: string | RegExp, timeout = 5000) =>
	vi.waitFor(
		async () => {
			const shown = await locator.innerText();
			if (typeof text === "string") expect(shown).toContain(text);
			else expect(shown).toMatch(text);
		},
		{ timeout },
	);
const counts = (locator: Locator, n: number) =>
	vi.waitFor(async () => expect(await locator.count()).toBe(n), { timeout: 5000 });

/** Wait until the square's townsfolk have faded in and stand still. */
async function settled(page: Page, count: number) {
	await vi.waitFor(
		async () => {
			const folk = await townsfolk(page);
			expect(folk).toHaveLength(count);
			expect(folk.every((f) => !f.moving && f.alpha > 0.99)).toBe(true);
		},
		{ timeout: 8000 },
	);
}

test("without a Slack sign-in the square has no townsfolk, the orb no number, and the crier says how to sign in", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), { signedIn: false, unread: UNREAD });
	expect(await view(page, "place()")).toBe("square");
	await page.waitForTimeout(800);
	expect(await townsfolk(page)).toEqual([]);
	const orb = page.locator(".aw-orb-slack");
	await expect(orb.getAttribute("aria-label")).resolves.toBe("Slack: not signed in");
	await expect(orb.locator(".aw-num").count()).resolves.toBe(0);
	// The crier stands at its post; talking to it explains.
	expect(await view(page, "host()")).toMatchObject({ look: "crier", x: SQUARE.host!.at[0], y: SQUARE.host!.at[1] });
	await shot(page, "aw-27-signed-out-square");
	await clickThrough(page);
	const [sx, sy] = await screen(page, SQUARE.host!.at[0], SQUARE.host!.at[1] - 1.2);
	await page.mouse.click(sx, sy);
	const crier = page.getByRole("dialog", { name: "Town crier" });
	await crier.waitFor({ timeout: 8000 });
	await shows(crier.getByText("Sign in to Slack as yourself"));
	await shows(crier.getByRole("button", { name: "Sign in to Slack" }));
	await shows(crier.getByText("Some workspaces forbid signing in this way"));
	await shot(page, "aw-28-crier-signed-out");
	expect(errors).toEqual([]);
	await page.close();
});

test("Settings signs in to Slack through the backend's window, shows the workspace, and signs out", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), { signedIn: false, unread: UNREAD });
	await tab(page, "Settings");
	const section = page.getByRole("region", { name: "Slack" });
	await shows(section.getByText("Some workspaces forbid signing in this way"));
	await section.getByRole("button", { name: "Sign in to Slack" }).click();
	await shows(section.getByRole("button", { name: "Waiting for Slack\u2026" }));
	await shows(section.getByText("Signed in to"), 5000);
	await shows(section.getByText("Acme"));
	expect(await called(page, "signInSlack")).toHaveLength(1);
	// Signed in, the square fills at once.
	await settled(page, 3);
	await shot(page, "aw-27-settings-signed-in");
	await section.getByRole("button", { name: "Sign out of Slack" }).click();
	await shows(section.getByRole("button", { name: "Sign in to Slack" }));
	expect(await called(page, "signOutSlack")).toHaveLength(1);
	await vi.waitFor(async () => expect(await townsfolk(page)).toEqual([]), { timeout: 5000 });
	expect(errors).toEqual([]);
	await page.close();
});

test("each unread channel stands in the square as a townsperson with its count; the orb and the Slack tab agree", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), { signedIn: true, unread: UNREAD });
	await settled(page, 3);
	const folk = await townsfolk(page);
	// On painted spots the two agents left free, wearing townsfolk looks.
	const looks = JSON.parse(
		readFileSync(fileURLToPath(new URL("../themes/fantasy/characters/looks.json", import.meta.url)), "utf8"),
	);
	const agents = await view<{ x: number; y: number }[]>(page, "figures()");
	for (const person of folk) {
		expect(looks[person.look].role).toBe("townsfolk");
		expect(SQUARE.spots.some(([x, y]) => x === person.x && y === person.y)).toBe(true);
		expect(agents.some(({ x, y }) => x === person.x && y === person.y)).toBe(false);
	}
	expect(Object.fromEntries(folk.map((f) => [f.name, f.badge]))).toEqual({
		"#deploys": "4",
		"#general": "12",
		"Maya Lin": "1",
	});
	expect(folk.find((f) => f.name === "#deploys")?.mentions).toBe(2);
	// The orb counts every unread message; the Slack tab lists the channels with their counts.
	await expect(page.locator(".aw-orb-slack").getAttribute("aria-label")).resolves.toBe("Unread in Slack: 17");
	await reads(page.locator(".aw-orb-slack .aw-num"), "17");
	await shot(page, "aw-27-square-fantasy");
	await page.locator(".aw-orb-slack").click();
	const list = page.getByRole("list", { name: "Unread channels" });
	await counts(list.getByRole("listitem"), 3);
	await reads(list.getByRole("listitem").nth(0), "deploys");
	await reads(list.getByRole("listitem").nth(0), "@2");
	await reads(list.getByRole("listitem").nth(0), "4");
	await reads(list.getByRole("listitem").nth(1), "general");
	await reads(list.getByRole("listitem").nth(1), "12");
	await shot(page, "aw-27-slack-tab");
	// Hovering a townsperson shows its channel's name.
	const general = folk.find((f) => f.name === "#general")!;
	await clickThrough(page);
	const [gx, gy] = await screen(page, general.x, general.y - 1);
	await page.mouse.move(gx, gy);
	await vi.waitFor(async () => expect((await townsfolk(page)).find((f) => f.id === general.id)?.sign).toBe(true));
	await reads(page.locator(".pointer-hover"), "Read #general");
	await shot(page, "aw-27-hover-name");
	expect(errors).toEqual([]);
	await page.close();
});

test("the square is bounded by its painted spots: with many unread channels only so many stand, the crier lists the rest", {
	timeout: 60_000,
}, async () => {
	const many = Array.from({ length: 40 }, (_, i) => channel(`C${String(i).padStart(4, "0")}`, `team-${i}`, 40 - i));
	const { page, errors } = await openWorld(world(), { signedIn: true, unread: many });
	// Ten painted spots, two held by the square's agents: eight townsfolk, the most pressing channels.
	const free = SQUARE.spots.length - 2;
	await settled(page, free);
	const folk = await townsfolk(page);
	expect(folk.map((f) => f.id).sort()).toEqual(many.slice(0, free).map((c) => c.id));
	// Every townsfolk look stands before any is worn twice, and none is worn a third time while another is worn once.
	const looks = JSON.parse(
		readFileSync(fileURLToPath(new URL("../themes/fantasy/characters/looks.json", import.meta.url)), "utf8"),
	);
	const kinds = Object.keys(looks).filter((look) => looks[look].role === "townsfolk").length;
	const worn = new Map<string, number>();
	for (const f of folk) worn.set(f.look, (worn.get(f.look) ?? 0) + 1);
	expect(worn.size).toBe(Math.min(kinds, free));
	expect(Math.max(...worn.values()) - Math.min(...worn.values())).toBeLessThanOrEqual(1);
	await shot(page, "aw-27-square-bounded");
	// Another agent comes out to the square: it takes a spot, and one townsperson makes way.
	const CORA = independent("cora", "Cora", 3);
	await page.evaluate((s) => (window as any).pushSnapshot(s), world([WREN, BRAM, CORA]));
	await settled(page, free - 1);
	// The crier knows every unread channel, standing in the square or not.
	await clickThrough(page);
	const [sx, sy] = await screen(page, SQUARE.host!.at[0], SQUARE.host!.at[1] - 1.2);
	await page.mouse.click(sx, sy);
	const crier = page.getByRole("dialog", { name: "Town crier" });
	await crier.waitFor({ timeout: 8000 });
	await counts(crier.getByRole("list", { name: "Unread channels" }).getByRole("listitem"), 40);
	await shows(crier.getByText("40 channels have unread messages"));
	// A standing channel read from the crier's list shows the person who stands for it.
	const standing = (await townsfolk(page))[0];
	await crier.getByRole("button", { name: new RegExp(`^Read ${standing.name},`) }).dispatchEvent("click");
	const portrait = page.locator(`img[src*="${standing.look}-portrait"]`);
	await portrait.first().waitFor({ timeout: 8000 });
	expect(errors).toEqual([]);
	await page.close();
});

/** Open the crier from the Slack tab. */
async function openCrier(page: Page) {
	await page.locator(".aw-orb-slack").click();
	await page.getByRole("button", { name: /^Ask the / }).click();
	const crier = page.locator(".aw-crier");
	await crier.waitFor({ timeout: 8000 });
	return crier;
}

test("the crier finds a channel with no unread messages and opens it; its thread expands with names and times", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), { signedIn: true, unread: UNREAD, quiet: [QUIET] });
	await settled(page, 3);
	const crier = await openCrier(page);
	await shot(page, "aw-28-crier");
	await crier.getByRole("searchbox").fill("release");
	const found = crier.getByRole("list", { name: "Channels found" });
	await counts(found.getByRole("listitem"), 1);
	await reads(found, "release-notes");
	expect((await called(page, "slackFindChannels")).at(-1)).toEqual(["slackFindChannels", "release"]);
	await shot(page, "aw-28-crier-found");
	await found.getByRole("button", { name: "Read #release-notes" }).click();
	const panel = page.getByRole("dialog", { name: "#release-notes in Slack" });
	await panel.waitFor({ timeout: 8000 });
	const log = panel.getByRole("log", { name: "Messages in #release-notes" });
	await counts(log.getByRole("article"), 3);
	await reads(log.getByRole("article").nth(0), "Tomas");
	await reads(log.getByRole("article").nth(1), "Is the 2.4 release going out today?");
	await reads(log.locator("time").first(), /\d\d:\d\d/);
	expect((await called(page, "slackChannel")).at(-1)).toEqual(["slackChannel", "C0RELEASE"]);
	await log.getByRole("button", { name: "2 replies" }).click();
	const thread = panel.getByLabel("Thread of Ines");
	await counts(thread.getByRole("article"), 2);
	await reads(thread, "Yes, once CI is green.");
	expect((await called(page, "slackThread")).at(-1)).toEqual(["slackThread", "C0RELEASE", PARENT.ts]);
	await shot(page, "aw-28-thread");
	expect(errors).toEqual([]);
	await page.close();
});

test("a reply is sent only after confirming its exact text and channel, and the chatbox logs it", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), { signedIn: true, unread: UNREAD, quiet: [QUIET] });
	const crier = await openCrier(page);
	await crier.getByRole("searchbox").fill("release");
	await crier.getByRole("button", { name: "Read #release-notes" }).click();
	const panel = page.getByRole("dialog", { name: "#release-notes in Slack" });
	const parent = panel.getByRole("article").filter({ hasText: "Is the 2.4 release" });
	await parent.hover();
	await parent.getByRole("button", { name: "Reply", exact: true }).click();
	const text = "Going out at 3 once CI is green; I'll post the notes here.";
	await panel.getByRole("textbox", { name: "Reply to Ines's thread" }).fill(text);
	await panel.getByRole("button", { name: "Reply\u2026" }).click();
	const confirm = page.getByRole("alertdialog", { name: "Reply in a Slack thread?" });
	await confirm.waitFor({ timeout: 5000 });
	await reads(confirm.getByLabel("Exactly what is sent"), text);
	await reads(confirm, "#release-notes, in Ines's thread");
	// Described, not sent.
	expect(await called(page, "describeWrite")).toEqual([
		["describeWrite", { kind: "slack-reply", channel: "C0RELEASE", threadTs: PARENT.ts, text }],
	]);
	expect(await called(page, "confirmWrite")).toEqual([]);
	await shot(page, "aw-28-confirm-reply");
	// Not sending sends nothing; sending again asks again, and Send as you sends that exact reply with its token.
	await confirm.getByRole("button", { name: "Don\u2019t send" }).click();
	await hidden(confirm);
	expect(await called(page, "confirmWrite")).toEqual([]);
	await panel.getByRole("button", { name: "Reply\u2026" }).click();
	await page
		.getByRole("alertdialog", { name: "Reply in a Slack thread?" })
		.getByRole("button", { name: "Send as you" })
		.click();
	await shows(panel.getByText("Sent in the thread as you."));
	expect(await called(page, "confirmWrite")).toEqual([
		["confirmWrite", { kind: "slack-reply", channel: "C0RELEASE", threadTs: PARENT.ts, text }, "t2"],
	]);
	await reads(page.locator(".aw-chat"), "You replied in a Slack thread in #release-notes.");
	// Logged once, though the gate announced it and the answer carried it.
	await counts(page.locator(".aw-chat").getByText("You replied in a Slack thread in #release-notes."), 1);
	await shot(page, "aw-28-reply-sent");
	expect(errors).toEqual([]);
	await page.close();
});

test("asking an agent to look into a thread sends it an instruction naming the thread and posts nothing to Slack", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), { signedIn: true, unread: UNREAD, quiet: [QUIET] });
	const crier = await openCrier(page);
	await crier.getByRole("searchbox").fill("release");
	await crier.getByRole("button", { name: "Read #release-notes" }).click();
	const panel = page.getByRole("dialog", { name: "#release-notes in Slack" });
	const parent = panel.getByRole("article").filter({ hasText: "Is the 2.4 release" });
	await parent.hover();
	await parent.getByRole("button", { name: "Ask an agent" }).click();
	await panel.getByRole("combobox", { name: "Ask which agent" }).selectOption("wren");
	await panel.getByRole("textbox", { name: "Anything to add" }).fill("Check whether CI is green.");
	await shows(panel.getByText("Nothing is posted in Slack."));
	await shot(page, "aw-28-ask-agent");
	await panel.getByRole("button", { name: "Ask", exact: true }).click();
	await shows(panel.getByText("Wren has it."), 5000);
	const [[, commandId, delegation]] = await called(page, "delegate");
	expect(commandId).toEqual(expect.any(String));
	expect(delegation).toEqual({
		to: "wren",
		ask: "look-into",
		note: "Check whether CI is green.",
		item: {
			kind: "thread",
			channel: "C0RELEASE",
			channelName: "release-notes",
			ts: PARENT.ts,
			url: "https://acme.slack.com/archives/C0RELEASE/p1",
			preview: PARENT.text,
		},
	});
	expect(await called(page, "describeWrite")).toEqual([]);
	expect(await called(page, "confirmWrite")).toEqual([]);
	await reads(page.locator(".aw-chat"), "You ask Wren to look into Ines's thread in #release-notes.");
	await shot(page, "aw-28-asked");
	expect(errors).toEqual([]);
	await page.close();
});

test("the square, the crier, and a channel read the same in all three themes", { timeout: 120_000 }, async () => {
	for (const theme of THEMES) {
		const place = square(theme);
		const { page, errors } = await openWorld(world([WREN, BRAM], theme), {
			signedIn: true,
			unread: UNREAD,
			quiet: [QUIET],
		});
		await settled(page, 3);
		expect(await view(page, "host()")).toMatchObject({ look: "crier", x: place.host!.at[0], y: place.host!.at[1] });
		for (const person of await townsfolk(page))
			expect(place.spots.some(([x, y]) => x === person.x && y === person.y)).toBe(true);
		await page.mouse.move(640, 300);
		for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 400);
		await page.waitForTimeout(700);
		await shot(page, `aw-27-square-${theme}`);
		const crier = await openCrier(page);
		await shot(page, `aw-28-crier-${theme}`);
		await crier.getByRole("button", { name: /^Read #general/ }).click();
		const panel = page.getByRole("dialog", { name: "#general in Slack" });
		await panel.getByRole("button", { name: "2 replies" }).click();
		await counts(panel.getByLabel("Thread of Ines").getByRole("article"), 2);
		await shot(page, `aw-28-channel-${theme}`);
		expect(errors).toEqual([]);
		await page.close();
	}
});

interface SignView {
	door: string;
	to: string;
	text: string;
	/** Its letters' size, px at zoom 1. */
	size: number;
	/** The sign board (tiles), and the lettering's box on it. */
	board: [number, number, number, number];
	ink: [number, number, number, number];
	/** The world draws the board too (where the painting has none, or one too small for a name). */
	plate: boolean;
}
/** The smallest letters that read on a sign at the default zoom, in px on screen. */
const SIGN_LEGIBLE_PX = 10;

test("every building's sign board names its place in the theme's words, fitted inside the board, in all three themes", {
	timeout: 120_000,
}, async () => {
	for (const theme of THEMES) {
		const place = square(theme);
		const { labels } = JSON.parse(
			readFileSync(fileURLToPath(new URL(`../themes/${theme}/theme.json`, import.meta.url)), "utf8"),
		);
		const { page, errors } = await openWorld(world([WREN, BRAM], theme), { signedIn: false, unread: [] });
		const signs = await view<SignView[]>(page, "signs()");
		expect(signs.map((sign) => sign.door).sort(), theme).toEqual(place.doors.map((door) => door.name).sort());
		const { zoom } = (await view<{ zoom: number }>(page, "zoom()"))!;
		for (const sign of signs) {
			// The place's name as the pack says it, without its article: "The forge" is signed "Forge".
			const name = labels[sign.to].replace(/^the /i, "");
			expect(sign.text, `${theme} ${sign.door}`).toBe(name[0].toUpperCase() + name.slice(1));
			const [bx, by, bw, bh] = sign.board;
			const [ix, iy, iw, ih] = sign.ink;
			expect(ix, `${theme} ${sign.door}`).toBeGreaterThanOrEqual(bx);
			expect(iy, `${theme} ${sign.door}`).toBeGreaterThanOrEqual(by);
			expect(ix + iw, `${theme} ${sign.door}`).toBeLessThanOrEqual(bx + bw);
			expect(iy + ih, `${theme} ${sign.door}`).toBeLessThanOrEqual(by + bh);
			expect(sign.size * zoom, `${theme} ${sign.door}`).toBeGreaterThanOrEqual(SIGN_LEGIBLE_PX);
		}
		if (SHOTS)
			for (const sign of signs) {
				await view(page, `lookAt(${JSON.stringify(sign.door)})`);
				await page.waitForTimeout(900);
				const [bx, by, bw, bh] = sign.board;
				const [x0, y0] = (await screen(page, bx - 1.5, by - 1))!;
				const [x1, y1] = (await screen(page, bx + bw + 1.5, by + bh + 1.5))!;
				mkdirSync(SHOTS, { recursive: true });
				await page.screenshot({
					path: join(SHOTS, `aw-04-sign-${theme}-${sign.to}.png`),
					animations: "disabled",
					clip: { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - x0, height: y1 - y0 },
				});
			}
		await shot(page, `aw-04-square-${theme}`);
		expect(errors).toEqual([]);
		await page.close();
	}
});

// Ticket 05: reading Slack. A long channel: thirty messages, Ines's thread in the middle.
const LONG: SlackMessage[] = Array.from({ length: 30 }, (_, i) =>
	msg(
		200 - i * 5,
		i % 2 ? "Tomas" : "Maya",
		`Message ${i + 1}: the release train, the changelog, and who signs off on the notes before three o'clock.`,
	),
);
LONG[10] = { ...PARENT, ts: LONG[10].ts, threadTs: LONG[10].ts, at: LONG[10].at };
const LONG_PARENT = LONG[10];
const LONG_REPLIES_READ = REPLIES[1].ts;

/** The log's scroll, and where an element sits in it (px from the log's top edge as shown). */
async function placeIn(log: Locator, target: Locator) {
	const box = (await log.boundingBox())!;
	const item = (await target.boundingBox())!;
	const scroll = await log.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
	return { top: item.y - box.y, bottom: item.y + item.height - box.y, box, scroll };
}

test("a channel opens at its first new message with the New divider just above; read through, it opens at the bottom", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), {
		signedIn: true,
		unread: UNREAD,
		quiet: [QUIET],
		history: { C0GENERAL: LONG, C0RELEASE: LONG },
		// #general was read up to its 20th message; #release-notes to its newest.
		lastRead: { C0GENERAL: LONG[19].ts, C0RELEASE: LONG[29].ts, [LONG_PARENT.ts]: LONG_REPLIES_READ },
	});
	await settled(page, 3);
	const crier = await openCrier(page);
	await crier.getByRole("button", { name: /^Read #general/ }).click();
	const panel = page.getByRole("dialog", { name: "#general in Slack" });
	const log = panel.getByRole("log", { name: "Messages in #general" });
	await counts(log.getByRole("article"), 30);
	const first = log.getByRole("article").filter({ hasText: "Message 21:" });
	const divider = log.locator(".aw-slack-new");
	await vi.waitFor(async () => {
		const at = await placeIn(log, first);
		// The first new message near the top of the view, the divider just above it and in view too.
		expect(at.scroll.top).toBeGreaterThan(0);
		expect(at.top).toBeGreaterThan(0);
		expect(at.top).toBeLessThan(60);
		const mark = await placeIn(log, divider);
		expect(mark.top).toBeGreaterThanOrEqual(0);
		expect(mark.bottom).toBeLessThanOrEqual(at.top + 1);
	});
	expect(await divider.count()).toBe(1);
	await shot(page, "aw-05-first-new");

	// A channel read to its newest message opens at the bottom, with no divider.
	await panel.getByRole("button", { name: "Other channels" }).click();
	await page.locator(".aw-crier").getByRole("searchbox").fill("release");
	await page.locator(".aw-crier").getByRole("button", { name: "Read #release-notes" }).click();
	const quiet = page.getByRole("dialog", { name: "#release-notes in Slack" });
	const quietLog = quiet.getByRole("log", { name: "Messages in #release-notes" });
	await counts(quietLog.getByRole("article"), 30);
	await vi.waitFor(async () => {
		const { scroll } = await placeIn(quietLog, quietLog.getByRole("article").last());
		expect(scroll.top + scroll.client).toBeGreaterThanOrEqual(scroll.height - 2);
	});
	expect(await quietLog.locator(".aw-slack-new").count()).toBe(0);
	await shot(page, "aw-05-nothing-new");

	// A thread opens at its first new reply, with its own divider just above it.
	await quietLog.getByRole("button", { name: "2 replies" }).click();
	const thread = quiet.getByLabel("Thread of Ines");
	await counts(thread.getByRole("article"), 2);
	const newReply = thread.getByRole("article").filter({ hasText: "Great, thanks." });
	await vi.waitFor(async () => {
		const at = await placeIn(quietLog, newReply);
		expect(at.top).toBeGreaterThan(0);
		expect(at.top).toBeLessThan(60);
		const mark = await placeIn(quietLog, thread.locator(".aw-slack-new"));
		expect(mark.top).toBeGreaterThanOrEqual(0);
		expect(mark.bottom).toBeLessThanOrEqual(at.top + 1);
	});
	await shot(page, "aw-05-thread-first-new");

	// Opening and reading changed nothing in Slack.
	expect(await called(page, "slackMarkRead")).toEqual([]);
	expect(await called(page, "describeWrite")).toEqual([]);
	expect(errors).toEqual([]);
	await page.close();
});

test("Mark read marks the channel read in Slack up to its newest message, logs it, and its townsperson leaves", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openWorld(world(), {
		signedIn: true,
		unread: UNREAD,
		history: { C0GENERAL: LONG },
		lastRead: { C0GENERAL: LONG[19].ts, [LONG_PARENT.ts]: LONG_REPLIES_READ },
	});
	await settled(page, 3);
	const general = (await townsfolk(page)).find((f) => f.name === "#general")!;
	await clickThrough(page);
	const [gx, gy] = await screen(page, general.x, general.y - 1);
	await page.mouse.click(gx, gy);
	const panel = page.getByRole("dialog", { name: "#general in Slack" });
	await counts(panel.getByRole("log").getByRole("article"), 30);
	await shot(page, "aw-05-mark-read-button");

	// A thread first: its own Mark read marks only that thread, up to its newest reply.
	await panel.getByRole("button", { name: "2 replies" }).click();
	const thread = panel.getByLabel("Thread of Ines");
	await counts(thread.getByRole("article"), 2);
	await thread.getByRole("button", { name: "Mark thread read" }).click();
	await vi.waitFor(async () => expect(await called(page, "slackMarkRead")).toHaveLength(1));
	expect((await called(page, "slackMarkRead"))[0]).toEqual([
		"slackMarkRead",
		"C0GENERAL",
		REPLIES[2].ts,
		LONG_PARENT.ts,
	]);
	await reads(page.locator(".aw-chat"), "You marked Ines's thread in #general read in Slack.");
	await hidden(thread.locator(".aw-slack-new"));
	// Still unread as a channel: the townsperson stays.
	expect((await townsfolk(page)).some((f) => f.id === "C0GENERAL")).toBe(true);

	// The channel: up to its newest message, at once, with no confirmation to answer.
	await panel.getByRole("button", { name: "Mark read", exact: true }).click();
	await vi.waitFor(async () => expect(await called(page, "slackMarkRead")).toHaveLength(2));
	const [, id, ts, threadTs] = (await called(page, "slackMarkRead"))[1];
	expect([id, ts, threadTs ?? null]).toEqual(["C0GENERAL", LONG[29].ts, null]);
	expect(await page.getByRole("alertdialog").count()).toBe(0);
	await reads(page.locator(".aw-chat"), "You marked #general read in Slack.");
	await reads(panel.locator(".aw-slack-sub"), "Nothing unread");
	await hidden(panel.getByRole("log").locator(".aw-slack-new"));
	await shot(page, "aw-05-marked-read");
	// Its townsperson leaves the square; the others stay.
	await vi.waitFor(
		async () => expect((await townsfolk(page)).map((f) => f.id).sort()).toEqual(["C0DEPLOY", "D0MAYA"]),
		{ timeout: 8000 },
	);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(900);
	await shot(page, "aw-05-townsperson-left");
	expect(errors).toEqual([]);
	await page.close();
});

test("the channel panel with its first new message and Mark read, in all three themes", {
	timeout: 120_000,
}, async () => {
	for (const theme of THEMES) {
		const { page, errors } = await openWorld(world([WREN, BRAM], theme), {
			signedIn: true,
			unread: UNREAD,
			history: { C0GENERAL: LONG },
			lastRead: { C0GENERAL: LONG[19].ts, [LONG_PARENT.ts]: LONG_REPLIES_READ },
		});
		await settled(page, 3);
		const crier = await openCrier(page);
		await crier.getByRole("button", { name: /^Read #general/ }).click();
		const panel = page.getByRole("dialog", { name: "#general in Slack" });
		await counts(panel.getByRole("log").getByRole("article"), 30);
		await page.waitForTimeout(300);
		await shot(page, `aw-05-channel-${theme}`);
		await panel.getByRole("button", { name: "2 replies" }).click();
		await counts(panel.getByLabel("Thread of Ines").getByRole("article"), 2);
		await page.waitForTimeout(300);
		await shot(page, `aw-05-thread-${theme}`);
		await panel.getByRole("button", { name: "Mark read", exact: true }).click();
		await reads(page.locator(".aw-chat"), "You marked #general read in Slack.");
		await shot(page, `aw-05-marked-${theme}`);
		expect(errors).toEqual([]);
		await page.close();
	}
});
