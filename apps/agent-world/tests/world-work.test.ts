import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";

// Explicit focused work in the agent rows, Work tab, examine card, and conversation panel.
// The built world UI in headless Chrome against a fixture backend.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots as aw-13-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

async function openWorld(snapshot: WorldSnapshot) {
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
	await page.addInitScript((first) => {
		(window as any).agentWorld = {
			snapshot: async () => first,
			onUpdate: () => () => {},
			feed: async () => [],
			onFeed: () => () => {},
			goToTerminal: async () => ({ ok: true }),
			conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
			markSeen: async () => ({ ok: true }),
		};
	}, snapshot);
	await page.goto(`${ORIGIN}/index.html`);
	// The interface draws before the world starts; the world handles Talk to only once a place is shown.
	await vi.waitFor(
		async () => expect(await page.evaluate(() => (window as any).agentWorldView?.place())).toBeTruthy(),
		{
			timeout: 15000,
		},
	);
	await page.locator(".aw-side").waitFor({ timeout: 5000 });
	return { page, errors };
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(450);
	await page.screenshot({ path: join(SHOTS, `aw-13-${name}.png`), animations: "disabled" });
}

const HQ = "orla";
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
		cwd: "/Users/op/code/apple-pi",
		reportsTo: HQ,
		model: "claude-opus-4",
		contextTokens: 48_000,
		contextWindow: 200_000,
		cost: 0.42,
		tmux: null,
		...over,
	};
}
const TASK = { title: "Retry failed invoices", status: "in-progress", bundle: "/l/202610190002-retry" };
const EPHEMERAL = { title: "Fix the CSV parser crash", status: "in-progress", bundle: "/state/tasks/csv" };
const person = (id: string, name: string, n: number, f: Partial<CharacterFacts>): Character => ({
	id,
	name,
	role: "worker",
	place: { kind: "common-room", headquarters: HQ },
	startedAt: Date.now() - 3_600_000 + n * 60_000,
	facts: facts(f),
});
const CAST: Character[] = [
	{
		id: HQ,
		name: "Orla Brannigan",
		role: "coordinator",
		place: { kind: "headquarters", headquarters: HQ },
		startedAt: Date.now() - 3_600_000,
		facts: facts({ reportsTo: null }),
	},
	person("tasked", "Kofi Marchetti", 1, { task: TASK }),
	person("ephemeral", "Ada Lovejoy", 2, { task: EPHEMERAL }),
];
const WORLD: WorldSnapshot = {
	connected: true,
	headquarters: [{ id: HQ, name: "Orla Brannigan", wings: [] }],
	characters: CAST,
};

const row = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });

test("ledger and ephemeral focuses appear across the views while an unassigned person has no work line", async () => {
	const { page, errors } = await openWorld(WORLD);
	try {
		// Agents tab rows.
		await expect(row(page, "Kofi Marchetti").locator(".aw-row-work").textContent()).resolves.toBe(
			"Retry failed invoices",
		);
		await expect(row(page, "Ada Lovejoy").locator(".aw-row-work").textContent()).resolves.toBe(EPHEMERAL.title);
		await expect(row(page, "Orla Brannigan").locator(".aw-row-work").count()).resolves.toBe(0);
		await shot(page, "agents");

		// Both types of assigned work have a group; the unassigned root is separate.
		await page.getByRole("tab", { name: "Work", exact: true }).click();
		const loose = page.getByRole("region", { name: "No focused task" });
		await expect(loose.getByRole("button", { name: /^Orla Brannigan/ }).count()).resolves.toBe(1);
		await expect(
			page
				.getByRole("region", { name: EPHEMERAL.title })
				.getByRole("button", { name: /^Ada Lovejoy/ })
				.count(),
		).resolves.toBe(1);
		await expect(
			page
				.getByRole("region", { name: "Retry failed invoices" })
				.getByRole("button", { name: /^Kofi Marchetti/ })
				.count(),
		).resolves.toBe(1);
		await shot(page, "work");

		// Examine card.
		await row(page, "Ada Lovejoy").click();
		await page.getByRole("button", { name: "Examine Ada Lovejoy" }).click();
		const card = page.getByRole("dialog", { name: "Examine Ada Lovejoy" });
		await card.waitFor({ timeout: 2000 });
		await expect(card.textContent()).resolves.toContain(`Focused task${EPHEMERAL.title}`);
		await expect(card.textContent()).resolves.not.toContain("Ledger task");
		await shot(page, "examine");
		await card.getByRole("button", { name: "Close" }).click();
		await row(page, "Kofi Marchetti").click();
		await page.getByRole("button", { name: "Examine Kofi Marchetti" }).click();
		const tasked = page.getByRole("dialog", { name: "Examine Kofi Marchetti" });
		await tasked.waitFor({ timeout: 2000 });
		await expect(tasked.textContent()).resolves.toContain("Focused taskRetry failed invoices (in-progress)");
		await tasked.getByRole("button", { name: "Close" }).click();

		// Conversation panel.
		await page.getByRole("tab", { name: "Agents", exact: true }).click();
		await row(page, "Ada Lovejoy").click();
		await page.getByRole("button", { name: "Talk to Ada Lovejoy" }).click();
		const panel = page.getByRole("dialog", { name: "Conversation with Ada Lovejoy" });
		await panel.waitFor({ timeout: 2000 });
		await vi.waitFor(async () =>
			expect(await panel.locator(".aw-conv-facts").textContent()).toContain(`Focused task${EPHEMERAL.title}`),
		);
		await shot(page, "conversation");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);
