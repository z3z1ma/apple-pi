import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { PullRequest, PullRequestDetail } from "../src/integrations.js";
import type { Character, CharacterFacts, WorldSnapshot } from "../src/world.js";
import type { PlaceData } from "../web/theme.js";

// Seam 2 for the forge (tickets 21-23): the committed, built world UI in headless Chrome over a fixture backend that
// answers the integrations API (pull requests, a diff, the outside-write gate, delegation) and records every call.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
// AGENT_WORLD_SHOTS=<dir> saves screenshots there as aw-2x-*.png.
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const placeData = (theme: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${theme}/places/forge.json`, import.meta.url)), "utf8"));

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
const PARSER: Character = {
	id: "parser",
	name: "parser",
	role: "worker",
	place: { kind: "wing", headquarters: HQ, repository: "/r/apple-pi" },
	startedAt: NOW - 8_000_000,
	facts: facts({
		run: "running_tool",
		status: "working",
		git: { repository: "/r/apple-pi", worktree: "/r/apple-pi", branch: "feat/parser" },
	}),
};
function world(characters: Character[] = [ORLA, PARSER], theme?: string): WorldSnapshot {
	return {
		connected: true,
		theme: theme ?? null,
		headquarters: [{ id: HQ, name: "Orla", wings: [{ repository: "/r/apple-pi", name: "apple-pi", headcount: 1 }] }],
		characters,
		dormant: [],
		mail: [],
	};
}

const checks = (passing: number, failing: number, running: number) => ({
	passing,
	failing,
	running,
	total: passing + failing + running,
});
const pr = (number: number, title: string, over: Partial<PullRequest> = {}): PullRequest => ({
	repo: "z3z1ma/apple-pi",
	number,
	title,
	url: `https://github.com/z3z1ma/apple-pi/pull/${number}`,
	author: "z3z1ma",
	draft: false,
	branch: `topic-${number}`,
	updatedAt: new Date(NOW - number * 600_000).toISOString(),
	ci: "passing",
	checks: checks(6, 0, 0),
	reviewDecision: "REVIEW_REQUIRED",
	agent: null,
	involvesYou: true,
	...over,
});
const LINKED = pr(41, "Parse comments as tokens", {
	branch: "feat/parser",
	ci: "failing",
	checks: checks(4, 2, 1),
	agent: { id: "parser", name: "parser" },
	involvesYou: false,
	author: "agent-bot",
});
const PRS: PullRequest[] = [
	LINKED,
	pr(42, "Agent World: the forge shows pull requests", { ci: "running", checks: checks(3, 0, 4) }),
	pr(43, "Stream replies to the notch", { reviewDecision: "APPROVED" }),
	pr(44, "Draft: tmux sidebar colours", { draft: true, ci: "none", checks: checks(0, 0, 0), reviewDecision: null }),
	pr(45, "Fix the ledger index when a task closes", { repo: "z3z1ma/pi-ledger", ci: "passing" }),
];
const DETAIL: PullRequestDetail = {
	pullRequest: LINKED,
	body: "<!-- template -->\nTokens for **comments**, so the formatter keeps them.\n\n- lexer emits `Comment`\n- parser keeps them",
	baseBranch: "main",
	state: "OPEN",
	checks: [
		{ name: "test (ubuntu)", state: "failing" },
		{ name: "lint", state: "passing" },
		{ name: "typecheck", state: "running" },
	],
	files: [
		{
			path: "src/parser.ts",
			oldPath: "src/parser.ts",
			status: "modified",
			binary: false,
			additions: 2,
			deletions: 1,
			hunks: [
				{
					header: "@@ -10,4 +10,5 @@ export function parse(source: string) {",
					lines: [
						{ kind: "context", old: 10, new: 10, text: "\tconst tokens = lex(source);" },
						{ kind: "del", old: 11, new: null, text: "\treturn tokens.filter((t) => t.kind !== 'comment');" },
						{ kind: "add", old: null, new: 11, text: "\t// Comments are tokens now: keep them." },
						{ kind: "add", old: null, new: 12, text: "\treturn tokens;" },
						{ kind: "context", old: 12, new: 13, text: "}" },
					],
				},
			],
		},
		{
			path: "src/lexer/comment.ts",
			oldPath: "src/lexer/comment.ts",
			status: "added",
			binary: false,
			additions: 3,
			deletions: 0,
			hunks: [
				{
					header: "@@ -0,0 +1,3 @@",
					lines: [
						{ kind: "add", old: null, new: 1, text: "export function comment(text: string) {" },
						{ kind: "add", old: null, new: 2, text: "\treturn { kind: 'comment', text };" },
						{ kind: "add", old: null, new: 3, text: "}" },
					],
				},
			],
		},
	],
	cut: false,
};

/** Open the world over a fixture backend; `window.calls` records what it was asked. */
async function openWorld(first: WorldSnapshot, answers: Record<string, unknown> = {}) {
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
		({ snapshot, prs, detail, answers }) => {
			const w = window as any;
			let current = snapshot;
			const listeners = new Set<(s: unknown) => void>();
			const writeListeners = new Set<(e: unknown) => void>();
			const receiptListeners = new Set<(r: unknown) => void>();
			w.calls = [];
			w.answers = { pullRequests: { ok: true, pullRequests: prs }, ...answers };
			w.agentWorldForgeRefreshMs = answers.refreshMs;
			let tokens = 0;
			const describe = (intent: any) => {
				const what = { approve: "Approve", comment: "Comment on", "request-changes": "Request changes on" }[
					intent.event as string
				];
				return {
					what: `${what} pull request`,
					where: `${intent.repo}#${intent.number} on GitHub`,
					text: intent.body,
					url: `https://github.com/${intent.repo}/pull/${intent.number}`,
				};
			};
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
					receiptListeners.add(listener);
					return () => receiptListeners.delete(listener);
				},
				watchReplies: async () => {},
				onReply: () => () => {},
				openLink: async (url: string) => {
					w.calls.push(["openLink", url]);
					return { ok: true };
				},
				pullRequests: async () => {
					w.calls.push(["pullRequests"]);
					return w.answers.pullRequests;
				},
				pullRequest: async (repo: string, number: number) => {
					w.calls.push(["pullRequest", repo, number]);
					const found = w.answers.pullRequests.pullRequests?.find((p: any) => p.repo === repo && p.number === number);
					return { ok: true, detail: { ...detail, pullRequest: found ?? detail.pullRequest } };
				},
				describeWrite: async (intent: unknown) => {
					const token = `token-${++tokens}`;
					w.calls.push(["describeWrite", intent, token]);
					return { ok: true, token, description: describe(intent) };
				},
				confirmWrite: async (intent: any, token: string) => {
					w.calls.push(["confirmWrite", intent, token]);
					const description = describe(intent);
					const ref = `${intent.repo}#${intent.number}`;
					const line =
						intent.event === "approve"
							? `You approved ${ref}${intent.body ? `: ${intent.body}` : ""}.`
							: intent.event === "comment"
								? `You commented on ${ref}: ${intent.body}`
								: `You requested changes on ${ref}: ${intent.body}`;
					const entry = { at: Date.now(), kind: "github-review", ...description, ok: true, line };
					for (const listener of writeListeners) listener(entry);
					return { ok: true, entry };
				},
				outsideWrites: async () => [],
				onOutsideWrite(listener: (e: unknown) => void) {
					writeListeners.add(listener);
					return () => writeListeners.delete(listener);
				},
				delegate: async (commandId: string, delegation: any) => {
					w.calls.push(["delegate", commandId, delegation]);
					const to = delegation.to === "coordinator" ? "orla" : delegation.to;
					for (const stage of ["accepted", "delivered", "applied"])
						for (const listener of receiptListeners) listener({ commandId, characterId: to, stage });
					return { ok: true, to, command: to === "parser" ? "follow_up" : "talk" };
				},
			};
			w.pushSnapshot = (next: unknown) => {
				current = next as typeof snapshot;
				for (const listener of listeners) listener(next);
			};
		},
		{ snapshot: first, prs: PRS, detail: DETAIL, answers },
	);
	await page.goto(`${ORIGIN}/index.html?world`);
	await vi.waitFor(async () => expect(await view(page, "avatar()")).toBeTruthy(), { timeout: 15000 });
	await page.waitForTimeout(400); // the arrival fade
	return { page, errors };
}

interface WorkView {
	key: string;
	repo: string;
	number: number;
	ci: string;
	x: number;
	y: number;
	art: string;
	alpha: number;
	sign: boolean;
}

const view = <T>(page: Page, call: string): Promise<T> =>
	page.evaluate((c) => new Function(`return window.agentWorldView.${c}`)(), call) as Promise<T>;
const work = (page: Page) => view<WorkView[]>(page, "work()");
const calls = (page: Page) => page.evaluate(() => (window as any).calls) as Promise<unknown[][]>;
const called = async (page: Page, name: string) => (await calls(page)).filter(([kind]) => kind === name);
const screen = (page: Page, x: number, y: number) =>
	page.evaluate(([a, b]) => (window as any).agentWorldView.toScreen(a, b), [x, y]) as Promise<[number, number]>;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();
const clickThrough = (page: Page) =>
	page.addStyleTag({ content: ".aw-interface, .aw-interface * { pointer-events: none !important; }" });
const panelsClickable = (page: Page) =>
	page.addStyleTag({ content: ".aw-place-veil, .aw-place-veil * { pointer-events: auto !important; }" });

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Travel to the forge from the Places tab, zoomed out so the whole room shows. */
async function toForge(page: Page) {
	await tab(page, "Places");
	await page.getByRole("button", { name: /^(The forge|The hardware lab|The shop workshop)/ }).click();
	await vi.waitFor(async () => expect(await view(page, "place()")).toBe("forge"), { timeout: 5000 });
	await page.mouse.move(640, 300);
	for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
	await page.waitForTimeout(800);
}

/** Talk to the forge's host: the smith's list opens. */
async function talkToSmith(page: Page, theme = "fantasy") {
	await clickThrough(page);
	const [x, y] = placeData(theme).host!.at;
	const [sx, sy] = await screen(page, x, y - 1.2);
	await page.mouse.click(sx, sy);
	const panel = page.getByRole("dialog", { name: /^(The forge|The hardware lab|The shop workshop)$/ });
	await panel.waitFor({ timeout: 8000 });
	await panelsClickable(page);
	return panel;
}

test("the forge lays the open pull requests on its benches in their CI state, read on entering and again while there", async () => {
	const { page, errors } = await openWorld(world(), { refreshMs: 1500 });
	try {
		expect(await called(page, "pullRequests")).toHaveLength(0);
		await toForge(page);
		await vi.waitFor(async () => expect(await work(page)).toHaveLength(PRS.length), { timeout: 5000 });
		const pieces = await work(page);
		const byNumber = Object.fromEntries(pieces.map((piece) => [piece.number, piece]));
		expect(byNumber[41]).toMatchObject({ ci: "failing", art: "blade-failing" });
		expect(byNumber[42]).toMatchObject({ ci: "running", art: "blade-running" });
		expect(byNumber[43]).toMatchObject({ ci: "passing", art: "blade-passing" });
		// A draft lies a little faded; one without checks wears the plain piece.
		expect(byNumber[44].art).toBe("blade-passing");
		expect(byNumber[44].alpha).toBeLessThan(1);
		// Each lies on a workbench slot of the painting.
		const slots = placeData("fantasy").overlaySlots.filter((slot) => slot.kind === "work");
		for (const piece of pieces)
			expect(slots.some((slot) => slot.at[0] === piece.x && slot.at[1] === piece.y)).toBe(true);
		// Read on entering, then again on the interval while the operator stays.
		await vi.waitFor(async () => expect((await called(page, "pullRequests")).length).toBeGreaterThanOrEqual(2), {
			timeout: 5000,
		});
		await shot(page, "aw-21-forge");
		// Hovering a piece names it on a sign.
		const piece = byNumber[41];
		const [sx, sy] = await screen(page, piece.x, piece.y - 0.4);
		await page.mouse.move(sx, sy);
		await vi.waitFor(async () => expect((await work(page)).find((p) => p.number === 41)?.sign).toBe(true));
		await expect.poll(() => page.locator(".pointer-hover").textContent()).toContain("#41 Parse comments as tokens");
		await shot(page, "aw-21-forge-hover");
		// Leaving stops the reading (the Places tab is still open).
		await page.getByRole("button", { name: /^Village square/ }).click();
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe("square"));
		const after = (await called(page, "pullRequests")).length;
		await page.waitForTimeout(3200);
		expect((await called(page, "pullRequests")).length).toBe(after);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("the smith lists every pull request with its CI, and a card shows its facts with Open in GitHub", async () => {
	const { page, errors } = await openWorld(world());
	try {
		await toForge(page);
		const panel = await talkToSmith(page);
		const rows = panel.getByRole("list", { name: "Open pull requests" }).getByRole("listitem");
		await expect.poll(() => rows.count()).toBe(PRS.length);
		const first = (await rows.first().textContent()) ?? "";
		for (const text of ["#41", "Parse comments as tokens", "z3z1ma/apple-pi", "agent-bot", "feat/parser", "parser"])
			expect(first).toContain(text);
		expect(await rows.first().getByRole("img", { name: "CI failing" }).count()).toBe(1);
		expect(await panel.getByRole("img", { name: "CI running" }).count()).toBeGreaterThan(0);
		await shot(page, "aw-21-list");
		// Search narrows the list.
		await panel.getByRole("searchbox", { name: "Search the pull requests" }).fill("ledger");
		await expect.poll(() => rows.count()).toBe(1);
		await panel.getByRole("searchbox", { name: "Search the pull requests" }).fill("");
		// A row opens the card.
		await rows.first().getByRole("button").click();
		const card = page.getByRole("dialog", { name: "Pull request #41" });
		await card.waitFor();
		const text = (await card.textContent()) ?? "";
		for (const fact of [
			"Parse comments as tokens",
			"z3z1ma/apple-pi",
			"#41",
			"agent-bot",
			"feat/parser",
			"main",
			"Failing",
			"2 of 7 failing",
			"parser",
		])
			expect(text).toContain(fact);
		await expect.poll(async () => (await card.textContent()) ?? "").toContain("test (ubuntu)");
		await shot(page, "aw-21-card");
		await card.getByRole("button", { name: "Open in GitHub" }).click();
		await expect.poll(() => called(page, "openLink")).toEqual([["openLink", LINKED.url]]);
		// Back to the list, and Escape closes the forge.
		await card.getByRole("button", { name: "All pull requests" }).click();
		await panel.waitFor();
		await page.keyboard.press("Escape");
		await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("without gh signed in the forge says how to sign in, and the benches stay bare", async () => {
	const { page, errors } = await openWorld(world(), {
		pullRequests: { ok: false, reason: "Sign in to GitHub with `gh auth login` first.", signIn: "github" },
	});
	try {
		await toForge(page);
		expect(await work(page)).toEqual([]);
		const panel = await talkToSmith(page);
		await expect.poll(async () => (await panel.textContent()) ?? "").toContain("gh auth login");
		await shot(page, "aw-21-signed-out");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("looking over a piece on a bench walks up to it and opens its card", async () => {
	const { page, errors } = await openWorld(world());
	try {
		await toForge(page);
		await vi.waitFor(async () => expect(await work(page)).toHaveLength(PRS.length));
		await clickThrough(page);
		const piece = (await work(page)).find((p) => p.number === 42)!;
		const [sx, sy] = await screen(page, piece.x, piece.y - 0.35);
		await page.mouse.click(sx, sy);
		const card = page.getByRole("dialog", { name: "Pull request #42" });
		await card.waitFor({ timeout: 10_000 });
		const avatar = await view<{ x: number; y: number }>(page, "avatar()");
		expect(Math.hypot(avatar.x - piece.x, avatar.y - piece.y)).toBeLessThan(2.2);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

/** Open #41's review page from its card. */
async function openReview(page: Page) {
	await toForge(page);
	const panel = await talkToSmith(page);
	await panel.getByRole("list", { name: "Open pull requests" }).getByRole("button").first().click();
	const card = page.getByRole("dialog", { name: "Pull request #41" });
	await card.getByRole("button", { name: "Review the changes" }).click();
	const review = page.getByRole("dialog", { name: "Review #41" });
	await review.waitFor();
	await review.getByRole("region", { name: "src/parser.ts" }).waitFor();
	return review;
}

test("the review page shows the diff by file, each line with its old and new numbers and its hunk's context", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const review = await openReview(page);
		const parser = review.getByRole("region", { name: "src/parser.ts" });
		expect(await parser.textContent()).toContain("@@ -10,4 +10,5 @@ export function parse(source: string) {");
		const numbers = await parser
			.locator("tr.aw-diff-line")
			.evaluateAll((rows) =>
				rows.map((row) => [...row.querySelectorAll(".aw-diff-no")].map((cell) => cell.getAttribute("data-no"))),
			);
		expect(numbers).toEqual([
			["10", "10"],
			["11", ""],
			["", "11"],
			["", "12"],
			["12", "13"],
		]);
		expect(await parser.locator("tr.aw-diff-del").textContent()).toContain("t.kind !== 'comment'");
		expect(await parser.locator("tr.aw-diff-add").first().textContent()).toContain("Comments are tokens now");
		const files = review.getByRole("navigation", { name: "Files" });
		expect(await files.textContent()).toContain("comment.ts");
		await files.getByRole("button", { name: /comment\.ts/ }).click();
		expect(await review.getByRole("region", { name: "src/lexer/comment.ts" }).textContent()).toContain("Added");
		await shot(page, "aw-22-review");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("a review is sent through the gate only once confirmed as shown; declining sends nothing; each sent one is logged", async () => {
	const { page, errors } = await openWorld(world());
	try {
		const review = await openReview(page);
		const text = review.getByRole("textbox", { name: "Your review" });
		// Comment and Request changes need words; Approve does not.
		expect(await review.getByRole("button", { name: "Comment", exact: true }).isDisabled()).toBe(true);
		expect(await review.getByRole("button", { name: "Request changes" }).isDisabled()).toBe(true);
		await text.fill("Keep the comment's position too, please.");
		await review.getByRole("button", { name: "Request changes" }).click();
		const confirm = page.getByRole("alertdialog", { name: "Request changes on pull request?" });
		await confirm.waitFor();
		const shown = (await confirm.textContent()) ?? "";
		expect(shown).toContain("z3z1ma/apple-pi#41 on GitHub");
		expect(shown).toContain("Keep the comment's position too, please.");
		await shot(page, "aw-22-confirm");
		// Declining sends nothing, and the draft stays.
		await confirm.getByRole("button", { name: "Don\u2019t send" }).click();
		await expect.poll(() => confirm.count()).toBe(0);
		expect(await called(page, "confirmWrite")).toEqual([]);
		expect(await text.inputValue()).toBe("Keep the comment's position too, please.");
		// Escape while it shows declines too, and keeps the review page open.
		await review.getByRole("button", { name: "Comment", exact: true }).click();
		await page.getByRole("alertdialog", { name: "Comment on pull request?" }).waitFor();
		await page.keyboard.press("Escape");
		await expect.poll(() => page.getByRole("alertdialog").count()).toBe(0);
		expect(await review.isVisible()).toBe(true);
		expect(await called(page, "confirmWrite")).toEqual([]);
		// Confirmed, it goes with the token for exactly what was shown.
		await review.getByRole("button", { name: "Comment", exact: true }).click();
		const comment = page.getByRole("alertdialog", { name: "Comment on pull request?" });
		await comment.getByRole("button", { name: "Send as you" }).click();
		await expect.poll(() => called(page, "confirmWrite")).toHaveLength(1);
		const [[, intent, token]] = await called(page, "confirmWrite");
		expect(intent).toEqual({
			kind: "github-review",
			repo: "z3z1ma/apple-pi",
			number: 41,
			event: "comment",
			body: "Keep the comment's position too, please.",
		});
		const described = await called(page, "describeWrite");
		expect(described.at(-1)?.[1]).toEqual(intent);
		expect(token).toBe(described.at(-1)?.[2]);
		await expect
			.poll(async () => (await review.textContent()) ?? "")
			.toContain("You commented on z3z1ma/apple-pi#41: Keep the comment");
		const chat = page.getByRole("log", { name: "World events" });
		await expect.poll(async () => (await chat.textContent()) ?? "").toContain("You commented on z3z1ma/apple-pi#41");
		expect(await text.inputValue()).toBe("");
		// An approval needs no words.
		await review.getByRole("button", { name: "Approve" }).click();
		const approve = page.getByRole("alertdialog", { name: "Approve pull request?" });
		expect(await approve.textContent()).toContain("No text");
		await approve.getByRole("button", { name: "Send as you" }).click();
		await expect.poll(async () => (await chat.textContent()) ?? "").toContain("You approved z3z1ma/apple-pi#41.");
		expect((await called(page, "confirmWrite")).map(([, i]) => (i as { event: string }).event)).toEqual([
			"comment",
			"approve",
		]);
		await shot(page, "aw-22-sent");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("Ask the builder sends the linked agent an instruction naming the pull request, and writes nothing to GitHub", async () => {
	const { page, errors } = await openWorld(world());
	try {
		await toForge(page);
		const panel = await talkToSmith(page);
		await panel.getByRole("list", { name: "Open pull requests" }).getByRole("button").first().click();
		const card = page.getByRole("dialog", { name: "Pull request #41" });
		await card.getByRole("textbox", { name: "Add a note (optional)" }).fill("The reviewer wants the lexer tests too.");
		await card.getByRole("button", { name: "Ask parser to address the review" }).click();
		await expect.poll(() => called(page, "delegate")).toHaveLength(1);
		const [[, , delegation]] = await called(page, "delegate");
		expect(delegation).toEqual({
			to: "parser",
			item: {
				kind: "pull-request",
				repo: "z3z1ma/apple-pi",
				number: 41,
				title: "Parse comments as tokens",
				url: LINKED.url,
			},
			ask: "address-review",
			note: "The reviewer wants the lexer tests too.",
		});
		await expect
			.poll(async () => (await card.textContent()) ?? "")
			.toContain("parser has your request to address the review");
		const chat = page.getByRole("log", { name: "World events" });
		await expect
			.poll(async () => (await chat.textContent()) ?? "")
			.toContain("You asked parser to address the review on z3z1ma/apple-pi#41.");
		await shot(page, "aw-23-asked-builder");
		expect(await called(page, "describeWrite")).toEqual([]);
		expect(await called(page, "confirmWrite")).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test("with no agent linked only Ask the coordinator is offered; it names the pull request and writes nothing", async () => {
	const { page, errors } = await openWorld(world());
	try {
		await toForge(page);
		const panel = await talkToSmith(page);
		await panel.getByRole("button", { name: /^#42 / }).click();
		const card = page.getByRole("dialog", { name: "Pull request #42" });
		await card.waitFor();
		const asks = card.getByRole("region", { name: "Ask for help" }).getByRole("button");
		expect(await asks.allTextContents()).toEqual(["Ask Orla to get it reviewed"]);
		await shot(page, "aw-23-coordinator-only");
		await asks.first().click();
		await expect.poll(() => called(page, "delegate")).toHaveLength(1);
		const [[, , delegation]] = await called(page, "delegate");
		expect(delegation).toMatchObject({
			to: "coordinator",
			ask: "get-reviewed",
			item: { kind: "pull-request", repo: "z3z1ma/apple-pi", number: 42 },
		});
		await expect
			.poll(async () => (await card.textContent()) ?? "")
			.toContain("Orla has your request to get it reviewed");
		expect(await called(page, "describeWrite")).toEqual([]);
		expect(await called(page, "confirmWrite")).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);

test.each(["tech-office", "anime-school"])(
	"the forge in the %s theme: its benches, list, card, and review page",
	async (theme) => {
		const { page, errors } = await openWorld(world([ORLA, PARSER], theme));
		try {
			await toForge(page);
			await vi.waitFor(async () => expect(await work(page)).toHaveLength(PRS.length), { timeout: 5000 });
			await shot(page, `aw-21-${theme}-forge`);
			const panel = await talkToSmith(page, theme);
			await shot(page, `aw-21-${theme}-list`);
			await panel.getByRole("list", { name: "Open pull requests" }).getByRole("button").first().click();
			const card = page.getByRole("dialog", { name: "Pull request #41" });
			await expect.poll(async () => (await card.textContent()) ?? "").toContain("test (ubuntu)");
			await shot(page, `aw-23-${theme}-card`);
			await card.getByRole("button", { name: "Review the changes" }).click();
			const review = page.getByRole("dialog", { name: "Review #41" });
			await review.getByRole("region", { name: "src/parser.ts" }).waitFor();
			await review.getByRole("textbox", { name: "Your review" }).fill("Looks right; one nit on the comment kind.");
			await review.getByRole("button", { name: "Comment", exact: true }).click();
			await page.getByRole("alertdialog").waitFor();
			await shot(page, `aw-22-${theme}-confirm`);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	60000,
);

test("pull requests beyond the benches are counted under the place's title, and a piece's sign goes under an open card", async () => {
	const many = [...PRS, ...Array.from({ length: 6 }, (_, i) => pr(60 + i, `Chore number ${i + 1}`))];
	const { page, errors } = await openWorld(world(), { pullRequests: { ok: true, pullRequests: many } });
	try {
		await tab(page, "Places");
		await page.getByRole("button", { name: /^The forge/ }).click();
		await vi.waitFor(async () => expect(await view(page, "place()")).toBe("forge"), { timeout: 5000 });
		const slots = placeData("fantasy").overlaySlots.filter((slot) => slot.kind === "work").length;
		await vi.waitFor(async () => expect(await work(page)).toHaveLength(slots), { timeout: 5000 });
		// At the default zoom, the count of those on the rack is in view: under the title.
		const title = page.locator(".place-title");
		await vi.waitFor(async () =>
			expect(await title.textContent()).toContain(`${many.length - slots} more on the rack`),
		);
		await shot(page, "aw-31-forge-rack");
		// Hovering a piece signs it; once its card opens over the world, the sign and the hover text go.
		await clickThrough(page);
		const piece = (await work(page))[0];
		const [sx, sy] = await screen(page, piece.x, piece.y - 0.35);
		await page.mouse.move(sx, sy);
		await vi.waitFor(async () => expect((await work(page)).some((p) => p.sign)).toBe(true));
		// The card is a panel the pointer can be over again.
		await page.evaluate(() => {
			for (const style of document.querySelectorAll("style"))
				if (style.textContent?.includes("pointer-events: none !important")) style.remove();
		});
		await page.mouse.click(sx, sy);
		await page.getByRole("dialog", { name: `Pull request #${piece.number}` }).waitFor({ timeout: 10_000 });
		await page.mouse.move(sx + 1, sy);
		await vi.waitFor(async () => expect((await work(page)).some((p) => p.sign)).toBe(false));
		expect(await page.locator(".pointer-hover").count()).toBe(0);
		await shot(page, "aw-31-forge-card-no-sign");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 60000);
