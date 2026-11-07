import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import { openKnowledge } from "../src/backend/knowledge.js";
import { openWorkspace } from "../src/backend/workspace.js";
import type { KnowledgeRequest } from "../src/knowledge.js";
import type { WorldSnapshot } from "../src/world.js";
import { choose, chosen } from "./helpers/select.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

async function openKnowledgePage(height = 900) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "knowledge-ui-")));
	const roots = ["atlas", "beacon", "empty"].map((name) => join(base, name));
	function put(root: string, path: string, text: string) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	for (const root of roots) mkdirSync(join(root, ".git"), { recursive: true });
	for (const root of roots.slice(0, 2)) {
		put(root, "src/app.ts", 'export const message = "original";\n');
		put(root, "src/utility.ts", "export const utility = 1;\n");
		put(root, "tests/app.test.ts", "test");
		put(root, "tests/utility.test.ts", "test");
		put(
			root,
			".context/src/app.ts.md",
			"## file\nThe application owns **startup**.\nCoupled: src/utility.ts\nVerify: tests/app.test.ts, missing.test.ts\nSee [[Guide]].\n<img src=x onerror=alert(1)>\n",
		);
		put(root, ".context/src/utility.ts.md", "## file\nUtility rationale.\nVerify: tests/utility.test.ts\n");
		put(
			root,
			".wiki/Guide.md",
			"# Guide\nRead the **guide** for this repository.\n[[Details#Design|Design details]]\n",
		);
		put(root, ".wiki/Details.md", "# Design\nDesign rationale.\n[[Guide]]\n");
	}
	put(roots[1]!, "src/beacon.ts", "export const beacon = true;\n");
	put(roots[1]!, ".context/src/beacon.ts.md", "## file\nBeacon rationale.\n");
	const workspace = openWorkspace(() => {
		throw new Error("No runtime access expected");
	});
	const knowledge = openKnowledge(workspace);
	const calls = { graph: [] as KnowledgeRequest[], content: [] as (KnowledgeRequest & { id: string })[] };
	const page = await browser.newPage({ viewport: { width: 1440, height }, colorScheme: "light" });
	page.setDefaultTimeout(10000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(APP, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.exposeFunction("knowledgeGraph", (request: KnowledgeRequest) => {
		calls.graph.push(request);
		return knowledge.graph(request);
	});
	await page.exposeFunction("knowledgeContent", (request: KnowledgeRequest & { id: string }) => {
		calls.content.push(request);
		return knowledge.content(request);
	});
	await page.exposeFunction("workspaceTree", (request: { root: string; path: string }) => workspace.tree(request));
	await page.exposeFunction("workspaceRead", (request: { root: string; path: string }) => workspace.readFile(request));
	await page.addInitScript(
		({ roots }) => {
			const w = window as any;
			const snapshot: WorldSnapshot = {
				connected: true,
				headquarters: [],
				characters: [],
				dormant: [],
				mail: [],
				operatorMail: [],
				workplace: { threads: [], tasks: [], escalations: [] },
			};
			w.reads = [];
			w.gitRoots = [];
			w.agentWorkplace = {
				snapshot: async () => snapshot,
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				onReceipt: () => () => {},
				onReply: () => () => {},
				watchReplies: async () => {},
				onNotepad: () => () => {},
				knowledge: {
					graph: async (request: KnowledgeRequest) => {
						const result = await w.knowledgeGraph(request);
						if (w.holdGraph) {
							w.holdGraph = false;
							await new Promise<void>((resolve) => {
								w.releaseGraph = resolve;
							});
						}
						return result;
					},
					content: async (request: KnowledgeRequest & { id: string }) => {
						const result = await w.knowledgeContent(request);
						if (w.holdContent) {
							w.holdContent = false;
							await new Promise<void>((resolve) => {
								w.releaseContent = resolve;
							});
						}
						return result;
					},
				},
				workspace: {
					repositories: async () => ({ ok: true, roots }),
					worktrees: async ({ root }: { root: string }) => ({ ok: true, root, worktrees: [] }),
					tree: (request: { root: string; path: string }) => w.workspaceTree(request),
					readFile: (request: { root: string; path: string }) => {
						w.reads.push(request);
						return w.workspaceRead(request);
					},
					resolvePaths: async () => ({ ok: true, files: [] }),
				},
				reviews: {
					states: async () => [],
					queue: async () => ({
						total: 0,
						states: {},
						passes: { running: 0, limit: 1 },
						page: { offset: 0, nextOffset: null, rows: [] },
					}),
				},
				git: {
					overview: async ({ root }: { root: string }) => {
						w.gitRoots.push(root);
						return {
							ok: true,
							overview: {
								root,
								branch: "main",
								head: "a".repeat(40),
								ahead: 0,
								behind: 0,
								state: "clean",
								remotes: [],
								refs: [],
								stashes: [],
								worktrees: [],
								changes: [],
							},
						};
					},
					log: async () => ({ ok: true, commits: [] }),
				},
			};
		},
		{ roots },
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	return {
		page,
		roots,
		calls,
		errors,
		close: async () => {
			await page.close();
			rmSync(base, { recursive: true, force: true });
		},
	};
}
async function enter(page: Page, name: string) {
	const rail = page.getByRole("navigation", { name: "Applications" });
	const button = rail.getByRole("button", { name, exact: true });
	if (await button.count()) await button.click();
	else {
		await rail.getByRole("button", { name: "More apps" }).click();
		await page.getByRole("menuitem", { name, exact: true }).click();
	}
}
async function findNode(page: Page, path: string) {
	await page.getByRole("searchbox", { name: "Find a node" }).fill(path);
	const bounds = (await page.getByRole("region", { name: "Repository knowledge" }).boundingBox())!;
	expect(bounds.y).toBeGreaterThanOrEqual(0);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await page.getByRole("list", { name: "Matching nodes" }).getByRole("button", { name: path, exact: true }).click();
	await page
		.getByRole("complementary", { name: "Knowledge reader" })
		.getByRole("heading", { name: path, exact: true })
		.waitFor();
}
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-knowledge-${name}.png`), animations: "disabled" });
}

test("Knowledge is lazy, reads both graph modes and follows links in light and dark", async () => {
	const fixture = await openKnowledgePage();
	const { page, calls, errors } = fixture;
	try {
		expect(calls.graph).toEqual([]);
		await enter(page, "Knowledge");
		await page.getByRole("button", { name: "Read src/app.ts", exact: true }).waitFor();
		await findNode(page, "src/app.ts");
		const reader = page.getByRole("complementary", { name: "Knowledge reader" });
		await vi.waitFor(async () => expect(await reader.locator(".aw-md strong").textContent()).toBe("startup"));
		expect(await reader.locator("img, script").count()).toBe(0);
		await reader.getByRole("button", { name: "coupled src/utility.ts outgoing" }).click();
		await vi.waitFor(async () => expect(await reader.textContent()).toContain("Utility rationale"));
		await shot(page, "context-light-1440");
		await choose(page.getByRole("combobox", { name: "Knowledge mode" }), "wiki");
		await page.getByRole("button", { name: "Read .wiki/Guide.md", exact: true }).waitFor();
		await findNode(page, ".wiki/Guide.md");
		await reader.getByRole("button", { name: "wiki .wiki/Details.md outgoing" }).click();
		await vi.waitFor(async () => expect(await reader.textContent()).toContain("Design rationale"));
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await shot(page, "wiki-dark-1440");
		await enter(page, "Chat");
		const before = calls.graph.length;
		await page.waitForTimeout(100);
		expect(calls.graph).toHaveLength(before);
		await enter(page, "Knowledge");
		expect(await chosen(page.getByRole("combobox", { name: "Knowledge mode" }))).toBe("wiki");
		expect(calls.graph).toHaveLength(before);
		expect(errors).toEqual([]);
	} finally {
		await fixture.close();
	}
}, 45000);

test("Code, Git and Knowledge share one repository and source navigation retains Code drafts", async () => {
	const fixture = await openKnowledgePage();
	const { page, roots, errors } = fixture;
	try {
		await enter(page, "Knowledge");
		await findNode(page, "src/app.ts");
		await page.getByRole("button", { name: "Open source in Code", exact: true }).click();
		await page.locator(".monaco-editor").waitFor();
		await vi.waitFor(async () =>
			expect((await page.locator(".monaco-editor .view-lines").textContent())?.replace(/\u00a0/g, " ")).toContain(
				"original",
			),
		);
		await page.locator(".monaco-editor .view-lines").click();
		await page.keyboard.press("Meta+A");
		await page.keyboard.insertText('export const message = "retained draft";');
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		await choose(page.getByRole("combobox", { name: "Code repository" }), roots[1]!);
		await enter(page, "Git");
		expect(await chosen(page.getByRole("combobox", { name: "Git repository" }))).toBe(roots[1]);
		await choose(page.getByRole("combobox", { name: "Git repository" }), roots[0]!);
		await enter(page, "Knowledge");
		expect(await chosen(page.getByRole("combobox", { name: "Knowledge repository" }))).toBe(roots[0]);
		await choose(page.getByRole("combobox", { name: "Knowledge repository" }), roots[1]!);
		await enter(page, "Code");
		expect(await chosen(page.getByRole("combobox", { name: "Code repository" }))).toBe(roots[1]);
		await choose(page.getByRole("combobox", { name: "Code repository" }), roots[0]!);
		await page.getByRole("tab", { name: /app.ts/ }).click();
		await vi.waitFor(async () =>
			expect((await page.locator(".monaco-editor .view-lines").textContent())?.replace(/\u00a0/g, " ")).toContain(
				"retained draft",
			),
		);
		await enter(page, "Reviews");
		expect(await chosen(page.getByRole("combobox", { name: "Repository", exact: true }))).toBe("");
		await choose(page.getByRole("combobox", { name: "Repository", exact: true }), roots[1]!);
		await enter(page, "Knowledge");
		expect(await chosen(page.getByRole("combobox", { name: "Knowledge repository" }))).toBe(roots[0]);
		await choose(page.getByRole("combobox", { name: "Knowledge repository" }), roots[2]!);
		await page.getByText("No .context files in this repository.", { exact: true }).waitFor();
		await choose(page.getByRole("combobox", { name: "Knowledge mode" }), "wiki");
		await page.getByText("No .wiki pages in this repository.", { exact: true }).waitFor();
		expect(await page.evaluate(() => localStorage.getItem("workplace-git-root"))).toBe(roots[2]);
		await enter(page, "Reviews");
		expect(await chosen(page.getByRole("combobox", { name: "Repository", exact: true }))).toBe(roots[1]);
		expect(errors).toEqual([]);
	} finally {
		await fixture.close();
	}
}, 60000);

test("graph zoom, pan, drag and neighbour highlights work; every rail app stays reachable at 900px and under More", async () => {
	const fixture = await openKnowledgePage();
	const { page, errors } = fixture;
	try {
		await enter(page, "Knowledge");
		const node = page.getByRole("button", { name: "Read src/app.ts", exact: true });
		await node.waitFor();
		await node.focus();
		await page.keyboard.press("Enter");
		await page.getByRole("complementary", { name: "Knowledge reader" }).waitFor();
		const transform = page.locator(".wp-knowledge-graph svg > g");
		const before = await transform.getAttribute("transform");
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		expect(await transform.getAttribute("transform")).not.toBe(before);
		await page.getByRole("button", { name: "Fit graph", exact: true }).click();
		const svg = page.locator(".wp-knowledge-graph svg");
		const bounds = (await svg.boundingBox())!;
		const start = { x: bounds.x + 30, y: bounds.y + bounds.height / 2 };
		const panBefore = await transform.getAttribute("transform");
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 80, start.y + 50);
		await page.mouse.up();
		expect(await transform.getAttribute("transform")).not.toBe(panBefore);
		await page.getByRole("button", { name: "Fit graph", exact: true }).click();
		const circle = node.locator("circle");
		const box = (await circle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 8 });
		await vi.waitFor(async () => {
			const moved = (await circle.boundingBox())!;
			expect(Math.abs(moved.x + moved.width / 2 - (box.x + box.width / 2 + 60))).toBeLessThan(2);
			expect(Math.abs(moved.y + moved.height / 2 - (box.y + box.height / 2 + 35))).toBeLessThan(2);
		});
		await page.mouse.up();
		expect(await node.getAttribute("aria-pressed")).toBe("true");
		await node.hover();
		expect(await page.locator(".wp-knowledge-edge[opacity='0.12']").count()).toBeGreaterThan(0);
		const rail = page.getByRole("navigation", { name: "Applications" });
		const labelBounds = await rail.getByRole("button", { name: "Knowledge", exact: true }).evaluate((button) => {
			const range = document.createRange();
			const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
			if (!text) throw new Error("Knowledge label is missing");
			range.selectNodeContents(text);
			const label = range.getBoundingClientRect();
			const container = button.parentElement!.getBoundingClientRect();
			return { left: label.left, right: label.right, clipLeft: container.left, clipRight: container.right };
		});
		expect(labelBounds.left).toBeGreaterThanOrEqual(labelBounds.clipLeft);
		expect(labelBounds.right).toBeLessThanOrEqual(labelBounds.clipRight);
		for (const button of await rail.locator("button").all()) {
			const box = await button.boundingBox();
			if (box) expect(box.y + box.height).toBeLessThanOrEqual(900);
		}
		await rail.getByRole("button", { name: "More apps" }).click();
		const reachable = [
			...(await rail.locator(".wp-rail-apps > button:not(.wp-rail-more)").allTextContents()),
			...(await page.getByRole("menuitem").allTextContents()),
		].map((text) => text.trim());
		for (const name of ["Chat", "Mail", "Org", "Code", "Git", "Knowledge", "Reviews", "Issues"])
			expect(reachable).toContain(name);
		await page.keyboard.press("Escape");
		await page.setViewportSize({ width: 1440, height: 560 });
		await rail.getByRole("button", { name: "More apps" }).waitFor();
		await enter(page, "Chat");
		await enter(page, "Knowledge");
		await page.getByRole("region", { name: "Repository knowledge" }).waitFor();
		await shot(page, "rail-more-560");
		expect(errors).toEqual([]);
	} finally {
		await fixture.close();
	}
}, 45000);

test("returning to an already loaded repository clears obsolete loading and permits Refresh", async () => {
	const fixture = await openKnowledgePage();
	const { page, roots, errors } = fixture;
	try {
		await enter(page, "Knowledge");
		await page.getByRole("button", { name: "Read src/app.ts", exact: true }).waitFor();
		await page.evaluate(() => {
			(window as any).holdGraph = true;
		});
		await choose(page.getByRole("combobox", { name: "Knowledge repository" }), roots[1]!);
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => typeof (window as any).releaseGraph)).toBe("function"),
		);
		await choose(page.getByRole("combobox", { name: "Knowledge repository" }), roots[0]!);
		await page.getByRole("button", { name: "Read src/app.ts", exact: true }).waitFor();
		expect(await page.getByRole("button", { name: "Refresh", exact: true }).isEnabled()).toBe(true);
		await page.evaluate(() => (window as any).releaseGraph());
		await page.waitForTimeout(100);
		expect(await page.getByRole("button", { name: "Read src/beacon.ts", exact: true }).count()).toBe(0);
		expect(await page.getByRole("button", { name: "Refresh", exact: true }).isEnabled()).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await fixture.close();
	}
}, 45000);

test("superseded graph and node reads cannot overwrite the selected repository or reader", async () => {
	const fixture = await openKnowledgePage();
	const { page, roots, errors } = fixture;
	try {
		await enter(page, "Knowledge");
		await page.getByRole("button", { name: "Read src/app.ts", exact: true }).waitFor();
		await page.evaluate(() => {
			(window as any).holdContent = true;
		});
		await findNode(page, "src/app.ts");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => typeof (window as any).releaseContent)).toBe("function"),
		);
		await findNode(page, "src/utility.ts");
		const reader = page.getByRole("complementary", { name: "Knowledge reader" });
		await vi.waitFor(async () => expect(await reader.textContent()).toContain("Utility rationale"));
		await page.evaluate(() => (window as any).releaseContent());
		await page.waitForTimeout(100);
		expect(await reader.textContent()).toContain("Utility rationale");
		expect(await reader.textContent()).not.toContain("application owns");
		await page.evaluate(() => {
			(window as any).holdGraph = true;
		});
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => typeof (window as any).releaseGraph)).toBe("function"),
		);
		await choose(page.getByRole("combobox", { name: "Knowledge repository" }), roots[1]!);
		await page.getByRole("button", { name: "Read src/beacon.ts", exact: true }).waitFor();
		await page.evaluate(() => (window as any).releaseGraph());
		await page.waitForTimeout(100);
		expect(await page.getByRole("button", { name: "Read src/beacon.ts", exact: true }).count()).toBe(1);
		expect(await chosen(page.getByRole("combobox", { name: "Knowledge repository" }))).toBe(roots[1]);
		expect(errors).toEqual([]);
	} finally {
		await fixture.close();
	}
}, 45000);
