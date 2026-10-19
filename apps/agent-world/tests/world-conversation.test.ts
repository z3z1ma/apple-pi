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
// AGENT_WORLD_SHOTS=<dir> saves screenshots of the panel there, as aw-10-*.png.
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

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `aw-10-${name}.png`), animations: "disabled" });
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
