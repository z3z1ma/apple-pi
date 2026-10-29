import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { WorkspaceDiff, WorkspacePath, WorkspaceSave } from "../src/workspace.js";
import type { WorldSnapshot } from "../src/world.js";

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

async function openCode() {
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
		({ root, linked }) => {
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
			w.workspaceCalls = {
				repositories: 0,
				files: [],
				worktrees: [],
				trees: [],
				reads: [],
				saves: [],
				status: [],
				diffs: [],
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
			w.agentWorld = {
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
					gitStatus: async (request: { root: string }) => {
						w.workspaceCalls.status.push(structuredClone(request));
						return {
							ok: true,
							branch: "feature/editor",
							entries: [
								{ path: "src/main.ts", index: "M", worktree: "M" },
								{ path: "notes.txt", index: "?", worktree: "?" },
								...(w.extraGitEntries ?? []),
							],
						};
					},
					gitDiff: async (request: WorkspaceDiff) => {
						w.workspaceCalls.diffs.push(structuredClone(request));
						const text =
							request.path === "notes.txt"
								? ""
								: `diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,2 +1,61 @@\n-old value\n+${request.staged ? "staged change" : "working change"}\n${Array.from({ length: 60 }, (_, i) => `+line ${i}: ${"long value ".repeat(20)}`).join("\n")}`;
						w.lastGitDiff = text;
						return { ok: true, text };
					},
				},
			};
		},
		{ root: ROOT, linked: LINKED_ROOT },
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
		for (const name of ["Refresh files", "Refresh Git", "Check for file changes", "Save"]) {
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
		expect(await editorText(page)).toContain("operator draft");
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		await shot(page, "dirty-retained");
		await page.getByRole("button", { name: "View unstaged diff: src/main.ts", exact: true }).click();
		const preview = page.getByRole("region", { name: "Git diff", exact: true });
		await preview.waitFor();
		expect(await editor(page).isVisible()).toBe(false);
		await page.keyboard.press("Meta+S");
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		await shot(page, "dirty-diff-preview");
		await preview.getByRole("button", { name: "Close diff", exact: true }).click();
		await editor(page).waitFor();
		expect(await editorText(page)).toContain("operator draft");
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

test("Git distinguishes staged and working diffs without opening files or writing", async () => {
	const { page, errors } = await openCode();
	try {
		const git = page.getByRole("region", { name: "Source control", exact: true });
		const preview = page.getByRole("region", { name: "Git diff", exact: true });
		await git
			.getByRole("region", { name: "Staged", exact: true })
			.getByRole("button", { name: "Open file: src/main.ts", exact: true })
			.waitFor();
		await git
			.getByRole("region", { name: "Unstaged", exact: true })
			.getByRole("button", { name: "Open file: src/main.ts", exact: true })
			.waitFor();
		await git.getByRole("button", { name: "View staged diff: src/main.ts", exact: true }).click();
		await preview.getByText(/\+staged change/).waitFor();
		await git.getByRole("button", { name: "View unstaged diff: src/main.ts", exact: true }).click();
		await preview.getByText(/\+working change/).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.diffs)).toEqual([
			{ root: ROOT, path: "src/main.ts", staged: true },
			{ root: ROOT, path: "src/main.ts", staged: false },
		]);
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual([]);
		const previewBox = await preview.boundingBox();
		const sidebarBox = await git.boundingBox();
		expect(previewBox!.width).toBeGreaterThan(sidebarBox!.width);
		expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(sidebarBox!.x);
		expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
		const diff = preview.locator("pre");
		expect(await diff.textContent()).toBe(await page.evaluate(() => (window as any).lastGitDiff));
		expect(await diff.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
		await shot(page, "git-light-diff");
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await diff.evaluate((node) => {
			node.scrollLeft = node.scrollWidth;
			node.scrollTop = node.scrollHeight;
		});
		expect(await diff.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
		await shot(page, "git-dark-diff-scrolled");
		await git.getByRole("button", { name: "View untracked diff: notes.txt", exact: true }).click();
		await preview
			.getByText("No text diff. Open the file to inspect untracked or binary content.", { exact: true })
			.waitFor();
		await shot(page, "git-readonly");
		await git.getByRole("button", { name: "Open file: notes.txt", exact: true }).click();
		await page.getByRole("tab", { name: "notes.txt", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual(
			expect.arrayContaining([{ root: ROOT, path: "notes.txt" }]),
		);
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
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
		const entries = await select.locator("option").evaluateAll((options) =>
			options.map((option) => ({
				value: (option as HTMLOptionElement).value,
				text: option.textContent ?? "",
				disabled: (option as HTMLOptionElement).disabled,
			})),
		);
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
		await select.selectOption(LINKED_ROOT);
		await vi.waitFor(async () =>
			expect(await page.getByRole("combobox", { name: "Code repository", exact: true }).inputValue()).toBe(LINKED_ROOT),
		);
		await openMain(page);
		await replaceText(page, 'export const message = "linked-root draft";\n');
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual(
			expect.arrayContaining([{ root: LINKED_ROOT, path: "src/main.ts" }]),
		);
		await shot(page, "linked-worktree-draft");
		await select.selectOption(ROOT);
		await page.getByRole("tab", { name: /main\.ts/ }).click();
		expect(await editorText(page)).toContain("original-root draft");
		await select.selectOption(LINKED_ROOT);
		await page.getByRole("tab", { name: /main\.ts/ }).click();
		expect(await editorText(page)).toContain("linked-root draft");
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(await page.evaluate(() => (window as any).workspaceCalls.diffs)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("compact Git rows keep long renamed paths readable by tooltip and the file action reachable", async () => {
	const { page, errors } = await openCode();
	try {
		await page.setViewportSize({ width: 900, height: 800 });
		const path = "packages/reporting workspace/src/reconciliation/monthly-output-with-detailed-ledger-labels.ts";
		const previous = "packages/reporting workspace/src/legacy/monthly-output-before-rename.ts";
		await page.evaluate(
			([path, previous]) => {
				(window as any).extraGitEntries = [{ path, previousPath: previous, index: "R", worktree: " " }];
				(window as any).workspaceDisk[path!] = {
					text: 'export const label = "long path file";\n',
					hash: "long-path-hash",
				};
			},
			[path, previous],
		);
		const git = page.getByRole("region", { name: "Source control", exact: true });
		await git.getByRole("button", { name: "Refresh Git", exact: true }).click();
		const row = git.getByRole("button", { name: `View staged diff: ${path}`, exact: true });
		const open = git.getByRole("button", { name: `Open file: ${path}`, exact: true });
		await row.waitFor();
		expect(await row.getAttribute("title")).toBe(`${path} (from ${previous})`);
		expect(await row.innerText()).not.toContain("View diff");
		expect((await open.innerText()).trim()).toBe("");
		expect(await open.locator("svg").count()).toBe(1);
		const longBox = await row.boundingBox();
		const shortBox = await git
			.getByRole("button", { name: "View staged diff: src/main.ts", exact: true })
			.boundingBox();
		const iconBox = await open.boundingBox();
		const paneBox = await git.boundingBox();
		expect(longBox!.height).toBeCloseTo(shortBox!.height, 1);
		expect(longBox!.height).toBeCloseTo(iconBox!.height, 1);
		expect(longBox!.x + longBox!.width).toBeLessThanOrEqual(iconBox!.x);
		expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width);
		expect(paneBox!.x + paneBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
		await shot(page, "git-long-path-light");
		await row.click();
		await page.getByRole("region", { name: "Git diff", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).workspaceCalls.diffs)).toEqual([
			{ root: ROOT, path, staged: true },
		]);
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual([]);
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await shot(page, "git-long-path-dark");
		await open.click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("long path file"));
		expect(await page.evaluate(() => (window as any).workspaceCalls.reads)).toEqual(
			expect.arrayContaining([{ root: ROOT, path }]),
		);
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
			await page.getByRole("button", { name: "Open file: notes.txt", exact: true }).click();
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
		await roots.selectOption(`${ROOT}-other`);
		await openMain(page);
		await replaceText(page, 'export const message = "other repository draft";\n');
		await roots.selectOption(ROOT);
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
		await roots.selectOption(`${ROOT}-other`);
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
