// The town square's Slack, as the operator (the credential decision in ticket 27): the web client's session token
// (`xoxc-`) in each form body plus its `d` cookie as a `Cookie` header, against the workspace's own `api/` address as
// the web client calls it. Unread channels come from `client.counts` (the web client's method), named from
// `users.conversations`, counted from `conversations.history` since each one's `last_read`; the crier searches
// `conversations.list`; threads read through `conversations.replies`; a reply posts with `chat.postMessage`, which
// only the outside-write gate calls, as it does `conversations.mark` and `subscriptions.thread.mark` (Mark read).
// Reading never marks anything read. Sources are cited in this file's context file.
import type { Outcome, Refusal, SlackChannel, SlackMessage, SlackThread } from "../../integrations.js";
import type { Fetch } from "./atlassian.js";
import type { SlackCredentials } from "./credentials.js";

const TIMEOUT_MS = 20_000;
/** Unread channels whose messages are counted on one listing; the rest show as unread, uncounted. */
export const COUNTED_MAX = 30;
/** Most messages counted per channel; beyond it `more` is set. */
const COUNT_LIMIT = 100;
const CHANNEL_MESSAGES = 50;
const THREAD_MESSAGES = 200;
const FOUND_MAX = 50;
/** How long the lists of channels are kept before they are read again. */
const LIST_TTL_MS = 10 * 60_000;
const SIGN_IN_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"]);

export const NOT_SIGNED_IN: Refusal = { ok: false, reason: "Sign in to Slack in Settings first.", signIn: "slack" };

type Answer = { ok: true; json: Record<string, unknown> } | Refusal;

interface ConversationRow {
	id: string;
	name?: string;
	user?: string;
	is_im?: boolean;
	is_mpim?: boolean;
	is_private?: boolean;
	is_group?: boolean;
}

interface CountRow {
	id: string;
	last_read?: string;
	latest?: string;
	mention_count?: number;
	has_unreads?: boolean;
}

interface MessageRow {
	ts: string;
	thread_ts?: string;
	user?: string;
	username?: string;
	bot_profile?: { name?: string };
	text?: string;
	reply_count?: number;
	/** On a thread's parent, for a thread the operator follows: the newest reply read. */
	last_read?: string;
}

export interface Slack {
	/** Check a captured session with `auth.test`: the workspace's name and address, and the operator's name. */
	check(session: {
		token: string;
		cookie: string;
	}): Promise<Outcome<{ team: string | null; url: string | null; user: string | null }>>;
	unread(): Promise<Outcome<{ channels: SlackChannel[] }>>;
	find(text: string): Promise<Outcome<{ channels: SlackChannel[] }>>;
	channel(id: string): Promise<Outcome<{ thread: SlackThread }>>;
	thread(id: string, ts: string): Promise<Outcome<{ thread: SlackThread }>>;
	/** A channel's name for descriptions (`#name`, or a person's name). */
	channelName(id: string): Promise<string>;
	/** A write: only the gate calls it. */
	reply(channel: string, threadTs: string, text: string): Promise<Outcome<{ url: string | null }>>;
	/** Mark a channel read up to `ts`, or with `threadTs` that thread; only the gate calls it. */
	markRead(channel: string, ts: string, threadTs?: string): Promise<Outcome<{ url: string | null }>>;
}

const ID = /^[A-Z0-9]+$/;
const TS = /^\d+\.\d+$/;

/** A message link in the workspace: `<url>archives/<channel>/p<ts without the dot>`. */
export function slackLink(base: string | null, channel: string, ts?: string): string | null {
	if (!base) return null;
	const root = base.endsWith("/") ? base : `${base}/`;
	return `${root}archives/${channel}${ts ? `/p${ts.replace(".", "")}` : ""}`;
}

export function openSlack(
	credentials: () => SlackCredentials | undefined,
	options: { api?: string; fetch?: Fetch; now?: () => number } = {},
): Slack {
	const now = options.now ?? Date.now;
	const users = new Map<string, string>();
	let members: { at: number; rows: ConversationRow[] } | undefined;
	let everything: { at: number; rows: ConversationRow[] } | undefined;
	const names = new Map<string, ConversationRow>();
	/** Where the operator last read each channel, as the last unread listing or Mark read left it. */
	const lastRead = new Map<string, string>();

	const call = async (
		method: string,
		params: Record<string, string>,
		session: { token: string; cookie: string; url?: string | null } | undefined = credentials(),
	): Promise<Answer> => {
		if (!session) return NOT_SIGNED_IN;
		const base = options.api ?? (session.url ? `${session.url.replace(/\/?$/, "/")}api/` : "https://slack.com/api/");
		let response: Response;
		try {
			response = await (options.fetch ?? fetch)(`${base}${method}`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `d=${session.cookie}` },
				body: new URLSearchParams({ token: session.token, ...params }).toString(),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			return { ok: false, reason: "Could not reach Slack." };
		}
		if (response.status === 429) return { ok: false, reason: "Slack asks to slow down; try again in a minute." };
		let json: Record<string, unknown>;
		try {
			json = (await response.json()) as Record<string, unknown>;
		} catch {
			return { ok: false, reason: `Slack answered ${response.status}.` };
		}
		if (json.ok === true) return { ok: true, json };
		const error = typeof json.error === "string" ? json.error : `status ${response.status}`;
		if (SIGN_IN_ERRORS.has(error))
			return { ok: false, reason: "Slack signed you out; sign in again in Settings.", signIn: "slack" };
		return { ok: false, reason: `Slack said ${error}.` };
	};

	/** Every page of a cursor-paged list method. */
	const pages = async (
		method: string,
		params: Record<string, string>,
	): Promise<Outcome<{ rows: ConversationRow[] }>> => {
		const rows: ConversationRow[] = [];
		let cursor = "";
		for (let page = 0; page < 50; page++) {
			const answer = await call(method, { ...params, limit: "1000", ...(cursor ? { cursor } : {}) });
			if (!answer.ok) return answer;
			rows.push(...((answer.json.channels as ConversationRow[] | undefined) ?? []));
			cursor = (answer.json.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "";
			if (!cursor) break;
		}
		for (const row of rows) names.set(row.id, row);
		return { ok: true, rows };
	};

	const memberRows = async () => {
		if (members && now() - members.at < LIST_TTL_MS) return { ok: true as const, rows: members.rows };
		const listed = await pages("users.conversations", {
			types: "public_channel,private_channel,mpim,im",
			exclude_archived: "true",
		});
		if (listed.ok) members = { at: now(), rows: listed.rows };
		return listed;
	};

	const userName = async (id: string): Promise<string> => {
		const known = users.get(id);
		if (known) return known;
		const answer = await call("users.info", { user: id });
		const user = answer.ok
			? (answer.json.user as { name?: string; real_name?: string; profile?: Record<string, string> })
			: undefined;
		const name = user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || id;
		if (answer.ok) users.set(id, name);
		return name;
	};

	const kindOf = (row: ConversationRow | undefined): SlackChannel["kind"] =>
		row?.is_im ? "dm" : row?.is_mpim ? "group" : row?.is_private || row?.is_group ? "private" : "channel";

	const nameOf = async (row: ConversationRow | undefined, id: string): Promise<string> => {
		if (row?.is_im && row.user) return userName(row.user);
		if (row?.name) return row.name;
		const answer = await call("conversations.info", { channel: id });
		const info = answer.ok ? (answer.json.channel as ConversationRow | undefined) : undefined;
		if (info) names.set(id, info);
		if (info?.is_im && info.user) return userName(info.user);
		return info?.name ?? id;
	};

	/** Slack's message markup as plain text: people, channels, and links by name; entities decoded. */
	const plain = async (text: string): Promise<string> => {
		const mentioned = [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]))];
		for (const id of mentioned) await userName(id);
		return text
			.replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_all, id: string) => `@${users.get(id) ?? id}`)
			.replace(/<#([A-Z0-9]+)\|([^>]*)>/g, (_all, id: string, name: string) => `#${name || names.get(id)?.name || id}`)
			.replace(/<!(here|channel|everyone)[^>]*>/g, "@$1")
			.replace(/<([^|>]+)\|([^>]+)>/g, "$2 ($1)")
			.replace(/<([^>]+)>/g, "$1")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&");
	};

	const messages = async (rows: MessageRow[]): Promise<SlackMessage[]> =>
		Promise.all(
			rows.map(async (row) => ({
				ts: row.ts,
				threadTs: row.thread_ts ?? null,
				user: row.user ?? null,
				name: row.user ? await userName(row.user) : (row.username ?? row.bot_profile?.name ?? "someone"),
				text: await plain(row.text ?? ""),
				replies: row.reply_count ?? 0,
				at: Math.round(Number(row.ts) * 1000),
			})),
		);

	const teamUrl = () => credentials()?.url ?? null;
	const badChannel: Refusal = { ok: false, reason: "That is not a Slack channel." };

	const slack: Slack = {
		async check(session) {
			const answer = await call("auth.test", {}, session);
			if (!answer.ok) return answer;
			const text = (key: string) => (typeof answer.json[key] === "string" ? (answer.json[key] as string) : null);
			return { ok: true, team: text("team"), url: text("url"), user: text("user") };
		},

		async unread() {
			const counts = await call("client.counts", {
				thread_counts_by_channel: "true",
				org_wide_aware: "true",
				include_file_channels: "true",
			});
			if (!counts.ok) return counts;
			const rows = [
				...((counts.json.channels as CountRow[] | undefined) ?? []),
				...((counts.json.mpims as CountRow[] | undefined) ?? []),
				...((counts.json.ims as CountRow[] | undefined) ?? []),
			];
			for (const row of rows) if (row.last_read) lastRead.set(row.id, row.last_read);
			const unreadRows = rows.filter((row) => row.has_unreads);
			unreadRows.sort(
				(a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0) || Number(b.latest ?? 0) - Number(a.latest ?? 0),
			);
			await memberRows(); // names and kinds, cached; a failure only leaves ids to look up one by one
			const channels = await Promise.all(
				unreadRows.map(async (row, index): Promise<SlackChannel> => {
					const known = names.get(row.id);
					let unread: number | null = null;
					let more = false;
					if (index < COUNTED_MAX) {
						const history = await call("conversations.history", {
							channel: row.id,
							limit: String(COUNT_LIMIT),
							...(row.last_read && row.last_read !== "0000000000.000000" ? { oldest: row.last_read } : {}),
						});
						if (history.ok) {
							unread = ((history.json.messages as unknown[] | undefined) ?? []).length;
							more = history.json.has_more === true;
						}
					}
					return {
						id: row.id,
						name: await nameOf(known, row.id),
						kind: kindOf(names.get(row.id)),
						unread,
						more,
						mentions: row.mention_count ?? 0,
						latest: row.latest ?? null,
						url: slackLink(teamUrl(), row.id),
					};
				}),
			);
			return { ok: true, channels };
		},

		async find(text) {
			const wanted = text.trim().replace(/^#/, "").toLowerCase();
			if (!wanted) return { ok: true, channels: [] };
			if (!everything || now() - everything.at >= LIST_TTL_MS) {
				const listed = await pages("conversations.list", {
					types: "public_channel,private_channel",
					exclude_archived: "true",
				});
				if (!listed.ok) return listed;
				everything = { at: now(), rows: listed.rows };
			}
			const mine = await memberRows();
			const rows = [
				...new Map([...everything.rows, ...(mine.ok ? mine.rows : [])].map((row) => [row.id, row])).values(),
			];
			const named = await Promise.all(
				rows.map(async (row) => ({
					row,
					name: row.is_im && row.user ? (users.get(row.user) ?? "") : (row.name ?? ""),
				})),
			);
			const matches = named
				.filter(({ name }) => name.toLowerCase().includes(wanted))
				.sort(
					(a, b) => Number(!a.name.toLowerCase().startsWith(wanted)) - Number(!b.name.toLowerCase().startsWith(wanted)),
				)
				.slice(0, FOUND_MAX);
			return {
				ok: true,
				channels: matches.map(({ row, name }) => ({
					id: row.id,
					name,
					kind: kindOf(row),
					unread: null,
					more: false,
					mentions: 0,
					latest: null,
					url: slackLink(teamUrl(), row.id),
				})),
			};
		},

		async channel(id) {
			if (!ID.test(id)) return badChannel;
			const history = await call("conversations.history", { channel: id, limit: String(CHANNEL_MESSAGES) });
			if (!history.ok) return history;
			const rows = [...((history.json.messages as MessageRow[] | undefined) ?? [])].reverse();
			// Where it was last read: as the unread listing said, else as conversations.info says (a read-only call).
			let read = lastRead.get(id);
			if (read === undefined) {
				const info = await call("conversations.info", { channel: id });
				const row = info.ok ? (info.json.channel as (ConversationRow & { last_read?: string }) | undefined) : undefined;
				if (row) names.set(id, { ...names.get(id), ...row });
				read = row?.last_read;
			}
			return {
				ok: true,
				thread: {
					channel: { id, name: await slack.channelName(id) },
					messages: await messages(rows),
					url: slackLink(teamUrl(), id),
					lastRead: read && read !== "0000000000.000000" ? read : null,
				},
			};
		},

		async thread(id, ts) {
			if (!ID.test(id) || !TS.test(ts)) return badChannel;
			const replies = await call("conversations.replies", { channel: id, ts, limit: String(THREAD_MESSAGES) });
			if (!replies.ok) return replies;
			const rows = (replies.json.messages as MessageRow[] | undefined) ?? [];
			return {
				ok: true,
				thread: {
					channel: { id, name: await slack.channelName(id) },
					messages: await messages(rows),
					url: slackLink(teamUrl(), id, ts),
					lastRead: rows.find((row) => row.ts === ts)?.last_read ?? null,
				},
			};
		},

		channelName: (id) => nameOf(names.get(id), id),

		async reply(channel, threadTs, text) {
			if (!ID.test(channel) || !TS.test(threadTs)) return badChannel;
			const posted = await call("chat.postMessage", { channel, thread_ts: threadTs, text });
			if (!posted.ok) return posted;
			const ts = typeof posted.json.ts === "string" ? posted.json.ts : undefined;
			return { ok: true, url: ts ? `${slackLink(teamUrl(), channel, ts)}?thread_ts=${threadTs}&cid=${channel}` : null };
		},

		async markRead(channel, ts, threadTs) {
			if (!ID.test(channel) || !TS.test(ts) || (threadTs !== undefined && !TS.test(threadTs))) return badChannel;
			// The web client's calls: a thread through its subscription, a channel through conversations.mark.
			const marked = threadTs
				? await call("subscriptions.thread.mark", { channel, thread_ts: threadTs, ts, read: "1" })
				: await call("conversations.mark", { channel, ts });
			if (!marked.ok) return marked;
			if (!threadTs) lastRead.set(channel, ts);
			return { ok: true, url: slackLink(teamUrl(), channel, threadTs) };
		},
	};
	return slack;
}
