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
	await page.addInitScript((root) => {
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
		w.workspaceCalls = { repositories: 0, trees: [], reads: [], saves: [], status: [], diffs: [] };
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
					return { ok: true, roots: [root] };
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
					return { ok: true, ...request, ...w.workspaceDisk[request.path] };
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
	}, ROOT);
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
		await page.getByRole("button", { name: "Check disk", exact: true }).click();
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
