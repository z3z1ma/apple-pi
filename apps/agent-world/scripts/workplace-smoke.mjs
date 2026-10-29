// Fixture-only browser check; never connects to the operator's runtime or sends real messages.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "apps/agent-world"))) {
	const parent = dirname(root);
	if (parent === root) throw new Error("Cannot find the Agent World checkout.");
	root = parent;
}
const output = resolve(process.argv[2] ?? "/tmp/workplace-shots");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
	executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	headless: true,
});
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.route("http://workplace.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const file = join(root, "apps/agent-world/dist/web", path === "/" ? "index.html" : path);
		if (!existsSync(file)) return route.fulfill({ status: 404 });
		return route.fulfill({
			body: readFileSync(file),
			contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
		});
	});
	await page.addInitScript(() => {
		const now = Date.now();
		const people = [
			["orla", "Orla Byrne", "Coordinator"],
			["maya", "Maya Chen", "Implementation Engineer"],
			["theo", "Theo Laurent", "Quality Engineering Director"],
		];
		const calls = [];
		window.calls = calls;
		const posted = new Map();
		const memberships = new Map([
			["engineering", true],
			["observer", false],
		]);
		const read = (id) => {
			const result = thread(id);
			result.messages.push(...(posted.get(id) ?? []));
			return result;
		};
		const thread = (id) => ({
			id,
			subject: id === "mail-1" ? "API migration: one decision before we proceed" : "Engineering",
			closed: false,
			participants: [
				{ id: "orla", name: "Orla Byrne" },
				{ id: "maya", name: "Maya Chen" },
				...(memberships.get(id) === false ? [] : [{ id: "operator", name: "You" }]),
			],
			messages: [
				{
					seq: 1,
					from: "orla",
					name: "Orla Byrne",
					at: now - 600000,
					body: "The migration implementation is ready. Maya has covered the new endpoint and Theo has the integration checks prepared.\n\nOne decision remains: should existing clients receive a deprecation warning now, or only after the next release?",
				},
				{
					seq: 2,
					from: "maya",
					name: "Maya Chen",
					at: now - 300000,
					body: id.startsWith("mail")
						? "My recommendation is to warn now, with no behavior change. The compatibility path is covered by tests. I can proceed as soon as you confirm."
						: "## Release plan\n\n**Warn now**, with no behavior change.\n\n- Keep existing responses\n- Cover the compatibility path\n\n```ts\nconst warning = true;\n```\n\n| Check | Result |\n| --- | --- |\n| Compatibility | Passed |\n\nRead the [release guide](https://example.com/release) or [API spec](docs/api.md).\n\n<script>window.channelInjected = true</script>\n\n![diagram](https://example.com/diagram.png)\n\n[unsafe](javascript:alert(1))",
				},
			],
		});
		const world = {
			connected: true,
			headquarters: [],
			characters: people.map(([id, name, title], i) => ({
				id,
				name,
				role: i ? "worker" : "coordinator",
				place: { kind: "square" },
				startedAt: now,
				facts: {
					run: id === "maya" ? "running_tool" : "idle",
					status: id === "maya" ? "working" : "idle",
					asking: null,
					needsYouSince: null,
					unseen: false,
					seenAt: null,
					settledAt: null,
					tool: id === "maya" ? { name: "bash", arg: "npm run test:api", since: now } : null,
					task: { title: "Migrate the billing API", status: "in-progress", bundle: "/example/task" },
					git: null,
					cwd: "/example",
					reportsTo: null,
					title,
					model: null,
					contextTokens: null,
					contextWindow: null,
					cost: 0,
					tmux: null,
				},
			})),
			dormant: [],
			operatorMail: [
				{ id: "mail-1", subject: "API migration: one decision before we proceed", unread: 2, lastAt: now },
				{ id: "mail-2", subject: "Review complete: session-state tests", unread: 0, lastAt: now - 3600000 },
			],
			mail: [
				{
					id: "delivery-1",
					from: "orla",
					fromName: "Orla Byrne",
					to: "maya",
					toName: "Maya Chen",
					body: "The API migration is ready for the operator's decision.",
					sentAt: now,
					deliveredAt: now,
					state: "delivered",
					reason: null,
				},
			],
			workplace: {
				tasks: [],
				escalations: [],
				threads: [
					{
						id: "engineering",
						kind: "channel",
						subject: "Engineering",
						createdBy: "orla",
						headquarters: "orla",
						closed: false,
						lastSeq: 2,
						lastAt: now,
						participants: ["orla", "maya", "operator"],
					},
					{
						id: "observer",
						kind: "channel",
						subject: "Platform",
						createdBy: "orla",
						headquarters: "orla",
						closed: false,
						lastSeq: 2,
						lastAt: now,
						participants: ["orla", "maya"],
					},
				],
			},
		};
		world.characters.find((person) => person.id === "maya").hiredAt = now - 86400000;
		world.characters.find((person) => person.id === "maya").facts.tasks = [
			"Verify the compatibility behavior across all supported clients. ".repeat(5),
		];
		Object.assign(world.characters.find((person) => person.id === "theo").facts, {
			status: "asking",
			asking: { kind: "questionnaire", text: "Which deployment window?" },
			needsYouSince: now,
		});
		window.fixtureWorld = world;
		window.agentWorld = {
			profile: async (id) => {
				calls.push(["profile", id]);
				return {
					ok: true,
					self:
						"## My story\n\n" +
						"I turn a bounded goal into a tested change and keep the evidence clear. ".repeat(4) +
						"\n\n## How I work\n\nI read the owning code, make the smallest useful change, and check the behavior.\n\n## What I hold myself to\n\nKeep the next maintainer in mind.\n\n## The people I work with\n\nI ask colleagues when their perspective can change the decision.",
				};
			},
			snapshot: async () => world,
			onUpdate: (fn) => {
				window.updateWorld = fn;
				return () => {};
			},
			feed: async () => [],
			onFeed: () => () => {},
			conversation: async (id) => {
				calls.push(["conversation", id]);
				return {
					ok: true,
					entries: [
						{
							kind: "user",
							id: "u1",
							at: now - 100000,
							text: "Please check the migration and show me the result.",
							images: 0,
						},
						{
							kind: "assistant",
							id: "a1",
							at: now - 90000,
							parts: [
								{ kind: "thinking", text: "Internal plan for compatibility checks." },
								{
									kind: "text",
									text: "The migration is implemented. I am checking the **compatibility path** before handing it back.\n\n- Existing clients retain the current response.\n- New clients can use the versioned endpoint.\n- The remaining question is when to start the deprecation warning.\n\nRead the [migration notes](https://example.com/migration).",
								},
								{
									kind: "tool",
									call: { id: "tool1", name: "bash", arg: "npm run test:api", input: '{"command":"npm run test:api"}' },
								},
							],
							error: null,
							aborted: false,
						},
						{
							kind: "tool-result",
							id: "r1",
							at: now - 80000,
							callId: "tool1",
							tool: "bash",
							text: "18 tests passed",
							isError: false,
							cut: false,
						},
						{
							kind: "note",
							id: "task-note",
							at: now - 70000,
							label: "apple-pi:task-notification",
							shown: true,
							text: "Background task finished.",
						},
						{
							kind: "assistant",
							id: "thought-only",
							at: now - 60000,
							parts: [{ kind: "thinking", text: "Internal reasoning." }],
							error: "Connection error",
							aborted: false,
						},
					],
					before: null,
					missing: 0,
				};
			},
			markSeen: async () => ({ ok: true }),
			goToTerminal: async () => ({ ok: true }),
			instruct: async (id, _commandId, instruction) => {
				calls.push(["instruct", id, instruction]);
				return { ok: true };
			},
			onReceipt: () => () => {},
			watchReplies: async () => {},
			onReply: (fn) => {
				window.replyEvent = fn;
				return () => {
					window.replyEvent = undefined;
				};
			},
			setChannelMembership: async (id, joined) => {
				calls.push(["membership", id, joined]);
				if (window.refuseMembership) {
					window.refuseMembership = false;
					return { ok: false, reason: "Membership change refused by fixture." };
				}
				memberships.set(id, joined);
				world.workplace.threads = world.workplace.threads.map((t) =>
					t.id === id
						? {
								...t,
								participants: joined
									? [...new Set([...t.participants, "operator"])]
									: t.participants.filter((p) => p !== "operator"),
							}
						: t,
				);
				window.updateWorld({ ...world });
				return { ok: true, stage: "applied" };
			},
			readThread: async (id) => {
				calls.push(["read-mail", id]);
				return { ok: true, thread: read(id) };
			},
			readWorkplaceThread: async (id) => {
				calls.push(["read-channel", id]);
				return { ok: true, thread: read(id) };
			},
			replyThread: async (id, body) => {
				calls.push(["reply", id, body]);
				const messages = posted.get(id) ?? [];
				messages.push({ seq: 3 + messages.length, from: "operator", name: "You", at: Date.now(), body });
				posted.set(id, messages);
				return { ok: true, stage: "applied" };
			},
			sendMail: async (id, body) => {
				calls.push(["mail", id, body]);
				return { ok: true, stage: "applied" };
			},
		};
	});
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("http://workplace.test/?workplace=chat");
	const theme = page.getByRole("button", { name: "Theme: dark mode", exact: true });
	await theme.waitFor();
	assert.equal(await theme.getAttribute("aria-pressed"), "false");
	await theme.click();
	assert.equal(await theme.getAttribute("aria-pressed"), "true");
	await page.reload();
	await theme.waitFor();
	assert.equal(await theme.getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: /^Maya Chen/ }).click();
	await page.getByRole("region", { name: "Conversation with Maya Chen" }).waitFor();
	await page.getByText("The migration is implemented.", { exact: false }).waitFor();
	const toolCall = page.getByRole("log", { name: "Transcript" }).getByRole("button", { name: /^bash / });
	assert.equal(await toolCall.count(), 0);
	for (const detail of ["Thought it over", "task-notification", "Connection error"])
		assert.equal((await page.getByRole("log", { name: "Transcript" }).textContent()).includes(detail), false);
	await page.getByRole("button", { name: "Show tool calls", exact: true }).click();
	await toolCall.click();
	await page.getByText("18 tests passed", { exact: true }).waitFor();
	await page.screenshot({ path: join(output, "chat-tools.png"), animations: "disabled" });
	await page.getByRole("button", { name: "Show tool calls", exact: true }).click();
	assert.equal(await toolCall.count(), 0);
	await page.getByRole("status").filter({ hasText: "Maya Chen is working" }).waitFor();
	await page.evaluate(() => {
		const w = window.fixtureWorld;
		w.characters.find((p) => p.id === "maya").facts.tool.arg =
			`npm run test:api -- ${"compatibility/checks/".repeat(100)}`;
		window.updateWorld({ ...w });
	});
	await page
		.getByRole("main")
		.getByText("Working · Implementation Engineer", { exact: true })
		.filter({ visible: true })
		.waitFor();
	await page.screenshot({ path: join(output, "chat-tool-progress.png"), animations: "disabled" });
	await page.setViewportSize({ width: 820, height: 800 });
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await page.screenshot({ path: join(output, "chat-compact.png"), animations: "disabled" });
	await page.setViewportSize({ width: 1440, height: 940 });
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await page.evaluate(() => {
		const w = window.fixtureWorld;
		w.characters.find((p) => p.id === "maya").facts.run = "writing_reply";
		window.updateWorld({ ...w });
		window.replyEvent({
			kind: "delta",
			characterId: "maya",
			streamId: "refinement",
			delta: "I am checking the last compatibility case.",
		});
	});
	await page.getByRole("status").filter({ hasText: "Maya Chen is typing" }).waitFor();
	await page.getByText("I am checking the last compatibility case.", { exact: true }).waitFor();
	await page.screenshot({ path: join(output, "chat-dark.png"), animations: "disabled" });
	await page
		.locator(".wp-conversation-header")
		.getByRole("button", { name: "View profile: Maya Chen", exact: true })
		.click();
	const profile = page.getByRole("complementary", { name: "Profile: Maya Chen", exact: true });
	await profile.getByRole("heading", { name: "Maya Chen", exact: true }).waitFor();
	await profile.getByRole("region", { name: "Self: My story", exact: true }).waitFor();
	assert.equal(await profile.getByRole("alert").count(), 0);
	await page.screenshot({ path: join(output, "profile-dark.png"), animations: "disabled" });
	await theme.click();
	await page.screenshot({ path: join(output, "profile-light.png"), animations: "disabled" });
	await profile.getByRole("button", { name: "See more of Self: My story", exact: true }).click();
	await profile.getByRole("region", { name: "Self: My story", exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(output, "profile-self-expanded.png"), animations: "disabled" });
	await profile.locator(".wp-profile-body").evaluate((el) => {
		el.scrollTop = 0;
	});
	await theme.click();
	await page.keyboard.press("Escape");
	await profile.waitFor({ state: "detached" });
	await theme.click();
	await page.screenshot({ path: join(output, "chat-light.png"), animations: "disabled" });
	await theme.click();
	await page.evaluate(() => {
		const w = window.fixtureWorld;
		const facts = w.characters.find((p) => p.id === "maya").facts;
		facts.run = "idle";
		facts.status = "idle";
		window.updateWorld({ ...w });
	});
	await page.getByRole("status").filter({ hasText: "Maya Chen is typing" }).waitFor({ state: "detached" });
	await page
		.getByRole("main")
		.getByText(/^Idle\b/)
		.filter({ visible: true })
		.waitFor();
	await page.evaluate(() => {
		const w = window.fixtureWorld;
		const facts = w.characters.find((p) => p.id === "maya").facts;
		facts.run = "running_tool";
		facts.status = "working";
		window.updateWorld({ ...w });
	});
	await page.getByRole("link", { name: "migration notes", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "This window cannot open links." }).waitFor();
	await page.getByRole("textbox", { name: "Instruct Maya Chen" }).fill("Warn now, keep behavior unchanged.");
	await page.getByRole("button", { name: "Tell it after this" }).click();
	await page.waitForFunction(() => window.calls.some((call) => call[0] === "instruct"));
	assert.equal(await page.evaluate(() => window.calls.find((call) => call[0] === "instruct")[2].kind), "follow_up");
	await page.getByRole("button", { name: "# Engineering", exact: true }).click();
	await page.getByRole("heading", { name: "Release plan", exact: true }).waitFor();
	await page.getByText("Warn now", { exact: true }).waitFor();
	await page.getByRole("cell", { name: "Compatibility", exact: true }).waitFor();
	assert.equal(await page.getByRole("link", { name: "unsafe", exact: true }).count(), 0);
	await page.getByText("<script>window.channelInjected = true</script>", { exact: false }).waitFor();
	await page.getByText("diagram", { exact: true }).waitFor();
	assert.equal(await page.getByRole("img", { name: "diagram", exact: true }).count(), 0);
	await page.getByRole("link", { name: "release guide", exact: true }).focus();
	await page.keyboard.press("Enter");
	await page.getByRole("alert").filter({ hasText: "This window cannot open links." }).waitFor();
	assert.equal(new URL(page.url()).search, "?workplace=chat");
	await page.getByRole("textbox", { name: "Post to channel", exact: true }).fill("Proceed with the warning.");
	await page.getByRole("button", { name: /^Post message/ }).click();
	await page.waitForFunction(() => window.calls.some((call) => call[0] === "reply" && call[1] === "engineering"));
	await page.getByText("Proceed with the warning.", { exact: true }).waitFor();
	await page.screenshot({ path: join(output, "channel.png"), animations: "disabled" });
	await page.locator(".wp-message").getByRole("button", { name: "View profile: Maya Chen", exact: true }).click();
	await profile.waitFor();
	await page.screenshot({ path: join(output, "channel-profile.png"), animations: "disabled" });
	await page.keyboard.press("Escape");
	await profile.waitFor({ state: "detached" });
	await page.locator(".wp-message header").getByRole("button", { name: "Maya Chen", exact: true }).click();
	await page.getByRole("region", { name: "Conversation with Maya Chen", exact: true }).waitFor();
	await page.getByRole("button", { name: "# Engineering", exact: true }).click();
	await page.getByRole("button", { name: "# Platform", exact: true }).click();
	await page.getByRole("heading", { name: "You're previewing # Platform", exact: true }).waitFor();
	assert.equal(await page.getByRole("textbox", { name: "Post to channel", exact: true }).count(), 0);
	await page.evaluate(() => {
		window.refuseMembership = true;
	});
	await page.getByRole("button", { name: "Join channel", exact: true }).click();
	await page.getByRole("alert").filter({ hasText: "Membership change refused by fixture." }).waitFor();
	assert.equal(await page.getByRole("textbox", { name: "Post to channel", exact: true }).count(), 0);
	await page.getByRole("button", { name: "Join channel", exact: true }).click();
	await page.getByRole("textbox", { name: "Post to channel", exact: true }).waitFor();
	await page.getByRole("textbox", { name: "Post to channel", exact: true }).fill("Joined and ready.");
	await page.keyboard.press("Shift+Enter");
	assert.equal(
		await page.getByRole("textbox", { name: "Post to channel", exact: true }).inputValue(),
		"Joined and ready.\n",
	);
	await page.keyboard.press("Enter");
	await page.getByText("Joined and ready.", { exact: true }).waitFor();
	await page.screenshot({ path: join(output, "channel-joined.png"), animations: "disabled" });
	await page.getByLabel("Joined: channel membership", { exact: true }).click();
	await page.getByRole("button", { name: "Leave channel", exact: true }).click();
	await page.getByRole("button", { name: "Join channel", exact: true }).waitFor();
	assert.equal(await page.getByRole("textbox", { name: "Post to channel", exact: true }).count(), 0);
	await page.screenshot({ path: join(output, "channel-preview.png"), animations: "disabled" });
	await page.getByRole("button", { name: /Mail/ }).click();
	await page.getByRole("button", { name: "Unread", exact: true }).click();
	assert.equal(await page.getByRole("button", { name: /Review complete: session-state tests/ }).count(), 0);
	await page.getByRole("button", { name: "Unread", exact: true }).click();
	await page.getByRole("button", { name: /API migration: one decision/ }).click();
	await page.getByRole("textbox", { name: "Reply to everyone", exact: true }).waitFor();
	await page.screenshot({ path: join(output, "mail-dark.png"), animations: "disabled" });
	await theme.click();
	await page.screenshot({ path: join(output, "mail-light.png"), animations: "disabled" });
	await theme.click();
	await page.getByRole("textbox", { name: "Reply to everyone", exact: true }).fill("Confirmed. Add the warning now.");
	await page.getByRole("button", { name: /^Send reply/ }).click();
	await page.waitForFunction(() => window.calls.some((call) => call[0] === "reply" && call[1] === "mail-1"));
	await page.getByText("Confirmed. Add the warning now.", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Compose", exact: true }).click();
	await page.getByRole("textbox", { name: "Mail body", exact: true }).fill("Please summarize the release checks.");
	await page.getByRole("button", { name: "Send mail", exact: true }).click();
	await page.getByText("Mail applied.", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Close new message", exact: true }).click();
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	await page.evaluate(() => {
		const world = window.fixtureWorld;
		const maya = world.characters.find((person) => person.id === "maya");
		maya.name = "Maya Chen-Sullivan";
		Object.assign(maya.facts, { run: "idle", status: "idle", tool: null, unseen: true, needsYouSince: Date.now() });
		window.updateWorld({ ...world });
	});
	for (const appearance of ["light", "dark"]) {
		if (((await theme.getAttribute("aria-pressed")) === "true") !== (appearance === "dark")) await theme.click();
		const unread = page.locator('.wp-dm[data-unread="true"]');
		const dot = await unread.locator(".wp-unread-dot").boundingBox();
		const name = await unread.locator("strong").boundingBox();
		assert.ok(dot && name);
		assert.equal(dot.width, dot.height);
		assert.ok(dot.width > 0 && dot.height <= name.height);
		await page.screenshot({ path: join(output, `chat-unread-${appearance}.png`), animations: "disabled" });
	}
	await page.evaluate(() => window.updateWorld({ connected: false, headquarters: [], characters: [] }));
	await page.getByText("Disconnected · last known state", { exact: true }).waitFor();
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify({ ok: true, screenshots: output, calls: await page.evaluate(() => window.calls) }, null, 2),
	);
} finally {
	await browser.close();
}
