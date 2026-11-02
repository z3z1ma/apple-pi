import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { integrationFiles, openCredentials } from "../../../apps/agent-world/src/backend/integrations/credentials.js";
import { type ExternalThreads, externalAddress } from "../src/external-threads.js";
import { statePaths } from "../src/paths.js";
import { Runtime } from "../src/runtime.js";
import { fakeBridge, query, sendCommand, standInProcess, tempStateDir } from "./helpers.js";

let state: ReturnType<typeof tempStateDir>;
let runtime: Runtime;
let routes: Record<string, any>;
let fixtures: string;
let bin: string;
const repo = "repos/acme/widget";
const url = "https://github.com/acme/widget/pull/7";
const thread = "github:acme/widget#7";
const old = "2020-01-01T00:00:00Z";
let stamp: string;
const poll = async () => {
	const external = (runtime as unknown as { external: ExternalThreads }).external;
	await vi.waitFor(() => expect((external as unknown as { polling: boolean }).polling).toBe(false), { timeout: 10000 });
	await external.poll();
};
const syncRoutes = () => writeFileSync(fixtures, JSON.stringify(routes));
const messages = () =>
	query<{ body: string }>(state.dbPath, "select body from thread_messages where thread_id = ? order by seq", thread);
const bodies = () =>
	messages()
		.map((row) => row.body)
		.join("\n");
const comment = (id: number, body: string, at = stamp, bot = false) => ({
	id,
	body,
	created_at: at,
	updated_at: at,
	user: { login: bot ? "helper[bot]" : "Ada", type: bot ? "Bot" : "User" },
	html_url: `${url}#comment-${id}`,
});
const check = (id: number, conclusion: string, at = stamp) => ({
	id,
	name: "unit",
	status: "completed",
	conclusion,
	completed_at: at,
	html_url: `${url}/checks/${id}`,
});
const owned: Awaited<ReturnType<typeof fakeBridge>>[] = [];
const processes: ReturnType<typeof standInProcess>[] = [];

beforeEach(async () => {
	state = tempStateDir();
	fixtures = join(state.agentDir, "github.json");
	bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	for (const [name, fixture] of [
		["gh", "external-gh.mjs"],
		["pi", "external-pi.mjs"],
	]) {
		const path = join(bin, name);
		writeFileSync(
			path,
			`#!${process.execPath}\n${readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8")}`,
		);
		chmodSync(path, 0o755);
	}
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("EXTERNAL_FIXTURES", fixtures);
	vi.stubEnv("EXTERNAL_REQUESTS", join(state.agentDir, "requests"));
	vi.stubEnv("EXTERNAL_LAUNCHES", join(state.agentDir, "launches"));
	vi.stubEnv("EXTERNAL_MAIL", join(state.agentDir, "mail"));
	stamp = new Date(Date.now() + 2000).toISOString();
	routes = {
		[repo]: { default_branch: "main" },
		[`${repo}/issues/7`]: { number: 7, title: "Fix widgets", html_url: url, pull_request: {}, created_at: old },
		[`${repo}/pulls/7`]: {
			number: 7,
			title: "Fix widgets",
			html_url: url,
			state: "open",
			head: { sha: "abc" },
			created_at: old,
		},
		[`${repo}/issues/7/comments`]: [],
		[`${repo}/issues/7/events`]: [],
		[`${repo}/pulls/7/reviews`]: [],
		[`${repo}/pulls/7/comments`]: [],
		[`${repo}/commits/abc/check-runs`]: { check_runs: [] },
		[`${repo}/commits/main/check-runs`]: { check_runs: [] },
		[`${repo}/issues`]: [],
	};
	syncRoutes();
	runtime = new Runtime(statePaths());
	expect(await runtime.start()).toBe(true);
});
afterEach(() => {
	for (const link of owned.splice(0)) link.socket.destroy();
	for (const stand of processes.splice(0)) stand.child.kill();
	runtime.stop();
	rmSync(state.agentDir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

async function person(id = "reader", facts: Record<string, unknown> = {}, home = false) {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { cwd: state.agentDir },
		facts,
	});
	owned.push(link);
	await vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1));
	if (home) {
		link.send({ type: "shutdown", reason: "quit" });
		link.socket.end();
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from incarnations where session_id = ? and ended_at is not null", id),
			).toHaveLength(1),
		);
		stand.child.kill();
	}
	return link;
}
async function follow(id = "reader") {
	const result = await sendCommand(state.socketPath, id, { kind: "external", action: "follow", url });
	expect(result.at(-1)).toEqual({ stage: "applied" });
}

// Runtime publication is the assertion boundary: source data and every recipient's ordinary mail outbox.
test("first follow creates push membership without backfill; review comments and failures wake an on-call follower", async () => {
	await person("reader", { onCall: true }, true);
	routes[`${repo}/issues/7/comments`] = [comment(1, "Old discussion", old)];
	syncRoutes();
	await follow();
	await poll();
	expect(messages()).toHaveLength(0);
	expect(
		query(
			state.dbPath,
			"select delivery from thread_participants where thread_id = ? and participant = 'reader'",
			thread,
		),
	).toEqual([{ delivery: "push" }]);
	routes[`${repo}/pulls/7/comments`] = [comment(2, "Please handle the empty input")];
	routes[`${repo}/commits/abc/check-runs`] = { check_runs: [check(3, "failure")] };
	syncRoutes();
	await poll();
	expect(messages()).toHaveLength(1);
	expect(bodies()).toContain("Please handle the empty input");
	expect(bodies()).toContain("unit: failure");
	await vi.waitFor(
		() => {
			expect(readFileSync(join(state.agentDir, "mail"), "utf8")).toContain("Please handle the empty input");
			expect(readFileSync(join(state.agentDir, "mail"), "utf8")).toContain("unit: failure");
		},
		{ timeout: 10000 },
	);
	expect(readFileSync(join(state.agentDir, "launches"), "utf8").trim().split("\n")).toEqual(["reader"]);
});

test("only completed failures and the first recovery are pushed, across polls", async () => {
	await person();
	await follow();
	routes[`${repo}/commits/abc/check-runs`] = {
		check_runs: [check(1, "success"), { ...check(2, "failure"), status: "in_progress" }],
	};
	syncRoutes();
	await poll();
	expect(messages()).toHaveLength(0);
	routes[`${repo}/commits/abc/check-runs`] = { check_runs: [check(1, "success"), check(2, "failure")] };
	syncRoutes();
	await poll();
	expect(bodies()).toContain("unit: failure");
	await poll();
	expect(messages()).toHaveLength(1);
	routes[`${repo}/commits/abc/check-runs`] = {
		check_runs: [
			check(1, "success"),
			check(2, "failure"),
			check(3, "success", new Date(Date.parse(stamp) + 1000).toISOString()),
		],
	};
	syncRoutes();
	await poll();
	expect(bodies()).toContain("recovered (success)");
	await poll();
	expect(messages()).toHaveLength(2);
	routes[`${repo}/commits/abc/check-runs`].check_runs.push(
		check(4, "success", new Date(Date.parse(stamp) + 2000).toISOString()),
	);
	syncRoutes();
	await poll();
	expect(messages()).toHaveLength(2);
});

test("bot text is filtered but bot CI survives, and source policy can ignore GitHub", async () => {
	await person();
	await follow();
	routes[`${repo}/issues/7/comments`] = [comment(1, "human comment"), comment(2, "bot noise", stamp, true)];
	routes[`${repo}/commits/abc/check-runs`] = {
		check_runs: [{ ...check(3, "failure"), user: { login: "checks[bot]", type: "Bot" } }],
	};
	syncRoutes();
	await poll();
	expect(bodies()).toContain("human comment");
	expect(bodies()).not.toContain("bot noise");
	expect(bodies()).toContain("unit: failure");
	const db = new DatabaseSync(state.dbPath);
	db.prepare("update external_policies set policy = 'ignore' where provider = 'github'").run();
	db.close();
	routes[`${repo}/issues/7/comments`].push(comment(4, "ignored source"));
	syncRoutes();
	await poll();
	expect(bodies()).not.toContain("ignored source");
});

test("restart retains event cursors without duplicate posts; unfollow stops polling", async () => {
	await person();
	await follow();
	routes[`${repo}/issues/7/comments`] = [comment(1, "new comment")];
	syncRoutes();
	await poll();
	expect(messages()).toHaveLength(1);
	runtime.stop();
	runtime = new Runtime(statePaths());
	expect(await runtime.start()).toBe(true);
	await poll();
	expect(messages()).toHaveLength(1);
	const result = await sendCommand(state.socketPath, "reader", { kind: "external", action: "unfollow", url });
	expect(result.at(-1)).toEqual({ stage: "applied" });
	routes[`${repo}/issues/7/comments`].push(comment(2, "after unfollow"));
	syncRoutes();
	await poll();
	expect(messages()).toHaveLength(1);
});

test("missing or unauthenticated gh records one clear event and leaves the runtime usable", async () => {
	await person();
	await follow();
	vi.stubEnv("PATH", "");
	await poll();
	await poll();
	expect(query(state.dbPath, "select data from events where type = 'external_poll_failed'")).toEqual([
		{ data: expect.stringContaining("install gh") },
	]);
	expect(
		(await sendCommand(state.socketPath, "operator", { kind: "set_preference", key: "test", value: true })).at(-1),
	).toEqual({ stage: "applied" });
	vi.stubEnv("PATH", bin);
	routes.error = "gh auth login";
	syncRoutes();
	await poll();
	await poll();
	expect(query(state.dbPath, "select data from events where type = 'external_poll_failed'")).toHaveLength(2);
});

test("repository candidates are batched to the desk, explicit subscriptions bypass desk, managers alone watch", async () => {
	await person("reader", { manages: false, role: "implementation-engineer" });
	expect(
		(await sendCommand(state.socketPath, "reader", { kind: "external", action: "watch", repo: "acme/widget" })).at(-1)
			?.stage,
	).toBe("failed");
	await person("desk", { onCall: true, manages: true });
	const result = await sendCommand(state.socketPath, "desk", {
		kind: "external",
		action: "watch",
		repo: "acme/widget",
	});
	expect(result.at(-1)).toEqual({ stage: "applied" });
	routes[`${repo}/issues`] = [
		{ ...comment(1, "new issue"), number: 8, title: "Widget issue" },
		{ ...comment(2, "new PR"), number: 9, title: "Widget PR", pull_request: {} },
	];
	syncRoutes();
	await poll();
	expect(query(state.dbPath, "select body from thread_messages where thread_id = 'external:desk:desk'")).toEqual([
		{ body: expect.stringContaining("Widget issue") },
	]);
	expect(
		query(state.dbPath, "select body from thread_messages where thread_id = 'external:desk:desk'")[0]!.body,
	).toContain("Widget PR");
	await poll();
	expect(query(state.dbPath, "select 1 from thread_messages where thread_id = 'external:desk:desk'")).toHaveLength(1);
	await sendCommand(state.socketPath, "desk", { kind: "external", action: "watch", repo: "acme/widget", events: [] });
	expect(query(state.dbPath, "select events from external_sources where id = 'repository:acme/widget'")).toEqual([
		{ events: "[]" },
	]);
});

test("a configured desk channel gets one explicit notification, while followed candidates go directly to their follower", async () => {
	await person("reader");
	await follow();
	await person("desk", { manages: true });
	const db = new DatabaseSync(state.dbPath);
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('desk-channel', 'channel', 'Desk', 'desk', ?)",
	).run(Date.now());
	db.prepare("insert into preferences (key, value, updated_at) values ('desk', ?, ?)").run(
		JSON.stringify({ thread: "desk-channel", person: "desk" }),
		Date.now(),
	);
	db.close();
	await sendCommand(state.socketPath, "desk", { kind: "external", action: "watch", repo: "acme/widget" });
	routes[`${repo}/issues`] = [
		{ ...comment(1, "followed"), number: 7, title: "Fix widgets", pull_request: {} },
		{ ...comment(2, "unfollowed"), number: 8, title: "New work" },
	];
	syncRoutes();
	await poll();
	const desk = query<{ body: string }>(
		state.dbPath,
		"select body from thread_messages where thread_id = 'desk-channel'",
	);
	expect(desk).toHaveLength(1);
	expect(desk[0]!.body).toContain("New work");
	expect(desk[0]!.body).not.toContain("Fix widgets");
	expect(
		query(
			state.dbPath,
			"select session_id from commands where kind = 'mail' and json_extract(command, '$.thread') = 'desk-channel'",
		),
	).toEqual([{ session_id: "desk" }]);
});

test("failed publication rolls back event consumption and retries the whole batch", async () => {
	await person();
	await follow();
	const db = new DatabaseSync(state.dbPath);
	db.prepare("update threads set closed_at = ? where id = ?").run(Date.now(), thread);
	routes[`${repo}/issues/7/comments`] = [comment(1, "retry this")];
	syncRoutes();
	await poll();
	expect(messages()).toHaveLength(0);
	db.prepare("update threads set closed_at = null where id = ?").run(thread);
	db.close();
	await poll();
	expect(bodies()).toContain("retry this");
});

test("a committed follow whose terminal receipt was lost is not replayed over a later unfollow", async () => {
	await person();
	await sendCommand(
		state.socketPath,
		"reader",
		{ kind: "external", action: "follow", url },
		{ commandId: "first-follow" },
	);
	await sendCommand(state.socketPath, "reader", { kind: "external", action: "unfollow", url });
	const db = new DatabaseSync(state.dbPath);
	db.prepare("update commands set stage = 'accepted' where command_id = 'first-follow'").run();
	db.close();
	runtime.stop();
	runtime = new Runtime(statePaths());
	expect(await runtime.start()).toBe(true);
	await vi.waitFor(() =>
		expect(query(state.dbPath, "select stage from commands where command_id = 'first-follow'")).toEqual([
			{ stage: "applied" },
		]),
	);
	expect(
		query(state.dbPath, "select 1 from thread_participants where thread_id = ? and participant = 'reader'", thread),
	).toHaveLength(0);
});

test("Jira reuses the private Atlassian sign-in, batches changes and paged comments, and refuses a switched site", async () => {
	await person();
	const credentialFile = integrationFiles(state.stateDir).credentials;
	openCredentials(credentialFile).set("atlassian", {
		site: "https://acme.atlassian.net",
		email: "reader@example.test",
		token: "test-private-token",
	});
	let changed = false;
	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		expect(String(input)).toMatch(/^https:\/\/acme\.atlassian\.net\//);
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			`Basic ${Buffer.from("reader@example.test:test-private-token").toString("base64")}`,
		);
		const path = new URL(String(input));
		let value: unknown = {
			fields: {
				summary: "Jira work",
				status: { name: changed ? "In Review" : "Open" },
				updated: changed ? stamp : old,
			},
		};
		if (path.pathname.endsWith("/changelog"))
			value = {
				values: changed
					? [
							{
								id: "c-1",
								created: stamp,
								author: { displayName: "Ada" },
								items: [{ field: "status", fromString: "Open", toString: "In Review" }],
							},
						]
					: [],
				isLast: true,
			};
		if (path.pathname.endsWith("/comment")) {
			const start = Number(path.searchParams.get("startAt"));
			value = {
				total: 2,
				comments: [
					{
						id: String(start + 1),
						updated: changed && start === 1 ? stamp : old,
						author: { displayName: "Ada" },
						body: { type: "doc", content: [{ type: "text", text: start ? "new discussion" : "old discussion" }] },
					},
				],
			};
		}
		return new Response(JSON.stringify(value));
	});
	vi.stubGlobal("fetch", fetchMock);
	expect(
		(await sendCommand(state.socketPath, "reader", { kind: "external", action: "follow", url: "ABC-123" })).at(-1),
	).toEqual({ stage: "applied" });
	await poll();
	expect(query(state.dbPath, "select body from thread_messages where thread_id = 'jira:ABC-123'")).toHaveLength(0);
	changed = true;
	await poll();
	const posts = query<{ body: string }>(
		state.dbPath,
		"select body from thread_messages where thread_id = 'jira:ABC-123'",
	);
	expect(posts).toHaveLength(1);
	expect(posts[0]!.body).toContain("Open -> In Review");
	expect(posts[0]!.body).toContain("new discussion");
	expect(posts[0]!.body).not.toContain("old discussion");
	await poll();
	expect(query(state.dbPath, "select 1 from thread_messages where thread_id = 'jira:ABC-123'")).toHaveLength(1);
	openCredentials(credentialFile).set("atlassian", {
		site: "https://other.atlassian.net",
		email: "reader@example.test",
		token: "other",
	});
	const calls = fetchMock.mock.calls.length;
	await poll();
	expect(fetchMock.mock.calls.length).toBe(calls);
	expect(query(state.dbPath, "select data from events where type = 'external_poll_failed'")).toEqual([
		{ data: expect.stringContaining("another Atlassian site") },
	]);
	expect(JSON.stringify(query(state.dbPath, "select body from thread_messages"))).not.toContain("test-private-token");
});

test("the daemon imports its external poller under native Node type stripping", () => {
	expect(() =>
		execFileSync(
			process.execPath,
			[
				"--import",
				new URL("../src/register.mjs", import.meta.url).href,
				"--input-type=module",
				"-e",
				`await import(${JSON.stringify(new URL("../src/runtime.ts", import.meta.url).href)})`,
			],
			{ timeout: 10000 },
		),
	).not.toThrow();
});

test("addresses are canonical and reject arbitrary hosts and invalid repository paths", () => {
	expect(externalAddress("https://github.com/Acme/Widget/pull/7#discussion").id).toBe(thread);
	expect(externalAddress("ABC-123").id).toBe("jira:ABC-123");
	expect(() => externalAddress("https://evil.test/acme/widget/pull/7")).toThrow();
	expect(() => externalAddress("https://github.com/../../pull/7")).toThrow();
});
