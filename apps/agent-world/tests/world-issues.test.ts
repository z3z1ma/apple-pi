import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Delegation, JiraIssue, OutsideWriteIntent } from "../src/integrations.js";
import type { Receipt, WorldSnapshot } from "../src/world.js";

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

async function openIssues(signedIn = true) {
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
	await page.addInitScript((authenticated) => {
		const w = window as any;
		let signedIn = authenticated;
		let progressed = false;
		const receipts = new Set<(receipt: Receipt) => void>();
		const now = Date.now();
		const snapshot: WorldSnapshot = {
			connected: true,
			headquarters: [{ id: "ada", name: "Ada", wings: [] }],
			dormant: [],
			mail: [],
			operatorMail: [],
			workplace: { threads: [], tasks: [], escalations: [] },
			characters: [
				{
					id: "ada",
					name: "Ada",
					role: "coordinator",
					place: { kind: "headquarters", headquarters: "ada" },
					startedAt: now,
					hiredAt: now,
					facts: {
						run: "idle",
						status: "idle",
						asking: null,
						needsYouSince: null,
						unseen: false,
						seenAt: now,
						settledAt: now,
						tool: null,
						task: null,
						git: null,
						cwd: "/fixture/project",
						reportsTo: null,
						title: "Coordinator",
						model: "fixture-model",
						contextTokens: 0,
						contextWindow: 200000,
						cost: 0,
						tmux: null,
					},
				},
			],
		};
		const issue = (key: string): JiraIssue => ({
			key,
			summary: key === "APP-1" ? "Fix report totals" : "Review keyboard workflow",
			status: key === "APP-1" && progressed ? "In Progress" : "To Do",
			statusCategory: key === "APP-1" && progressed ? "indeterminate" : "new",
			type: "Task",
			priority: "High",
			project: "APP",
			assignee: "Operator",
			updated: new Date(now).toISOString(),
			url: `https://fixture.atlassian.net/browse/${key}`,
		});
		w.issueCalls = {
			credentials: 0,
			assigned: 0,
			searches: [],
			details: [],
			transitions: [],
			described: [],
			confirmed: [],
			delegated: [],
			links: [],
			conversations: [],
			signIns: [],
		};
		w.receiptIssue = (receipt: Receipt) => {
			for (const listener of receipts) listener(receipt);
		};
		w.agentWorld = {
			snapshot: async () => snapshot,
			onUpdate: () => () => {},
			feed: async () => [],
			onFeed: () => () => {},
			onReceipt: (listener: (receipt: Receipt) => void) => {
				receipts.add(listener);
				return () => receipts.delete(listener);
			},
			onReply: () => () => {},
			watchReplies: async () => {},
			onNotepad: () => () => {},
			markSeen: async () => ({ ok: true }),
			conversation: async (id: string) => {
				w.issueCalls.conversations.push(id);
				return { ok: true, entries: [], before: null, missing: 0 };
			},
			credentialStatus: async () => {
				w.issueCalls.credentials++;
				return {
					atlassian: signedIn ? { site: "https://fixture.atlassian.net", email: "operator@example.test" } : null,
					slack: null,
				};
			},
			signInAtlassian: async (site: string, email: string, token: string) => {
				w.issueCalls.signIns.push({ site, email, token });
				signedIn = true;
				return { ok: true, name: "Operator" };
			},
			jiraAssigned: async () => {
				w.issueCalls.assigned++;
				return {
					ok: true,
					issues: w.issueListCount
						? Array.from({ length: w.issueListCount }, (_, i) => issue(`APP-${i + 1}`))
						: [issue("APP-1"), issue("APP-2")],
				};
			},
			jiraSearch: async (query: string) => {
				w.issueCalls.searches.push(query);
				return { ok: true, issues: [issue("APP-2")] };
			},
			jiraIssue: async (key: string) => {
				w.issueCalls.details.push(key);
				return {
					ok: true,
					detail: {
						issue: issue(key),
						reporter: "Reporter",
						created: new Date(now).toISOString(),
						descriptionHtml: `${(
							w.issueDescription ?? "Reproduce the total mismatch, then verify the corrected result."
						)
							.split("\n\n")
							.map((paragraph: string) => `<p>${paragraph}</p>`)
							.join(
								"",
							)}<p><a href="https://fixture.atlassian.net/wiki/rounding">Rounding guide</a></p><script>window.unsafeIssueHtml=true</script><a href="javascript:window.unsafeIssueHtml=true">Unsafe link</a>`,
						descriptionText: `${w.issueDescription ?? "Reproduce the total mismatch, then verify the corrected result."}\n\nRounding guide`,
						comments: [
							{
								id: "comment-1",
								author: "Reviewer",
								created: new Date(now).toISOString(),
								html: "<p>Keep the existing rounding rule.</p><script>window.unsafeIssueHtml=true</script>",
								text: "Keep the existing rounding rule.",
							},
						],
					},
				};
			},
			jiraTransitions: async (key: string) => {
				w.issueCalls.transitions.push(key);
				return {
					ok: true,
					transitions: [{ id: "31", name: "Start progress", to: "In Progress", toCategory: "indeterminate" }],
				};
			},
			describeWrite: async (intent: OutsideWriteIntent) => {
				w.issueCalls.described.push(structuredClone(intent));
				return {
					ok: true,
					token: `fixture-confirmation-${w.issueCalls.described.length}`,
					description: {
						what: "Change Jira status",
						where: "APP-1",
						text: "Move to In Progress",
						url: "https://fixture.atlassian.net/browse/APP-1",
					},
				};
			},
			confirmWrite: async (intent: OutsideWriteIntent, token: string) => {
				w.issueCalls.confirmed.push({ intent: structuredClone(intent), token });
				await new Promise((resolve) => {
					w.releaseIssueWrite = resolve;
				});
				progressed = true;
				return {
					ok: true,
					entry: {
						at: Date.now(),
						kind: intent.kind,
						what: "Change Jira status",
						where: "APP-1",
						text: "Move to In Progress",
						url: "https://fixture.atlassian.net/browse/APP-1",
						ok: true,
						line: "Changed APP-1 status",
					},
				};
			},
			delegate: async (commandId: string, delegation: Delegation) => {
				w.issueCalls.delegated.push({ commandId, delegation: structuredClone(delegation) });
				return { ok: true, to: delegation.to, command: "talk" };
			},
			openLink: async (url: string) => {
				w.issueCalls.links.push(url);
				return { ok: true };
			},
		};
	}, signedIn);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	expect(
		await page.evaluate(() => ({
			credentials: (window as any).issueCalls.credentials,
			assigned: (window as any).issueCalls.assigned,
		})),
	).toEqual({ credentials: 0, assigned: 0 });
	await page.getByRole("button", { name: "Issues", exact: true }).click();
	await page.getByRole("region", { name: "Issues", exact: true }).waitFor();
	await shot(page, "entry");
	const bounds = await page.getByRole("region", { name: "Issues", exact: true }).boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.y).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	return { page, errors };
}
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-issues-${name}.png`), animations: "disabled" });
}
async function openFirst(page: Page) {
	await page.getByRole("button", { name: "Read issue: APP-1 Fix report totals", exact: true }).click();
	await page.getByRole("heading", { name: /^APP-1 .*Fix report totals$/ }).waitFor();
}

test("Issues reads on explicit selection, retains goal drafts, and delegates only the chosen person and issue", async () => {
	const { page, errors } = await openIssues();
	try {
		await page.getByRole("button", { name: "Read issue: APP-1 Fix report totals", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).issueCalls.details)).toEqual([]);
		await openFirst(page);
		await page.getByText("Keep the existing rounding rule.", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).unsafeIssueHtml)).toBeUndefined();
		await page.getByText("Reproduce the total mismatch, then verify the corrected result.", { exact: true }).waitFor();
		const detail = page.getByRole("region", { name: "Issue detail", exact: true });
		for (const name of ["Refresh issues", "Refresh issue", "Close issue"]) {
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
		expect(await detail.locator('script, a[href^="javascript:"]').count()).toBe(0);
		const disclosure = detail.getByText("Delegate", { exact: true });
		const beforeLink = page.url();
		await page.getByRole("link", { name: "Rounding guide", exact: true }).click();
		expect(await page.evaluate(() => (window as any).issueCalls.links)).toEqual([
			"https://fixture.atlassian.net/wiki/rounding",
		]);
		expect(page.url()).toBe(beforeLink);
		expect(await page.evaluate(() => (window as any).unsafeIssueHtml)).toBeUndefined();
		await disclosure.click();
		const recipient = page.getByRole("combobox", { name: "Person or team head", exact: true });
		const goal = page.getByRole("textbox", { name: "Goal and context", exact: true });
		expect(await recipient.inputValue()).toBe("");
		expect(await page.getByRole("button", { name: "Send instruction", exact: true }).isEnabled()).toBe(false);
		await recipient.selectOption("ada");
		await goal.fill("Fix the totals and prove the rounding rule is unchanged.");
		await page.getByRole("button", { name: "Refresh issue", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).issueCalls.details)).toEqual(["APP-1", "APP-1"]),
		);
		await page.getByRole("button", { name: "Refresh issues", exact: true }).click();
		expect(await recipient.inputValue()).toBe("ada");
		expect(await goal.inputValue()).toBe("Fix the totals and prove the rounding rule is unchanged.");
		await disclosure.click();
		await goal.waitFor({ state: "hidden" });
		await disclosure.click();
		expect(await goal.inputValue()).toBe("Fix the totals and prove the rounding rule is unchanged.");
		await page.getByRole("button", { name: "Read issue: APP-2 Review keyboard workflow", exact: true }).click();
		await page.getByRole("heading", { name: /^APP-2 .*Review keyboard workflow$/ }).waitFor();
		await openFirst(page);
		expect(await recipient.inputValue()).toBe("ada");
		expect(await goal.inputValue()).toBe("Fix the totals and prove the rounding rule is unchanged.");
		await page.getByRole("searchbox", { name: "Search issues", exact: true }).fill("APP-2");
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).issueCalls.searches)).toEqual(["APP-2"]),
		);
		await page
			.getByRole("button", { name: "Read issue: APP-1 Fix report totals", exact: true })
			.waitFor({ state: "hidden" });
		await page.getByRole("button", { name: "Read issue: APP-2 Review keyboard workflow", exact: true }).waitFor();
		await page.getByText("Outside current results", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Issues", exact: true }).click();
		expect(await page.getByRole("searchbox", { name: "Search issues", exact: true }).inputValue()).toBe("APP-2");
		expect(await goal.inputValue()).toBe("Fix the totals and prove the rounding rule is unchanged.");
		expect(await page.evaluate(() => (window as any).issueCalls.delegated)).toEqual([]);
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([]);
		expect(await page.evaluate(() => (window as any).issueCalls.conversations)).toEqual([]);
		await shot(page, "draft-retained");
		await page.getByRole("button", { name: "Send instruction", exact: true }).click();
		await page.getByText("Instruction accepted. Waiting for delivery.", { exact: true }).waitFor();
		const calls = await page.evaluate(() => (window as any).issueCalls.delegated);
		expect(calls).toHaveLength(1);
		expect(calls[0].delegation).toEqual({
			to: "ada",
			item: {
				kind: "issue",
				key: "APP-1",
				summary: "Fix report totals",
				url: "https://fixture.atlassian.net/browse/APP-1",
			},
			ask: "start-work",
			note: "Fix the totals and prove the rounding rule is unchanged.",
		});
		expect(await page.getByRole("button", { name: "Send instruction", exact: true }).isEnabled()).toBe(false);
		await disclosure.click();
		await page.evaluate(
			(commandId) => (window as any).receiptIssue({ commandId, characterId: "ada", stage: "applied" }),
			calls[0].commandId,
		);
		await disclosure.click();
		await page.getByText("Ada received the instruction. Work completion is not yet known.", { exact: true }).waitFor();
		await shot(page, "delegation-received");
		await page.getByRole("button", { name: "Open conversation", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).issueCalls.conversations)).toContain("ada"),
		);
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("Jira status writes require a native confirmation and the exact described intent and token", async () => {
	const { page, errors } = await openIssues();
	try {
		await openFirst(page);
		await page.getByRole("button", { name: "Change status", exact: true }).click();
		await page.getByRole("button", { name: /Start progress/ }).click();
		const dialog = page.getByRole("dialog", { name: "Confirm Jira change", exact: true });
		await dialog.waitFor();
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([]);
		expect(
			await dialog
				.getByRole("button", { name: "Don't send", exact: true })
				.evaluate((node) => node === document.activeElement),
		).toBe(true);
		await shot(page, "confirm-jira-change");
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([]);
		await page.getByRole("button", { name: /Start progress/ }).click();
		await dialog.waitFor();
		await dialog.getByRole("button", { name: "Send as you", exact: true }).click();
		await dialog.getByRole("button", { name: "Sending...", exact: true }).waitFor();
		expect(await dialog.getByRole("button", { name: "Don't send", exact: true }).isEnabled()).toBe(false);
		const intent = { kind: "jira-transition", key: "APP-1", transition: "31" };
		expect(await page.evaluate(() => (window as any).issueCalls.described)).toEqual([intent, intent]);
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([
			{ intent, token: "fixture-confirmation-2" },
		]);
		await page.evaluate(() => (window as any).releaseIssueWrite());
		await dialog.waitFor({ state: "hidden" });
		await page.getByText("Jira status updated.", { exact: true }).waitFor();
		await page
			.getByRole("region", { name: "Issue detail", exact: true })
			.getByText("In Progress", { exact: true })
			.waitFor();
		await page
			.getByRole("button", { name: "Read issue: APP-1 Fix report totals", exact: true })
			.getByText("In Progress", { exact: true })
			.waitFor();
		expect(await page.evaluate(() => (window as any).issueCalls.delegated)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("long issue list and detail scroll independently without growing the app or reading again", async () => {
	const { page, errors } = await openIssues();
	try {
		await page.evaluate(() => {
			(window as any).issueListCount = 60;
			(window as any).issueDescription = Array.from(
				{ length: 100 },
				(_, i) => `Evidence paragraph ${i + 1}: reproduce the mismatch and verify the corrected result.`,
			).join("\n\n");
		});
		await page.getByRole("button", { name: "Refresh issues", exact: true }).click();
		const lastIssue = page.getByRole("button", { name: "Read issue: APP-60 Review keyboard workflow", exact: true });
		await lastIssue.waitFor();
		await openFirst(page);
		const detail = page.getByRole("region", { name: "Issue detail", exact: true });
		const before = await detail.boundingBox();
		expect(before).not.toBeNull();
		expect(before!.y + before!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
		const heading = detail.getByRole("heading", { name: /^APP-1 .*Fix report totals$/ });
		const headingBefore = await heading.boundingBox();
		await lastIssue.scrollIntoViewIfNeeded();
		const lastRow = await lastIssue.boundingBox();
		expect(lastRow).not.toBeNull();
		expect(lastRow!.y).toBeGreaterThanOrEqual(0);
		expect(Math.floor(lastRow!.y + lastRow!.height)).toBeLessThanOrEqual(page.viewportSize()!.height);
		expect(await heading.boundingBox()).toEqual(headingBefore);
		expect(await detail.boundingBox()).toEqual(before);
		const comment = page.getByText("Keep the existing rounding rule.", { exact: true });
		await comment.scrollIntoViewIfNeeded();
		const final = await comment.boundingBox();
		expect(final).not.toBeNull();
		expect(final!.y).toBeGreaterThanOrEqual(before!.y);
		expect(Math.floor(final!.y + final!.height)).toBeLessThanOrEqual(page.viewportSize()!.height);
		expect(await detail.boundingBox()).toEqual(before);
		expect(await lastIssue.boundingBox()).toEqual(lastRow);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		expect(await page.evaluate(() => (window as any).issueCalls.details)).toEqual(["APP-1"]);
		expect(await page.evaluate(() => (window as any).issueCalls.delegated)).toEqual([]);
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([]);
		await shot(page, "long-detail-scrolled");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

test("signed-out Issues requests no Jira data before an explicit account connection", async () => {
	const { page, errors } = await openIssues(false);
	try {
		const form = page.getByRole("form", { name: "Connect Jira", exact: true });
		await form.waitFor();
		expect(await page.evaluate(() => (window as any).issueCalls.assigned)).toBe(0);
		expect(await page.evaluate(() => (window as any).issueCalls.details)).toEqual([]);
		await form.getByRole("textbox", { name: "Atlassian site", exact: true }).fill("fixture.atlassian.net");
		await form.getByRole("textbox", { name: "Email", exact: true }).fill("operator@example.test");
		await form.getByLabel("API token", { exact: true }).fill("fixture-only-token");
		expect(await page.evaluate(() => (window as any).issueCalls.signIns)).toEqual([]);
		await form.getByRole("button", { name: "Connect Jira", exact: true }).click();
		await page.getByRole("button", { name: "Read issue: APP-1 Fix report totals", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).issueCalls.signIns)).toEqual([
			{ site: "fixture.atlassian.net", email: "operator@example.test", token: "fixture-only-token" },
		]);
		expect(await page.evaluate(() => (window as any).issueCalls.assigned)).toBe(1);
		expect(await page.evaluate(() => (window as any).issueCalls.delegated)).toEqual([]);
		expect(await page.evaluate(() => (window as any).issueCalls.confirmed)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);
