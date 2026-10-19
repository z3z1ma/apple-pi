import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, DormantAgent, MailItem, WorldSnapshot } from "../src/world.js";

// Scratch measurement (ticket 30): the renderer's frame time with many characters in one wing, at rest and while the
// backend pushes updates the way Electron IPC delivers them (a fresh structured clone each time). Not part of the suite.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const LABEL = process.env.AW_PERF_LABEL ?? "run";
const WORKERS = Number(process.env.AW_PERF_WORKERS ?? 40);
const DORMANT = Number(process.env.AW_PERF_DORMANT ?? 3000);
const HQ = "orla";
const T0 = Date.now() - 3_600_000;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

function facts(n: number): CharacterFacts {
	return {
		run: n % 2 ? "running" : "idle",
		status: n % 2 ? "working" : n % 5 === 0 ? "asking" : "idle",
		asking: n % 5 === 0 && n % 2 === 0 ? { kind: "dialog", text: "Which branch?" } : null,
		needsYouSince: n % 3 === 0 ? T0 : null,
		unseen: n % 3 === 0,
		seenAt: null,
		settledAt: null,
		tool: n % 2 ? { name: "bash", arg: "npm test", since: T0 } : null,
		task: { title: `Task ${n}`, status: "in-progress", bundle: `/l/${n}` },
		git: { repository: "/r/apple-pi", worktree: "/r/apple-pi", branch: `b${n}` },
		cwd: "/r/apple-pi",
		reportsTo: HQ,
		model: "claude-opus-4",
		contextTokens: 48_000,
		contextWindow: 200_000,
		cost: 0.42,
		tmux: null,
	};
}
const characters: Character[] = [
	{ id: HQ, name: "Orla", role: "coordinator", place: { kind: "headquarters", headquarters: HQ }, startedAt: T0, facts: { ...facts(1), reportsTo: null, git: null } },
	...Array.from({ length: WORKERS }, (_, n): Character => ({
		id: `w${n}`,
		name: `worker ${n}`,
		role: "worker",
		place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
		startedAt: T0 + n * 1000,
		facts: facts(n),
	})),
];
const dormant: DormantAgent[] = Array.from({ length: DORMANT }, (_, n) => ({
	id: `s${n}`,
	name: `sleeper ${n}`,
	role: "worker",
	reportsTo: HQ,
	repository: `/repos/project-${n % 30}`,
	cwd: `/repos/project-${n % 30}`,
	task: { title: `Task number ${n % 60}`, status: "in-progress", bundle: `/ledger/task-${n % 60}` },
	stoppedAt: T0 - n * 60_000,
	stopReason: "exited",
	startedAt: T0 - n * 600_000,
}));
const mail: MailItem[] = Array.from({ length: 218 }, (_, n) => ({
	id: `m${n}`,
	from: `s${n}`,
	fromName: `sleeper ${n}`,
	to: `s${n + 7}`,
	toName: `sleeper ${n + 7}`,
	body: `Mail body number ${n} with some words in it.`,
	sentAt: T0 - n * 1000,
	deliveredAt: T0,
	state: "delivered",
	reason: null,
}));
const snapshot: WorldSnapshot = {
	connected: true,
	headquarters: [{ id: HQ, name: "Orla", wings: [{ repository: "/r/apple-pi", name: "apple-pi", headcount: WORKERS, dormant: 0 }] }],
	characters,
	dormant,
	mail,
};

async function openWorld(first: WorldSnapshot) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(appDir, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript((s) => {
		const listeners = new Set<(s: unknown) => void>();
		let current = s;
		const w = window as any;
		w.fixture = s;
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
		};
		w.pushSnapshot = (next: any) => {
			current = next;
			for (const listener of listeners) listener(next);
		};
	}, first);
	await page.goto(`${ORIGIN}/index.html`);
	return { page, errors };
}

/** Frame deltas over `ms`, while `pushEvery` (ms) pushes the fixture with one character's cost changed. */
async function frames(page: Page, ms: number, push: "none" | "full" | "small") {
	return page.evaluate(
		async ([duration, mode]) => {
			const w = window as any;
			const deltas: number[] = [];
			let longTasks = 0;
			let longTaskMs = 0;
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks++;
					longTaskMs += entry.duration;
				}
			});
			observer.observe({ entryTypes: ["longtask"] });
			let pushes = 0;
			let pushMs = 0;
			let cost = 0;
			const base = w.fixture;
			const small = { ...base, dormant: undefined, mail: undefined };
			const timer =
				mode === "none"
					? undefined
					: setInterval(() => {
							const start = performance.now();
							// A structured clone stands for Electron's IPC deserialising each update.
							const next = structuredClone(mode === "full" ? base : small);
							next.characters[1].facts.cost = (cost += 0.01);
							if (mode === "small") {
								next.dormant = base.dormant;
								next.mail = base.mail;
							}
							w.pushSnapshot(next);
							pushes++;
							pushMs += performance.now() - start;
						}, 200);
			await new Promise<void>((resolve) => {
				let last = performance.now();
				const end = last + duration;
				const tick = (now: number) => {
					deltas.push(now - last);
					last = now;
					if (now < end) requestAnimationFrame(tick);
					else resolve();
				};
				requestAnimationFrame(tick);
			});
			clearInterval(timer);
			observer.disconnect();
			deltas.shift();
			const sorted = [...deltas].sort((a, b) => a - b);
			const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
			return {
				frames: deltas.length,
				fps: (deltas.length / duration) * 1000,
				meanMs: mean,
				p95Ms: sorted[Math.floor(sorted.length * 0.95)],
				maxMs: sorted.at(-1),
				over33: deltas.filter((d) => d > 33.4).length,
				longTasks,
				longTaskMs,
				pushes,
				pushSyncMs: pushes ? pushMs / pushes : 0,
			};
		},
		[ms, push] as const,
	);
}

test("frame times", async () => {
	const out: Record<string, unknown> = { label: LABEL, workers: WORKERS, dormant: DORMANT };
	const { page, errors } = await openWorld(snapshot);
	await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).agentWorldView.avatar())).toBeTruthy(), { timeout: 20000 });
	await page.getByRole("tab", { name: "Places", exact: true }).click();
	await page.getByRole("button", { name: /^apple-pi wing/ }).click();
	await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).agentWorldView.place())).toBe(`wing:${HQ}:/r/apple-pi`), { timeout: 10000 });
	await page.waitForTimeout(3000);
	out.charactersDrawn = await page.evaluate(() => (window as any).agentWorldView.figures().length);
	out.rest = await frames(page, 5000, "none");
	out.fullUpdates = await frames(page, 5000, "full");
	out.smallUpdates = await frames(page, 5000, "small");
	// The same in the inn's list: the Agents tab shows every sleeper too.
	await page.getByRole("tab", { name: "Agents", exact: true }).click();
	await page.waitForTimeout(1000);
	out.agentsTabFullUpdates = await frames(page, 5000, "full");
	out.agentsTabSmallUpdates = await frames(page, 5000, "small");
	out.errors = errors;
	writeFileSync(`/tmp/aw30/frames-${LABEL}.json`, JSON.stringify(out, null, 2));
	await page.screenshot({ path: `/tmp/aw30/frames-${LABEL}.png`, animations: "disabled" });
	await page.close();
}, 180000);
