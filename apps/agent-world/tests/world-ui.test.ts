import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, Headquarters, WorldSnapshot } from "../src/world.js";

// Seam 2: the committed, built world UI in headless Chrome, with the preload API replaced by a fixture backend.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves a screenshot of each place the tests visit there.
const SHOTS = process.env.AGENT_WORLD_SHOTS;

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
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
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
			// The interface's feed and terminal (tested in world-interface.test.ts).
			feed: async () => [],
			onFeed: () => () => {},
			goToTerminal: async () => ({ ok: true }),
		};
		(window as any).pushSnapshot = (next: unknown) => {
			current = next as typeof snapshot;
			for (const listener of listeners) listener(next);
		};
	}, first);
	await page.goto(`${ORIGIN}/index.html`);
	const push = (snapshot: WorldSnapshot) => page.evaluate((s) => (window as any).pushSnapshot(s), snapshot);
	await vi.waitFor(async () => expect(await place(page)).toBeTruthy(), { timeout: 15000 });
	return { page, push, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const place = (page: Page) => view<string | undefined>(page, "place()");
const characters = (page: Page) => view<string[]>(page, "characters()");
const figures = (page: Page) => view<{ id: string; x: number; y: number; look: string }[]>(page, "figures()");
const gallery = (page: Page) =>
	view<{ niches: number; wings: { name: string; boarded: boolean }[] } | undefined>(page, "gallery()");

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(400); // let the arrival fade finish
	await page.screenshot({ path: join(SHOTS, `aw-02-${name}.png`), animations: "disabled" });
}

/**
 * Click a door as the operator would, looking at it first when it is off screen; the avatar walks up to it and goes
 * through. Wait to arrive at `arrive`.
 */
async function enter(page: Page, door: string, arrive?: string) {
	// Click the world itself, even where the interface's panels cover a door.
	await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
	await page.evaluate((name) => (window as any).agentWorldView.lookAt(name), door);
	await page.waitForTimeout(80);
	const target = (await view<{ name: string; x: number; y: number }[]>(page, "doors()")).find((d) => d.name === door);
	expect(target, `door ${door}`).toBeDefined();
	await page.mouse.click(target!.x, target!.y);
	if (arrive) await vi.waitFor(async () => expect(await place(page)).toBe(arrive), { timeout: 10000 });
	await page.waitForTimeout(250);
}

// A fixture world: Orla coordinates; her workers are in wings by repository or the common room.
const HQ = "orla";
const at = (n: number) => 1_700_000_000_000 + n * 1000;
const coordinator = (id = HQ, name = "Orla", n = 0): Character => ({
	id,
	name,
	role: "coordinator",
	place: { kind: "headquarters", headquarters: id },
	startedAt: at(n),
});
const worker = (id: string, repository: string | null, n: number, hq = HQ): Character => ({
	id,
	name: id,
	role: "worker",
	place: repository ? { kind: "wing", headquarters: hq, repository } : { kind: "common-room", headquarters: hq },
	startedAt: at(n),
});
const independent = (id: string, n: number): Character => ({
	id,
	name: id,
	role: "independent",
	place: { kind: "square" },
	startedAt: at(n),
});
const wingsOf = (characters: Character[], repositories: string[], hq = HQ) =>
	repositories.map((repository) => ({
		repository,
		name: repository.split("/").pop()!,
		headcount: characters.filter(
			(c) => c.place.kind === "wing" && c.place.headquarters === hq && c.place.repository === repository,
		).length,
	}));
function world(characters: Character[], repositories: string[], extra: Headquarters[] = []): WorldSnapshot {
	return {
		connected: true,
		headquarters: [{ id: HQ, name: "Orla", wings: wingsOf(characters, repositories) }, ...extra],
		characters,
	};
}
const workers = (count: number, repository: string, from = 10) =>
	Array.from({ length: count }, (_, i) => worker(`${repository.split("/").pop()}-${i + 1}`, repository, from + i));

test("the world opens in the headquarters with its coordinator, and follows updates", async () => {
	const cast = [coordinator(), worker("pi-docs", "/r/apple-pi", 1), worker("loose", null, 2), independent("solo", 3)];
	const { page, push, errors } = await openWorld(world(cast, ["/r/apple-pi"]));
	try {
		expect(await place(page)).toBe(`headquarters:${HQ}`);
		await vi.waitFor(async () => expect(await characters(page)).toEqual(["Orla"]), { timeout: 5000 });
		await page.locator(".place-title").getByText("Guild hall").waitFor({ timeout: 2000 });
		await shot(page, "headquarters");
		await push(world([coordinator(HQ, "Orla the Wise"), ...cast.slice(1)], ["/r/apple-pi"]));
		await vi.waitFor(async () => expect(await characters(page)).toEqual(["Orla the Wise"]), { timeout: 2000 });
		await push(world(cast.slice(1), ["/r/apple-pi"]));
		await vi.waitFor(async () => expect(await characters(page)).toEqual([]), { timeout: 2000 });
		await expect(page.getByText(/disconnected/i).count()).resolves.toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("doors travel between the hall, common room, gallery, wings, and square", async () => {
	const cast = [
		coordinator(),
		worker("pi-docs", "/r/apple-pi", 1),
		worker("pi-tests", "/r/apple-pi", 2),
		worker("loose", null, 3),
		worker("ledger", "/r/billing-service", 4),
		independent("solo", 5),
	];
	const { page, errors } = await openWorld(world(cast, ["/r/apple-pi", "/r/legacy-auth", "/r/billing-service"]));
	try {
		await enter(page, "Archway to the gallery", `gallery:${HQ}`);
		expect(await gallery(page)).toEqual({
			niches: 3,
			wings: [
				{ name: "apple-pi", boarded: false },
				{ name: "legacy-auth", boarded: true },
				{ name: "billing-service", boarded: false },
			],
		});
		await shot(page, "gallery");
		await enter(page, "apple-pi wing", `wing:${HQ}:/r/apple-pi`);
		expect(await characters(page)).toEqual(["pi-docs", "pi-tests"]);
		expect(await view(page, "painting()")).toBe("wing-small");
		await shot(page, "wing-small");
		await enter(page, "Door to the gallery", `gallery:${HQ}`);
		await enter(page, "Archway to the hall", `headquarters:${HQ}`);
		await enter(page, "Archway to the common room", `common-room:${HQ}`);
		expect(await characters(page)).toEqual(["loose"]);
		await shot(page, "common-room");
		await enter(page, "Archway to the hall", `headquarters:${HQ}`);
		await enter(page, "Hall doors", "square");
		expect(await characters(page)).toEqual(["solo"]);
		await shot(page, "square");
		await enter(page, "Forge");
		await page.getByText("The forge is not open yet.").waitFor({ timeout: 8000 });
		expect(await place(page)).toBe("square");
		await enter(page, "Guild hall", `headquarters:${HQ}`);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("the gallery shows one niche per wing, repeating its painted niche beyond five", async () => {
	const repos = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "a-very-long-repository-name"].map(
		(r) => `/r/${r}`,
	);
	const cast = [coordinator(), ...repos.filter((_, i) => i !== 1 && i !== 4).map((r, i) => worker(`w${i}`, r, i + 1))];
	const { page, push, errors } = await openWorld(world(cast, repos));
	try {
		await enter(page, "Archway to the gallery", `gallery:${HQ}`);
		const seven = await gallery(page);
		expect(seven?.niches).toBe(7);
		expect(seven?.wings.map((w) => `${w.name}${w.boarded ? " (boarded)" : ""}`)).toEqual([
			"alpha",
			"beta (boarded)",
			"gamma",
			"delta",
			"epsilon (boarded)",
			"zeta",
			"a-very-long-repository-name",
		]);
		await shot(page, "gallery-seven");
		await page.evaluate(() => (window as any).agentWorldView.lookAt("a-very-long-repository-name wing"));
		await shot(page, "gallery-seven-east");
		// Fewer wings, fewer niches; the view stays in the gallery.
		await push(world([coordinator(), worker("w0", "/r/alpha", 1)], ["/r/alpha", "/r/beta"]));
		await vi.waitFor(async () => expect((await gallery(page))?.niches).toBe(2), { timeout: 3000 });
		await shot(page, "gallery-two");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a wing with more agents than the small room's spots uses the large room, where several share a table", async () => {
	const three = workers(3, "/r/apple-pi");
	const { page, push, errors } = await openWorld(world([coordinator(), ...three], ["/r/apple-pi"]));
	try {
		await enter(page, "Archway to the gallery", `gallery:${HQ}`);
		await enter(page, "apple-pi wing", `wing:${HQ}:/r/apple-pi`);
		expect(await view(page, "painting()")).toBe("wing-small");
		await push(world([coordinator(), ...workers(4, "/r/apple-pi")], ["/r/apple-pi"]));
		await vi.waitFor(async () => expect(await view(page, "painting()")).toBe("wing-large"), { timeout: 3000 });
		await vi.waitFor(async () => expect(await characters(page)).toHaveLength(4), { timeout: 3000 });
		const crowd = workers(14, "/r/apple-pi");
		await push(world([coordinator(), ...crowd], ["/r/apple-pi"]));
		await vi.waitFor(async () => expect(await characters(page)).toHaveLength(14), { timeout: 3000 });
		const placed = await figures(page);
		expect(new Set(placed.map((f) => `${f.x},${f.y}`)).size).toBe(14);
		// Several agents at one table: neighbours on the same row, closer than two tables' width.
		const sharing = placed.filter((a) => placed.some((b) => b !== a && b.y === a.y && Math.abs(b.x - a.x) < 2.5));
		expect(sharing.length).toBeGreaterThanOrEqual(4);
		await shot(page, "wing-large-crowded");
		// Nobody moves when another leaves.
		const before = new Map(placed.map((f) => [f.id, `${f.x},${f.y}`]));
		await push(world([coordinator(), ...crowd.filter((_, i) => i !== 2)], ["/r/apple-pi"]));
		await vi.waitFor(async () => expect(await characters(page)).toHaveLength(13), { timeout: 3000 });
		for (const f of await figures(page)) expect(`${f.x},${f.y}`, f.id).toBe(before.get(f.id));
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("two coordinators each have a headquarters; the square's guild hall asks whose", async () => {
	const cast = [coordinator(), coordinator("brann", "Brann", 1), worker("b-1", "/r/forge-tools", 2, "brann")];
	const brann: Headquarters = { id: "brann", name: "Brann", wings: wingsOf(cast, ["/r/forge-tools"], "brann") };
	const { page, errors } = await openWorld(world(cast, [], [brann]));
	try {
		expect(await place(page)).toBe(`headquarters:${HQ}`);
		expect(await characters(page)).toEqual(["Orla"]);
		await enter(page, "Hall doors", "square");
		await enter(page, "Guild hall");
		await page.getByRole("dialog", { name: "Whose headquarters?" }).waitFor({ timeout: 2000 });
		await shot(page, "square-chooser");
		await page.getByRole("dialog", { name: "Whose headquarters?" }).getByRole("button", { name: /Brann/ }).click();
		await vi.waitFor(async () => expect(await place(page)).toBe("headquarters:brann"), { timeout: 3000 });
		expect(await characters(page)).toEqual(["Brann"]);
		await page.locator(".place-title").getByText("Brann's headquarters").waitFor({ timeout: 2000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

test("the walk grid toggle draws the blocked cells, spots, and doors over the painting", async () => {
	const cast = [coordinator(), ...workers(5, "/r/apple-pi"), worker("loose", null, 30), independent("solo", 31)];
	const { page, errors } = await openWorld(world(cast, ["/r/apple-pi", "/r/old-repo"]));
	try {
		expect(await view(page, "walkGrid()")).toBe(false);
		await page.keyboard.press("g");
		await vi.waitFor(async () => expect(await view(page, "walkGrid()")).toBe(true), { timeout: 2000 });
		await shot(page, "grid-headquarters");
		// It stays on from place to place, until pressed again.
		for (const [door, arrive, name] of [
			["Archway to the common room", `common-room:${HQ}`, "grid-common-room"],
			["Archway to the hall", `headquarters:${HQ}`, ""],
			["Archway to the gallery", `gallery:${HQ}`, "grid-gallery"],
			["apple-pi wing", `wing:${HQ}:/r/apple-pi`, "grid-wing-large"],
			["Door to the gallery", `gallery:${HQ}`, ""],
			["old-repo wing", `wing:${HQ}:/r/old-repo`, "grid-wing-small"],
			["Door to the gallery", `gallery:${HQ}`, ""],
			["Archway to the hall", `headquarters:${HQ}`, ""],
			["Hall doors", "square", "grid-square"],
		]) {
			await enter(page, door, arrive);
			expect(await view(page, "walkGrid()")).toBe(true);
			if (name) await shot(page, name);
		}
		await page.keyboard.press("g");
		await vi.waitFor(async () => expect(await view(page, "walkGrid()")).toBe(false), { timeout: 2000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("the world says it is disconnected while the runtime is gone, and clears the notice when it returns", async () => {
	const snapshot = { ...world([coordinator()], []), connected: false };
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
