import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, ThemeChoice, WorldSnapshot } from "../src/world.js";

// The headquarters' notepad, in the committed, built world UI in headless Chrome over a fixture backend: the board opens
// the coordinator's notes, typing saves them, asking for an update puts a marker at the cursor and mails the agent to
// replace it, a selection goes to an agent as mail, and a change on disk loads (or, under unsaved edits, asks).
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-notes-<theme>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const PACKS = ["fantasy", "tech-office", "anime-school"] as const;
const manifest = (id: string) =>
	JSON.parse(readFileSync(join(appDir, "themes", id, "theme.json"), "utf8")) as {
		name: string;
		text: Record<string, string>;
	};
const board = (id: string) =>
	(
		JSON.parse(readFileSync(join(appDir, "themes", id, "places", "headquarters.json"), "utf8")) as {
			furniture: { name: string; rect: [number, number, number, number]; use: string }[];
		}
	).furniture.find((piece) => piece.use === "notes")!;
const PATH = "/r/orla/NOTES.md";

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

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
		cwd: "/r/apple-pi",
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
	facts: facts({ reportsTo: null, tmux: { socket: "/tmp/tmux", pane: "%1", session: "home", window: 1 } }),
};
// A repository with a long path, so the recruit form's select has a long option to fit.
const LONG = "/Users/operator/code_projects/personal/a-repository-with-a-rather-long-name-indeed";
const WANDERER: Character = {
	id: "wanderer",
	name: "wanderer",
	role: "independent",
	place: { kind: "square" },
	startedAt: NOW - 7_000_000,
	facts: facts({ reportsTo: null, git: { repository: LONG, worktree: LONG, branch: "main" }, cwd: LONG }),
};
const world = (theme: string): WorldSnapshot => ({
	connected: true,
	theme,
	headquarters: [
		{
			id: HQ,
			name: "Orla",
			wings: [
				{ repository: "/r/apple-pi", name: "apple-pi", headcount: 0 },
				{ repository: "/r/handbook", name: "handbook", headcount: 0 },
			],
		},
	],
	characters: [ORLA, WANDERER],
	dormant: [],
	mail: [],
});

const good = (id: string, name: string): ThemeChoice => ({ id, name, description: null, problems: [] });

/**
 * Open the world over a fixture backend. `window.notes` holds the file's text (`disk`), each save, and each mail;
 * `window.diskChange(text)` changes the file as an agent would.
 */
async function openWorld(theme: string, size: readonly [number, number] = [1280, 800]) {
	const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
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
	const themes = PACKS.map((id) => good(id, manifest(id).name));
	await page.addInitScript(
		([snapshot, themes]) => {
			const listeners = new Set<(s: unknown) => void>();
			const current = snapshot as any;
			const w = window as any;
			w.notes = { disk: "", saves: [], mails: [] };
			const notepadListeners = new Set<(change: unknown) => void>();
			w.diskChange = (text: string) => {
				w.notes.disk = text;
				for (const listener of notepadListeners) listener({ coordinatorId: "orla", text });
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
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
				setAvatarLook: async () => ({ ok: true }),
				themes: async () => themes,
				setTheme: async () => ({ ok: true }),
				instruct: async () => ({ ok: true }),
				onReceipt: () => () => {},
				watchReplies: async () => {},
				onReply: () => () => {},
				wake: async () => ({ ok: true, stage: "applied" }),
				endSession: async () => ({ ok: true, stage: "applied" }),
				async sendMail(characterId: string, body: string) {
					w.notes.mails.push({ characterId, body });
					return { ok: true, stage: "applied" };
				},
				recruit: async () => ({ ok: true, stage: "applied", sessionId: "new-1" }),
				rename: async () => ({ ok: true, stage: "applied" }),
				openNotepad: async () => ({ ok: true, path: "/r/orla/NOTES.md", text: w.notes.disk }),
				async saveNotepad(_id: string, text: string, base: string) {
					if (base !== w.notes.disk) return { ok: false, reason: "The notes changed on disk.", changed: w.notes.disk };
					w.notes.saves.push(text);
					w.notes.disk = text;
					return { ok: true };
				},
				closeNotepad: async () => {},
				onNotepad(listener: (change: unknown) => void) {
					notepadListeners.add(listener);
					return () => notepadListeners.delete(listener);
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
	await page.waitForTimeout(500); // the arrival fade
	return { page, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const notes = (page: Page) =>
	page.evaluate(() => (window as any).notes) as Promise<{
		disk: string;
		saves: string[];
		mails: { characterId: string; body: string }[];
	}>;
const clickThrough = (page: Page) =>
	page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
const clickable = (page: Page) =>
	page.addStyleTag({ content: ".aw-places, .aw-places * { pointer-events: auto !important; }" });
const menuItems = (page: Page) => page.locator(".pointer-menu [role=menuitem]").allTextContents();

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Right-click the coordinator in the world. */
async function rightClickOrla(page: Page) {
	const orla = (await view<{ id: string; x: number; y: number }[]>(page, "figures()")).find((f) => f.id === HQ)!;
	const [ox, oy] = await screen(page, orla.x, orla.y - 0.8);
	await page.mouse.click(ox, oy, { button: "right" });
}

describe.each(PACKS)("%s", (id) => {
	test("the board opens the coordinator's notes; agents are asked to update them and sent a selection", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(id);
		try {
			await clickThrough(page);
			const { rect, name } = board(id);
			const [bx, by] = await screen(page, rect[0] + rect[2] / 2, rect[1] + rect[3] / 2);
			await page.mouse.click(bx, by, { button: "right" });
			expect(await menuItems(page)).toEqual(expect.arrayContaining(["Read the notes"]));
			await page.getByRole("menuitem", { name: "Read the notes" }).click();
			await clickable(page);
			const dialog = page.getByRole("dialog", { name: "Orla's notes" });
			await dialog.waitFor({ timeout: 5000 });
			expect(await dialog.locator(".aw-place-says").textContent()).toBe(PATH);
			expect(name).toBeTruthy();

			// Typing saves once it pauses.
			const area = dialog.getByLabel("Notes");
			await area.fill("Plan for the week\n");
			await vi.waitFor(async () => expect((await notes(page)).disk).toBe("Plan for the week\n"), { timeout: 5000 });
			await dialog.getByText("Saved", { exact: true }).waitFor({ timeout: 3000 });

			// Asking for an update puts a marker at the cursor and mails the coordinator (first) to replace it.
			await area.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
			await dialog.getByRole("button", { name: "Ask an agent to add an update here" }).click();
			const marker = (await area.inputValue()).match(/<!-- update pending: [a-z0-9]+ -->/)?.[0];
			expect(marker).toBeTruthy();
			expect(await area.inputValue()).toBe(`Plan for the week\n${marker}`);
			expect(await dialog.getByLabel("Agent", { exact: true }).inputValue()).toBe(HQ);
			const ask = dialog.getByRole("button", { name: "Ask", exact: true });
			expect(await ask.isDisabled()).toBe(true);
			await dialog.getByLabel("What to write").fill("what each worker is doing now");
			await shot(page, `aw-notes-${id}-ask`);
			await ask.click();
			await dialog.getByText("Delivered to Orla.").waitFor({ timeout: 5000 });
			const [asked] = (await notes(page)).mails;
			expect(asked.characterId).toBe(HQ);
			expect(asked.body).toContain(PATH);
			expect(asked.body).toContain(`Replace the line \`${marker}\` with: what each worker is doing now`);
			await vi.waitFor(async () => expect((await notes(page)).disk).toContain(marker!), { timeout: 5000 });
			await dialog.getByRole("button", { name: "Done" }).click();

			// The agent replaces the marker on disk: the notes show it at once.
			await page.evaluate(() => (window as any).diskChange("Plan for the week\nAda: docs; Bo: tests"));
			await vi.waitFor(async () => expect(await area.inputValue()).toBe("Plan for the week\nAda: docs; Bo: tests"), {
				timeout: 3000,
			});

			// A selection goes to any awake agent as quoted mail.
			await area.evaluate((el: HTMLTextAreaElement) => {
				el.focus();
				el.setSelectionRange(18, 18);
			});
			await page.keyboard.press("Shift+End");
			await dialog.getByRole("button", { name: "Send selection to an agent" }).click();
			await dialog.getByLabel("Agent", { exact: true }).selectOption("wanderer");
			await dialog.getByLabel("Note to the agent").fill("Check these two.");
			await dialog.getByRole("button", { name: "Send", exact: true }).click();
			await dialog.getByText("Delivered to wanderer.").waitFor({ timeout: 5000 });
			expect((await notes(page)).mails[1]).toEqual({
				characterId: "wanderer",
				body: `Check these two.\n\nFrom my notepad (${PATH}):\n\n> Ada: docs; Bo: tests`,
			});
			await dialog.getByRole("button", { name: "Done" }).click();
			await shot(page, `aw-notes-${id}-notes`);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test("a change on disk under unsaved edits asks which to keep", { timeout: 60_000 }, async () => {
		const { page, errors } = await openWorld(id);
		try {
			await clickThrough(page);
			await rightClickOrla(page);
			await page.getByRole("menuitem", { name: "Read the notes of Orla" }).click();
			await clickable(page);
			const dialog = page.getByRole("dialog", { name: "Orla's notes" });
			const area = dialog.getByLabel("Notes");
			await area.fill("mine");
			await page.evaluate(() => (window as any).diskChange("theirs"));
			await dialog.getByText("The notes changed on disk while you were typing.").waitFor({ timeout: 3000 });
			await page.waitForTimeout(800);
			expect((await notes(page)).disk).toBe("theirs");
			await shot(page, `aw-notes-${id}-changed`);
			await dialog.getByRole("button", { name: "Keep mine" }).click();
			await vi.waitFor(async () => expect((await notes(page)).disk).toBe("mine"), { timeout: 5000 });

			await area.fill("mine again");
			await page.evaluate(() => (window as any).diskChange("theirs again"));
			await dialog.getByRole("button", { name: "Load the file" }).click();
			expect(await area.inputValue()).toBe("theirs again");
			await page.waitForTimeout(800);
			expect((await notes(page)).disk).toBe("theirs again");
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});
});
