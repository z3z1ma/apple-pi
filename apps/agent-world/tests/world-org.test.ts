import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";
import type { Character, CharacterFacts, RoleChoice, WorkplaceTaskHistory, WorldSnapshot } from "../src/world.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = "http://localhost";
const APP = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.env.AGENT_WORLD_SHOTS;
const NOW = Date.now();
const REPOSITORY = "/r/apple-pi";
const CATALOG: RoleChoice[] = [
	{
		name: "coordinator",
		title: "Coordinator",
		mandate: "Organize the team and assign concrete work.",
		manages: true,
		writes: false,
	},
	{
		name: "implementation-engineer",
		title: "Implementation Engineer",
		mandate: "Build the agreed change and verify it.",
		manages: false,
		writes: true,
	},
	{ name: "architect", title: "Architect", mandate: "Advise on module boundaries.", manages: false, writes: false },
];

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
afterAll(() => browser?.close());

function facts(reportsTo: string | null, title = "Implementation Engineer"): CharacterFacts {
	return {
		run: "idle",
		status: "idle",
		asking: null,
		needsYouSince: NOW - 60_000,
		unseen: true,
		seenAt: null,
		settledAt: NOW - 60_000,
		tool: null,
		task: null,
		git: null,
		cwd: REPOSITORY,
		reportsTo,
		title,
		model: "fixture-model",
		contextTokens: 1000,
		contextWindow: 200_000,
		cost: 0,
		tmux: null,
	};
}
function person(id: string, name: string, reportsTo: string | null, manager = false): Character {
	return {
		id,
		name,
		role: manager ? "coordinator" : "worker",
		place: { kind: "headquarters", headquarters: reportsTo ? "ada" : id },
		startedAt: NOW - 3_600_000,
		hiredAt: NOW - 1_800_000,
		facts: facts(reportsTo, manager ? "Coordinator" : "Implementation Engineer"),
	};
}
const WORK: WorkplaceTaskHistory[] = [
	{
		id: "active-work",
		title: "Build the reporting editor",
		headquarters: "ada",
		status: "in-progress",
		person: "cleo",
		outcome: "held",
		focused: true,
	},
	{
		id: "assigned-work",
		title: "Review the keyboard workflow",
		headquarters: "ada",
		status: "ready",
		person: "ellis",
		outcome: "held",
		focused: false,
	},
	{
		id: "finished-work",
		title: "Ship the invoice report",
		headquarters: "daria",
		status: "done",
		person: "cleo",
		outcome: "finished",
		focused: false,
	},
	{
		id: "handed-off-work",
		title: "Investigate the ledger import",
		headquarters: "daria",
		status: "in-progress",
		person: "cleo",
		outcome: "unassigned",
		focused: false,
	},
].map((task) => ({
	id: task.id,
	title: task.title,
	headquarters: task.headquarters,
	status: task.status,
	bundle: `/tasks/${task.id}`,
	project: REPOSITORY,
	thread: `task:${task.id}`,
	openedAt: NOW - 600_000,
	updatedAt: NOW - 60_000,
	closedAt: task.status === "done" ? NOW - 60_000 : null,
	participants: [
		{
			person: task.person,
			assignedAt: NOW - 500_000,
			endedAt: task.outcome === "held" ? null : NOW - 60_000,
			outcome: task.outcome as "held" | "finished" | "unassigned",
			focused: task.focused,
		},
	],
}));

function world(): WorldSnapshot {
	return {
		connected: true,
		headquarters: [
			{ id: "ada", name: "Ada", wings: [] },
			{ id: "daria", name: "Daria", wings: [] },
		],
		characters: [
			person("ada", "Ada", null, true),
			person("ben", "Ben", "ada", true),
			{
				...person("cleo", "Cleo", "ben"),
				facts: {
					...facts("ben"),
					task: { title: "Build the reporting editor", status: "in-progress", bundle: "/tasks/active-work" },
				},
			},
			person("daria", "Daria", null, true),
			{ ...person("program", "Temporary peer", "ada"), facts: { ...facts("ada"), temporary: true } },
		],
		dormant: [
			{
				id: "ellis",
				name: "Ellis",
				role: "worker",
				title: "Architect",
				reportsTo: "ben",
				cwd: REPOSITORY,
				repository: REPOSITORY,
				task: null,
				stoppedAt: NOW - 10_000,
				stopReason: "exited",
				startedAt: NOW - 3_000_000,
			},
			{
				id: "former",
				name: "Former",
				role: "worker",
				title: "Architect",
				reportsTo: "ada",
				cwd: REPOSITORY,
				repository: REPOSITORY,
				task: null,
				retiredAt: NOW - 20_000,
				retiredReason: "Work handed off",
				stoppedAt: NOW - 10_000,
				stopReason: "exited",
				startedAt: NOW - 3_000_000,
			},
		],
		mail: [],
		operatorMail: [],
		workplace: { threads: [], tasks: [], workHistory: WORK, escalations: [] },
	};
}

// Built UI over an isolated preload fixture. Runtime suites own authorization and durable work/channel invariants.
async function openOrg(appearance: "light" | "dark" = "light") {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: appearance });
	page.setDefaultTimeout(5000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.route(`${ORIGIN}/**`, async (route) => {
		const file = appFile(APP, new URL(route.request().url()).pathname);
		if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
		await route.fulfill({ body: readFileSync(file), contentType: contentType(file) });
	});
	await page.addInitScript(
		([snapshot, catalog]) => {
			const w = window as any;
			let current = snapshot;
			const listeners = new Set<(value: WorldSnapshot) => void>();
			const progressListeners = new Set<(value: unknown) => void>();
			w.progressOrg = (value: unknown) => {
				for (const listener of progressListeners) listener(value);
			};
			w.orgCalls = {
				profiles: [],
				taskReads: [],
				conversations: [],
				seen: [],
				moves: [],
				starts: [],
				wakes: [],
				closes: [],
				recruits: [],
			};
			w.pushOrg = (next: WorldSnapshot) => {
				current = next;
				for (const listener of listeners) listener(current);
			};
			w.agentWorld = {
				snapshot: async () => current,
				onUpdate: (listener: (value: WorldSnapshot) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				feed: async () => [],
				onFeed: () => () => {},
				roles: async () => catalog,
				readTask: async (id: string) => {
					w.orgCalls.taskReads.push(id);
					return { ok: true, text: `# Task evidence\n\nExplicitly loaded task: ${id}.` };
				},
				profile: async (id: string) => {
					w.orgCalls.profiles.push(id);
					return { ok: true, self: `## My story\n\nI verify changes before delivery. Session: ${id}.` };
				},
				conversation: async (id: string) => {
					w.orgCalls.conversations.push(id);
					return { ok: true, entries: [], before: null, missing: 0 };
				},
				markSeen: async (id: string) => {
					w.orgCalls.seen.push(id);
					return { ok: true };
				},
				goToTerminal: async () => ({ ok: true }),
				onReceipt: () => () => {},
				onReply: () => () => {},
				watchReplies: async () => {},
				onNotepad: () => () => {},
				wake: async (id: string) => {
					w.orgCalls.wakes.push(id);
					return { ok: true, stage: "applied" };
				},
				endSession: async (id: string) => {
					w.orgCalls.closes.push(id);
					return { ok: true, stage: "applied" };
				},
				orgMove: async (request: unknown) => {
					w.orgCalls.moves.push(structuredClone(request));
					return await new Promise((resolve) => {
						w.releaseOrgMove = resolve;
					});
				},
				onOrgStart: (listener: (value: unknown) => void) => {
					progressListeners.add(listener);
					return () => progressListeners.delete(listener);
				},
				orgStart: async (request: unknown) => {
					w.orgCalls.starts.push(structuredClone(request));
					return await new Promise((resolve, reject) => {
						w.releaseOrgStart = resolve;
						w.rejectOrgStart = (message: string) => reject(new Error(message));
					});
				},
				recruit: async (request: unknown) => {
					w.orgCalls.recruits.push(structuredClone(request));
					return await new Promise((resolve) => {
						w.releaseOrgRecruit = resolve;
					});
				},
			};
		},
		[world(), CATALOG] as const,
	);
	await page.goto(`${ORIGIN}/index.html`);
	await page.getByRole("link", { name: "Workplace", exact: true }).click();
	await page.getByRole("button", { name: "Org", exact: true }).click();
	return { page, errors };
}

async function openTeam(page: Page, name: string) {
	await page.getByRole("button", { name: `Open team: ${name}`, exact: true }).click();
}

test.each(["light", "dark"] as const)(
	"%s Org overview opens an automatically fitted top-down team with observational profiles",
	async (appearance) => {
		const { page, errors } = await openOrg(appearance);
		try {
			if (appearance === "dark") await page.setViewportSize({ width: 1024, height: 800 });
			expect(
				await page.getByRole("button", { name: "Theme: dark mode", exact: true }).getAttribute("aria-pressed"),
			).toBe(String(appearance === "dark"));
			await page.getByRole("button", { name: "Open team: Ada", exact: true }).waitFor();
			await page.getByRole("button", { name: "Open team: Daria", exact: true }).waitFor();
			await shot(page, `${appearance}-overview`);
			await openTeam(page, "Ada");
			for (const name of ["Ada", "Ben", "Cleo", "Ellis"])
				await page.getByRole("button", { name: `View profile: ${name}`, exact: true }).waitFor();
			expect(await page.getByRole("button", { name: "View profile: Former", exact: true }).count()).toBe(0);
			expect(await page.getByRole("button", { name: "View profile: Temporary peer", exact: true }).count()).toBe(0);
			expect(await page.getByRole("button", { name: "View profile: Daria", exact: true }).count()).toBe(0);
			await shot(page, `${appearance}-team`);
			const boxes = await page.getByRole("button", { name: /^View profile:/ }).evaluateAll((nodes) =>
				nodes.map((node) => {
					const rect = node.getBoundingClientRect();
					return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
				}),
			);
			const screen = page.viewportSize()!;
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(screen.width);
			for (const box of boxes) {
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.right).toBeLessThanOrEqual(screen.width);
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.bottom).toBeLessThanOrEqual(screen.height);
			}
			const avatars = await page
				.getByRole("button", { name: /^View profile:/ })
				.locator(".wp-avatar-tile")
				.evaluateAll((nodes) =>
					nodes.map((node) => {
						const rect = node.getBoundingClientRect();
						return { width: rect.width, height: rect.height };
					}),
				);
			expect(avatars).toHaveLength(boxes.length);
			for (const avatar of avatars) {
				expect(avatar.width).toBeGreaterThan(0);
				expect(avatar.width).toBeCloseTo(avatar.height, 1);
			}
			for (let i = 0; i < boxes.length; i++)
				for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i]!;
					const b = boxes[j]!;
					expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
				}
			const hierarchy = [];
			for (const name of ["Ada", "Ben", "Cleo", "Ellis"])
				hierarchy.push(await page.getByRole("button", { name: `View profile: ${name}`, exact: true }).boundingBox());
			expect(hierarchy[1]!.y).toBeGreaterThanOrEqual(hierarchy[0]!.y + hierarchy[0]!.height);
			for (const report of hierarchy.slice(2))
				expect(report!.y).toBeGreaterThanOrEqual(hierarchy[1]!.y + hierarchy[1]!.height);
			expect(hierarchy[2]!.y).toBeCloseTo(hierarchy[3]!.y, 1);
			const [left, right] = hierarchy.slice(2).sort((a, b) => a!.x - b!.x);
			expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
			const updated = world();
			updated.characters.find((person) => person.id === "cleo")!.facts!.run = "thinking";
			await page.evaluate((next) => (window as any).pushOrg(next), updated);
			await page
				.getByRole("button", { name: "View profile: Cleo", exact: true })
				.getByText("Thinking", { exact: true })
				.waitFor();
			expect(
				await page.getByRole("button", { name: /^View profile:/ }).evaluateAll((nodes) =>
					nodes.map((node) => {
						const rect = node.getBoundingClientRect();
						return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
					}),
				),
			).toEqual(boxes);
			await page.getByRole("button", { name: "Collapse reports of Ben", exact: true }).click();
			expect(await page.getByRole("button", { name: "View profile: Ellis", exact: true }).count()).toBe(0);
			expect(await page.getByRole("button", { name: "View profile: Cleo", exact: true }).count()).toBe(0);
			await page.getByRole("button", { name: "Expand reports of Ben", exact: true }).click();
			await page.getByRole("button", { name: "View profile: Cleo", exact: true }).click();
			const profile = page.getByRole("complementary", { name: "Profile: Cleo", exact: true });
			await profile.waitFor();
			await profile.getByText("Implementation Engineer", { exact: true }).first().waitFor();
			await profile.getByText("I verify changes before delivery. Session: cleo.", { exact: true }).waitFor();
			await shot(page, `${appearance}-profile`);
			if (appearance === "dark") {
				await page.setViewportSize({ width: 900, height: 800 });
				await shot(page, "dark-profile-900");
				expect(
					await page.getByRole("combobox", { name: "Reports to", exact: true }).evaluate((node) => {
						const rect = node.getBoundingClientRect();
						const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
						return hit === node || node.contains(hit);
					}),
				).toBe(true);
			}
			await profile.getByRole("button", { name: "Close profile", exact: true }).click();
			await page.getByRole("button", { name: "View profile: Ellis", exact: true }).click();
			const sleepingProfile = page.getByRole("complementary", { name: "Profile: Ellis", exact: true });
			await sleepingProfile.getByText(/Asleep/).waitFor();
			await sleepingProfile.getByText("I verify changes before delivery. Session: ellis.", { exact: true }).waitFor();
			await sleepingProfile.getByRole("button", { name: "Close profile", exact: true }).click();
			await page.getByRole("button", { name: "All teams", exact: true }).click();
			await page.getByRole("button", { name: "Open team: Ada", exact: true }).waitFor();
			await page.getByRole("button", { name: "Open team: Daria", exact: true }).waitFor();
			expect(await page.evaluate(() => (window as any).orgCalls.conversations)).toEqual([]);
			expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
			expect(await page.evaluate(() => (window as any).orgCalls.starts)).toEqual([]);
			expect(await page.evaluate(() => (window as any).orgCalls.moves)).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	30_000,
);

const card = (page: Page, name: string) =>
	page
		.getByRole("button", { name: `View profile: ${name}`, exact: true })
		.locator("xpath=ancestor-or-self::*[@draggable='true'][1]");

async function confirmMove(page: Page) {
	const dialog = page.getByRole("dialog", { name: "Change reporting?", exact: true });
	await dialog.waitFor();
	await dialog.getByRole("button", { name: "Confirm move", exact: true }).click();
}

test("reporting controls and dragging confirm the same branch; refusals preserve the chart and splits are explicit", async () => {
	const { page, errors } = await openOrg();
	try {
		await openTeam(page, "Ada");
		await page.getByRole("button", { name: "View profile: Ben", exact: true }).click();
		const reporting = page.getByRole("combobox", { name: "Reports to", exact: true });
		const managers = await reporting
			.locator("option")
			.evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
		for (const id of ["ben", "cleo", "ellis"]) expect(managers).not.toContain(id);
		await reporting.focus();
		await reporting.selectOption("daria");
		const dialog = page.getByRole("dialog", { name: "Change reporting?", exact: true });
		await dialog.waitFor();
		await vi.waitFor(async () =>
			expect(
				await dialog
					.getByRole("button", { name: "Cancel", exact: true })
					.evaluate((node) => node === document.activeElement),
			).toBe(true),
		);
		await page.keyboard.press("Tab");
		expect(
			await dialog
				.getByRole("button", { name: "Confirm move", exact: true })
				.evaluate((node) => node === document.activeElement),
		).toBe(true);
		await page.keyboard.press("Shift+Tab");
		expect(
			await dialog
				.getByRole("button", { name: "Cancel", exact: true })
				.evaluate((node) => node === document.activeElement),
		).toBe(true);
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press("Tab");
			expect(
				await dialog.evaluate(
					(node) =>
						node.contains(document.activeElement) || (!document.hasFocus() && document.activeElement === document.body),
				),
			).toBe(true);
		}
		await reporting.evaluate((node) => node.focus());
		expect(await reporting.evaluate((node) => node === document.activeElement)).toBe(false);
		const background = await reporting.boundingBox();
		await page.mouse.click(background!.x + background!.width / 2, background!.y + background!.height / 2);
		expect(await page.evaluate(() => (window as any).orgCalls.moves)).toEqual([]);
		await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		await page.getByRole("complementary", { name: "Profile: Ben", exact: true }).waitFor();
		expect(await reporting.evaluate((node) => node === document.activeElement)).toBe(true);
		expect(await reporting.inputValue()).toBe("ada");
		expect(await page.evaluate(() => (window as any).orgCalls.moves)).toEqual([]);
		await reporting.selectOption("");
		await dialog.getByText(/independent organization/).waitFor();
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		expect(await reporting.evaluate((node) => node === document.activeElement)).toBe(true);
		expect(await reporting.inputValue()).toBe("ada");
		await reporting.selectOption("daria");
		await confirmMove(page);
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.moves)).toHaveLength(1));
		await page.keyboard.press("Escape");
		expect(await dialog.isVisible()).toBe(true);
		const first = await page.evaluate(() => (window as any).orgCalls.moves[0]);
		expect(first).toMatchObject({ person: "ben", manager: "daria" });
		expect(first.branch.sort()).toEqual(["ben", "cleo", "ellis"]);
		const reason = "unfinished work would leave its organization: org-editor";
		await page.evaluate(
			(reason) => (window as any).releaseOrgMove({ ok: false, reason, tasks: ["org-editor"] }),
			reason,
		);
		await vi.waitFor(async () => expect(await dialog.getByRole("alert").textContent()).toContain(reason));
		await shot(page, "light-move-refused");
		await page
			.getByRole("dialog", { name: "Change reporting?", exact: true })
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await page.getByRole("button", { name: "Close profile", exact: true }).click();
		await page.getByRole("button", { name: "View profile: Ben", exact: true }).click();
		expect(await reporting.inputValue()).toBe("ada");
		await page.getByRole("button", { name: "Close profile", exact: true }).click();
		await card(page, "Ben").dragTo(page.getByRole("button", { name: "Open team: Daria", exact: true }));
		await confirmMove(page);
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.moves)).toHaveLength(2));
		expect(await page.evaluate(() => (window as any).orgCalls.moves[1])).toEqual(first);
		const moved = world();
		moved.characters.find((item) => item.id === "ben")!.facts!.reportsTo = "daria";
		await page.evaluate((next) => {
			(window as any).pushOrg(next);
			(window as any).releaseOrgMove({ ok: true, person: "ben", manager: "daria", branch: ["ben", "cleo", "ellis"] });
		}, moved);
		await page.getByRole("dialog", { name: "Change reporting?", exact: true }).waitFor({ state: "hidden" });
		await openTeam(page, "Daria");
		await page.getByRole("button", { name: "View profile: Ben", exact: true }).click();
		expect(await reporting.inputValue()).toBe("daria");
		await reporting.selectOption("");
		await confirmMove(page);
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.moves)).toHaveLength(3));
		expect(await page.evaluate(() => (window as any).orgCalls.moves[2])).toEqual({ ...first, manager: null });
		moved.characters.find((item) => item.id === "ben")!.facts!.reportsTo = null;
		await page.evaluate((next) => {
			(window as any).pushOrg(next);
			(window as any).releaseOrgMove({ ok: true, person: "ben", manager: null, branch: ["ben", "cleo", "ellis"] });
		}, moved);
		await page.getByRole("dialog", { name: "Change reporting?", exact: true }).waitFor({ state: "hidden" });
		await page.getByRole("button", { name: "All teams", exact: true }).click();
		await openTeam(page, "Ben");
		await page.getByRole("button", { name: "View profile: Ben", exact: true }).click();
		expect(await reporting.inputValue()).toBe("");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 45_000);

async function draftTeam(page: Page) {
	await page.getByRole("button", { name: "New team", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Team task", exact: true })
		.fill("Implement the Org chart and verify its operator workflows.");
	await page.getByRole("textbox", { name: "Repository", exact: true }).fill(REPOSITORY);
	await page.getByRole("combobox", { name: "Role to add", exact: true }).selectOption("implementation-engineer");
	await page.getByRole("button", { name: "Add role", exact: true }).click();
	await page.getByRole("button", { name: "Add role", exact: true }).click();
}

test("planned catalog roles can repeat, retain edits across Chat/Mail, and open no people", async () => {
	const { page, errors } = await openOrg();
	try {
		await openTeam(page, "Ada");
		await draftTeam(page);
		const engineers = page.getByRole("button", { name: /^Planned role: Implementation Engineer / });
		expect(await engineers.count()).toBe(2);
		await engineers.first().click();
		await page.getByRole("textbox", { name: "Name (optional)", exact: true }).fill("Morgan");
		await page.getByRole("textbox", { name: "Position goal", exact: true }).fill("Build the reporting editor.");
		await shot(page, "light-draft");
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Org", exact: true }).click();
		await shot(page, "light-draft-return");
		await page.getByRole("complementary", { name: "Team plan", exact: true }).waitFor();
		expect(await page.getByRole("textbox", { name: "Team task", exact: true }).inputValue()).toContain(
			"Implement the Org chart",
		);
		expect(await page.getByRole("textbox", { name: "Repository", exact: true }).inputValue()).toBe(REPOSITORY);
		expect(await engineers.count()).toBe(2);
		await engineers.first().click();
		expect(await page.getByRole("textbox", { name: "Name (optional)", exact: true }).inputValue()).toBe("Morgan");
		expect(await page.getByRole("textbox", { name: "Position goal", exact: true }).inputValue()).toBe(
			"Build the reporting editor.",
		);
		await page.getByRole("button", { name: "Theme: dark mode", exact: true }).click();
		await shot(page, "dark-draft");
		await page.getByRole("button", { name: "View profile: Ben", exact: true }).click();
		await page.getByRole("complementary", { name: "Profile: Ben", exact: true }).waitFor();
		await page.getByRole("button", { name: "Close profile", exact: true }).click();
		expect(await page.getByRole("textbox", { name: "Team task", exact: true }).inputValue()).toContain(
			"Implement the Org chart",
		);
		expect(await page.getByRole("textbox", { name: "Name (optional)", exact: true }).inputValue()).toBe("Morgan");
		expect(await engineers.count()).toBe(2);
		await page.getByRole("combobox", { name: "Existing teammate", exact: true }).selectOption("ben");
		await page.getByRole("button", { name: "Add teammate", exact: true }).click();
		const plan = page.getByRole("complementary", { name: "Team plan", exact: true });
		for (const name of ["Ben", "Cleo", "Ellis"]) await plan.getByText(name, { exact: true }).waitFor();
		expect(await plan.getByText(/^Existing person.*staged/).count()).toBe(3);
		expect(await page.getByRole("textbox", { name: "Name (optional)", exact: true }).inputValue()).toBe("Ben");
		const calls = await page.evaluate(() => (window as any).orgCalls);
		for (const action of ["moves", "starts", "wakes", "closes", "recruits"]) expect(calls[action]).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test.each([false, true])(
	"startup withReady=%s stays pending, shows partial results, and retries the same identities after failure",
	async (withReady) => {
		const { page, errors } = await openOrg("dark");
		try {
			await draftTeam(page);
			await page.getByRole("button", { name: "Start team", exact: true }).click();
			await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(1));
			const first = await page.evaluate(() => (window as any).orgCalls.starts[0]);
			expect(first).toMatchObject({ cwd: REPOSITORY, goal: expect.stringContaining("Implement the Org chart") });
			expect(first.positions.filter((position: any) => position.role === "implementation-engineer")).toHaveLength(2);
			expect(first.positions.filter((position: any) => position.manager === null)).toHaveLength(1);
			const [head, engineer, other] = first.positions;
			await page.evaluate(
				({ id, head }) =>
					(window as any).progressOrg({
						id,
						people: [{ id: head, state: "preparing", reason: "Opening the head window" }],
						complete: false,
						next: "working",
					}),
				{ id: first.id, head: head.id },
			);
			await page.getByText("Opening the head window", { exact: true }).waitFor();
			await shot(page, "dark-start-pending");
			await page.getByRole("button", { name: "Mail", exact: true }).click();
			await page.getByRole("button", { name: "Org", exact: true }).click();
			await shot(page, "dark-pending-return");
			expect(await page.getByRole("textbox", { name: "Team task", exact: true }).inputValue()).toBe(first.goal);
			expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(1);
			const partial = {
				id: first.id,
				complete: false,
				next: "choose-ready",
				channel: "organization:new-head",
				people: [
					{ id: head.id, person: "new-head", state: "ready" },
					{ id: engineer.id, person: "new-engineer", state: "failed", reason: "Implementation window could not start" },
					{ id: other.id, state: "blocked", reason: "Waiting for the teammate window" },
				],
			};
			const updated = world();
			updated.characters.push(person("new-head", "New head", null, true));
			await page.evaluate(
				([progress, snapshot]) => {
					(window as any).pushOrg(snapshot);
					(window as any).progressOrg(progress);
					(window as any).releaseOrgStart(progress);
				},
				[partial, updated] as const,
			);
			await page.getByText("Implementation window could not start", { exact: true }).waitFor();
			await page.getByRole("button", { name: "Start with ready teammates", exact: true }).waitFor();
			await shot(page, "dark-start-partial");
			await page
				.getByRole("button", {
					name: withReady ? "Start with ready teammates" : "Retry unresolved teammates",
					exact: true,
				})
				.click();
			await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(2));
			const retry = await page.evaluate(() => (window as any).orgCalls.starts[1]);
			expect(retry.id).toBe(first.id);
			expect(retry.positions.map((position: any) => position.id)).toEqual(
				first.positions.map((position: any) => position.id),
			);
			expect(retry.positions.find((position: any) => position.id === head.id).person).toBe("new-head");
			expect(retry.positions.find((position: any) => position.id === engineer.id).person).toBe("new-engineer");
			expect(retry.withReady === true).toBe(withReady);
			await page.evaluate(() => (window as any).rejectOrgStart("Runtime disconnected; outcome uncertain"));
			await vi.waitFor(async () =>
				expect(await page.getByRole("alert").textContent()).toContain("Runtime disconnected; outcome uncertain"),
			);
			await shot(page, "dark-start-uncertain");
			await page.getByRole("button", { name: "Chat", exact: true }).click();
			await page.getByRole("button", { name: "Org", exact: true }).click();
			await page.getByRole("button", { name: "Retry unresolved teammates", exact: true }).click();
			await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(3));
			const third = await page.evaluate(() => (window as any).orgCalls.starts[2]);
			expect(third.id).toBe(first.id);
			expect(third.positions.find((position: any) => position.id === head.id).person).toBe("new-head");
			const complete = {
				...partial,
				complete: true,
				next: "done",
				people: partial.people.map((item, index) => ({
					id: item.id,
					person: item.person ?? `new-person-${index}`,
					state: "ready",
				})),
				kickoff: { thread: `org-kickoff:${first.id}`, commandId: `org-kickoff:${first.id}` },
			};
			await page.evaluate((progress) => {
				(window as any).progressOrg(progress);
				(window as any).releaseOrgStart(progress);
			}, complete);
			await page.getByText("Team prepared. The head has received the kickoff.", { exact: true }).waitFor();
			await page.getByRole("button", { name: "Retry unresolved teammates", exact: true }).waitFor({ state: "hidden" });
			expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(3);
			expect(await page.evaluate(() => (window as any).orgCalls.recruits)).toEqual([]);
			expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	45_000,
);

test("direct Add person sends a role hire once and waits for the accepted person's actual connection", async () => {
	const { page, errors } = await openOrg();
	try {
		await openTeam(page, "Ada");
		await page.getByRole("button", { name: "Add person", exact: true }).click();
		const form = page.getByRole("complementary", { name: "Add person", exact: true });
		await form.getByRole("combobox", { name: "Role", exact: true }).selectOption("implementation-engineer");
		await form.getByRole("textbox", { name: "Repository", exact: true }).fill(REPOSITORY);
		await form.getByRole("textbox", { name: "Goal", exact: true }).fill("Implement the profile inspector.");
		expect(await form.getByRole("textbox", { name: "Name (optional)", exact: true }).inputValue()).toBe("");
		expect(await page.evaluate(() => (window as any).orgCalls.recruits)).toEqual([]);
		await form.getByRole("button", { name: "Add person", exact: true }).click();
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.recruits)).toHaveLength(1));
		expect(await page.evaluate(() => (window as any).orgCalls.recruits[0])).toEqual({
			name: "",
			cwd: REPOSITORY,
			brief: "Implement the profile inspector.",
			reportsTo: "ada",
			role: "implementation-engineer",
		});
		await form.getByText("Starting person...", { exact: true }).waitFor();
		await page.evaluate(() =>
			(window as any).releaseOrgRecruit({ ok: true, stage: "accepted", sessionId: "new-colleague" }),
		);
		await form
			.getByRole("status")
			.getByText(/has not joined yet/)
			.waitFor();
		expect(await form.getByRole("button", { name: "Add person", exact: true }).isEnabled()).toBe(false);
		await shot(page, "light-direct-person-pending");
		const updated = world();
		updated.characters.push(person("unrelated", "Another colleague", "ada"));
		await page.evaluate((next) => (window as any).pushOrg(next), updated);
		await page.getByRole("button", { name: "View profile: Another colleague", exact: true }).waitFor();
		expect(await form.isVisible()).toBe(true);
		expect(await form.getByRole("button", { name: "Add person", exact: true }).isEnabled()).toBe(false);
		updated.characters.push(person("new-colleague", "New colleague", "ada"));
		await page.evaluate((next) => (window as any).pushOrg(next), updated);
		await form.waitFor({ state: "hidden" });
		await page.getByRole("button", { name: "View profile: New colleague", exact: true }).click();
		const profile = page.getByRole("complementary", { name: "Profile: New colleague", exact: true });
		await profile.getByText("I verify changes before delivery. Session: new-colleague.", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.recruits)).toHaveLength(1);
		expect(await page.evaluate(() => (window as any).orgCalls.starts)).toEqual([]);
		expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
		expect(await page.evaluate(() => (window as any).orgCalls.conversations)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test("recorded team work keeps its provenance while a person's profile includes earlier assignments", async () => {
	const { page, errors } = await openOrg();
	try {
		await openTeam(page, "Ada");
		const teamWork = page.getByRole("region", { name: "Recorded team work", exact: true });
		await teamWork.getByText("View recorded work (2)", { exact: true }).click();
		await teamWork.getByRole("button", { name: "Read task: Build the reporting editor", exact: true }).waitFor();
		await teamWork.getByText("Cleo: assigned, in focus", { exact: true }).waitFor();
		await teamWork.getByText("Ellis: assigned", { exact: true }).waitFor();
		expect(
			await teamWork.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).count(),
		).toBe(0);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
		await teamWork.getByText("View recorded work (2)", { exact: true }).click();
		await page.getByRole("button", { name: "View profile: Cleo", exact: true }).click();
		const profile = page.getByRole("complementary", { name: "Profile: Cleo", exact: true });
		const history = profile.getByRole("region", { name: "Recorded work", exact: true });
		await history.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).waitFor();
		await history.getByText("Cleo: assignment finished", { exact: true }).waitFor();
		await history.getByText("Cleo: unassigned", { exact: true }).waitFor();
		expect(await history.getByText("Recorded organization: Daria", { exact: true }).count()).toBe(2);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
		await history.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).click();
		await history
			.getByRole("article", { name: "Task: Ship the invoice report", exact: true })
			.getByText("Explicitly loaded task: finished-work.", { exact: true })
			.waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["finished-work"]);
		const close = profile.getByRole("button", { name: "Close profile", exact: true });
		expect((await close.textContent())?.trim()).toBe("Close");
		expect(
			await close.evaluate((node) => {
				const r = node.getBoundingClientRect();
				return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node;
			}),
		).toBe(true);
		await close.click();
		await openTeam(page, "Daria");
		await teamWork.getByText("View recorded work (2)", { exact: true }).click();
		await teamWork.getByText("Cleo: assignment finished", { exact: true }).waitFor();
		await teamWork.getByText("Cleo: unassigned", { exact: true }).waitFor();
		expect(await page.getByRole("button", { name: "View profile: Cleo", exact: true }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["finished-work"]);
		expect(await page.evaluate(() => (window as any).orgCalls.conversations)).toEqual([]);
		expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
		await shot(page, "light-recorded-work");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test("Org search crosses teams using snapshot metadata and reads work only on request", async () => {
	const { page, errors } = await openOrg();
	try {
		const search = page.getByRole("searchbox", { name: "Search people, teams, and work", exact: true });
		const results = page.getByRole("region", { name: "Organization search results", exact: true });
		expect(await results.count()).toBe(0);
		await search.fill("Ellis");
		await results.getByRole("button", { name: "View person: Ellis", exact: true }).click();
		const profile = page.getByRole("complementary", { name: "Profile: Ellis", exact: true });
		await profile.getByText(/Asleep/).waitFor();
		await profile.getByRole("button", { name: "Close profile", exact: true }).click();
		await search.fill("Daria");
		await results.getByRole("button", { name: "Open team: Daria", exact: true }).click();
		await page.getByRole("button", { name: "View profile: Daria", exact: true }).waitFor();
		await search.fill("invoice");
		await results.getByText("Recorded organization: Daria", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
		await results.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).click();
		await results
			.getByRole("article", { name: "Task: Ship the invoice report", exact: true })
			.getByText(/Explicitly loaded task: finished-work/)
			.waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["finished-work"]);
		await shot(page, "light-work-search");
		await results.getByRole("button", { name: "Close search results", exact: true }).focus();
		await page.keyboard.press("Escape");
		await results.waitFor({ state: "hidden" });
		expect(await search.evaluate((node) => node === document.activeElement)).toBe(true);
		await search.fill("Temporary peer");
		expect(await results.getByRole("button", { name: "View person: Temporary peer", exact: true }).count()).toBe(0);
		await search.fill("Former");
		expect(await results.getByRole("button", { name: "View person: Former", exact: true }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).orgCalls.conversations)).toEqual([]);
		expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-org-${name}.png`), animations: "disabled" });
}
