import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import { loadRoleChoices } from "../src/backend/roles.js";
import type { Character, CharacterFacts, ThemeChoice, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for recruiting (ticket 10): the committed, built world UI in headless Chrome over a fixture backend that
// records each recruit and answers with a receipt, then pushes the snapshot with the new agent in it. In every pack,
// the coordinator's desk (and the coordinator) recruits a worker for that coordinator, and the square's recruiter an
// independent agent, each in the theme's own words; the form offers the package's role catalog with each mandate.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-10-<theme>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const PACKS = ["fantasy", "tech-office", "anime-school"] as const;
const pack = (id: string) => ({
	manifest: JSON.parse(readFileSync(join(appDir, "themes", id, "theme.json"), "utf8")) as {
		name: string;
		labels: Record<string, string>;
		text: Record<string, string>;
	},
	place: (name: string): PlaceData =>
		JSON.parse(readFileSync(join(appDir, "themes", id, "places", `${name}.json`), "utf8")),
});
const fill = (line: string, values: Record<string, string>) =>
	line.replace(/\{([a-z-]+)\}/g, (whole, key: string) => values[key] ?? whole);

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
const WANDERER: Character = {
	id: "wanderer",
	name: "wanderer",
	role: "independent",
	place: { kind: "square" },
	startedAt: NOW - 7_000_000,
	facts: facts({
		reportsTo: null,
		git: { repository: "/r/notes", worktree: "/r/notes", branch: "main" },
		cwd: "/r/notes",
	}),
};
const world = (theme: string, more: Character[] = []): WorldSnapshot => ({
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
	characters: [ORLA, WANDERER, ...more],
	dormant: [],
	mail: [],
});

const good = (id: string, name: string): ThemeChoice => ({ id, name, description: null, problems: [] });
/** The package's catalog, as the backend reads it (no user roles: a directory with none). */
const ROLES = loadRoleChoices("/nonexistent");

/** Open the world over a fixture backend; `window.recruits` records each recruit it was asked for. */
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
	const themes = PACKS.map((id) => good(id, pack(id).manifest.name));
	await page.addInitScript(
		([snapshot, themes, roles]) => {
			const listeners = new Set<(s: unknown) => void>();
			let current = snapshot as any;
			const w = window as any;
			w.recruits = [];
			let made = 0;
			const push = (next: unknown) => {
				current = next;
				for (const listener of listeners) listener(next);
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
				sendMail: async () => ({ ok: true, stage: "applied" }),
				roles: async () => roles,
				async recruit(request: any) {
					w.recruits.push(request);
					const sessionId = `new-${++made}`;
					await new Promise((resolve) => setTimeout(resolve, 300));
					// The runtime's bridge connects: the new session joins the world.
					const character = {
						id: sessionId,
						name: request.name,
						role: request.reportsTo ? "worker" : "independent",
						place: request.reportsTo
							? { kind: "wing", headquarters: request.reportsTo, repository: request.cwd }
							: { kind: "square" },
						startedAt: Date.now(),
						facts: {
							...current.characters[0].facts,
							reportsTo: request.reportsTo ?? null,
							cwd: request.cwd,
							title: (roles as any[]).find((role) => role.name === request.role)?.title ?? null,
						},
					};
					push({ ...current, characters: [...current.characters, character] });
					return { ok: true, stage: "applied", sessionId };
				},
			};
		},
		[world(theme), themes, ROLES] as const,
	);
	await page.goto(`${ORIGIN}/index.html?world`);
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
const recruits = (page: Page) => page.evaluate(() => (window as any).recruits) as Promise<unknown[]>;
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

describe.each(PACKS)("%s", (id) => {
	const { manifest, place } = pack(id);
	const say = (key: string, values: Record<string, string> = {}) => fill(manifest.text[key], values);

	test("the coordinator's desk recruits a worker who reports to it, in the theme's words", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(id);
		try {
			expect(await view(page, "place()")).toBe(`headquarters:${HQ}`);
			// The coordinator itself offers to recruit; so does its desk, beside it.
			await clickThrough(page);
			const orla = (await view<{ id: string; x: number; y: number }[]>(page, "figures()")).find((f) => f.id === HQ)!;
			const [ox, oy] = await screen(page, orla.x, orla.y - 0.8);
			await page.mouse.click(ox, oy, { button: "right" });
			expect(await menuItems(page)).toEqual(
				expect.arrayContaining(["Talk to Orla", "Examine Orla", say("recruit-worker")]),
			);
			await page.keyboard.press("Escape");
			// The desk's corner, clear of the coordinator standing in front of it.
			const desk = place("headquarters").furniture!.find((piece) => piece.use === "recruit")!;
			const [sx, sy] = await screen(page, desk.rect[0] + 0.4, desk.rect[1] + desk.rect[3] - 0.3);
			await page.mouse.click(sx, sy, { button: "right" });
			expect(await menuItems(page)).toEqual(expect.arrayContaining([say("recruit-worker")]));
			await page.getByRole("menuitem", { name: say("recruit-worker") }).click();
			await clickable(page);

			const title = say("recruit-worker-title", { coordinator: "Orla" });
			const form = page.getByRole("dialog", { name: title });
			await form.waitFor({ timeout: 5000 });
			expect(await form.locator(".aw-place-says").textContent()).toContain(say("recruit-worker-greeting"));
			// The repositories the world knows: the coordinator's wings, then awake agents', then any directory.
			expect(await form.getByLabel("Repository").locator("option").allTextContents()).toEqual([
				"apple-pi \u2014 /r/apple-pi",
				"handbook \u2014 /r/handbook",
				"notes \u2014 /r/notes",
				"Another directory\u2026",
			]);
			expect(await form.getByLabel("Goal").getAttribute("placeholder")).toBe(say("recruit-brief"));
			// The role: every catalog role by title, the first chosen, its mandate under the select.
			const role = form.getByLabel(say("recruit-role"));
			await vi.waitFor(async () => expect(await role.locator("option").count()).toBe(ROLES.length));
			expect(await role.locator("option").allTextContents()).toEqual(ROLES.map((offered) => offered.title));
			expect(ROLES.length).toBeGreaterThan(20);
			expect(await role.inputValue()).toBe(ROLES[0].name);
			expect(await form.locator(".aw-recruit-mandate").textContent()).toBe(ROLES[0].mandate);
			const writer = ROLES.find((offered) => offered.name === "technical-writer")!;
			await role.selectOption(writer.name);
			expect(await form.locator(".aw-recruit-mandate").textContent()).toBe(writer.mandate);
			const send = form.getByRole("button", { name: say("recruit-send"), exact: true });
			expect(await send.isDisabled()).toBe(true);
			await form.getByLabel("Name").fill("docs");
			await form.getByLabel("Repository").selectOption("/r/handbook");
			expect(await send.isDisabled()).toBe(true);
			await form.getByLabel("Goal").fill("Write the style guide.");
			await shot(page, `aw-10-${id}-worker-form`);
			await send.click();
			await form.getByText(say("recruit-joined", { name: "docs" })).waitFor({ timeout: 5000 });
			expect(await recruits(page)).toEqual([
				{ name: "docs", cwd: "/r/handbook", brief: "Write the style guide.", reportsTo: HQ, role: "technical-writer" },
			]);
			await shot(page, `aw-10-${id}-worker-receipt`);

			// The new worker is in its wing: going to it walks into the wing.
			await form.getByRole("button", { name: "Go to docs" }).click();
			await vi.waitFor(async () => expect(await view(page, "place()")).toBe(`wing:${HQ}:/r/handbook`), {
				timeout: 8000,
			});
			expect(await view(page, "characters()")).toContain("docs");

			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test("the square's recruiter recruits an independent agent, who walks into the square", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(id);
		try {
			await page.getByRole("tab", { name: "Places", exact: true }).click();
			await page.getByTitle(`Travel to ${manifest.labels.square}`, { exact: true }).click();
			await vi.waitFor(async () => expect(await view(page, "place()")).toBe("square"), { timeout: 8000 });
			// Fold the side panel, and zoom out as far as the wheel goes, so the whole square shows.
			await page.getByRole("tab", { name: "Places", exact: true }).click();
			await page.mouse.move(640, 300);
			for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
			await page.waitForTimeout(1000);
			const at = place("square").recruiter!.at;
			const recruiter = await view<{ name: string; look: string; x: number; y: number }>(page, "recruiter()");
			expect(recruiter).toMatchObject({ name: manifest.labels.recruiter, x: at[0], y: at[1] });
			await shot(page, `aw-10-${id}-square`);

			await clickThrough(page);
			const [rx, ry] = await screen(page, at[0], at[1] - 0.8);
			await page.mouse.click(rx, ry, { button: "right" });
			expect(await menuItems(page)).toEqual(
				expect.arrayContaining([`Talk to ${manifest.labels.recruiter}`, say("recruit-independent")]),
			);
			await page.getByRole("menuitem", { name: `Talk to ${manifest.labels.recruiter}` }).click();
			await clickable(page);
			// The avatar walks across the square to the booth first.
			const form = page.getByRole("dialog", { name: say("recruit-independent-title") });
			await form.waitFor({ timeout: 25_000 });
			expect(await form.locator(".aw-place-says").textContent()).toContain(say("recruit-independent-greeting"));
			await form.getByLabel("Name").fill("scout");
			// At the square the role may be none, and is by default.
			const role = form.getByLabel(say("recruit-role"));
			await vi.waitFor(async () => expect(await role.locator("option").count()).toBe(ROLES.length + 1));
			expect((await role.locator("option").allTextContents())[0]).toBe(say("recruit-no-role"));
			expect(await role.inputValue()).toBe("");
			await form.getByLabel("Repository").selectOption("");
			await form.getByLabel("Directory").fill("~/code/scratch");
			await form.getByLabel("Goal").fill("Look around.");
			await shot(page, `aw-10-${id}-independent-form`);
			await form.getByRole("button", { name: say("recruit-send"), exact: true }).click();
			await form.getByText(say("recruit-joined", { name: "scout" })).waitFor({ timeout: 5000 });
			expect(await recruits(page)).toEqual([{ name: "scout", cwd: "~/code/scratch", brief: "Look around." }]);
			await form
				.getByRole("button", { name: "Close" })
				.or(form.getByRole("button", { name: "Go to scout" }))
				.first()
				.waitFor();

			// Closed, the square shows the new agent walking in from its door.
			await page.keyboard.press("Escape");
			await vi.waitFor(async () => expect(await view(page, "characters()")).toContain("scout"), { timeout: 5000 });
			await page.waitForTimeout(500);
			await shot(page, `aw-10-${id}-arrives`);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});
});
