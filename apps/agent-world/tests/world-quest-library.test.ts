import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type {
	ConfluencePage,
	ConfluencePageRef,
	JiraIssue,
	JiraIssueDetail,
	JiraTransition,
} from "../src/integrations.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";

// Seam 2 for the quest office and the library (tickets 24-26): the committed, built world UI in headless Chrome over a
// fixture backend that answers the function places' API (Atlassian sign-in, Jira, Confluence, the outside-write gate,
// delegation) and records every call, so a test can tell what was sent and that nothing was written unconfirmed.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://agent-world.test";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-24-*.png, aw-25-*.png, aw-26-*.png, in every theme.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const SITE = "https://acme.atlassian.net";
const TOKEN = "ATATT-secret-token-123";

// Each test walks the built world through a place and its panels; under load that takes longer than Vitest's 5 s.
vi.setConfig({ testTimeout: 45_000 });

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

const HQ = "orla";
const NOW = Date.now();
function facts(over: Partial<CharacterFacts> = {}): CharacterFacts {
	return {
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
		cwd: "/Users/op/code/apple-pi",
		reportsTo: HQ,
		model: "claude-opus-4",
		contextTokens: 48_000,
		contextWindow: 200_000,
		cost: 0.42,
		tmux: null,
		...over,
	};
}
const ORLA: Character = {
	id: HQ,
	name: "Orla",
	role: "coordinator",
	place: { kind: "headquarters", headquarters: HQ },
	startedAt: NOW - 9_000_000,
	facts: facts({ reportsTo: null }),
};
const SCRIBE: Character = {
	id: "scribe",
	name: "scribe",
	role: "worker",
	place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
	startedAt: NOW - 8_000_000,
	facts: facts(),
};
function world(theme: string | null = null): WorldSnapshot {
	return {
		connected: true,
		theme,
		headquarters: [{ id: HQ, name: "Orla", wings: [{ repository: "/r/apple-pi", name: "apple-pi", headcount: 1 }] }],
		characters: [ORLA, SCRIBE],
		dormant: [],
		mail: [],
	};
}

const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const issue = (
	key: string,
	summary: string,
	priority: string,
	status: string,
	statusCategory: string,
	minutes: number,
	type = "Task",
): JiraIssue => ({
	key,
	summary,
	status,
	statusCategory,
	type,
	priority,
	project: key.split("-")[0] === "APP" ? "Apple Pi" : key.startsWith("OPS") ? "Operations" : "Data",
	assignee: "Alex Operator",
	updated: iso(minutes),
	url: `${SITE}/browse/${key}`,
});
const ASSIGNED: JiraIssue[] = [
	issue("APP-97", "Add a dark mode to the settings page", "Medium", "In Progress", "indeterminate", 30, "Story"),
	issue("APP-101", "Login fails on Safari after the cookie change", "High", "To Do", "new", 12, "Bug"),
	issue("OPS-12", "Rotate the staging certificates", "Medium", "To Do", "new", 180),
	issue("APP-88", "Document the release process", "Low", "In Review", "indeterminate", 600),
	issue("DATA-7", "Backfill the events table for October", "Highest", "To Do", "new", 50),
];
const MANY: JiraIssue[] = [
	...ASSIGNED,
	...Array.from({ length: 7 }, (_, i) =>
		issue(`APP-${120 + i}`, `Follow-up chore number ${i + 1}`, "Low", "To Do", "new", 900 + i),
	),
];
const DETAIL: JiraIssueDetail = {
	issue: ASSIGNED[1],
	reporter: "Priya Shah",
	created: iso(4000),
	descriptionHtml:
		'<p>Since the cookie change, <strong>Safari 18</strong> users bounce back to the login page.</p><p>Steps:</p><ol><li>Open <a href="/browse/APP-1">APP-1</a></li><li>Sign in</li></ol>' +
		'<script>window.pwned = 1</script><img src="https://evil.example/x.png" onerror="window.pwned = 2" alt="safari-screenshot.png">' +
		'<a href="javascript:window.pwned = 3">click me</a><iframe src="https://evil.example"></iframe>' +
		'<div class="panel" style="background: red"><p onclick="window.pwned = 4">Workaround: use Chrome for now.</p></div>' +
		"<pre>Set-Cookie: session=abc; SameSite=None</pre>",
	descriptionText: "Since the cookie change, Safari 18 users bounce back to the login page.",
	comments: [
		{
			id: "c1",
			author: "Priya Shah",
			created: iso(300),
			html: "<p>Reproduced on Safari 18.1 and iOS.</p>",
			text: "Reproduced on Safari 18.1 and iOS.",
		},
		{ id: "c2", author: "Sam Lee", created: iso(90), html: null, text: "I think it is the SameSite flag." },
	],
};
const TRANSITIONS: JiraTransition[] = [
	{ id: "11", name: "Start progress", to: "In Progress", toCategory: "indeterminate" },
	{ id: "31", name: "Done", to: "Done", toCategory: "done" },
];
const SEARCH: JiraIssue[] = [
	issue("WEB-4", "Safari shows a blank page on old iPads", "Medium", "To Do", "new", 2000, "Bug"),
	issue("APP-101", "Login fails on Safari after the cookie change", "High", "To Do", "new", 12, "Bug"),
];
const PAGES: ConfluencePageRef[] = [
	{
		id: "501",
		title: "Release process",
		space: "Engineering",
		url: `${SITE}/wiki/spaces/ENG/pages/501`,
		excerpt: "How we cut a release: the checklist, who signs off, and how to roll back.",
		lastModified: iso(2880),
	},
	{
		id: "777",
		title: "Release notes 2026",
		space: "Product",
		url: `${SITE}/wiki/spaces/PROD/pages/777`,
		excerpt: "Every release this year, with what changed for customers.",
		lastModified: iso(600),
	},
];
const PAGE: ConfluencePage = {
	page: PAGES[0],
	html:
		'<h1>Release process</h1><p>We release every <em>Tuesday</em>. See <a href="/wiki/spaces/ENG/pages/9">the checklist</a>.</p>' +
		'<div class="confluence-information-macro confluence-information-macro-warning"><p>Never release on a Friday.</p></div>' +
		"<h2>Steps</h2><ol><li>Freeze main</li><li>Tag the release</li><li>Announce it</li></ol>" +
		"<table><tr><th>Step</th><th>Owner</th></tr><tr><td>Freeze</td><td>Lead</td></tr></table>" +
		'<script>window.pwned = 5</script><img src="https://acme.atlassian.net/wiki/download/flow.png" alt="flow.png"><style>body{display:none}</style>',
};

/** Open the world over a fixture backend; `window.calls` records what it was asked, `window.answers` what it says. */
async function openWorld(first: WorldSnapshot, signedIn: boolean, assigned: JiraIssue[] = ASSIGNED) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(appDir, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		({ snapshot, signedIn, site, data }) => {
			const listeners = new Set<(s: unknown) => void>();
			const receipts = new Set<(r: unknown) => void>();
			const writes = new Set<(e: unknown) => void>();
			const current = snapshot;
			const w = window as any;
			w.calls = [];
			let account: { site: string; email: string } | null = signedIn ? { site, email: "alex@acme.test" } : null;
			let recent: unknown[] = [];
			let token = 0;
			const NOT_SIGNED_IN = { ok: false, reason: "Sign in to Atlassian in Settings first.", signIn: "atlassian" };
			const record = (...call: unknown[]) => w.calls.push(call);
			w.agentWorld = {
				snapshot: async () => current,
				onUpdate(listener: (s: unknown) => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				feed: async () => [],
				onFeed: () => () => {},
				goToTerminal: async () => ({ ok: true }),
				conversation: async () => ({ ok: true, entries: [], before: null, missing: 0 }),
				markSeen: async () => ({ ok: true }),
				setAvatarLook: async () => ({ ok: true }),
				instruct: async () => ({ ok: true }),
				onReceipt(listener: (r: unknown) => void) {
					receipts.add(listener);
					return () => receipts.delete(listener);
				},
				watchReplies: async () => {},
				onReply: () => () => {},
				openLink: async (url: string) => {
					record("openLink", url);
					return { ok: true };
				},
				credentialStatus: async () => ({ atlassian: account, slack: null }),
				signInAtlassian: async (s: string, email: string, t: string) => {
					record("signInAtlassian", s, email, t);
					if (t !== "ATATT-secret-token-123")
						return { ok: false, reason: "Atlassian did not accept that email and token." };
					account = { site: `https://${s.replace(/^https?:\/\//, "")}`, email };
					return { ok: true, name: "Alex Operator" };
				},
				signOutAtlassian: async () => {
					record("signOutAtlassian");
					account = null;
					return { ok: true };
				},
				jiraAssigned: async () => {
					record("jiraAssigned");
					return account ? { ok: true, issues: data.assigned } : NOT_SIGNED_IN;
				},
				jiraSearch: async (text: string) => {
					record("jiraSearch", text);
					return account ? { ok: true, issues: data.search } : NOT_SIGNED_IN;
				},
				jiraIssue: async (key: string) => {
					record("jiraIssue", key);
					if (!account) return NOT_SIGNED_IN;
					const found = [...data.assigned, ...data.search].find((i: any) => i.key === key);
					return { ok: true, detail: { ...data.detail, issue: found ?? data.detail.issue } };
				},
				jiraTransitions: async (key: string) => {
					record("jiraTransitions", key);
					return { ok: true, transitions: data.transitions };
				},
				confluenceSearch: async (text: string) => {
					record("confluenceSearch", text);
					return account ? { ok: true, pages: data.pages } : NOT_SIGNED_IN;
				},
				confluencePage: async (id: string) => {
					record("confluencePage", id);
					if (!account) return NOT_SIGNED_IN;
					const ref = data.pages.find((p: any) => p.id === id) ?? data.page.page;
					recent = [{ ...ref, openedAt: Date.now() }, ...recent.filter((p: any) => p.id !== id)];
					return { ok: true, page: { ...data.page, page: ref } };
				},
				libraryRecent: async () => {
					record("libraryRecent");
					return recent;
				},
				describeWrite: async (intent: any) => {
					record("describeWrite", intent);
					const where = `${intent.key} on acme.atlassian.net`;
					const url = `${site}/browse/${intent.key}`;
					if (intent.kind === "jira-comment")
						return {
							ok: true,
							token: `t${++token}`,
							description: { what: "Comment on Jira issue", where, text: intent.body, url },
						};
					const move = data.transitions.find((t: any) => t.id === intent.transition)!;
					return {
						ok: true,
						token: `t${++token}`,
						description: { what: "Move Jira issue", where, text: `${move.name} (to ${move.to})`, url },
					};
				},
				confirmWrite: async (intent: any, t: string) => {
					record("confirmWrite", intent, t);
					const entry = {
						at: Date.now(),
						kind: intent.kind,
						what: intent.kind === "jira-comment" ? "Comment on Jira issue" : "Move Jira issue",
						where: `${intent.key} on acme.atlassian.net`,
						text: intent.body ?? "Start progress (to In Progress)",
						url: null,
						ok: true,
						line: intent.kind === "jira-comment" ? `You commented on ${intent.key}.` : `You moved ${intent.key}.`,
					};
					for (const listener of writes) listener(entry);
					return { ok: true, entry };
				},
				outsideWrites: async () => [],
				onOutsideWrite(listener: (e: unknown) => void) {
					writes.add(listener);
					return () => writes.delete(listener);
				},
				delegate: async (commandId: string, delegation: any) => {
					record("delegate", commandId, delegation);
					setTimeout(() => {
						for (const listener of receipts) listener({ commandId, characterId: "orla", stage: "applied" });
					}, 50);
					return { ok: true, to: "orla", command: "talk" };
				},
			};
			w.pushSnapshot = (next: unknown) => {
				for (const listener of listeners) listener(next);
			};
		},
		{
			snapshot: first,
			signedIn,
			site: SITE,
			data: { assigned, search: SEARCH, detail: DETAIL, transitions: TRANSITIONS, pages: PAGES, page: PAGE },
		},
	);
	await page.goto(`${ORIGIN}/index.html`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(400);
	return { page, errors };
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const calls = (page: Page) => page.evaluate(() => (window as any).calls) as Promise<unknown[][]>;
const callsOf = async (page: Page, name: string) => (await calls(page)).filter((call) => call[0] === name);
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const clickThrough = (page: Page) =>
	page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
const clickable = (page: Page) =>
	page.addStyleTag({ content: ".aw-place-veil, .aw-place-veil * { pointer-events: auto !important; }" });

interface NoticeView {
	key: string;
	kind: string;
	x: number;
	y: number;
	alpha: number;
	sign: boolean;
}
const notices = (page: Page) => view<NoticeView[]>(page, "notices()");

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(350);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Travel to a place from the Places tab, and wait for it. */
async function travel(page: Page, name: RegExp, key: string) {
	// The open tab folds when clicked again: open Places only when it is not the tab shown.
	const places = page.getByRole("tab", { name: "Places", exact: true });
	if ((await places.getAttribute("aria-selected")) !== "true" || (await page.locator(".aw-side.aw-folded").count()))
		await places.dispatchEvent("click");
	await page.getByRole("button", { name }).dispatchEvent("click");
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe(key), { timeout: 5000 });
	await page.waitForTimeout(700);
}

/** Talk to the place's host (the clerk, the librarian): a click on it walks up and opens its panel. */
async function talkToHost(page: Page, dialog: string) {
	await clickThrough(page);
	const host = await view<{ x: number; y: number }>(page, "host()");
	const [sx, sy] = await screen(page, host.x, host.y - 1);
	await page.mouse.click(sx, sy);
	await page.getByRole("dialog", { name: dialog }).waitFor({ timeout: 8000 });
	await clickable(page);
}

describe("Atlassian sign-in in Settings", () => {
	test("the site, email, and token go to the backend once; afterwards Settings shows only that a token is set", async () => {
		const { page, errors } = await openWorld(world(), false);
		await page.getByRole("tab", { name: "Settings", exact: true }).click();
		const section = page.getByRole("region", { name: "Atlassian" });
		await section.getByLabel("Site").fill("acme.atlassian.net");
		await section.getByLabel("Email").fill("alex@acme.test");
		await section.getByLabel("API token").fill("wrong-token");
		await section.getByRole("button", { name: "Sign in" }).click();
		await vi.waitFor(async () =>
			expect(await section.getByRole("status").textContent()).toBe("Atlassian did not accept that email and token."),
		);
		// A refused token is not kept in the field either.
		expect(await section.getByLabel("API token").inputValue()).toBe("");
		await shot(page, "aw-24-settings-refused");

		await section.getByLabel("API token").fill(TOKEN);
		await section.getByRole("button", { name: "Sign in" }).click();
		await vi.waitFor(async () => expect(await section.textContent()).toContain("Signed in as Alex Operator."));
		expect(await section.textContent()).toContain("acme.atlassian.net");
		expect(await section.textContent()).toContain("alex@acme.test");
		expect(await section.textContent()).toContain("Set");
		// The token is nowhere in the page once sent.
		expect(await page.content()).not.toContain(TOKEN);
		expect(await page.locator("input[type=password]").count()).toBe(0);
		expect((await callsOf(page, "signInAtlassian")).at(-1)).toEqual([
			"signInAtlassian",
			"acme.atlassian.net",
			"alex@acme.test",
			TOKEN,
		]);
		await shot(page, "aw-24-settings-signed-in");

		await section.getByRole("button", { name: "Sign out" }).click();
		await vi.waitFor(async () => expect(await section.getByLabel("API token").count()).toBe(1));
		expect(await callsOf(page, "signOutAtlassian")).toHaveLength(1);
		expect(errors).toEqual([]);
		await page.close();
	});
});

describe("the quest office", () => {
	test("the square's door opens it; before sign-in the board is bare and the clerk sends the operator to Settings", async () => {
		const { page, errors } = await openWorld(world(), false);
		await travel(page, /square/i, "square");
		await clickThrough(page);
		const door = (await view<{ name: string; to: string; x: number; y: number }[]>(page, "doors()")).find(
			(d) => d.to === "quest-office",
		)!;
		await page.mouse.click(door.x, door.y);
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe("quest-office"), { timeout: 15000 });
		await page.waitForTimeout(600);
		expect(await notices(page)).toEqual([]);
		await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: auto !important; }" });
		await talkToHost(page, "The quest office");
		const dialog = page.getByRole("dialog", { name: "The quest office" });
		expect(await dialog.textContent()).toContain("Sign in to Atlassian in Settings");
		await shot(page, "aw-24-signed-out");
		await dialog.getByRole("button", { name: "Sign in from Settings" }).click();
		await dialog.waitFor({ state: "detached" });
		const section = page.getByRole("region", { name: "Atlassian" });
		await vi.waitFor(async () =>
			expect(await section.getByLabel("Site").evaluate((el) => el === document.activeElement)).toBe(true),
		);
		expect(await callsOf(page, "jiraSearch")).toEqual([]);
		expect(errors).toEqual([]);
		await page.close();
	});

	test("signed in, each assigned issue is a notice on the board, as pressing as it is; the rest wait at the counter", async () => {
		const { page, errors } = await openWorld(world(), true, MANY);
		await travel(page, /^The quest office/, "quest-office");
		await vi.waitFor(async () => expect(await notices(page)).toHaveLength(10));
		const pinned = await notices(page);
		const kinds = Object.fromEntries(pinned.map((n) => [n.key, n.kind]));
		// The most pressing first: the highest priority, then high, then the rest.
		expect(pinned.map((n) => n.key).slice(0, 2)).toEqual(["DATA-7", "APP-101"]);
		expect(kinds).toMatchObject({ "DATA-7": "urgent", "APP-101": "urgent", "APP-97": "progress", "OPS-12": "open" });
		expect(pinned.some((n) => n.key === "APP-126")).toBe(false);
		await shot(page, "aw-24-board");

		// Reading a notice walks to the board and opens the issue.
		await clickThrough(page);
		const first = pinned.find((n) => n.key === "APP-101")!;
		const [sx, sy] = await screen(page, first.x, first.y);
		await page.mouse.move(sx, sy);
		await vi.waitFor(async () => expect((await notices(page)).find((n) => n.key === "APP-101")?.sign).toBe(true));
		expect(await page.locator(".pointer-hover").textContent()).toContain("APP-101");
		await shot(page, "aw-24-notice-hover");
		await page.mouse.click(sx, sy);
		const dialog = page.getByRole("dialog", { name: "Issue APP-101" });
		await dialog.waitFor({ timeout: 10000 });
		expect(errors).toEqual([]);
		await page.close();
	});

	test("the clerk lists the issues assigned; search finds any issue; an issue reads sanitised and opens in Jira", async () => {
		const { page, errors } = await openWorld(world(), true);
		await travel(page, /^The quest office/, "quest-office");
		await talkToHost(page, "The quest office");
		const dialog = page.getByRole("dialog", { name: "The quest office" });
		const yours = dialog.getByRole("list", { name: "Your issues" });
		await vi.waitFor(async () => expect(await yours.getByRole("listitem").count()).toBe(5));
		expect(await dialog.textContent()).toContain("5 quests bear your name");
		await shot(page, "aw-24-clerk");

		await dialog.getByRole("searchbox", { name: "Search every issue" }).fill("safari");
		const results = dialog.getByRole("list", { name: "Search results" });
		await vi.waitFor(async () => expect(await results.getByRole("listitem").count()).toBe(2));
		expect((await callsOf(page, "jiraSearch")).at(-1)).toEqual(["jiraSearch", "safari"]);
		await shot(page, "aw-24-search");
		await results.getByRole("button", { name: /APP-101/ }).click();

		const issueDialog = page.getByRole("dialog", { name: "Issue APP-101" });
		await vi.waitFor(async () => expect(await issueDialog.textContent()).toContain("Safari 18"));
		const text = await issueDialog.textContent();
		for (const shown of [
			"Login fails on Safari",
			"To Do",
			"Bug",
			"High",
			"Priya Shah",
			"Reproduced on Safari 18.1",
			"SameSite flag",
		])
			expect(text).toContain(shown);
		// The description is sanitised: nothing ran, nothing loads, no handler or style survives.
		const description = issueDialog.locator(".aw-issue-description");
		expect(await description.locator("script, img, iframe, style, [onclick], [onerror], [style]").count()).toBe(0);
		expect(await description.locator(".aw-rich-image").textContent()).toBe("safari-screenshot.png");
		expect(await description.locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href")))).toEqual([
			`${SITE}/browse/APP-1`,
		]);
		expect(await description.textContent()).toContain("click me");
		expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
		await shot(page, "aw-24-issue");

		await issueDialog.getByRole("button", { name: "Open in Jira" }).click();
		await description.getByRole("link", { name: "APP-1" }).click();
		expect(await callsOf(page, "openLink")).toEqual([
			["openLink", `${SITE}/browse/APP-101`],
			["openLink", `${SITE}/browse/APP-1`],
		]);
		// Back to the list, the search still there.
		await issueDialog.getByRole("button", { name: /Back/ }).click();
		await vi.waitFor(async () =>
			expect(await page.getByRole("searchbox", { name: "Search every issue" }).inputValue()).toBe("safari"),
		);
		expect(errors).toEqual([]);
		await page.close();
	});

	test("a comment and a move reach Jira only once the operator confirms exactly what goes where", async () => {
		const { page, errors } = await openWorld(world(), true);
		await travel(page, /^The quest office/, "quest-office");
		await talkToHost(page, "The quest office");
		await page
			.getByRole("list", { name: "Your issues" })
			.getByRole("button", { name: /APP-101/ })
			.click();
		const dialog = page.getByRole("dialog", { name: "Issue APP-101" });
		await vi.waitFor(async () => expect(await dialog.textContent()).toContain("Safari 18"));

		await dialog.getByRole("button", { name: "Comment", exact: true }).click();
		await dialog.getByRole("textbox", { name: "Your comment on APP-101" }).fill("Fixed by setting SameSite=Lax.");
		await dialog.getByRole("button", { name: /Review and post/ }).click();
		const confirm = page.getByRole("alertdialog", { name: "Comment on Jira issue?" });
		await confirm.waitFor();
		expect(await confirm.textContent()).toContain("APP-101 on acme.atlassian.net");
		expect(await confirm.getByLabel("Exactly what is sent").textContent()).toBe("Fixed by setting SameSite=Lax.");
		expect(await callsOf(page, "confirmWrite")).toEqual([]);
		// The same confirmation as every place's: until it is answered, Tab never reaches the issue behind it.
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press("Tab");
			const behind = await page.evaluate(() => {
				const at = document.activeElement;
				return !!at?.closest("[role=toolbar], textarea") && !at.closest("[role=alertdialog]");
			});
			expect(behind, `Tab ${i + 1}`).toBe(false);
		}
		await shot(page, "aw-25-confirm-comment");
		// Escape cancels the confirmation, not the issue; nothing is sent.
		await page.keyboard.press("Escape");
		await confirm.waitFor({ state: "detached" });
		expect(await dialog.isVisible()).toBe(true);
		expect(await callsOf(page, "confirmWrite")).toEqual([]);

		await dialog.getByRole("button", { name: /Review and post/ }).click();
		await page
			.getByRole("alertdialog", { name: "Comment on Jira issue?" })
			.getByRole("button", { name: "Send as you" })
			.click();
		await vi.waitFor(async () => expect(await dialog.textContent()).toContain("Your comment is on the issue."));
		const describe = (await callsOf(page, "describeWrite")).at(-1)!;
		expect(await callsOf(page, "confirmWrite")).toEqual([
			["confirmWrite", { kind: "jira-comment", key: "APP-101", body: "Fixed by setting SameSite=Lax." }, "t2"],
		]);
		expect(describe[1]).toEqual({ kind: "jira-comment", key: "APP-101", body: "Fixed by setting SameSite=Lax." });
		// Logged in the chatbox.
		await vi.waitFor(async () =>
			expect(await page.getByRole("log", { name: "World events" }).textContent()).toContain(
				"You commented on APP-101.",
			),
		);

		await dialog.getByRole("button", { name: "Move", exact: true }).click();
		const moves = dialog.getByRole("group", { name: "Move to" });
		await vi.waitFor(async () => expect(await moves.getByRole("button").count()).toBe(2));
		expect(await moves.getByRole("button").allTextContents()).toEqual(["Start progressto In Progress", "Done"]);
		await shot(page, "aw-25-moves");
		await moves.getByRole("button", { name: /Start progress/ }).click();
		const move = page.getByRole("alertdialog", { name: "Move Jira issue?" });
		await move.waitFor();
		expect(await move.getByLabel("Exactly what is sent").textContent()).toBe("Start progress (to In Progress)");
		await shot(page, "aw-25-confirm-move");
		await move.getByRole("button", { name: "Send as you" }).click();
		await vi.waitFor(async () =>
			expect(await dialog.textContent()).toContain("Moved: Start progress (to In Progress)."),
		);
		expect((await callsOf(page, "confirmWrite")).at(-1)).toEqual([
			"confirmWrite",
			{ kind: "jira-transition", key: "APP-101", transition: "11" },
			"t3",
		]);
		expect(await callsOf(page, "jiraTransitions")).toEqual([["jiraTransitions", "APP-101"]]);
		expect(errors).toEqual([]);
		await page.close();
	});

	test("Hand to the coordinator sends an instruction naming the issue and writes nothing to Jira", async () => {
		const { page, errors } = await openWorld(world(), true);
		await travel(page, /^The quest office/, "quest-office");
		await talkToHost(page, "The quest office");
		await page
			.getByRole("list", { name: "Your issues" })
			.getByRole("button", { name: /APP-101/ })
			.click();
		const dialog = page.getByRole("dialog", { name: "Issue APP-101" });
		await vi.waitFor(async () => expect(await dialog.textContent()).toContain("Safari 18"));
		await dialog.getByRole("button", { name: "Hand to the coordinator" }).click();
		const form = dialog.getByRole("form", { name: "Hand APP-101 to the coordinator" });
		expect(await form.textContent()).toContain("Orla");
		await form.getByRole("textbox").fill("Start with the cookie flags.");
		await shot(page, "aw-25-hand");
		await form.getByRole("button", { name: "Hand it over" }).click();
		await vi.waitFor(async () => expect(await form.getByRole("status").textContent()).toBe("Orla has it."));
		const [, , delegation] = (await callsOf(page, "delegate"))[0];
		expect(delegation).toEqual({
			to: "coordinator",
			item: { kind: "issue", key: "APP-101", summary: ASSIGNED[1].summary, url: `${SITE}/browse/APP-101` },
			ask: "start-work",
			note: "Start with the cookie flags.",
		});
		expect(await callsOf(page, "describeWrite")).toEqual([]);
		expect(await callsOf(page, "confirmWrite")).toEqual([]);
		await vi.waitFor(async () =>
			expect(await page.getByRole("log", { name: "World events" }).textContent()).toContain(
				"You hand APP-101 to Orla.",
			),
		);
		await shot(page, "aw-25-handed");
		expect(errors).toEqual([]);
		await page.close();
	});

	test("one panel at a time: opening another panel or a conversation closes the clerk's, and closing it brings nothing back", async () => {
		const { page, errors } = await openWorld(world(), true);
		const dialogs = page.getByRole("dialog");
		const names = () => dialogs.evaluateAll((all) => all.map((d) => d.getAttribute("aria-label")));
		await travel(page, /^The quest office/, "quest-office");
		await talkToHost(page, "The quest office");
		expect(await names()).toEqual(["The quest office"]);

		// The rookery's letter from the Mail tab (the side panel lies under the panel's veil, so the click is dispatched).
		await page.getByRole("tab", { name: "Mail", exact: true }).dispatchEvent("click");
		await page.locator(".aw-mail-write").dispatchEvent("click");
		await vi.waitFor(async () => expect(await names()).toEqual(["The rookery"]));
		await page.keyboard.press("Escape");
		await vi.waitFor(async () => expect(await names()).toEqual([]));
		await page.waitForTimeout(300);
		expect(await names()).toEqual([]);

		// A conversation from the Agents tab closes the clerk's panel too.
		await talkToHost(page, "The quest office");
		await page.getByRole("tab", { name: "Agents", exact: true }).dispatchEvent("click");
		await page.getByRole("button", { name: /^scribe/ }).dispatchEvent("click");
		await page.getByRole("button", { name: "Talk to scribe", exact: true }).dispatchEvent("click");
		await vi.waitFor(async () => expect(await names()).toEqual(["Conversation with scribe"]));
		await page.keyboard.press("Escape");
		await vi.waitFor(async () => expect(await names()).toEqual([]));
		await page.waitForTimeout(300);
		expect(await names()).toEqual([]);
		expect(errors).toEqual([]);
		await page.close();
	});
});

describe("the library", () => {
	test("it searches all of Confluence; a page reads sanitised in the panel, joins the recent list, and opens outside", async () => {
		const { page, errors } = await openWorld(world(), true);
		await travel(page, /^The library/, "library");
		await talkToHost(page, "The library");
		const dialog = page.getByRole("dialog", { name: "The library" });
		await vi.waitFor(async () => expect(await dialog.textContent()).toContain("Nothing read yet"));
		await dialog.getByRole("searchbox", { name: "Search all of Confluence" }).fill("release");
		const results = dialog.getByRole("list", { name: "Search results" });
		await vi.waitFor(async () => expect(await results.getByRole("listitem").count()).toBe(2));
		expect(await results.textContent()).toContain("Engineering");
		expect(await results.textContent()).toContain("Product");
		await shot(page, "aw-26-search");
		await results.getByRole("button", { name: /Release process/ }).click();

		const reader = page.getByRole("dialog", { name: "Release process" });
		const body = reader.locator(".aw-page-body");
		await vi.waitFor(async () => expect(await body.textContent()).toContain("Never release on a Friday."));
		expect(await body.locator("script, style, img").count()).toBe(0);
		expect(await body.locator(".aw-rich-panel-warning").count()).toBe(1);
		expect(await body.locator("table th").allTextContents()).toEqual(["Step", "Owner"]);
		expect(await body.locator(".aw-rich-image").textContent()).toBe("flow.png");
		expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
		await shot(page, "aw-26-page");
		await reader.getByRole("button", { name: "Open in the browser" }).click();
		await body.getByRole("link", { name: "the checklist" }).click();
		expect(await callsOf(page, "openLink")).toEqual([
			["openLink", `${SITE}/wiki/spaces/ENG/pages/501`],
			["openLink", `${SITE}/wiki/spaces/ENG/pages/9`],
		]);

		// The page joins the shelf of pages read lately.
		await reader.getByRole("button", { name: /Back/ }).click();
		await dialog.getByRole("searchbox", { name: "Search all of Confluence" }).fill("");
		const recent = page.getByRole("dialog", { name: "The library" }).getByRole("list", { name: "Read lately" });
		await vi.waitFor(async () => expect(await recent.getByRole("listitem").count()).toBe(1));
		expect(await recent.textContent()).toContain("Release process");
		await shot(page, "aw-26-recent");
		expect(errors).toEqual([]);
		await page.close();
	});

	test("asking an agent to summarise or update a page sends an instruction naming it and writes nothing", async () => {
		const { page, errors } = await openWorld(world(), true);
		await travel(page, /^The library/, "library");
		await talkToHost(page, "The library");
		await page.getByRole("searchbox", { name: "Search all of Confluence" }).fill("release");
		await page
			.getByRole("list", { name: "Search results" })
			.getByRole("button", { name: /Release process/ })
			.click();
		const reader = page.getByRole("dialog", { name: "Release process" });
		await vi.waitFor(async () => expect(await reader.textContent()).toContain("Never release on a Friday."));
		await reader.getByRole("button", { name: "Ask an agent about it" }).click();
		const form = reader.getByRole("form", { name: /Ask an agent about/ });
		await form.getByRole("combobox", { name: "Which agent" }).selectOption("scribe");
		await form.locator("label", { hasText: "Update it" }).click();
		await form.getByRole("textbox").fill("Add the Friday rule to the checklist.");
		await shot(page, "aw-26-ask");
		await form.getByRole("button", { name: "Ask", exact: true }).click();
		await vi.waitFor(async () => expect((await callsOf(page, "delegate")).length).toBe(1));
		const [, , delegation] = (await callsOf(page, "delegate"))[0];
		expect(delegation).toEqual({
			to: "scribe",
			item: { kind: "page", id: "501", title: "Release process", url: `${SITE}/wiki/spaces/ENG/pages/501` },
			ask: "update",
			note: "Add the Friday rule to the checklist.",
		});
		expect(await callsOf(page, "describeWrite")).toEqual([]);
		expect(await callsOf(page, "confirmWrite")).toEqual([]);
		expect(errors).toEqual([]);
		await page.close();
	});

	test("before sign-in the librarian sends the operator to Settings", async () => {
		const { page, errors } = await openWorld(world(), false);
		await travel(page, /^The library/, "library");
		await talkToHost(page, "The library");
		const dialog = page.getByRole("dialog", { name: "The library" });
		await vi.waitFor(async () => expect(await dialog.textContent()).toContain("Sign in to Atlassian in Settings"));
		expect(await dialog.getByRole("searchbox").count()).toBe(0);
		await shot(page, "aw-26-signed-out");
		expect(errors).toEqual([]);
		await page.close();
	});
});

// The same places in every theme, for judging the art and the skins on screenshots (AGENT_WORLD_SHOTS only).
describe.skipIf(!SHOTS)("in every theme", () => {
	for (const theme of ["fantasy", "tech-office", "anime-school"])
		test(`the quest office and the library in ${theme}`, async () => {
			const { page, errors } = await openWorld(world(theme), true, MANY);
			await travel(page, /quest|planning|council/i, "quest-office");
			await vi.waitFor(async () => expect(await notices(page)).toHaveLength(10));
			await page.waitForTimeout(500);
			await shot(page, `aw-24-${theme}-board`);
			await talkToHost(page, (await page.locator(".place-title").textContent())?.trim() ?? "");
			await shot(page, `aw-24-${theme}-clerk`);
			await page
				.getByRole("list", { name: "Your issues" })
				.getByRole("button", { name: /APP-101/ })
				.click();
			const issueDialog = page.getByRole("dialog", { name: "Issue APP-101" });
			await vi.waitFor(async () => expect(await issueDialog.textContent()).toContain("Safari 18"));
			await shot(page, `aw-24-${theme}-issue`);
			await issueDialog.getByRole("button", { name: "Move", exact: true }).click();
			await vi.waitFor(async () =>
				expect(await issueDialog.getByRole("group", { name: "Move to" }).getByRole("button").count()).toBe(2),
			);
			await issueDialog.getByRole("button", { name: /Start progress/ }).click();
			await page.getByRole("alertdialog").getByRole("button", { name: "Send as you" }).waitFor();
			await shot(page, `aw-25-${theme}-confirm`);
			await page.keyboard.press("Escape");
			await issueDialog.getByRole("button", { name: "Hand to the coordinator" }).click();
			await shot(page, `aw-25-${theme}-hand`);
			await page.getByRole("button", { name: "Close", exact: true }).click();
			await issueDialog.waitFor({ state: "detached" });

			await page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: auto !important; }" });
			await travel(page, /library/i, "library");
			await page.waitForTimeout(500);
			await shot(page, `aw-26-${theme}-library`);
			await talkToHost(page, (await page.locator(".place-title").textContent())?.trim() ?? "");
			await page.getByRole("searchbox").fill("release");
			await vi.waitFor(async () =>
				expect(await page.getByRole("list", { name: "Search results" }).getByRole("listitem").count()).toBe(2),
			);
			await shot(page, `aw-26-${theme}-search`);
			await page
				.getByRole("list", { name: "Search results" })
				.getByRole("button", { name: /Release process/ })
				.click();
			const reader = page.getByRole("dialog", { name: "Release process" });
			await vi.waitFor(async () => expect(await reader.textContent()).toContain("Never release on a Friday."));
			await shot(page, `aw-26-${theme}-page`);
			await reader.getByRole("button", { name: "Ask an agent about it" }).click();
			await shot(page, `aw-26-${theme}-ask`);
			await page.getByRole("button", { name: "Close", exact: true }).click();
			await reader.waitFor({ state: "detached" });
			await page.getByRole("tab", { name: "Settings", exact: true }).dispatchEvent("click");
			await page.getByRole("region", { name: "Atlassian" }).evaluate((el) => el.scrollIntoView());
			await shot(page, `aw-24-${theme}-settings`);
			expect(errors).toEqual([]);
			await page.close();
		});
});

describe("the Places tab", () => {
	test("counts the issues assigned to you and the pages read lately, as it counts the forge's pull requests", async () => {
		const { page, errors } = await openWorld(world(), true);
		const row = (name: string) => page.locator(".aw-place").filter({ hasText: name });
		await page.getByRole("tab", { name: "Places", exact: true }).dispatchEvent("click");
		// Opening the tab reads what was not read yet: the quest office counts its open issues and the pressing ones.
		await vi.waitFor(async () =>
			expect(await row("The quest office").textContent()).toContain("5 assigned, 2 pressing"),
		);
		// Nothing read in the library yet: no count.
		expect(await row("The library").locator(".aw-row-detail").textContent()).toBe("");
		// A page read in the library is counted.
		await travel(page, /^The library/, "library");
		await talkToHost(page, "The library");
		const dialog = page.getByRole("dialog", { name: "The library" });
		await dialog.getByRole("searchbox", { name: "Search all of Confluence" }).fill("release");
		await dialog
			.getByRole("list", { name: "Search results" })
			.getByRole("button", { name: /Release process/ })
			.click();
		const reader = page.getByRole("dialog", { name: "Release process" });
		await vi.waitFor(async () => expect(await reader.textContent()).toContain("Never release on a Friday."));
		await page.keyboard.press("Escape");
		await reader.waitFor({ state: "detached" });
		// Away from the library (where its row says "You are here"), its row counts what was read.
		await travel(page, /^Village square/, "square");
		await vi.waitFor(async () => expect(await row("The library").textContent()).toContain("1 page read lately"));
		await shot(page, "aw-31-places-counts");
		expect(errors).toEqual([]);
		await page.close();
	});

	test("signed out of Atlassian, the quest office shows no count and nothing is asked of Jira", async () => {
		const { page, errors } = await openWorld(world(), false);
		await page.getByRole("tab", { name: "Places", exact: true }).dispatchEvent("click");
		await page.waitForTimeout(500);
		const quest = page.locator(".aw-place").filter({ hasText: "The quest office" });
		expect(await quest.locator(".aw-row-detail").textContent()).toBe("");
		expect(await callsOf(page, "jiraAssigned")).toEqual([]);
		expect(errors).toEqual([]);
		await page.close();
	});
});
