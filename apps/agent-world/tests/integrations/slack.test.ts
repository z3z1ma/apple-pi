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

// Slack's message search (`search.messages`, highlight on): a hit in a channel, in a direct message (whose
// `channel.name` is the other person's id), and a reply in a thread (its permalink names the thread); a second page.
const HL = (word: string) => `\ue000${word}\ue001`;
const LONG_TEXT = `${"Before the train leaves we check every box on the list. ".repeat(6)}The ${HL("release")} is tagged. ${"After that we wait for the mirrors to catch up and the notes to publish. ".repeat(6)}`;
function searchPage(page: number) {
	const match = (over: object) => ({ type: "message", iid: "x", team: "T1", ...over });
	const matches =
		page === 1
			? [
					match({
						channel: { id: "C1", name: "deploys", is_private: false, is_mpim: false },
						user: "U1",
						ts: "1700000300.000100",
						text: `The ${HL("release")} train left &amp; <@U2> waved`,
						permalink: "https://acme.slack.com/archives/C1/p1700000300000100",
					}),
					match({
						type: "im",
						channel: { id: "D1", name: "U2", is_private: true, is_mpim: false },
						user: "U2",
						ts: "1700000200.000100",
						text: LONG_TEXT,
						permalink: "https://acme.slack.com/archives/D1/p1700000200000100",
					}),
					match({
						channel: { id: "C9", name: "releases", is_private: false, is_mpim: false },
						user: "U1",
						ts: "1700000003.000000",
						text: `Thanks, ${HL("release")} notes are up`,
						permalink: "https://acme.slack.com/archives/C9/p1700000003000000?thread_ts=1700000002.000000&cid=C9",
					}),
				]
			: [
					match({
						channel: { id: "C3", name: "random", is_private: false, is_mpim: false },
						username: "deploybot",
						ts: "1700000100.000100",
						text: `${HL("release")} 2.3 out`,
						permalink: "https://acme.slack.com/archives/C3/p1700000100000100",
					}),
				];
	return { matches, total: 4, paging: { count: 3, total: 4, page, pages: 2 } };
}

/** A long channel: sixty messages a minute apart, `1700001001` to `1700001060`. */
const LONG_CHANNEL = Array.from({ length: 60 }, (_, i) => ({
	ts: `${1700001001 + i}.000000`,
	user: "U1",
	text: `Message ${i + 1}`,
}));
/** `conversations.history` over `LONG_CHANNEL`, newest first, as Slack answers within `oldest` and `latest`. */
function longHistory(params: URLSearchParams) {
	const inclusive = params.get("inclusive") === "true";
	const oldest = Number(params.get("oldest") ?? 0);
	const latest = Number(params.get("latest") ?? Number.POSITIVE_INFINITY);
	const limit = Number(params.get("limit") ?? 100);
	const inRange = LONG_CHANNEL.filter((message) => {
		const ts = Number(message.ts);
		return (inclusive ? ts >= oldest : ts > oldest) && (inclusive ? ts <= latest : ts < latest);
	});
	// With only `oldest`, Slack answers from `oldest` forward; otherwise the newest in range.
	const window = params.has("oldest") && !params.has("latest") ? inRange.slice(0, limit) : inRange.slice(-limit);
	return { messages: [...window].reverse(), has_more: inRange.length > limit };
}

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
				if (channel === "C7") return ok(longHistory(params));
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
				return ok({
					channel: {
						id: params.get("channel"),
						name: params.get("channel") === "C9" ? "releases" : "x",
						...(params.get("channel") === "C9" ? { last_read: "1700000001.000000" } : {}),
					},
				});
			case "/api/conversations.replies":
				return ok({
					messages: [
						{
							ts: "1700000002.000000",
							thread_ts: "1700000002.000000",
							user: "U1",
							text: "Shipped <@U2>!",
							reply_count: 1,
							last_read: "1700000002.000000",
						},
						{ ts: "1700000003.000000", thread_ts: "1700000002.000000", user: "U2", text: "Thanks <#C1|deploys>" },
					],
				});
			case "/api/users.info": {
				const names: Record<string, string> = { U1: "Ann", U2: "Ben" };
				const user = params.get("user") ?? "";
				return ok({ user: { id: user, name: user.toLowerCase(), profile: { display_name: names[user] ?? "" } } });
			}
			case "/api/search.messages":
				return ok({ query: params.get("query"), messages: searchPage(Number(params.get("page") ?? 1)) });
			case "/api/chat.postMessage":
				return ok({ channel: params.get("channel"), ts: "1700000004.000000" });
			case "/api/conversations.mark":
			case "/api/subscriptions.thread.mark":
				return ok({});
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
	const found = await api.slackSearch("releas");
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

test("a search finds messages in channels, direct messages, and threads, with sender, time, and the match marked", async () => {
	slack.seen.length = 0;
	const found = await api.slackSearch("release");
	expect(found.ok).toBe(true);
	if (!found.ok) return;
	// One message search, Slack's own (highlighted, paged), and the channels named like it from the full list.
	const searches = calls("search.messages").map((request) => Object.fromEntries(form(request)));
	expect(searches).toEqual([
		{ token: TOKEN, query: "release", count: "20", page: "1", highlight: "true", sort: "score", sort_dir: "desc" },
	]);
	expect(found.channels.map((channel) => channel.name)).toEqual(["releases", "release-train"]);
	expect([found.page, found.pages, found.total]).toEqual([1, 2, 4]);
	expect(
		found.hits.map((hit) => [
			hit.channel.id,
			hit.channel.name,
			hit.channel.kind,
			hit.ts,
			hit.threadTs,
			hit.name,
			hit.at,
		]),
	).toEqual([
		["C1", "deploys", "channel", "1700000300.000100", null, "Ann", 1700000300000],
		["D1", "Ben", "dm", "1700000200.000100", null, "Ben", 1700000200000],
		["C9", "releases", "channel", "1700000003.000000", "1700000002.000000", "Ann", 1700000003000],
	]);
	// The excerpt is plain text, the matched words marked; a long message is cut around its first match.
	expect(found.hits[0].excerpt).toEqual([
		{ text: "The ", match: false },
		{ text: "release", match: true },
		{ text: " train left & @Ben waved", match: false },
	]);
	const long = found.hits[1].excerpt;
	expect(long.find((part) => part.match)?.text).toBe("release");
	const shown = long.map((part) => part.text).join("");
	expect(shown.length).toBeLessThanOrEqual(260);
	expect(shown.startsWith("\u2026")).toBe(true);
	expect(shown.endsWith("\u2026")).toBe(true);
	expect(found.hits[2].url).toBe(
		"https://acme.slack.com/archives/C9/p1700000003000000?thread_ts=1700000002.000000&cid=C9",
	);

	// The next page: the next messages only; the channels came with the first.
	const next = await api.slackSearch("release", 2);
	expect(next.ok && [next.page, next.channels, next.hits.map((hit) => [hit.channel.name, hit.name])]).toEqual([
		2,
		[],
		[["random", "deploybot"]],
	]);
	expect(calls("search.messages").map((request) => form(request).get("page"))).toEqual(["1", "2"]);
	// Searching reads; it marks nothing read.
	expect(calls("conversations.mark")).toEqual([]);
});

test("every conversation the operator belongs to is listed, paging through users.conversations, with what is unread", async () => {
	slack.seen.length = 0;
	const pagesOf = [
		[
			{ id: "C1", name: "deploys", is_channel: true },
			{ id: "C2", name: "team-secret", is_channel: true, is_private: true },
		],
		[
			{ id: "C3", name: "random", is_channel: true },
			{ id: "G1", name: "mpdm-ann--ben--operator-1", is_mpim: true },
		],
		[
			{ id: "D1", is_im: true, user: "U2" },
			{ id: "D2", is_im: true, user: "U1" },
			{ id: "D3", is_im: true, user: "U3", is_user_deleted: true },
		],
	];
	slack.route((request) => {
		if (request.path !== "/api/users.conversations") return undefined;
		const cursor = form(request).get("cursor");
		const page = cursor ? Number(cursor.replace("page-", "")) : 0;
		return {
			json: {
				ok: true,
				channels: pagesOf[page],
				response_metadata: { next_cursor: page < pagesOf.length - 1 ? `page-${page + 1}` : "" },
			},
		};
	});
	const listed = await api.slackConversations();
	expect(listed.ok).toBe(true);
	if (!listed.ok) return;
	const asked = calls("users.conversations").map((request) => form(request));
	expect(asked.map((params) => params.get("cursor"))).toEqual([null, "page-1", "page-2"]);
	expect(asked[0].get("types")).toBe("public_channel,private_channel,mpim,im");
	// Every kind, channels first and then people, each by name (a person by name, a group by its other people; a
	// deleted person's conversation left out), each with what client.counts says is unread.
	expect(
		listed.channels.map((channel) => [channel.id, channel.name, channel.kind, channel.unreads, channel.mentions]),
	).toEqual([
		["C1", "deploys", "channel", true, 2],
		["C3", "random", "channel", false, 0],
		["C2", "team-secret", "private", true, 0],
		["D2", "Ann", "dm", false, 0],
		["G1", "ann, ben", "group", false, 0],
		["D1", "Ben", "dm", true, 1],
	]);
	expect(listed.channels.every((channel) => channel.unread === null)).toBe(true);
});

test("a channel opens at a message found by search, with the messages around it", async () => {
	// In the middle: the messages up to it and every one after it (there are few enough to show them all).
	const middle = await api.slackChannel("C7", "1700001020.000000");
	expect(middle.ok).toBe(true);
	if (!middle.ok) return;
	const texts = middle.thread.messages.map((message) => message.text);
	expect(texts[0]).toBe("Message 1");
	expect(texts.at(-1)).toBe("Message 60");
	expect(texts).toHaveLength(60);
	expect(texts).toContain("Message 20");
	expect(middle.thread.newer).toBe(false);
	// Early on, with more after it than one reading shows: up to it, saying newer ones follow (no gap is shown).
	const early = await api.slackChannel("C7", "1700001005.000000");
	expect(early.ok && early.thread.messages.map((message) => message.text)).toEqual([
		"Message 1",
		"Message 2",
		"Message 3",
		"Message 4",
		"Message 5",
	]);
	expect(early.ok && early.thread.newer).toBe(true);
	// Not a timestamp: refused, nothing read.
	expect(await api.slackChannel("C7", "soon")).toMatchObject({ ok: false });
});

/** Slack's methods that change what the operator has read. */
const READ_STATE = ["conversations.mark", "subscriptions.thread.mark"];
const markCalls = () => slack.seen.filter((request) => READ_STATE.some((method) => request.path === `/api/${method}`));

test("a channel and a thread open with where the operator last read them, and opening them marks nothing read", async () => {
	slack.seen.length = 0;
	// A channel in the unread listing: its last read from client.counts, without asking again.
	const unreadOne = await api.slackChannel("C1");
	expect(unreadOne.ok && unreadOne.thread.lastRead).toBe("1700000000.000100");
	expect(calls("conversations.info").filter((request) => form(request).get("channel") === "C1")).toEqual([]);
	// Any other channel: from conversations.info.
	const other = await api.slackChannel("C9");
	expect(other.ok && other.thread.lastRead).toBe("1700000001.000000");
	// A thread: its parent's last_read (Slack gives it for threads the operator follows).
	const thread = await api.slackThread("C9", "1700000002.000000");
	expect(thread.ok && thread.thread.lastRead).toBe("1700000002.000000");
	expect(markCalls()).toEqual([]);
});

test("Mark read marks a channel read up to its newest message as the operator, unconfirmed, recorded and announced", async () => {
	slack.seen.length = 0;
	announced.length = 0;
	const marked = await api.slackMarkRead("C9", "1700000002.000000");
	expect(marked).toMatchObject({
		ok: true,
		entry: { kind: "slack-mark-read", what: "Mark read in Slack", where: "#releases", ok: true },
	});
	expect(markCalls().map((request) => [request.path, Object.fromEntries(form(request))])).toEqual([
		["/api/conversations.mark", { token: TOKEN, channel: "C9", ts: "1700000002.000000" }],
	]);
	expect(announced.map((entry) => entry.line)).toEqual(["You marked #releases read in Slack."]);
	const record = readFileSync(join(stateDir, "agent-world-outside-writes.jsonl"), "utf8").trim().split("\n");
	expect(JSON.parse(record.at(-1)!)).toMatchObject({ kind: "slack-mark-read", where: "#releases", ok: true });
	// Reopened, the channel has nothing new.
	const reopened = await api.slackChannel("C9");
	expect(reopened.ok && reopened.thread.lastRead).toBe("1700000002.000000");
});

test("Mark read on a thread marks that thread read up to its newest reply", async () => {
	slack.seen.length = 0;
	announced.length = 0;
	const marked = await api.slackMarkRead("C9", "1700000003.000000", "1700000002.000000");
	expect(marked).toMatchObject({ ok: true, entry: { kind: "slack-mark-read", where: "#releases, in Ann's thread" } });
	expect(markCalls().map((request) => [request.path, Object.fromEntries(form(request))])).toEqual([
		[
			"/api/subscriptions.thread.mark",
			{ token: TOKEN, channel: "C9", thread_ts: "1700000002.000000", ts: "1700000003.000000", read: "1" },
		],
	]);
	expect(announced.map((entry) => entry.line)).toEqual(["You marked Ann's thread in #releases read in Slack."]);
});

test("Mark read refuses what is not a channel and a timestamp, and sends nothing", async () => {
	slack.seen.length = 0;
	expect(await api.slackMarkRead("C9; drop", "1700000002.000000")).toMatchObject({ ok: false });
	expect(await api.slackMarkRead("C9", "yesterday")).toMatchObject({ ok: false });
	expect(await api.slackMarkRead("C9", "1700000002.000000", "nope")).toMatchObject({ ok: false });
	expect(markCalls()).toEqual([]);
});

test("a revoked session asks to sign in again", async () => {
	slack.route((request) =>
		request.path === "/api/client.counts" ? { json: { ok: false, error: "token_revoked" } } : undefined,
	);
	expect(await api.slackUnread()).toMatchObject({ ok: false, signIn: "slack" });
});
