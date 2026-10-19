import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import {
	close,
	query,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { appFile, contentType } from "../src/app-files.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { listThemes } from "../src/backend/theme-packs.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import { FIDGETS, type FidgetKind } from "../src/theme-pack.js";

// Seam 1 for fidget objects (ticket 29): the built world UI wired to the real backend API over a real session-state
// runtime, the way the Electron preload wires it. Playing with every fidget in the room (each play, from the click and
// from the menu, and Examine) sends the runtime no command, writes nothing to its database, calls no function place's
// integrations, and fetches nothing from anywhere: a fidget is presentation only.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));

const state = tempStateDir();
let world: WorldBackend;
let commands: Commands;
let browser: Browser;
let run: Awaited<ReturnType<typeof fauxSession>>;
/** Commands sent to the runtime and calls made to the integrations (`places:*`), by name. */
const sent: string[] = [];
const outside: string[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const real = openCommands(state.socketPath);
	commands = {
		send: (sessionId, command, options) => {
			sent.push(command.kind);
			return real.send(sessionId, command, options);
		},
		close: () => real.close(),
	};
	run = await fauxSession([bridge], () => fauxAssistantMessage("noted"), []);
	await vi.waitFor(() => expect(world.snapshot().characters.length).toBeGreaterThan(0), { timeout: 15000 });
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(async () => {
	await browser?.close();
	await close(run);
	world.close();
	commands.close();
	await stopRuntime(state);
});

/** The rows a fidget would change if it reached the runtime: commands, events, and stored preferences. */
const runtimeRows = () => ({
	commands: query(state.dbPath, "select * from commands"),
	events: query<{ n: number }>(state.dbPath, "select count(*) as n from events")[0].n,
	preferences: query(state.dbPath, "select * from preferences"),
});

/** The world UI with `window.agentWorld` calling the real backend through one exposed function, as the preload does. */
async function openWorld(): Promise<{ page: Page; requests: string[]; errors: string[] }> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		if (!request.url().startsWith(ORIGIN)) requests.push(request.url());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(appDir, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.exposeFunction("agentWorldBackend", async (name: string, args: unknown[]) => {
		if (name === "snapshot") return world.snapshot();
		if (name === "feed") return world.feed();
		if (name === "themes") return listThemes(join(appDir, "themes"));
		if (name === "conversation") return { ok: true, entries: [], before: null, missing: 0 };
		if (name.startsWith("places:")) {
			outside.push(name);
			return { ok: false, reason: "not in this test" };
		}
		// Everything else acts on a session or the runtime: through the counted command client.
		const id = String(args[0] ?? world.snapshot().characters[0].id);
		await commands.send(id, { kind: "follow_up", text: `(${name})` }).catch(() => {});
		return { ok: true, stage: "applied" };
	});
	await page.addInitScript(() => {
		const call =
			(name: string) =>
			(...args: unknown[]) =>
				(window as any).agentWorldBackend(name, args);
		const none = () => () => {};
		const places = new Proxy({}, { get: (_target, key) => call(`places:${String(key)}`) });
		(window as any).agentWorld = new Proxy(
			{ onUpdate: none, onFeed: none, onReceipt: none, onReply: none, watchReplies: async () => {}, places },
			{ get: (target: any, key: string) => target[key] ?? call(key) },
		);
	});
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(
		async () =>
			expect(await page.evaluate(() => (window as any).agentWorldView?.avatar()), errors.join("; ")).toBeTruthy(),
		{
			timeout: 15000,
		},
	);
	await page.waitForTimeout(500);
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	await page.mouse.move(640, 400);
	for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 500);
	await page.waitForTimeout(900);
	return { page, requests, errors };
}

interface Shown {
	index: number;
	kind: FidgetKind;
	name: string;
	x: number;
	y: number;
	h: number;
}
const fidgets = (page: Page) => page.evaluate(() => (window as any).agentWorldView.fidgets()) as Promise<Shown[]>;
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;

test("playing with every fidget in the room sends no command and makes no outside call", {
	timeout: 180_000,
}, async () => {
	const { page, requests, errors } = await openWorld();
	// Only what the fidgets do counts: whatever the world did while opening is set aside.
	sent.length = 0;
	outside.length = 0;
	requests.length = 0;
	const shown = await fidgets(page);
	expect(shown.length).toBeGreaterThanOrEqual(2);
	const before = runtimeRows();
	const at = async (f: Shown) => screen(page, f.x, f.y - Math.min(f.h / 2, 0.4));
	let played = 0;
	for (const f of shown) {
		// The default play on a left click (after the walk up), then each menu line, Examine last.
		const [x, y] = await at(f);
		await page.mouse.click(x, y);
		await page.waitForTimeout(2500);
		const lines = FIDGETS[f.kind].plays.length + 1;
		for (let line = 0; line < lines; line++) {
			const [mx, my] = await at(f);
			await page.mouse.click(mx, my, { button: "right" });
			const items = page.locator(".pointer-menu [role=menuitem]");
			await items.first().waitFor({ timeout: 3000 });
			const texts = await items.allTextContents();
			const ours = texts.filter((text) => text.endsWith(f.name));
			await items
				.filter({ hasText: ours[Math.min(line, ours.length - 1)] })
				.first()
				.click();
			await page.waitForTimeout(1200);
			played++;
		}
	}
	expect(played).toBeGreaterThan(shown.length * 2);
	// Nothing reached the backend's acting side or the outside world, and the runtime's rows are as they were.
	expect(sent).toEqual([]);
	expect(outside).toEqual([]);
	expect(requests).toEqual([]);
	expect(runtimeRows()).toEqual(before);
	expect(errors).toEqual([]);
	await page.close();
});
