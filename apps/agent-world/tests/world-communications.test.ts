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

async function openWorkplace() {
	const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
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
	await page.addInitScript(() => {
		const w = window as any;
		localStorage.setItem("workplace-appearance", "light");
		const listeners = new Set<(snapshot: unknown) => void>();
		const person = (id: string, name: string) => ({
			id,
			name,
			role: "coordinator",
			startedAt: 1,
			place: { kind: "headquarters", headquarters: id },
			facts: {
				run: "idle",
				status: "idle",
				reportsTo: null,
				asking: null,
				tool: null,
				task: null,
				git: null,
				unseen: false,
				settledAt: null,
			},
		});
		let world: any = {
			connected: true,
			characters: [person("ada", "Ada"), person("ben", "Ben")],
			dormant: [],
			headquarters: [
				{ id: "ada", name: "Ada", wings: [] },
				{ id: "ben", name: "Ben", wings: [] },
			],
			operatorMail: [{ id: "mail:review", subject: "Review exchange", lastAt: 1000, unread: 1 }],
			workplace: {
				threads: [
					{
						id: "topic:checkout",
						kind: "channel",
						subject: "checkout",
						participants: ["ada"],
						lastSeq: 49,
						lastAt: 1,
						headquarters: "ada",
						closed: false,
					},
				],
				tasks: [],
				escalations: [],
			},
		};
		const people = [
			{ id: "ada", name: "Ada", following: true, access_sources: ["scope"] },
			{ id: "ben", name: "Ben", following: false, access_sources: ["invitation"] },
		];
		const thread: any = {
			id: "topic:checkout",
			kind: "channel",
			channel_type: "topic",
			name: "checkout",
			purpose: "Understand checkout failures",
			scope_head: "ada",
			archived: false,
			pinned: null,
			access: true,
			access_sources: ["operator"],
			following: false,
			read_up_to: 0,
			unread: 3,
			participants: people,
			invitations: [
				{ id: "foreign-guest", name: "Foreign Guest", following: false, access_sources: ["invitation"] },
				people[1],
			],
			permissions: { post: true, join: true, invite: false, remove: false, pin: false, archive: false, reopen: false },
		};
		const mailInfo: any = {
			...thread,
			id: "mail:review",
			kind: "mail",
			channel_type: null,
			name: "Review exchange",
			purpose: null,
			scope_head: null,
			following: null,
			invitations: [],
			participants: [
				{ id: "operator", name: "You", following: null, access_sources: ["member"] },
				{ id: "ada", name: "Ada", following: null, access_sources: ["member"] },
			],
			permissions: { post: true, join: false, invite: true, remove: true, pin: true, archive: true, reopen: false },
		};
		const mailMessages: any[] = [
			{
				id: "mail-m7",
				thread: mailInfo.id,
				seq: 7,
				from: "ada",
				fromName: "Ada",
				at: 7000,
				body: "Mail evidence remains literal: <b>private</b>.",
				reference: { thread: mailInfo.id, seq: 7, id: "mail-m7" },
			},
		];
		const messages: any[] = [11, 28, 49].map((seq) => ({
			id: `m${seq}`,
			thread: thread.id,
			seq,
			from: "ada",
			fromName: "Ada",
			at: seq * 1000,
			body: `Evidence ${seq}: Ben is named in ordinary prose.`,
			reference: { thread: thread.id, seq, id: `m${seq}` },
		}));
		const attempts = new Map<string, any>();
		w.communicationCalls = [];
		w.holdPost = false;
		w.failAck = false;
		const record = (method: string, request: unknown) =>
			w.communicationCalls.push({ method, request: structuredClone(request) });
		const publish = () => {
			world = {
				...world,
				workplace: {
					...world.workplace,
					threads: world.workplace.threads.map((item: any) =>
						item.id === thread.id
							? {
									...item,
									participants: thread.following ? ["ada", "operator"] : ["ada"],
									lastSeq: messages.at(-1)?.seq ?? 0,
									closed: thread.archived,
								}
							: item,
					),
				},
			};
			for (const listener of listeners) listener(world);
		};
		const permissions = () => {
			thread.permissions = {
				post: !thread.archived,
				join: !thread.following,
				invite: thread.following,
				remove: thread.following,
				pin: thread.following,
				archive: thread.following && !thread.archived,
				reopen: thread.following && thread.archived,
			};
		};
		const mutate = async (method: string, request: any) => {
			record(method, request);
			if (attempts.has(request.attempt)) return structuredClone(attempts.get(request.attempt));
			if (request.thread === mailInfo.id) {
				if (method !== "post") throw new Error("Unexpected mail action in fixture");
				const seq = mailMessages.at(-1).seq + 7;
				const message = {
					id: `mail-m${seq}`,
					thread: mailInfo.id,
					seq,
					from: "operator",
					fromName: "You",
					at: seq * 1000,
					body: request.body,
					reference: { thread: mailInfo.id, seq, id: `mail-m${seq}` },
				};
				mailMessages.push(message);
				const result = {
					attempt: request.attempt,
					outcome: "applied",
					effect: { action: "post", thread: structuredClone(mailInfo), message, audience: ["ada"] },
				};
				attempts.set(request.attempt, result);
				return structuredClone(result);
			}
			if (method === "post" && w.refusePost)
				return { attempt: request.attempt, outcome: "refused", reason: "Ben does not have access." };
			if (method === "join") thread.following = true;
			if (method === "leave") thread.following = false;
			if (method === "archive") thread.archived = true;
			if (method === "reopen") thread.archived = false;
			if (method === "pin") thread.pinned = messages.find((message) => message.seq === request.seq)?.reference;
			if (method === "removeInvitations")
				thread.invitations = thread.invitations.filter((person: any) => !request.people.includes(person.id));
			let message: any;
			if (["post", "archive", "reopen"].includes(method)) {
				const seq = messages.at(-1).seq + 7;
				message = {
					id: `m${seq}`,
					thread: thread.id,
					seq,
					from: "operator",
					fromName: "You",
					at: seq * 1000,
					body: request.body ?? request.summary ?? request.reason,
					reference: { thread: thread.id, seq, id: `m${seq}` },
				};
				messages.push(message);
			}
			permissions();
			const result = {
				attempt: request.attempt,
				outcome: "applied",
				effect: {
					action: method,
					thread: structuredClone(thread),
					message,
					...(method === "post"
						? {
								notify: request.notify ?? [],
								queued: (request.notify ?? []).filter((person: string) => person === "ben"),
							}
						: {}),
					...(method === "removeInvitations"
						? {
								people: request.people.map((person: string) => ({
									person,
									explicit_invitation_removed: true,
									access: person === "ben",
									access_sources: person === "ben" ? ["scope"] : [],
									following: person === "ben",
								})),
							}
						: {}),
				},
			};
			attempts.set(request.attempt, result);
			publish();
			if (method === "post" && w.holdPost) {
				w.holdPost = false;
				await new Promise<void>((resolve) => {
					w.releasePost = resolve;
				});
				w.postReturned = true;
				return { attempt: request.attempt, outcome: "uncertain", reason: "Connection lost after publication." };
			}
			return structuredClone(result);
		};
		w.agentWorld = {
			workspace: { resolvePaths: async () => ({ ok: true, files: [] }) },
			snapshot: async () => world,
			onUpdate: (listener: (snapshot: unknown) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			feed: async () => [],
			onFeed: () => () => {},
			sendMail: async () => {
				record("legacySendMail", {});
				throw new Error("Workplace must use the stable enhanced send");
			},
			communications: {
				sendMail: async (request: any) => {
					record("sendMail", request);
					if (attempts.has(request.attempt)) return structuredClone(attempts.get(request.attempt));
					const result = {
						attempt: request.attempt,
						outcome: "applied",
						effect: {
							action: "post",
							thread: { ...mailInfo, id: "mail:created" },
							to: request.to,
							audience: request.to,
						},
					};
					attempts.set(request.attempt, result);
					return w.uncertainMail
						? { attempt: request.attempt, outcome: "uncertain", reason: "Mail result lost after publication." }
						: structuredClone(result);
				},
				findChannels: async (request: any) => {
					record("findChannels", request);
					return { ok: true, value: { threads: [structuredClone(thread)] } };
				},
				createChannel: async (request: any) => {
					record("createChannel", request);
					const created = {
						...thread,
						id: "topic:created",
						name: request.name,
						purpose: request.purpose,
						scope_head: request.scopeHead,
						following: true,
					};
					return {
						attempt: request.attempt,
						outcome: "applied",
						effect: { action: "create_channel", thread: created },
					};
				},
				readThread: async (request: any) => {
					record("readThread", request);
					const currentThread = request.thread === mailInfo.id ? mailInfo : thread;
					const currentMessages = request.thread === mailInfo.id ? mailMessages : messages;
					const inspection = request.view !== "catch_up";
					const before = request.cursor?.startsWith("before:") ? Number(request.cursor.slice(7)) : Infinity;
					const eligible = inspection
						? currentMessages.filter((message) => message.seq < before)
						: currentMessages.filter((message) => message.seq > currentThread.read_up_to);
					const returned = inspection ? eligible.slice(-request.limit) : eligible.slice(0, request.limit);
					const next =
						eligible.length > returned.length
							? inspection
								? `before:${returned[0].seq}`
								: "catch-up-next"
							: undefined;
					const failed = !inspection && w.failAck;
					if (!inspection && !failed && returned.length) currentThread.read_up_to = returned.at(-1).seq;
					const page = {
						view: request.view ?? "catch_up",
						thread: structuredClone(currentThread),
						messages: structuredClone(returned),
						next_cursor: next,
						window_through: currentMessages.at(-1).seq,
						acknowledgment: inspection ? "not_requested" : failed ? "failed" : "applied",
						acknowledgment_reason: failed ? "Runtime acknowledgment refused." : undefined,
						acknowledged_through: !inspection && !failed ? currentThread.read_up_to : null,
						last_confirmed_cursor: currentThread.read_up_to,
					};
					if (request.attempt)
						attempts.set(request.attempt, {
							attempt: request.attempt,
							outcome: failed ? "pending" : "applied",
							effect: { action: "read", thread: structuredClone(currentThread), page },
						});
					return { ok: true, page, attempt: request.attempt };
				},
				searchMessages: async (request: any) => {
					record("searchMessages", request);
					return {
						ok: true,
						value: { messages: structuredClone(messages.filter((message) => message.body.includes(request.query))) },
					};
				},
				post: (request: any) => mutate("post", request),
				join: (request: any) => mutate("join", request),
				leave: (request: any) => mutate("leave", request),
				invite: (request: any) => mutate("invite", request),
				removeInvitations: (request: any) => mutate("removeInvitations", request),
				pin: (request: any) => mutate("pin", request),
				archive: (request: any) => mutate("archive", request),
				reopen: (request: any) => mutate("reopen", request),
				status: async (request: any) => {
					record("status", request);
					return structuredClone(
						attempts.get(request.attempt) ?? { attempt: request.attempt, outcome: "not_recorded" },
					);
				},
			},
		};
	});
	await page.goto(ORIGIN);
	await page.getByRole("button", { name: "Discover or create channels" }).waitFor();
	return { page, errors };
}

const calls = (page: Page, method: string) =>
	page.evaluate(
		(selected) =>
			(window as any).communicationCalls
				.filter((call: any) => call.method === selected)
				.map((call: any) => call.request),
		method,
	);
async function openChannel(page: Page) {
	await page.getByRole("button", { name: "# checkout", exact: true }).click();
	await page.getByRole("textbox", { name: "Post to channel", exact: true }).waitFor();
}
async function shot(page: Page, name: string) {
	if (!SHOTS) return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `aw-communications-${name}.png`), animations: "disabled" });
}

test("channel discovery creates in the explicitly selected organization without reading history", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await page.getByRole("button", { name: "Discover or create channels" }).click();
		const dialog = page.getByRole("dialog", { name: "Discover channels", exact: true });
		await dialog.getByRole("button", { name: "Open checkout", exact: true }).waitFor();
		expect(await calls(page, "readThread")).toEqual([]);
		await dialog.getByRole("button", { name: "Create topic channel", exact: true }).click();
		await page.getByRole("combobox", { name: "Organization scope", exact: true }).selectOption("ben");
		await page.getByRole("textbox", { name: "Channel name", exact: true }).fill("checkout review");
		await page
			.getByRole("textbox", { name: "Purpose", exact: true })
			.fill("Keep cross-team evidence without changing reporting.");
		const creation = page.getByRole("dialog", { name: "Create topic channel", exact: true });
		const inputBounds = (await creation.getByRole("combobox", { name: "Invite: person", exact: true }).boundingBox())!;
		const addBounds = (await creation.getByRole("button", { name: "Add", exact: true }).boundingBox())!;
		expect(inputBounds.width).toBeGreaterThan(addBounds.width);
		const titleBounds = (await creation
			.getByRole("heading", { name: "Create topic channel", exact: true })
			.boundingBox())!;
		const closeBounds = (await creation.getByRole("button", { name: "Close", exact: true }).boundingBox())!;
		expect(titleBounds.x + titleBounds.width).toBeLessThanOrEqual(closeBounds.x);
		expect(addBounds.x + addBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
		await shot(page, "create-light-1440");
		await page.getByRole("button", { name: "Create channel", exact: true }).click();
		await page.getByRole("heading", { name: "# checkout review", exact: true }).waitFor();
		const created = await calls(page, "createChannel");
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({
			scopeHead: "ben",
			name: "checkout review",
			purpose: "Keep cross-team evidence without changing reporting.",
			invite: [],
		});
		expect(created[0].attempt).toMatch(/\S/);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("channel history pages and searches without catch-up and posts only explicit notify targets", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await openChannel(page);
		expect((await calls(page, "readThread"))[0]).toMatchObject({ view: "recent" });
		expect((await calls(page, "readThread"))[0].attempt).toBeUndefined();
		await page.getByRole("spinbutton", { name: "Message page size" }).fill("1");
		await page.getByRole("button", { name: "Read latest", exact: true }).click();
		await page.getByRole("button", { name: "Earlier messages", exact: true }).waitFor();
		await page.getByRole("button", { name: "Earlier messages", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await calls(page, "readThread")).toContainEqual(
				expect.objectContaining({ cursor: "before:49", limit: 1 }),
			),
		);
		await page.getByRole("textbox", { name: "Search conversation" }).fill("Evidence 28");
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await page.getByText("Search results are inspection only; catch-up is unchanged.", { exact: true }).waitFor();
		expect((await calls(page, "readThread")).every((read: any) => read.view !== "catch_up")).toBe(true);
		const body = page.getByRole("textbox", { name: "Post to channel", exact: true });
		await body.fill("Ben is quoted here; this post stays quiet.");
		await page.getByRole("button", { name: "Post message", exact: true }).click();
		await vi.waitFor(async () => expect(await calls(page, "post")).toHaveLength(1));
		expect((await calls(page, "post"))[0].notify).toEqual([]);
		await page.getByText("Notify: nobody (quiet post)", { exact: true }).click();
		await page.getByRole("combobox", { name: "Notify: person", exact: true }).fill("ben");
		await page
			.getByRole("group", { name: "Notify", exact: true })
			.getByRole("button", { name: "Add", exact: true })
			.click();
		await body.fill("Please inspect the refresh evidence.");
		await page.getByRole("button", { name: "Post message", exact: true }).click();
		await vi.waitFor(async () => expect(await calls(page, "post")).toHaveLength(2));
		expect((await calls(page, "post"))[1].notify).toEqual(["ben"]);
		await page.getByText(/Queued for a later opening: Ben/).waitFor();
		await page.getByRole("button", { name: "Join channel", exact: true }).last().click();
		await vi.waitFor(async () => expect(await calls(page, "join")).toHaveLength(1));
		await page.getByRole("button", { name: "Pin message 63", exact: true }).waitFor();
		await page.getByRole("button", { name: "Pin message 63", exact: true }).click();
		await page.getByRole("button", { name: "Message #63", exact: true }).waitFor();
		await page.getByRole("button", { name: "Message #63", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await calls(page, "readThread")).toContainEqual(
				expect.objectContaining({ view: "range", after: 62, through: 63 }),
			),
		);
		await shot(page, "pin-and-notify-light-1440");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("participants can invite, revoke only explicit grants, archive and reopen topic discussion", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await openChannel(page);
		await page.getByRole("button", { name: "Join channel", exact: true }).last().click();
		await vi.waitFor(async () => expect(await calls(page, "join")).toHaveLength(1));
		const actions = page.getByText("Actions", { exact: true });
		await actions.click();
		await page.getByRole("button", { name: "Invite people", exact: true }).click();
		let dialog = page.getByRole("dialog", { name: "Invite people", exact: true });
		await dialog.getByRole("combobox", { name: "Invite: person", exact: true }).fill("known-foreign-id");
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.getByRole("button", { name: "Confirm invite", exact: true }).click();
		await vi.waitFor(async () => expect(await calls(page, "invite")).toHaveLength(1));
		expect((await calls(page, "invite"))[0].people).toEqual(["known-foreign-id"]);
		await actions.click();
		await page.getByRole("button", { name: "Remove invitations", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Remove explicit invitations", exact: true });
		expect(await dialog.locator('datalist option[value="foreign-guest"]').textContent()).toBe("Foreign Guest");
		await dialog.getByRole("combobox", { name: "Remove invitation: person", exact: true }).fill("foreign-guest");
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.getByRole("button", { name: "Confirm remove", exact: true }).click();
		await page.getByText(/Foreign Guest: explicit invitation removed; no access; not following/).waitFor();
		await actions.click();
		await page.getByRole("button", { name: "Remove invitations", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Remove explicit invitations", exact: true });
		await dialog.getByRole("combobox", { name: "Remove invitation: person", exact: true }).fill("ben");
		await dialog.getByRole("button", { name: "Add", exact: true }).click();
		await dialog.getByRole("button", { name: "Confirm remove", exact: true }).click();
		await page.getByText(/Ben: explicit invitation removed; still has access; following/).waitFor();
		await actions.click();
		await page.getByRole("button", { name: "Archive conversation", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Archive conversation", exact: true });
		await dialog
			.getByRole("textbox", { name: "Conclusion", exact: true })
			.fill("Evidence retained; discussion paused, not a completed task.");
		await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click();
		await page.getByText(/Archived conversation\. Authorized participants/).waitFor();
		expect(await page.getByRole("textbox", { name: "Post to channel", exact: true }).count()).toBe(0);
		await page.setViewportSize({ width: 900, height: 900 });
		await page.getByRole("button", { name: "Theme: dark mode" }).click();
		await actions.click();
		await page.getByRole("button", { name: "Reopen conversation", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Reopen conversation", exact: true });
		await dialog
			.getByRole("textbox", { name: "Reopening reason", exact: true })
			.fill("New counterexample needs review.");
		await shot(page, "reopen-dark-900");
		await dialog.getByRole("button", { name: "Confirm reopen", exact: true }).click();
		await page.getByRole("textbox", { name: "Post to channel", exact: true }).waitFor();
		expect((await calls(page, "archive"))[0].summary).toContain("Evidence retained");
		expect((await calls(page, "reopen"))[0].reason).toBe("New counterexample needs review.");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("uncertain publication keeps its attempt and draft and recovers without a second post", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await openChannel(page);
		await page.evaluate(() => {
			(window as any).holdPost = true;
		});
		await page
			.getByRole("textbox", { name: "Post to channel", exact: true })
			.fill("Preserve this uncertain publication.");
		await page.getByRole("button", { name: "Post message", exact: true }).click();
		await vi.waitFor(async () => expect(await calls(page, "post")).toHaveLength(1));
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		const reads = await calls(page, "readThread");
		await page.evaluate(() => (window as any).releasePost());
		await vi.waitFor(async () => expect(await page.evaluate(() => (window as any).postReturned)).toBe(true));
		expect(await calls(page, "readThread")).toEqual(reads);
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await page.getByRole("button", { name: "Check outcome", exact: true }).waitFor();
		expect(await page.getByRole("textbox", { name: "Post to channel", exact: true }).inputValue()).toBe(
			"Preserve this uncertain publication.",
		);
		await page.getByRole("button", { name: "Check outcome", exact: true }).click();
		await vi.waitFor(async () =>
			expect(await page.getByRole("textbox", { name: "Post to channel", exact: true }).inputValue()).toBe(""),
		);
		expect(await calls(page, "post")).toHaveLength(1);
		expect((await calls(page, "status"))[0].attempt).toBe((await calls(page, "post"))[0].attempt);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("failed catch-up acknowledgment preserves the confirmed position and recovery handle", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await openChannel(page);
		await page.getByRole("button", { name: "Join channel", exact: true }).last().click();
		await page.getByRole("button", { name: "Catch up", exact: true }).waitFor();
		await page.getByRole("spinbutton", { name: "Message page size" }).fill("1");
		await page.evaluate(() => {
			(window as any).failAck = true;
		});
		await page.getByRole("button", { name: "Catch up", exact: true }).click();
		await page
			.getByRole("alert")
			.filter({ hasText: /Catch-up acknowledgment failed/ })
			.waitFor();
		await page.getByText(/Last confirmed sequence: 0/).waitFor();
		expect(await page.getByRole("button", { name: "Next message page", exact: true }).isEnabled()).toBe(false);
		const reads = await calls(page, "readThread");
		expect(reads.filter((read: any) => read.view === "catch_up")).toHaveLength(1);
		const identity = reads.find((read: any) => read.view === "catch_up").attempt;
		expect(identity).toMatch(/\S/);
		await page.getByRole("button", { name: "Check outcome", exact: true }).click();
		await vi.waitFor(async () => expect(await calls(page, "status")).toEqual([{ attempt: identity }]));
		expect((await calls(page, "readThread")).filter((read: any) => read.view === "catch_up")).toHaveLength(1);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Mail keeps addressed replies and plain text while its draft survives Chat switches", async () => {
	const { page, errors } = await openWorkplace();
	try {
		expect(await calls(page, "readThread")).toEqual([]);
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		expect(await calls(page, "readThread")).toEqual([]);
		await page.getByRole("button", { name: /Review exchange/ }).click();
		await page.getByText("Mail evidence remains literal: <b>private</b>.", { exact: true }).waitFor();
		expect(await page.locator(".wp-message-body b").count()).toBe(0);
		const latest = (await page.getByRole("button", { name: "Read latest", exact: true }).boundingBox())!;
		const actions = (await page.getByLabel("Conversation actions", { exact: true }).boundingBox())!;
		expect(actions.y).toBeCloseTo(latest.y, 0);
		expect(actions.x).toBeGreaterThanOrEqual(latest.x + latest.width);
		expect(actions.x + actions.width).toBeLessThanOrEqual(page.viewportSize()!.width);
		expect(await page.getByText(/File links unavailable/).count()).toBe(0);
		await shot(page, "mail-controls-light-1440");
		await page.getByRole("textbox", { name: "Reply to everyone", exact: true }).fill("Keep my addressed reply draft.");
		await page.getByRole("button", { name: "Chat", exact: true }).click();
		await openChannel(page);
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		expect(await page.getByRole("textbox", { name: "Reply to everyone", exact: true }).inputValue()).toBe(
			"Keep my addressed reply draft.",
		);
		await page.getByRole("button", { name: "Send reply", exact: true }).click();
		await page.getByRole("status").filter({ hasText: "Addressed audience: Ada." }).waitFor();
		const posted = await calls(page, "post");
		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({ thread: "mail:review", body: "Keep my addressed reply draft." });
		expect(Object.hasOwn(posted[0], "notify")).toBe(false);
		expect((await calls(page, "readThread")).every((read: any) => read.view === "recent" && !read.attempt)).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});

test("Mail Compose recovers a lost send outcome after closing without creating a second thread", async () => {
	const { page, errors } = await openWorkplace();
	try {
		await page.getByRole("button", { name: "Mail", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		let compose = page.getByRole("dialog", { name: "New message", exact: true });
		await compose.getByRole("combobox", { name: "Mail recipient", exact: true }).selectOption("ben");
		await compose.getByRole("textbox", { name: "Mail body", exact: true }).fill("One addressed new thread.");
		await page.evaluate(() => {
			(window as any).uncertainMail = true;
		});
		await compose.getByRole("button", { name: "Send mail", exact: true }).click();
		await compose.getByRole("status").filter({ hasText: "Mail result lost after publication." }).waitFor();
		expect(await compose.getByRole("button", { name: "Send mail", exact: true }).isEnabled()).toBe(false);
		const sent = await calls(page, "sendMail");
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			to: ["ben"],
			subject: "Message from the operator",
			body: "One addressed new thread.",
		});
		await compose.getByRole("button", { name: "Close new message", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		compose = page.getByRole("dialog", { name: "New message", exact: true });
		expect(await compose.getByRole("textbox", { name: "Mail body", exact: true }).inputValue()).toBe(
			"One addressed new thread.",
		);
		expect(await compose.getByRole("combobox", { name: "Mail recipient", exact: true }).inputValue()).toBe("ben");
		await compose.getByRole("button", { name: "Check mail outcome", exact: true }).click();
		await compose.getByRole("status").filter({ hasText: "Mail applied. Addressed: Ben." }).waitFor();
		expect(await calls(page, "sendMail")).toHaveLength(1);
		expect(await calls(page, "status")).toEqual([{ attempt: sent[0].attempt }]);
		expect(await calls(page, "legacySendMail")).toEqual([]);
		await shot(page, "mail-recovered-light-1440");
		await compose.getByRole("button", { name: "Close new message", exact: true }).click();
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		expect(await page.getByRole("textbox", { name: "Mail body", exact: true }).inputValue()).toBe("");
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
