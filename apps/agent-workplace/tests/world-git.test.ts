import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { GitAction, GitCommit, GitDiffRequest, GitOverview } from "../src/git.js";
import type { WorldSnapshot } from "../src/world.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost";
const ROOT = "/fixture/atlas";
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

const NOW = 1_793_800_000;
const sha = (n: number) => `${n.toString(16).padStart(2, "0")}${"a1b2c3d4e5".repeat(4)}`.slice(0, 40);
const commit = (
	n: number,
	subject: string,
	parents: number[],
	refs: string[] = [],
	author = "Ada Lovelace",
): GitCommit => ({
	sha: sha(n),
	parents: parents.map(sha),
	author,
	email: `${author.split(" ")[0].toLowerCase()}@example.invalid`,
	date: NOW - n * 5400,
	subject,
	refs,
});
const COMMITS: GitCommit[] = [
	commit(1, "Merge branch 'feature/graph'", [2, 3], ["HEAD -> main"]),
	commit(2, "Tighten the commit list spacing", [4]),
	commit(3, "Draw lanes with smooth curves", [5], ["feature/graph", "origin/feature/graph"], "Grace Hopper"),
	commit(4, "Show ahead and behind counts", [6], ["origin/main"]),
	commit(5, "Lay out the commit graph", [6], [], "Grace Hopper"),
	commit(6, "Add the Git tab", [7], ["tag: v1.0"], "Linus Torvalds"),
	commit(7, "Initial commit", []),
];
const OVERVIEW: GitOverview = {
	root: ROOT,
	branch: "main",
	head: sha(1),
	upstream: "origin/main",
	ahead: 3,
	behind: 1,
	state: "clean",
	remotes: ["origin"],
	refs: [
		{ name: "main", kind: "local", target: sha(1), current: true, upstream: "origin/main", ahead: 3, behind: 1 },
		{
			name: "feature/graph",
			kind: "local",
			target: sha(3),
			current: false,
			upstream: "origin/feature/graph",
			ahead: 0,
			behind: 0,
		},
		{ name: "origin/main", kind: "remote", target: sha(4), current: false },
		{ name: "origin/feature/graph", kind: "remote", target: sha(3), current: false },
		{ name: "v1.0", kind: "tag", target: sha(6), current: false },
	],
	stashes: [{ index: 0, date: NOW - 7200, message: "On main: half-done toolbar" }],
	worktrees: [{ path: ROOT, branch: "main", head: sha(1), detached: false, bare: false, current: true }],
	changes: [
		{ path: "src/app.ts", index: " ", worktree: "M" },
		{ path: "README.md", index: "M", worktree: " " },
		{ path: "docs/new guide.md", index: "?", worktree: "?" },
	],
};
const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,7 @@ export function start() {
 	const app = createApp();
-	app.mount("#root");
+	app.mount("#workplace");
+	app.ready();
 	return app;
 }
`;

async function openGit(options: { height?: number; dark?: boolean } = {}) {
	const page = await browser.newPage({
		viewport: { width: 1440, height: options.height ?? 900 },
		colorScheme: options.dark ? "dark" : "light",
	});
	page.setDefaultTimeout(7000);
	const errors: string[] = [];
	const record = (message: string) => {
		errors.push(message);
		if (SHOTS) {
			mkdirSync(SHOTS, { recursive: true });
			appendFileSync(join(SHOTS, "browser-errors.log"), `${message}\n`);
		}
	};
	page.on("pageerror", (error) => record(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") record(message.text());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(APP, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		({ root, overview, commits, diff }) => {
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
			w.gitCalls = { runs: [] as unknown[], diffs: [] as unknown[], shows: [] as unknown[] };
			w.gitOverview = overview;
			Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
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
					repositories: async () => ({ ok: true, roots: [root] }),
					worktrees: async () => ({ ok: true, root, worktrees: overview.worktrees }),
				},
				git: {
					overview: async () => ({ ok: true, overview: w.gitOverview }),
					log: async (request: { skip: number; limit: number }) => ({
						ok: true,
						commits: commits.slice(request.skip, request.skip + request.limit),
					}),
					show: async (request: { sha: string }) => {
						w.gitCalls.shows.push(request.sha);
						const found = commits.find((each: GitCommit) => each.sha === request.sha) as GitCommit;
						return {
							ok: true,
							commit: {
								...found,
								body: `${found.subject}\n\nExplains why the change matters.`,
								committer: found.author,
								committed: found.date,
								files: [
									{ status: "M", path: "src/app.ts" },
									{ status: "A", path: "src/graph/lanes.ts" },
									{ status: "R", previousPath: "old.ts", path: "src/renamed.ts" },
								],
							},
						};
					},
					diff: async (request: GitDiffRequest) => {
						w.gitCalls.diffs.push(request);
						return { ok: true, text: diff };
					},
					run: async (request: { root: string; action: GitAction }) => {
						w.gitCalls.runs.push(request.action);
						if (request.action.kind === "deleteBranch" && !request.action.force)
							return { ok: false, reason: "error: the branch 'feature/graph' is not fully merged." };
						return { ok: true, output: "" };
					},
				},
			};
		},
		{ root: ROOT, overview: OVERVIEW, commits: COMMITS, diff: DIFF },
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	return { page, errors };
}

const runs = (page: Page) => page.evaluate(() => (window as any).gitCalls.runs);
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-git-${name}.png`), animations: "disabled" });
}
async function enter(page: Page) {
	await page.getByRole("button", { name: "Git", exact: true }).click();
	const git = page.getByRole("region", { name: "Git", exact: true });
	await git.getByRole("listbox", { name: "Commit graph" }).waitFor();
	return git;
}

test("the Git tab shows the branch, its graph, working changes and every branch from the rail", async () => {
	const { page, errors } = await openGit();
	try {
		const git = await enter(page);
		expect(new URL(page.url()).search).toBe("?workplace=git");
		const head = git.locator(".wp-gitx-head");
		await vi.waitFor(async () => expect(await head.innerText()).toMatch(/main\s*↑3\s*↓1/));
		const rows = git.getByRole("option");
		await vi.waitFor(async () => expect(await rows.count()).toBe(COMMITS.length + 1));
		expect(await rows.first().innerText()).toMatch(/Working changes\s*3 files/);
		expect(await git.locator("[data-sha] .wp-gitx-badge.is-head").innerText()).toBe("main");
		expect(await git.locator(".wp-gitx-badge.is-tag").innerText()).toBe("v1.0");
		expect(await git.locator(".wp-gitx-lanes circle").count()).toBe(COMMITS.length + 1);
		const merge = git.locator(`[data-sha="${sha(1)}"] .wp-gitx-lanes path`);
		expect(await merge.count()).toBeGreaterThanOrEqual(2);
		const sidebar = git.getByRole("complementary", { name: "Branches" });
		expect(await sidebar.innerText()).toMatch(/LOCAL\s*2[\s\S]*main[\s\S]*feature\/graph[\s\S]*ORIGIN\s*2/);
		const panel = git.getByRole("complementary", { name: "Working changes" });
		expect(await panel.getByRole("region", { name: "Unstaged", exact: true }).innerText()).toMatch(
			/src\/app.ts|app\.ts/,
		);
		expect(await panel.getByRole("region", { name: "Staged", exact: true }).innerText()).toContain("README.md");
		expect(await page.locator(".wp-code").count()).toBe(0);
		await shot(page, "light-overview");
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await shot(page, "dark-overview");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("staging, unstaging and committing call Git with the chosen files and the composed message", async () => {
	const { page, errors } = await openGit();
	try {
		const git = await enter(page);
		const panel = git.getByRole("complementary", { name: "Working changes" });
		await panel.getByRole("button", { name: "Stage: src/app.ts" }).click();
		await panel.getByRole("button", { name: "Unstage: README.md" }).click();
		await panel.getByRole("button", { name: "Stage all", exact: true }).click();
		await panel.getByRole("textbox", { name: "Commit summary" }).fill("Mount the workplace root");
		await panel.getByRole("textbox", { name: "Commit description" }).fill("The old #root id clashed.");
		await shot(page, "light-commit");
		await panel.getByRole("button", { name: /Commit 1 file to main/ }).click();
		await vi.waitFor(async () =>
			expect(await runs(page)).toEqual([
				{ kind: "stage", paths: ["src/app.ts"] },
				{ kind: "unstage", paths: ["README.md"] },
				{ kind: "stage", paths: ["src/app.ts", "docs/new guide.md"] },
				{ kind: "commit", message: "Mount the workplace root\n\nThe old #root id clashed.", amend: false },
			]),
		);
		expect(await panel.getByRole("textbox", { name: "Commit summary" }).inputValue()).toBe("");
		await git.locator(".wp-gitx-toast").waitFor();
		expect(await git.locator(".wp-gitx-toast").innerText()).toContain("Committed");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("a commit shows its details and files, and a file opens a numbered diff that Escape closes", async () => {
	const { page, errors } = await openGit();
	try {
		const git = await enter(page);
		await git.locator(`[data-sha="${sha(3)}"]`).click();
		const detail = git.getByRole("complementary", { name: "Commit details" });
		await detail.getByText("Draw lanes with smooth curves", { exact: true }).waitFor();
		expect(await detail.innerText()).toMatch(
			/Explains why the change matters[\s\S]*Grace Hopper[\s\S]*Parent[\s\S]*Changed files\s*3/i,
		);
		await detail.getByRole("button", { name: /lanes\.ts/ }).click();
		const diff = git.getByRole("region", { name: "Diff of src/graph/lanes.ts" });
		await diff.waitFor();
		expect(await page.evaluate(() => (window as any).gitCalls.diffs)).toEqual([
			{ root: ROOT, path: "src/graph/lanes.ts", commit: sha(3) },
		]);
		expect(await diff.locator(".wp-gitx-diff-stat").innerText()).toBe("+2 -1");
		const added = diff.locator(".wp-gitx-line.is-added").first();
		expect(await added.locator(".wp-gitx-number").nth(1).innerText()).toBe("11");
		expect(await added.locator("code").innerText()).toBe('\tapp.mount("#workplace");');
		expect(await diff.innerText()).not.toContain("diff --git");
		await shot(page, "light-diff");
		await page.keyboard.press("Escape");
		await git.getByRole("listbox", { name: "Commit graph" }).waitFor();
		await git.getByRole("option").nth(0).click();
		await git
			.getByRole("complementary", { name: "Working changes" })
			.getByRole("button", { name: "View unstaged diff: src/app.ts" })
			.click();
		await git.getByRole("region", { name: "Diff of src/app.ts" }).waitFor();
		expect((await page.evaluate(() => (window as any).gitCalls.diffs)).at(-1)).toEqual({
			root: ROOT,
			path: "src/app.ts",
			staged: false,
		});
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("branch and commit menus run checkouts, new branches and guarded destructive actions", async () => {
	const { page, errors } = await openGit({ dark: true });
	try {
		const git = await enter(page);
		const sidebar = git.getByRole("complementary", { name: "Branches" });
		await sidebar.getByRole("button", { name: "feature/graph", exact: false }).first().click({ button: "right" });
		await page.getByRole("menuitem", { name: "Check out feature/graph" }).click();
		await vi.waitFor(async () => expect((await runs(page)).at(-1)).toEqual({ kind: "checkout", ref: "feature/graph" }));
		await sidebar.getByRole("button", { name: "feature/graph", exact: false }).first().click({ button: "right" });
		await page.getByRole("menuitem", { name: /Delete feature\/graph/ }).click();
		await git
			.getByRole("dialog", { name: "Delete branch feature/graph?" })
			.getByRole("button", { name: "Delete" })
			.click();
		const force = git.getByRole("dialog", { name: "Force delete feature/graph?" });
		await force.waitFor();
		await shot(page, "dark-force-delete");
		await force.getByRole("button", { name: "Force delete" }).click();
		await vi.waitFor(async () =>
			expect((await runs(page)).slice(-2)).toEqual([
				{ kind: "deleteBranch", name: "feature/graph", force: false },
				{ kind: "deleteBranch", name: "feature/graph", force: true },
			]),
		);
		await git.locator(`[data-sha="${sha(4)}"]`).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Create branch here\u2026" }).click();
		const name = git.getByRole("dialog", { name: /New branch from/ });
		await name.getByRole("textbox").fill("release/2.0");
		await name.getByRole("button", { name: "Create and check out" }).click();
		await vi.waitFor(async () =>
			expect((await runs(page)).at(-1)).toEqual({
				kind: "createBranch",
				name: "release/2.0",
				from: sha(4),
				checkout: true,
			}),
		);
		await git.locator(`[data-sha="${sha(4)}"]`).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Reset main here: hard\u2026" }).click();
		await git
			.getByRole("dialog", { name: /Hard reset main/ })
			.getByRole("button", { name: "Cancel" })
			.click();
		const panel = git.getByRole("complementary", { name: "Working changes" });
		await panel.getByRole("button", { name: "Discard changes: src/app.ts" }).click();
		await git
			.getByRole("dialog", { name: "Discard changes to src/app.ts?" })
			.getByRole("button", { name: "Discard" })
			.click();
		await vi.waitFor(async () => expect((await runs(page)).at(-1)).toEqual({ kind: "discard", paths: ["src/app.ts"] }));
		expect((await runs(page)).some((action: GitAction) => action.kind === "reset")).toBe(false);
		await git.getByRole("button", { name: "Push" }).click();
		await git.getByRole("button", { name: "Fetch" }).click();
		await vi.waitFor(async () =>
			expect((await runs(page)).slice(-2)).toEqual([{ kind: "push", force: false }, { kind: "fetch" }]),
		);
		await shot(page, "dark-after-actions");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("when the rail is too short, apps it cannot fit move into More, which still opens them", async () => {
	const { page, errors } = await openGit({ height: 560 });
	try {
		const rail = page.getByRole("navigation", { name: "Applications" });
		const more = rail.getByRole("button", { name: "More apps" });
		await more.waitFor();
		const visible = await rail.locator(".wp-rail-apps > button:not(.wp-rail-more)").count();
		expect(visible).toBeLessThan(6);
		const railBox = (await rail.boundingBox())!;
		const moreBox = (await more.boundingBox())!;
		expect(moreBox.y + moreBox.height).toBeLessThanOrEqual(railBox.y + railBox.height);
		await shot(page, "light-rail-overflow");
		await more.click();
		await page.getByRole("menuitem", { name: "Git" }).click();
		await page.getByRole("region", { name: "Git", exact: true }).waitFor();
		expect(await rail.getByRole("button", { name: "More apps" }).getAttribute("aria-pressed")).toBe("true");
		expect(await rail.getByRole("button", { name: "More apps" }).innerText()).toContain("Git");
		await page.setViewportSize({ width: 1440, height: 900 });
		await vi.waitFor(async () => expect(await rail.getByRole("button", { name: "More apps" }).count()).toBe(0));
		expect(await rail.getByRole("button", { name: "Git", exact: true }).getAttribute("aria-pressed")).toBe("true");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);
