import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildMarkdownPage, markdownTemplate } from "../../../components/browser-pages/src/markdown-review.js";
import { openPageSession } from "../../../components/browser-pages/src/page-server.js";
import { embedPage } from "../../../components/browser-pages/src/saved-page.js";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, MailThread, TranscriptEntry, WorldSnapshot } from "../src/world.js";
import { addRecipient, recipients } from "./helpers/select.js";
import { installWorkplaceCommunications } from "./helpers/workplace-communications.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const PAGE = 50;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: CHROME,
		headless: true,
		args: ["--disable-features=LocalNetworkAccessChecks"],
	});
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
			w.communicationFixture = {
				read: async (id: string) => {
					w.threadReads.push(id);
					if (w.readError) {
						w.readError = false;
						return { ok: false, reason: "The channel could not be read." };
					}
					const thread = threads.find((item) => item.id === id);
					return thread ? { ok: true, thread: structuredClone(thread) } : { ok: false, reason: "Unknown channel" };
				},
				ack: (id: string, through: number) => {
					const thread = threads.find((item) => item.id === id)!;
					thread.readUpTo = through;
					publishThread(thread);
				},
			};
			w.agentWorkplace = {
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
					if (joined) thread.participants.push({ id: "operator", name: "You" });
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
						missing: before ? 0 : (w.missing?.[id] ?? 0),
					};
				},
				async openLink(url: string) {
					w.links.push(url);
					return { ok: true };
				},
				async openFile(href: string, base: string) {
					w.links.push(["file", href, base]);
					return { ok: true };
				},
				workspace: { resolvePaths: async () => ({ ok: true, files: [] }) },
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
	await page.addInitScript(installWorkplaceCommunications);
	await page.goto(`${ORIGIN}/index.html?world`);
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
		await expect(side.getByRole("img").getAttribute("src")).resolves.toMatch(/characters\/[a-z-]+-portrait-2\.png$/);
		await expect(page.locator(".aw-conv-veil").count()).resolves.toBe(1);
		expect(await pages(page)).toEqual([["pi-tests", null]]);
		await log(page).getByText("Raising the timeouts now.").waitFor({ timeout: 3000 });
		await shot(page, "panel");
		await side.getByRole("button", { name: "Go to its terminal" }).click();
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).terminals)).toEqual(["pi-tests"]));
		await page.keyboard.press("Escape");
		await panel.waitFor({ state: "detached", timeout: 2000 });

		await talkTo(page, "asker");
		await expect(book(page).getByRole("complementary").getByRole("img").getAttribute("src")).resolves.toMatch(
			/-portrait-3\.png$/,
		);
		await expect(book(page).getByRole("complementary").textContent()).resolves.toContain("Which branch?");
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
		await vi.waitFor(async () => {
			const s = await scroll();
			expect(s.height - s.client - s.top).toBeLessThan(4);
		});
		const count = () => transcript.locator("[data-entry]").count();
		expect(await count()).toBe(PAGE);

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
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests"]), { timeout: 2000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

const commands = (page: Page) => page.evaluate(() => (window as any).commands as [string, Record<string, unknown>][]);
const box = (page: Page) => book(page).getByRole("textbox");
const receipts = (page: Page) => book(page).getByRole("list", { name: "Sent" });

test("idle: a Reply box; Enter sends talk, Shift+Enter starts a line, the box keeps the focus, and the receipt's stages show", async () => {
	const { page, errors } = await openWorld(world(), { ledger: SUITE });
	try {
		await talkTo(page, "ledger");
		const panel = book(page);
		await expect(panel.getByRole("button", { name: "Reply", exact: true }).count()).resolves.toBe(1);
		for (const name of ["Redirect now", "Tell it after this", "Stop"])
			await expect(panel.getByRole("button", { name, exact: true }).count()).resolves.toBe(0);
		await expect(box(page).getAttribute("aria-label")).resolves.toBe("Reply to ledger");
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
		const line = receipts(page).getByRole("listitem");
		await vi.waitFor(async () => expect(await line.getAttribute("data-stage")).toBe("applied"), { timeout: 3000 });
		const text = await line.textContent();
		for (const part of ["Reply", "Retry the billing job with the new timeout.", "Accepted", "Delivered", "Applied"])
			expect(text).toContain(part);
		await expect(line.locator(".aw-conv-stage.aw-on").count()).resolves.toBe(3);
		await shot(page, "idle-sent", "13");
		await expect(panel.getByRole("button", { name: "Reply", exact: true }).isDisabled()).resolves.toBe(true);
		expect(await commands(page)).toHaveLength(1);
		await box(page).fill("Thanks.");
		await panel.getByRole("button", { name: "Reply", exact: true }).click();
		await vi.waitFor(async () => expect(await commands(page)).toHaveLength(2));
		expect(await box(page).evaluate((el) => el === document.activeElement)).toBe(true);
		expect(await page.evaluate(() => (window as any).agentWorldView.avatar()?.path?.length ?? 0)).toBeLessThan(2);
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
		await page.evaluate(() =>
			(window as any).reply({ kind: "delta", characterId: "ledger", streamId: "x", seq: 1, delta: "Not for you." }),
		);
		await delta(0);
		await delta(1);
		await delta(2);
		const writing = log(page).locator(".aw-conv-writing");
		await vi.waitFor(async () => expect((await writing.textContent())?.trim()).toBe("All 42 pass"));
		await expect(log(page).locator(".aw-conv-assistant").count()).resolves.toBe(3);
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

		const stored: TranscriptEntry = {
			kind: "assistant",
			id: "a3",
			at: Date.now(),
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
		await vi.waitFor(async () => expect((await pages(page)).length).toBeGreaterThan(pagesBefore));
		await page.waitForTimeout(300);
		await expect(log(page).getByText("only problem.").count()).resolves.toBe(1);
		const again = await log(page).locator('[data-entry="a3"]').locator("p").last().boundingBox();
		expect(Math.abs(again!.y - before!.y)).toBeLessThan(2);
		await expect(log(page).getByText("Not for you.").count()).resolves.toBe(0);
		await shot(page, "settled", "13");

		await page.keyboard.press("Escape");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).watched)).toEqual([["pi-tests"], []]),
		);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40000);

const trackHistoryReads = (page: Page) =>
	page.evaluate(() => {
		const w = window as any;
		const read = w.agentWorkplace.conversation;
		w.historyPending = 0;
		w.historyFinished = 0;
		w.agentWorkplace.conversation = async (...args: unknown[]) => {
			w.historyPending++;
			try {
				return await read(...args);
			} finally {
				w.historyPending--;
				w.historyFinished++;
			}
		};
	});

const finishHistoryReads = async (page: Page) => {
	await page.waitForFunction(() => (window as any).historyFinished > 0 && (window as any).historyPending === 0);
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
};

const groupedReply = (id: string, when: number, text: string): TranscriptEntry => ({
	kind: "assistant",
	id,
	at: when,
	parts: [{ kind: "text", text }],
	error: null,
	aborted: false,
});

const GROUPING_CASES = [
	{
		name: "adjacent responses within five minutes",
		start: new Date(2026, 10, 7, 10).getTime(),
		minutes: [0, 4, 8],
		headers: [0],
	},
	{
		name: "responses exactly five minutes apart",
		start: new Date(2026, 10, 7, 10).getTime(),
		minutes: [0, 5],
		headers: [0, 1],
	},
	{
		name: "responses more than five minutes apart",
		start: new Date(2026, 10, 7, 10).getTime(),
		minutes: [0, 6],
		headers: [0, 1],
	},
	{
		name: "responses on different days",
		start: new Date(2026, 10, 7, 23, 59).getTime(),
		minutes: [0, 2],
		headers: [0, 1],
	},
];

async function openSessionReader(page: Page, surface: "World" | "DM") {
	if (surface === "World") await talkTo(page, "pi-tests");
	else {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: /^pi-tests/ }).click();
	}
}

test.each(["World", "DM"] as const)(
	"%s agent headers follow adjacent response time and day boundaries",
	async (surface) => {
		for (const scenario of GROUPING_CASES) {
			const replies = scenario.minutes.map((minute, index) =>
				groupedReply(`group-${index}`, scenario.start + minute * 60_000, `${scenario.name}: response ${index}.`),
			);
			const first = replies[0] as Extract<TranscriptEntry, { kind: "assistant" }>;
			first.parts.push({ kind: "tool", call: { id: "group-tool", name: "bash", arg: "fixture check", input: "{}" } });
			const entries: TranscriptEntry[] = [
				{
					kind: "user",
					id: "group-user-1",
					at: scenario.start - 120_000,
					text: "First operator instruction.",
					images: 0,
				},
				{
					kind: "user",
					id: "group-user-2",
					at: scenario.start - 60_000,
					text: "Second operator instruction.",
					images: 0,
				},
				first,
				{
					kind: "tool-result",
					id: "group-result",
					at: replies[1].at - 1,
					callId: "group-tool",
					tool: "bash",
					text: "Fixture check finished.",
					isError: false,
					cut: false,
				},
				...replies.slice(1),
			];
			const { page, errors } = await openWorld(world(), { "pi-tests": entries });
			try {
				await openSessionReader(page, surface);
				await log(page)
					.getByText(`${scenario.name}: response ${replies.length - 1}.`, { exact: true })
					.waitFor();
				const agents = log(page).locator(".aw-conv-assistant");
				expect(await agents.count(), scenario.name).toBe(scenario.headers.length);
				expect(await log(page).locator(".aw-conv-user > header").count()).toBe(2);
				const expectedTimes = await page.evaluate(
					(times) =>
						times.map((time) =>
							new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time),
						),
					scenario.headers.map((index) => replies[index].at),
				);
				expect(await agents.locator("header time").allTextContents()).toEqual(expectedTimes);
				if (surface === "DM")
					expect(await agents.locator(".wp-transcript-avatar").count()).toBe(scenario.headers.length);
				expect(await log(page).locator(".aw-conv-day").count()).toBe(
					scenario.name === "responses on different days" ? 2 : 1,
				);
				if (surface === "World") {
					await log(page)
						.getByRole("button", { name: /^bash fixture check/ })
						.click();
					await log(page).getByText("Fixture check finished.", { exact: true }).waitFor();
				}
				expect(errors).toEqual([]);
			} finally {
				await page.close();
			}
		}
	},
	60000,
);

test("a DM's first unread assistant response starts a fresh header inside the time window", async () => {
	const start = new Date(2026, 10, 7, 10).getTime();
	const snapshot = world(
		CAST.map((person) =>
			person.id === "pi-tests"
				? {
						...person,
						facts: facts({
							run: "idle",
							status: "idle",
							unseen: true,
							seenAt: start + 30_000,
							needsYouSince: start + 120_000,
						}),
					}
				: person,
		),
	);
	const { page, errors } = await openWorld(snapshot, {
		"pi-tests": [
			groupedReply("read-before", start, "Already read response."),
			groupedReply("unread-first", start + 60_000, "First unread response."),
			groupedReply("unread-second", start + 120_000, "Second unread response."),
		],
	});
	try {
		await openSessionReader(page, "DM");
		await log(page).getByText("Second unread response.", { exact: true }).waitFor();
		expect(await log(page).locator(".aw-conv-assistant").count()).toBe(2);
		const unread = log(page)
			.locator(".aw-conv-block")
			.filter({ has: page.locator("[data-unread-start]") });
		expect(await unread.count()).toBe(1);
		expect(await unread.textContent()).toContain("First unread response.");
		expect(await unread.textContent()).toContain("Second unread response.");
		expect(await unread.textContent()).not.toContain("Already read response.");
		expect(await unread.locator(".wp-transcript-avatar").count()).toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("DM grouping separates later response streams without splitting delayed deltas within one response", async () => {
	const start = new Date(2026, 10, 7, 10).getTime();
	const { page, errors } = await openWorld(world(), {
		"pi-tests": [groupedReply("stream-previous", start, "Earlier response.")],
	});
	try {
		await openSessionReader(page, "DM");
		await log(page).getByText("Earlier response.", { exact: true }).waitFor();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).watched.at(-1))).toEqual(["pi-tests"]),
		);
		await page.clock.setFixedTime(new Date(start + 6 * 60_000));
		await page.evaluate(() =>
			(window as any).reply({
				kind: "delta",
				characterId: "pi-tests",
				streamId: "timed-stream-1",
				seq: 1,
				delta: "Streaming first",
			}),
		);
		await log(page).getByText("Streaming first", { exact: true }).waitFor();
		expect(await log(page).locator(".aw-conv-assistant").count()).toBe(2);
		const header = await log(page).locator(".aw-conv-assistant").last().locator("header time").textContent();
		await page.clock.setFixedTime(new Date(start + 90 * 60_000));
		await page.evaluate(() =>
			(window as any).reply({
				kind: "delta",
				characterId: "pi-tests",
				streamId: "timed-stream-1",
				seq: 2,
				delta: " and much later.",
			}),
		);
		await log(page).getByText("Streaming first and much later.", { exact: true }).waitFor();
		expect(await log(page).locator(".aw-conv-assistant").count()).toBe(2);
		expect(await log(page).locator(".aw-conv-assistant").last().locator("header time").textContent()).toBe(header);
		const stored = groupedReply("timed-stored-1", start + 91 * 60_000, "Streaming first and much later.");
		await page.evaluate((entry) => {
			(window as any).append("pi-tests", entry);
			(window as any).reply({ kind: "end", characterId: "pi-tests", streamId: "timed-stream-1", entry });
		}, stored);
		await log(page).locator('[data-entry="timed-stored-1"]').waitFor();
		await vi.waitFor(async () => expect(await log(page).locator(".aw-conv-writing").count()).toBe(0));
		expect(await log(page).locator(".aw-conv-assistant").count()).toBe(2);
		expect(await log(page).getByText("Streaming first and much later.", { exact: true }).count()).toBe(1);
		await page.clock.setFixedTime(new Date(start + 97 * 60_000));
		await page.evaluate(() =>
			(window as any).reply({
				kind: "delta",
				characterId: "pi-tests",
				streamId: "timed-stream-2",
				seq: 1,
				delta: "A separate later response.",
			}),
		);
		await log(page).getByText("A separate later response.", { exact: true }).waitFor();
		expect(await log(page).locator(".aw-conv-assistant").count()).toBe(3);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test.each(["DM", "World"] as const)(
	"%s preserves the paragraph being read when saved time splits a response group",
	async (surface) => {
		const start = new Date(2026, 10, 7, 10).getTime();
		const { page, errors } = await openWorld(world(), {
			"pi-tests": [groupedReply("anchor-previous", start, "Previous response.")],
		});
		try {
			await openSessionReader(page, surface);
			await log(page).getByText("Previous response.", { exact: true }).waitFor();
			await page.clock.setFixedTime(new Date(start + 60_000));
			const text = Array.from(
				{ length: 60 },
				(_, index) => `Reading paragraph ${index}: words in the streamed response.`,
			).join("\n\n");
			await page.evaluate(
				(delta) =>
					(window as any).reply({ kind: "delta", characterId: "pi-tests", streamId: "anchor-stream", seq: 1, delta }),
				text,
			);
			const target = log(page).getByText("Reading paragraph 20: words in the streamed response.", { exact: true });
			await target.waitFor();
			expect(await log(page).locator(".aw-conv-assistant").count()).toBe(1);
			await target.evaluate((element) => {
				element.scrollIntoView({ block: "center" });
				element.closest(".aw-conv-log")!.dispatchEvent(new Event("scroll"));
			});
			await vi.waitFor(async () =>
				expect(
					await log(page).evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
				).toBeGreaterThan(48),
			);
			const before = await target.boundingBox();
			const stored = groupedReply("anchor-saved", start + 10 * 60_000, text);
			await page.evaluate((entry) => {
				(window as any).append("pi-tests", entry);
				(window as any).reply({ kind: "end", characterId: "pi-tests", streamId: "anchor-stream", entry });
			}, stored);
			await log(page).locator('[data-entry="anchor-saved"]').waitFor();
			await vi.waitFor(async () => expect(await log(page).locator(".aw-conv-assistant").count()).toBe(2));
			const after = await target.boundingBox();
			expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
			expect(await target.count()).toBe(1);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	30000,
);

test("saved-time merging preserves an away DM reader's position and does not acknowledge", async () => {
	const start = new Date(2026, 10, 7, 10).getTime();
	const { page, errors } = await openWorld(world(), {
		"pi-tests": [groupedReply("merge-previous", start, "Previous response.")],
	});
	page.setDefaultTimeout(5000);
	try {
		await openSessionReader(page, "DM");
		await log(page).getByText("Previous response.", { exact: true }).waitFor();
		await page.clock.setFixedTime(new Date(start + 10 * 60_000));
		const text = Array.from(
			{ length: 45 },
			(_, index) => `Merge paragraph ${index}: words in the streamed response.`,
		).join("\n\n");
		await page.evaluate(
			(delta) =>
				(window as any).reply({ kind: "delta", characterId: "pi-tests", streamId: "merge-stream", seq: 1, delta }),
			text,
		);
		const target = log(page).getByText("Merge paragraph 40: words in the streamed response.", { exact: true });
		await target.waitFor();
		await log(page).evaluate((element) => {
			element.scrollTop = element.scrollHeight - element.clientHeight - 60;
		});
		await page.getByRole("button", { name: /Jump to latest/ }).waitFor();
		const before = await target.boundingBox();
		const beforeSeen = await seen(page);
		await trackHistoryReads(page);
		const stored = groupedReply("merge-saved", start + 60_000, text);
		await page.evaluate(async (entry) => {
			const w = window as any;
			w.append("pi-tests", entry);
			w.reply({ kind: "end", characterId: "pi-tests", streamId: "merge-stream", entry });
			const current = await w.agentWorkplace.snapshot();
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
									needsYouSince: Date.now(),
									settledAt: Date.now(),
								},
							}
						: person,
				),
			});
		}, stored);
		await log(page).locator('[data-entry="merge-saved"]').waitFor();
		await page.getByRole("main").getByText("Finished", { exact: true }).filter({ visible: true }).waitFor();
		await finishHistoryReads(page);
		await vi.waitFor(async () => expect(await log(page).locator(".aw-conv-assistant").count()).toBe(1));
		const after = await target.boundingBox();
		expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
		expect(await page.getByRole("button", { name: /Jump to latest/ }).count()).toBe(1);
		expect(await seen(page)).toEqual(beforeSeen);
		await page.getByRole("button", { name: /Jump to latest/ }).click();
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests"]));
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test.each(["World", "DM"] as const)(
	"first streamed response replacement keeps the paragraph still when saved tools follow it in %s",
	async (surface) => {
		const start = new Date(2026, 10, 7, 10).getTime();
		const { page, errors } = await openWorld(world(), { "pi-tests": [] });
		page.setDefaultTimeout(5000);
		try {
			await openSessionReader(page, surface);
			await log(page).getByText("Nothing has been said yet.", { exact: true }).waitFor();
			if (surface === "World")
				await book(page).evaluate(async (element) => {
					await Promise.all(
						element
							.getAnimations({ subtree: true })
							.filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
							.map((animation) => animation.finished),
					);
				});
			await page.clock.setFixedTime(new Date(start));
			const text = Array.from({ length: 60 }, (_, index) => `First paragraph ${index}: streamed words.`).join("\n\n");
			await page.evaluate(
				(delta) =>
					(window as any).reply({ kind: "delta", characterId: "pi-tests", streamId: "first-stream", seq: 1, delta }),
				text,
			);
			const target = log(page).getByText("First paragraph 20: streamed words.", { exact: true });
			await target.waitFor();
			await target.evaluate((element) => {
				element.scrollIntoView({ block: "center" });
				element.closest(".aw-conv-log")!.dispatchEvent(new Event("scroll"));
			});
			await trackHistoryReads(page);
			const before = await target.boundingBox();
			const entry = groupedReply("first-saved", start + 10 * 60_000, text) as Extract<
				TranscriptEntry,
				{ kind: "assistant" }
			>;
			entry.parts.push({ kind: "tool", call: { id: "following-tool", name: "bash", arg: "echo done", input: "{}" } });
			await page.evaluate((entry) => {
				(window as any).append("pi-tests", entry);
				(window as any).reply({ kind: "end", characterId: "pi-tests", streamId: "first-stream", entry });
			}, entry);
			await log(page).locator('[data-entry="first-saved"]').waitFor();
			await finishHistoryReads(page);
			const after = await target.boundingBox();
			expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
			expect(await target.count()).toBe(1);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	30000,
);

test.each([1, 10])(
	"returning from an inline page preserves the away paragraph after a saved-time gap of %i minutes",
	async (minutes) => {
		const start = new Date(2026, 10, 7, 10).getTime();
		const previous = groupedReply("inline-previous", start, "Previous response.") as Extract<
			TranscriptEntry,
			{ kind: "assistant" }
		>;
		previous.parts.push({ kind: "tool", call: { id: "inline-call", name: "explain_change", arg: null, input: "{}" } });
		const { page, errors } = await openWorld(world(), { "pi-tests": [previous] });
		page.setDefaultTimeout(5000);
		await page.route(`${ORIGIN}/fixture-explanation*`, (route) =>
			route.fulfill({ body: "<h1>Explanation fixture</h1>", contentType: "text/html" }),
		);
		await page.addInitScript((origin) => {
			(window as any).agentWorkplace.browserPage = async () => ({
				tool: "explain_change",
				url: `${origin}/fixture-explanation`,
			});
		}, ORIGIN);
		try {
			await openSessionReader(page, "DM");
			await log(page).getByText("Previous response.", { exact: true }).waitFor();
			await page.clock.setFixedTime(new Date(start + 60_000));
			const text = Array.from({ length: 60 }, (_, index) => `Inline paragraph ${index}: streamed words.`).join("\n\n");
			await page.evaluate(
				(delta) =>
					(window as any).reply({ kind: "delta", characterId: "pi-tests", streamId: "inline-stream", seq: 1, delta }),
				text,
			);
			const target = log(page).getByText("Inline paragraph 20: streamed words.", { exact: true });
			await target.waitFor();
			await target.evaluate((element) => {
				element.scrollIntoView({ block: "center" });
				element.closest(".aw-conv-log")!.dispatchEvent(new Event("scroll"));
			});
			await page.getByRole("button", { name: /Jump to latest/ }).waitFor();
			const before = await target.boundingBox();
			await page
				.getByRole("button", { name: "Open here", exact: true })
				.evaluate((button) => (button as HTMLButtonElement).click());
			await page.getByRole("button", { name: "Back to conversation", exact: true }).waitFor();
			expect(await log(page).isVisible()).toBe(false);
			await trackHistoryReads(page);
			const saved = groupedReply("inline-saved", start + minutes * 60_000, text);
			await page.evaluate((entry) => {
				(window as any).append("pi-tests", entry);
				(window as any).reply({ kind: "end", characterId: "pi-tests", streamId: "inline-stream", entry });
			}, saved);
			await page.locator('.aw-conv-log [data-entry="inline-saved"]').waitFor({ state: "attached" });
			await finishHistoryReads(page);
			await page.getByRole("button", { name: "Back to conversation", exact: true }).click();
			await target.waitFor();
			const after = await target.boundingBox();
			expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
			expect(await log(page).locator(".aw-conv-assistant").count()).toBe(minutes === 1 ? 1 : 2);
			expect(await page.getByRole("button", { name: /jump to latest/i }).count()).toBe(1);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	30000,
);

test.each([true, false])(
	"a hidden composer send resumes latest when the pending older read finishes hidden: %s",
	async (finishHidden) => {
		const start = new Date(2026, 10, 7, 10).getTime();
		const entries = Array.from({ length: 80 }, (_, index) =>
			groupedReply(`send-old-${index}`, start + index * 60_000, `Send paragraph ${index}.`),
		);
		(entries[30] as Extract<TranscriptEntry, { kind: "assistant" }>).parts.push({
			kind: "tool",
			call: { id: "send-page", name: "explain_change", arg: null, input: "{}" },
		});
		const { page, errors } = await openWorld(world(), { "pi-tests": entries });
		page.setDefaultTimeout(5000);
		await page.route(`${ORIGIN}/fixture-send*`, (route) =>
			route.fulfill({ body: "<h1>Send fixture</h1>", contentType: "text/html" }),
		);
		await page.addInitScript((origin) => {
			const w = window as any;
			w.agentWorkplace.browserPage = async () => ({ tool: "explain_change", url: `${origin}/fixture-send` });
			const read = w.agentWorkplace.conversation;
			w.agentWorkplace.conversation = async (...args: unknown[]) => {
				const response = await read(...args);
				if (args[1])
					await new Promise<void>((resolve) => {
						w.releaseOlder = resolve;
					});
				return response;
			};
		}, ORIGIN);
		try {
			await openSessionReader(page, "DM");
			await log(page).getByText("Send paragraph 79.", { exact: true }).waitFor();
			await log(page).evaluate((element) => {
				element.scrollTop = 0;
			});
			await page.waitForFunction(() => typeof (window as any).releaseOlder === "function");
			await page.getByRole("button", { name: "Open here", exact: true }).click();
			await page.getByRole("button", { name: "Back to conversation", exact: true }).waitFor();
			const composer = page.getByRole("textbox", { name: "Instruct pi-tests", exact: true });
			await composer.fill("Continue the task.");
			await composer.press("Enter");
			await vi.waitFor(async () =>
				expect(await commands(page)).toEqual([["pi-tests", { kind: "steer", text: "Continue the task." }]]),
			);
			if (finishHidden) {
				await page.evaluate(() => (window as any).releaseOlder());
				await page.locator('.aw-conv-log [data-entry="send-old-0"]').waitFor({ state: "attached" });
			}
			await page.getByRole("button", { name: "Back to conversation", exact: true }).click();
			const distance = () =>
				log(page).evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
			await vi.waitFor(async () => expect(await distance()).toBeLessThan(2));
			if (!finishHidden) {
				await page.evaluate(() => (window as any).releaseOlder());
				await log(page).locator('[data-entry="send-old-0"]').waitFor();
			}
			await page.evaluate(() =>
				(window as any).reply({
					kind: "delta",
					characterId: "pi-tests",
					streamId: "after-send",
					seq: 1,
					delta: "Following after the hidden send.",
				}),
			);
			await log(page).getByText("Following after the hidden send.", { exact: true }).waitFor();
			await vi.waitFor(async () => expect(await distance()).toBeLessThan(2));
			expect(await page.getByRole("button", { name: /jump to latest/i }).count()).toBe(0);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	30000,
);

test("backward live timestamps start a new header without crossing the retained unread boundary", async () => {
	const start = new Date(2026, 10, 7, 10).getTime();
	const snapshot = world(
		CAST.map((person) =>
			person.id === "pi-tests"
				? { ...person, facts: facts({ unseen: true, seenAt: start + 10 * 60_000, needsYouSince: start + 20 * 60_000 }) }
				: person,
		),
	);
	const { page, errors } = await openWorld(snapshot, {
		"pi-tests": [groupedReply("clock-saved", start + 20 * 60_000, "Saved after the cutoff.")],
	});
	try {
		await openSessionReader(page, "DM");
		await log(page).getByText("Saved after the cutoff.", { exact: true }).waitFor();
		await page.clock.setFixedTime(new Date(start));
		await page.evaluate(() =>
			(window as any).reply({
				kind: "delta",
				characterId: "pi-tests",
				streamId: "clock-stream",
				seq: 1,
				delta: "Live text after clock correction.",
			}),
		);
		await log(page).getByText("Live text after clock correction.", { exact: true }).waitFor();
		expect(await log(page).locator(".aw-conv-assistant").count()).toBe(2);
		const marked = log(page)
			.locator(".aw-conv-block")
			.filter({ has: page.locator("[data-unread-start]") });
		expect(await marked.textContent()).toContain("Saved after the cutoff.");
		expect(await marked.textContent()).not.toContain("Live text after clock correction.");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

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
		await expect(book(page).getByRole("textbox", { name: "Reply to asker" }).count()).resolves.toBe(0);
		await expect(form(page).getByRole("group").count()).resolves.toBe(3);
		const first = question(page, 0);
		await expect(first.textContent()).resolves.toContain("Which branch should the fix go on?");
		await expect(first.textContent()).resolves.toContain("Branch");
		await expect(first.textContent()).resolves.toContain("Straight onto main; the suite is green there.");
		await expect(first.getByRole("radio").count()).resolves.toBe(3);
		await expect(question(page, 1).getByRole("checkbox").count()).resolves.toBe(4);
		await expect(question(page, 1).textContent()).resolves.toContain("A line for the release notes.");
		const send = form(page).getByRole("button", { name: "Send answer" });
		await expect(send.isDisabled()).resolves.toBe(true);
		await shot(page, "form", "14");

		await first.getByRole("radio", { name: /^main/ }).click();
		await first.getByRole("radio", { name: /^retry/ }).click();
		await expect(first.getByRole("radio", { name: /^main/ }).isChecked()).resolves.toBe(false);
		const extras = question(page, 1);
		await extras.getByRole("checkbox", { name: /^Tests/ }).click();
		await extras.getByRole("checkbox", { name: /^Changelog/ }).click();
		await expect(extras.getByRole("checkbox", { checked: true }).count()).resolves.toBe(2);
		await extras.getByRole("checkbox", { name: /own words/ }).click();
		await expect(extras.getByRole("checkbox", { checked: true }).count()).resolves.toBe(1);
		await extras.getByRole("checkbox", { name: /^Docs/ }).click();
		await expect(extras.getByRole("checkbox", { name: /own words/ }).isChecked()).resolves.toBe(false);
		await extras.getByRole("checkbox", { name: /^Tests/ }).click();
		const last = question(page, 2);
		await last.getByRole("radio", { name: /own words/ }).click();
		const words = last.getByRole("textbox");
		await vi.waitFor(async () => expect(await words.evaluate((el) => el === document.activeElement)).toBe(true));
		await expect(send.isDisabled()).resolves.toBe(true);
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

test("a session waiting on a sign-off page keeps the reply box and says the verdict is given on the page", async () => {
	const { page, errors } = await openWorld(asker({ kind: "sign-off", text: "Plan for the cache" }), { asker: SUITE });
	try {
		await talkTo(page, "asker");
		const note = book(page).getByRole("status").filter({ hasText: "waiting for your sign-off" });
		await note.waitFor({ timeout: 3000 });
		await expect(note.textContent()).resolves.toContain("Plan for the cache");
		await expect(book(page).getByRole("note").count()).resolves.toBe(0);
		await expect(book(page).getByRole("textbox").count()).resolves.toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

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
		const tool = log(page).locator(".aw-conv-tool").filter({ hasText: "bash" });
		await expect(tool.locator(".aw-conv-fold-arg").textContent()).resolves.toBe("ls docs");
		await tool.getByRole("button").first().click();
		await expect(tool.locator("pre").nth(1).textContent()).resolves.toBe("  README.md\n  guide.md");
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
		await log(page).getByRole("link", { name: "file:///etc/hosts" }).click();
		await log(page).getByRole("link", { name: "the run" }).click();
		const cwd = "/Users/op/code/apple-pi";
		await vi.waitFor(async () =>
			expect((await page.evaluate(() => (window as any).links)).slice(2)).toEqual([
				["file", "file:///etc/hosts", cwd],
				["file", "docs/run.md:3", cwd],
			]),
		);
		await expect(log(page).getByRole("link", { name: "vscode://file/x" }).count()).resolves.toBe(0);
		await expect(log(page).locator(".aw-md-link-dead").getAttribute("title")).resolves.toBe("vscode://file/x");
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

test("a DM opens browser pages inline, keeps hidden replies unread, and acknowledges on return", async () => {
	const signOffs: TranscriptEntry[] = [
		{
			kind: "assistant",
			id: "sign-off",
			at: at(90),
			parts: [
				{ kind: "text", text: "Please review the change." },
				{ kind: "tool", call: { id: "live-call", name: "sign_off_code", arg: null, input: "{}" } },
			],
			error: null,
			aborted: false,
		},
		{
			kind: "assistant",
			id: "old-explain",
			at: at(91),
			parts: [{ kind: "tool", call: { id: "closed-call", name: "explain_change", arg: null, input: "{}" } }],
			error: null,
			aborted: false,
		},
	];
	const { page, errors } = await openWorld(world(), {
		"pi-tests": [...SUITE, ...signOffs],
		ledger: [],
		asker: [],
		[HQ]: [],
	});
	page.setDefaultTimeout(5000);
	await page.route(`${ORIGIN}/fixture-sign-off*`, (route) =>
		route.fulfill({ body: "<h1>Review fixture</h1>", contentType: "text/html" }),
	);
	await page.addInitScript((origin) => {
		const w = window as any;
		w.pageLookups = [];
		w.agentWorkplace.browserPage = async (person: string, callId: string) => {
			w.pageLookups.push([person, callId]);
			return callId === "live-call" ? { tool: "sign_off_code", url: `${origin}/fixture-sign-off` } : null;
		};
	}, ORIGIN);
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: /^pi-tests/ }).click();
		await log(page).getByText("Please review the change.").waitFor();
		await log(page).getByText("Explanation page", { exact: true }).waitFor();
		await log(page)
			.locator(".aw-conv-page-card")
			.filter({ hasText: "Code review page" })
			.getByRole("button", { name: "Open here" })
			.click();
		const inline = page.getByRole("region", { name: "Code review page", exact: true });
		await inline.waitFor();
		await page
			.frameLocator('iframe[title="Code review page"]')
			.getByRole("heading", { name: "Review fixture" })
			.waitFor();
		await shot(page, "inline-page");
		expect(await log(page).isVisible()).toBe(false);
		expect(await page.getByRole("textbox").first().isVisible()).toBe(true);
		await trackHistoryReads(page);
		await page.evaluate(async () => {
			const w = window as any;
			const at = Date.now();
			w.append("pi-tests", {
				kind: "assistant",
				id: "hidden-inline-reply",
				at,
				parts: [{ kind: "text", text: "Reply behind the inline page." }],
				error: null,
				aborted: false,
			});
			const current = await w.agentWorkplace.snapshot();
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
									needsYouSince: at,
									settledAt: at,
								},
							}
						: person,
				),
			});
		});
		await page.locator('.aw-conv-log [data-entry="hidden-inline-reply"]').waitFor({ state: "attached" });
		await finishHistoryReads(page);
		expect(await seen(page)).toEqual([]);
		await inline.getByRole("button", { name: "Back to conversation" }).click();
		await log(page).getByText("Reply behind the inline page.", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await seen(page)).toEqual(["pi-tests"]));
		await inline.waitFor({ state: "detached" });
		await log(page).getByText("Please review the change.").waitFor();
		await log(page)
			.locator(".aw-conv-page-card")
			.filter({ hasText: "Explanation page" })
			.getByRole("button", { name: "Open here" })
			.click();
		await page.getByText("That explanation page is closed.").waitFor();
		expect(await page.evaluate(() => (window as any).pageLookups)).toEqual([
			["pi-tests", "live-call"],
			["pi-tests", "closed-call"],
		]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("a real review page open in a DM follows Workplace's light/dark toggle without reloading", async () => {
	const repo = mkdtempSync(join(tmpdir(), "inline-page-"));
	mkdirSync(join(repo, "docs"));
	writeFileSync(join(repo, "docs", "plan.md"), "# Plan\n\nShip the inline page.\n");
	const token = "inline-theme-token";
	const { page: data } = await buildMarkdownPage({ path: "docs/plan.md" }, repo, token);
	const session = await openPageSession(embedPage(await markdownTemplate(data), data), token, () => undefined);
	const signOff: TranscriptEntry = {
		kind: "assistant",
		id: "doc-review",
		at: at(90),
		parts: [{ kind: "tool", call: { id: "doc-call", name: "sign_off_document", arg: null, input: "{}" } }],
		error: null,
		aborted: false,
	};
	const { page, errors } = await openWorld(world(), {
		"pi-tests": [...SUITE, signOff],
		ledger: [],
		asker: [],
		[HQ]: [],
	});
	page.setDefaultTimeout(8000);
	await page.addInitScript((url) => {
		(window as any).agentWorkplace.browserPage = async () => ({ tool: "sign_off_document", url });
	}, session.url);
	try {
		await page.getByRole("link", { name: "Workplace", exact: true }).click();
		await page.getByRole("button", { name: /^pi-tests/ }).click();
		await log(page).getByRole("button", { name: "Open here" }).click();
		const appearance = () => page.locator(".wp-app").getAttribute("data-appearance");
		const start = await appearance();
		const frame = () => page.frames().find((candidate) => candidate.url().startsWith(session.url))!;
		await vi.waitFor(
			async () => expect(await frame()?.evaluate(() => document.documentElement.dataset.theme)).toBe(start),
			{ timeout: 8000 },
		);
		await frame().evaluate(() => {
			(window as any).loadedOnce = true;
		});
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		const next = await appearance();
		expect(next).not.toBe(start);
		await vi.waitFor(
			async () => expect(await frame().evaluate(() => document.documentElement.dataset.theme)).toBe(next),
			{ timeout: 5000 },
		);
		expect(await frame().evaluate(() => (window as any).loadedOnce)).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
		session.close();
		rmSync(repo, { recursive: true, force: true });
	}
}, 40000);

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
	await page.getByRole("button", { name: /^Group: Orla/ }).click();
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
		await page.getByRole("button", { name: /^Group: Orla/ }).click();
		await page.locator(".wp-channel-header p").getByRole("button", { name: "Orla", exact: true }).click();
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
		await profile.getByText("Away", { exact: true }).waitFor();
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

test("team channels render safe Markdown, keep unresolved files inert and open web links without navigating", async () => {
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
		await page.getByText("spec", { exact: true }).waitFor();
		expect(await page.getByRole("link", { name: "Open file: spec", exact: true }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).links)).toEqual(["https://example.com/release"]);
		expect(page.url()).toBe(before);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("channel access permits quiet posting while unfollowed; failed follow changes and leave/rejoin retain drafts", async () => {
	const { page, errors, id } = await openWorkplaceChannel();
	try {
		const composer = page.getByRole("textbox", { name: "Post to channel", exact: true });
		await composer.waitFor();
		expect(await page.evaluate(() => (window as any).membershipCommands)).toEqual([]);
		await composer.fill("A quiet post mentioning Orla");
		await composer.press("Enter");
		await page.getByText("A quiet post mentioning Orla", { exact: true }).waitFor();
		expect(
			await page.evaluate(
				() => (window as any).communicationCalls.filter((call: any) => call.method === "post").at(-1).request.notify,
			),
		).toEqual([]);
		await page.evaluate(() => {
			(window as any).membershipError = "Joining was refused";
		});
		await page.getByRole("button", { name: "Join channel", exact: true }).click();
		await page.getByRole("alert").filter({ hasText: "Joining was refused" }).waitFor();
		await composer.waitFor();
		await page.getByRole("button", { name: "Join channel", exact: true }).click();
		await composer.fill("A channel post");
		await composer.press("Shift+Enter");
		expect(await composer.inputValue()).toBe("A channel post\n");
		expect(await page.evaluate(() => (window as any).threadReplies)).toEqual([[id, "A quiet post mentioning Orla"]]);
		await composer.press("Enter");
		await page.getByText("A channel post", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).threadReplies)).toEqual([
			[id, "A quiet post mentioning Orla"],
			[id, "A channel post\n"],
		]);
		await composer.fill("Unsent draft");
		await page.getByLabel("Conversation actions", { exact: true }).click();
		await page.evaluate(() => {
			(window as any).membershipError = "Leaving was refused";
		});
		await page.getByRole("button", { name: "Leave channel", exact: true }).click();
		await page.getByRole("alert").filter({ hasText: "Leaving was refused" }).waitFor();
		expect(await composer.inputValue()).toBe("Unsent draft");
		await page.getByLabel("Conversation actions", { exact: true }).click();
		await page.getByRole("button", { name: "Leave channel", exact: true }).click();
		expect(await composer.inputValue()).toBe("Unsent draft");
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
		await addRecipient(page.locator("body"), "To", "pi-tests");
		await page.getByRole("textbox", { name: "Mail body", exact: true }).fill("Keep this recipient with this draft.");
		await page.getByRole("button", { name: "Close new message", exact: true }).click();
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		expect(await recipients(page.locator("body"))).toEqual(["pi-tests"]);
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
				const current = await w.agentWorkplace.snapshot();
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
			const current = await w.agentWorkplace.snapshot();
			w.push({ ...current, characters: current.characters.map((person: any) => ({ ...person, hiredAt: null })) });
		});
		await profile.getByText("First seen", { exact: true }).waitFor();
		expect(await profile.getByText("Hired", { exact: true }).count()).toBe(0);
		expect(await profile.getByText("From", { exact: true }).count()).toBe(0);
		await page.evaluate(async () => {
			const w = window as any;
			const current = await w.agentWorkplace.snapshot();
			w.push({
				...current,
				characters: current.characters.map((person: any) => ({
					...person,
					origin: { people: "Irish", place: "Galway", pronouns: "she" },
				})),
			});
		});
		await profile.getByText("Galway (Irish)", { exact: true }).waitFor();
		await profile.getByText("she/her", { exact: true }).waitFor();
		expect(await profile.locator("time").getAttribute("datetime")).toBe(new Date(at(1)).toISOString());
		await page.evaluate(async () => {
			const w = window as any;
			const current = await w.agentWorkplace.snapshot();
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
		await profile.getByRole("button", { name: "View all recorded work (1)", exact: true }).waitFor();
		await profile.getByText("Recorded completed work", { exact: true }).waitFor();
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
					const current = await w.agentWorkplace.snapshot();
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

test("a group is read while its end is in view; posts that arrive while he reads older ones stay unread until he jumps back", async () => {
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
		const channel = page.getByRole("button", { name: /^Group: / });
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
		await divider.waitFor();
		expect(
			await page.evaluate(() =>
				(window as any).communicationCalls.every(
					(call: any) => call.method !== "readThread" || call.request.view === "recent",
				),
			),
		).toBe(true);
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
