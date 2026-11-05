import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import { choose } from "./helpers/select.js";

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

async function openWorkplace(options: { height?: number; seen?: Record<string, string> } = {}) {
	const page = await browser.newPage({ viewport: { width: 1440, height: options.height ?? 900 } });
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
		({ root, seen }) => {
			const w = window as any;
			if (seen) localStorage.setItem("workplace-reviews-seen", JSON.stringify(seen));
			Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
			w.reviewCalls = { captures: [], signOffs: [], sources: [], manage: [], queues: [] };
			const review = (id: string, state: string, subject: string, extra: Record<string, unknown> = {}) => ({
				id,
				state,
				phase: null,
				target: { kind: "commit", commit: "abc" },
				label: { repository: "project", branch: "main", head: "abcdef0123", subject, commits: null, files: 1 },
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
				cwd: root,
				...extra,
			});
			w.reviewRows = [
				review("review-fixture", "completed", "Export the value"),
				review("review-two", "running", "Draw the lanes", {
					phase: { kind: "focused", state: "running", pass: "lanes" },
					passes: { required: 3, completed: 1 },
					findings: { reported: 0, confirmed: 0, unresolved: 0, responded: 0 },
					settledAt: null,
					ownerName: "Grace Hopper",
				}),
			];
			w.agentWorkplace = {
				snapshot: async () => ({
					connected: true,
					headquarters: [],
					characters: [],
					dormant: [
						{
							id: "owner",
							name: "Reviewer",
							role: "code-review-specialist",
							reportsTo: null,
							repository: null,
							cwd: root,
							task: null,
							stoppedAt: null,
							stopReason: null,
							startedAt: 1,
						},
					],
					mail: [],
					operatorMail: [],
					workplace: { threads: [], tasks: [], escalations: [] },
				}),
				onUpdate: () => () => {},
				feed: async () => [],
				onFeed: () => () => {},
				onReceipt: () => () => {},
				onReply: () => () => {},
				watchReplies: async () => {},
				onNotepad: () => () => {},
				workspace: { repositories: async () => ({ ok: true, roots: [root] }) },
			};
			const fixture = w.reviewRows[0];
			w.agentWorkplace.reviews = {
				states: async () =>
					w.reviewRows.map((row: { id: string; state: string }) => ({ id: row.id, state: row.state })),
				queue: async (request: { hideAddressed?: boolean; cwd?: string }) => {
					w.reviewCalls.queues.push(request);
					const rows = request.hideAddressed ? [] : w.reviewRows;
					return {
						total: rows.length,
						states: { completed: 1, queued: 2, running: 1 },
						passes: { running: 3, limit: 8 },
						page: { offset: 0, nextOffset: null, rows },
					};
				},
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
					return fixture;
				},
				read: async (request: { part: string; review: string }) => {
					const page = (rows: unknown[]) => ({ total: rows.length, page: { offset: 0, nextOffset: null, rows } });
					const at = Date.now() - 200_000;
					const question = {
						id: "value",
						question: "Does the exported value match its consumers?",
						verification: "Trace every import of value.",
					};
					const parts: Record<string, unknown> = {
						summary: {
							...w.reviewRows.find((row: { id: string }) => row.id === request.review),
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
								repository: root,
								source: "/state/reviews/review-fixture/artifact/source",
								requested: { cwd: root, target: { kind: "commit", commit: "abc" } },
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
								reported: { question: "value", state: "completed", evidence: ["Traced the two imports."], reason: "" },
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
							review: fixture.id,
							kind: "files",
							side: request.side,
							total: 1,
							page: { offset: 0, nextOffset: null, rows: [{ path: "value.ts", mode: "100644", blob: "captured" }] },
						};
					return {
						review: fixture.id,
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
					return fixture;
				},
				signOff: async (request: unknown) => {
					w.reviewCalls.signOffs.push(request);
					return { url: "http://127.0.0.1/fixture" };
				},
			};
		},
		{ root: ROOT, seen: options.seen },
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	return { page, errors };
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-reviews-${name}.png`), animations: "disabled" });
}
const calls = (page: Page, kind: string) => page.evaluate((key) => (window as any).reviewCalls[key], kind);
async function enter(page: Page) {
	await page.getByRole("button", { name: "Reviews", exact: true }).click();
	const reviews = page.getByRole("region", { name: "Code reviews", exact: true });
	await reviews.getByRole("button", { name: /Export the value, Completed/ }).waitFor();
	return reviews;
}

test("Reviews is its own app: queue cards, progress, every evidence tab and analytics", async () => {
	const { page, errors } = await openWorkplace();
	try {
		const reviews = await enter(page);
		expect(new URL(page.url()).search).toBe("?workplace=reviews");
		const card = await reviews.getByRole("button", { name: /Export the value, Completed/ }).innerText();
		for (const text of ["Completed", "Export the value", "project", "main", "1 confirmed", "$1.23", "4m 32s"])
			expect(card).toContain(text);
		const running = await reviews.getByRole("button", { name: /Draw the lanes, Reviewing/ }).innerText();
		expect(running).toContain("Reviewing");
		expect(await reviews.getByTitle("Review queue status").innerText()).toMatch(
			/1\s+reviewing.*2\s+queued.*1\s+done.*passes\s+3\/8/s,
		);
		const hero = reviews.locator(".wp-rv-hero");
		await hero.getByRole("heading", { name: "Export the value" }).waitFor();
		expect(await hero.innerText()).toMatch(/Reviewer[\s\S]*\$1\.23[\s\S]*assessment 7/);
		const progress = reviews.getByRole("list", { name: "Review progress" });
		expect(await progress.locator("[aria-current=step]").innerText()).toContain("Settled");
		await reviews.getByRole("tab", { name: "Findings 1" }).waitFor();
		await shot(page, "light-summary");

		await reviews.getByRole("button", { name: /Draw the lanes, Reviewing/ }).click();
		await reviews.locator(".wp-rv-hero").getByRole("heading", { name: "Draw the lanes" }).waitFor();
		expect(await progress.locator("[aria-current=step]").innerText()).toMatch(/Inspecting\s*1\/3 passes/);
		await shot(page, "light-running");
		await reviews.getByRole("button", { name: /Export the value, Completed/ }).click();

		await reviews.getByRole("tab", { name: "Mail" }).click();
		await reviews.getByText("Review planned").waitFor();
		await reviews.getByLabel("Comment on this review").fill("Check the consumer");
		await reviews.getByRole("button", { name: "Comment", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await calls(page, "manage")).toEqual([
				expect.objectContaining({
					operation: { action: "comment", review: "review-fixture", body: "Check the consumer" },
				}),
			]),
		);
		await reviews.getByRole("button", { name: "Analytics", exact: true }).click();
		await page.getByRole("region", { name: "Review analytics" }).getByText("provider/strong").waitFor();
		await shot(page, "light-analytics");
		await reviews.getByRole("button", { name: "Analytics", exact: true }).click();
		await reviews.getByText("Hide addressed", { exact: true }).click();
		await reviews.getByText("Everything here is addressed").waitFor();
		await reviews.getByText("Hide addressed", { exact: true }).click();
		await reviews.getByRole("button", { name: /Export the value, Completed/ }).waitFor();
		await reviews.getByRole("tab", { name: "Source" }).click();
		await reviews.getByRole("button", { name: "value.ts", exact: true }).click();
		await choose(reviews.getByLabel("Captured side"), "before");
		await reviews.getByText("original captured source", { exact: true }).waitFor();
		const tabs = {
			Summary: "Two scopes carry the risk.",
			"Findings 1": "The consumer shows a stale total.",
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
			}
			await reviews.getByRole("tab", { name: "Findings 1", exact: true }).click();
			await shot(page, `${theme}-findings`);
			if (theme === "light") await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		}
		await reviews.getByRole("tab", { name: "Summary", exact: true }).click();
		await shot(page, "dark-summary");
		await page.setViewportSize({ width: 900, height: 700 });
		await reviews.getByText(tabs.Summary).first().waitFor();
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		await shot(page, "dark-narrow");
		const bounds = (await reviews.boundingBox())!;
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("cancel and resume confirm in the app, sign-off opens the captured page, and capture previews before queueing", async () => {
	const { page, errors } = await openWorkplace();
	try {
		const reviews = await enter(page);
		await page.evaluate(() => {
			(window as any).reviewRows[0].state = "failed";
		});
		await reviews.getByRole("button", { name: /Export the value, Failed/ }).waitFor({ timeout: 6000 });
		await reviews.getByRole("button", { name: "Cancel", exact: true }).click();
		await reviews
			.getByRole("dialog", { name: "Cancel this review?" })
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		expect(await calls(page, "manage")).toEqual([]);
		await reviews.getByRole("button", { name: "Resume", exact: true }).click();
		const resume = reviews.getByRole("dialog", { name: "Resume this review?" });
		await shot(page, "light-resume-dialog");
		await resume.getByRole("button", { name: "Resume reviewers" }).click();
		await vi.waitFor(async () =>
			expect(await calls(page, "manage")).toEqual([
				expect.objectContaining({ operation: { action: "resume", review: "review-fixture" } }),
			]),
		);
		await reviews.getByRole("button", { name: "Open captured sign-off" }).click();
		expect(await calls(page, "signOffs")).toEqual([{ review: "review-fixture" }]);

		await reviews.getByRole("button", { name: "New review", exact: true }).click();
		const capture = reviews.getByRole("dialog", { name: "New code review" });
		await capture.locator("label", { hasText: "Branch" }).click();
		await capture.getByLabel("Base").fill("main");
		await capture.getByLabel("Head / commit").fill("feature");
		await capture.locator("label", { hasText: "Working tree" }).click();
		expect(await capture.getByLabel("Head / commit").count()).toBe(0);
		await capture.getByLabel("Base").fill("HEAD");
		await shot(page, "light-capture");
		await capture.getByRole("button", { name: "Preview without reviewers" }).click();
		await capture.getByText("Digest: preview-digest").waitFor();
		expect(await calls(page, "captures")).toEqual([]);
		await capture.getByRole("button", { name: "Queue this captured identity" }).click();
		await capture.getByRole("alert").waitFor();
		await shot(page, "light-capture-retry");
		await capture.getByRole("button", { name: "Retry original capture request" }).click();
		await capture.waitFor({ state: "hidden" });
		const attempts = await calls(page, "captures");
		expect(attempts[1]).toEqual(attempts[0]);
		expect(attempts[0]).toEqual(
			expect.objectContaining({
				owner: "owner",
				expectedDigest: "preview-digest",
				request: { cwd: ROOT, target: { kind: "working-tree", base: "HEAD" } },
			}),
		);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("the rail counts reviews whose state changed since they were last seen", async () => {
	const { page, errors } = await openWorkplace({
		seen: { "review-fixture": "completed", "review-two": "queued" },
	});
	try {
		const rail = page.getByRole("navigation", { name: "Applications" });
		const button = rail.getByRole("button", { name: "Reviews", exact: true });
		await vi.waitFor(async () => expect(await button.getAttribute("aria-description")).toBe("1 updated reviews"));
		expect(await button.locator("b").innerText()).toBe("1");
		await page.evaluate(() => {
			const w = window as any;
			w.reviewRows.push({
				...w.reviewRows[0],
				id: "review-three",
				state: "queued",
				label: { ...w.reviewRows[0].label, subject: "Add the badge" },
			});
		});
		await vi.waitFor(async () => expect(await button.locator("b").innerText()).toBe("2"), { timeout: 6000 });
		await shot(page, "light-rail-badge");

		const reviews = await enter(page);
		const updated = reviews.getByRole("button", { name: /Draw the lanes, Reviewing, updated/ });
		expect(await updated.innerText()).toContain("was queued");
		expect(await reviews.getByRole("button", { name: /Add the badge, Queued, updated/ }).innerText()).toContain("new");
		await shot(page, "light-updated-cards");
		await updated.click();
		await vi.waitFor(async () => expect(await button.locator("b").innerText()).toBe("1"));
		await reviews.getByRole("button", { name: /Draw the lanes, Reviewing$/ }).waitFor();
		await reviews.getByRole("button", { name: "Mark 1 seen" }).click();
		await vi.waitFor(async () => expect(await button.locator("b").count()).toBe(0));
		await page.evaluate(() => {
			(window as any).reviewRows[1].state = "completed";
		});
		await vi.waitFor(async () => expect(await button.locator("b").count()).toBe(0), { timeout: 6000 });
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);
