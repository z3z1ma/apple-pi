import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { TerminalApi, TerminalEvent } from "../src/terminal.js";
import type { WorkspaceApi } from "../src/workspace.js";
import type { WorldSnapshot } from "../src/world.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const ROOT = "/fixture/terminal-project";
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

async function openCode(startupQuery = false) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
	page.setDefaultTimeout(7000);
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
	await page.addInitScript(
		({ root, startupQuery }) => {
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
			const listeners = new Set<(event: TerminalEvent) => void>();
			w.terminalCalls = { creates: [], writes: [], resizes: [], closes: [], events: [], order: [], saves: [] };
			w.terminalEvent = (event: TerminalEvent) => {
				w.terminalCalls.events.push(structuredClone(event));
				for (const listener of listeners) listener(event);
			};
			const terminal: TerminalApi = {
				onEvent: (listener) => {
					w.terminalCalls.order.push("subscribe");
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
						w.terminalCalls.order.push("unsubscribe");
					};
				},
				create: async (request) => {
					w.terminalCalls.creates.push({ ...request, listeners: listeners.size });
					w.terminalCalls.order.push("create");
					w.terminalEvent({
						type: "data",
						id: request.id,
						data: "\r\n\x1b[32mEarly shell output\x1b[0m\r\n\x1b[38;2;70;140;220mTrue color output\x1b[0m\r\nfixture$ ",
					});
					if (startupQuery) {
						w.terminalEvent({ type: "data", id: request.id, data: "\x1b[6n" });
						await new Promise<void>((resolve) => {
							w.releaseTerminalCreate = resolve;
						});
					}
					return { ok: true, session: { id: request.id, cwd: `${request.cwd}/canonical`, shell: "/bin/sh" } };
				},
				write: async (request) => {
					w.terminalCalls.writes.push(structuredClone(request));
					return { ok: true };
				},
				resize: async (request) => {
					w.terminalCalls.resizes.push(structuredClone(request));
					return { ok: true };
				},
				close: async (request) => {
					w.terminalCalls.closes.push(structuredClone(request));
					return { ok: true };
				},
			};
			const workspace: WorkspaceApi = {
				resolvePaths: async () => ({ ok: true, files: [] }),
				repositories: async () => ({ ok: true, roots: [root, `${root}-other`] }),
				files: async ({ root }) => ({ ok: true, root, paths: ["main.ts"] }),
				worktrees: async ({ root }) => ({ ok: true, root, worktrees: [] }),
				tree: async (request) => ({
					ok: true,
					...request,
					entries: [{ name: "main.ts", path: "main.ts", kind: "file" }],
				}),
				readFile: async (request) => ({
					ok: true,
					...request,
					text: "export const fixture = true;\n",
					hash: "fixture-hash",
				}),
				saveFile: async (request) => {
					w.terminalCalls.saves.push(structuredClone(request));
					return { ok: true, hash: "saved-hash" };
				},
				gitStatus: async () => ({ ok: true, branch: "fixture", entries: [] }),
				gitDiff: async () => ({ ok: true, text: "" }),
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
				terminal,
				workspace,
			};
		},
		{ root: ROOT, startupQuery },
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	expect(await page.evaluate(() => (window as any).terminalCalls.creates)).toEqual([]);
	await page.getByRole("button", { name: "Code", exact: true }).click();
	await page.getByRole("region", { name: "Code workspace", exact: true }).waitFor();
	return { page, errors };
}

const terminalPane = (page: Page) => page.getByRole("region", { name: "Integrated terminal", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as any).terminalCalls);

async function createTerminal(page: Page) {
	const previous = (await calls(page)).creates.length;
	await page.getByRole("button", { name: "New terminal", exact: true }).click();
	await vi.waitFor(async () => expect((await calls(page)).creates).toHaveLength(previous + 1));
	await terminalPane(page).locator("canvas").last().waitFor();
}

async function expectTerminalPalette(canvas: Locator) {
	await vi.waitFor(async () => {
		const colors = await canvas.evaluate((node) => {
			const rendered = node as HTMLCanvasElement;
			const sample = document.createElement("canvas");
			const context = sample.getContext("2d")!;
			context.fillStyle = getComputedStyle(node.closest(".wp-terminal-host")!).backgroundColor;
			context.fillRect(0, 0, 1, 1);
			return {
				host: [...context.getImageData(0, 0, 1, 1).data],
				cell: [
					...rendered
						.getContext("2d")!
						.getImageData(Math.floor(rendered.width / 2), Math.floor(rendered.height / 2), 1, 1).data,
				],
			};
		});
		expect(colors.host).toEqual([27, 29, 33, 255]);
		expect(colors.cell).toEqual(colors.host);
	});
}

test("only explicit creation starts the fixed-palette canvas terminal, and input stays with the focused terminal or editor", async () => {
	const { page, errors } = await openCode();
	try {
		expect((await calls(page)).order).toEqual([]);
		await page.getByRole("button", { name: "Show terminal", exact: true }).click();
		await terminalPane(page).waitFor();
		expect((await calls(page)).creates).toEqual([]);
		expect((await calls(page)).order).toEqual([]);
		await createTerminal(page);
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).waitFor();
		const first = (await calls(page)).creates[0];
		expect(first.cwd).toBe(ROOT);
		expect(first.cols).toBeGreaterThan(0);
		expect(first.rows).toBeGreaterThan(0);
		expect(first.listeners).toBeGreaterThan(0);
		const canvas = terminalPane(page).locator("canvas");
		await expectTerminalPalette(canvas);
		await shot(page, "early-output-light");
		const beforeOutput = await canvas.screenshot({ animations: "disabled" });
		await page.evaluate(
			(id) => (window as any).terminalEvent({ type: "data", id, data: "\r\nVisible output after creation\r\n" }),
			first.id,
		);
		await vi.waitFor(async () =>
			expect(beforeOutput.equals(await canvas.screenshot({ animations: "disabled" }))).toBe(false),
		);
		await canvas.click();
		await page.keyboard.type("echo ready");
		await page.keyboard.press("Enter");
		await vi.waitFor(async () =>
			expect((await calls(page)).writes.map((write: any) => write.data).join("")).toBe("echo ready\r"),
		);
		expect((await calls(page)).writes.every((write: any) => write.id === first.id)).toBe(true);
		await page.evaluate(
			(id) => (window as any).terminalEvent({ type: "data", id, data: "echo ready\r\nready\r\nfixture$ " }),
			first.id,
		);
		const inputBeforeTheme = (await calls(page)).writes;
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await expectTerminalPalette(canvas);
		expect((await calls(page)).writes).toEqual(inputBeforeTheme);
		expect((await calls(page)).creates).toHaveLength(1);
		expect((await calls(page)).closes).toEqual([]);
		await shot(page, "output-dark");
		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "main.ts", exact: true })
			.click();
		const editor = page.locator(".monaco-editor");
		await editor.waitFor();
		const writeCount = (await calls(page)).writes.length;
		await editor.click();
		await page.keyboard.press("Meta+A");
		await page.keyboard.insertText("export const edited = true;\n");
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		expect((await calls(page)).writes).toHaveLength(writeCount);
		expect((await calls(page)).saves).toEqual([]);
		await terminalPane(page).locator("canvas").click();
		await page.keyboard.press("Control+C");
		await vi.waitFor(async () => expect((await calls(page)).writes.at(-1)).toEqual({ id: first.id, data: "\u0003" }));
		await shot(page, "editor-and-terminal");
		await createTerminal(page);
		await expectTerminalPalette(terminalPane(page).locator("canvas").last());
		await shot(page, "created-dark");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("hiding, retained World and repository changes preserve the shell and draft; new terminals use the selected root", async () => {
	const { page, errors } = await openCode();
	try {
		await page.getByRole("button", { name: "Show terminal", exact: true }).click();
		await createTerminal(page);
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).waitFor();
		const first = (await calls(page)).creates[0];
		await page
			.getByRole("complementary", { name: "Files", exact: true })
			.getByRole("button", { name: "main.ts", exact: true })
			.click();
		const editor = page.locator(".monaco-editor");
		await editor.waitFor();
		await editor.click();
		await page.keyboard.press("Meta+A");
		await page.keyboard.insertText("export const retainedThroughWorld = true;\n");
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		await page.getByRole("button", { name: "World", exact: true }).click();
		await page.frameLocator('iframe[title="Agent World"]').locator("canvas").waitFor();
		expect(new URL(page.url()).search).toBe("?workplace=world");
		expect((await calls(page)).creates).toHaveLength(1);
		expect((await calls(page)).closes).toEqual([]);
		await shot(page, "retained-world");
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).waitFor();
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		expect(await editor.locator(".view-lines").textContent()).toContain("retainedThroughWorld");
		expect((await calls(page)).saves).toEqual([]);
		await page.getByRole("button", { name: "Hide terminal", exact: true }).click();
		expect(await terminalPane(page).locator("canvas:visible").count()).toBe(0);
		await page.getByRole("button", { name: "Show terminal", exact: true }).waitFor();
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await page.getByRole("combobox", { name: "Code repository", exact: true }).selectOption(`${ROOT}-other`);
		await page.getByRole("button", { name: "Show terminal", exact: true }).click();
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).waitFor();
		expect((await calls(page)).creates).toHaveLength(1);
		expect((await calls(page)).closes).toEqual([]);
		await createTerminal(page);
		await page.getByRole("tab", { name: `Terminal 2: ${ROOT}-other/canonical`, exact: true }).waitFor();
		const created = (await calls(page)).creates;
		expect(created).toHaveLength(2);
		expect(created[1].cwd).toBe(`${ROOT}-other`);
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).click();
		await terminalPane(page).locator("canvas:visible").click();
		await page.keyboard.type("pwd");
		await vi.waitFor(async () =>
			expect((await calls(page)).writes.map((write: any) => write.data).join("")).toBe("pwd"),
		);
		expect((await calls(page)).writes.every((write: any) => write.id === first.id)).toBe(true);
		await shot(page, "retained-across-roots");
		expect((await calls(page)).closes).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("startup cursor queries receive protocol replies before create resolves, but never after exit", async () => {
	const { page, errors } = await openCode(true);
	try {
		await page.getByRole("button", { name: "Show terminal", exact: true }).click();
		await createTerminal(page);
		const id = (await calls(page)).creates[0].id;
		await vi.waitFor(async () =>
			expect((await calls(page)).writes).toContainEqual({ id, data: expect.stringMatching(/^\x1b\[\d+;\d+R$/) }),
		);
		await page.evaluate(() => (window as any).releaseTerminalCreate());
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).waitFor();
		const count = (await calls(page)).writes.length;
		await page.evaluate((id) => {
			(window as any).terminalEvent({ type: "exit", id, exitCode: 0 });
			(window as any).terminalEvent({ type: "data", id, data: "\x1b[6n" });
		}, id);
		await terminalPane(page).getByText("Exited with code 0", { exact: true }).waitFor();
		await nextLayout(page);
		expect((await calls(page)).writes).toHaveLength(count);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

async function unloadIsGuarded(page: Page) {
	return page.evaluate(() => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	});
}

async function nextLayout(page: Page) {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
}

test("the terminal uses only central editor space, resizes while visible and releases the unload guard after exit or close", async () => {
	const { page, errors } = await openCode();
	try {
		expect(await unloadIsGuarded(page)).toBe(false);
		const files = page.getByRole("complementary", { name: "Files", exact: true });
		const git = page.getByRole("region", { name: "Source control", exact: true });
		await files.getByRole("button", { name: "main.ts", exact: true }).click();
		const editor = page.locator(".monaco-editor");
		await editor.waitFor();
		const before = {
			files: await files.boundingBox(),
			git: await git.boundingBox(),
			editor: await editor.boundingBox(),
		};
		await page.getByRole("button", { name: "Show terminal", exact: true }).click();
		await createTerminal(page);
		await page.getByRole("tab", { name: `Terminal 1: ${ROOT}/canonical`, exact: true }).waitFor();
		await vi.waitFor(async () => expect(await unloadIsGuarded(page)).toBe(true));
		expect(await files.boundingBox()).toEqual(before.files);
		expect(await git.boundingBox()).toEqual(before.git);
		await vi.waitFor(async () => expect((await editor.boundingBox())!.height).toBeLessThan(before.editor!.height));
		const pane = (await terminalPane(page).boundingBox())!;
		const editorBox = (await editor.boundingBox())!;
		expect(pane.x).toBeGreaterThanOrEqual(before.files!.x + before.files!.width);
		expect(pane.x + pane.width).toBeLessThanOrEqual(before.git!.x);
		expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(pane.y + 1);
		expect(pane.y + pane.height).toBeLessThanOrEqual(900);
		await shot(page, "center-dock");
		const resizeCount = (await calls(page)).resizes.length;
		await page.setViewportSize({ width: 1100, height: 700 });
		await vi.waitFor(async () => expect((await calls(page)).resizes.length).toBeGreaterThan(resizeCount));
		for (const resize of (await calls(page)).resizes) {
			expect(resize.cols).toBeGreaterThan(0);
			expect(resize.rows).toBeGreaterThan(0);
		}
		await page.getByRole("button", { name: "Hide terminal", exact: true }).click();
		await nextLayout(page);
		const hiddenCount = (await calls(page)).resizes.length;
		await page.setViewportSize({ width: 1280, height: 800 });
		await nextLayout(page);
		expect((await calls(page)).resizes).toHaveLength(hiddenCount);
		expect(await unloadIsGuarded(page)).toBe(true);
		const stay = page.waitForEvent("dialog").then(async (dialog) => {
			expect(dialog.type()).toBe("beforeunload");
			await dialog.dismiss();
		});
		await page.evaluate(() => window.location.reload());
		await stay;
		expect((await calls(page)).creates).toHaveLength(1);
		expect((await calls(page)).closes).toEqual([]);
		await page.getByRole("button", { name: "Show terminal", exact: true }).click();
		const id = (await calls(page)).creates[0].id;
		await page.evaluate((id) => (window as any).terminalEvent({ type: "exit", id, exitCode: 7 }), id);
		await terminalPane(page).getByText("Exited with code 7", { exact: true }).waitFor();
		await vi.waitFor(async () => expect(await unloadIsGuarded(page)).toBe(false));
		const writes = (await calls(page)).writes.length;
		await terminalPane(page).locator("canvas").click();
		await page.keyboard.type("ignored after exit");
		expect((await calls(page)).writes).toHaveLength(writes);
		await shot(page, "exited");
		await page.getByRole("button", { name: "Close terminal 1", exact: true }).click();
		await terminalPane(page).locator("canvas").waitFor({ state: "detached" });
		expect(await terminalPane(page).getByRole("tab").count()).toBe(0);
		expect((await calls(page)).closes).toContainEqual({ id });
		await createTerminal(page);
		await page.getByRole("tab", { name: `Terminal 2: ${ROOT}/canonical`, exact: true }).waitFor();
		await vi.waitFor(async () => expect(await unloadIsGuarded(page)).toBe(true));
		const runningId = (await calls(page)).creates[1].id;
		await page.getByRole("button", { name: "Close terminal 2", exact: true }).click();
		await vi.waitFor(async () => expect(await unloadIsGuarded(page)).toBe(false));
		expect(await terminalPane(page).getByRole("tab").count()).toBe(0);
		expect((await calls(page)).closes).toContainEqual({ id: runningId });
		expect((await calls(page)).saves).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-terminal-${name}.png`), animations: "disabled" });
}
