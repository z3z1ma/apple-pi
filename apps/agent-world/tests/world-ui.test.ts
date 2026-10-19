import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { WorldSnapshot } from "../src/world.js";

// Seam 2: the committed, built world UI in headless Chrome, with the preload API replaced by a fixture backend.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

/** Open the world with a fixture in place of `window.agentWorld`; `push` sends it a new snapshot. */
async function openWorld(first: WorldSnapshot) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	// The page reaches its files the way Electron's app:// protocol serves them, with no server.
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(appDir, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript((snapshot) => {
		const listeners = new Set<(s: unknown) => void>();
		let current = snapshot;
		(window as any).agentWorld = {
			snapshot: async () => current,
			onUpdate(listener: (s: unknown) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		(window as any).pushSnapshot = (next: unknown) => {
			current = next as typeof snapshot;
			for (const listener of listeners) listener(next);
		};
	}, first);
	await page.goto(`${ORIGIN}/index.html`);
	const push = (snapshot: WorldSnapshot) => page.evaluate((s) => (window as any).pushSnapshot(s), snapshot);
	return { page, push, errors };
}

const characters = (page: Page) =>
	page.evaluate(() => (window as any).agentWorldView?.characters() as string[] | undefined);

test("the headquarters shows one character per awake session, following updates", async () => {
	const { page, push, errors } = await openWorld({
		connected: true,
		characters: [
			{ id: "a", name: "apple-pi" },
			{ id: "b", name: "docs-worker" },
		],
	});
	try {
		await vi.waitFor(async () => expect(await characters(page)).toEqual(["apple-pi", "docs-worker"]), {
			timeout: 15000,
		});
		expect(await page.evaluate(() => (window as any).agentWorldView.place())).toBe("headquarters");
		await push({ connected: true, characters: [{ id: "b", name: "docs-worker" }] });
		await vi.waitFor(async () => expect(await characters(page)).toEqual(["docs-worker"]), { timeout: 2000 });
		await expect(page.getByText(/disconnected/i).count()).resolves.toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the world says it is disconnected while the runtime is gone, and clears the notice when it returns", async () => {
	const snapshot = { connected: false, characters: [{ id: "a", name: "apple-pi" }] };
	const { page, push, errors } = await openWorld(snapshot);
	try {
		await page.getByText(/disconnected/i).waitFor({ timeout: 15000 });
		await push({ ...snapshot, connected: true });
		await page.getByText(/disconnected/i).waitFor({ state: "detached", timeout: 2000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);
