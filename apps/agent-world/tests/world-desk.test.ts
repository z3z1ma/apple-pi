import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { appFile, contentType } from "../src/app-files.js";

const ORIGIN = "http://localhost";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.env.AGENT_WORLD_SHOTS;
let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
});
afterAll(() => browser?.close());

/** Workplace with a front desk, two tasks in flight, a closed one, a person asking, and a fake conversation store. */
async function openDesk(appearance: "light" | "dark", width = 1440, desk = true) {
	const page = await browser.newPage({ viewport: { width, height: 900 } });
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
		({ appearance, desk }) => {
			const w = window as any;
			localStorage.setItem("workplace-appearance", appearance);
			const now = Date.now();
			const person = (id: string, name: string, title: string, extra: any = {}) => ({
				id,
				name,
				role: "worker",
				startedAt: 1,
				place: { kind: "headquarters", headquarters: "cora" },
				facts: {
					run: "idle",
					status: "idle",
					reportsTo: id === "cora" ? null : "cora",
					title,
					asking: null,
					tool: null,
					task: null,
					git: null,
					cwd: "/repo",
					unseen: false,
					settledAt: null,
					needsYouSince: null,
					...extra,
				},
			});
			const listeners = new Set<(snapshot: unknown) => void>();
			let world: any = {
				connected: true,
				headquarters: [{ id: "cora", name: "Cora", wings: [] }],
				characters: [
					person("cora", "Cora", "Coordinator"),
					person("iris", "Iris", "Implementation Engineer", { run: "running_tool", status: "working" }),
					person("milo", "Milo", "Code Review Specialist", {
						status: "asking",
						asking: { kind: "questionnaire", text: "Ship the migration behind a flag?" },
						needsYouSince: now - 120_000,
					}),
				],
				dormant: [],
				operatorMail: [],
				mail: ["iris", "milo"].map((to) => ({
					id: `post-1:${to}`,
					from: "operator",
					fromName: "You",
					to,
					toName: to === "iris" ? "Iris" : "Milo",
					body: "Both of you: pair on the schedules review.",
					sentAt: now - 60_000,
					deliveredAt: to === "iris" ? now - 50_000 : null,
					state: to === "iris" ? "delivered" : "waiting",
					reason: null,
				})),
				desk: desk ? { thread: "topic:desk", person: "cora" } : null,
				workplace: {
					threads: [
						{
							id: "topic:desk",
							kind: "channel",
							subject: "desk",
							participants: ["cora", "operator"],
							lastSeq: 3,
							lastAt: now,
							headquarters: "cora",
							closed: false,
						},
					],
					tasks: [
						{
							id: "t1",
							bundle: "/b/t1",
							project: "/repo",
							headquarters: "cora",
							title: "Add GitHub PR threads",
							status: "in-progress",
							ephemeral: true,
							thread: "task:t1",
							assignees: [{ person: "iris", focused: true }],
						},
						{
							id: "t2",
							bundle: "/b/t2",
							project: "/repo",
							headquarters: "cora",
							title: "Review the schedules change",
							status: null,
							ephemeral: true,
							thread: "task:t2",
							assignees: [{ person: "milo", focused: true }],
						},
					],
					workHistory: [
						{
							id: "t0",
							bundle: "/b/t0",
							project: "/repo",
							headquarters: "cora",
							title: "Presence dots",
							status: "done",
							thread: "task:t0",
							openedAt: now - 7_200_000,
							closedAt: now - 3_600_000,
							updatedAt: now - 3_600_000,
							participants: [{ person: "iris", assignedAt: 1, endedAt: 2, outcome: "finished", focused: false }],
						},
					],
					escalations: [],
				},
			};
			const message = (thread: string, seq: number, from: string, fromName: string, body: string) => ({
				id: `${thread}:${seq}`,
				thread,
				seq,
				from,
				fromName,
				at: now - (10 - seq) * 60_000,
				body,
				reference: { thread, seq, id: `${thread}:${seq}` },
			});
			const store: Record<string, any[]> = {
				"topic:desk": [
					message("topic:desk", 1, "operator", "You", "Bring GitHub PRs into the organization as threads."),
					message(
						"topic:desk",
						2,
						"cora",
						"Cora",
						"Recorded as **Add GitHub PR threads**; Iris has it. Milo is reviewing the schedules change. Nothing needs you yet.",
					),
				],
				"task:t1": [message("task:t1", 1, "cora", "Cora", "Iris: build GitHub PR threads; see the brief.")],
				"task:t2": [],
			};
			const info = (thread: string) => ({
				id: thread,
				kind: thread.startsWith("topic:") ? "channel" : "task",
				channel_type: thread.startsWith("topic:") ? "topic" : null,
				name: thread === "topic:desk" ? "desk" : thread,
				purpose: null,
				scope_head: "cora",
				archived: false,
				pinned: null,
				access: true,
				access_sources: ["operator"],
				following: thread.startsWith("topic:") ? true : null,
				read_up_to: store[thread]?.at(-1)?.seq ?? 0,
				unread: 0,
				participants: [],
				invitations: [],
				permissions: {
					post: true,
					join: false,
					invite: false,
					remove: false,
					pin: false,
					archive: false,
					reopen: false,
				},
			});
			w.posts = [];
			w.agentWorld = {
				workspace: { resolvePaths: async () => ({ ok: true, files: [] }) },
				snapshot: async () => world,
				onUpdate: (listener: (snapshot: unknown) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				feed: async () => [],
				onFeed: () => () => {},
				conversation: async () => ({ entries: [], before: null }),
				setDesk: async (next: any) => {
					world = { ...world, desk: next };
					for (const listener of listeners) listener(world);
					return { ok: true };
				},
				communications: {
					readThread: async (request: any) => ({
						ok: true,
						page: {
							view: request.view ?? "recent",
							thread: info(request.thread),
							messages: structuredClone(store[request.thread] ?? []),
							window_through: store[request.thread]?.at(-1)?.seq ?? 0,
							acknowledgment: "not_requested",
							acknowledged_through: null,
						},
					}),
					post: async (request: any) => {
						w.posts.push(structuredClone(request));
						store[request.thread] ??= [];
						const list = store[request.thread]!;
						const posted = message(request.thread, (list.at(-1)?.seq ?? 0) + 1, "operator", "You", request.body);
						list.push(posted);
						return {
							attempt: request.attempt,
							outcome: "applied",
							effect: { action: "post", thread: info(request.thread), message: posted, audience: [] },
						};
					},
					createChannel: async (request: any) => {
						w.created = structuredClone(request);
						return {
							attempt: request.attempt,
							outcome: "applied",
							effect: { action: "create_channel", thread: info("topic:desk") },
						};
					},
					status: async () => ({ ok: true, value: null }),
					searchMessages: async () => ({ ok: true, value: { messages: [] } }),
				},
			};
		},
		{ appearance, desk },
	);
	await page.goto(`${ORIGIN}/`);
	return { page, errors };
}

async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-desk-${name}.png`), animations: "disabled" });
}

test("Chat opens at the front desk, and a post there always notifies its coordinator", {
	timeout: 60_000,
}, async () => {
	const { page, errors } = await openDesk("light");
	try {
		await page.getByRole("heading", { name: "Front desk", exact: true }).waitFor();
		expect(await page.getByRole("button", { name: /^Front desk/ }).getAttribute("aria-pressed")).toBe("true");
		await page.getByText("Recorded as", { exact: false }).waitFor();
		expect(await page.getByRole("button", { name: "# desk" }).count()).toBe(0);
		const composer = page.getByRole("textbox", { name: "Post to channel", exact: true });
		expect(await composer.getAttribute("placeholder")).toBe("Tell the organization what you need...");
		await shot(page, "light");
		await composer.fill("Also make the Threads view searchable.");
		await composer.press("Enter");
		await vi.waitFor(async () =>
			expect(await page.evaluate(() => (window as any).posts)).toEqual([
				expect.objectContaining({
					thread: "topic:desk",
					notify: ["cora"],
					body: "Also make the Threads view searchable.",
				}),
			]),
		);
		const flight = page.getByRole("region", { name: "Work in flight" });
		await flight.getByRole("button", { name: /2 in flight/ }).click();
		await flight.getByRole("button", { name: /Add GitHub PR threads/ }).click();
		const panel = page.getByRole("complementary", { name: "Thread: Add GitHub PR threads" });
		await panel.getByText("Iris: build GitHub PR threads").waitFor();
		await shot(page, "thread-light");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Threads lists live work before closed work, and Activity puts questions first", { timeout: 60_000 }, async () => {
	const { page, errors } = await openDesk("dark");
	try {
		await page.getByRole("heading", { name: "Front desk", exact: true }).waitFor();
		await shot(page, "dark");
		await page.getByRole("button", { name: /^Threads/ }).click();
		const titles = await page.locator(".wp-threads-list strong").allTextContents();
		expect(titles).toEqual(["Add GitHub PR threads", "Review the schedules change", "Presence dots"]);
		await shot(page, "threads-dark");
		await page.getByRole("button", { name: /^Activity/ }).click();
		const activity = page.getByRole("region", { name: "Activity" });
		await activity.getByText("Ship the migration behind a flag?").waitFor();
		expect(await activity.locator(".wp-activity-kind").first().textContent()).toBe("Needs your answer");
		await shot(page, "activity-dark");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Command K jumps to a person, a thread or a view", { timeout: 60_000 }, async () => {
	const { page, errors } = await openDesk("light");
	try {
		await page.getByRole("heading", { name: "Front desk", exact: true }).waitFor();
		await page.keyboard.press("Control+k");
		const jump = page.getByRole("textbox", { name: "Jump to a person, channel, thread or view" });
		await jump.fill("schedules");
		await shot(page, "switcher-light");
		await jump.press("Enter");
		await page.getByRole("complementary", { name: "Thread: Review the schedules change" }).waitFor();
		await page.keyboard.press("Control+k");
		await jump.fill("iris");
		await jump.press("Enter");
		await page.locator(".wp-conversation-header h1").filter({ hasText: "Iris" }).waitFor();
		await page.keyboard.press("Control+k");
		await jump.press("Escape");
		expect(await jump.count()).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Mail shows a message to several people once, with each recipient's delivery", { timeout: 60_000 }, async () => {
	const { page, errors } = await openDesk("light");
	try {
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: /^Sent/ }).click();
		const rows = page.getByRole("region", { name: "Delivery log" }).locator(".wp-mail-row");
		await rows.first().waitFor();
		expect(await rows.count()).toBe(1);
		await rows.first().click();
		const recipients = page.getByRole("list", { name: "Recipients" });
		await recipients.getByText("Iris", { exact: true }).waitFor();
		expect(await recipients.getByText(/^Delivered /).count()).toBe(1);
		expect(await recipients.getByText("Waiting for them to open", { exact: true }).count()).toBe(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Without a desk, Chat offers to open one with the root coordinator", { timeout: 60_000 }, async () => {
	const { page, errors } = await openDesk("light", 1100, false);
	try {
		await page.getByRole("heading", { name: "Open the front desk", exact: true }).waitFor();
		await shot(page, "setup-light");
		await page.getByRole("button", { name: "Open the desk with Cora", exact: true }).click();
		await page.getByRole("heading", { name: "Front desk", exact: true }).waitFor();
		expect(await page.evaluate(() => (window as any).created)).toMatchObject({
			scopeHead: "cora",
			name: "desk",
			invite: ["cora"],
		});
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
