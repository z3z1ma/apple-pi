import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { WorkspacePath, WorkspaceSave } from "../src/workspace.js";
import type { WorldSnapshot } from "../src/world.js";
import { choose, chosen } from "./helpers/select.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const ROOT = "/fixture/project";
const LINKED_ROOT = `${ROOT}-linked worktree/\u660e\u7d30`;
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

async function openCode(options: { desk?: boolean } = {}) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
	page.setDefaultTimeout(7000);
	const errors: string[] = [];
	const recordError = (message: string) => {
		errors.push(message);
		if (SHOTS) {
			mkdirSync(SHOTS, { recursive: true });
			appendFileSync(join(SHOTS, "browser-errors.log"), `${message}\n`);
		}
	};
	page.on("pageerror", (error) => recordError(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") recordError(message.text());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(APP, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		({ root, linked, desk }) => {
			const w = window as any;
			const snapshot: WorldSnapshot = {
				connected: true,
				headquarters: [],
				characters: [],
				dormant: [],
				mail: [],
				operatorMail: [],
				workplace: { threads: [], tasks: [], escalations: [] },
				...(desk ? { desk: { thread: "t-desk", person: "desk-1" } } : {}),
			};
			w.workspaceCalls = {
				repositories: 0,
				files: [],
				worktrees: [],
				trees: [],
				reads: [],
				saves: [],
				copied: [],
			};
			Object.defineProperty(navigator, "clipboard", {
				value: {
					writeText: async (text: string) => {
						w.workspaceCalls.copied.push(text);
					},
				},
			});
			w.workspaceDisk = {
				"src/main.ts": { text: 'export const message = "original";\n', hash: "main-original" },
				"README.md": { text: "# Fixture project\n", hash: "readme-original" },
				"notes.txt": { text: "untracked note\n", hash: "notes-original" },
			};
			w.agentWorkplace = {
				snapshot: async () => snapshot,
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				onReceipt: () => () => {},
				onReply: () => () => {},
				watchReplies: async () => {},
				onNotepad: () => () => {},
				workspace: {
					repositories: async () => {
						w.workspaceCalls.repositories++;
						return { ok: true, roots: [root, `${root}-other`] };
					},
					files: async (request: { root: string }) => {
						w.workspaceCalls.files.push(structuredClone(request));
						return { ok: true, root: request.root, paths: w.workspaceFiles ?? Object.keys(w.workspaceDisk) };
					},
					worktrees: async (request: { root: string }) => {
						w.workspaceCalls.worktrees.push(structuredClone(request));
						const entries = [
							{ path: root, branch: "feature/editor", detached: false, bare: false },
							{ path: `${root}-other`, branch: "feature/other", detached: false, bare: false },
							{ path: linked, branch: null, detached: true, bare: false, locked: "" },
							{ path: `${root}-prunable`, branch: "old/review", detached: false, bare: false, prunable: "" },
							{ path: `${root}-bare`, branch: null, detached: false, bare: true },
						];
						return {
							ok: true,
							root: request.root,
							worktrees: entries.map((entry) => ({
								...entry,
								current: entry.path === request.root,
								head: "fixture-head",
							})),
						};
					},
					tree: async (request: WorkspacePath) => {
						w.workspaceCalls.trees.push(structuredClone(request));
						const entries =
							request.path === ""
								? [
										{ name: "src", path: "src", kind: "directory" },
										{ name: "README.md", path: "README.md", kind: "file" },
									]
								: [{ name: "main.ts", path: "src/main.ts", kind: "file" }];
						return { ok: true, ...request, entries };
					},
					readFile: async (request: WorkspacePath) => {
						w.workspaceCalls.reads.push(structuredClone(request));
						const result = { ok: true, ...request, ...w.workspaceDisk[request.path] };
						if (request.path === w.holdReadPath) {
							return await new Promise((resolve) => {
								w.releaseFileRead = () => {
									w.holdReadPath = undefined;
									resolve(result);
								};
							});
						}
						return result;
					},
					saveFile: async (request: WorkspaceSave) => {
						w.workspaceCalls.saves.push(structuredClone(request));
						const current = w.workspaceDisk[request.path];
						if (request.baseHash !== current.hash)
							return { ok: false, conflict: true, reason: "The file changed since it was read." };
						const hash = `saved-${w.workspaceCalls.saves.length}`;
						w.workspaceDisk[request.path] = { text: request.text, hash };
						return { ok: true, hash };
					},
				},
			};
		},
		{ root: ROOT, linked: LINKED_ROOT, desk: options.desk ?? false },
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual([]);
	await page.getByRole("button", { name: "Code", exact: true }).click();
	await page.getByRole("region", { name: "Code workspace", exact: true }).waitFor();
	await shot(page, "entry");
	const bounds = await page.getByRole("region", { name: "Code workspace", exact: true }).boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.y).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	return { page, errors };
}

const editor = (page: Page) => page.locator(".monaco-editor");
const editorText = async (page: Page) =>
	(await page.locator(".monaco-editor .view-lines").textContent())?.replace(/\u00a0/g, " ");
async function openMain(page: Page) {
	const files = page.getByRole("complementary", { name: "Files", exact: true });
	await files.getByRole("button", { name: "src", exact: true }).click();
	await files.getByRole("button", { name: "main.ts", exact: true }).click();
	await editor(page).waitFor();
	await vi.waitFor(async () => expect(await editorText(page)).toContain("original"), { timeout: 10000 });
}
async function replaceText(page: Page, text: string) {
	await editor(page).click();
	await page.keyboard.press("Meta+A");
	await page.keyboard.insertText(text);
}
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-code-${name}.png`), animations: "disabled" });
}

test("real Monaco retains dirty files across file and app switches, then saves explicitly and with CmdS", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		expect(await page.evaluate(() => (window as any).workspaceCalls.trees)).toEqual(
			expect.arrayContaining([
				{ root: ROOT, path: "" },
				{ root: ROOT, path: "src" },
			]),
		);
		const text = 'export const message = "operator draft";\n';
		await replaceText(page, text);
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		for (const name of ["Refresh files", "Check for file changes", "Save"]) {
			const button = page.getByRole("button", { name, exact: true });
			expect((await button.innerText()).trim()).toBe("");
			expect(await button.locator("svg").count()).toBe(1);
			expect(
				await button.evaluate((node) => {
					const box = node.getBoundingClientRect();
					const glyph = node.querySelector("svg")!.getBoundingClientRect();
					const style = getComputedStyle(node);
					const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
					return (
						box.width > glyph.width &&
						box.height > glyph.height &&
						Number.parseFloat(style.borderTopWidth) > 0 &&
						style.borderTopStyle !== "none" &&
						style.borderTopColor !== "rgba(0, 0, 0, 0)" &&
						(hit === node || node.contains(hit))
					);
				}),
			).toBe(true);
		}
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "README.md", exact: true })
			.click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("Fixture project"));
		await page.getByRole("tab", { name: /main.ts/ }).click();
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("operator draft"));
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		await shot(page, "dirty-retained");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await page.getByText("Saved src/main.ts", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([
			{ root: ROOT, path: "src/main.ts", text, baseHash: "main-original" },
		]);
		await replaceText(page, 'export const message = "saved by shortcut";\n');
		await page.keyboard.press("Meta+S");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toHaveLength(2),
		);
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves[1])).toMatchObject({
			baseHash: "saved-1",
			text: 'export const message = "saved by shortcut";\n',
		});
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor({ state: "hidden" });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("word wrap toggles from the editor's command palette, and Files can be hidden without losing the draft", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		const long = `export const message = "${"wrapped words ".repeat(40)}";\n`;
		await replaceText(page, long);
		const rows = () => page.locator(".wp-code-editor-pane .view-line").count();
		await vi.waitFor(async () => expect(await rows()).toBe(2));
		const toggleWrap = async () => {
			await page.keyboard.press("F1");
			await page.keyboard.type("Toggle Word Wrap");
			await page.getByRole("option", { name: /View: Toggle Word Wrap/ }).waitFor();
			await page.keyboard.press("Enter");
		};
		await toggleWrap();
		await vi.waitFor(async () => expect(await rows()).toBeGreaterThan(2));
		await shot(page, "wrapped");
		await editor(page).click({ button: "right" });
		const menu = page.locator(".monaco-menu-container .monaco-scrollable-element").first();
		await menu.waitFor();
		expect(await menu.evaluate((node) => getComputedStyle(node).backgroundColor)).toMatch(/^rgb\(/);
		await shot(page, "editor-menu");
		await page.keyboard.press("Escape");
		const panes = page.locator(".wp-code-panes");
		const files = page.getByRole("complementary", { name: "Files", exact: true });
		const editorLeft = () => page.locator(".wp-code-editor-pane").evaluate((node) => node.getBoundingClientRect().left);
		const panesLeft = await panes.evaluate((node) => node.getBoundingClientRect().left);
		expect(await editorLeft()).toBeGreaterThan(panesLeft + 100);
		await page.getByRole("button", { name: "Files", exact: true }).click();
		await files.waitFor({ state: "hidden" });
		expect(Math.abs((await editorLeft()) - panesLeft)).toBeLessThan(2);
		const wide = await page.locator(".wp-code-editor-pane").evaluate((node) => node.getBoundingClientRect().width);
		expect(wide).toBeGreaterThan((await panes.evaluate((node) => node.getBoundingClientRect().width)) - 2);
		await shot(page, "panes-hidden");
		await page.getByRole("button", { name: "Files", exact: true }).click();
		await files.waitFor();
		expect(await editorText(page)).toContain("wrapped words");
		await editor(page).click();
		await toggleWrap();
		await vi.waitFor(async () => expect(await rows()).toBe(2));
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("editor actions reach agents with the selected code and show their replies inline, beside the lines", async () => {
	const { page, errors } = await openCode({ desk: true });
	try {
		await openMain(page);
		await page.evaluate(() => {
			const w = window as any;
			w.askCalls = { mail: [], posts: [], previews: [], enqueues: [], authors: [], wakes: [] };
			w.agentWorkplace.wake = async (id: string) => {
				w.askCalls.wakes.push(id);
				return { ok: true };
			};
			w.threadMessages = {};
			w.agentWorkplace.codeAuthor = async (path: string) => {
				w.askCalls.authors.push(path);
				return path.endsWith("main.ts") ? { id: "author-1", name: "Niamh", editedAt: 1 } : null;
			};
			w.agentWorkplace.communications = {
				sendMail: async (request: any) => {
					w.askCalls.mail.push(structuredClone(request));
					return {
						attempt: request.attempt,
						outcome: "applied",
						effect: { thread: { id: `t-${w.askCalls.mail.length}` } },
					};
				},
				readThread: async (request: any) => ({
					ok: true,
					page: { messages: w.threadMessages[request.thread] ?? [], window_through: 0 },
				}),
				post: async (request: any) => {
					w.askCalls.posts.push(structuredClone(request));
					return { attempt: request.attempt, outcome: "applied" };
				},
			};
			w.agentWorkplace.reviews = {
				...w.agentWorkplace.reviews,
				queue: async (request: any) => {
					w.askCalls.queues = [...(w.askCalls.queues ?? []), structuredClone(request)];
					return { total: 0, states: {}, passes: { running: 0, limit: 8 }, page: null };
				},
				preview: async (request: any) => {
					w.askCalls.previews.push(structuredClone(request));
					return { digest: "digest-1", changedPaths: 1, lines: [] };
				},
				enqueue: async (request: any) => {
					w.askCalls.enqueues.push(structuredClone(request));
					return { id: "review-1", ownerName: "Desk" };
				},
				read: async (request: any) =>
					request.part === "summary"
						? { state: "running" }
						: {
								total: 1,
								page: {
									rows: [
										{
											finding: { title: "Off by one", path: "src/main.ts", line: 1, severity: "high" },
											validation: { disposition: "confirmed" },
										},
									],
								},
							},
			};
		});
		const calls = () => page.evaluate(() => (window as any).askCalls);
		const palette = async (label: string) => {
			await editor(page).click({ position: { x: 240, y: 16 } });
			await page.keyboard.press("F1");
			await page.keyboard.type(label);
			await page.getByRole("option", { name: new RegExp(label) }).waitFor();
			await page.keyboard.press("Enter");
		};
		await editor(page).click();
		await page.keyboard.press("Meta+ArrowUp");
		await page.keyboard.press("Shift+End");
		await editor(page).click({ button: "right", position: { x: 120, y: 12 } });
		const item = page.getByRole("menuitem", { name: /Agents: Ask the Desk/ });
		await item.waitFor();
		await new Promise((resolve) => setTimeout(resolve, 600));
		await item.click();
		const deskAsk = page.getByRole("region", { name: "Ask the Desk: lines 1-1", exact: true });
		await deskAsk.getByRole("textbox").fill("Why is this exported?");
		await deskAsk.getByRole("button", { name: "Ask the desk", exact: true }).click();
		await vi.waitFor(async () => expect((await calls()).mail).toHaveLength(1));
		const [desk] = (await calls()).mail;
		expect(desk.to).toEqual(["desk-1"]);
		expect(desk.subject).toBe("Code question: src/main.ts:1-1");
		expect(desk.body).toContain("`/fixture/project/src/main.ts` lines 1-1");
		expect(desk.body).toContain("Why is this exported?");
		expect(desk.body).toContain('```typescript\nexport const message = "original";\n```');
		await page.evaluate(() => {
			(window as any).threadMessages["t-1"] = [
				{ id: "m1", from: "operator", fromName: "You", body: "Why is this exported?" },
				{ id: "m2", from: "desk-1", fromName: "Nana", body: "Other modules import it." },
			];
		});
		await deskAsk.getByText("Other modules import it.", { exact: true }).waitFor({ timeout: 8000 });
		await deskAsk.getByRole("textbox", { name: "Reply" }).fill("Which ones?");
		await deskAsk.getByRole("button", { name: "Reply", exact: true }).click();
		await vi.waitFor(async () =>
			expect((await calls()).posts).toEqual([expect.objectContaining({ thread: "t-1", body: "Which ones?" })]),
		);

		await palette("Agents: Ask Whoever Wrote This");
		const authorAsk = page.getByRole("region", { name: "Ask Whoever Wrote This: lines 1-2", exact: true });
		await authorAsk.getByRole("textbox").fill("What was the intent?");
		await authorAsk.getByRole("button", { name: "Ask the author", exact: true }).click();
		await authorAsk.getByText("src/main.ts:1-2 \u00b7 Niamh", { exact: true }).waitFor();
		const away = authorAsk.getByRole("status");
		await away.getByText("Niamh is at home. The question waits until they are called in.").waitFor();
		await away.getByRole("button", { name: "Call in", exact: true }).click();
		await vi.waitFor(async () => expect((await calls()).wakes).toEqual(["author-1"]));
		expect((await calls()).authors).toEqual(["/fixture/project/src/main.ts"]);
		expect((await calls()).mail[1]).toMatchObject({ to: ["author-1"] });
		expect((await calls()).mail[1].body).not.toContain("```");

		await palette("Agents: Review This");
		const reviewAsk = page.getByRole("region", { name: "Review This: lines 1-2", exact: true });
		await reviewAsk.getByRole("textbox").fill("Check the export");
		await reviewAsk.getByRole("button", { name: "Start review", exact: true }).click();
		await reviewAsk.getByRole("button", { name: /Off by one/ }).waitFor({ timeout: 8000 });
		expect((await calls()).previews[0]).toMatchObject({
			cwd: "/fixture/project",
			target: { kind: "working-tree", base: "HEAD" },
			paths: ["src/main.ts"],
		});
		expect((await calls()).enqueues[0]).toMatchObject({ expectedDigest: "digest-1", owner: "desk-1" });
		await reviewAsk.getByRole("button", { name: "Open in Reviews", exact: true }).click();
		await page.getByRole("region", { name: "Code reviews", exact: true }).waitFor();
		expect(new URL(page.url()).search).toBe("?workplace=reviews");
		await vi.waitFor(async () =>
			expect((await calls()).queues).toContainEqual(expect.objectContaining({ around: "review-1" })),
		);
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await reviewAsk.waitFor();

		await palette("Agents: Fix or Change This");
		const fixAsk = page.getByRole("region", { name: "Fix or Change This: lines 1-2", exact: true });
		await fixAsk.getByRole("textbox").fill("Rename message to greeting");
		await fixAsk.getByRole("button", { name: "Hand to an engineer", exact: true }).click();
		await vi.waitFor(async () => expect((await calls()).mail).toHaveLength(3));
		expect((await calls()).mail[2]).toMatchObject({ to: ["desk-1"], subject: "Change request: src/main.ts:1-2" });
		await shot(page, "asks-inline");

		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "README.md", exact: true })
			.click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("Fixture project"));
		expect(await page.locator(".wp-code-ask").count()).toBe(0);
		await palette("Agents: Ask Whoever Wrote This");
		const missing = page.getByRole("region", { name: "Ask Whoever Wrote This: lines 1-2", exact: true });
		await missing.getByRole("textbox").fill("Who wrote this?");
		await missing.getByRole("button", { name: "Ask the author", exact: true }).click();
		await missing
			.getByRole("alert")
			.getByText(/No agent session has edited this file/)
			.waitFor();
		await page.getByRole("tab", { name: /main.ts/ }).click();
		await vi.waitFor(async () => expect(await page.locator(".wp-code-ask").count()).toBe(4));
		await deskAsk.getByText("Other modules import it.", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60_000);

test("conflict recovery preserves the draft, writes only after Save, and still rejects a newer disk version", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		await replaceText(page, 'export const message = "keep my draft";\n');
		await page.evaluate(() => {
			(window as any).workspaceDisk["src/main.ts"] = {
				text: 'export const message = "external edit";\n',
				hash: "external-hash",
			};
		});
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await page.getByText("File changed on disk. Your draft is kept; saving is blocked.", { exact: true }).waitFor();
		expect(await editorText(page)).toContain("keep my draft");
		expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(false);
		await editor(page).click();
		await page.keyboard.press("Meta+S");
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toHaveLength(1);
		await page.getByText("Review disk version", { exact: true }).click();
		await page.getByText('export const message = "external edit";', { exact: true }).waitFor();
		await page.getByText("Saving will replace the disk version shown here.", { exact: true }).waitFor();
		await shot(page, "conflict");
		await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
		expect(await editorText(page)).toContain("keep my draft");
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toHaveLength(1);
		expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
		await shot(page, "conflict-kept");
		await page.evaluate(() => {
			(window as any).workspaceDisk["src/main.ts"] = {
				text: 'export const message = "newer disk edit";\n',
				hash: "newer-hash",
			};
		});
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await page.getByText("File changed on disk. Your draft is kept; saving is blocked.", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves[1])).toMatchObject({
			baseHash: "external-hash",
			text: 'export const message = "keep my draft";\n',
		});
		expect(await editorText(page)).toContain("keep my draft");
		await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toHaveLength(2);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await page.getByText("Saved src/main.ts", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves[2])).toMatchObject({
			baseHash: "newer-hash",
			text: 'export const message = "keep my draft";\n',
		});
		await replaceText(page, 'export const message = "draft to discard";\n');
		await page.evaluate(() => {
			(window as any).workspaceDisk["src/main.ts"] = {
				text: 'export const message = "discard target";\n',
				hash: "discard-hash",
			};
		});
		await page.getByRole("button", { name: "Check for file changes", exact: true }).click();
		await page.getByRole("button", { name: "Discard draft and use disk version", exact: true }).click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("discard target"));
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toHaveLength(3);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("Quick Open searches file paths locally and opens only the chosen file while preserving drafts", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		await replaceText(page, 'export const message = "retained quick-open draft";\n');
		await page.evaluate(() => {
			const w = window as any;
			w.workspaceFiles = [
				"src/main.ts",
				"components/main.tsx",
				"docs/my-main.ts",
				"main.ts/archive.md",
				...Array.from({ length: 60 }, (_, i) => `generated/entry-${String(i).padStart(3, "0")}.ts`),
			];
			w.workspaceDisk["components/main.tsx"] = {
				text: 'export const component = "chosen by keyboard";\n',
				hash: "component-original",
			};
		});
		const readsBefore = await page.evaluate(() => (window as any).workspaceCalls.reads.length);
		expect(await page.evaluate(() => (window as any).workspaceCalls.files)).toEqual([]);
		await page.keyboard.press("Meta+P");
		const dialog = page.getByRole("dialog", { name: "Quick open file", exact: true });
		const input = dialog.getByRole("combobox", { name: "Find file by name or path", exact: true });
		await input.waitFor();
		expect(await input.evaluate((el) => document.activeElement === el)).toBe(true);
		await input.fill("main.ts");
		const options = dialog.getByRole("option");
		await vi.waitFor(async () => expect(await options.count()).toBe(4));
		expect(await options.first().getAttribute("title")).toBe(`${ROOT}/src/main.ts`);
		await page.keyboard.press("ArrowDown");
		expect(await options.nth(1).getAttribute("aria-selected")).toBe("true");
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads.length)).toBe(readsBefore);
		expect(await page.evaluate(() => (window as any).workspaceCalls.files)).toEqual([{ root: ROOT }]);
		await shot(page, "quick-open-ranked");
		await page.keyboard.press("Enter");
		await dialog.waitFor({ state: "hidden" });
		await vi.waitFor(async () => expect(await editorText(page)).toContain("chosen by keyboard"));
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads.slice(-1))).toEqual([
			{ root: ROOT, path: "components/main.tsx" },
		]);
		await page
			.getByRole("tab")
			.and(page.getByTitle("src/main.ts", { exact: true }))
			.click();
		expect(await editorText(page)).toContain("retained quick-open draft");
		const trigger = page.getByRole("button", { name: "Quick open file", exact: true });
		await trigger.click();
		await input.fill("entry-059");
		await dialog.getByRole("option", { name: "entry-059.ts generated/entry-059.ts", exact: true }).waitFor();
		await input.fill("no-such-file");
		await dialog.getByRole("status").filter({ hasText: "No matching files." }).waitFor();
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		expect(await trigger.evaluate((el) => document.activeElement === el)).toBe(true);
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		expect(
			await page.evaluate(() => {
				const event = new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true });
				window.dispatchEvent(event);
				return event.defaultPrevented;
			}),
		).toBe(false);
		expect(await dialog.isVisible()).toBe(false);
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("opening Quick Open from a tab menu dismisses the old menu and keeps picker focus", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		await page.getByRole("tab", { name: "main.ts", exact: true }).click({ button: "right" });
		const menu = page.getByRole("menu", { name: "Actions", exact: true });
		await menu.waitFor();
		await page.keyboard.press("Meta+P");
		const input = page
			.getByRole("dialog", { name: "Quick open file", exact: true })
			.getByRole("combobox", { name: "Find file by name or path", exact: true });
		await input.waitFor();
		await shot(page, "quick-open-from-menu");
		await vi.waitFor(async () => expect(await menu.isVisible()).toBe(false));
		expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("linked worktrees expose metadata and retain separate drafts without saving files", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		await replaceText(page, 'export const message = "original-root draft";\n');
		const manualRoot = page.getByRole("textbox", { name: "Repository path", exact: true });
		await manualRoot.fill(ROOT);
		expect(
			await page.getByRole("button", { name: "Open", exact: true }).evaluate((node) => {
				const style = getComputedStyle(node);
				return (
					Number.parseFloat(style.borderTopWidth) > 0 &&
					style.borderTopStyle !== "none" &&
					style.borderTopColor !== "rgba(0, 0, 0, 0)" &&
					style.backgroundColor !== "rgba(0, 0, 0, 0)"
				);
			}),
		).toBe(true);
		await manualRoot.clear();
		const select = page.getByRole("combobox", { name: "Linked worktree", exact: true });
		await vi.waitFor(async () => expect(await select.isEnabled()).toBe(true));
		await select.click();
		const entries = await page
			.getByRole("listbox", { name: "Linked worktree", exact: true })
			.getByRole("option")
			.evaluateAll((options) =>
				options.map((option) => ({
					value: option.getAttribute("data-value"),
					text: option.textContent ?? "",
					disabled: option.getAttribute("aria-disabled") === "true",
				})),
			);
		await page.keyboard.press("Escape");
		expect(entries.find((entry) => entry.value === LINKED_ROOT)).toMatchObject({
			disabled: false,
			text: expect.stringContaining("Locked"),
		});
		expect(entries.find((entry) => entry.value === LINKED_ROOT)?.text).toContain("Detached HEAD");
		expect(entries.find((entry) => entry.value === `${ROOT}-prunable`)).toMatchObject({
			disabled: true,
			text: expect.stringContaining("Prunable"),
		});
		expect(entries.find((entry) => entry.value === `${ROOT}-bare`)).toMatchObject({
			disabled: true,
			text: expect.stringContaining("Bare"),
		});
		await choose(select, LINKED_ROOT);
		await vi.waitFor(async () =>
			expect(await chosen(page.getByRole("combobox", { name: "Code repository", exact: true }))).toBe(LINKED_ROOT),
		);
		await openMain(page);
		await replaceText(page, 'export const message = "linked-root draft";\n');
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual(
			expect.arrayContaining([{ root: LINKED_ROOT, path: "src/main.ts" }]),
		);
		await shot(page, "linked-worktree-draft");
		await choose(select, ROOT);
		await page.getByRole("tab", { name: /main\.ts/ }).click();
		expect(await editorText(page)).toContain("original-root draft");
		await choose(select, LINKED_ROOT);
		await page.getByRole("tab", { name: /main\.ts/ }).click();
		expect(await editorText(page)).toContain("linked-root draft");
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("clean tabs close individually and keyboard menus copy paths and restore focus", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "README.md", exact: true })
			.click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("Fixture project"));
		const mainTab = page.getByRole("tab", { name: "main.ts", exact: true });
		await mainTab.focus();
		await page.keyboard.press("Shift+F10");
		const menu = page.getByRole("menu", { name: "Actions", exact: true });
		await menu.waitFor();
		expect(
			await menu
				.getByRole("menuitem", { name: "Close", exact: true })
				.evaluate((node) => node === document.activeElement),
		).toBe(true);
		await page.keyboard.press("End");
		expect(
			await menu
				.getByRole("menuitem", { name: "Copy relative path", exact: true })
				.evaluate((node) => node === document.activeElement),
		).toBe(true);
		await page.keyboard.press("Enter");
		expect(await page.evaluate(() => (window as any).workspaceCalls.copied)).toEqual(["src/main.ts"]);
		expect(await mainTab.evaluate((node) => node === document.activeElement)).toBe(true);
		await page.keyboard.press("Shift+F10");
		await page.keyboard.press("Escape");
		await menu.waitFor({ state: "hidden" });
		expect(await mainTab.evaluate((node) => node === document.activeElement)).toBe(true);
		await shot(page, "tabs-light");
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await mainTab.click({ button: "right" });
		await menu.waitFor();
		await shot(page, "tabs-dark-menu");
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Close src/main.ts", exact: true }).click();
		await mainTab.waitFor({ state: "hidden" });
		const readme = page.getByRole("tab", { name: "README.md", exact: true });
		expect(await readme.getAttribute("aria-selected")).toBe("true");
		await page.getByRole("button", { name: "Close README.md", exact: true }).click();
		await readme.waitFor({ state: "hidden" });
		const files = page.getByRole("complementary", { name: "Files", exact: true });
		await vi.waitFor(async () => expect(await files.evaluate((node) => node === document.activeElement)).toBe(true));
		const readsBefore = await page.evaluate(() => (window as any).workspaceCalls.reads.length);
		await files.getByRole("button", { name: "main.ts", exact: true }).click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("original"));
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads.length)).toBeGreaterThan(readsBefore);
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test.each(["Close all", "Close others"] as const)(
	"%s uses files that finish opening while the tab menu is visible",
	async (action) => {
		const { page, errors } = await openCode();
		try {
			await openMain(page);
			await page
				.getByRole("complementary", { name: "Files", exact: true })
				.getByRole("button", { name: "README.md", exact: true })
				.click();
			await vi.waitFor(async () => expect(await editorText(page)).toContain("Fixture project"));
			const main = page.getByRole("tab", { name: "main.ts", exact: true });
			await main.click();
			await page.evaluate(() => {
				(window as any).holdReadPath = "notes.txt";
			});
			await page.keyboard.press("Meta+P");
			const quickOpen = page.getByRole("dialog", { name: "Quick open file", exact: true });
			await quickOpen.getByRole("combobox", { name: "Find file by name or path", exact: true }).fill("notes.txt");
			await quickOpen.getByRole("option").first().click();
			await quickOpen.waitFor({ state: "hidden" });
			await main.click({ button: "right" });
			const menu = page.getByRole("menu", { name: "Actions", exact: true });
			await menu.waitFor();
			await page.evaluate(() => (window as any).releaseFileRead());
			const late = page.getByRole("tab", { name: "notes.txt", exact: true });
			await late.waitFor();
			expect(await late.getAttribute("aria-selected")).toBe("true");
			await shot(page, `late-read-${action.replaceAll(" ", "-").toLowerCase()}`);
			await menu.getByRole("menuitem", { name: action, exact: true }).click();
			await vi.waitFor(async () =>
				expect(await page.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab").count()).toBe(
					action === "Close all" ? 0 : 1,
				),
			);
			await late.waitFor({ state: "hidden" });
			if (action === "Close others") {
				expect(await main.getAttribute("aria-selected")).toBe("true");
				expect(await editorText(page)).toContain("original");
			}
			expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	45_000,
);

test("bulk close confirms dirty targets atomically and preserves buffers in other repositories", async () => {
	const { page, errors } = await openCode();
	const prompts: string[] = [];
	let accept = false;
	page.on("dialog", async (dialog) => {
		prompts.push(dialog.message());
		if (accept) await dialog.accept();
		else await dialog.dismiss();
	});
	try {
		await openMain(page);
		await replaceText(page, 'export const message = "primary draft";\n');
		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "README.md", exact: true })
			.click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("Fixture project"));
		const roots = page.getByRole("combobox", { name: "Code repository", exact: true });
		await choose(roots, `${ROOT}-other`);
		await openMain(page);
		await replaceText(page, 'export const message = "other repository draft";\n');
		await choose(roots, ROOT);
		const readme = page.getByRole("tab", { name: "README.md", exact: true });
		await readme.click();
		await readme.click({ button: "right" });
		const menu = page.getByRole("menu", { name: "Actions", exact: true });
		await menu.getByRole("menuitem", { name: "Close others", exact: true }).click();
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain("src/main.ts");
		expect(prompts[0]).not.toContain("README.md");
		expect(await page.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab").count()).toBe(2);
		await page.getByRole("tab", { name: /main.ts/ }).click();
		expect(await editorText(page)).toContain("primary draft");
		accept = true;
		await readme.click({ button: "right" });
		await menu.getByRole("menuitem", { name: "Close others", exact: true }).click();
		await page.getByRole("tab", { name: /main.ts/ }).waitFor({ state: "hidden" });
		expect(prompts).toHaveLength(2);
		await readme.click({ button: "right" });
		await menu.getByRole("menuitem", { name: "Close all", exact: true }).click();
		await readme.waitFor({ state: "hidden" });
		expect(prompts).toHaveLength(2);
		await choose(roots, `${ROOT}-other`);
		const other = page.getByRole("tab", { name: /main.ts/ });
		await other.click();
		expect(await editorText(page)).toContain("other repository draft");
		accept = false;
		await other.click({ button: "right" });
		await menu.getByRole("menuitem", { name: "Close all", exact: true }).click();
		expect(prompts).toHaveLength(3);
		expect(await editorText(page)).toContain("other repository draft");
		accept = true;
		await other.click({ button: "right" });
		await menu.getByRole("menuitem", { name: "Close all", exact: true }).click();
		await other.waitFor({ state: "hidden" });
		expect(prompts).toHaveLength(4);
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);
