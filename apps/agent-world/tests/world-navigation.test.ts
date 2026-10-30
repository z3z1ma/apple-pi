import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { WorldSnapshot } from "../src/world.js";
import { installWorkplaceCommunications } from "./helpers/workplace-communications.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const ROOT = "/fixture/navigation";
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

async function openWorkplace() {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
	page.setDefaultTimeout(7000);
	const errors: string[] = [];
	const dialogs: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.type());
		void dialog.dismiss();
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(APP, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript((root) => {
		if (window !== window.top) return;
		const w = window as any;
		const now = Date.now();
		let current: WorldSnapshot = {
			connected: true,
			theme: "fantasy",
			headquarters: [{ id: "ada", name: "Ada", wings: [{ repository: root, name: "navigation", headcount: 1 }] }],
			characters: [
				{
					id: "ada",
					name: "Ada",
					role: "coordinator",
					place: { kind: "headquarters", headquarters: "ada" },
					startedAt: now - 1000,
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
						cwd: root,
						reportsTo: null,
						title: "Coordinator",
						model: null,
						contextTokens: null,
						contextWindow: null,
						cost: 0,
						tmux: null,
					},
				},
			],
			dormant: [],
			mail: [],
			operatorMail: [{ id: "review", subject: "Review the navigation", lastAt: now, unread: 1 }],
			workplace: { threads: [], tasks: [], escalations: [] },
		};
		current.characters.push({
			...current.characters[0]!,
			id: "ben",
			name: "Ben",
			role: "worker",
			facts: { ...current.characters[0]!.facts!, reportsTo: "ada", title: "Engineer" },
		});
		const updates = new Set<(snapshot: WorldSnapshot) => void>();
		const feeds = new Set<(event: unknown) => void>();
		const replies = new Set<(event: unknown) => void>();
		w.documentToken = crypto.randomUUID();
		w.navigationCalls = {
			pages: [],
			seen: [],
			watched: [],
			reads: [],
			saves: [],
			mailReads: [],
			mailReplies: [],
			sent: [],
			unloads: 0,
		};
		window.addEventListener("beforeunload", () => {
			w.navigationCalls.unloads++;
		});
		const publish = () => {
			for (const listener of updates) listener(current);
		};
		w.publishNeed = () => {
			current = {
				...current,
				characters: current.characters.map((person) =>
					person.id === "ada"
						? {
								...person,
								facts: { ...person.facts!, unseen: true, needsYouSince: now + 5000, settledAt: now + 5000 },
							}
						: person,
				),
			};
			publish();
		};
		w.publishPulse = (number: number) => {
			current = {
				...current,
				characters: current.characters.map((person) =>
					person.id === "ada" ? { ...person, facts: { ...person.facts!, settledAt: now + number } } : person,
				),
			};
			publish();
		};
		const thread = {
			id: "review",
			subject: "Review the navigation",
			closed: false,
			participants: [
				{ id: "operator", name: "Operator" },
				{ id: "ada", name: "Ada" },
			],
			messages: [{ seq: 1, from: "ada", name: "Ada", at: now, body: "Please review the retained World tab." }],
		};
		w.agentWorld = {
			snapshot: async () => current,
			onUpdate: (listener: (snapshot: WorldSnapshot) => void) => {
				updates.add(listener);
				return () => updates.delete(listener);
			},
			feed: async () => [],
			onFeed: (listener: (event: unknown) => void) => {
				feeds.add(listener);
				return () => feeds.delete(listener);
			},
			onReceipt: () => () => {},
			onReply: (listener: (event: unknown) => void) => {
				replies.add(listener);
				return () => replies.delete(listener);
			},
			onNotepad: () => () => {},
			watchReplies: async (ids: string[]) => {
				w.navigationCalls.watched.push([...ids]);
			},
			conversation: async (id: string) => {
				w.navigationCalls.pages.push(id);
				const result = { ok: true, entries: [], before: null, missing: 0 };
				if (w.holdConversation)
					return await new Promise((resolve) => {
						w.releaseHistory = () => {
							w.holdConversation = false;
							resolve(result);
						};
					});
				return result;
			},
			markSeen: async (id: string) => {
				w.navigationCalls.seen.push(id);
				current = {
					...current,
					characters: current.characters.map((person) =>
						person.id === id
							? { ...person, facts: { ...person.facts!, unseen: false, needsYouSince: null, seenAt: Date.now() } }
							: person,
					),
				};
				publish();
				return { ok: true };
			},
			profile: async () => ({ ok: true, self: null }),
			themes: async () => [{ id: "fantasy", name: "Fantasy", description: null, problems: [] }],
			setTheme: async () => ({ ok: true }),
			setAvatarLook: async () => ({ ok: true }),
			goToTerminal: async () => ({ ok: true }),
			readThread: async (id: string) => {
				w.navigationCalls.mailReads.push(id);
				return { ok: true, thread: structuredClone(thread) };
			},
			replyThread: async (id: string, body: string) => {
				w.navigationCalls.mailReplies.push({ id, body });
				return await new Promise((resolve) => {
					w.releaseReply = () => {
						thread.messages.push({ seq: 2, from: "operator", name: "Operator", at: Date.now(), body });
						resolve({ ok: true, stage: "applied" });
					};
				});
			},
			sendMail: async (id: string, body: string) => {
				w.navigationCalls.sent.push({ id, body });
				return { ok: true };
			},
			workspace: {
				repositories: async () => ({ ok: true, roots: [root] }),
				worktrees: async () => ({ ok: true, root, worktrees: [] }),
				tree: async (request: { root: string; path: string }) => ({
					ok: true,
					...request,
					entries: [{ name: "main.ts", path: "main.ts", kind: "file" }],
				}),
				readFile: async (request: { root: string; path: string }) => {
					w.navigationCalls.reads.push(request);
					return { ok: true, ...request, text: 'export const navigation = "original";\n', hash: "original" };
				},
				saveFile: async (request: unknown) => {
					w.navigationCalls.saves.push(request);
					return { ok: true, hash: "saved" };
				},
				gitStatus: async () => ({ ok: true, branch: "main", entries: [] }),
			},
		};
	}, ROOT);
	await page.addInitScript(installWorkplaceCommunications);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "World", exact: true }).waitFor();
	return { page, errors, dialogs };
}

async function openWorld(page: Page) {
	await page.getByRole("button", { name: "World", exact: true }).click();
	const frameElement = page.locator('iframe[title="Agent World"]');
	await frameElement.waitFor();
	const frame = await (await frameElement.elementHandle())!.contentFrame();
	if (!frame) throw new Error("World frame not loaded");
	await vi.waitFor(
		async () => expect(await frame.evaluate(() => (window as any).agentWorldView?.place())).toBeTruthy(),
		{ timeout: 20000 },
	);
	await frame.locator(".aw-side").waitFor();
	return frame;
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
	await page.screenshot({ path: join(SHOTS, `aw-navigation-${name}.png`), animations: "disabled" });
}

test("World is lazy and retained, preserving Code, Chat, Mail and its own draft without hidden conversation reads", async () => {
	const { page, errors, dialogs } = await openWorkplace();
	try {
		const token = await page.evaluate(() => (window as any).documentToken);
		expect(await page.locator('iframe[title="Agent World"]').count()).toBe(0);
		await page.getByRole("button", { name: /^Ben/ }).click();
		const chatDraft = page.getByRole("textbox", { name: "Reply to Ben", exact: true });
		await chatDraft.fill("Keep the Chat draft separate.");
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		await page.getByRole("combobox", { name: "Mail recipient", exact: true }).selectOption("ada");
		await page.getByRole("textbox", { name: "Mail body", exact: true }).fill("Keep the Mail draft and recipient.");
		await page.getByRole("button", { name: "Close new message", exact: true }).click();
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "main.ts", exact: true })
			.click();
		const editor = page.locator(".monaco-editor");
		await editor.waitFor();
		await editor.click();
		await page.keyboard.press("Meta+A");
		await page.keyboard.insertText('export const navigation = "retained draft";\n');
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		expect(await page.locator('iframe[title="Agent World"]').count()).toBe(0);
		const frame = await openWorld(page);
		expect(page.url()).toBe(`${ORIGIN}/index.html?workplace=world`);
		const frameToken = await frame.evaluate(() => {
			(window as any).navigationToken = crypto.randomUUID();
			return (window as any).navigationToken;
		});
		await frame.getByRole("button", { name: /^Ada/ }).click();
		await frame.getByRole("button", { name: "Talk to Ada", exact: true }).click();
		const conversation = frame.getByRole("dialog", { name: "Conversation with Ada", exact: true });
		const worldDraft = conversation.getByRole("textbox", { name: "Reply to Ada", exact: true });
		await worldDraft.fill("Keep the World conversation draft.");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.watched.at(-1))).toEqual(["ada"]),
		);
		const readsBefore = await page.evaluate(() => (window as any).navigationCalls.pages.length);
		await page.getByRole("button", { name: "Code", exact: true }).click();
		expect(
			await page.getByRole("button", { name: "Code", exact: true }).evaluate((node) => document.activeElement === node),
		).toBe(true);
		await page.evaluate(() => (window as any).publishNeed());
		await vi.waitFor(async () =>
			expect(await frame.getByRole("button", { name: "Needs you: 1", exact: true, includeHidden: true }).count()).toBe(
				1,
			),
		);
		expect(await page.evaluate(() => (window as any).navigationCalls.pages.length)).toBe(readsBefore);
		expect(await page.evaluate(() => (window as any).navigationCalls.seen)).toEqual([]);
		expect((await page.locator(".monaco-editor .view-lines").textContent())?.replace(/\u00a0/g, " ")).toContain(
			"retained draft",
		);
		await page.getByRole("button", { name: "World", exact: true }).click();
		await conversation.waitFor();
		expect(await worldDraft.inputValue()).toBe("Keep the World conversation draft.");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.seen)).toEqual(["ada"]),
		);
		expect(await frame.evaluate(() => (window as any).navigationToken)).toBe(frameToken);
		for (const [appearance, width] of [
			["light", 1440],
			["dark", 900],
		] as const) {
			if (appearance === "dark") await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
			await page.setViewportSize({ width, height: 900 });
			const box = (await page.locator('iframe[title="Agent World"]').boundingBox())!;
			const rail = (await page.getByRole("button", { name: "World", exact: true }).boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
			expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
			expect(box.y + box.height).toBeLessThanOrEqual(901);
			await shot(page, `retained-world-${appearance}-${width}`);
		}
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		expect(await chatDraft.inputValue()).toBe("Keep the Chat draft separate.");
		await conversation.waitFor({ state: "hidden" });
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.watched.at(-1))).toEqual(["ben"]),
		);
		await page.getByRole("button", { name: "World", exact: true }).click();
		await worldDraft.waitFor();
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.watched.at(-1))).toEqual(["ada"]),
		);
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		expect(await page.getByRole("combobox", { name: "Mail recipient", exact: true }).inputValue()).toBe("ada");
		expect(await page.getByRole("textbox", { name: "Mail body", exact: true }).inputValue()).toBe(
			"Keep the Mail draft and recipient.",
		);
		expect(await page.locator('iframe[title="Agent World"]').count()).toBe(1);
		expect(await page.evaluate(() => (window as any).documentToken)).toBe(token);
		const calls = await page.evaluate(() => (window as any).navigationCalls);
		expect(calls.unloads).toBe(0);
		expect(calls.saves).toEqual([]);
		expect(calls.sent).toEqual([]);
		expect(dialogs).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60_000);

test("a queued second conversation refresh is discarded when World hides before the first read completes", async () => {
	const { page, errors } = await openWorkplace();
	try {
		const frame = await openWorld(page);
		await frame.getByRole("button", { name: /^Ada/ }).click();
		await frame.getByRole("button", { name: "Talk to Ada", exact: true }).click();
		const dialog = frame.getByRole("dialog", { name: "Conversation with Ada", exact: true });
		await dialog.getByRole("textbox", { name: "Reply to Ada", exact: true }).fill("Keep this pending-read draft.");
		await frame.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		expect(await page.evaluate(() => (window as any).navigationCalls.pages)).toEqual(["ada"]);
		await page.evaluate(() => {
			(window as any).holdConversation = true;
			(window as any).publishPulse(1);
		});
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.pages)).toEqual(["ada", "ada"]),
		);
		await page.evaluate(() => (window as any).publishPulse(2));
		await frame.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await page.evaluate(() => (window as any).releaseHistory());
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		expect(await page.evaluate(() => (window as any).navigationCalls.pages)).toEqual(["ada", "ada"]);
		expect(await page.evaluate(() => (window as any).navigationCalls.seen)).toEqual([]);
		await page.getByRole("button", { name: "World", exact: true }).click();
		expect(await dialog.getByRole("textbox", { name: "Reply to Ada", exact: true }).inputValue()).toBe(
			"Keep this pending-read draft.",
		);
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.pages)).toEqual(["ada", "ada", "ada"]),
		);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60_000);

test("a World inbox reply finishing while hidden does not reread or acknowledge mail until explicit return and read", async () => {
	const { page, errors, dialogs } = await openWorkplace();
	try {
		const frame = await openWorld(page);
		await frame.getByRole("tab", { name: "Mail", exact: true }).click();
		const inbox = frame.getByRole("region", { name: "Your inbox", exact: true });
		await inbox.getByRole("button", { name: /^Review the navigation/ }).click();
		await inbox
			.getByRole("textbox", { name: "Reply to everyone", exact: true })
			.fill("Read this only after returning.");
		await inbox.getByRole("button", { name: "Send reply", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).navigationCalls.mailReplies)).toHaveLength(1),
		);
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await page.evaluate(() => (window as any).releaseReply());
		await vi.waitFor(async () =>
			expect(
				await frame.getByRole("textbox", { name: "Reply to everyone", exact: true, includeHidden: true }).inputValue(),
			).toBe(""),
		);
		expect(await page.evaluate(() => (window as any).navigationCalls.mailReads)).toEqual(["review"]);
		await page.getByRole("button", { name: "World", exact: true }).click();
		await inbox.getByRole("button", { name: "Read latest", exact: true }).click();
		await inbox.getByText("Read this only after returning.", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).navigationCalls.mailReads)).toEqual(["review", "review"]);
		expect(dialogs).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60_000);
