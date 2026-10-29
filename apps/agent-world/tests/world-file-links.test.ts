import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { WorkspaceApi, WorkspacePath } from "../src/workspace.js";
import type { ConversationPage, WorldSnapshot } from "../src/world.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const ROOT = "/fixture/file-links";
const OTHER = `${ROOT}-other`;
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

async function openWorkplace() {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
	page.setDefaultTimeout(7000);
	const errors: string[] = [];
	const remoteRequests: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== ORIGIN) {
			remoteRequests.push(url.href);
			return route.abort();
		}
		const file = appFile(APP, url.pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		({ root, other }) => {
			const w = window as any;
			const now = Date.now();
			const bundle = `${root}/.ledger/review`;
			const world: WorldSnapshot = {
				connected: true,
				headquarters: [{ id: "ada", name: "Ada", wings: [] }],
				characters: [
					{
						id: "ada",
						name: "Ada",
						role: "worker",
						place: { kind: "headquarters", headquarters: "ada" },
						startedAt: now,
						facts: {
							run: "idle",
							status: "idle",
							asking: null,
							needsYouSince: null,
							unseen: false,
							seenAt: null,
							settledAt: null,
							tool: null,
							task: null,
							git: null,
							cwd: root,
							reportsTo: null,
							title: "Engineer",
							model: null,
							contextTokens: null,
							contextWindow: null,
							cost: 0,
							tmux: null,
						},
					},
				],
				dormant: [],
				mail: [],
				operatorMail: [{ id: "review-mail", subject: "Review these files", lastAt: now, unread: 1 }],
				workplace: {
					threads: [],
					tasks: [],
					escalations: [],
					workHistory: [
						{
							id: "review-task",
							title: "Review file references",
							headquarters: "ada",
							status: "done",
							bundle,
							project: root,
							thread: "task:review-task",
							openedAt: now,
							updatedAt: now,
							closedAt: now,
							participants: [{ person: "ada", assignedAt: now, endedAt: now, outcome: "finished", focused: false }],
						},
					],
				},
			};
			w.fileLinkCalls = {
				conversations: [],
				profiles: [],
				tasks: [],
				mail: [],
				resolves: [],
				reads: [],
				saves: [],
				external: [],
				osFiles: [],
			};
			w.deletedTarget = false;
			const body = [
				`Review ${root}/src/main.ts:3:5.`,
				"Relative `src/main.ts:3:5` and duplicate src/main.ts:3:5.",
				"Spaced `src/my file.ts` remains one filename.",
				"Missing src/missing.ts and ambiguous notes stay text.",
				"[Guide](https://example.com/guide) and [source](src/main.ts:3:5).",
				"<script>window.injectedFileLink = true</script>",
				"![remote image](https://example.com/image.png)",
			].join("\n\n");
			const workspace: WorkspaceApi = {
				resolvePaths: async (request) => {
					w.fileLinkCalls.resolves.push(structuredClone(request));
					const targets = new Map([
						[`${root}/src/main.ts`, { root, path: "src/main.ts" }],
						[`${bundle}/task.md`, { root, path: ".ledger/review/task.md" }],
						[`${root}/src/deleted.ts`, { root, path: "src/deleted.ts" }],
						[`${other}/src/other.ts`, { root: `${other}/src`, path: "other.ts" }],
					]);
					if (request.cwd === root) {
						targets.set("src/main.ts", { root, path: "src/main.ts" });
						targets.set("src/my file.ts", { root, path: "src/my file.ts" });
						targets.set("src/literal.ts:3:5", { root, path: "src/literal.ts:3:5" });
					}
					return {
						ok: true,
						files: request.paths.flatMap((candidate) => {
							const target = targets.get(candidate);
							return target ? [{ candidate, ...target }] : [];
						}),
					};
				},
				repositories: async () => ({ ok: true, roots: [root, other] }),
				files: async ({ root }) => ({ ok: true, root, paths: ["src/main.ts", "src/other.ts", "src/deleted.ts"] }),
				worktrees: async ({ root }) => ({ ok: true, root, worktrees: [] }),
				tree: async (request) => ({
					ok: true,
					...request,
					entries:
						request.path === ""
							? [{ name: "src", path: "src", kind: "directory" }]
							: [{ name: "main.ts", path: "src/main.ts", kind: "file" }],
				}),
				readFile: async (request) => {
					w.fileLinkCalls.reads.push(structuredClone(request));
					if (request.path === "src/deleted.ts" && w.deletedTarget)
						return { ok: false, reason: "The referenced file no longer exists." };
					return { ok: true, ...request, text: "one\ntwo\n0123456789\nfour\n", hash: "original" };
				},
				saveFile: async (request) => {
					w.fileLinkCalls.saves.push(structuredClone(request));
					return { ok: true, hash: "saved" };
				},
				gitStatus: async () => ({ ok: true, branch: "main", entries: [] }),
				gitDiff: async () => ({ ok: true, text: "" }),
			};
			w.agentWorld = {
				snapshot: async () => world,
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				onReceipt: () => () => {},
				onReply: () => () => {},
				onNotepad: () => () => {},
				watchReplies: async () => {},
				markSeen: async () => ({ ok: true }),
				profile: async (id: string) => {
					w.fileLinkCalls.profiles.push(id);
					return { ok: true, self: null };
				},
				conversation: async (id: string): Promise<ConversationPage> => {
					w.fileLinkCalls.conversations.push(id);
					return {
						ok: true,
						before: null,
						missing: 0,
						entries: [{ kind: "user", id: "paths", at: now, text: body, images: 0 }],
					};
				},
				readThread: async (id: string) => {
					w.fileLinkCalls.mail.push(id);
					return {
						ok: true,
						thread: {
							id,
							subject: "Review these files",
							closed: false,
							participants: [
								{ id: "operator", name: "Operator" },
								{ id: "ada", name: "Ada" },
							],
							messages: [
								{
									seq: 1,
									from: "ada",
									name: "Ada",
									at: now,
									body: `Other repository ${other}/src/other.ts:3:5, known relative src/main.ts:3:5, and deleted target ${root}/src/deleted.ts. Quoted 'src/my file.ts' and backticked \`src/my file.ts\` stay readable.`,
								},
								{ seq: 2, from: "unknown", name: "Unknown", at: now, body: "Unknown sender relative src/main.ts:3:5." },
							],
						},
					};
				},
				readTask: async (id: string) => {
					w.fileLinkCalls.tasks.push(id);
					return {
						ok: true,
						text: "# Review\n\nRead src/literal.ts:3:5 in the project, not the task bundle.",
						path: `${bundle}/task.md`,
					};
				},
				openLink: async (href: string) => {
					w.fileLinkCalls.external.push(href);
					return { ok: true };
				},
				openFile: async (...args: unknown[]) => {
					w.fileLinkCalls.osFiles.push(args);
					return { ok: true };
				},
				workspace,
			};
		},
		{ root: ROOT, other: OTHER },
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	return { page, errors, remoteRequests };
}

const calls = (page: Page) => page.evaluate(() => (window as any).fileLinkCalls);
async function readTargets(page: Page) {
	const reads: WorkspacePath[] = (await calls(page)).reads;
	return reads.filter(
		(read, index) => reads.findIndex((other) => other.root === read.root && other.path === read.path) === index,
	);
}
async function openDm(page: Page) {
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	await page.locator(".wp-chat-sidebar").getByRole("button", { name: /^Ada/ }).click();
	await page.getByRole("textbox", { name: "Reply to Ada", exact: true }).waitFor();
}
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-file-links-${name}.png`), animations: "disabled" });
}

const transcript = (page: Page) => page.getByRole("log", { name: "Transcript", exact: true });
const fileLink = (page: Page, text: string) => page.getByRole("link", { name: `Open file: ${text}`, exact: true });
async function openHistory(page: Page) {
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	await page.locator(".wp-chat-sidebar").getByRole("button", { name: "View profile: Ada", exact: true }).click();
	const profile = page.getByRole("complementary", { name: "Profile: Ada", exact: true });
	await profile.getByRole("button", { name: "View all recorded work (1)", exact: true }).click();
	return page.getByRole("dialog", { name: "Recorded work", exact: true });
}
async function codeReady(page: Page, path: string) {
	await page.getByRole("region", { name: "Code workspace", exact: true }).waitFor();
	await page
		.getByRole("tab")
		.and(page.locator(`[title="${path}"]`))
		.waitFor();
	await vi.waitFor(async () =>
		expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("0123456789"),
	);
}

test("DM file references are safe lazy links that keyboard-open positioned Code before its first visit", async () => {
	const { page, errors, remoteRequests } = await openWorkplace();
	try {
		await openHistory(page);
		expect((await calls(page)).conversations).toEqual([]);
		expect((await calls(page)).tasks).toEqual([]);
		expect((await calls(page)).reads).toEqual([]);
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Close profile", exact: true }).click();
		await openDm(page);
		const relative = transcript(page).getByRole("link", { name: "Open file: src/main.ts:3:5", exact: true });
		await relative.first().waitFor();
		expect(await relative.count()).toBe(2);
		await fileLink(page, `${ROOT}/src/main.ts:3:5`).waitFor();
		expect(await transcript(page).textContent()).toContain("Missing src/missing.ts and ambiguous notes stay text.");
		expect(
			await transcript(page)
				.getByRole("link", { name: /missing|ambiguous notes/ })
				.count(),
		).toBe(0);
		expect(await transcript(page).locator("a a").count()).toBe(0);
		expect(await transcript(page).textContent()).toContain("<script>window.injectedFileLink = true</script>");
		expect(await transcript(page).locator("script").count()).toBe(0);
		expect(await transcript(page).locator('img[alt="remote image"]').count()).toBe(0);
		expect((await calls(page)).reads).toEqual([]);
		await transcript(page).getByRole("link", { name: "Guide", exact: true }).click();
		expect((await calls(page)).external).toEqual(["https://example.com/guide"]);
		expect((await calls(page)).reads).toEqual([]);
		await page.keyboard.press("Tab");
		await relative.first().focus();
		expect(await relative.first().evaluate((node) => node === document.activeElement)).toBe(true);
		await shot(page, "dm-light-focus");
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await relative.first().focus();
		await shot(page, "dm-dark-focus");
		await page.keyboard.press("Enter");
		await codeReady(page, "src/main.ts");
		expect(await readTargets(page)).toEqual([{ root: ROOT, path: "src/main.ts" }]);
		await page.keyboard.insertText("HERE");
		await vi.waitFor(async () =>
			expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("0123HERE456789"),
		);
		await openDm(page);
		const spaced = transcript(page)
			.locator("code")
			.getByRole("link", { name: "Open file: src/my file.ts", exact: true });
		await spaced.click();
		await codeReady(page, "src/my file.ts");
		expect((await calls(page)).reads.at(-1)).toEqual({ root: ROOT, path: "src/my file.ts" });
		await page.getByRole("tab").and(page.locator('[title="src/main.ts"]')).click();
		expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("0123HERE456789");
		expect((await calls(page)).saves).toEqual([]);
		expect((await calls(page)).osFiles).toEqual([]);
		expect(remoteRequests).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40_000);

test("mail links open their own canonical root, preserve dirty buffers and surface a deleted target", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await openDm(page);
		await page.getByRole("link", { name: "Open file: source", exact: true }).click();
		await codeReady(page, "src/main.ts");
		await page.keyboard.insertText("DRAFT");
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: /^Review these files/ }).click();
		await fileLink(page, `${OTHER}/src/other.ts:3:5`).waitFor();
		await fileLink(page, "src/main.ts:3:5").waitFor();
		const known = page.locator(".wp-message").filter({ hasText: "Other repository" });
		await fileLink(page, "src/my file.ts").first().waitFor();
		expect(await fileLink(page, "src/my file.ts").count()).toBe(2);
		expect(await known.textContent()).toContain("'src/my file.ts'");
		expect(await known.textContent()).toContain("`src/my file.ts`");
		const unknown = page.locator(".wp-message").filter({ hasText: "Unknown sender relative" });
		await unknown.waitFor();
		expect(await unknown.textContent()).toContain("Unknown sender relative src/main.ts:3:5.");
		expect(await unknown.getByRole("link").count()).toBe(0);
		expect(await readTargets(page)).toEqual([{ root: ROOT, path: "src/main.ts" }]);
		await shot(page, "mail-light");
		await fileLink(page, `${OTHER}/src/other.ts:3:5`).click();
		await codeReady(page, "other.ts");
		expect((await calls(page)).reads.at(-1)).toEqual({ root: `${OTHER}/src`, path: "other.ts" });
		await page.getByRole("combobox", { name: "Code repository", exact: true }).selectOption(ROOT);
		await page.getByRole("tab").and(page.locator('[title="src/main.ts"]')).click();
		await vi.waitFor(async () =>
			expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("0123DRAFT456789"),
		);
		expect(await readTargets(page)).toEqual([
			{ root: ROOT, path: "src/main.ts" },
			{ root: `${OTHER}/src`, path: "other.ts" },
		]);
		expect((await calls(page)).saves).toEqual([]);
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await fileLink(page, "src/my file.ts").first().click();
		await codeReady(page, "src/my file.ts");
		expect((await calls(page)).reads.at(-1)).toEqual({ root: ROOT, path: "src/my file.ts" });
		await page.getByRole("tab").and(page.locator('[title="src/main.ts"]')).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await fileLink(page, `${ROOT}/src/deleted.ts`).waitFor();
		await page.evaluate(() => {
			(window as any).deletedTarget = true;
		});
		await fileLink(page, `${ROOT}/src/deleted.ts`).click();
		await page.getByRole("alert").filter({ hasText: "The referenced file no longer exists." }).waitFor();
		expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("0123DRAFT456789");
		expect((await calls(page)).saves).toEqual([]);
		expect((await calls(page)).osFiles).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40_000);

test("task document and body links stay lazy, close the modal and prefer a literal colon filename", async () => {
	const { page, errors } = await openWorkplace();
	try {
		let history = await openHistory(page);
		expect((await calls(page)).tasks).toEqual([]);
		await history.getByRole("button", { name: "Read task: Review file references", exact: true }).click();
		await fileLink(page, `${ROOT}/.ledger/review/task.md`).waitFor();
		await fileLink(page, "src/literal.ts:3:5").waitFor();
		expect((await calls(page)).tasks).toEqual(["review-task"]);
		expect((await calls(page)).conversations).toEqual([]);
		expect((await calls(page)).reads).toEqual([]);
		await shot(page, "task-light");
		await fileLink(page, `${ROOT}/.ledger/review/task.md`).click();
		await codeReady(page, ".ledger/review/task.md");
		expect(await page.getByRole("dialog", { name: "Recorded work", exact: true }).count()).toBe(0);
		await page.keyboard.insertText("TASK");
		await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
		history = await openHistory(page);
		expect((await calls(page)).tasks).toEqual(["review-task"]);
		await history.getByRole("button", { name: "Read task: Review file references", exact: true }).click();
		await fileLink(page, "src/literal.ts:3:5").click();
		await codeReady(page, "src/literal.ts:3:5");
		expect(await page.getByRole("dialog", { name: "Recorded work", exact: true }).count()).toBe(0);
		expect(await readTargets(page)).toEqual([
			{ root: ROOT, path: ".ledger/review/task.md" },
			{ root: ROOT, path: "src/literal.ts:3:5" },
		]);
		await page.keyboard.insertText("LITERAL");
		await vi.waitFor(async () =>
			expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("LITERALone"),
		);
		await page.getByRole("tab").and(page.locator('[title=".ledger/review/task.md"]')).click();
		expect(await page.locator(".monaco-editor .view-lines").textContent()).toContain("TASKone");
		expect((await calls(page)).saves).toEqual([]);
		expect((await calls(page)).osFiles).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 40_000);
