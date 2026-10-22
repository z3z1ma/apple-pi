import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, ThemeChoice, WorldSnapshot } from "../src/world.js";

// Seam 2 for ticket 12: the committed, built world UI in headless Chrome over a fixture backend. Renaming an agent from
// its right-click menu or its side-panel row opens a small form with its current name; saving sends `rename` and shows
// the receipt, and the new name is on the figure, the side panel, and the conversation panel; a blank name sends
// nothing. The recruiting form's fields stay inside it at every window size, in every pack.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-12-<theme>-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const PACKS = ["fantasy", "tech-office", "anime-school"] as const;
const SIZES = [
	[1024, 680],
	[1280, 800],
	[1680, 1050],
] as const;
const manifest = (id: string) =>
	JSON.parse(readFileSync(join(appDir, "themes", id, "theme.json"), "utf8")) as {
		name: string;
		labels: Record<string, string>;
		text: Record<string, string>;
	};

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
	facts: facts({
		reportsTo: null,
		git: { repository: LONG, worktree: LONG, branch: "main" },
		cwd: LONG,
		title: "Technical Writer",
	}),
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

/** Open the world over a fixture backend; `window.renames` records each rename it was asked for. */
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
			let current = snapshot as any;
			const w = window as any;
			w.renames = [];
			w.retirements = [];
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
				recruit: async () => ({ ok: true, stage: "applied", sessionId: "new-1" }),
				roles: async () => [],
				async retire(characterId: string, reason: string) {
					w.retirements.push({ characterId, reason });
					await new Promise((resolve) => setTimeout(resolve, 200));
					// The runtime applied it, and the session closed: the person sleeps at the inn as a former member.
					const gone = current.characters.find((c: any) => c.id === characterId);
					push({
						...current,
						characters: current.characters.filter((c: any) => c.id !== characterId),
						dormant: [
							...current.dormant,
							{
								id: gone.id,
								name: gone.name,
								role: gone.role,
								title: gone.facts.title,
								reportsTo: null,
								repository: null,
								cwd: gone.facts.cwd,
								task: null,
								stoppedAt: Date.now(),
								stopReason: "retired",
								retiredAt: Date.now(),
								retiredReason: reason,
								startedAt: gone.startedAt,
							},
						],
					});
					return { ok: true, stage: "applied" };
				},
				async rename(characterId: string, name: string) {
					w.renames.push({ characterId, name });
					await new Promise((resolve) => setTimeout(resolve, 200));
					// The bridge applied it: the session's name is the character's.
					push({
						...current,
						characters: current.characters.map((c: any) => (c.id === characterId ? { ...c, name } : c)),
					});
					return { ok: true, stage: "applied" };
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
const renames = (page: Page) => page.evaluate(() => (window as any).renames) as Promise<unknown[]>;
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
	const say = (key: string, values: Record<string, string> = {}) =>
		manifest(id).text[key].replace(/\{([a-z-]+)\}/g, (whole, k: string) => values[k] ?? whole);

	test("Rename from the world's menu sends rename with the receipt; the new name is on the figure, the side panel, and the conversation", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(id);
		try {
			await clickThrough(page);
			await rightClickOrla(page);
			expect(await menuItems(page)).toEqual(expect.arrayContaining(["Rename Orla"]));
			await page.getByRole("menuitem", { name: "Rename Orla" }).click();
			await clickable(page);
			const form = page.getByRole("dialog", { name: "Rename Orla" });
			await form.waitFor({ timeout: 5000 });
			const name = form.getByLabel("Name");
			expect(await name.inputValue()).toBe("Orla");
			const save = form.getByRole("button", { name: "Rename", exact: true });

			// A blank name is refused: the button rests, and Enter sends nothing.
			await name.fill("   ");
			expect(await save.isDisabled()).toBe(true);
			await name.press("Enter");
			await page.waitForTimeout(300);
			expect(await renames(page)).toEqual([]);

			await name.fill("Juno");
			await shot(page, `aw-12-${id}-rename-form`);
			await save.click();
			await form.getByText("Orla is now called Juno.").waitFor({ timeout: 5000 });
			expect(await renames(page)).toEqual([{ characterId: HQ, name: "Juno" }]);
			await shot(page, `aw-12-${id}-rename-receipt`);
			await form.getByRole("button", { name: "Close", exact: true }).last().click();
			await form.waitFor({ state: "detached", timeout: 3000 });

			// The figure, the side panel's row, and the conversation panel all say Juno.
			await vi.waitFor(async () => expect(await view(page, "characters()")).toContain("Juno"), { timeout: 3000 });
			expect(await view(page, "characters()")).not.toContain("Orla");
			const rows = await page.locator(".aw-row-name").allTextContents();
			expect(rows).toContain("Juno");
			expect(rows).not.toContain("Orla");
			await page.getByRole("button", { name: /^Juno/ }).first().dispatchEvent("click");
			await page.getByRole("button", { name: "Talk to Juno" }).dispatchEvent("click");
			const book = page.getByRole("dialog", { name: "Conversation with Juno" });
			await book.waitFor({ timeout: 5000 });
			expect(await book.locator(".aw-conv-title").textContent()).toBe("Juno");
			await page.keyboard.press("Escape");
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test("Rename from the side panel's row opens the same form; a failed rename says why", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(id);
		try {
			await page.evaluate(() => {
				(window as any).agentWorld.rename = async (characterId: string, name: string) => {
					(window as any).renames.push({ characterId, name });
					return { ok: false, reason: "That session is not running." };
				};
			});
			await page
				.getByRole("button", { name: /^wanderer/ })
				.first()
				.click();
			const actions = page.getByRole("group", { name: "Actions on wanderer" });
			await shot(page, `aw-12-${id}-row-actions`);
			await actions.getByRole("button", { name: "Rename wanderer" }).click();
			const form = page.getByRole("dialog", { name: "Rename wanderer" });
			await form.waitFor({ timeout: 5000 });
			expect(await form.getByLabel("Name").inputValue()).toBe("wanderer");
			await form.getByLabel("Name").fill("Scout");
			await form.getByLabel("Name").press("Enter");
			await form.getByText("That session is not running.").waitFor({ timeout: 5000 });
			expect(await renames(page)).toEqual([{ characterId: "wanderer", name: "Scout" }]);
			await shot(page, `aw-12-${id}-rename-failed`);
			// Try again goes back to the form with the name as typed.
			await form.getByRole("button", { name: "Try again" }).click();
			expect(await form.getByLabel("Name").inputValue()).toBe("Scout");
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test("a person with a role retires from its row, in the theme's words, with a reason; it then sleeps at the inn marked so", {
		timeout: 60_000,
	}, async () => {
		const { page, errors } = await openWorld(id);
		try {
			await page
				.getByRole("button", { name: /^wanderer/ })
				.first()
				.click();
			const actions = page.getByRole("group", { name: "Actions on wanderer" });
			const retire = actions.getByRole("button", { name: "Retire wanderer" });
			expect(await retire.textContent()).toBe(say("retire"));
			await retire.click();
			const form = page.getByRole("dialog", { name: say("retire-title", { name: "wanderer" }) });
			await form.waitFor({ timeout: 5000 });
			expect(await form.getByLabel("Reason").getAttribute("placeholder")).toBe(say("retire-reason"));
			const send = form.getByRole("button", { name: say("retire-send"), exact: true });
			expect(await send.isDisabled()).toBe(true);
			await form.getByLabel("Reason").fill("The survey is written.");
			await shot(page, `aw-12-${id}-retire-form`);
			await send.click();
			await form.getByText(say("retire-done", { name: "wanderer" })).waitFor({ timeout: 5000 });
			expect(await page.evaluate(() => (window as any).retirements)).toEqual([
				{ characterId: "wanderer", reason: "The survey is written." },
			]);
			await form.getByRole("button", { name: "Close", exact: true }).last().click();
			// Gone from the world; the inn's register marks it a former member.
			await vi.waitFor(async () => expect(await page.getByRole("button", { name: /^wanderer/ }).count()).toBe(0));
			await page.getByRole("tab", { name: "Places", exact: true }).click();
			await page.getByTitle(`Travel to ${manifest(id).labels.inn}`, { exact: true }).click();
			await vi.waitFor(async () => expect(await view(page, "place()")).toBe("inn"), { timeout: 8000 });
			await page.getByRole("tab", { name: "Places", exact: true }).click();
			await page.waitForTimeout(600);
			await clickThrough(page);
			const host = JSON.parse(readFileSync(join(appDir, "themes", id, "places", "inn.json"), "utf8")).host.at;
			const [hx, hy] = await screen(page, host[0], host[1] - 1.2);
			await page.mouse.click(hx, hy);
			await clickable(page);
			const register = page.getByRole("dialog", { name: say("register-title") });
			await register.waitFor({ timeout: 15_000 });
			const row = register.getByRole("listitem").first();
			expect(await row.textContent()).toContain("wanderer");
			expect(await row.textContent()).toContain("Technical Writer");
			expect(await row.textContent()).toContain(`${say("retired")}: The survey is written.`);
			await shot(page, `aw-12-${id}-former-member`);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});

	test.each(SIZES)("every field of the recruit form fits inside it at %ix%i", { timeout: 60_000 }, async (w, h) => {
		const { page, errors } = await openWorld(id, [w, h]);
		try {
			await clickThrough(page);
			await rightClickOrla(page);
			await page.getByRole("menuitem", { name: say("recruit-worker") }).click();
			await clickable(page);
			const form = page.getByRole("dialog", { name: say("recruit-worker-title", { coordinator: "Orla" }) });
			await form.waitFor({ timeout: 25_000 });
			// The longest option chosen, then a typed directory: every field shows.
			await form.getByLabel("Repository").selectOption(LONG);
			await form.getByLabel("Name").fill("a-very-long-name-for-an-agent-that-goes-on-and-on");
			await form.getByLabel("Repository").selectOption("");
			await form.getByLabel("Directory").fill(`${LONG}/and/deeper/still/than/that`);
			const boxes = await form.evaluate((dialog) => {
				const box = (el: Element) => {
					const r = el.getBoundingClientRect();
					return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
				};
				const body = dialog.querySelector(".aw-place-body")!;
				const inner = box(body);
				const style = getComputedStyle(body);
				inner.left += Number.parseFloat(style.paddingLeft);
				inner.right -= Number.parseFloat(style.paddingRight);
				return {
					dialog: box(dialog),
					body: inner,
					form: box(dialog.querySelector(".aw-recruit-form")!),
					fields: [
						...dialog.querySelectorAll(".aw-recruit-form input, .aw-recruit-form select, .aw-recruit-form textarea"),
					].map((field) => ({ label: field.getAttribute("aria-label"), ...box(field) })),
					scrollsSideways: body.scrollWidth > body.clientWidth,
				};
			});
			await shot(page, `aw-12-${id}-recruit-${w}x${h}`);
			expect(boxes.fields.map((field) => field.label)).toEqual([
				"Name",
				say("recruit-role"),
				"Repository",
				"Directory",
				"Goal",
			]);
			expect(boxes.scrollsSideways).toBe(false);
			expect(boxes.dialog.left).toBeGreaterThanOrEqual(0);
			expect(boxes.dialog.right).toBeLessThanOrEqual(w);
			expect(boxes.form.left).toBeGreaterThanOrEqual(boxes.body.left - 0.5);
			expect(boxes.form.right).toBeLessThanOrEqual(boxes.body.right + 0.5);
			for (const field of boxes.fields) {
				expect(field.left, field.label!).toBeGreaterThanOrEqual(boxes.form.left - 0.5);
				expect(field.right, field.label!).toBeLessThanOrEqual(boxes.form.right + 0.5);
			}
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});
});
