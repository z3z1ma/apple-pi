import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";

// The workplace in the built world UI over a fixture backend. The backend suites prove that these calls reach the
// runtime; this proves where the operator finds them and what the UI sends.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const PACKS = ["fantasy", "tech-office", "anime-school"] as const;
const HQ = "orla";
const NOW = Date.now();
const manifest = (id: string) =>
	JSON.parse(readFileSync(join(appDir, "themes", id, "theme.json"), "utf8")) as {
		name: string;
		labels: Record<string, string>;
		text: Record<string, string>;
	};
const board = (id: string) =>
	(
		JSON.parse(readFileSync(join(appDir, "themes", id, "places", "headquarters.json"), "utf8")) as {
			furniture: { rect: [number, number, number, number]; use: string }[];
		}
	).furniture.find((piece) => piece.use === "notes")!;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

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
		cwd: "/r/apple-pi",
		reportsTo: HQ,
		model: null,
		contextTokens: null,
		contextWindow: null,
		cost: 0,
		tmux: null,
		...over,
	};
}
const character = (id: string, name: string, role: Character["role"], place: Character["place"]): Character => ({
	id,
	name,
	role,
	place,
	startedAt: NOW - (id === HQ ? 9_000 : 8_000),
	facts: facts({ reportsTo: id === HQ ? null : HQ }),
});
const world = (theme: string): WorldSnapshot => ({
	connected: true,
	theme,
	headquarters: [{ id: HQ, name: "Orla", wings: [{ repository: "/r/apple-pi", name: "apple-pi", headcount: 1 }] }],
	characters: [
		character(HQ, "Orla", "coordinator", { kind: "headquarters", headquarters: HQ }),
		character("docs", "Docs", "worker", { kind: "headquarters", headquarters: HQ }),
		character("tests", "Tests", "worker", { kind: "meeting-room", headquarters: HQ }),
	],
	dormant: [],
	mail: [],
	workplace: {
		threads: [
			{
				id: `team:${HQ}`,
				kind: "channel",
				subject: "Orla's team",
				createdBy: HQ,
				headquarters: HQ,
				closed: false,
				lastSeq: 2,
				lastAt: NOW,
				participants: [HQ, "docs", "tests"],
			},
			{
				id: "release",
				kind: "meeting",
				subject: "Release decision",
				createdBy: HQ,
				headquarters: HQ,
				closed: false,
				lastSeq: 3,
				lastAt: NOW,
				participants: [HQ, "tests"],
			},
		],
		tasks: [
			{
				id: "fix-login",
				bundle: "/r/apple-pi/.ledger/fix-login",
				project: "/r/apple-pi",
				headquarters: HQ,
				title: "Fix login",
				status: "in-progress",
				ephemeral: false,
				thread: "task:fix-login",
				assignees: [{ person: "tests", focused: true }],
			},
			{
				id: "/r/apple-pi/.ledger/write-guide",
				bundle: "/r/apple-pi/.ledger/write-guide",
				project: "/r/apple-pi",
				headquarters: HQ,
				title: "Write the guide",
				status: "ready",
				ephemeral: false,
				thread: null,
				assignees: [],
			},
			{
				id: "note-1",
				bundle: "/state/work/note-1",
				project: "/r/apple-pi",
				headquarters: HQ,
				title: "Check the empty invoice",
				status: null,
				ephemeral: true,
				thread: null,
				assignees: [{ person: "docs", focused: false }],
			},
		],
		escalations: [],
	},
});

async function openWorld(theme: string) {
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
	const themes = PACKS.map((id) => ({ id, name: manifest(id).name, description: null, problems: [] }));
	await page.addInitScript(
		([snapshot, themes]) => {
			const w = window as any;
			w.workplaceCalls = { assigned: [], read: [] };
			w.agentWorld = {
				snapshot: async () => snapshot,
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				goToTerminal: async () => ({ ok: true }),
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
				setAvatarLook: async () => ({ ok: true }),
				themes: async () => themes,
				setTheme: async () => ({ ok: true }),
				instruct: async () => ({ ok: true }),
				onReceipt: () => () => {},
				watchReplies: async () => {},
				onReply: () => () => {},
				onNotepad: () => () => {},
				readTask: async (id: string) => ({ ok: true, text: `# ${id}\n\nWrite **the guide** for new colleagues.` }),
				async assignTask(person: string, task: string) {
					w.workplaceCalls.assigned.push({ person, task });
					return { ok: true, stage: "applied" };
				},
				async readWorkplaceThread(id: string) {
					w.workplaceCalls.read.push(id);
					const meeting = id === "release";
					return {
						ok: true,
						thread: {
							id,
							subject: meeting ? "Release decision" : "Orla's team",
							closed: false,
							participants: [
								{ id: "orla", name: "Orla" },
								{ id: "tests", name: "Tests" },
							],
							messages: [
								{
									seq: 1,
									from: "orla",
									name: "Orla",
									at: Date.now(),
									body: meeting ? "Can we release?" : "Docs are next.",
								},
							],
						},
					};
				},
			};
		},
		[world(theme), themes] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(async () => expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme), {
		timeout: 20000,
	});
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(500);
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	await page.addStyleTag({ content: ".aw-places > *, .aw-places > * * { pointer-events: auto !important; }" });
	return { page, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const calls = (page: Page) =>
	page.evaluate(() => (window as any).workplaceCalls) as Promise<{
		assigned: { person: string; task: string }[];
		read: string[];
	}>;

async function menuFor(page: Page, point: [number, number]) {
	const [x, y] = await screen(page, ...point);
	await page.mouse.click(x, y, { button: "right" });
}

async function doorMenu(page: Page, name: string) {
	await page.evaluate((door) => (window as any).agentWorldView.lookAt(door), name);
	await page.waitForTimeout(400);
	const door = (await view<{ name: string; x: number; y: number }[]>(page, "doors()")).find(
		(item) => item.name === name,
	)!;
	await page.mouse.click(door.x, door.y, { button: "right" });
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

describe.each(PACKS)("%s", (id) => {
	test("the headquarters board shows assigned work, backlog, notes, team posts, and hands a goal to a person", {
		timeout: 60_000,
	}, async () => {
		const text = manifest(id).text;
		const { page, errors } = await openWorld(id);
		try {
			const [x, y, w, h] = board(id).rect;
			await menuFor(page, [x + w / 2, y + h / 2]);
			await page.getByRole("menuitem", { name: text["task-board"] }).click();
			let dialog = page.getByRole("dialog", { name: text["task-board"] });
			await dialog.waitFor({ timeout: 5000 });
			expect(await dialog.getByRole("button").allTextContents()).toEqual(
				expect.arrayContaining([
					expect.stringContaining("Fix login"),
					expect.stringContaining("Write the guide"),
					expect.stringContaining("Check the empty invoice"),
				]),
			);
			await shot(page, `aw-workplace-${id}-board`);
			await dialog.getByRole("button", { name: /Write the guide/ }).click();
			dialog = page.getByRole("dialog", { name: "Write the guide" });
			await dialog.locator("strong", { hasText: "the guide" }).waitFor({ timeout: 5000 });
			await dialog.getByRole("button", { name: text["carry-task"] }).click();
			await page.getByRole("complementary", { name: text["carrying-task"] }).waitFor({ timeout: 5000 });

			const docs = (await view<{ id: string; x: number; y: number }[]>(page, "figures()")).find(
				(figure) => figure.id === "docs",
			)!;
			await menuFor(page, [docs.x, docs.y - 0.8]);
			await page.getByRole("menuitem", { name: new RegExp(`^${text["give-task"]}`) }).click();
			await vi.waitFor(
				async () =>
					expect((await calls(page)).assigned).toEqual([{ person: "docs", task: "/r/apple-pi/.ledger/write-guide" }]),
				{ timeout: 10000 },
			);
			await page
				.getByText(text["task-given"].replace("{name}", "Docs").replace("{title}", "Write the guide"))
				.first()
				.waitFor({ timeout: 5000 });

			await menuFor(page, [x + w / 2, y + h / 2]);
			await page.getByRole("menuitem", { name: text["team-board"] }).click();
			dialog = page.getByRole("dialog", { name: text["team-board"] });
			await dialog.getByRole("button", { name: /Orla's team/ }).click();
			await dialog.getByText("Docs are next.").waitFor({ timeout: 5000 });
			expect(await dialog.getByText("Check the empty invoice").count()).toBe(1);
			expect((await calls(page)).read).toEqual([`team:${HQ}`]);
			await shot(page, `aw-workplace-${id}-team`);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});
});

test("the meeting room door reads the agenda, and a participant is drawn inside", { timeout: 60_000 }, async () => {
	const { page, errors } = await openWorld("fantasy");
	try {
		await doorMenu(page, "Archway to the gallery");
		await page.getByRole("menuitem", { name: /^Enter/ }).click();
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe(`gallery:${HQ}`), { timeout: 10000 });
		await page.waitForTimeout(500);
		await doorMenu(page, "Council room");
		await page.getByRole("menuitem", { name: "Council agenda" }).click();
		const dialog = page.getByRole("dialog", { name: "Council agenda" });
		await dialog.getByRole("button", { name: /Release decision/ }).click();
		await dialog.getByText("Can we release?").waitFor({ timeout: 5000 });
		await dialog.getByRole("button", { name: "Close" }).click();
		await doorMenu(page, "Council room");
		await page.getByRole("menuitem", { name: /^Enter/ }).click();
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe(`meeting-room:${HQ}`), { timeout: 10000 });
		expect(await view(page, "characters()")).toEqual(["Tests"]);
		await shot(page, "aw-workplace-meeting");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
