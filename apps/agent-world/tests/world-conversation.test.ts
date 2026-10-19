import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, TranscriptEntry, WorldSnapshot } from "../src/world.js";

// Seam 2 for the conversation panel: the committed, built world UI in headless Chrome, with the preload API replaced by
// a fixture backend that pages fixture transcripts and records what the panel asks of it.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots of the panel there, as aw-<ticket>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
/** Entries per page in the fixture backend, as the real one pages them. */
const PAGE = 50;

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
		git: { repository: "/Users/op/code/apple-pi", worktree: "/Users/op/code/apple-pi", branch: "main" },
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
const SUITE_TASK = { title: "Fix the session-state suite", status: "in-progress", bundle: "/l/202610190003-suite" };
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
		place: { kind: "wing", headquarters: HQ, repository: "/Users/op/code/apple-pi" },
		startedAt: at(1),
		facts: facts({
			run: "running_tool",
			status: "working",
			tool: { name: "bash", arg: "npx vitest run components/session-state", since: at(55) },
			task: SUITE_TASK,
		}),
	},
	{
		id: "ledger",
		name: "ledger",
		role: "worker",
		place: { kind: "wing", headquarters: HQ, repository: "/Users/op/code/billing" },
		startedAt: at(2),
		facts: facts({
			unseen: true,
			needsYouSince: at(40),
			settledAt: at(40),
			git: { repository: "/Users/op/code/billing", worktree: "/Users/op/code/billing", branch: "retry" },
		}),
	},
	{
		id: "asker",
		name: "asker",
		role: "worker",
		place: { kind: "common-room", headquarters: HQ },
		startedAt: at(3),
		facts: facts({
			status: "asking",
			asking: { kind: "questionnaire", text: "Which branch?" },
			needsYouSince: at(50),
			git: null,
		}),
	},
];
const world = (characters = CAST): WorldSnapshot => ({
	connected: true,
	headquarters: [
		{
			id: HQ,
			name: "Orla",
			wings: [
				{ repository: "/Users/op/code/apple-pi", name: "apple-pi", headcount: 1 },
				{ repository: "/Users/op/code/billing", name: "billing", headcount: 1 },
			],
		},
	],
	characters,
});

/** A real-looking session: a request, a reply with Markdown and code, tool calls and their results, and mail. */
const SUITE: TranscriptEntry[] = [
	{
		kind: "user",
		id: "u1",
		at: at(50),
		text: "Run the session-state suite and fix whatever breaks.",
		images: 0,
	},
	{
		kind: "assistant",
		id: "a1",
		at: at(51),
		parts: [
			{ kind: "thinking", text: "Run it first, then read the failures." },
			{ kind: "text", text: "Running the **whole suite** first." },
			{
				kind: "tool",
				call: {
					id: "c1",
					name: "bash",
					arg: "npx vitest run components/session-state",
					input: '{\n  "command": "npx vitest run components/session-state"\n}',
				},
			},
		],
		error: null,
		aborted: false,
	},
	{
		kind: "tool-result",
		id: "r1",
		at: at(52),
		callId: "c1",
		tool: "bash",
		text: " FAIL  tests/attention.test.ts > waits for the option\n Tests  2 failed | 40 passed (42)",
		isError: true,
		cut: false,
	},
	{ kind: "mail", id: "m1", at: at(53), from: "orla", text: "Rebase on `main` before you push." },
	{
		kind: "assistant",
		id: "a2",
		at: at(54),
		parts: [
			{
				kind: "text",
				text: 'Two failures in `attention.test.ts`, both timing:\n\n1. the option waits use the 1 s default;\n2. the poll is 1 s.\n\n```ts\nawait vi.waitFor(() => expect(option("@pi_agents")).toContain("? 1"), { timeout: 5000 });\n```\n\nRaising the timeouts now.',
			},
			{
				kind: "tool",
				call: {
					id: "c2",
					name: "edit",
					arg: "components/session-state/tests/attention.test.ts",
					input: '{\n  "path": "components/session-state/tests/attention.test.ts"\n}',
				},
			},
		],
		error: null,
		aborted: false,
	},
	{
		kind: "tool-result",
		id: "r2",
		at: at(55),
		callId: "c2",
		tool: "edit",
		text: "Successfully replaced 2 block(s).",
		isError: false,
		cut: false,
	},
];

/** A long session: `count` turns of the operator and the agent, numbered from the start. */
function longSession(count: number): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	for (let i = 0; i < count; i++)
		entries.push(
			i % 2
				? {
						kind: "assistant",
						id: `e${i}`,
						at: at(i / 10),
						parts: [
							{ kind: "text", text: `Reply number ${i}.\n\nIt says a little more, so each entry has some height.` },
						],
						error: null,
						aborted: false,
					}
				: { kind: "user", id: `e${i}`, at: at(i / 10), text: `Question number ${i}?`, images: 0 },
		);
	return entries;
}

async function openWorld(first: WorldSnapshot, transcripts: Record<string, TranscriptEntry[]>) {
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
		([snapshot, conversations, size]) => {
			const listeners = new Set<(s: unknown) => void>();
			let current = snapshot as any;
			const w = window as any;
			w.terminals = [];
			w.pages = [];
			w.append = (id: string, entry: unknown) => (conversations as Record<string, unknown[]>)[id].push(entry);
			w.push = (next: unknown) => {
				current = next;
				for (const listener of listeners) listener(current);
			};
			w.seen = [];
			w.commands = [];
			w.receiptListeners = new Set();
			w.replyListeners = new Set();
			w.watched = [];
			w.stageMs = 60;
			w.reply = (event: unknown) => {
				for (const listener of w.replyListeners) listener(event);
			};
			w.agentWorld = {
				snapshot: async () => current,
				onUpdate(listener: (s: unknown) => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				feed: async () => [],
				onFeed: () => () => {},
				goToTerminal: async (id: string) => {
					w.terminals.push(id);
					return { ok: true };
				},
				async conversation(id: string, before?: string) {
					w.pages.push([id, before ?? null]);
					// A page takes a moment, as reading a long transcript does.
					await new Promise((resolve) => setTimeout(resolve, 120));
					const all = (conversations as Record<string, unknown[]>)[id];
					if (!all) return { ok: false, reason: "unknown session" };
					const end = before ? all.findIndex((entry: any) => entry.id === before) : all.length;
					const start = Math.max(0, end - (size as number));
					return {
						ok: true,
						entries: all.slice(start, end),
						before: start > 0 ? (all[start] as any).id : null,
						missing: 0,
					};
				},
				// Instructions answer with the runtime's receipt stages, a moment apart; `refuse` fails the next one at once
				// (as the backend refuses an unconfirmed Stop), `failNext` after it was delivered.
				async instruct(id: string, commandId: string, instruction: unknown) {
					w.commands.push([id, instruction]);
					const stage = (name: string, reason?: string) => {
						for (const listener of w.receiptListeners)
							listener({ commandId, characterId: id, stage: name, ...(reason ? { reason } : {}) });
					};
					const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
					await wait(40);
					if (w.refuse) {
						const reason = w.refuse;
						w.refuse = null;
						stage("failed", reason);
						return { ok: false, reason };
					}
					stage("accepted");
					await wait(w.stageMs);
					stage("delivered");
					await wait(w.stageMs);
					if (w.failNext) {
						const reason = w.failNext;
						w.failNext = null;
						stage("failed", reason);
						return { ok: false, reason };
					}
					stage("applied");
					return { ok: true };
				},
				onReceipt(listener: (r: unknown) => void) {
					w.receiptListeners.add(listener);
					return () => w.receiptListeners.delete(listener);
				},
				async watchReplies(ids: string[]) {
					w.watched.push(ids);
				},
				onReply(listener: (e: unknown) => void) {
					w.replyListeners.add(listener);
					return () => w.replyListeners.delete(listener);
				},
				async markSeen(id: string) {
					w.seen.push(id);
					current = {
						...current,
						characters: current.characters.map((c: any) =>
							c.id === id && c.facts.status !== "asking"
								? { ...c, facts: { ...c.facts, unseen: false, needsYouSince: null } }
								: c,
						),
					};
					for (const listener of listeners) listener(current);
					return { ok: true };
				},
			};
		},
		[first, transcripts, PAGE] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).agentWorldView.place())).toBeTruthy(), {
		timeout: 15000,
	});
	await page.locator(".aw-side").waitFor({ timeout: 5000 });
	return { page, errors };
}

const book = (page: Page) => page.getByRole("dialog", { name: /^Conversation with / });
const log = (page: Page) => page.getByRole("log", { name: "Transcript" });
const pages = (page: Page) => page.evaluate(() => (window as any).pages as [string, string | null][]);
const seen = (page: Page) => page.evaluate(() => (window as any).seen as string[]);

/** Talk to a character from the side panel's Agents tab. */
async function talkTo(page: Page, name: string) {
	await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
	await page.getByRole("button", { name: `Talk to ${name}`, exact: true }).click();
	await book(page).waitFor({ timeout: 3000 });
}

async function shot(page: Page, name: string, ticket = "10") {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `aw-${ticket}-${name}.png`), animations: "disabled" });
}

test("Talk to opens the conversation over the dimmed world: portrait by state, name, repository, ledger task, and what it is doing", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": SUITE, ledger: [], asker: [], [HQ]: [] });
	try {
		await talkTo(page, "pi-tests");
		const panel = book(page);
		await expect(panel.getAttribute("aria-label")).resolves.toBe("Conversation with pi-tests");
		const side = panel.getByRole("complementary");
		const text = await side.textContent();
		for (const fact of [
			"pi-tests",
			"apple-pi",
			"Fix the session-state suite",
			"in-progress",
			"bash",
			"npx vitest run components/session-state",
		])
			expect(text).toContain(fact);
		// Working: the thinking portrait (expressions 0 neutral, 1 happy, 2 thinking, 3 worried).
		await expect(side.getByRole("img").getAttribute("src")).resolves.toMatch(/characters\/[a-z-]+-portrait-2\.png$/);
		await expect(page.locator(".aw-conv-veil").count()).resolves.toBe(1);
		expect(await pages(page)).toEqual([["pi-tests", null]]);
		await log(page).getByText("Raising the timeouts now.").waitFor({ timeout: 3000 });
		await shot(page, "panel");
		// Go to its terminal is always there.
		await side.getByRole("button", { name: "Go to its terminal" }).click();
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).terminals)).toEqual(["pi-tests"]));
		// Escape closes it.
		await page.keyboard.press("Escape");
		await panel.waitFor({ state: "detached", timeout: 2000 });

		// Asking: worried; the coordinator, idle: neutral.
		await talkTo(page, "asker");
		await expect(book(page).getByRole("complementary").getByRole("img").getAttribute("src")).resolves.toMatch(
			/-portrait-3\.png$/,
		);
		await expect(book(page).getByRole("complementary").textContent()).resolves.toContain("Which branch?");
		// Clicking the dimmed world closes it.
		await page.mouse.click(30, 400);
		await book(page).waitFor({ state: "detached", timeout: 2000 });
		await talkTo(page, "Orla");
		await expect(book(page).getByRole("complementary").getByRole("img").getAttribute("src")).resolves.toMatch(
			/coordinator-portrait-0\.png$/,
		);
		await log(page).getByText("Nothing has been said yet.").waitFor({ timeout: 3000 });
		await page.keyboard.press("Escape");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

test("the transcript renders Markdown and code, tells the operator, the agent, and mail apart, and folds each tool call to a line that opens on click", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": SUITE });
	try {
		await talkTo(page, "pi-tests");
		const transcript = log(page);
		await transcript.getByText("Raising the timeouts now.").waitFor({ timeout: 3000 });
		await expect(transcript.locator("pre code").textContent()).resolves.toContain(
			'await vi.waitFor(() => expect(option("@pi_agents")).toContain("? 1"), { timeout: 5000 });',
		);
		await expect(transcript.locator("strong").first().textContent()).resolves.toBe("whole suite");
		await expect(transcript.locator("ol li").count()).resolves.toBe(2);
		await expect(transcript.locator(".aw-conv-user").count()).resolves.toBe(1);
		await expect(transcript.locator(".aw-conv-assistant").count()).resolves.toBe(2);
		await expect(transcript.locator(".aw-conv-mail").textContent()).resolves.toContain(
			"Rebase on main before you push.",
		);
		await expect(transcript.locator(".aw-conv-mail").textContent()).resolves.toContain("orla");

		// Each tool call is one line with its tool and main argument; its result folds with it, not on its own.
		const bash = transcript.getByRole("button", { name: /bash.*npx vitest run components\/session-state/ });
		await expect(bash.getAttribute("aria-expanded")).resolves.toBe("false");
		await expect(transcript.getByText("2 failed | 40 passed", { exact: false }).count()).resolves.toBe(0);
		await expect(transcript.locator(".aw-conv-tool").count()).resolves.toBe(2);
		await shot(page, "folded");
		await bash.click();
		await expect(bash.getAttribute("aria-expanded")).resolves.toBe("true");
		const open = transcript.locator(".aw-conv-tool.aw-open");
		await expect(open.textContent()).resolves.toContain('"command": "npx vitest run components/session-state"');
		await expect(open.textContent()).resolves.toContain("2 failed | 40 passed");
		await expect(open.locator(".aw-conv-error").count()).resolves.toBe(1);
		await shot(page, "unfolded");
		await bash.click();
		await expect(bash.getAttribute("aria-expanded")).resolves.toBe("false");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("a long conversation opens at its newest entry and loads older pages on scroll up, keeping the view still and the world running", async () => {
	const long = longSession(PAGE * 3 + 10);
	const { page, errors } = await openWorld(world(), { ledger: long });
	try {
		await talkTo(page, "ledger");
		const transcript = log(page);
		await transcript.getByText(`Reply number ${long.length - 1}.`).waitFor({ timeout: 3000 });
		const scroll = () =>
			transcript.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
		// Opens at the bottom: the newest entry is in view.
		await vi.waitFor(async () => {
			const s = await scroll();
			expect(s.height - s.client - s.top).toBeLessThan(4);
		});
		const count = () => transcript.locator("[data-entry]").count();
		expect(await count()).toBe(PAGE);

		// Count animation frames while older pages load: the world keeps drawing.
		await page.evaluate(() => {
			const w = window as any;
			w.frameGaps = [];
			let last = performance.now();
			const tick = (now: number) => {
				w.frameGaps.push(now - last);
				last = now;
				if (w.frameGaps.length < 100000) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		for (let loaded = PAGE; loaded < long.length; ) {
			// The entry at the top of the view stays exactly where it is when the page before it arrives.
			const anchor = `e${long.length - loaded}`;
			await transcript.evaluate((el) => {
				el.scrollTop = 0;
			});
			const box = transcript.locator(`[data-entry="${anchor}"]`);
			const before = (await box.boundingBox())!.y;
			const next = Math.min(long.length, loaded + PAGE);
			await vi.waitFor(async () => expect(await count()).toBe(next), { timeout: 3000 });
			await page.waitForTimeout(50);
			expect(Math.abs((await box.boundingBox())!.y - before)).toBeLessThan(2);
			if (loaded === PAGE) await shot(page, "long-scrolled");
			loaded = next;
		}
		expect((await pages(page)).map(([, before]) => before)).toEqual([null, "e110", "e60", "e10"]);
		await transcript.getByText("The beginning of the conversation").waitFor({ timeout: 2000 });
		await transcript.getByText("Question number 0?").waitFor({ timeout: 2000 });
		const gaps = await page.evaluate(() => (window as any).frameGaps as number[]);
		expect(gaps.length).toBeGreaterThan(20);
		expect(Math.max(...gaps.slice(1))).toBeLessThan(250);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

test("opening a character that needs you marks it seen, so the orbs and lists agree; one that does not is left alone", async () => {
	const { page, errors } = await openWorld(world(), { ledger: [], "pi-tests": SUITE });
	const needsYou = () => page.getByRole("button", { name: /^Needs you: / }).getAttribute("aria-label");
	try {
		await expect(needsYou()).resolves.toBe("Needs you: 2");
		await talkTo(page, "ledger");
		// Finished: the happy portrait, kept while the conversation stays open.
		await expect(book(page).getByRole("complementary").getByRole("img").getAttribute("src")).resolves.toMatch(
			/-portrait-1\.png$/,
		);
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["ledger"]), { timeout: 2000 });
		await vi.waitFor(async () => expect(await needsYou()).toBe("Needs you: 1"), { timeout: 2000 });
		await expect(book(page).getByRole("complementary").getByRole("img").getAttribute("src")).resolves.toMatch(
			/-portrait-1\.png$/,
		);
		await page.keyboard.press("Escape");
		await book(page).waitFor({ state: "detached", timeout: 2000 });
		await talkTo(page, "pi-tests");
		await page.waitForTimeout(300);
		expect(await seen(page)).toEqual(["ledger"]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("talking to a character in the world walks up to it, then opens its conversation", async () => {
	const { page, errors } = await openWorld(world([CAST[0]]), { [HQ]: SUITE });
	try {
		await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
		await page.waitForTimeout(400);
		const orla = (
			(await page.evaluate(() => (window as any).agentWorldView.figures())) as { id: string; x: number; y: number }[]
		).find((f) => f.id === HQ)!;
		const [x, y] = (await page.evaluate(
			([a, b]) => (window as any).agentWorldView.toScreen(a, b),
			[orla.x, orla.y - 0.9],
		)) as [number, number];
		await page.mouse.click(x, y);
		await book(page).waitFor({ timeout: 10000 });
		await expect(book(page).getAttribute("aria-label")).resolves.toBe("Conversation with Orla");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("while the conversation is open, what the character says next appears at the bottom", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": [...SUITE] });
	try {
		await talkTo(page, "pi-tests");
		await log(page).getByText("Raising the timeouts now.").waitFor({ timeout: 3000 });
		const reply: TranscriptEntry = {
			kind: "assistant",
			id: "a3",
			at: at(56),
			parts: [{ kind: "text", text: "All **42** pass now." }],
			error: null,
			aborted: false,
		};
		await page.evaluate((entry) => (window as any).append("pi-tests", entry), reply);
		// The turn settles: the runtime's state changes, and the panel reads the newest page again.
		const settled = world(
			CAST.map((c) =>
				c.id === "pi-tests"
					? { ...c, facts: facts({ task: SUITE_TASK, settledAt: at(56), unseen: true, needsYouSince: at(56) }) }
					: c,
			),
		);
		await page.evaluate((next) => (window as any).push(next), settled);
		await log(page).getByText("pass now.").waitFor({ timeout: 3000 });
		const s = await log(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
		expect(s).toBeLessThan(4);
		expect(await log(page).locator("[data-entry]").count()).toBe(5);
		// Seen while the operator watches it finish.
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests"]), { timeout: 2000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

// Ticket 13: instructing an agent from the panel.

const commands = (page: Page) => page.evaluate(() => (window as any).commands as [string, Record<string, unknown>][]);
const box = (page: Page) => book(page).getByRole("textbox");
const receipts = (page: Page) => book(page).getByRole("list", { name: "Sent" });

test("idle: a Reply box; Enter sends talk, Shift+Enter starts a line, the box keeps the focus, and the receipt's stages show", async () => {
	const { page, errors } = await openWorld(world(), { ledger: SUITE });
	try {
		await talkTo(page, "ledger");
		const panel = book(page);
		// Idle: only Reply; no busy actions.
		await expect(panel.getByRole("button", { name: "Reply", exact: true }).count()).resolves.toBe(1);
		for (const name of ["Redirect now", "Tell it after this", "Stop"])
			await expect(panel.getByRole("button", { name, exact: true }).count()).resolves.toBe(0);
		await expect(box(page).getAttribute("aria-label")).resolves.toBe("Reply to ledger");
		// The box has the focus on opening, so typing goes there and the world does not walk.
		await vi.waitFor(async () => expect(await box(page).evaluate((el) => el === document.activeElement)).toBe(true));
		await page.keyboard.type("Retry the billing job");
		await page.keyboard.press("Shift+Enter");
		await page.keyboard.type("with the new timeout.");
		await expect(box(page).inputValue()).resolves.toBe("Retry the billing job\nwith the new timeout.");
		await shot(page, "idle-typed", "13");
		await page.keyboard.press("Enter");
		await vi.waitFor(async () =>
			expect(await commands(page)).toEqual([
				["ledger", { kind: "talk", text: "Retry the billing job\nwith the new timeout." }],
			]),
		);
		await expect(box(page).inputValue()).resolves.toBe("");
		expect(await box(page).evaluate((el) => el === document.activeElement)).toBe(true);
		// Its receipt: accepted, delivered, applied.
		const line = receipts(page).getByRole("listitem");
		await vi.waitFor(async () => expect(await line.getAttribute("data-stage")).toBe("applied"), { timeout: 3000 });
		const text = await line.textContent();
		for (const part of ["Reply", "Retry the billing job with the new timeout.", "Accepted", "Delivered", "Applied"])
			expect(text).toContain(part);
		await expect(line.locator(".aw-conv-stage.aw-on").count()).resolves.toBe(3);
		await shot(page, "idle-sent", "13");
		// Reply by click; nothing is sent while the box is empty.
		await expect(panel.getByRole("button", { name: "Reply", exact: true }).isDisabled()).resolves.toBe(true);
		expect(await commands(page)).toHaveLength(1);
		await box(page).fill("Thanks.");
		await panel.getByRole("button", { name: "Reply", exact: true }).click();
		await vi.waitFor(async () => expect(await commands(page)).toHaveLength(2));
		expect(await box(page).evaluate((el) => el === document.activeElement)).toBe(true);
		// The world never walked while the operator typed.
		expect(await page.evaluate(() => (window as any).agentWorldView.avatar()?.path?.length ?? 0)).toBeLessThan(2);
		// Nor did "g" in "billing" toggle the walk grid.
		expect(await page.evaluate(() => (window as any).agentWorldView.walkGrid())).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

test("a draft survives closing and reopening the panel for the same character, and only for it", async () => {
	const { page, errors } = await openWorld(world(), { ledger: SUITE, [HQ]: [] });
	try {
		await talkTo(page, "ledger");
		await box(page).fill("Half a thought");
		await page.keyboard.press("Escape");
		await book(page).waitFor({ state: "detached", timeout: 2000 });
		await talkTo(page, "Orla");
		await expect(box(page).inputValue()).resolves.toBe("");
		await page.keyboard.press("Escape");
		await book(page).waitFor({ state: "detached", timeout: 2000 });
		await talkTo(page, "ledger");
		await expect(box(page).inputValue()).resolves.toBe("Half a thought");
		expect(await commands(page)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("busy: Redirect now (Enter), Tell it after this, and Stop, which asks first; declining sends nothing", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": SUITE });
	try {
		await talkTo(page, "pi-tests");
		const panel = book(page);
		for (const name of ["Redirect now", "Tell it after this", "Stop"])
			await expect(panel.getByRole("button", { name, exact: true }).count()).resolves.toBe(1);
		await expect(panel.getByRole("button", { name: "Reply", exact: true }).count()).resolves.toBe(0);
		await vi.waitFor(async () => expect(await box(page).evaluate((el) => el === document.activeElement)).toBe(true));

		await page.keyboard.type("Skip the flaky test for now.");
		await page.keyboard.press("Enter");
		await box(page).fill("Then open a ticket for it.");
		await panel.getByRole("button", { name: "Tell it after this", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await commands(page)).toEqual([
				["pi-tests", { kind: "steer", text: "Skip the flaky test for now." }],
				["pi-tests", { kind: "follow_up", text: "Then open a ticket for it." }],
			]),
		);
		expect(await box(page).evaluate((el) => el === document.activeElement)).toBe(true);
		await vi.waitFor(
			async () =>
				expect(
					await receipts(page)
						.getByRole("listitem")
						.evaluateAll((items) => items.map((item) => item.getAttribute("data-stage"))),
				).toEqual(["applied", "applied"]),
			{ timeout: 3000 },
		);
		await expect(receipts(page).textContent()).resolves.toContain("Redirect");
		await expect(receipts(page).textContent()).resolves.toContain("After this");
		await shot(page, "busy-sent", "13");

		// Stop asks first; Let it work (or Escape) sends nothing and leaves the panel open.
		await panel.getByRole("button", { name: "Stop", exact: true }).click();
		const confirm = page.getByRole("alertdialog", { name: "Stop pi-tests?" });
		await confirm.waitFor({ timeout: 2000 });
		await expect(confirm.textContent()).resolves.toContain("npx vitest run components/session-state");
		await shot(page, "stop-confirm", "13");
		await confirm.getByRole("button", { name: "Let it work" }).click();
		await confirm.waitFor({ state: "detached", timeout: 2000 });
		await panel.getByRole("button", { name: "Stop", exact: true }).click();
		await confirm.waitFor({ timeout: 2000 });
		await page.keyboard.press("Escape");
		await confirm.waitFor({ state: "detached", timeout: 2000 });
		await expect(panel.isVisible()).resolves.toBe(true);
		await page.waitForTimeout(200);
		expect(await commands(page)).toHaveLength(2);

		// Confirmed: abort, sent as confirmed.
		await panel.getByRole("button", { name: "Stop", exact: true }).click();
		await confirm.getByRole("button", { name: "Stop it" }).click();
		await vi.waitFor(async () =>
			expect((await commands(page)).at(-1)).toEqual(["pi-tests", { kind: "abort", confirmed: true }]),
		);
		await vi.waitFor(
			async () => expect(await receipts(page).getByRole("listitem").last().getAttribute("data-stage")).toBe("applied"),
			{ timeout: 3000 },
		);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

test("a failed instruction says why, in the panel, and gives the words back to the box", async () => {
	const { page, errors } = await openWorld(world(), { ledger: SUITE });
	try {
		await talkTo(page, "ledger");
		await page.evaluate(() => {
			(window as any).failNext = "busy: send steer or follow_up while a run is active";
		});
		await box(page).fill("Ship it.");
		await page.keyboard.press("Enter");
		const line = receipts(page).getByRole("listitem");
		await vi.waitFor(async () => expect(await line.getAttribute("data-stage")).toBe("failed"), { timeout: 3000 });
		await expect(line.textContent()).resolves.toContain("Failed: busy: send steer or follow_up while a run is active");
		await expect(box(page).inputValue()).resolves.toBe("Ship it.");
		await shot(page, "failed", "13");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the open conversation streams the reply as it is written, then settles on the stored entry without a jump", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": [...SUITE] });
	try {
		await talkTo(page, "pi-tests");
		await log(page).getByText("Raising the timeouts now.").waitFor({ timeout: 3000 });
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).watched)).toEqual([["pi-tests"]]));
		const words = ["All", " **42**", " pass", " now.", "\n\nThe timeouts", " were the", " only problem."];
		const delta = (i: number) =>
			page.evaluate(
				([text, seq]) =>
					(window as any).reply({ kind: "delta", characterId: "pi-tests", streamId: "s1", seq, delta: text }),
				[words[i], i + 1] as const,
			);
		// Another character's stream never shows here.
		await page.evaluate(() =>
			(window as any).reply({ kind: "delta", characterId: "ledger", streamId: "x", seq: 1, delta: "Not for you." }),
		);
		await delta(0);
		await delta(1);
		await delta(2);
		const writing = log(page).locator(".aw-conv-writing");
		await vi.waitFor(async () => expect((await writing.textContent())?.trim()).toBe("All 42 pass"));
		// It joins the agent's turn under its heading, at the bottom, in view.
		await expect(log(page).locator(".aw-conv-assistant").count()).resolves.toBe(2);
		await shot(page, "streaming", "13");
		for (let i = 3; i < words.length; i++) await delta(i);
		await vi.waitFor(async () =>
			expect((await writing.innerText()).replace(/\s+/g, " ").trim()).toBe(
				"All 42 pass now. The timeouts were the only problem.",
			),
		);
		await expect(writing.locator("p").count()).resolves.toBe(2);
		const gap = await log(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
		expect(gap).toBeLessThan(4);
		const before = await writing.locator("p").last().boundingBox();

		// The stream ends with its stored entry (the same words); the history reads it too.
		const stored: TranscriptEntry = {
			kind: "assistant",
			id: "a3",
			at: at(56),
			parts: [{ kind: "text", text: words.join("") }],
			error: null,
			aborted: false,
		};
		await page.evaluate((entry) => (window as any).append("pi-tests", entry), stored);
		const pagesBefore = (await pages(page)).length;
		await page.evaluate(
			(entry) => (window as any).reply({ kind: "end", characterId: "pi-tests", streamId: "s1", entry }),
			stored,
		);
		const settled = log(page).locator('[data-entry="a3"]');
		await settled.waitFor({ timeout: 2000 });
		await expect(writing.count()).resolves.toBe(0);
		const after = await settled.locator("p").last().boundingBox();
		expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
		expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
		// Read once more from the history, and drawn once.
		await vi.waitFor(async () => expect((await pages(page)).length).toBeGreaterThan(pagesBefore));
		await page.waitForTimeout(300);
		await expect(log(page).getByText("only problem.").count()).resolves.toBe(1);
		const again = await log(page).locator('[data-entry="a3"]').locator("p").last().boundingBox();
		expect(Math.abs(again!.y - before!.y)).toBeLessThan(2);
		await expect(log(page).getByText("Not for you.").count()).resolves.toBe(0);
		await shot(page, "settled", "13");

		// Closing stops watching.
		await page.keyboard.press("Escape");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).watched)).toEqual([["pi-tests"], []]),
		);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

// Ticket 14: answering questions in the world.

const QUESTIONNAIRE = {
	id: "call-ask-1",
	questions: [
		{
			question: "Which branch should the fix go on?",
			header: "Branch",
			multiSelect: false,
			options: [
				{ label: "main", description: "Straight onto main; the suite is green there." },
				{ label: "retry", description: "The open retry branch, reviewed with the rest of it." },
			],
		},
		{
			question: "What should ship with it?",
			header: "Extras",
			multiSelect: true,
			options: [
				{ label: "Tests", description: "Behaviour checks for the retry path." },
				{ label: "Docs", description: "A note in the runbook." },
				{ label: "Changelog", description: "A line for the release notes." },
			],
		},
		{
			question: "Anything else before it ships?",
			header: null,
			multiSelect: false,
			options: [
				{ label: "No", description: "Ship it as it is." },
				{ label: "Wait", description: "Hold until I say so." },
			],
		},
	],
};

const asker = (asking: CharacterFacts["asking"], status: CharacterFacts["status"] = "asking") =>
	world(
		CAST.map((c) =>
			c.id === "asker"
				? {
						...c,
						facts: facts({
							run: "running_tool",
							status,
							asking,
							needsYouSince: asking ? at(50) : null,
							tool: { name: "ask_user_question", arg: null, since: at(50) },
							git: null,
						}),
					}
				: c,
		),
	);
const ASKING = asker({
	kind: "questionnaire",
	text: QUESTIONNAIRE.questions[0].question,
	questionnaire: QUESTIONNAIRE,
});
const ANSWERED = asker(null, "working");
const form = (page: Page) => book(page).getByRole("form", { name: /asks you$/ });
const question = (page: Page, n: number) => form(page).getByRole("group").nth(n);

test("an open questionnaire shows as a themed form: each option with its description, one choice or many, and words of your own", async () => {
	const { page, errors } = await openWorld(ASKING, { asker: SUITE });
	try {
		await talkTo(page, "asker");
		await form(page).waitFor({ timeout: 3000 });
		// No reply box while it asks: the form is the way to answer.
		await expect(book(page).getByRole("textbox", { name: "Reply to asker" }).count()).resolves.toBe(0);
		await expect(form(page).getByRole("group").count()).resolves.toBe(3);
		const first = question(page, 0);
		await expect(first.textContent()).resolves.toContain("Which branch should the fix go on?");
		await expect(first.textContent()).resolves.toContain("Branch");
		await expect(first.textContent()).resolves.toContain("Straight onto main; the suite is green there.");
		await expect(first.getByRole("radio").count()).resolves.toBe(3); // two options and words of your own
		await expect(question(page, 1).getByRole("checkbox").count()).resolves.toBe(4);
		await expect(question(page, 1).textContent()).resolves.toContain("A line for the release notes.");
		const send = form(page).getByRole("button", { name: "Send answer" });
		await expect(send.isDisabled()).resolves.toBe(true);
		await shot(page, "form", "14");

		// One choice: a second click moves it.
		await first.getByRole("radio", { name: /^main/ }).click();
		await first.getByRole("radio", { name: /^retry/ }).click();
		await expect(first.getByRole("radio", { name: /^main/ }).isChecked()).resolves.toBe(false);
		// Many: Tests and Changelog; then words of your own replace the choices, and a choice replaces the words.
		const extras = question(page, 1);
		await extras.getByRole("checkbox", { name: /^Tests/ }).click();
		await extras.getByRole("checkbox", { name: /^Changelog/ }).click();
		await expect(extras.getByRole("checkbox", { checked: true }).count()).resolves.toBe(2);
		await extras.getByRole("checkbox", { name: /own words/ }).click();
		await expect(extras.getByRole("checkbox", { checked: true }).count()).resolves.toBe(1);
		await extras.getByRole("checkbox", { name: /^Docs/ }).click();
		await expect(extras.getByRole("checkbox", { name: /own words/ }).isChecked()).resolves.toBe(false);
		await extras.getByRole("checkbox", { name: /^Tests/ }).click();
		// Words of your own for the last question.
		const last = question(page, 2);
		await last.getByRole("radio", { name: /own words/ }).click();
		const words = last.getByRole("textbox");
		await vi.waitFor(async () => expect(await words.evaluate((el) => el === document.activeElement)).toBe(true));
		await expect(send.isDisabled()).resolves.toBe(true); // words not written yet
		await page.keyboard.type("Rebase on main first.");
		await expect(send.isDisabled()).resolves.toBe(false);
		await shot(page, "form-filled", "14");
		await send.click();
		await vi.waitFor(async () =>
			expect(await commands(page)).toEqual([
				[
					"asker",
					{
						kind: "answer",
						questionnaire: "call-ask-1",
						replies: [{ selected: ["retry"] }, { selected: ["Tests", "Docs"] }, { custom: "Rebase on main first." }],
					},
				],
			]),
		);
		const line = receipts(page).getByRole("listitem");
		await vi.waitFor(async () => expect(await line.getAttribute("data-stage")).toBe("applied"), { timeout: 3000 });
		await expect(line.textContent()).resolves.toContain("Answer");

		// The question closes in the world: the form gives way to the busy actions, and says it was answered here.
		await page.evaluate((next) => (window as any).push(next), ANSWERED);
		await form(page).waitFor({ state: "detached", timeout: 2000 });
		await expect(book(page).getByRole("button", { name: "Redirect now" }).count()).resolves.toBe(1);
		await expect(book(page).getByRole("status").filter({ hasText: "You answered" }).count()).resolves.toBe(1);
		await shot(page, "answered", "14");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

test("when the terminal answers first, the form closes and says it was answered there", async () => {
	const { page, errors } = await openWorld(ASKING, { asker: SUITE });
	try {
		await talkTo(page, "asker");
		await form(page).waitFor({ timeout: 3000 });
		await question(page, 0).getByRole("radio", { name: /^main/ }).click();
		await page.evaluate((next) => (window as any).push(next), ANSWERED);
		await form(page).waitFor({ state: "detached", timeout: 2000 });
		const note = book(page).getByRole("status").filter({ hasText: "answered in its terminal" });
		await note.waitFor({ timeout: 2000 });
		await expect(note.textContent()).resolves.toContain("asker");
		expect(await commands(page)).toEqual([]);
		await shot(page, "answered-elsewhere", "14");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("a dialog only the terminal can answer shows a notice with Go to its terminal instead of a form", async () => {
	const { page, errors } = await openWorld(asker({ kind: "select", text: "Which color?" }), { asker: SUITE });
	try {
		await talkTo(page, "asker");
		const notice = book(page).getByRole("note");
		await notice.waitFor({ timeout: 3000 });
		await expect(notice.textContent()).resolves.toContain("Which color?");
		await expect(notice.textContent()).resolves.toContain("only its terminal can answer");
		await expect(form(page).count()).resolves.toBe(0);
		await expect(book(page).getByRole("textbox").count()).resolves.toBe(0);
		await shot(page, "terminal-only", "14");
		await notice.getByRole("button", { name: "Go to its terminal" }).click();
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).terminals)).toEqual(["asker"]));
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);
