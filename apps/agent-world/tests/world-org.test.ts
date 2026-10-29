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
			{ ...person("ben", "Ben", "ada", true), specialization: "Coordinate accessibility reviews." },
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
async function openOrg(appearance: "light" | "dark" = "light", snapshot: WorldSnapshot = world()) {
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
				renames: [],
				channelReads: [],
				memberships: [],
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
					return { ok: true, text: w.taskBody ?? `# Task evidence\n\nExplicitly loaded task: ${id}.` };
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
				rename: async (id: string, name: string) => {
					w.orgCalls.renames.push({ id, name });
					return { ok: true, stage: "applied" };
				},
				setChannelMembership: async (id: string, joined: boolean) => {
					w.orgCalls.memberships.push({ id, joined });
					return { ok: true, stage: "applied" };
				},
				readWorkplaceThread: async (id: string) => {
					w.orgCalls.channelReads.push(id);
					return {
						ok: true,
						thread: { id, subject: "Original team channel", closed: false, participants: [], messages: [] },
					};
				},
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
		[snapshot, CATALOG] as const,
	);
	await page.goto(`${ORIGIN}/index.html?world`);
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

test("organization cards align their footers across varied work and explain unavailable recruitment", async () => {
	const snapshot = world();
	snapshot.characters.push(person("solo", "Solo", null));
	snapshot.dormant!.push({
		...snapshot.dormant![0]!,
		id: "sleeping-head",
		name: "Sleeping head",
		title: "Coordinator",
		reportsTo: null,
	});
	const longTitle =
		"Review keyboard access, screen-reader announcements, retained editor drafts, team setup recovery, and all reporting workflows across the complete organization interface.";
	snapshot.workplace!.workHistory = WORK.map((task, index) =>
		index === 0 ? { ...task, title: longTitle, updatedAt: NOW + 1 } : task,
	);
	const { page, errors } = await openOrg("light", snapshot);
	try {
		const cards = page.locator(".wp-org-team-card");
		await page.getByRole("button", { name: "Open team: Sleeping head", exact: true }).waitFor();
		expect(await cards.count()).toBe(4);
		for (const width of [1440, 900]) {
			await page.setViewportSize({ width, height: 900 });
			const geometry = await cards.evaluateAll((nodes) =>
				nodes.map((node) => {
					const card = node.getBoundingClientRect();
					const footer = node.querySelector(".wp-org-team-actions")!.getBoundingClientRect();
					return { height: card.height, footerInset: card.bottom - footer.bottom };
				}),
			);
			for (const card of geometry) {
				expect(card.height).toBeCloseTo(geometry[0]!.height, 0);
				expect(card.footerInset).toBeCloseTo(geometry[0]!.footerInset, 0);
			}
			const title = page.getByText(longTitle, { exact: true });
			expect(await title.getAttribute("title")).toBe(longTitle);
			expect(
				await title.evaluate(
					(node) => node.getBoundingClientRect().height <= parseFloat(getComputedStyle(node).lineHeight) * 2 + 1,
				),
			).toBe(true);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
			await shot(page, `light-card-footers-${width}`);
		}
		expect(await page.getByText("Head: Ada", { exact: true }).count()).toBe(0);
		for (const [name, reason] of [
			["Solo", "This role cannot manage people"],
			["Sleeping head", "Wake team head to add a person"],
		]) {
			const add = page.getByRole("button", { name: `Add person to ${name}'s team`, exact: true });
			expect(await add.isVisible()).toBe(true);
			expect(await add.isEnabled()).toBe(false);
			expect(await add.getAttribute("title")).toBe(reason);
		}
		await page.getByRole("button", { name: "View profile: Ada", exact: true }).click();
		await page.getByRole("complementary", { name: "Profile: Ada", exact: true }).waitFor();
		const calls = await page.evaluate(() => (window as any).orgCalls);
		for (const action of ["recruits", "starts", "moves", "conversations", "seen"]) expect(calls[action]).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test.each(["light", "dark"] as const)(
	"%s organization names open metadata-only work and restore the exact trigger without changing rename or chart actions",
	async (appearance) => {
		const snapshot = world();
		snapshot.characters.push(person("solo", "Solo", null));
		const { page, errors } = await openOrg(appearance, snapshot);
		try {
			await page.setViewportSize({ width: appearance === "dark" ? 900 : 1440, height: 900 });
			const card = page.getByRole("group", { name: "Ada's team", exact: true });
			const name = card.getByRole("button", { name: "Ada organization", exact: true });
			expect(await card.getByRole("button", { name: /^View (?:all )?recorded work/ }).count()).toBe(0);
			await shot(page, `${appearance}-organization-work-trigger`);
			await name.click();
			const modal = page.getByRole("dialog", { name: "Recorded team work", exact: true });
			await modal.waitFor();
			expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
			await modal.getByRole("button", { name: "Read task: Build the reporting editor", exact: true }).click();
			await modal.getByText("Explicitly loaded task: active-work.", { exact: true }).waitFor();
			await shot(page, `${appearance}-organization-name-work`);
			await page.keyboard.press("Escape");
			await modal.waitFor({ state: "hidden" });
			expect(await name.evaluate((node) => document.activeElement === node)).toBe(true);
			await page.keyboard.press("Shift+F10");
			const menu = page.getByRole("menu", { name: "Actions", exact: true });
			await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
			const form = page.getByRole("form", { name: "Rename organization", exact: true });
			await form.getByRole("button", { name: "Cancel", exact: true }).click();
			expect(await modal.count()).toBe(0);
			await name.click({ button: "right" });
			await menu.waitFor();
			expect(await modal.count()).toBe(0);
			await page.keyboard.press("Escape");
			await page.getByRole("button", { name: "Solo organization", exact: true }).click();
			await modal.getByText("No matching work.", { exact: true }).waitFor();
			await page.keyboard.press("Escape");
			await openTeam(page, "Ada");
			const headingName = page
				.getByRole("heading", { name: "Ada organization", exact: true })
				.getByRole("button", { name: "Ada organization", exact: true });
			await headingName.focus();
			await page.keyboard.press(appearance === "dark" ? "Space" : "Enter");
			await modal.waitFor();
			await page.keyboard.press("Escape");
			expect(await headingName.evaluate((node) => document.activeElement === node)).toBe(true);
			await page.getByRole("button", { name: "View profile: Cleo", exact: true }).click();
			const profile = page.getByRole("complementary", { name: "Profile: Cleo", exact: true });
			const profileWork = profile.getByRole("button", { name: "View all recorded work (3)", exact: true });
			expect((await profileWork.innerText()).trim()).toBe("View all");
			const actionBox = (await profileWork.boundingBox())!;
			const workHeading = (await profile.getByRole("heading", { name: "Work", exact: true }).boundingBox())!;
			const contentRight = await profile
				.getByRole("region", { name: "Recorded work", exact: true })
				.evaluate((node) => {
					const style = getComputedStyle(node);
					return (
						node.getBoundingClientRect().right -
						Number.parseFloat(style.paddingRight) -
						Number.parseFloat(style.borderRightWidth)
					);
				});
			expect(actionBox.y).toBeLessThan(workHeading.y + workHeading.height);
			expect(actionBox.y + actionBox.height).toBeGreaterThan(workHeading.y);
			expect(actionBox.x + actionBox.width).toBeCloseTo(contentRight, 0);
			expect(
				await profileWork.evaluate((button) => {
					const style = getComputedStyle(button);
					return Number.parseFloat(style.borderTopWidth) === 0 && style.backgroundColor === "rgba(0, 0, 0, 0)";
				}),
			).toBe(true);
			await profileWork.click();
			const personModal = page.getByRole("dialog", { name: "Recorded work", exact: true });
			await personModal.waitFor();
			await page.keyboard.press("Escape");
			expect(await profileWork.evaluate((node) => document.activeElement === node)).toBe(true);
			await shot(page, `${appearance}-profile-work-link`);
			await profile.getByRole("button", { name: "Close profile", exact: true }).click();
			const unavailable = world();
			delete unavailable.workplace!.workHistory;
			await page.evaluate((next) => (window as any).pushOrg(next), unavailable);
			await headingName.click();
			await modal.getByText("Work history is not available in this snapshot.", { exact: true }).first().waitFor();
			expect(await modal.getByRole("button", { name: /^Read task:/ }).count()).toBe(0);
			await page.keyboard.press("Escape");
			const calls = await page.evaluate(() => (window as any).orgCalls);
			expect(calls.taskReads).toEqual(["active-work"]);
			for (const key of ["renames", "conversations", "seen", "moves", "starts", "recruits"])
				expect(calls[key]).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	45_000,
);

test("organization display names persist locally, cancel cleanly and relabel channels without changing their identity", async () => {
	const snapshot = world();
	snapshot.workplace!.threads = [
		{
			id: "organization:ada",
			kind: "channel",
			subject: "Original team channel",
			createdBy: "ada",
			headquarters: "ada",
			closed: false,
			lastSeq: 0,
			lastAt: NOW,
			participants: ["ada", "ben"],
		},
	];
	const { page, errors } = await openOrg("light", snapshot);
	try {
		expect(await page.getByRole("button", { name: /^Rename organization:/ }).count()).toBe(0);
		const rename = page.getByText("Ada organization", { exact: true });
		const menu = page.getByRole("menu", { name: "Actions", exact: true });
		await rename.focus();
		await page.keyboard.press("Shift+F10");
		await menu.waitFor();
		await page.keyboard.press("Escape");
		await menu.waitFor({ state: "hidden" });
		await vi.waitFor(async () => expect(await rename.evaluate((node) => node === document.activeElement)).toBe(true));
		await rename.dispatchEvent("contextmenu", { button: 2, clientX: 1438, clientY: 898 });
		await menu.waitFor();
		const menuBounds = (await menu.boundingBox())!;
		expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(1440);
		expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(900);
		await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
		const form = page.getByRole("form", { name: "Rename organization", exact: true });
		await form.getByRole("textbox", { name: "Organization name", exact: true }).fill("Discarded name");
		await form.getByRole("button", { name: "Cancel", exact: true }).click();
		await rename.waitFor();
		await rename.click({ button: "right" });
		await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
		await form.getByRole("textbox", { name: "Organization name", exact: true }).fill("Reporting Team");
		await form.getByRole("button", { name: "Save name", exact: true }).click();
		await page.getByText("Reporting Team", { exact: true }).waitFor();
		await openTeam(page, "Ada");
		await page.getByRole("heading", { name: "Reporting Team", exact: true }).waitFor();
		await page.getByRole("button", { name: "View profile: Ada", exact: true }).waitFor();
		await openTeam(page, "Daria");
		const search = page.getByRole("searchbox", { name: "Search people, teams, and work", exact: true });
		const results = page.getByRole("region", { name: "Organization search results", exact: true });
		await search.fill("Reporting Team");
		await results.getByRole("button", { name: "Open team: Reporting Team", exact: true }).first().click();
		await results.waitFor({ state: "hidden" });
		await page.getByRole("heading", { name: "Reporting Team", exact: true }).waitFor();
		await openTeam(page, "Daria");
		await search.fill("Build the reporting editor");
		await results.getByRole("button", { name: "Open recorded team: Reporting Team", exact: true }).click();
		await results.waitFor({ state: "hidden" });
		await page.getByRole("heading", { name: "Reporting Team", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
		await shot(page, "light-organization-name");
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		const channel = page.getByRole("button", { name: "# org-reporting-team", exact: true });
		await channel.focus();
		await page.keyboard.press("Shift+F10");
		await menu.waitFor();
		const chat = page.getByRole("button", { name: "Chat", exact: true });
		await chat.click();
		await menu.waitFor({ state: "hidden" });
		expect(await chat.evaluate((node) => node === document.activeElement)).toBe(true);
		await channel.click({ button: "right" });
		await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
		await form.getByRole("textbox", { name: "Organization name", exact: true }).fill("Reporting Delivery");
		await page.keyboard.press("Enter");
		await page.getByRole("button", { name: "# org-reporting-delivery", exact: true }).waitFor();
		let calls = await page.evaluate(() => (window as any).orgCalls);
		for (const action of ["renames", "channelReads", "memberships", "conversations", "seen"])
			expect(calls[action]).toEqual([]);
		await page.reload();
		await page.getByRole("button", { name: "# org-reporting-delivery", exact: true }).waitFor();
		await page.getByRole("button", { name: "Org", exact: true }).click();
		await page.getByText("Reporting Delivery", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "# org-reporting-delivery", exact: true }).click();
		await page.getByRole("heading", { name: "# org-reporting-delivery", exact: true }).waitFor();
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).orgCalls.channelReads)).toEqual(["organization:ada"]),
		);
		calls = await page.evaluate(() => (window as any).orgCalls);
		for (const action of ["renames", "memberships", "conversations", "seen", "moves", "starts", "recruits"])
			expect(calls[action]).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test("trackpad pinch zooms the chart around its pointer without page zoom; ordinary wheel still scrolls", async () => {
	const { page, errors } = await openOrg();
	try {
		await openTeam(page, "Ada");
		const viewport = page.locator(".wp-org-chart-viewport");
		const canvas = page.locator(".wp-org-chart-canvas");
		for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await viewport.evaluate((node) => {
			node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
			node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
			(window as any).chartWheelEvents = [];
			document.addEventListener("wheel", (event) => {
				(window as any).chartWheelEvents.push({ ctrl: event.ctrlKey, prevented: event.defaultPrevented });
			});
		});
		const bounds = (await viewport.boundingBox())!;
		const pointer = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		const geometry = () =>
			canvas.evaluate((node, pointer) => {
				const rect = node.getBoundingClientRect();
				const scale = new DOMMatrix(getComputedStyle(node).transform).a;
				return {
					scale,
					x: (pointer.x - rect.x) / scale,
					y: (pointer.y - rect.y) / scale,
					page: { width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scale: visualViewport?.scale },
				};
			}, pointer);
		const before = await geometry();
		expect(await viewport.evaluate((node) => node.scrollLeft > 0 && node.scrollTop > 0)).toBe(true);
		await page.mouse.move(pointer.x, pointer.y);
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, -30);
		await page.keyboard.up("Control");
		await vi.waitFor(async () => expect((await geometry()).scale).toBeGreaterThan(before.scale));
		const after = await geometry();
		expect(Math.abs(after.x - before.x) * after.scale).toBeLessThanOrEqual(1);
		expect(Math.abs(after.y - before.y) * after.scale).toBeLessThanOrEqual(1);
		expect(after.page).toEqual(before.page);
		await shot(page, "light-pinch-zoom");
		expect(await page.evaluate(() => (window as any).chartWheelEvents)).toContainEqual({ ctrl: true, prevented: true });
		const scroll = await viewport.evaluate((node) => node.scrollTop);
		await page.mouse.wheel(0, 120);
		await vi.waitFor(async () => expect(await viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(scroll));
		expect((await geometry()).scale).toBe(after.scale);
		expect(await page.evaluate(() => (window as any).chartWheelEvents)).toContainEqual({
			ctrl: false,
			prevented: false,
		});
		expect((await geometry()).page).toEqual(before.page);
		expect(await page.evaluate(() => (window as any).orgCalls.moves)).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

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

async function draftTeam(page: Page, goal = "Implement the Org chart and verify its operator workflows.") {
	await page.getByRole("button", { name: "New team", exact: true }).click();
	await page.getByRole("textbox", { name: "Team task", exact: true }).fill(goal);
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
		const specialization = plan.getByRole("textbox", { name: "Specialization", exact: true });
		expect(await specialization.inputValue()).toBe("Coordinate accessibility reviews.");
		expect(await specialization.evaluate((node) => (node as HTMLTextAreaElement).readOnly)).toBe(true);
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
			const plan = page.getByRole("complementary", { name: "Team plan", exact: true });
			expect(await plan.getByRole("textbox", { name: "Team task", exact: true }).isVisible()).toBe(false);
			await plan.getByText("Setup plan", { exact: true }).click();
			expect(await plan.getByRole("textbox", { name: "Team task", exact: true }).inputValue()).toBe(first.goal);
			expect(await plan.getByRole("textbox", { name: "Team task", exact: true }).isEnabled()).toBe(false);
			await plan.getByText("Setup plan", { exact: true }).click();
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
			await page
				.getByRole("region", { name: "Team setup progress", exact: true })
				.getByText("Sent the team task to New head; they coordinate the reports.", { exact: true })
				.waitFor();
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

test("closing and resuming setup preserves partial identities; replacing it needs an explicit confirmation", async () => {
	const { page, errors } = await openOrg();
	try {
		await draftTeam(page);
		const plan = page.getByRole("complementary", { name: "Team plan", exact: true });
		const specialization = plan.getByRole("textbox", { name: "Specialization", exact: true });
		await specialization.fill("  Focus on keyboard accessibility.  ");
		await shot(page, "light-plan-specialization");
		await plan.getByRole("button", { name: "Close team plan", exact: true }).click();
		await plan.waitFor({ state: "hidden" });
		await page.getByRole("button", { name: "Resume team plan", exact: true }).click();
		expect(await specialization.inputValue()).toBe("  Focus on keyboard accessibility.  ");
		expect(await plan.getByRole("textbox", { name: "Team task", exact: true }).inputValue()).toContain(
			"Implement the Org chart",
		);
		expect(await page.evaluate(() => (window as any).orgCalls.starts)).toEqual([]);
		await plan.getByRole("button", { name: "Start team", exact: true }).click();
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(1));
		const first = await page.evaluate(() => (window as any).orgCalls.starts[0]);
		const [head, engineer, other] = first.positions;
		expect(other.specialization).toBe("Focus on keyboard accessibility.");
		expect(head).not.toHaveProperty("specialization");
		expect(engineer).not.toHaveProperty("specialization");
		await plan.getByText("Setup plan", { exact: true }).click();
		expect(await specialization.inputValue()).toBe("  Focus on keyboard accessibility.  ");
		expect(await specialization.isEnabled()).toBe(false);
		await plan.getByText("Setup plan", { exact: true }).click();
		const partial = {
			id: first.id,
			complete: false,
			next: "choose-ready",
			people: [
				{ id: head.id, person: "retained-head", state: "ready" },
				{ id: engineer.id, person: "retained-engineer", state: "failed", reason: "Window could not start" },
				{ id: other.id, state: "blocked", reason: "Waiting for the teammate window" },
			],
		};
		const updated = world();
		updated.characters.push(person("retained-head", "Retained head", null, true));
		await page.evaluate(
			([progress, snapshot]) => {
				(window as any).pushOrg(snapshot);
				(window as any).progressOrg(progress);
				(window as any).releaseOrgStart(progress);
			},
			[partial, updated] as const,
		);
		const progress = plan.getByRole("region", { name: "Team setup progress", exact: true });
		await progress.getByText("Window could not start", { exact: true }).waitFor();
		for (const label of ["1. Coordinator", "2. Implementation Engineer", "3. Implementation Engineer"])
			await progress.getByText(label, { exact: true }).waitFor();
		for (const state of ["ready", "failed", "blocked"]) await progress.getByText(state, { exact: true }).waitFor();
		await plan.getByRole("button", { name: "Close team plan", exact: true }).click();
		await plan.waitFor({ state: "hidden" });
		await page.getByRole("button", { name: "Resume setup", exact: true }).click();
		await progress.getByText("Recorded person: retained-engineer", { exact: true }).waitFor();
		expect(await plan.getByRole("textbox", { name: "Team task", exact: true }).isVisible()).toBe(false);
		const cancel = page.waitForEvent("dialog").then(async (dialog) => {
			expect(dialog.type()).toBe("confirm");
			expect(dialog.message()).toContain("Created people and their work remain");
			await dialog.dismiss();
		});
		await page.getByRole("button", { name: "New team", exact: true }).click();
		await cancel;
		await progress.getByText("Window could not start", { exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(1);
		await plan.getByRole("button", { name: "Retry unresolved teammates", exact: true }).click();
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(2));
		const retry = await page.evaluate(() => (window as any).orgCalls.starts[1]);
		expect(retry).toEqual({
			...first,
			positions: first.positions.map((position: any) => ({
				...position,
				person: partial.people.find((member) => member.id === position.id)?.person,
			})),
		});
		await page.evaluate((result) => (window as any).releaseOrgStart(result), partial);
		await vi.waitFor(async () =>
			expect(await page.getByRole("button", { name: "New team", exact: true }).isEnabled()).toBe(true),
		);
		const replace = page.waitForEvent("dialog").then(async (dialog) => {
			expect(dialog.message()).toContain("Created people and their work remain");
			await dialog.accept();
		});
		await page.getByRole("button", { name: "New team", exact: true }).click();
		await replace;
		expect(await plan.getByRole("textbox", { name: "Team task", exact: true }).inputValue()).toBe("");
		expect(await plan.getByRole("button", { name: /^Planned role:/ }).count()).toBe(1);
		expect(await progress.count()).toBe(0);
		await page.getByRole("button", { name: "Open team: Retained head", exact: true }).waitFor();
		const calls = await page.evaluate(() => (window as any).orgCalls);
		expect(calls.starts).toHaveLength(2);
		for (const action of ["moves", "wakes", "closes", "recruits", "conversations", "seen"])
			expect(calls[action]).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test.each([
	{ goal: "Implement the profile inspector.", specialization: "" },
	{ goal: "Implement the profile inspector.", specialization: "  Focus on screen-reader behavior.  " },
	{ goal: "", specialization: "" },
	{ goal: "   ", specialization: "Focus on keyboard behavior." },
])(
	"direct Add person goal=$goal specialization=$specialization sends once and waits for the accepted person's actual connection",
	async ({ goal, specialization }) => {
		const { page, errors } = await openOrg();
		try {
			await openTeam(page, "Ada");
			await page.getByRole("button", { name: "Add person", exact: true }).click();
			const form = page.getByRole("complementary", { name: "Add person", exact: true });
			await form.getByRole("combobox", { name: "Role", exact: true }).selectOption("implementation-engineer");
			await form.getByRole("textbox", { name: "Repository", exact: true }).fill(REPOSITORY);
			await form.getByRole("textbox", { name: "Goal", exact: true }).fill(goal);
			await form.getByRole("textbox", { name: "Specialization", exact: true }).fill(specialization);
			if (specialization) await shot(page, "light-add-person-specialization");
			expect(await form.getByRole("textbox", { name: "Name (optional)", exact: true }).inputValue()).toBe("");
			expect(await page.evaluate(() => (window as any).orgCalls.recruits)).toEqual([]);
			await form.getByRole("button", { name: "Add person", exact: true }).click();
			await vi.waitFor(async () =>
				expect(await page.evaluate(() => (window as any).orgCalls.recruits)).toHaveLength(1),
			);
			expect(await page.evaluate(() => (window as any).orgCalls.recruits[0])).toEqual({
				name: "",
				cwd: REPOSITORY,
				...(goal.trim() ? { brief: goal.trim() } : {}),
				reportsTo: "ada",
				role: "implementation-engineer",
				...(specialization.trim() ? { specialization: specialization.trim() } : {}),
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
	},
	30_000,
);

test.each(["", "Review keyboard behavior."])(
	"a team without a shared task retains position goal=%j through partial setup and becomes ready without a kickoff claim",
	async (positionGoal) => {
		const { page, errors } = await openOrg();
		try {
			await draftTeam(page, "   ");
			const plan = page.getByRole("complementary", { name: "Team plan", exact: true });
			await plan.getByRole("textbox", { name: "Specialization", exact: true }).fill("Keyboard accessibility");
			await plan.getByRole("textbox", { name: "Position goal", exact: true }).fill(positionGoal);
			await plan.getByRole("combobox", { name: "Existing teammate", exact: true }).selectOption("cleo");
			await plan.getByRole("button", { name: "Add teammate", exact: true }).click();
			expect(await plan.getByRole("textbox", { name: "Position goal", exact: true }).count()).toBe(0);
			await plan.getByRole("button", { name: "Planned role: Implementation Engineer 3", exact: true }).click();
			expect(await plan.getByRole("textbox", { name: "Position goal", exact: true }).inputValue()).toBe(positionGoal);
			await plan
				.getByText(positionGoal ? "Only position goals will be assigned." : "People will be ready for instructions.", {
					exact: true,
				})
				.waitFor();
			await shot(page, positionGoal ? "light-position-goal-plan" : "light-idle-team-plan");
			await plan.getByRole("button", { name: "Start team", exact: true }).click();
			await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(1));
			const first = await page.evaluate(() => (window as any).orgCalls.starts[0]);
			expect(first).not.toHaveProperty("goal");
			expect(first.positions).toHaveLength(4);
			const focusedPosition = first.positions.find(
				(position: any) => position.specialization === "Keyboard accessibility",
			);
			expect(focusedPosition).toBeDefined();
			for (const position of first.positions) {
				if (position.id === focusedPosition.id && positionGoal) expect(position.goal).toBe(positionGoal);
				else expect(position).not.toHaveProperty("goal");
			}
			const partial = {
				id: first.id,
				complete: false,
				next: "retry",
				people: first.positions.map((position: any, index: number) => ({
					id: position.id,
					person: position.person ?? `idle-person-${index}`,
					state: index === 0 ? "ready" : "blocked",
				})),
			};
			await page.evaluate((progress) => {
				(window as any).progressOrg(progress);
				(window as any).releaseOrgStart(progress);
			}, partial);
			await plan.getByRole("button", { name: "Retry unresolved teammates", exact: true }).waitFor();
			await plan.getByText("Setup plan", { exact: true }).click();
			const teamGoal = plan.getByRole("textbox", { name: "Team task", exact: true });
			expect((await teamGoal.inputValue()).trim()).toBe("");
			expect(await teamGoal.isEnabled()).toBe(false);
			expect(await plan.getByRole("textbox", { name: "Position goal", exact: true }).isEnabled()).toBe(false);
			await plan.getByText("Setup plan", { exact: true }).click();
			await plan.getByRole("button", { name: "Close team plan", exact: true }).click();
			await page.getByRole("button", { name: "Resume setup", exact: true }).click();
			await plan.getByRole("button", { name: "Retry unresolved teammates", exact: true }).click();
			await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).orgCalls.starts)).toHaveLength(2));
			expect(await page.evaluate(() => (window as any).orgCalls.starts[1])).toEqual({
				...first,
				positions: first.positions.map((position: any) => ({
					...position,
					person: partial.people.find((member: any) => member.id === position.id)!.person,
				})),
			});
			await page.evaluate(
				(progress) => {
					(window as any).progressOrg(progress);
					(window as any).releaseOrgStart(progress);
				},
				{
					...partial,
					complete: true,
					next: "done",
					note: "Team ready.",
					people: partial.people.map((member: any) => ({ ...member, state: "ready" })),
				},
			);
			await page.getByRole("status").getByText("Team ready.", { exact: true }).first().waitFor();
			expect(await plan.getByRole("button", { name: "Team ready", exact: true }).isEnabled()).toBe(false);
			expect(await page.getByText(/^Sent the team task to/).count()).toBe(0);
			expect(await page.getByRole("button", { name: "Team started", exact: true }).count()).toBe(0);
			await shot(page, positionGoal ? "light-position-goal-ready" : "light-idle-team-ready");
			const calls = await page.evaluate(() => (window as any).orgCalls);
			for (const action of [
				"recruits",
				"moves",
				"wakes",
				"closes",
				"channelReads",
				"memberships",
				"conversations",
				"seen",
			])
				expect(calls[action]).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await page.close();
		}
	},
	30_000,
);

test("recorded team work keeps its provenance while a person's profile includes earlier assignments", async () => {
	const { page, errors } = await openOrg();
	try {
		await openTeam(page, "Ada");
		await page.getByRole("button", { name: "Ada organization", exact: true }).click();
		const teamDialog = page.getByRole("dialog", { name: "Recorded team work", exact: true });
		await teamDialog.getByRole("button", { name: "Read task: Build the reporting editor", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
		await teamDialog.getByRole("button", { name: "Read task: Build the reporting editor", exact: true }).click();
		await teamDialog.getByText("Cleo: assigned, in focus", { exact: true }).waitFor();
		await teamDialog.getByRole("button", { name: "Read task: Review the keyboard workflow", exact: true }).click();
		await teamDialog.getByText("Ellis: assigned", { exact: true }).waitFor();
		expect(
			await teamDialog.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).count(),
		).toBe(0);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["active-work", "assigned-work"]);
		await teamDialog.getByRole("button", { name: "Close work history", exact: true }).click();
		await page.getByRole("button", { name: "View profile: Cleo", exact: true }).click();
		const profile = page.getByRole("complementary", { name: "Profile: Cleo", exact: true });
		await profile
			.getByRole("region", { name: "Recorded work", exact: true })
			.getByRole("button", { name: "View all recorded work (3)", exact: true })
			.click();
		const history = page.getByRole("dialog", { name: "Recorded work", exact: true });
		await history.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).waitFor();
		expect(await history.getByText("Recorded organization: Daria", { exact: true }).count()).toBe(2);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["active-work", "assigned-work"]);
		await history.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).click();
		await history.getByText("Cleo: assignment finished", { exact: true }).waitFor();
		await history
			.getByRole("article", { name: "Task: Ship the invoice report", exact: true })
			.getByText("Explicitly loaded task: finished-work.", { exact: true })
			.waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([
			"active-work",
			"assigned-work",
			"finished-work",
		]);
		await history.getByRole("button", { name: "Read task: Investigate the ledger import", exact: true }).click();
		await history.getByText("Cleo: unassigned", { exact: true }).waitFor();
		await history.getByRole("button", { name: "Close work history", exact: true }).click();
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
		await page.getByRole("button", { name: "Daria organization", exact: true }).click();
		await teamDialog.getByRole("button", { name: "Read task: Ship the invoice report", exact: true }).waitFor();
		await teamDialog.getByRole("button", { name: "Read task: Investigate the ledger import", exact: true }).waitFor();
		expect(await page.getByRole("button", { name: "View profile: Cleo", exact: true }).count()).toBe(0);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([
			"active-work",
			"assigned-work",
			"finished-work",
			"handed-off-work",
		]);
		expect(await page.evaluate(() => (window as any).orgCalls.conversations)).toEqual([]);
		expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
		await shot(page, "light-recorded-work");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
}, 30_000);

test("large work history stays in a bounded modal with independent scrolling and leaves chart and profile unchanged", async () => {
	const snapshot = world();
	const many = Array.from({ length: 60 }, (_, index) => ({
		...WORK[0]!,
		id: `history-${index}`,
		title: `Recorded task ${index}`,
		bundle: `/tasks/history-${index}`,
		updatedAt: NOW - index,
	}));
	snapshot.workplace!.workHistory = many;
	const { page, errors } = await openOrg("dark", snapshot);
	try {
		await page.setViewportSize({ width: 900, height: 800 });
		await page.evaluate(() => {
			(window as any).taskBody = Array.from(
				{ length: 120 },
				(_, index) =>
					`Paragraph ${index}: Details of this recorded task are intentionally long enough to scroll independently.`,
			).join("\n\n");
		});
		await openTeam(page, "Ada");
		const chart = page.locator(".wp-org-viewport");
		const chartBefore = await chart.boundingBox();
		const pageBefore = await page.evaluate(() => ({
			width: document.documentElement.scrollWidth,
			height: document.documentElement.scrollHeight,
		}));
		const openTeamHistory = page.getByRole("button", { name: "Ada organization", exact: true });
		await openTeamHistory.click();
		const modal = page.getByRole("dialog", { name: "Recorded team work", exact: true });
		await modal.waitFor();
		const bounds = await modal.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.y).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(900);
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
		expect(await chart.boundingBox()).toEqual(chartBefore);
		expect(
			await page.evaluate(() => ({
				width: document.documentElement.scrollWidth,
				height: document.documentElement.scrollHeight,
			})),
		).toEqual(pageBefore);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual([]);
		const list = modal.getByRole("navigation", { name: "Tasks", exact: true });
		expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		await list.getByRole("button", { name: "Read task: Recorded task 0", exact: true }).click();
		await modal
			.getByRole("article", { name: "Task: Recorded task 0", exact: true })
			.getByText(/^Paragraph 119:/)
			.waitFor();
		const detail = modal.getByRole("region", { name: "Task detail", exact: true });
		expect(await detail.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		const listScroll = await list.evaluate((node) => node.scrollTop);
		await detail.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		expect(await detail.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		expect(await list.evaluate((node) => node.scrollTop)).toBe(listScroll);
		const detailScroll = await detail.evaluate((node) => node.scrollTop);
		await list.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(listScroll);
		const lastTask = list.getByRole("button", { name: `Read task: ${many.at(-1)!.title}`, exact: true });
		await lastTask.waitFor();
		const lastBounds = await lastTask.boundingBox();
		const listBounds = await list.boundingBox();
		expect(lastBounds!.y).toBeGreaterThanOrEqual(listBounds!.y);
		expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(listBounds!.y + listBounds!.height);
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["history-0"]);
		expect(await detail.evaluate((node) => node.scrollTop)).toBe(detailScroll);
		expect(await modal.boundingBox()).toEqual(bounds);
		await shot(page, "dark-large-work-modal");
		await modal.getByRole("button", { name: "Close work history", exact: true }).click();
		expect(await chart.boundingBox()).toEqual(chartBefore);
		expect(await openTeamHistory.evaluate((node) => node === document.activeElement)).toBe(true);
		await page.getByRole("button", { name: "View profile: Cleo", exact: true }).click();
		const profile = page.getByRole("complementary", { name: "Profile: Cleo", exact: true });
		const profileBefore = await profile.boundingBox();
		const profileChartBefore = await chart.boundingBox();
		const trigger = profile.getByRole("button", { name: "View all recorded work (60)", exact: true });
		await trigger.click();
		const personModal = page.getByRole("dialog", { name: "Recorded work", exact: true });
		await personModal.waitFor();
		expect(await page.evaluate(() => (window as any).orgCalls.taskReads)).toEqual(["history-0"]);
		expect(await profile.boundingBox()).toEqual(profileBefore);
		await profile.getByRole("button", { name: "Close profile", exact: true }).evaluate((node) => node.focus());
		expect(
			await profile
				.getByRole("button", { name: "Close profile", exact: true })
				.evaluate((node) => node === document.activeElement),
		).toBe(false);
		await personModal.getByRole("button", { name: "Close work history", exact: true }).focus();
		await page.keyboard.press("Escape");
		await personModal.waitFor({ state: "hidden" });
		expect(await profile.isVisible()).toBe(true);
		expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true);
		expect(await profile.boundingBox()).toEqual(profileBefore);
		expect(await chart.boundingBox()).toEqual(profileChartBefore);
		expect(
			await page.evaluate(() => ({
				width: document.documentElement.scrollWidth,
				height: document.documentElement.scrollHeight,
			})),
		).toEqual(pageBefore);
		expect(await page.evaluate(() => (window as any).orgCalls.conversations)).toEqual([]);
		expect(await page.evaluate(() => (window as any).orgCalls.seen)).toEqual([]);
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
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
	await page.screenshot({ path: join(SHOTS, `aw-org-${name}.png`), animations: "disabled" });
}
