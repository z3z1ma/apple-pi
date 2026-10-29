import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, MailThread, TranscriptEntry, WorldSnapshot } from "../src/world.js";

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

async function openWorld(
	first: WorldSnapshot,
	transcripts: Record<string, TranscriptEntry[]>,
	threads: MailThread[] = [],
) {
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
		([snapshot, conversations, size, storedThreads]) => {
			const listeners = new Set<(s: unknown) => void>();
			let current = snapshot as any;
			const w = window as any;
			w.terminals = [];
			w.links = [];
			w.pages = [];
			w.append = (id: string, entry: unknown) => (conversations as Record<string, unknown[]>)[id].push(entry);
			w.push = (next: unknown) => {
				current = next;
				for (const listener of listeners) listener(current);
			};
			w.seen = [];
			w.commands = [];
			w.membershipCommands = [];
			w.threadReplies = [];
			w.threadReads = [];
			w.profileReads = [];
			w.profiles = {};
			const threads = storedThreads as MailThread[];
			const publishThread = (thread: MailThread) => {
				const last = thread.messages.at(-1);
				const summaries = (current.operatorMail ?? []).filter((item: any) => item.id !== thread.id);
				if (last && thread.participants.some((person) => person.id === "operator"))
					summaries.push({
						id: thread.id,
						subject: thread.subject,
						lastAt: last.at,
						unread: thread.messages.filter(
							(message) => message.seq > (thread.readUpTo ?? 0) && message.from !== "operator",
						).length,
					});
				w.push({
					...current,
					operatorMail: summaries,
					workplace: current.workplace && {
						...current.workplace,
						threads: current.workplace.threads.map((item: any) =>
							item.id === thread.id ? { ...item, lastSeq: last?.seq ?? 0, lastAt: last?.at ?? 0 } : item,
						),
					},
				});
			};
			w.channelPost = (id: string, message: MailThread["messages"][number]) => {
				const thread = threads.find((item) => item.id === id)!;
				thread.messages.push(message);
				publishThread(thread);
			};
			w.receiptListeners = new Set();
			w.replyListeners = new Set();
			w.watched = [];
			w.stageMs = 60;
			w.reply = (event: unknown) => {
				for (const listener of w.replyListeners) listener(event);
			};
			w.agentWorld = {
				snapshot: async () => current,
				async profile(id: string) {
					w.profileReads.push(id);
					return { ok: true, self: w.profiles[id] ?? null };
				},
				async readWorkplaceThread(id: string) {
					w.threadReads.push(id);
					const thread = threads.find((thread) => thread.id === id);
					if (!thread) return { ok: false, reason: "Unknown channel" };
					if (w.readError) {
						w.readError = false;
						return { ok: false, reason: "The channel could not be read." };
					}
					const returned = structuredClone(thread);
					if (thread.participants.some((person) => person.id === "operator")) {
						returned.readUpTo = thread.readUpTo ?? 0;
						thread.readUpTo = thread.messages.at(-1)?.seq ?? 0;
						publishThread(thread);
					} else delete returned.readUpTo;
					return { ok: true, thread: returned };
				},
				async setChannelMembership(id: string, joined: boolean) {
					w.membershipCommands.push([id, joined]);
					if (w.membershipError) {
						const reason = w.membershipError;
						w.membershipError = null;
						return { ok: false, reason };
					}
					const thread = threads.find((thread) => thread.id === id)!;
					thread.participants = thread.participants.filter((person) => person.id !== "operator");
					if (joined) {
						thread.participants.push({ id: "operator", name: "You" });
						thread.readUpTo = 0;
					} else delete thread.readUpTo;
					w.push({
						...current,
						workplace: {
							...current.workplace,
							threads: current.workplace.threads.map((channel: any) =>
								channel.id === id
									? { ...channel, participants: thread.participants.map((person) => person.id) }
									: channel,
							),
						},
					});
					return { ok: true, stage: "applied" };
				},
				async replyThread(id: string, body: string) {
					w.threadReplies.push([id, body]);
					const thread = threads.find((thread) => thread.id === id)!;
					thread.messages.push({
						seq: Math.max(0, ...threads.flatMap((item) => item.messages.map((message) => message.seq))) + 1,
						from: "operator",
						name: "You",
						at: Date.now(),
						body,
					});
					thread.readUpTo = thread.messages.at(-1)?.seq ?? 0;
					publishThread(thread);
					return { ok: true, stage: "applied" };
				},
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
					if (!before && w.holdHistory === id) {
						w.holdHistory = null;
						await new Promise<void>((resolve) => {
							w.releaseHistory = () => {
								delete w.releaseHistory;
								resolve();
							};
						});
					}
					const all = (conversations as Record<string, unknown[]>)[id];
					if (!all) return { ok: false, reason: "unknown session" };
					const end = before ? all.findIndex((entry: any) => entry.id === before) : all.length;
					const start = Math.max(0, end - (size as number));
					return {
						ok: true,
						entries: all.slice(start, end),
						before: start > 0 ? (all[start] as any).id : null,
						// Entries the runtime indexed that the transcript no longer holds, reported with the newest page.
						missing: before ? 0 : (w.missing?.[id] ?? 0),
					};
				},
				// Links open in the system browser through the main process; here they are recorded.
				async openLink(url: string) {
					w.links.push(url);
					return { ok: true };
				},
				async openFile(href: string, base: string) {
					w.links.push(["file", href, base]);
					return { ok: true };
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
								? { ...c, facts: { ...c.facts, unseen: false, needsYouSince: null, seenAt: Date.now() } }
								: c,
						),
					};
					for (const listener of listeners) listener(current);
					return { ok: true };
				},
			};
		},
		[first, transcripts, PAGE, threads] as const,
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
		// Finish the frame sample even when paging completes before 21 frames have elapsed.
		await page.waitForFunction(() => (window as any).frameGaps.length > 20, undefined, { timeout: 3000 });
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

/** A real-looking turn: hidden and written thoughts between the agent's words and a tool whose output pads itself. */
const THINKER: TranscriptEntry[] = [
	{ kind: "user", id: "t1", at: at(50), text: "Check the [guide](https://example.com/guide) links.", images: 0 },
	{
		kind: "assistant",
		id: "t2",
		at: at(51),
		parts: [
			{ kind: "thinking", text: "" },
			{ kind: "thinking", text: "Read the guide first." },
			{ kind: "thinking", text: "  " },
			{ kind: "thinking", text: "Then list the docs." },
			{
				kind: "text",
				text: "Reading <https://pi.dev>, the guide, <file:///etc/hosts>, and [the run](docs/run.md:3), but not <vscode://file/x>.",
			},
			{ kind: "thinking", text: "" },
			{
				kind: "tool",
				call: {
					id: "k1",
					name: "bash",
					arg: "cd /Users/op/code/apple-pi && ls /Users/op/code/apple-pi/docs",
					input: '{\n  "command": "cd /Users/op/code/apple-pi && ls /Users/op/code/apple-pi/docs"\n}',
				},
			},
		],
		error: null,
		aborted: false,
	},
	{
		kind: "tool-result",
		id: "t3",
		at: at(52),
		callId: "k1",
		tool: "bash",
		text: "\n\n  README.md\n  guide.md\n\n\n",
		isError: false,
		cut: false,
	},
	{
		kind: "assistant",
		id: "t4",
		at: at(53),
		parts: [{ kind: "thinking", text: "Both are there." }],
		error: null,
		aborted: false,
	},
	{
		kind: "assistant",
		id: "t5",
		at: at(54),
		parts: [
			{ kind: "thinking", text: "Nothing else to check." },
			{ kind: "text", text: "Both docs are there." },
		],
		error: null,
		aborted: false,
	},
];

test("thoughts read quietly: hidden ones are left out and a run of them folds into one line; tool lines and output are trimmed; missing entries get one note", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": THINKER, ledger: [], asker: [], [HQ]: [] });
	try {
		await page.evaluate(() => {
			(window as any).missing = { "pi-tests": 3 };
		});
		await talkTo(page, "pi-tests");
		await log(page).getByText("Both docs are there.").waitFor({ timeout: 3000 });
		// Two runs of written thoughts (before the words; after the tool, across two replies), hidden ones dropped.
		const thoughts = log(page).locator(".aw-conv-thought");
		await expect(thoughts.count()).resolves.toBe(2);
		await expect(thoughts.locator(".aw-conv-fold-label").allTextContents()).resolves.toEqual([
			"Thought it over",
			"Thought it over",
		]);
		await thoughts.first().getByRole("button").click();
		await expect(thoughts.first().locator(".aw-conv-thought-text").allTextContents()).resolves.toEqual([
			"Read the guide first.",
			"Then list the docs.",
		]);
		await thoughts.nth(1).getByRole("button").click();
		await expect(thoughts.nth(1).locator(".aw-conv-thought-text").allTextContents()).resolves.toEqual([
			"Both are there.",
			"Nothing else to check.",
		]);
		// The tool line leaves out the `cd` into the working directory and the directory itself from paths.
		const tool = log(page).locator(".aw-conv-tool").filter({ hasText: "bash" });
		await expect(tool.locator(".aw-conv-fold-arg").textContent()).resolves.toBe("ls docs");
		await tool.getByRole("button").first().click();
		// Its output without the blank lines around it (the first line's indent kept).
		await expect(tool.locator("pre").nth(1).textContent()).resolves.toBe("  README.md\n  guide.md");
		// One quiet note for the entries the transcript no longer holds.
		const note = log(page).locator(".aw-conv-missing");
		await expect(note.count()).resolves.toBe(1);
		await expect(note.textContent()).resolves.toBe("3 entries are no longer in its transcript file.");
		await shot(page, "thoughts", "17");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("web links in a transcript open in the system browser and file links in their app; the window never navigates, and other links do not open", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": THINKER, ledger: [], asker: [], [HQ]: [] });
	try {
		const before = page.url();
		await talkTo(page, "pi-tests");
		await log(page).getByText("Both docs are there.").waitFor({ timeout: 3000 });
		await log(page).getByRole("link", { name: "guide" }).click();
		await log(page).getByRole("link", { name: "https://pi.dev" }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).links)).toEqual(["https://example.com/guide", "https://pi.dev"]),
		);
		// Links to files open through the main process too, with the agent's directory for relative paths.
		await log(page).getByRole("link", { name: "file:///etc/hosts" }).click();
		await log(page).getByRole("link", { name: "the run" }).click();
		const cwd = "/Users/op/code/apple-pi";
		await vi.waitFor(async () =>
			expect((await page.evaluate(() => (window as any).links)).slice(2)).toEqual([
				["file", "file:///etc/hosts", cwd],
				["file", "docs/run.md:3", cwd],
			]),
		);
		// A link of any other scheme is no link at all: its target shows on hover only.
		await expect(log(page).getByRole("link", { name: "vscode://file/x" }).count()).resolves.toBe(0);
		await expect(log(page).locator(".aw-md-link-dead").getAttribute("title")).resolves.toBe("vscode://file/x");
		// The keyboard opens a link too.
		await log(page).getByRole("link", { name: "guide" }).focus();
		await page.keyboard.press("Enter");
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).links.length)).toBe(5));
		expect(page.url()).toBe(before);
		await expect(book(page).count()).resolves.toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("workplace text-only DMs omit session details while preserving messages and live replies", async () => {
	const toolOnly: TranscriptEntry[] = [
		{
			kind: "assistant",
			id: "only-tool",
			at: at(80),
			parts: [
				{ kind: "tool", call: { id: "only-call", name: "read", arg: "README.md", input: '{"path":"README.md"}' } },
			],
			error: null,
			aborted: false,
		},
		{
			kind: "tool-result",
			id: "only-result",
			at: at(81),
			callId: "only-call",
			tool: "read",
			text: "Project guide",
			isError: false,
			cut: false,
		},
	];
	const details: TranscriptEntry[] = [
		...toolOnly,
		{
			kind: "assistant",
			id: "thought-only",
			at: at(82),
			parts: [{ kind: "thinking", text: "Private reasoning" }],
			error: "Connection error",
			aborted: true,
		},
		{
			kind: "note",
			id: "notification",
			at: at(83),
			label: "apple-pi:task-notification",
			shown: true,
			text: "Background task finished",
		},
		{
			kind: "tool-result",
			id: "orphan-failure",
			at: at(84),
			callId: "unloaded-call",
			tool: "bash",
			text: "Orphan tool failure",
			isError: true,
			cut: false,
		},
		{ kind: "user", id: "image-only", at: at(85), text: "", images: 1 },
	];
	const { page, errors } = await openWorld(world(), {
		"pi-tests": [...SUITE, ...details],
		ledger: details,
		asker: [],
		[HQ]: [],
	});
	page.setDefaultTimeout(5000);
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: /^pi-tests/ }).click();
		await log(page).getByText("Raising the timeouts now.").waitFor();
		expect(
			await log(page)
				.getByRole("button", { name: /^bash / })
				.count(),
		).toBe(0);
		for (const detail of [
			"Thought it over",
			"The reply failed",
			"Stopped before it finished",
			"Show tool calls",
			"task-notification",
			"Rebase on",
			"With an image",
			"Orphan tool failure",
		]) {
			expect(await log(page).textContent()).not.toContain(detail);
		}
		await log(page).getByText("Running the", { exact: false }).waitFor();
		await page.getByRole("status").filter({ hasText: "pi-tests is working" }).waitFor();
		await page.getByRole("button", { name: "Show tool calls", exact: true }).click();
		await log(page)
			.getByRole("button", { name: /^bash npx vitest run/ })
			.click();
		await log(page).getByText("2 failed | 40 passed", { exact: false }).waitFor();
		await log(page).getByText("The reply failed: Connection error", { exact: true }).waitFor();
		await log(page).getByRole("button", { name: "apple-pi:task-notification", exact: true }).waitFor();
		await log(page).getByText("Mail from orla", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Show tool calls", exact: true }).click();
		expect(
			await log(page)
				.getByRole("button", { name: /^bash / })
				.count(),
		).toBe(0);
		await log(page).getByText("Raising the timeouts now.").waitFor();
		const writing = world(
			CAST.map((person) =>
				person.id === "pi-tests"
					? { ...person, facts: facts({ run: "writing_reply", status: "working", tool: person.facts?.tool ?? null }) }
					: person,
			),
		);
		await page.evaluate((next) => (window as any).push(next), writing);
		await page.getByRole("status").filter({ hasText: "pi-tests is typing" }).waitFor();
		await page.getByRole("main").getByText("Writing a reply", { exact: true }).filter({ visible: true }).waitFor();
		await page.evaluate(() =>
			(window as any).reply({
				kind: "delta",
				characterId: "pi-tests",
				streamId: "dm-live",
				delta: "The checks are complete.",
			}),
		);
		await log(page).getByText("The checks are complete.", { exact: true }).waitFor();
		await page.evaluate(
			(next) => (window as any).push(next),
			world(
				CAST.map((person) =>
					person.id === "pi-tests" ? { ...person, facts: facts({ tool: person.facts?.tool ?? null }) } : person,
				),
			),
		);
		await page.getByRole("status").filter({ hasText: "pi-tests is typing" }).waitFor({ state: "detached" });
		await page.getByRole("main").getByText("Idle", { exact: true }).filter({ visible: true }).waitFor();
		await page.getByRole("button", { name: /^ledger/ }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).pages.some(([id]: string[]) => id === "ledger"))).toBe(true),
		);
		await vi.waitFor(async () => expect(await log(page).textContent()).toBe(""));
		await page.getByRole("button", { name: "Show tool calls", exact: true }).click();
		await log(page)
			.getByRole("button", { name: /^read README\.md/ })
			.click();
		await log(page).getByText("Project guide", { exact: true }).waitFor();
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("DM tool activity stays in a truncated lower line and the composer keeps a continuous border", async () => {
	const longArg = `npm run verify -- ${"long_argument/".repeat(200)}`;
	const initial = world(
		CAST.map((person) =>
			person.id === "pi-tests"
				? {
						...person,
						facts: facts({
							run: "running_tool",
							status: "working",
							title: "Implementation Engineer",
							tool: { name: "bash", arg: longArg, since: at(55) },
						}),
					}
				: person,
		),
	);
	const { page, errors } = await openWorld(initial, { "pi-tests": SUITE });
	page.setDefaultTimeout(5000);
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: /^pi-tests/ }).click();
		await log(page).getByText("Raising the timeouts now.").waitFor();
		const header = page
			.getByRole("main")
			.getByText(/^Working/)
			.filter({ visible: true });
		expect(await header.textContent()).toBe("Working · Implementation Engineer");
		const detail = page.getByTitle(/^pi-tests is working/);
		await detail.waitFor();
		expect(await detail.textContent()).toContain(longArg);
		const composer = page.getByRole("textbox", { name: "Instruct pi-tests", exact: true });
		for (const width of [1280, 820]) {
			await page.setViewportSize({ width, height: 800 });
			const size = await detail.evaluate((node) => ({
				width: node.clientWidth,
				scroll: node.scrollWidth,
				height: node.getBoundingClientRect().height,
				line: parseFloat(getComputedStyle(node).lineHeight),
				overflow: getComputedStyle(node).textOverflow,
				wrap: getComputedStyle(node).whiteSpace,
			}));
			expect(size.scroll).toBeGreaterThan(size.width);
			expect(size.overflow).toBe("ellipsis");
			expect(size.wrap).toBe("nowrap");
			expect(size.height).toBeLessThanOrEqual(size.line + 1);
			await composer.focus();
			const seam = await composer.evaluate((node) => {
				const footer = node.closest("footer")!;
				const box = footer.querySelector(".aw-conv-box")!;
				const bar = footer.querySelector(".aw-conv-act-bar")!;
				return {
					gap: bar.getBoundingClientRect().top - box.getBoundingClientRect().bottom,
					left: bar.getBoundingClientRect().left - box.getBoundingClientRect().left,
					right: bar.getBoundingClientRect().right - box.getBoundingClientRect().right,
					boxColor: getComputedStyle(box).borderLeftColor,
					barColor: getComputedStyle(bar).borderLeftColor,
				};
			});
			expect(Math.abs(seam.gap)).toBeLessThan(1);
			expect(Math.abs(seam.left)).toBeLessThan(1);
			expect(Math.abs(seam.right)).toBeLessThan(1);
			expect(seam.boxColor).toBe(seam.barColor);
			expect(await page.getByRole("main").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

async function openWorkplaceChannel(conversations: Record<string, TranscriptEntry[]> = {}) {
	const id = "team:orla";
	const initial: WorldSnapshot = {
		...world(),
		workplace: {
			tasks: [],
			escalations: [],
			threads: [
				{
					id,
					kind: "channel",
					subject: "Engineering",
					createdBy: HQ,
					headquarters: HQ,
					closed: false,
					lastSeq: 1,
					lastAt: at(20),
					participants: [HQ, "pi-tests"],
				},
			],
		},
	};
	const thread: MailThread = {
		id,
		subject: "Engineering",
		closed: false,
		participants: [
			{ id: HQ, name: "Orla" },
			{ id: "pi-tests", name: "pi-tests" },
		],
		messages: [
			{
				seq: 1,
				from: "pi-tests",
				name: "pi-tests",
				at: at(20),
				body: "## Release plan\n\n**Ready** for review.\n\n- Compatibility checked\n\n```ts\nconst ready = true;\n```\n\n[Release notes](https://example.com/release) and [spec](docs/api.md).\n\n<script>window.channelInjected=true</script>\n\n![remote image](https://example.com/remote.png)\n\n[unsafe](javascript:alert(1))",
			},
		],
	};
	const { page, errors } = await openWorld(initial, conversations, [thread]);
	page.setDefaultTimeout(5000);
	await page.getByRole("link", { name: "Workplace", exact: true }).click();
	await page.getByRole("button", { name: "# Engineering", exact: true }).click();
	await page.getByRole("button", { name: "Join channel", exact: true }).waitFor();
	return { page, errors, id };
}

test("channel author and participant names open their exact DMs without sending messages", async () => {
	const { page, errors } = await openWorkplaceChannel({ "pi-tests": SUITE, [HQ]: [] });
	try {
		await page.locator(".wp-message header").getByRole("button", { name: "pi-tests", exact: true }).click();
		await log(page).getByText("Raising the timeouts now.").waitFor();
		expect(await pages(page)).toEqual([["pi-tests", null]]);
		await page.getByRole("textbox", { name: "Instruct pi-tests", exact: true }).fill("Keep this DM draft.");
		await page.getByRole("button", { name: "# Engineering", exact: true }).click();
		await page.locator(".wp-thread-header").getByRole("button", { name: "Orla", exact: true }).click();
		await page.locator(".wp-conversation-header").getByRole("heading", { name: "Orla", exact: true }).waitFor();
		await vi.waitFor(async () => expect((await pages(page)).at(-1)).toEqual([HQ, null]));
		await page.getByRole("button", { name: /^pi-tests/ }).click();
		expect(await page.getByRole("textbox", { name: "Instruct pi-tests", exact: true }).inputValue()).toBe(
			"Keep this DM draft.",
		);
		expect(await page.evaluate(() => (window as any).commands)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("chat avatars open observed profiles, restore keyboard focus, and enter a DM only on Message", async () => {
	const { page, errors } = await openWorkplaceChannel({ "pi-tests": SUITE });
	try {
		const avatar = page.locator(".wp-message").getByRole("button", { name: "View profile: pi-tests", exact: true });
		await avatar.focus();
		await page.keyboard.press("Enter");
		const profile = page.getByRole("complementary", { name: "Profile: pi-tests", exact: true });
		await profile.getByRole("heading", { name: "pi-tests", exact: true }).waitFor();
		const closeProfile = profile.getByRole("button", { name: "Close profile", exact: true });
		const theme = page.getByRole("button", { name: "Theme: dark mode", exact: true });
		for (const dark of [false, true]) {
			expect(await theme.getAttribute("aria-pressed")).toBe(String(dark));
			expect(await closeProfile.textContent()).toBe("Close");
			expect(await closeProfile.isVisible()).toBe(true);
			expect(
				await closeProfile.evaluate((button) => {
					const rect = button.getBoundingClientRect();
					return (
						rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth
					);
				}),
			).toBe(true);
			await theme.click();
		}
		await profile.getByText(SUITE_TASK.title, { exact: false }).waitFor();
		expect(await pages(page)).toEqual([]);
		expect(await seen(page)).toEqual([]);
		await page.keyboard.press("Escape");
		await profile.waitFor({ state: "detached" });
		expect(await avatar.evaluate((node) => node === document.activeElement)).toBe(true);
		await avatar.click();
		const otherAvatar = page
			.locator(".wp-chat-sidebar")
			.getByRole("button", { name: "View profile: Orla", exact: true });
		await otherAvatar.click();
		await page.getByRole("complementary", { name: "Profile: Orla", exact: true }).waitFor();
		await page.keyboard.press("Escape");
		expect(await otherAvatar.evaluate((node) => node === document.activeElement)).toBe(true);
		await avatar.click();
		await profile.getByRole("button", { name: "Message pi-tests", exact: true }).click();
		await log(page).getByText("Raising the timeouts now.").waitFor();
		await profile.waitFor({ state: "detached" });
		const input = page.getByRole("textbox", { name: "Instruct pi-tests", exact: true });
		await input.fill("Preserve while viewing profiles.");
		await log(page).getByRole("button", { name: "View profile: pi-tests", exact: true }).first().click();
		await profile.waitFor();
		await profile.getByRole("button", { name: "Close profile", exact: true }).click();
		expect(await input.inputValue()).toBe("Preserve while viewing profiles.");
		await page
			.locator(".wp-conversation-header")
			.getByRole("button", { name: "View profile: pi-tests", exact: true })
			.click();
		await profile.waitFor();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		expect(await page.getByRole("complementary", { name: /^Profile:/ }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).commands)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("avatar colors vary by stable identity and stay consistent across surfaces, rename, reload, and appearance", async () => {
	const { page, errors } = await openWorkplaceChannel({ "pi-tests": SUITE });
	try {
		const channelAvatar = page
			.locator(".wp-message")
			.getByRole("button", { name: "View profile: pi-tests", exact: true });
		const background = (node: Element) => getComputedStyle(node).backgroundColor;
		const lightColor = await channelAvatar.evaluate(background);
		const orla = page.locator(".wp-chat-sidebar").getByRole("button", { name: "View profile: Orla", exact: true });
		expect(await orla.evaluate(background)).not.toBe(lightColor);
		await page.locator(".wp-message header").getByRole("button", { name: "pi-tests", exact: true }).click();
		await log(page).getByText("Raising the timeouts now.").waitFor();
		const headerAvatar = page
			.locator(".wp-conversation-header")
			.getByRole("button", { name: "View profile: pi-tests", exact: true });
		const sidebarAvatar = page
			.locator(".wp-chat-sidebar")
			.getByRole("button", { name: "View profile: pi-tests", exact: true });
		const messageAvatar = log(page).getByRole("button", { name: "View profile: pi-tests", exact: true }).first();
		for (const avatar of [headerAvatar, sidebarAvatar, messageAvatar])
			expect(await avatar.evaluate(background)).toBe(lightColor);
		await headerAvatar.click();
		const profile = page.getByRole("complementary", { name: /^Profile:/ });
		const profileAvatar = profile.locator(".wp-profile-avatar");
		expect(await profileAvatar.evaluate(background)).toBe(lightColor);
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		const darkColor = await headerAvatar.evaluate(background);
		expect(darkColor).not.toBe(lightColor);
		for (const avatar of [sidebarAvatar, messageAvatar, profileAvatar])
			expect(await avatar.evaluate(background)).toBe(darkColor);
		await page.evaluate(
			(next) => (window as any).push(next),
			world(CAST.map((person) => (person.id === "pi-tests" ? { ...person, name: "Suite Engineer" } : person))),
		);
		await profile.getByRole("heading", { name: "Suite Engineer", exact: true }).waitFor();
		expect(await page.locator(".wp-header-avatar").evaluate(background)).toBe(darkColor);
		expect(await profileAvatar.evaluate(background)).toBe(darkColor);
		await page.reload();
		await page.getByRole("button", { name: /^pi-tests/ }).click();
		expect(await page.locator(".wp-header-avatar").evaluate(background)).toBe(darkColor);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("profiles distinguish the operator, unavailable people, and read-only dormant and former histories", async () => {
	const { page, errors } = await openWorkplaceChannel({ "pi-tests": SUITE });
	try {
		await page.locator(".wp-message").getByRole("button", { name: "View profile: pi-tests", exact: true }).click();
		await page.getByRole("complementary", { name: "Profile: pi-tests", exact: true }).waitFor();
		const sleeping = {
			id: "pi-tests",
			name: "pi-tests",
			title: "Implementation Engineer",
			role: "worker" as const,
			reportsTo: HQ,
			repository: null,
			cwd: "/example",
			task: null,
			stoppedAt: at(80),
			stopReason: "exited",
			startedAt: at(1),
		};
		await page.evaluate((next) => (window as any).push(next), {
			...world(CAST.filter((person) => person.id !== "pi-tests")),
			dormant: [sleeping],
		});
		const profile = page.getByRole("complementary", { name: "Profile: pi-tests", exact: true });
		await profile.getByText(/Asleep.*History only/).waitFor();
		expect(await profile.getByText("Cost", { exact: true }).count()).toBe(0);
		await profile.getByText("Implementation Engineer", { exact: true }).waitFor();
		await profile.getByRole("button", { name: "View conversation pi-tests", exact: true }).click();
		await log(page).getByText("Raising the timeouts now.").waitFor();
		expect(await page.getByRole("textbox", { name: /^(Instruct|Reply to) pi-tests/ }).count()).toBe(0);
		await page.evaluate((next) => (window as any).push(next), {
			...world(CAST.filter((person) => person.id !== "pi-tests")),
			dormant: [{ ...sleeping, retiredAt: at(81), retiredReason: "Finished" }],
		});
		await page
			.locator(".wp-conversation-header")
			.getByText(/^Former member/)
			.waitFor();
		await page
			.locator(".wp-conversation-header")
			.getByRole("button", { name: "View profile: pi-tests", exact: true })
			.click();
		await profile.getByText(/Former member.*History only/).waitFor();
		await profile.getByRole("button", { name: "View conversation pi-tests", exact: true }).click();
		expect(await page.getByRole("textbox", { name: /^(Instruct|Reply to) pi-tests/ }).count()).toBe(0);
		await log(page).getByRole("button", { name: "View profile: You", exact: true }).click();
		const operator = page.getByRole("complementary", { name: "Profile: You", exact: true });
		await operator.getByText("Operator", { exact: true }).waitFor();
		expect(await operator.getByRole("button", { name: /^Message / }).count()).toBe(0);
		await operator.getByRole("button", { name: "Close profile", exact: true }).click();
		await page
			.locator(".wp-conversation-header")
			.getByRole("button", { name: "View profile: pi-tests", exact: true })
			.click();
		await page.evaluate((next) => (window as any).push(next), world(CAST.filter((person) => person.id !== "pi-tests")));
		await profile.getByText("This person is not available in the current organization.", { exact: true }).waitFor();
		expect(await profile.getByRole("button", { name: /^(Message|View conversation) / }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).commands)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("light-theme questions have a high-contrast badge while the approved dark indicator stays unchanged", async () => {
	const { page, errors } = await openWorld(world(), {});
	try {
		await page.emulateMedia({ colorScheme: "light" });
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		const badge = page.locator(".wp-needs");
		await badge.waitFor();
		const light = await badge.evaluate((node) => {
			const style = getComputedStyle(node);
			const luminance = (color: string) => {
				const rgb = color
					.match(/[\d.]+/g)!
					.slice(0, 3)
					.map((value) => {
						const channel = Number(value) / 255;
						return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
					});
				return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
			};
			let surface: Element | null = node;
			while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)")
				surface = surface.parentElement;
			const background = surface ? getComputedStyle(surface).backgroundColor : "rgb(255, 255, 255)";
			const colors = [luminance(background), luminance(style.color)];
			return (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05);
		});
		expect(light).toBeGreaterThanOrEqual(4.5);
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		expect(await badge.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
		expect(await badge.evaluate((node) => getComputedStyle(node).color)).toBe("rgb(216, 179, 120)");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("workplace starts with the OS appearance and remembers an explicit choice across reload and Mail", async () => {
	const { page, errors } = await openWorld(world(), {});
	page.setDefaultTimeout(5000);
	try {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		const theme = page.getByRole("button", { name: "Theme: dark mode", exact: true });
		await vi.waitFor(async () => expect(await theme.getAttribute("aria-pressed")).toBe("true"));
		const darkBackground = await page.getByRole("main").evaluate((node) => getComputedStyle(node).backgroundColor);
		await theme.click();
		await page.reload();
		await theme.waitFor();
		expect(await theme.getAttribute("aria-pressed")).toBe("false");
		expect(await page.getByRole("main").evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
			darkBackground,
		);
		const lightColor = await page.getByRole("main").evaluate((node) => getComputedStyle(node).color);
		await theme.click();
		const darkColor = await page.getByRole("main").evaluate((node) => getComputedStyle(node).color);
		expect(darkColor).not.toBe(lightColor);
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		expect(await theme.getAttribute("aria-pressed")).toBe("true");
		expect(await page.getByRole("main").evaluate((node) => getComputedStyle(node).color)).toBe(darkColor);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("team channels render safe Markdown and open links through the bridge without navigating", async () => {
	const { page, errors } = await openWorkplaceChannel();
	try {
		await page.getByRole("heading", { name: "Release plan", exact: true }).waitFor();
		await page.getByText("Ready", { exact: true }).waitFor();
		await page.getByText("const ready = true;", { exact: true }).waitFor();
		expect(await page.getByRole("listitem").allTextContents()).toContain("Compatibility checked");
		await page.getByText("<script>window.channelInjected=true</script>", { exact: false }).waitFor();
		await page.getByText("remote image", { exact: true }).waitFor();
		expect(await page.getByRole("img", { name: "remote image", exact: true }).count()).toBe(0);
		expect(await page.getByRole("link", { name: "unsafe", exact: true }).count()).toBe(0);
		const before = page.url();
		await page.getByRole("link", { name: "Release notes", exact: true }).focus();
		await page.keyboard.press("Enter");
		await page.getByRole("link", { name: "spec", exact: true }).click({ button: "middle" });
		expect(await page.evaluate(() => (window as any).links)).toEqual([
			"https://example.com/release",
			["file", "docs/api.md", "/Users/op/code/apple-pi"],
		]);
		expect(page.url()).toBe(before);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("channel preview requires an explicit successful join to post; failed membership changes and leave/rejoin retain drafts", async () => {
	const { page, errors, id } = await openWorkplaceChannel();
	try {
		expect(await page.getByRole("textbox", { name: "Post to channel", exact: true }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).membershipCommands)).toEqual([]);
		await page.evaluate(() => {
			(window as any).membershipError = "Joining was refused";
		});
		await page.getByRole("button", { name: "Join channel", exact: true }).click();
		await page.getByRole("alert").filter({ hasText: "Joining was refused" }).waitFor();
		expect(await page.getByRole("textbox", { name: "Post to channel", exact: true }).count()).toBe(0);
		await page.getByRole("button", { name: "Join channel", exact: true }).click();
		const composer = page.getByRole("textbox", { name: "Post to channel", exact: true });
		await composer.fill("A channel post");
		await composer.press("Shift+Enter");
		expect(await composer.inputValue()).toBe("A channel post\n");
		expect(await page.evaluate(() => (window as any).threadReplies)).toEqual([]);
		await composer.press("Enter");
		await page.getByText("A channel post", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).threadReplies)).toEqual([[id, "A channel post\n"]]);
		await composer.fill("Unsent draft");
		await page.getByLabel("Joined: channel membership", { exact: true }).click();
		await page.evaluate(() => {
			(window as any).membershipError = "Leaving was refused";
		});
		await page.getByRole("button", { name: "Leave channel", exact: true }).click();
		await page.getByRole("alert").filter({ hasText: "Leaving was refused" }).waitFor();
		expect(await composer.inputValue()).toBe("Unsent draft");
		await page.getByRole("button", { name: "Leave channel", exact: true }).click();
		await page.getByRole("button", { name: "Join channel", exact: true }).waitFor();
		expect(await composer.count()).toBe(0);
		await page.getByRole("button", { name: "Join channel", exact: true }).click();
		await composer.waitFor();
		expect(await composer.inputValue()).toBe("Unsent draft");
		expect(await page.evaluate(() => (window as any).membershipCommands)).toEqual([
			[id, true],
			[id, true],
			[id, false],
			[id, false],
			[id, true],
		]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("closing and reopening a mail draft retains its body and recipient across application switches", async () => {
	const { page, errors } = await openWorld(world(), {});
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		await page.getByRole("combobox", { name: "Mail recipient", exact: true }).selectOption("pi-tests");
		await page.getByRole("textbox", { name: "Mail body", exact: true }).fill("Keep this recipient with this draft.");
		await page.getByRole("button", { name: "Close new message", exact: true }).click();
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		expect(await page.getByRole("combobox", { name: "Mail recipient", exact: true }).inputValue()).toBe("pi-tests");
		expect(await page.getByRole("textbox", { name: "Mail body", exact: true }).inputValue()).toBe(
			"Keep this recipient with this draft.",
		);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("profiles load full Self only on demand, expand fields independently at 200 characters, and distinguish hire from first seen", async () => {
	const { page, errors } = await openWorkplaceChannel();
	try {
		const story = `${"s".repeat(205)}\n\n## A nested note\nThis remains part of the story.`;
		const practice = "p".repeat(201);
		const standards = "q".repeat(200);
		const self = `## My story\n\n${story}\n\n## How I work\n\n${practice}\n\n## What I hold myself to\n\n${standards}\n\n## The people I work with\n\nColleague notes.`;
		await page.evaluate(
			async ({ self, hiredAt }) => {
				const w = window as any;
				w.profiles["pi-tests"] = self;
				const current = await w.agentWorld.snapshot();
				w.push({
					...current,
					characters: current.characters.map((person: any) =>
						person.id === "pi-tests"
							? { ...person, hiredAt, facts: { ...person.facts, tasks: ["r".repeat(240), "Another completed task"] } }
							: person,
					),
				});
			},
			{ self, hiredAt: at(2) },
		);
		expect(await page.evaluate(() => (window as any).profileReads)).toEqual([]);
		await page.locator(".wp-chat-sidebar").getByRole("button", { name: "View profile: pi-tests", exact: true }).click();
		const profile = page.getByRole("complementary", { name: "Profile: pi-tests", exact: true });
		const storyField = profile.getByRole("region", { name: "Self: My story", exact: true });
		await storyField.waitFor();
		expect(await page.evaluate(() => (window as any).profileReads)).toEqual(["pi-tests"]);
		expect(await pages(page)).toEqual([]);
		expect(await seen(page)).toEqual([]);
		await storyField.getByText(`${"s".repeat(200)}\u2026`, { exact: true }).waitFor();
		await profile
			.getByRole("region", { name: "Self: The people I work with", exact: true })
			.getByText("Colleague notes.", { exact: true })
			.waitFor();
		await storyField.getByRole("button", { name: "See more of Self: My story", exact: true }).click();
		await storyField.getByText(story, { exact: true }).waitFor();
		const practiceField = profile.getByRole("region", { name: "Self: How I work", exact: true });
		expect(await practiceField.getByRole("button").getAttribute("aria-expanded")).toBe("false");
		await practiceField.getByText(`${"p".repeat(200)}\u2026`, { exact: true }).waitFor();
		await profile
			.getByRole("region", { name: "Self: What I hold myself to", exact: true })
			.getByText(standards, { exact: true })
			.waitFor();
		expect(
			await profile
				.getByRole("region", { name: "Self: What I hold myself to", exact: true })
				.getByRole("button")
				.count(),
		).toBe(0);
		const record = profile.getByText("Record", { exact: true }).locator("..");
		await record.getByText(`${"r".repeat(200)}\u2026`, { exact: true }).waitFor();
		await record.getByRole("button", { name: "See more of Record", exact: true }).click();
		await record.getByText(`${"r".repeat(240)}\nAnother completed task`, { exact: true }).waitFor();
		const closeProfile = profile.getByRole("button", { name: "Close profile", exact: true });
		await profile.getByRole("region", { name: "Self: The people I work with", exact: true }).scrollIntoViewIfNeeded();
		expect(await closeProfile.isVisible()).toBe(true);
		expect(
			await closeProfile.evaluate((button) => {
				const rect = button.getBoundingClientRect();
				return rect.top >= 0 && rect.bottom <= window.innerHeight;
			}),
		).toBe(true);
		await storyField.getByRole("button", { name: "See less of Self: My story", exact: true }).click();
		await storyField.getByText(`${"s".repeat(200)}\u2026`, { exact: true }).waitFor();
		expect(await record.getByRole("button").getAttribute("aria-expanded")).toBe("true");
		expect(
			await profile.getByText("Hired", { exact: true }).locator("..").locator("time").getAttribute("datetime"),
		).toBe(new Date(at(2)).toISOString());
		await page.evaluate(async () => {
			const w = window as any;
			const current = await w.agentWorld.snapshot();
			w.push({ ...current, characters: current.characters.map((person: any) => ({ ...person, hiredAt: null })) });
		});
		await profile.getByText("First seen", { exact: true }).waitFor();
		expect(await profile.getByText("Hired", { exact: true }).count()).toBe(0);
		expect(await profile.locator("time").getAttribute("datetime")).toBe(new Date(at(1)).toISOString());
		await page.evaluate(async () => {
			const w = window as any;
			const current = await w.agentWorld.snapshot();
			w.push({
				...current,
				workplace: {
					...current.workplace,
					workHistory: [
						{
							id: "recorded-task",
							bundle: "/tasks/recorded",
							project: "/example",
							headquarters: "original-team",
							title: "Recorded completed work",
							status: "done",
							thread: "task:recorded",
							openedAt: null,
							closedAt: null,
							updatedAt: null,
							participants: [{ person: "pi-tests", assignedAt: 1, endedAt: 2, outcome: "finished", focused: false }],
						},
					],
				},
			});
		});
		await profile.getByRole("button", { name: "Read task: Recorded completed work", exact: true }).waitFor();
		expect(await profile.getByText("Record", { exact: true }).count()).toBe(0);
		await storyField.getByText(`${"s".repeat(200)}\u2026`, { exact: true }).waitFor();

		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("Mail has visible Sent and Activity icons, and selecting Activity opens the Activity delivery log", async () => {
	const { page, errors } = await openWorld(world(), {});
	page.setDefaultTimeout(5000);
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		for (const name of ["Sent", "Activity"]) {
			const folder = page.getByRole("button", { name, exact: true });
			expect(await folder.locator("svg").isVisible()).toBe(true);
			await folder.click();
			expect(await folder.getAttribute("aria-pressed")).toBe("true");
		}
		await page
			.getByRole("region", { name: "Delivery log", exact: true })
			.getByRole("heading", { name: "Activity", exact: true })
			.waitFor();
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("DM unread updates survive another conversation, older reading and window blur, and clear only after the loaded latest reply is visible", async () => {
	const cast = CAST.map((person) =>
		person.id === "pi-tests" ? { ...person, facts: facts({ seenAt: at(9) }) } : person,
	);
	const { page, errors } = await openWorld(world(cast), { "pi-tests": longSession(80), [HQ]: [] });
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: /^Orla/, exact: false }).first().click();
		const incoming = async (id: string, text: string) =>
			page.evaluate(
				async ({ id, text }) => {
					const w = window as any;
					const when = Date.now();
					w.append("pi-tests", {
						kind: "assistant",
						id,
						at: when,
						parts: [{ kind: "text", text }],
						error: null,
						aborted: false,
					});
					const current = await w.agentWorld.snapshot();
					w.push({
						...current,
						characters: current.characters.map((person: any) =>
							person.id === "pi-tests"
								? {
										...person,
										facts: {
											...person.facts,
											run: "idle",
											status: "idle",
											tool: null,
											unseen: true,
											needsYouSince: when,
											settledAt: when,
										},
									}
								: person,
						),
					});
				},
				{ id, text },
			);
		const row = page
			.locator(".wp-dm")
			.filter({ has: page.getByRole("button", { name: "View profile: pi-tests", exact: true }) });
		await incoming("unread-away", "A reply while another DM is open.");
		await vi.waitFor(async () => expect(await row.getAttribute("data-unread")).toBe("true"));
		for (let appearance = 0; appearance < 2; appearance++) {
			const dot = (await row.locator(".wp-unread-dot").boundingBox())!;
			const name = (await row.locator("strong").boundingBox())!;
			expect(dot.width).toBeGreaterThan(0);
			expect(dot.width).toBeCloseTo(dot.height, 1);
			expect(dot.height).toBeLessThanOrEqual(name.height);
			await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		}
		expect(await seen(page)).toEqual([]);
		await row.getByRole("button", { name: /^pi-tests/ }).click();
		await log(page).getByText("A reply while another DM is open.", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await row.getAttribute("data-unread")).toBe("false"));
		expect(await row.locator(".wp-unread-dot").count()).toBe(0);
		expect(await seen(page)).toEqual(["pi-tests"]);
		await page.evaluate(() => {
			(window as any).holdHistory = "pi-tests";
		});
		await incoming("unread-loading", "A reply whose newest page is still loading.");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => typeof (window as any).releaseHistory)).toBe("function"),
		);
		expect(await seen(page)).toEqual(["pi-tests"]);
		expect(await row.getAttribute("data-unread")).toBe("true");
		await page.evaluate(() => (window as any).releaseHistory());
		await log(page).getByText("A reply whose newest page is still loading.", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests", "pi-tests"]));
		await log(page).evaluate((el) => {
			el.scrollTop = el.scrollHeight - el.clientHeight - 500;
		});
		await page.getByRole("button", { name: /^Jump to latest/ }).waitFor();
		const before = await log(page).evaluate((el) => el.scrollTop);
		await incoming("unread-older", "A reply while reading older content.");
		await log(page).getByText("A reply while reading older content.", { exact: true }).waitFor();
		expect(await seen(page)).toEqual(["pi-tests", "pi-tests"]);
		expect(await row.getAttribute("data-unread")).toBe("true");
		expect(Math.abs((await log(page).evaluate((el) => el.scrollTop)) - before)).toBeLessThan(4);
		await page.getByRole("button", { name: /^New messages - jump to latest/ }).click();
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests", "pi-tests", "pi-tests"]));
		await page.evaluate(() => window.dispatchEvent(new Event("blur")));
		await incoming("unread-blurred", "A reply while the window is inactive.");
		await log(page).getByText("A reply while the window is inactive.", { exact: true }).waitFor();
		expect(await seen(page)).toEqual(["pi-tests", "pi-tests", "pi-tests"]);
		expect(await row.getAttribute("data-unread")).toBe("true");
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests", "pi-tests", "pi-tests", "pi-tests"]));
		expect(await log(page).getByRole("separator", { name: "New updates", exact: true }).count()).toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("channel unread boundaries use the real pre-read cursor, and new posts respect older reading and recover from a read failure", async () => {
	const id = "team:unread";
	const participants = [
		{ id: "operator", name: "You" },
		{ id: "pi-tests", name: "pi-tests" },
	];
	const messages = Array.from({ length: 30 }, (_, i) => ({
		seq: i + 1,
		from: "pi-tests",
		name: "pi-tests",
		at: at(i),
		body: `Earlier post ${i}.`,
	}));
	messages.push(
		{ seq: 102, from: "operator", name: "You", at: at(31), body: "My own post is not an unread incoming message." },
		{ seq: 105, from: "pi-tests", name: "pi-tests", at: at(32), body: "The first unread incoming post." },
	);
	const initial = {
		...world(),
		operatorMail: [{ id, subject: "Unread team", unread: 1, lastAt: at(32) }],
		workplace: {
			tasks: [],
			escalations: [],
			threads: [
				{
					id,
					kind: "channel" as const,
					subject: "Unread team",
					createdBy: HQ,
					headquarters: HQ,
					closed: false,
					lastSeq: 105,
					lastAt: at(32),
					participants: participants.map((person) => person.id),
				},
			],
		},
	};
	const { page, errors } = await openWorld(initial, {}, [
		{ id, subject: "Unread team", closed: false, participants, messages, readUpTo: 102 },
	]);
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		const channel = page.getByRole("button", { name: "# Unread team", exact: true });
		expect(await channel.getAttribute("data-unread")).toBe("true");
		expect(await channel.locator("b").textContent()).toBe("1");
		await channel.click();
		const divider = page.getByRole("separator", { name: "New messages", exact: true });
		await divider.waitFor();
		await divider
			.locator("..")
			.locator("xpath=following-sibling::article[1]")
			.getByText("The first unread incoming post.", { exact: true })
			.waitFor();
		await vi.waitFor(async () => expect(await channel.getAttribute("data-unread")).toBe("false"));
		const scroll = page.locator(".wp-thread-messages");
		await scroll.evaluate((el) => {
			el.scrollTop = 100;
			el.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		const reads = await page.evaluate(() => (window as any).threadReads.length);
		await page.evaluate(
			({ id, at }) =>
				(window as any).channelPost(id, {
					seq: 109,
					from: "pi-tests",
					name: "pi-tests",
					at,
					body: "Incoming while reading older posts.",
				}),
			{ id, at: at(33) },
		);
		const jump = page.getByRole("button", { name: "New messages - jump to latest", exact: true });
		await jump.waitFor();
		expect(await page.evaluate(() => (window as any).threadReads.length)).toBe(reads);
		expect(await channel.getAttribute("data-unread")).toBe("true");
		expect(await scroll.evaluate((el) => el.scrollTop)).toBe(100);
		await jump.click();
		await scroll.getByText("Incoming while reading older posts.", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await channel.getAttribute("data-unread")).toBe("false"));
		await page.evaluate(
			({ id, at }) =>
				(window as any).channelPost(id, {
					seq: 110,
					from: "pi-tests",
					name: "pi-tests",
					at,
					body: "Incoming while following the latest posts.",
				}),
			{ id, at: at(34) },
		);
		await scroll.getByText("Incoming while following the latest posts.", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await channel.getAttribute("data-unread")).toBe("false"));
		await page.evaluate(
			({ id, at }) => {
				const w = window as any;
				w.readError = true;
				w.channelPost(id, { seq: 111, from: "pi-tests", name: "pi-tests", at, body: "The retried post." });
			},
			{ id, at: at(35) },
		);
		await page.getByRole("alert").getByText("The channel could not be read.", { exact: true }).waitFor();
		const failedReads = await page.evaluate(() => (window as any).threadReads.length);
		await page.waitForTimeout(200);
		expect(await page.evaluate(() => (window as any).threadReads.length)).toBe(failedReads);
		expect(await channel.getAttribute("data-unread")).toBe("true");
		await jump.click();
		await scroll.getByText("The retried post.", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await channel.getAttribute("data-unread")).toBe("false"));
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("Tab keeps to the open book, and Escape gives the keys back to the world", async () => {
	const { page, errors } = await openWorld(world(), { "pi-tests": SUITE, ledger: [], asker: [], [HQ]: [] });
	try {
		await talkTo(page, "pi-tests");
		await log(page).getByText("Raising the timeouts now.").waitFor({ timeout: 3000 });
		const inBook = () =>
			page.evaluate(() => {
				const dialog = document.querySelector("[role=dialog][aria-label^='Conversation with']");
				return !!dialog && dialog.contains(document.activeElement);
			});
		for (let i = 0; i < 24; i++) {
			await page.keyboard.press("Tab");
			expect(await inBook(), `Tab ${i + 1}`).toBe(true);
		}
		for (let i = 0; i < 24; i++) {
			await page.keyboard.press("Shift+Tab");
			expect(await inBook(), `Shift+Tab ${i + 1}`).toBe(true);
		}
		await page.keyboard.press("Escape");
		await book(page).waitFor({ state: "detached", timeout: 2000 });
		await expect(page.evaluate(() => document.activeElement?.id)).resolves.toBe("game");
		// The world's keys work again at once: G, pressed and released in the same frame as Escape's release, shows the
		// walk grid and keeps it shown. (Phaser handles its key queue again for each new key event within a frame, so G's
		// press was handled a second time on its release and the grid went back off: the key "lost" after closing.)
		await page.evaluate(() => {
			const key = (type: string, key: string, code: string, keyCode: number) =>
				window.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, bubbles: true }));
			key("keyup", "Escape", "Escape", 27);
			key("keydown", "g", "KeyG", 71);
			key("keyup", "g", "KeyG", 71);
		});
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => (window as any).agentWorldView.walkGrid())).toBe(true);
		await page.keyboard.press("g");
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => (window as any).agentWorldView.walkGrid())).toBe(false);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);
