import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, DormantAgent, WorldSnapshot } from "../src/world.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const ROOT = "/fixture/lifecycle";
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

function awake(id: string, name: string, reportsTo: string | null, busy = false): Character {
	return {
		id,
		name,
		role: "coordinator",
		place: { kind: "headquarters", headquarters: "ada" },
		startedAt: 1000,
		facts: {
			run: busy ? "thinking" : "idle",
			status: busy ? "working" : "idle",
			asking: null,
			needsYouSince: null,
			unseen: false,
			seenAt: null,
			settledAt: null,
			tool: null,
			task: null,
			git: null,
			cwd: ROOT,
			reportsTo,
			title: "Coordinator",
			model: null,
			contextTokens: null,
			contextWindow: null,
			cost: 0,
			tmux: null,
		},
	};
}
function asleep(id: string, name: string, reportsTo: string): DormantAgent {
	return {
		id,
		name,
		reportsTo,
		role: "coordinator",
		title: "Coordinator",
		cwd: ROOT,
		repository: ROOT,
		task: null,
		stoppedAt: 2000,
		stopReason: "exited",
		startedAt: 1000,
	};
}
function world(): WorldSnapshot {
	return {
		connected: true,
		headquarters: [{ id: "ada", name: "Ada", wings: [] }],
		characters: [
			awake("ada", "Ada", null, true),
			awake("ben", "Ben", "ada"),
			{
				...awake("temporary", "Temporary peer", "ada"),
				facts: { ...awake("temporary", "Temporary peer", "ada").facts!, temporary: true },
			},
		],
		dormant: [
			asleep("daria", "Daria", "ada"),
			asleep("bea", "Bea", "daria"),
			asleep("cleo", "Cleo", "bea"),
			asleep("erin", "Erin", "cleo"),
			asleep("mina", "Mina", "ada"),
			{ ...asleep("former", "Former", "ada"), retiredAt: 3000, retiredReason: "Left the organization" },
		],
		mail: [],
		operatorMail: [],
		workplace: { threads: [], tasks: [], workHistory: [], escalations: [] },
	};
}

async function openLifecycle(appearance: "light" | "dark" = "light", width = 1440, snapshot = world()) {
	const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: "light" });
	page.setDefaultTimeout(5000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("dialog", (dialog) => void dialog.dismiss());
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(APP, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript((initial) => {
		const w = window as any;
		let current = initial;
		const listeners = new Set<(snapshot: WorldSnapshot) => void>();
		w.lifecycleCalls = {
			home: [],
			retire: [],
			callIn: [],
			wake: [],
			profiles: [],
			conversations: [],
			tasks: [],
			seen: [],
		};
		w.pushLifecycle = (snapshot: WorldSnapshot) => {
			current = structuredClone(snapshot);
			for (const listener of listeners) listener(current);
		};
		const held = (kind: string, value: unknown) => {
			w.lifecycleCalls[kind].push(structuredClone(value));
			return new Promise((resolve, reject) => {
				w.releaseLifecycle = resolve;
				w.rejectLifecycle = reject;
			});
		};
		w.agentWorld = {
			snapshot: async () => current,
			onUpdate: (listener: (snapshot: WorldSnapshot) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			feed: async () => [],
			onFeed: () => () => {},
			onReceipt: () => () => {},
			onReply: () => () => {},
			onOrgStart: () => () => {},
			onNotepad: () => () => {},
			watchReplies: async () => {},
			conversation: async (id: string) => {
				w.lifecycleCalls.conversations.push(id);
				return { ok: true, entries: [], before: null, missing: 0 };
			},
			markSeen: async (id: string) => {
				w.lifecycleCalls.seen.push(id);
				return { ok: true };
			},
			profile: async (id: string) => {
				w.lifecycleCalls.profiles.push(id);
				return { ok: true, self: "# Practice\nKeep work explicit." };
			},
			readTask: async (id: string) => {
				w.lifecycleCalls.tasks.push(id);
				return { ok: true, body: "Task body" };
			},
			roles: async () => [
				{
					name: "coordinator",
					title: "Coordinator",
					mandate: "Coordinate concrete work.",
					manages: true,
					writes: false,
				},
			],
			endSession: (person: string, confirmed?: boolean) => held("home", { person, confirmed }),
			retire: (person: string, reason: string) => held("retire", { person, reason }),
			callIn: (request: unknown) => held("callIn", request),
			wake: (person: string) => held("wake", person),
		};
	}, snapshot);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Org", exact: true }).waitFor();
	if (appearance === "dark") await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
	return { page, errors };
}
async function calls(page: Page) {
	return page.evaluate(() => (window as any).lifecycleCalls);
}
async function publish(page: Page, snapshot: WorldSnapshot) {
	await page.evaluate((next) => (window as any).pushLifecycle(next), snapshot);
}
async function release(page: Page, result: unknown) {
	await page.evaluate((value) => (window as any).releaseLifecycle(value), result);
}
async function painted(page: Page) {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
}
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await painted(page);
	await page.screenshot({ path: join(SHOTS, `aw-lifecycle-${name}.png`), animations: "disabled" });
}
async function bounded(page: Page, target: Locator) {
	const box = await target.boundingBox();
	expect(box).not.toBeNull();
	const viewport = page.viewportSize()!;
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}
async function orgCard(page: Page, name: string) {
	await page.getByRole("button", { name: "Org", exact: true }).click();
	await page.getByRole("button", { name: "Open team: Ada", exact: true }).click();
	return page.getByRole("button", { name: `View profile: ${name}`, exact: true });
}
async function sleeperDM(page: Page, name: string) {
	await page.getByText(/^Sleeping agents \(/).click();
	await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

test("VIPs group four lasting people including nested sleepers without duplicating rows or disturbing a DM draft", async () => {
	const initial: WorldSnapshot = {
		...world(),
		headquarters: [
			{ id: "ada", name: "Ada", wings: [] },
			{ id: "daria", name: "Daria", wings: [] },
		],
		characters: [
			awake("ada", "Ada", null),
			awake("ben", "Ben", "ada"),
			awake("ellis", "Ellis", "daria"),
			{
				...awake("temporary", "Temporary peer", "ada"),
				facts: { ...awake("temporary", "Temporary peer", "ada").facts!, temporary: true },
			},
		],
		dormant: [
			asleep("cleo", "Cleo", "ben"),
			{ ...asleep("daria", "Daria", ""), reportsTo: null },
			asleep("fern", "Fern", "ellis"),
			asleep("gina", "Gina", "fern"),
			{ ...asleep("temporary-home", "Temporary sleeper", "ada"), temporary: true },
			{ ...asleep("former", "Former", "ada"), retiredAt: 3000, retiredReason: "Left" },
		],
	};
	const { page, errors } = await openLifecycle("light", 1440, initial);
	try {
		const sidebar = page.locator(".wp-chat-sidebar");
		const headSection = sidebar.getByRole("region", { name: "VIPs", exact: true });
		const heads = headSection.getByRole("heading", { name: /^VIPs/ });
		const direct = sidebar.getByRole("heading", { name: /^Direct messages/ });
		const channels = sidebar.getByRole("heading", { name: /^Channels/ });
		const ada = sidebar.getByRole("button", { name: /^Ada/ });
		const daria = sidebar.getByRole("button", { name: /^Daria/ });
		await heads.waitFor();
		await painted(page);
		expect(await headSection.getByRole("button", { name: /^Ada/ }).count()).toBe(0);
		expect(await headSection.getByRole("button", { name: /^Daria/ }).count()).toBe(1);
		expect((await channels.boundingBox())!.y).toBeLessThan((await heads.boundingBox())!.y);
		expect((await heads.boundingBox())!.y).toBeLessThan((await direct.boundingBox())!.y);
		expect((await ada.boundingBox())!.y).toBeGreaterThan((await direct.boundingBox())!.y);
		expect((await daria.boundingBox())!.y).toBeGreaterThan((await heads.boundingBox())!.y);
		expect((await daria.boundingBox())!.y).toBeLessThan((await direct.boundingBox())!.y);
		expect(await sidebar.getByRole("button", { name: /^Daria/, includeHidden: true }).count()).toBe(1);
		expect(
			await sidebar
				.locator(".wp-sleepers")
				.getByRole("button", { name: /^Daria/, includeHidden: true })
				.count(),
		).toBe(0);
		expect((await calls(page)).conversations).toEqual([]);
		expect((await calls(page)).profiles).toEqual([]);
		expect((await calls(page)).tasks).toEqual([]);
		await ada.click();
		const draft = page.getByRole("textbox", { name: "Reply to Ada", exact: true });
		await draft.fill("Keep this draft while the sidebar groups change.");
		await painted(page);
		const beforeGroup = await calls(page);
		const grouped = structuredClone(initial);
		grouped.dormant!.push(asleep("erin", "Erin", "cleo"));
		await publish(page, grouped);
		await painted(page);
		expect(await headSection.getByRole("button", { name: /^Ada/ }).count()).toBe(1);
		expect((await ada.boundingBox())!.y).toBeGreaterThan((await heads.boundingBox())!.y);
		expect((await ada.boundingBox())!.y).toBeLessThan((await direct.boundingBox())!.y);
		expect(await sidebar.getByRole("button", { name: /^Ada/, includeHidden: true }).count()).toBe(1);
		expect(await sidebar.getByRole("button", { name: /^Daria/, includeHidden: true }).count()).toBe(1);
		expect(await ada.getAttribute("aria-pressed")).toBe("true");
		expect(await draft.inputValue()).toBe("Keep this draft while the sidebar groups change.");
		expect((await calls(page)).conversations).toEqual(beforeGroup.conversations);
		expect((await calls(page)).seen).toEqual(beforeGroup.seen);
		await bounded(page, heads);
		await bounded(page, ada);
		await bounded(page, daria);
		await shot(page, "vips-light-1440");
		await daria.click();
		await page.getByRole("heading", { name: "Daria", exact: true }).waitFor();
		await vi.waitFor(async () => expect((await calls(page)).conversations).toContain("daria"));
		expect(await daria.getAttribute("aria-pressed")).toBe("true");
		expect((await calls(page)).callIn).toEqual([]);
		expect((await calls(page)).wake).toEqual([]);
		await ada.click();
		expect(await draft.inputValue()).toBe("Keep this draft while the sidebar groups change.");
		await painted(page);
		const beforeUngroup = await calls(page);
		await publish(page, initial);
		await painted(page);
		expect((await ada.boundingBox())!.y).toBeGreaterThan((await direct.boundingBox())!.y);
		expect(await ada.getAttribute("aria-pressed")).toBe("true");
		expect(await draft.inputValue()).toBe("Keep this draft while the sidebar groups change.");
		expect(await headSection.getByRole("button", { name: /^Ada/ }).count()).toBe(0);
		expect((await calls(page)).conversations).toEqual(beforeUngroup.conversations);
		expect((await calls(page)).seen).toEqual(beforeUngroup.seen);
		await publish(page, grouped);
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await page.setViewportSize({ width: 900, height: 900 });
		await painted(page);
		await bounded(page, heads);
		await bounded(page, ada);
		await bounded(page, daria);
		await shot(page, "vips-dark-900");
		expect((await calls(page)).profiles).toEqual([]);
		expect((await calls(page)).tasks).toEqual([]);
		expect((await calls(page)).home).toEqual([]);
		expect((await calls(page)).retire).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

for (const appearance of ["light", "dark"] as const) {
	test(`${appearance}: DM lifecycle keyboard menu is anchored and home/call-in retains draft through snapshot transitions`, async () => {
		const { page, errors } = await openLifecycle(appearance, appearance === "dark" ? 900 : 1440);
		try {
			await page.getByRole("button", { name: /^Ada/ }).click();
			const draft = page.getByRole("textbox", { name: "Instruct Ada", exact: true });
			await draft.fill("Keep this instruction while Ada is home.");
			const trigger = page.getByRole("button", { name: "Person actions: Ada", exact: true });
			await trigger.focus();
			await page.keyboard.press("Enter");
			const menu = page.getByRole("menu", { name: "Actions", exact: true });
			await menu.waitFor();
			await bounded(page, menu);
			const anchor = await trigger.boundingBox();
			const popup = await menu.boundingBox();
			expect(popup!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height - 1);
			expect(popup!.y).toBeLessThanOrEqual(anchor!.y + anchor!.height + 12);
			await shot(page, `${appearance}-dm-keyboard-menu`);
			await page.keyboard.press("Escape");
			expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
			await page.keyboard.press("Space");
			await menu.getByRole("menuitem", { name: "Send home", exact: true }).click();
			const dialog = page.getByRole("dialog", { name: "Send Ada home", exact: true });
			await dialog.waitFor();
			expect(await dialog.innerText()).toMatch(/busy|working|interrupt/i);
			await bounded(page, dialog);
			expect((await calls(page)).home).toEqual([]);
			await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
			expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
			await trigger.click();
			await menu.getByRole("menuitem", { name: "Send home", exact: true }).click();
			await dialog.getByRole("button", { name: "Send home", exact: true }).click();
			await vi.waitFor(async () => expect((await calls(page)).home).toEqual([{ person: "ada", confirmed: true }]));
			await page.keyboard.press("Enter");
			await page.keyboard.press("Escape");
			expect(await dialog.isVisible()).toBe(true);
			expect((await calls(page)).home).toHaveLength(1);
			await shot(page, `${appearance}-send-home-pending`);
			await release(page, { ok: true, stage: "applied", commandId: "home-ada" });
			await dialog.getByRole("button", { name: "Close", exact: true }).click();
			const next = world();
			next.characters = next.characters.filter((person) => person.id !== "ada");
			next.dormant!.push({ ...asleep("ada", "Ada", ""), reportsTo: null });
			await publish(page, next);
			await trigger.click();
			expect(await menu.getByRole("menuitem", { name: "Send home", exact: true }).count()).toBe(0);
			await menu.getByRole("menuitem", { name: "Call in", exact: true }).click();
			await vi.waitFor(async () => expect((await calls(page)).callIn).toHaveLength(1));
			const request = (await calls(page)).callIn[0];
			expect(request).toEqual({ id: expect.any(String), person: "ada", expected: ["ada"] });
			await release(page, { ok: true, people: [{ person: "ada", state: "ready" }] });
			await publish(page, {
				...world(),
				characters: world().characters.map((person) => (person.id === "ada" ? awake("ada", "Ada", null) : person)),
			});
			await page
				.getByRole("dialog", { name: "Call in Ada", exact: true })
				.getByRole("button", { name: "Close", exact: true })
				.click();
			expect(await page.getByRole("textbox", { name: "Reply to Ada", exact: true }).inputValue()).toBe(
				"Keep this instruction while Ada is home.",
			);
			expect((await calls(page)).wake).toEqual([]);
			expect((await calls(page)).retire).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	});
}

test("Org card context actions do not read, and profile Let go requires reason and permanence without claiming accepted cleanup completed", async () => {
	const { page, errors } = await openLifecycle("dark", 900);
	try {
		const card = await orgCard(page, "Ben");
		await card.click({ button: "right" });
		const menu = page.getByRole("menu", { name: "Actions", exact: true });
		await menu.waitFor();
		expect((await calls(page)).profiles).toEqual([]);
		expect((await calls(page)).conversations).toEqual([]);
		expect((await calls(page)).tasks).toEqual([]);
		await page.keyboard.press("Escape");
		expect(await card.evaluate((node) => document.activeElement === node)).toBe(true);
		await page.keyboard.press("Shift+F10");
		await menu.getByRole("menuitem", { name: "Let go", exact: true }).waitFor();
		await painted(page);
		expect((await calls(page)).profiles).toEqual([]);
		expect(await page.getByRole("complementary", { name: "Profile: Ben", exact: true }).count()).toBe(0);
		await page.keyboard.press("Escape");
		await card.click();
		const profile = page.getByRole("complementary", { name: "Profile: Ben", exact: true });
		await profile.waitFor();
		expect((await calls(page)).profiles).toEqual(["ben"]);
		const trigger = profile.getByRole("button", { name: "Person actions: Ben", exact: true });
		await trigger.click();
		await menu.getByRole("menuitem", { name: "Let go", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Let Ben go", exact: true });
		const submit = dialog.getByRole("button", { name: "Let go", exact: true });
		expect(await submit.isEnabled()).toBe(false);
		await dialog.getByRole("textbox", { name: "Reason for leaving", exact: true }).fill("  Work handed over to Ada.  ");
		expect(await submit.isEnabled()).toBe(false);
		await dialog.getByRole("checkbox", { name: "Permanently remove Ben", exact: true }).check();
		await bounded(page, dialog);
		await shot(page, "dark-let-go-confirm");
		await submit.click();
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		expect(await dialog.isVisible()).toBe(true);
		expect((await calls(page)).retire).toEqual([{ person: "ben", reason: "Work handed over to Ada." }]);
		await release(page, { ok: false, stage: "failed", reason: "Runtime refused departure." });
		await dialog.getByText("Runtime refused departure.", { exact: true }).waitFor();
		expect(await dialog.getByRole("textbox", { name: "Reason for leaving", exact: true }).inputValue()).toContain(
			"Work handed over to Ada.",
		);
		await submit.click();
		await vi.waitFor(async () => expect((await calls(page)).retire).toHaveLength(2));
		await release(page, { ok: true, stage: "accepted", commandId: "retire-ben" });
		await vi.waitFor(async () => expect(await dialog.innerText()).toMatch(/accepted/i));
		expect(await dialog.innerText()).toMatch(/Completion is not yet confirmed/i);
		await shot(page, "dark-let-go-accepted");
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
		expect(await card.count()).toBe(1);
		expect((await calls(page)).home).toEqual([]);
		expect((await calls(page)).conversations).toEqual([]);
		expect((await calls(page)).tasks).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Call in previews every sleeping ancestor, excludes descendants, and retains retry identity and partial results across snapshots", async () => {
	const { page, errors } = await openLifecycle();
	try {
		const card = await orgCard(page, "Cleo");
		await card.focus();
		await page.keyboard.press("Shift+F10");
		await page.getByRole("menuitem", { name: "Call in", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Call in Cleo", exact: true });
		await dialog.waitFor();
		expect(
			await dialog
				.getByRole("list", { name: "People to call in", exact: true })
				.getByRole("listitem")
				.allTextContents(),
		).toEqual(["Daria", "Bea", "Cleo"]);
		expect(await dialog.innerText()).not.toContain("Erin");
		expect((await calls(page)).callIn).toEqual([]);
		expect((await calls(page)).profiles).toEqual([]);
		expect((await calls(page)).conversations).toEqual([]);
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		expect(await card.evaluate((node) => document.activeElement === node)).toBe(true);
		await card.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Call in", exact: true }).click();
		await shot(page, "light-call-in-ancestors");
		await dialog.getByRole("button", { name: "Call in", exact: true }).click();
		await vi.waitFor(async () => expect((await calls(page)).callIn).toHaveLength(1));
		const first = (await calls(page)).callIn[0];
		expect(first.person).toBe("cleo");
		expect(first.id).toEqual(expect.any(String));
		expect([...first.expected].sort()).toEqual(["bea", "cleo", "daria"]);
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		expect(await dialog.isVisible()).toBe(true);
		expect((await calls(page)).callIn).toHaveLength(1);
		await release(page, {
			ok: false,
			people: [
				{ person: "daria", state: "ready" },
				{
					person: "bea",
					state: "uncertain",
					stage: "accepted",
					commandId: "start-bea",
					reason: "Waiting for Bea's bridge.",
				},
				{ person: "cleo", state: "blocked", reason: "Bea is not connected yet." },
			],
		});
		await dialog.getByText("Waiting for Bea's bridge.", { exact: false }).waitFor();
		const next = world();
		next.dormant = next.dormant!.filter((person) => person.id !== "daria");
		next.characters.push(awake("daria", "Daria", "ada"));
		await publish(page, next);
		await painted(page);
		const outcomes = dialog.getByRole("region", { name: "Call-in outcomes", exact: true });
		expect(await outcomes.getByRole("listitem").allTextContents()).toEqual([
			expect.stringContaining("Daria: ready"),
			expect.stringContaining("Bea: uncertain"),
			expect.stringContaining("Cleo: blocked"),
		]);
		await shot(page, "light-call-in-partial");
		await dialog.getByRole("button", { name: "Retry call in", exact: true }).click();
		await vi.waitFor(async () => expect((await calls(page)).callIn).toHaveLength(2));
		expect((await calls(page)).callIn[1]).toEqual(first);
		await release(page, {
			ok: true,
			people: [
				{ person: "daria", state: "ready" },
				{ person: "bea", state: "active" },
				{ person: "cleo", state: "ready" },
			],
		});
		next.dormant = next.dormant!.filter((person) => !["bea", "cleo"].includes(person.id));
		next.characters.push(awake("bea", "Bea", "daria", true), awake("cleo", "Cleo", "bea"));
		await publish(page, next);
		await vi.waitFor(async () =>
			expect(await outcomes.getByRole("listitem").allTextContents()).toEqual([
				expect.stringContaining("Daria: ready"),
				expect.stringContaining("Bea: active"),
				expect.stringContaining("Cleo: ready"),
			]),
		);
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		expect(await card.evaluate((node) => document.activeElement === node)).toBe(true);
		expect((await calls(page)).home).toEqual([]);
		expect((await calls(page)).wake).toEqual([]);
		expect((await calls(page)).tasks).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("A single sleeping person starts immediately; refusal stays explicit and retry preserves the same request", async () => {
	const { page, errors } = await openLifecycle();
	try {
		await sleeperDM(page, "Mina");
		const trigger = page.getByRole("button", { name: "Person actions: Mina", exact: true });
		await trigger.click();
		await page.getByRole("menuitem", { name: "Call in", exact: true }).click();
		await vi.waitFor(async () => expect((await calls(page)).callIn).toHaveLength(1));
		const request = (await calls(page)).callIn[0];
		expect(request).toEqual({ id: expect.any(String), person: "mina", expected: ["mina"] });
		const dialog = page.getByRole("dialog", { name: "Call in Mina", exact: true });
		await release(page, {
			ok: false,
			people: [{ person: "mina", state: "failed", reason: "No terminal is attached to tmux." }],
		});
		await dialog.getByText("No terminal is attached to tmux.", { exact: false }).waitFor();
		await dialog.getByRole("button", { name: "Retry call in", exact: true }).click();
		await vi.waitFor(async () => expect((await calls(page)).callIn).toHaveLength(2));
		expect((await calls(page)).callIn[1]).toEqual(request);
		await page.evaluate(() => (window as any).rejectLifecycle(new Error("Reply lost after dispatch")));
		await vi.waitFor(async () => expect(await dialog.getByRole("alert").innerText()).toMatch(/^Outcome unknown:/));
		await painted(page);
		expect((await calls(page)).callIn).toHaveLength(2);
		await dialog.getByRole("button", { name: "Retry call in", exact: true }).click();
		await vi.waitFor(async () => expect((await calls(page)).callIn).toHaveLength(3));
		expect((await calls(page)).callIn[2]).toEqual(request);
		await release(page, { ok: true, people: [{ person: "mina", state: "ready" }] });
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
		expect((await calls(page)).wake).toEqual([]);
		await page.getByRole("button", { name: /^Temporary peer/ }).click();
		expect(await page.getByRole("button", { name: "Person actions: Temporary peer", exact: true }).count()).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Idle Send home starts unconfirmed, then a runtime busy refusal requires explicit confirmation", async () => {
	const { page, errors } = await openLifecycle();
	try {
		await page.getByRole("button", { name: /^Ben/ }).click();
		const trigger = page.getByRole("button", { name: "Person actions: Ben", exact: true });
		await trigger.click();
		await page.getByRole("menuitem", { name: "Send home", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Send Ben home", exact: true });
		await vi.waitFor(async () => expect((await calls(page)).home).toEqual([{ person: "ben", confirmed: false }]));
		await page.keyboard.press("Escape");
		expect(await dialog.isVisible()).toBe(true);
		const next = world();
		next.characters = next.characters.map((person) =>
			person.id === "ben" ? awake("ben", "Ben", "ada", true) : person,
		);
		await publish(page, next);
		await painted(page);
		expect((await calls(page)).home).toEqual([{ person: "ben", confirmed: false }]);
		await release(page, { ok: false, confirm: true, reason: "Ben started a turn; confirm interruption." });
		await dialog.getByText("Ben started a turn; confirm interruption.", { exact: true }).waitFor();
		await painted(page);
		expect((await calls(page)).home).toHaveLength(1);
		expect(await dialog.innerText()).toMatch(/busy|working|interrupt/i);
		await dialog.getByRole("button", { name: "Send home", exact: true }).click();
		await vi.waitFor(async () =>
			expect((await calls(page)).home).toEqual([
				{ person: "ben", confirmed: false },
				{ person: "ben", confirmed: true },
			]),
		);
		await release(page, { ok: true, stage: "applied", commandId: "home-ben" });
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
		expect((await calls(page)).callIn).toEqual([]);
		expect((await calls(page)).retire).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
