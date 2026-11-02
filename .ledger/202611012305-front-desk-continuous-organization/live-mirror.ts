/**
 * Read-only live mirror for UX audits: the built Workplace in headless Chrome, fed by the real backends over the
 * operator's live state. Reads pass through; anything that would change state or acknowledge reading is refused.
 *
 *   node --import ./components/session-state/src/register.mjs .ledger/<task>/live-mirror.ts <outDir> [scenario]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { agentDir, statePaths } from "../../components/session-state/src/paths.js";
import { openCommands } from "../../apps/agent-workplace/src/backend/commands.js";
import { openCommunications } from "../../apps/agent-workplace/src/backend/communications.js";
import { openConversations } from "../../apps/agent-workplace/src/backend/conversations.js";
import { openLifecycle } from "../../apps/agent-workplace/src/backend/lifecycle.js";
import { openReviews } from "../../apps/agent-workplace/src/backend/reviews.js";
import { openWorkplace } from "../../apps/agent-workplace/src/backend/workplace.js";
import { openWorkspace } from "../../apps/agent-workplace/src/backend/workspace.js";
import { openWorldBackend } from "../../apps/agent-workplace/src/backend/world-backend.js";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "apps/agent-workplace"))) root = dirname(root);
const out = process.argv[2] ?? "/tmp/aw-live";
const scenario = process.argv[3] ?? "tour";
mkdirSync(out, { recursive: true });

const paths = statePaths();
const world = openWorldBackend(paths);
const commands = openCommands(paths.socket);
const communications = openCommunications(paths.db, commands);
const conversations = openConversations(paths.socket);
const workplace = openWorkplace(paths.db, commands, () => world.snapshot());
const lifecycle = openLifecycle({ ...paths, agentDir: agentDir() }, commands, () => world.snapshot());
const reviews = openReviews(paths.db, commands).api;
const workspace = openWorkspace(() => world.snapshot());

const READS: Record<string, (...args: never[]) => unknown> = {
	snapshot: () => world.snapshot(),
	feed: () => world.feed(),
	profile: (id: string) => world.profile(id),
	conversation: (id: string, before?: string) => conversations.page(id, before),
	readThread: (thread: string) => lifecycle.readThread(thread),
	readTask: (task: string) => workplace.readTask(task),
	readWorkplaceThread: (thread: string) => workplace.readWorkplaceThread(thread),
	roles: () => [],
	themes: () => [],
	"communications.readThread": (request: { view?: string }) => {
		if ((request.view ?? "catch_up") === "catch_up") return { ok: false, reason: "Mirror: catch-up acknowledges; refused." };
		return communications.readThread(request as never);
	},
	"communications.searchMessages": (request: unknown) => communications.searchMessages(request as never),
	"communications.findChannels": (request: unknown) => communications.findChannels(request as never),
	"communications.status": (request: unknown) => communications.status(request as never),
	"reviews.queue": (request: unknown) => reviews.queue(request as never),
	"reviews.read": (request: unknown) => reviews.read(request as never),
	"reviews.analytics": (request: unknown) => reviews.analytics(request as never),
	"workspace.resolvePaths": () => ({ ok: true, files: [] }),
	"workspace.repositories": () => workspace.repositories(),
	"workspace.files": (request: unknown) => workspace.files(request as never),
	"workspace.worktrees": (request: unknown) => workspace.worktrees(request as never),
	"workspace.tree": (request: unknown) => workspace.tree(request as never),
	"workspace.readFile": (request: unknown) => workspace.readFile(request as never),
	"workspace.gitStatus": (request: unknown) => workspace.gitStatus(request as never),
	"workspace.gitDiff": (request: unknown) => workspace.gitDiff(request as never),
};

const browser = await chromium.launch({
	executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	headless: true,
});

async function open(width: number, height: number, appearance: "light" | "dark"): Promise<Page> {
	const page = await browser.newPage({ viewport: { width, height } });
	page.on("pageerror", (error) => console.error(`pageerror: ${error.message}`));
	await page.route("http://localhost/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const file = join(root, "apps/agent-workplace/dist/web", path === "/" ? "index.html" : path);
		if (!existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({
			body: readFileSync(file),
			contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
		});
	});
	await page.exposeBinding("__mirror", async (_source, method: string, args: unknown[]) => {
		const read = READS[method];
		if (!read) return { ok: false, outcome: "refused", reason: `Mirror is read-only: ${method}` };
		return JSON.parse(JSON.stringify((await (read as (...a: unknown[]) => unknown)(...args)) ?? null));
	});
	await page.addInitScript((mode) => {
		localStorage.setItem("workplace-appearance", mode);
		const call = (method: string) => (...args: unknown[]) => (window as any).__mirror(method, args);
		const listeners = (method: string) => (listener: (value: unknown) => void) => {
			if (method !== "onUpdate") return () => {};
			const timer = setInterval(async () => listener(await (window as any).__mirror("snapshot", [])), 1000);
			return () => clearInterval(timer);
		};
		const proxy = (prefix: string): unknown =>
			new Proxy(
				{},
				{
					get: (_target, key: string) => {
						const name = prefix ? `${prefix}.${key}` : key;
						if (!prefix && ["communications", "reviews", "workspace", "terminal"].includes(key)) return proxy(key);
						if (key.startsWith("on")) return listeners(key);
						return call(name);
					},
				},
			);
		(window as any).agentWorkplace = proxy("");
	}, appearance);
	await page.goto("http://localhost/");
	await page.waitForTimeout(1500);
	return page;
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`), animations: "disabled" });

if (scenario === "tour") {
	for (const [appearance, width] of [
		["light", 1440],
		["dark", 1100],
	] as const) {
		const page = await open(width, 900, appearance);
		await shot(page, `${appearance}-${width}-chat`);
		for (const view of ["Threads", "Activity"]) {
			await page.getByRole("button", { name: new RegExp(`^${view}`) }).click();
			await page.waitForTimeout(600);
			await shot(page, `${appearance}-${width}-${view.toLowerCase()}`);
		}
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.waitForTimeout(800);
		await shot(page, `${appearance}-${width}-mail`);
		const first = page.locator(".wp-mail-row").first();
		if (await first.count()) {
			await first.click();
			await page.waitForTimeout(1000);
			await shot(page, `${appearance}-${width}-mail-thread`);
		}
		await page.close();
	}
}
if (scenario === "chat") {
	for (const [appearance, width] of [
		["light", 1440],
		["dark", 1100],
		["light", 900],
	] as const) {
		const page = await open(width, 900, appearance);
		const name = `${appearance}-${width}`;
		const dm = page.locator(".wp-dm .wp-dm-link").first();
		if (await dm.count()) {
			await dm.click();
			await page.waitForTimeout(1500);
			await shot(page, `${name}-dm`);
		}
		const channel = page.locator(".wp-channel").first();
		if (await channel.count()) {
			await channel.click();
			await page.waitForTimeout(1200);
			await shot(page, `${name}-channel`);
		}
		const group = page.locator(".wp-group").first();
		if (await group.count()) {
			await group.click();
			await page.waitForTimeout(1200);
			await shot(page, `${name}-group`);
		}
		await page.getByRole("button", { name: /^Threads/ }).click();
		await page.waitForTimeout(500);
		const thread = page.locator(".wp-threads-list button").nth(3);
		if (await thread.count()) {
			await thread.click();
			await page.waitForTimeout(1500);
			await shot(page, `${name}-thread-panel`);
		}
		await page.close();
	}
}
if (scenario === "actions") {
	for (const [appearance, width] of [
		["light", 1440],
		["dark", 1100],
	] as const) {
		const page = await open(width, 900, appearance);
		const name = `${appearance}-${width}`;
		await page.locator(".wp-dm .wp-dm-link").first().click();
		await page.waitForTimeout(1500);
		const message = page.locator(".wp-session .wp-actionable").last();
		await message.hover();
		await shot(page, `${name}-dm-hover`);
		await message.locator(".aw-conv-who").click({ button: "right" });
		await page.waitForTimeout(200);
		await shot(page, `${name}-dm-menu`);
		await page.keyboard.press("Escape");
		await message.hover();
		await message.getByRole("button", { name: "Forward" }).click();
		await page.waitForTimeout(300);
		await page.keyboard.type("sv");
		await shot(page, `${name}-forward`);
		await page.keyboard.press("Escape");
		await message.hover();
		await message.getByRole("button", { name: "Reply", exact: true }).click();
		await page.waitForTimeout(300);
		await shot(page, `${name}-quote`);
		await page.locator(".wp-channel").first().click();
		await page.waitForTimeout(1200);
		await page.getByRole("button", { name: /^Threads/ }).click();
		await page.waitForTimeout(500);
		await page.locator(".wp-threads-list button").nth(1).click();
		await page.waitForTimeout(1200);
		const post = page.locator(".wp-thread-conversation .wp-actionable").first();
		if (await post.count()) {
			await post.hover();
			await shot(page, `${name}-thread-hover`);
		}
		await page.close();
	}
}
if (scenario === "working") {
	for (const [appearance, width] of [
		["light", 1440],
		["dark", 900],
	] as const) {
		const page = await open(width, 900, appearance);
		await page.locator(".wp-dm .wp-dm-link").filter({ hasText: "Tadhg" }).first().click();
		await page.waitForTimeout(2000);
		await shot(page, `${appearance}-${width}-working`);
		await page.getByRole("button", { name: "Show tool calls" }).click();
		await page.waitForTimeout(800);
		await shot(page, `${appearance}-${width}-working-tools`);
		await page.close();
	}
}
if (scenario === "scale") {
	// How long the busiest lists take to draw on real data, and how many rows they hold.
	const page = await open(1440, 900, "light");
	for (const [view, rows] of [
		["Threads", ".wp-threads-list > li"],
		["Activity", ".wp-activity-list > li"],
	] as const) {
		const ms = await page.evaluate(async (name) => {
			const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
				item.textContent?.trim().startsWith(name),
			);
			const start = performance.now();
			button?.click();
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return performance.now() - start;
		}, view);
		console.log(`${view}: ${await page.locator(rows).count()} rows, drawn in ${ms.toFixed(0)} ms`);
	}
	await page.getByRole("button", { name: /^Threads/ }).click();
	const longTasks = await page.evaluate(
		() =>
			new Promise<number[]>((resolve) => {
				const seen: number[] = [];
				new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) seen.push(Math.round(entry.duration));
				}).observe({ type: "longtask" });
				setTimeout(() => resolve(seen), 5000);
			}),
	);
	console.log(`long tasks while idle on Threads for 5 s (snapshot every 1 s): ${JSON.stringify(longTasks)}`);
	await page.close();
}
if (scenario === "search") {
	const page = await open(1440, 900, "light");
	await page.keyboard.press("Meta+k");
	await page.keyboard.type(process.argv[4] ?? "approval");
	await page.waitForTimeout(1500);
	await shot(page, "light-1440-search");
	await page.close();
}
if (scenario === "rest") {
	for (const [appearance, width] of [
		["light", 1440],
		["dark", 1100],
	] as const) {
		const page = await open(width, 900, appearance);
		for (const tab of ["Org", "Code", "Issues"]) {
			await page.getByRole("button", { name: tab, exact: true }).click();
			await page.waitForTimeout(1500);
			await shot(page, `${appearance}-${width}-${tab.toLowerCase()}`);
			if (tab === "Code") {
				const repo = page.getByRole("combobox").first();
				const options = await repo.locator("option").allTextContents();
				const target = options.find((option) => option.includes("apple-pi"));
				if (target) {
					await repo.selectOption({ label: target });
					await page.waitForTimeout(2500);
					await shot(page, `${appearance}-${width}-code-repo`);
					const file = page.getByRole("treeitem").filter({ hasText: "README.md" }).first();
					if (await file.count()) {
						await file.click();
						await page.waitForTimeout(2500);
						await shot(page, `${appearance}-${width}-code-file`);
					}
				}
			}
		}
		await page.close();
	}
}
await browser.close();
world.close();
process.exit(0);
