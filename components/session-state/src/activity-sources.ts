import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { atlassianRequest } from "../../../apps/agent-workplace/src/backend/integrations/atlassian.js";
import type {
	AtlassianCredentials,
	SlackCredentials,
} from "../../../apps/agent-workplace/src/backend/integrations/credentials.js";
import { adfText } from "../../../apps/agent-workplace/src/backend/integrations/jira.js";
import type { ActivityItem } from "./activity.js";

const exec = promisify(execFile);

const FIRST_LOOK_MS = 24 * 3_600_000;
const EXCERPT_MAX = 280;

export interface SourceRead {
	items: ActivityItem[];
	cursor: string;
}

const excerpt = (text: string | undefined | null) => {
	const flat = (text ?? "").replace(/\s+/g, " ").trim();
	return flat ? (flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}\u2026` : flat) : null;
};

interface Notification {
	id: string;
	reason: string;
	updated_at: string;
	subject: { title: string; url: string | null; latest_comment_url: string | null; type: string };
	repository: { full_name: string };
}

const GITHUB_DIRECT = new Set(["mention", "team_mention", "review_requested", "assign"]);

async function gh(path: string, signal: AbortSignal): Promise<any> {
	try {
		const { stdout } = await exec("gh", ["api", "--method", "GET", path], {
			signal,
			timeout: 30_000,
			maxBuffer: 64 * 1024 * 1024,
		});
		return JSON.parse(stdout);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			throw new Error("GitHub needs gh: install it and sign in with gh auth login.");
		if (/gh auth login|not logged in|HTTP 401/i.test(String((error as { stderr?: string }).stderr)))
			throw new Error("GitHub is signed out: run gh auth login.");
		throw new Error(`GitHub request failed: ${path.split("?")[0]}`);
	}
}

const githubPage = (api: string | null, repo: string) =>
	api
		? api.replace("https://api.github.com/repos/", "https://github.com/").replace(/\/pulls\/(\d+)$/, "/pull/$1")
		: `https://github.com/${repo}`;

export async function readGitHub(cursor: string | undefined, now: number, signal: AbortSignal): Promise<SourceRead> {
	const since = cursor ?? new Date(now - FIRST_LOOK_MS).toISOString();
	const notifications = (await gh(
		`notifications?all=true&per_page=50&since=${encodeURIComponent(since)}`,
		signal,
	)) as Notification[];
	const items: ActivityItem[] = [];
	let newest = since;
	for (const note of notifications) {
		if (note.updated_at > newest) newest = note.updated_at;
		const repo = note.repository.full_name;
		const number = note.subject.url?.match(/\/(\d+)$/)?.[1];
		const conversation = number ? `github:${repo}#${number}` : `github:${repo}:${note.id}`;
		let actor: string | null = null;
		let said: string | null = null;

		if (cursor && note.subject.latest_comment_url && note.subject.latest_comment_url !== note.subject.url) {
			const comment = await gh(note.subject.latest_comment_url.replace("https://api.github.com/", ""), signal).catch(
				() => undefined,
			);
			actor = comment?.user?.login ?? null;
			said = excerpt(comment?.body);
		}
		items.push({
			id: `github:${note.id}:${Date.parse(note.updated_at)}`,
			source: "github",
			kind: note.reason,
			conversation,
			title: `${repo}${number ? `#${number}` : ""} ${note.subject.title}`,
			actor,
			url: githubPage(note.subject.url, repo),
			excerpt: said,
			at: Date.parse(note.updated_at),
			direct: GITHUB_DIRECT.has(note.reason),
		});
	}
	return { items, cursor: newest };
}

interface JiraIssue {
	key: string;
	fields: {
		summary: string;
		updated: string;
		comment?: {
			comments: { id: string; author?: { accountId: string; displayName: string }; body: unknown; created: string }[];
		};
	};
	changelog?: {
		histories: {
			id: string;
			author?: { accountId: string; displayName: string };
			created: string;
			items: { field: string; to?: string | null; toString?: string | null }[];
		}[];
	};
}

export async function readJira(
	credentials: AtlassianCredentials | undefined,
	cursor: string | undefined,
	now: number,
	signal: AbortSignal,
): Promise<SourceRead> {
	if (!credentials) throw new Error("Jira is not signed in: connect Atlassian in Workplace Settings.");
	const request = async (path: string) => {
		const result = await atlassianRequest(credentials, path, {
			fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) }),
		});
		if (!result.ok) throw new Error("Jira read failed: check the Atlassian sign-in in Workplace Settings.");
		return result.json as any;
	};
	const me = (await request("/rest/api/3/myself")).accountId as string;
	const since = cursor ? Number(cursor) : now - FIRST_LOOK_MS;
	const minutes = Math.ceil((now - since) / 60_000) + 1;
	const jql = `(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -${minutes}m ORDER BY updated DESC`;
	const found = await request(
		`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,updated,comment&expand=changelog`,
	);
	const items: ActivityItem[] = [];
	let newest = since;
	const page = (key: string) => `${credentials.site}/browse/${key}`;
	for (const issue of (found.issues ?? []) as JiraIssue[]) {
		const title = `${issue.key} ${issue.fields.summary}`;
		for (const comment of issue.fields.comment?.comments ?? []) {
			const at = Date.parse(comment.created);
			if (at <= since || comment.author?.accountId === me) continue;
			newest = Math.max(newest, at);
			const mentioned = JSON.stringify(comment.body).includes(me);
			items.push({
				id: `jira:${issue.key}:comment:${comment.id}`,
				source: "jira",
				kind: mentioned ? "mention" : "comment",
				conversation: `jira:${issue.key}`,
				title,
				actor: comment.author?.displayName ?? null,
				url: `${page(issue.key)}?focusedCommentId=${comment.id}`,
				excerpt: excerpt(adfText(comment.body)),
				at,
				direct: mentioned,
			});
		}
		for (const history of issue.changelog?.histories ?? []) {
			const at = Date.parse(history.created);
			if (at <= since || history.author?.accountId === me) continue;
			newest = Math.max(newest, at);
			const assigned = history.items.some((item) => item.field === "assignee" && item.to === me);
			const status = history.items.find((item) => item.field === "status");
			items.push({
				id: `jira:${issue.key}:change:${history.id}`,
				source: "jira",
				kind: assigned ? "assigned" : status ? "status" : "changed",
				conversation: `jira:${issue.key}`,
				title,
				actor: history.author?.displayName ?? null,
				url: page(issue.key),
				excerpt: excerpt(
					history.items.map((item) => `${item.field}: ${item.toString ?? item.to ?? "cleared"}`).join("; "),
				),
				at,
				direct: assigned,
			});
		}
	}
	return { items, cursor: String(newest) };
}

const SLACK_TYPES =
	"thread_v2,message_reaction,at_user,at_user_group,at_channel,at_everyone,keyword,list_record_assigned,list_user_mentioned,external_channel_invite";
const SLACK_KINDS: Record<string, { kind: string; direct: boolean }> = {
	at_user: { kind: "mention", direct: true },
	at_user_group: { kind: "group_mention", direct: true },
	at_channel: { kind: "channel_mention", direct: false },
	at_everyone: { kind: "channel_mention", direct: false },
	keyword: { kind: "keyword", direct: true },
	thread_v2: { kind: "reply", direct: true },
	message_reaction: { kind: "reaction", direct: false },
	list_record_assigned: { kind: "assigned", direct: true },
	list_user_mentioned: { kind: "mention", direct: true },
	external_channel_invite: { kind: "invite", direct: true },
};

interface FeedItem {
	feed_ts: string;
	key: string;
	item: {
		type: string;
		message?: { ts: string; channel: string; thread_ts?: string; author_user_id?: string };
		reaction?: { user: string; name: string };
		bundle_info?: {
			payload?: {
				thread_entry?: { channel_id: string; latest_ts: string; thread_ts: string };
				message?: { ts: string; channel: string };
			};
		};
	};
}

const tsMs = (ts: string) => Math.round(Number(ts) * 1000);

export async function readSlack(
	credentials: SlackCredentials | undefined,
	cursor: string | undefined,
	now: number,
	signal: AbortSignal,
): Promise<SourceRead> {
	if (!credentials) throw new Error("Slack is not signed in: sign in to Slack in Workplace Settings.");
	const base = credentials.url ? `${credentials.url.replace(/\/?$/, "/")}` : "https://slack.com/";
	const call = async (method: string, params: Record<string, string>) => {
		const response = await fetch(`${base}api/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `d=${credentials.cookie}` },
			body: new URLSearchParams({ token: credentials.token, ...params }).toString(),
			signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
		});
		if (response.status === 429) throw new Error("Slack asks to slow down.");
		const json = (await response.json()) as any;
		if (json.ok !== true) {
			if (["invalid_auth", "not_authed", "token_revoked", "token_expired"].includes(json.error))
				throw new Error("Slack signed you out: sign in again in Workplace Settings.");
			throw new Error(`Slack said ${json.error ?? response.status} to ${method}.`);
		}
		return json;
	};
	const previous = (() => {
		try {
			return cursor ? (JSON.parse(cursor) as { feed: string; dm: string }) : undefined;
		} catch {
			return undefined;
		}
	})();
	const floor = String((now - FIRST_LOOK_MS) / 1000);
	const feedSince = previous?.feed ?? floor;
	const dmSince = previous?.dm ?? floor;
	const me = (await call("auth.test", {})).user_id as string;
	const people = new Map<string, string>();
	const places = new Map<string, string>();
	const person = async (id: string | undefined) => {
		if (!id) return null;
		if (!people.has(id)) {
			const user = await call("users.info", { user: id }).catch(() => undefined);
			people.set(id, user?.user?.profile?.display_name || user?.user?.real_name || user?.user?.name || id);
		}
		return people.get(id)!;
	};
	const place = async (id: string) => {
		if (!places.has(id)) {
			const info = await call("conversations.info", { channel: id }).catch(() => undefined);
			const channel = info?.channel;
			places.set(
				id,
				channel?.is_im
					? `DM with ${await person(channel.user)}`
					: channel?.is_mpim
						? "Group DM"
						: channel?.name
							? `#${channel.name}`
							: id,
			);
		}
		return places.get(id)!;
	};
	const message = async (channel: string, ts: string, thread?: string) => {
		const found = thread
			? await call("conversations.replies", { channel, ts: thread, oldest: ts, inclusive: "true", limit: "1" })
			: await call("conversations.history", { channel, latest: ts, inclusive: "true", limit: "1" });
		return (found.messages ?? []).find((item: { ts: string }) => item.ts === ts) as
			| { ts: string; user?: string; text?: string; thread_ts?: string }
			| undefined;
	};

	const readable = async (text: string | undefined) => {
		if (!text) return text;
		let out = text;
		for (const [whole, id] of text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g))
			out = out.replace(whole, `@${await person(id)}`);
		for (const [whole, id, name] of text.matchAll(/<#(C[A-Z0-9]+)(?:\|([^>]*))?>/g))
			out = out.replace(whole, name ? `#${name}` : await place(id!));
		return out
			.replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (_whole, name) => name || "@group")
			.replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
			.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
			.replace(/<(https?:[^>]+)>/g, "$1")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&");
	};
	const link = (channel: string, ts: string, thread?: string) =>
		`${base}archives/${channel}/p${ts.replace(".", "")}${thread && thread !== ts ? `?thread_ts=${thread}&cid=${channel}` : ""}`;

	const items: ActivityItem[] = [];
	let feedNewest = feedSince;
	const feed = await call("activity.feed", { limit: "50", mode: "chrono_reads_and_unreads", types: SLACK_TYPES });
	for (const entry of (feed.items ?? []) as FeedItem[]) {
		if (Number(entry.feed_ts) <= Number(feedSince)) continue;
		if (Number(entry.feed_ts) > Number(feedNewest)) feedNewest = entry.feed_ts;
		const shape = SLACK_KINDS[entry.item.type] ?? { kind: entry.item.type, direct: false };
		const entryThread = entry.item.bundle_info?.payload?.thread_entry;
		const direct = entry.item.message ?? entry.item.bundle_info?.payload?.message;
		const target: { channel: string; ts: string; thread?: string; author?: string } | undefined = entryThread
			? { channel: entryThread.channel_id, ts: entryThread.latest_ts, thread: entryThread.thread_ts }
			: direct
				? {
						channel: direct.channel,
						ts: direct.ts,
						thread: entry.item.message?.thread_ts,
						author: entry.item.message?.author_user_id,
					}
				: undefined;
		if (!target) continue;
		const said = await message(target.channel, target.ts, target.thread).catch(() => undefined);
		const where = await place(target.channel);
		const actor =
			entry.item.type === "message_reaction"
				? await person(entry.item.reaction?.user)
				: await person(said?.user ?? target.author);
		items.push({
			id: `slack:${entry.key}:${entry.feed_ts}`,
			source: "slack",
			kind: shape.kind,
			conversation: `slack:${target.channel}:${target.thread ?? target.ts}`,
			title:
				entry.item.type === "message_reaction" ? `${where}: :${entry.item.reaction?.name}: on your message` : where,
			actor,
			url: link(target.channel, target.ts, target.thread),
			excerpt: excerpt(await readable(said?.text)),
			at: tsMs(entry.feed_ts),
			direct: shape.direct,
		});
	}

	let dmNewest = dmSince;
	const counts = await call("client.counts", {});
	for (const conversation of [...(counts.ims ?? []), ...(counts.mpims ?? [])] as {
		id: string;
		last_read: string;
		latest: string;
	}[]) {
		if (Number(conversation.latest) <= Number(dmSince)) continue;
		const oldest = String(Math.max(Number(dmSince), Number(conversation.last_read)));
		const history = await call("conversations.history", { channel: conversation.id, oldest, limit: "20" });
		const where = await place(conversation.id);
		for (const said of (history.messages ?? []) as {
			ts: string;
			user?: string;
			text?: string;
			subtype?: string;
			bot_id?: string;
		}[]) {
			if (Number(said.ts) > Number(dmNewest)) dmNewest = said.ts;
			if (said.user === me || (said.subtype && said.subtype !== "bot_message")) continue;
			const app = Boolean(said.bot_id);
			items.push({
				id: `slack:dm:${conversation.id}:${said.ts}`,
				source: "slack",
				kind: app ? "bot_dm" : "dm",
				conversation: `slack:${conversation.id}`,
				title: where,
				actor: await person(said.user),
				url: link(conversation.id, said.ts),
				excerpt: excerpt(await readable(said.text)),
				at: tsMs(said.ts),
				direct: !app,
			});
		}
	}
	return { items, cursor: JSON.stringify({ feed: feedNewest, dm: dmNewest }) };
}

async function gws(args: string[], params: Record<string, unknown>, signal: AbortSignal): Promise<any[]> {
	try {
		const { stdout } = await exec("gws", [...args, "--params", JSON.stringify(params)], {
			signal,
			timeout: 30_000,
			maxBuffer: 64 * 1024 * 1024,
		});

		return stdout.trim().startsWith("{") && !args.includes("--page-all")
			? [JSON.parse(stdout)]
			: stdout
					.split("\n")
					.filter((line) => line.trim())
					.map((line) => JSON.parse(line));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			throw new Error("Google needs the gws CLI: install it and sign in with gws auth login.");
		if (/auth|credential|token|login/i.test(String((error as { stderr?: string }).stderr)))
			throw new Error("Google is signed out: run gws auth login.");
		throw new Error(`Google request failed: gws ${args.join(" ")}`);
	}
}

interface CalendarEvent {
	id: string;
	status: string;
	summary?: string;
	description?: string;
	htmlLink?: string;
	hangoutLink?: string;
	updated: string;
	created?: string;
	recurringEventId?: string;
	recurrence?: string[];
	originalStartTime?: { dateTime?: string; date?: string };
	start?: { dateTime?: string; date?: string };
	organizer?: { self?: boolean; displayName?: string; email?: string };
	creator?: { displayName?: string; email?: string };
	attendees?: { self?: boolean; responseStatus?: string; email?: string; displayName?: string }[];
	attachments?: { title?: string }[];
}

const fingerprint = (event: CalendarEvent, mine: string | undefined) =>
	createHash("sha256")
		.update(
			JSON.stringify([
				event.status,
				event.summary,
				event.start,
				event.recurrence,
				event.description,
				mine,
				(event.attachments ?? []).map((file) => file.title),
			]),
		)
		.digest("hex")
		.slice(0, 16);
const startOf = (event: CalendarEvent) => Date.parse(event.start?.dateTime ?? event.start?.date ?? "");
const attending = (event: CalendarEvent) =>
	event.organizer?.self ||
	["accepted", "tentative"].includes(event.attendees?.find((who) => who.self)?.responseStatus ?? "");

const AGENDA_HOUR = 6;

const STARTING_SOON_MS = 60 * 60_000;

export async function readCalendar(cursor: string | undefined, now: number, signal: AbortSignal): Promise<SourceRead> {
	const previous = (() => {
		try {
			return cursor ? (JSON.parse(cursor) as { updated?: string; agenda?: string }) : {};
		} catch {
			return {};
		}
	})();
	let agenda = previous.agenda;
	const since = previous.updated ?? new Date(now - FIRST_LOOK_MS).toISOString();

	const pages = await gws(
		["calendar", "events", "list", "--page-all", "--page-limit", "20"],
		{ calendarId: "primary", updatedMin: since, singleEvents: false, showDeleted: true, maxResults: 250 },
		signal,
	);
	const sinceMs = Date.parse(since);
	const items: ActivityItem[] = [];
	let newest = since;
	const summary = (event: CalendarEvent) => {
		const people = (event.attendees ?? []).filter((who) => !who.self).length;
		const files = (event.attachments ?? []).map((file) => file.title).filter(Boolean);
		return excerpt(
			[
				event.start?.dateTime
					? new Date(event.start.dateTime).toLocaleString("en-US", {
							weekday: "short",
							month: "short",
							day: "numeric",
							hour: "numeric",
							minute: "2-digit",
						})
					: event.start?.date,
				people ? `${people} ${people === 1 ? "other" : "others"}` : "",
				files.length ? `docs: ${files.join(", ")}` : "",
				event.description?.replace(/<[^>]+>/g, " "),
			]
				.filter(Boolean)
				.join(" \u00b7 "),
		);
	};
	for (const event of pages.flatMap((page) => (page.items ?? []) as CalendarEvent[])) {
		if (event.updated > newest) newest = event.updated;
		const when = Date.parse(event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? "") || startOf(event);

		if (!event.recurrence && when < now) continue;
		const mine = event.attendees?.find((who) => who.self)?.responseStatus;
		if (mine === "declined") continue;

		if (!event.summary || (event.recurringEventId && mine === "needsAction")) continue;
		const fresh = Date.parse(event.created ?? "") > sinceMs;

		if (!cursor && event.status !== "cancelled" && !(mine === "needsAction" && fresh)) continue;
		const kind =
			event.status === "cancelled"
				? "cancelled"
				: mine === "needsAction" && fresh && !event.organizer?.self
					? "invited"
					: "changed";
		items.push({
			id: `calendar:${event.id}:${fingerprint(event, mine)}`,
			source: "calendar",
			kind,
			conversation: `calendar:${event.recurringEventId ?? event.id}`,
			title: event.summary ?? "(no title)",
			actor: event.organizer?.self ? null : (event.organizer?.displayName ?? event.organizer?.email ?? null),
			url: event.htmlLink ?? null,
			excerpt: summary(event),
			at: Date.parse(event.updated),
			direct: kind === "invited" || (kind === "cancelled" && mine === "accepted"),
		});
	}
	const [soon] = await gws(
		["calendar", "events", "list"],
		{
			calendarId: "primary",
			timeMin: new Date(now).toISOString(),
			timeMax: new Date(now + STARTING_SOON_MS).toISOString(),
			singleEvents: true,
			orderBy: "startTime",
		},
		signal,
	);
	for (const event of (soon?.items ?? []) as CalendarEvent[]) {
		if (event.status === "cancelled" || !attending(event) || !event.start?.dateTime) continue;
		items.push({
			id: `calendar:soon:${event.id}:${startOf(event)}`,
			source: "calendar",
			kind: "starting_soon",
			conversation: `calendar:${event.recurringEventId ?? event.id}`,
			title: event.summary ?? "(no title)",
			actor: event.organizer?.self ? null : (event.organizer?.displayName ?? event.organizer?.email ?? null),
			url: event.hangoutLink ?? event.htmlLink ?? null,
			excerpt: summary(event),
			at: now,
			direct: true,
		});
	}

	const day = new Date(now);
	const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
	if (day.getHours() >= AGENDA_HOUR && previous.agenda !== today) {
		const end = new Date(day);
		end.setHours(23, 59, 59, 999);
		const [list] = await gws(
			["calendar", "events", "list"],
			{
				calendarId: "primary",
				timeMin: new Date(now).toISOString(),
				timeMax: end.toISOString(),
				singleEvents: true,
				orderBy: "startTime",
			},
			signal,
		);
		const meetings = ((list?.items ?? []) as CalendarEvent[]).filter(
			(event) => event.status !== "cancelled" && event.start?.dateTime && attending(event),
		);
		const time = (event: CalendarEvent) =>
			new Date(startOf(event)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
		items.push({
			id: `calendar:agenda:${today}`,
			source: "calendar",
			kind: "agenda",
			conversation: `calendar:agenda:${today}`,
			title: `Today: ${meetings.length} ${meetings.length === 1 ? "meeting" : "meetings"}`,
			actor: null,
			url: null,
			excerpt: excerpt(meetings.map((event) => `${time(event)} ${event.summary}`).join("; ")),
			at: now,
			direct: true,
		});
		agenda = today;
	}
	return { items, cursor: JSON.stringify({ updated: newest, agenda }) };
}

const GMAIL_QUERY =
	"in:inbox -from:me -category:promotions -category:social -category:forums " +
	"-from:(notifications@github.com OR noreply OR no-reply OR donotreply OR do-not-reply OR calendar-notification@google.com OR atlassian.net OR slack.com) " +
	'-subject:("Invitation:" OR "Updated invitation" OR "Canceled event" OR "Accepted:" OR "Declined:" OR "Tentatively accepted")';

export async function readGmail(cursor: string | undefined, now: number, signal: AbortSignal): Promise<SourceRead> {
	const since = cursor ? Number(cursor) : now - FIRST_LOOK_MS;
	const [profile] = await gws(["gmail", "users", "getProfile"], { userId: "me" }, signal);
	const me = String(profile?.emailAddress ?? "").toLowerCase();
	const [listed] = await gws(
		["gmail", "users", "messages", "list"],
		{ userId: "me", q: `${GMAIL_QUERY} after:${Math.floor(since / 1000)}`, maxResults: 50 },
		signal,
	);
	const items: ActivityItem[] = [];
	let newest = since;
	for (const { id } of (listed?.messages ?? []) as { id: string }[]) {
		const [message] = await gws(
			["gmail", "users", "messages", "get"],
			{ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Subject", "List-Id"] },
			signal,
		);
		if (!message) continue;
		const at = Number(message.internalDate);
		if (at <= since) continue;
		newest = Math.max(newest, at);
		const header = Object.fromEntries(
			((message.payload?.headers ?? []) as { name: string; value: string }[]).map((entry) => [
				entry.name.toLowerCase(),
				entry.value,
			]),
		);
		const automated = Boolean(header["list-id"]) || (message.labelIds ?? []).includes("CATEGORY_UPDATES");
		const toMe = String(header.to ?? "")
			.toLowerCase()
			.includes(me);
		items.push({
			id: `gmail:${id}`,
			source: "gmail",
			kind: automated ? "notification" : toMe ? "email" : "cc",
			conversation: `gmail:${message.threadId}`,
			title: header.subject ?? "(no subject)",
			actor:
				String(header.from ?? "")
					.replace(/\s*<[^>]+>$/, "")
					.replace(/^"|"$/g, "") || null,
			url: `https://mail.google.com/mail/u/0/#all/${message.threadId}`,
			excerpt: excerpt(message.snippet),
			at,
			direct: !automated && toMe,
		});
	}
	return { items, cursor: String(newest) };
}
