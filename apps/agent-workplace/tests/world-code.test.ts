import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { WorkspaceDiff, WorkspacePath, WorkspaceSave } from "../src/workspace.js";
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

test("Code reviews show retained evidence and explicit capture consent without losing a dirty editor", async () => {
	const { page, errors } = await openCode();
	try {
		await openMain(page);
		await replaceText(page, 'export const message = "keep draft";\n');
		await page.evaluate(() => {
			const w = window as any;
			w.reviewCalls = { captures: [], signOffs: [], sources: [], manage: [] };
			const review = {
				id: "review-fixture",
				state: "completed",
				phase: null,
				target: { kind: "commit", commit: "abc" },
				label: {
					repository: "project",
					branch: "main",
					head: "abcdef0123",
					subject: "Export the value",
					commits: null,
					files: 1,
				},
				passes: { required: 2, completed: 2 },
				findings: { reported: 1, confirmed: 1, unresolved: 0, responded: 0 },
				addressed: false,
				cost: {
					reportedDollars: 1.23,
					reportedAttempts: 4,
					totalAttempts: 4,
					tokens: { input: 576000, output: 2800, cacheRead: 1200000 },
				},
				createdAt: Date.now() - 300_000,
				settledAt: Date.now() - 28_000,
				ownerName: "Reviewer",
				owner: "owner",
				revision: 7,
				digest: "captured-digest",
				approval: null,
			};
			w.agentWorkplace.reviews = {
				queue: async (request: { hideAddressed?: boolean }) => ({
					total: request.hideAddressed ? 0 : 1,
					states: { completed: 1, queued: 2 },
					passes: { running: 3, limit: 8 },
					page: { offset: 0, nextOffset: null, rows: request.hideAddressed ? [] : [review] },
				}),
				analytics: async () => ({
					reviews: 1,
					settled: 1,
					dollars: 1.23,
					confirmed: 1,
					medianMinutes: 4.5,
					byModel: [
						{ model: "provider/strong", attempts: 2, dollars: 1, minutes: 9, confirmed: 1, severities: { high: 1 } },
					],
					byPhase: [{ kind: "focused", attempts: 2, dollars: 1, minutes: 9 }],
					recent: [],
				}),
				manage: async (request: unknown) => {
					w.reviewCalls.manage.push(request);
					return review;
				},
				read: async (request: { part: string }) => {
					const page = (rows: unknown[]) => ({ total: rows.length, page: { offset: 0, nextOffset: null, rows } });
					const at = Date.now() - 200_000;
					const question = {
						id: "value",
						question: "Does the exported value match its consumers?",
						verification: "Trace every import of value.",
					};
					const parts: Record<string, unknown> = {
						summary: {
							...review,
							summary:
								"Two scopes carry the risk.\n\n- The exported value changes for every consumer.\n- The rendering path reads it twice.",
							intent: "captured",
							priority: 0,
							coverage: {
								completedQuestions: 3,
								requiredQuestions: 4,
								unassignedRegions: 0,
								integrationOnlyRegions: 2,
								additionalRequests: 0,
							},
							reason: null,
						},
						thread: page([
							{
								seq: 1,
								sender: "harness",
								senderName: "the harness",
								body: "Review planned: 2 scopes, 3 passes.\n\n- value-correctness\n- rendering",
								at,
							},
							{
								seq: 2,
								sender: "operator",
								senderName: "Operator",
								body: "Please check the consumer too.",
								at: at + 60_000,
							},
						]),
						findings: page([
							{
								id: "attempt:stale-value",
								attempt: "attempt",
								pass: "value-correctness",
								finding: {
									id: "stale-value",
									title: "The value disagrees with its consumer",
									path: "value.ts",
									line: 1,
									side: "after",
									severity: "high",
									certainty: "confirmed",
									trigger: "Import the value from the consumer",
									invariant: "Producer and consumer agree",
									impact: "The consumer shows a stale total.",
									cause: "The export changed without its consumer.",
									correction: "Update the consumer.",
									evidence: [{ kind: "reproduced", detail: "The consumer test fails", provenance: "npm test" }],
									counterevidence: "None",
								},
								validation: {
									finding: "value-correctness:stale-value",
									disposition: "confirmed",
									reason: "Reproduced from the recorded test.",
									evidence: ["The recorded run fails on the stale total."],
									duplicateOf: null,
								},
								decision: null,
							},
						]),
						log: [
							{
								attempt: "a",
								pass: "value-correctness",
								kind: "focused",
								state: "running",
								model: "provider/strong",
								entries: [
									{ at, kind: "text", text: "Tracing every import of value." },
									{ at, kind: "tool", text: 'bash({"command":"npm test"})' },
									{ at, kind: "error", text: "bash: 1 test failed" },
								],
							},
						],
						target: {
							target: {
								digest: "d".repeat(64),
								repository: "/fixture/project",
								source: "/state/reviews/review-fixture/artifact/source",
								requested: { cwd: "/fixture/project", target: { kind: "commit", commit: "abc" } },
								base: "b".repeat(40),
								head: "abcdef0123".padEnd(40, "0"),
								baseTree: "c".repeat(40),
								headTree: "e".repeat(40),
								baseRevision: "base",
								headRevision: "review",
								intent: { origin: "task.md", text: "Export the value two.", hash: "f".repeat(64) },
								configuration: { hash: "a".repeat(64), roleReferences: 2, catalogIssues: 0 },
								files: 12,
								regions: 3,
								omissions: page([{ path: "assets/logo.png", reason: "Binary; text is not shown" }]),
							},
							reason: null,
						},
						plan: {
							summary: "Two scopes carry the risk.",
							integration: { role: "code-review-specialist", depth: "deep", questions: [question] },
							unscopedRegions: ["r1", "r2"],
							additionalWork: [],
							chunks: page([
								{
									id: "value",
									title: "Exported value",
									paths: ["value.ts", "src/consumers"],
									context: [],
									risks: [{ kind: "contract", reason: "Every consumer reads this value." }],
									passes: [
										{
											id: "value-correctness",
											role: "code-review-specialist",
											depth: "standard",
											lenses: ["correctness"],
											questions: [question],
										},
									],
									regions: ["r0"],
								},
								{
									id: "legacy",
									title: "Legacy scope",
									context: [],
									passes: [
										{
											id: "legacy-pass",
											role: "code-review-specialist",
											lenses: ["correctness"],
											questions: [question],
										},
									],
									regions: ["r9"],
								},
							]),
						},
						coverage: page([
							{
								pass: "value-correctness",
								question,
								state: "completed",
								reported: {
									question: "value",
									state: "completed",
									evidence: ["Traced the two imports."],
									reason: "",
								},
								challenge: null,
							},
							{
								pass: "integration",
								question: { ...question, id: "journey", question: "Does the whole change agree end to end?" },
								state: "challenged",
								reported: null,
								challenge: { reason: "The trace skipped the renderer." },
							},
						]),
						attempts: page([
							{
								id: "attempt",
								pass: "value-correctness",
								kind: "focused",
								role: "code-review-specialist",
								state: "completed",
								model: "provider/strong",
								thinking: "high",
								reason: null,
								usage: { cost: { total: 0.62 } },
								createdAt: at,
								finishedAt: at + 272_000,
								selected: true,
							},
						]),
						decisions: page([
							{
								id: "decision",
								kind: "finding",
								finding: "attempt:stale-value",
								review: "review-fixture",
								digest: "captured-digest",
								revision: 7,
								actor: "owner",
								createdAt: at,
								data: {
									disposition: "fixed-claimed",
									reason: "Updated the consumer.",
									evidence: ["commit abc"],
									verifiedAgainst: null,
								},
							},
						]),
						configuration: {
							configuration: {
								instructions: { planning: "Plan a risk-driven review.", inspection: "Inspect independently." },
								roleReferences: [{ role: "code-review-specialist", models: ["balanced", "provider/strong:high"] }],
								catalogIssues: 0,
							},
							note: "Captured review prompts and configured model references.",
						},
					};
					return parts[request.part];
				},
				source: async (request: { path?: string; side: string }) => {
					w.reviewCalls.sources.push(request);
					if (!request.path)
						return {
							review: review.id,
							kind: "files",
							side: request.side,
							total: 1,
							page: { offset: 0, nextOffset: null, rows: [{ path: "value.ts", mode: "100644", blob: "captured" }] },
						};
					return {
						review: review.id,
						kind: "file",
						side: request.side,
						file: { path: request.path },
						representation: "Text from captured blob.",
						note: "Live checkout is not checked.",
						page: { offset: 0, nextOffset: null, rows: ["original captured source"] },
					};
				},
				freshness: async () => ({
					requestedTarget: "changed",
					checkout: "changed",
					policy: "matches",
					checkedAt: 1,
					errors: [],
				}),
				preview: async () => ({
					digest: "preview-digest",
					changedPaths: 1,
					lines: ["Directory: /fixture/project", "Digest: preview-digest"],
				}),
				enqueue: async (request: unknown) => {
					w.reviewCalls.captures.push(request);
					if (w.reviewCalls.captures.length === 1) throw new Error("The admission receipt was lost.");
					return review;
				},
				signOff: async (request: unknown) => {
					w.reviewCalls.signOffs.push(request);
					return { url: "http://127.0.0.1/fixture" };
				},
			};
		});
		await page.getByRole("button", { name: "Reviews", exact: true }).click();
		const reviews = page.getByRole("region", { name: "Code reviews", exact: true });
		await reviews.getByRole("button", { name: /project \/ main.*abcdef0 Export the value/ }).waitFor();
		const row = await reviews.getByRole("button", { name: /abcdef0 Export the value/ }).innerText();
		for (const text of ["completed", "1 confirmed", "4m 32s", "$1.23"]) expect(row).toContain(text);
		expect(await reviews.getByTitle("Review queue status").innerText()).toMatch(/2 queued.*1 done.*passes 3\/8/s);
		expect(await reviews.innerText()).toContain("$1.23 (4/4 reported)");
		expect(await reviews.innerText()).toContain("in 576.0k \u00b7 out 2.8k \u00b7 cached 1.2M");
		await reviews.getByRole("tab", { name: "Findings" }).click();
		await reviews.getByText("The consumer shows a stale total.").waitFor();
		await shot(page, "reviews-findings");
		await reviews.getByRole("tab", { name: "Mail" }).click();
		await reviews.getByText("Review planned").waitFor();
		await reviews.getByLabel("Comment on this review").fill("Check the consumer");
		await reviews.getByRole("button", { name: "Comment", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).reviewCalls.manage)).toEqual([
				expect.objectContaining({
					operation: { action: "comment", review: "review-fixture", body: "Check the consumer" },
				}),
			]),
		);
		await reviews.getByRole("tab", { name: "Log" }).click();
		await reviews.getByText("Tracing every import of value.").waitFor();
		await shot(page, "reviews-log");
		await reviews.getByRole("button", { name: "Analytics", exact: true }).click();
		const analytics = page.getByRole("region", { name: "Review analytics" });
		await analytics.getByText("provider/strong").waitFor();
		await shot(page, "reviews-analytics");
		await reviews.getByRole("button", { name: "Analytics", exact: true }).click();
		await reviews.getByLabel("Hide addressed").check();
		await reviews.getByText("Every review here is addressed.").waitFor();
		await reviews.getByLabel("Hide addressed").uncheck();
		await reviews.getByRole("button", { name: /abcdef0 Export the value/ }).waitFor();
		await reviews.getByRole("tab", { name: "Source" }).click();
		await reviews.getByRole("button", { name: "value.ts", exact: true }).click();
		await choose(reviews.getByLabel("Captured side"), "before");
		await reviews.getByText("original captured source", { exact: true }).waitFor();
		const tabs = {
			Summary: "Two scopes carry the risk.",
			Findings: "The consumer shows a stale total.",
			Mail: "Please check the consumer too.",
			Log: "Tracing every import of value.",
			Target: "assets/logo.png",
			Source: "original captured source",
			Plan: "Legacy scope",
			Coverage: "Challenged: The trace skipped the renderer.",
			Attempts: "provider/strong \u00b7 high",
			Decisions: "Updated the consumer.",
			Configuration: "provider/strong:high",
			Freshness: "Current checkout",
		};
		for (const theme of ["light", "dark"]) {
			for (const [tab, text] of Object.entries(tabs)) {
				await reviews.getByRole("tab", { name: tab, exact: true }).click();
				await reviews.getByText(text).first().waitFor();
				expect(await reviews.locator(".wp-review-body pre").count()).toBe(0);
				await shot(page, `reviews-tab-${tab.toLowerCase()}-${theme}`);
			}
			if (theme === "light") await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		}
		await page.setViewportSize({ width: 900, height: 700 });
		for (const tab of ["Summary", "Plan", "Attempts"]) {
			await reviews.getByRole("tab", { name: tab, exact: true }).click();
			await reviews
				.getByText(tabs[tab as keyof typeof tabs])
				.first()
				.waitFor();
			await shot(page, `reviews-tab-${tab.toLowerCase()}-narrow`);
		}
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await reviews.getByRole("button", { name: "Open captured sign-off" }).click();
		expect(await page.evaluate(() => (window as any).reviewCalls.signOffs)).toEqual([{ review: "review-fixture" }]);
		await reviews.getByRole("button", { name: "Capture review", exact: true }).click();
		await reviews.getByLabel("Lasting owner ID").fill("owner");
		await reviews.getByRole("button", { name: "Preview without reviewers" }).click();
		await reviews.getByRole("button", { name: "Queue this captured identity" }).waitFor();
		expect(await page.evaluate(() => (window as any).reviewCalls.captures)).toEqual([]);
		await reviews.getByRole("button", { name: "Queue this captured identity" }).click();
		await reviews.getByRole("alert").waitFor();
		expect(await reviews.getByRole("button", { name: "Queue this captured identity" }).isEnabled()).toBe(false);
		await reviews.getByRole("button", { name: "Retry original capture request" }).click();
		const attempts = await page.evaluate(() => (window as any).reviewCalls.captures);
		expect(attempts[1]).toEqual(attempts[0]);
		expect(attempts.slice(0, 1)).toEqual([
			expect.objectContaining({
				owner: "owner",
				expectedDigest: "preview-digest",
				request: { cwd: ROOT, target: { kind: "working-tree", base: "HEAD" } },
			}),
		]);
		await shot(page, "reviews-wide");
		await page.setViewportSize({ width: 900, height: 700 });
		await shot(page, "reviews-narrow");
		const bounds = (await reviews.boundingBox())!;
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
		await page.getByRole("button", { name: "Reviews", exact: true }).click();
		await vi.waitFor(async () => expect(await editorText(page)).toContain("keep draft"));
		expect(await page.evaluate(() => (window as any).workspaceCalls.saves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30000);

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
		await vi.waitFor(async () => expect(await editorText(page)).toContain("operator draft"));
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
		await vi.waitFor(async () => expect(await editorText(page)).toContain("operator draft"));
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

test("word wrap toggles from the editor's command palette, and Files and Git can each be hidden without losing the draft", async () => {
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
		const panes = page.locator(".wp-code-panes");
		const files = page.getByRole("complementary", { name: "Files", exact: true });
		const git = page.getByRole("complementary", { name: "Repository changes", exact: true });
		const editorLeft = () => page.locator(".wp-code-editor-pane").evaluate((node) => node.getBoundingClientRect().left);
		const panesLeft = await panes.evaluate((node) => node.getBoundingClientRect().left);
		expect(await editorLeft()).toBeGreaterThan(panesLeft + 100);
		await page.getByRole("button", { name: "Files", exact: true }).click();
		await files.waitFor({ state: "hidden" });
		expect(Math.abs((await editorLeft()) - panesLeft)).toBeLessThan(2);
		await page.getByRole("button", { name: "Git", exact: true }).click();
		await git.waitFor({ state: "hidden" });
		const wide = await page.locator(".wp-code-editor-pane").evaluate((node) => node.getBoundingClientRect().width);
		expect(wide).toBeGreaterThan((await panes.evaluate((node) => node.getBoundingClientRect().width)) - 2);
		await shot(page, "panes-hidden");
		await page.getByRole("button", { name: "Files", exact: true }).click();
		await page.getByRole("button", { name: "Git", exact: true }).click();
		await files.waitFor();
		await git.waitFor();
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
