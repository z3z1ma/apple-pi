import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { openIntegrations } from "../../src/backend/integrations/index.js";
import type { OutsideWriteEntry } from "../../src/integrations.js";
import { type FakeServer, fakeServer, type Seen } from "./fakes.js";

// Seam 1 for the town square and the crier: the backend API against a fake Slack Web API.
const TOKEN = "xoxc-1111-2222-3333-secret";
const COOKIE = "xoxd-cookie%2Fsecret";
const stateDir = mkdtempSync(join(tmpdir(), "aw-slack-state-"));
let slack: FakeServer;
let api: ReturnType<typeof openIntegrations>;
const announced: OutsideWriteEntry[] = [];

const form = (request: Seen) => new URLSearchParams(request.body);
const calls = (method: string) => slack.seen.filter((request) => request.path === `/api/${method}`);

// 40 channels with unread messages beyond the named ones, to show the counting stays bounded.
const crowd = Array.from({ length: 40 }, (_, index) => ({
	id: `CX${index}`,
	last_read: "1700000000.000000",
	latest: `17000001${String(index).padStart(2, "0")}.000000`,
	mention_count: 0,
	has_unreads: true,
}));

beforeAll(async () => {
	slack = await fakeServer();
	const ok = (json: object) => ({ json: { ok: true, ...json } });
	slack.route((request) => {
		const params = form(request);
		// Every call carries the web client's token and the d cookie.
		if (params.get("token") !== TOKEN || request.headers.cookie !== `d=${COOKIE}`)
			return { json: { ok: false, error: "invalid_auth" } };
		switch (request.path) {
			case "/api/auth.test":
				return ok({ url: "https://acme.slack.com/", team: "Acme", user: "operator", team_id: "T1", user_id: "U0" });
			case "/api/client.counts":
				return ok({
					channels: [
						{
							id: "C1",
							last_read: "1700000000.000100",
							latest: "1700000500.000000",
							mention_count: 2,
							has_unreads: true,
						},
						{
							id: "C2",
							last_read: "1700000000.000200",
							latest: "1700000900.000000",
							mention_count: 0,
							has_unreads: true,
						},
						{
							id: "C3",
							last_read: "1700000900.000000",
							latest: "1700000900.000000",
							mention_count: 0,
							has_unreads: false,
						},
						...crowd,
					],
					mpims: [],
					ims: [
						{
							id: "D1",
							last_read: "1700000000.000000",
							latest: "1700000700.000000",
							mention_count: 1,
							has_unreads: true,
						},
					],
				});
			case "/api/users.conversations":
				return ok({
					channels: [
						{ id: "C1", name: "deploys", is_channel: true, is_private: false },
						{ id: "C2", name: "team-secret", is_channel: true, is_private: true },
						{ id: "C3", name: "random", is_channel: true },
						{ id: "D1", is_im: true, user: "U2" },
						...crowd.map((channel, index) => ({ id: channel.id, name: `crowd-${index}`, is_channel: true })),
					],
					response_metadata: { next_cursor: "" },
				});
			case "/api/conversations.list":
				return ok({
					channels: [
						{ id: "C1", name: "deploys", is_channel: true },
						{ id: "C9", name: "releases", is_channel: true },
						{ id: "C8", name: "release-train", is_channel: true },
					],
					response_metadata: { next_cursor: "" },
				});
			case "/api/conversations.history": {
				const channel = params.get("channel");
				if (channel === "C1" && params.get("oldest") === "1700000000.000100")
					return ok({ messages: [{ ts: "1" }, { ts: "2" }, { ts: "3" }], has_more: false });
				if (channel === "C2")
					return ok({ messages: Array.from({ length: 100 }, (_, i) => ({ ts: `${i}` })), has_more: true });
				if (channel === "C9")
					return ok({
						messages: [
							{
								ts: "1700000002.000000",
								user: "U1",
								text: "Shipped <@U2>!",
								reply_count: 2,
								thread_ts: "1700000002.000000",
							},
							{ ts: "1700000001.000000", user: "U2", text: "Ready to ship &amp; tag" },
						],
					});
				return ok({ messages: [{ ts: "1" }], has_more: false });
			}
			case "/api/conversations.info":
				return ok({ channel: { id: params.get("channel"), name: params.get("channel") === "C9" ? "releases" : "x" } });
			case "/api/conversations.replies":
				return ok({
					messages: [
						{
							ts: "1700000002.000000",
							thread_ts: "1700000002.000000",
							user: "U1",
							text: "Shipped <@U2>!",
							reply_count: 1,
						},
						{ ts: "1700000003.000000", thread_ts: "1700000002.000000", user: "U2", text: "Thanks <#C1|deploys>" },
					],
				});
			case "/api/users.info": {
				const names: Record<string, string> = { U1: "Ann", U2: "Ben" };
				const user = params.get("user") ?? "";
				return ok({ user: { id: user, name: user.toLowerCase(), profile: { display_name: names[user] ?? "" } } });
			}
			case "/api/chat.postMessage":
				return ok({ channel: params.get("channel"), ts: "1700000004.000000" });
		}
		return { json: { ok: false, error: "unknown_method" } };
	});
	api = openIntegrations({
		stateDir,
		snapshot: () => ({ connected: true, headquarters: [], characters: [] }),
		commands: { send: async () => ({ ok: false, reason: "no runtime in this test" }), close() {} },
		slackApi: `${slack.url}/api/`,
	});
	api.onOutsideWrite((entry) => announced.push(entry));
});
afterAll(async () => {
	api.close();
	await slack.close();
	rmSync(stateDir, { recursive: true, force: true });
});

test("before sign-in, Slack asks for it", async () => {
	expect(await api.slackUnread()).toMatchObject({ ok: false, signIn: "slack" });
});

test("a captured session is checked with auth.test and kept; the status names only the workspace", async () => {
	expect(await api.storeSlackSession({ token: TOKEN, cookie: "xoxd-wrong" })).toMatchObject({ ok: false });
	expect(api.credentialStatus().slack).toBeNull();
	expect(await api.storeSlackSession({ token: TOKEN, cookie: COOKIE })).toEqual({ ok: true, team: "Acme" });
	expect(api.credentialStatus().slack).toEqual({ team: "Acme", url: "https://acme.slack.com/", user: "operator" });
});

test("the square lists channels with unread messages, most pressing first, counting a bounded number", async () => {
	slack.seen.length = 0;
	const unread = await api.slackUnread();
	expect(unread.ok).toBe(true);
	if (!unread.ok) return;
	const named = unread.channels.filter((channel) => !channel.id.startsWith("CX"));
	expect(
		named.map((channel) => [channel.id, channel.name, channel.kind, channel.unread, channel.more, channel.mentions]),
	).toEqual([
		["C1", "deploys", "channel", 3, false, 2],
		["D1", "Ben", "dm", 1, false, 1],
		["C2", "team-secret", "private", 100, true, 0],
	]);
	// The read channel is not in the square; every unread one is, but history is counted for at most 30.
	expect(unread.channels.some((channel) => channel.id === "C3")).toBe(false);
	expect(unread.channels.length).toBe(43);
	expect(calls("conversations.history").length).toBeLessThanOrEqual(30);
	expect(unread.channels.filter((channel) => channel.unread === null).length).toBe(43 - 30);
	expect(unread.channels[0].url).toBe("https://acme.slack.com/archives/C1");
});

test("the crier finds a channel with no unread messages and opens it with names", async () => {
	const found = await api.slackFindChannels("releas");
	expect(found.ok && found.channels.map((channel) => channel.name)).toEqual(["releases", "release-train"]);
	const opened = await api.slackChannel("C9");
	expect(opened.ok).toBe(true);
	if (!opened.ok) return;
	expect(opened.thread.channel).toEqual({ id: "C9", name: "releases" });
	expect(opened.thread.messages.map((message) => [message.name, message.text, message.replies])).toEqual([
		["Ben", "Ready to ship & tag", 0],
		["Ann", "Shipped @Ben!", 2],
	]);
});

test("a thread reads with names, the parent first", async () => {
	const thread = await api.slackThread("C9", "1700000002.000000");
	expect(thread.ok && thread.thread.messages.map((message) => `${message.name}: ${message.text}`)).toEqual([
		"Ann: Shipped @Ben!",
		"Ben: Thanks #deploys",
	]);
	expect(thread.ok && thread.thread.url).toBe("https://acme.slack.com/archives/C9/p1700000002000000");
});

test("a thread reply posts only with its confirmation, then is recorded and announced", async () => {
	const reply = { kind: "slack-reply", channel: "C9", threadTs: "1700000002.000000", text: "On it." } as const;
	const described = await api.describeWrite(reply);
	expect(described).toMatchObject({
		ok: true,
		description: {
			what: "Reply in a Slack thread",
			where: "#releases, in Ann's thread: Shipped @Ben!",
			text: "On it.",
		},
	});
	if (!described.ok) return;
	expect(await api.confirmWrite(reply, "forged")).toMatchObject({ ok: false });
	expect(await api.confirmWrite({ ...reply, text: "Something else." }, described.token)).toMatchObject({ ok: false });
	expect(calls("chat.postMessage")).toEqual([]);

	const sent = await api.confirmWrite(reply, described.token);
	expect(sent).toMatchObject({ ok: true, entry: { line: "You replied in #releases: On it." } });
	const posts = calls("chat.postMessage").map((request) => Object.fromEntries(form(request)));
	expect(posts).toEqual([{ token: TOKEN, channel: "C9", thread_ts: "1700000002.000000", text: "On it." }]);
	const record = readFileSync(join(stateDir, "agent-world-outside-writes.jsonl"), "utf8").trim().split("\n");
	expect(JSON.parse(record.at(-1)!)).toMatchObject({ kind: "slack-reply", text: "On it.", ok: true });
	expect(announced.map((entry) => entry.line)).toEqual(["You replied in #releases: On it."]);
});

test("a revoked session asks to sign in again", async () => {
	slack.route((request) =>
		request.path === "/api/client.counts" ? { json: { ok: false, error: "token_revoked" } } : undefined,
	);
	expect(await api.slackUnread()).toMatchObject({ ok: false, signIn: "slack" });
});
