// The outside-write gate (decision 13): every write outside as the operator (a pull request review, a Jira comment or
// transition, a Slack reply) goes through `write`, and only with the token `describe` gave for that same intent after
// the UI showed its description. Without it nothing is sent. Each sent write appends one JSON line to the private,
// append-only local record and is announced to the chatbox, whether it succeeded or failed.
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
	DescribedWrite,
	Outcome,
	OutsideWriteEntry,
	OutsideWriteIntent,
	WriteDescription,
	WriteResult,
} from "../../integrations.js";

/** How long a description stays good for confirming. */
const TOKEN_TTL_MS = 15 * 60_000;
/** Longest text one write may carry. */
const TEXT_MAX = 30_000;
/** Entries `recent` returns. */
const RECENT_MAX = 100;
const PREVIEW = 100;

/** The intent as given over IPC, checked and trimmed of anything else; a reason when it is not one. */
export function checkIntent(given: unknown): OutsideWriteIntent | string {
	const value = (given ?? {}) as Record<string, unknown>;
	const words = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : undefined);
	const long = (text: string | undefined) => text !== undefined && text.length > TEXT_MAX;
	switch (value.kind) {
		case "github-review": {
			const { repo, number, event } = value;
			const body = words("body") ?? "";
			if (typeof repo !== "string" || !Number.isSafeInteger(number)) return "That is not a pull request.";
			if (event !== "comment" && event !== "approve" && event !== "request-changes") return "That is not a review.";
			if (event !== "approve" && !body.trim()) return "Write what to say first.";
			if (long(body)) return "That is too long to send from here.";
			return { kind: "github-review", repo, number: number as number, event, body };
		}
		case "jira-comment": {
			const key = words("key");
			const body = words("body");
			if (!key) return "That is not a Jira issue.";
			if (!body?.trim()) return "Write what to say first.";
			if (long(body)) return "That is too long to send from here.";
			return { kind: "jira-comment", key, body };
		}
		case "jira-transition": {
			const key = words("key");
			const transition = words("transition");
			if (!key || !transition) return "That is not a move Jira offers.";
			return { kind: "jira-transition", key, transition };
		}
		case "slack-reply": {
			const channel = words("channel");
			const threadTs = words("threadTs");
			const text = words("text");
			if (!channel || !threadTs) return "That is not a Slack thread.";
			if (!text?.trim()) return "Write what to say first.";
			if (long(text)) return "That is too long to send from here.";
			return { kind: "slack-reply", channel, threadTs, text };
		}
		case "slack-mark-read": {
			const channel = words("channel");
			const ts = words("ts");
			const threadTs = words("threadTs");
			if (!channel || !ts || (value.threadTs !== undefined && !threadTs)) return "That is not a Slack channel.";
			return { kind: "slack-mark-read", channel, ts, ...(threadTs ? { threadTs } : {}) };
		}
	}
	return "Agent World does not write that.";
}

/** One string per intent, the same for the same write whatever order its keys came in. */
const canonical = (intent: OutsideWriteIntent) =>
	JSON.stringify(Object.fromEntries(Object.entries(intent).sort(([a], [b]) => a.localeCompare(b))));

const preview = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}\u2026` : flat;
};

/** The chatbox line for a write: what the operator did, or that it failed. */
export function writeLine(intent: OutsideWriteIntent, description: WriteDescription, failed?: string): string {
	const said = description.text ? `: ${preview(description.text)}` : "";
	switch (intent.kind) {
		case "github-review": {
			const ref = `${intent.repo}#${intent.number}`;
			if (failed) {
				const what = { approve: "approval of", comment: "comment on", "request-changes": "change request on" }[
					intent.event
				];
				return `Your ${what} ${ref} failed: ${failed}`;
			}
			if (intent.event === "approve") return `You approved ${ref}${said}.`;
			if (intent.event === "comment") return `You commented on ${ref}${said}`;
			return `You requested changes on ${ref}${said}`;
		}
		case "jira-comment":
			return failed ? `Your comment on ${intent.key} failed: ${failed}` : `You commented on ${intent.key}${said}`;
		case "jira-transition":
			return failed ? `Moving ${intent.key} failed: ${failed}` : `You moved ${intent.key}${said}.`;
		case "slack-reply": {
			const where = description.where.split(",")[0];
			return failed ? `Your reply in ${where} failed: ${failed}` : `You replied in ${where}${said}`;
		}
		case "slack-mark-read": {
			// `#releases`, or `#releases, in Ann's thread` for a thread: said as "Ann's thread in #releases".
			const [place, thread] = description.where.split(", in ");
			const what = thread ? `${thread} in ${place}` : place;
			return failed ? `Marking ${what} read failed: ${failed}` : `You marked ${what} read in Slack.`;
		}
	}
}

/**
 * Writes the operator asks for with a button that says exactly what it does (Mark read), which change nothing anyone
 * else reads: sent without the confirmation, but recorded and announced like every other.
 */
const UNCONFIRMED = new Set<OutsideWriteIntent["kind"]>(["slack-mark-read"]);

export interface GateAdapters {
	/** What the confirmation shows for an intent, or why it cannot be done (looked up outside where needed). */
	describe(intent: OutsideWriteIntent): Promise<Outcome<{ description: WriteDescription }>>;
	/** Send it; the address it can be seen at when known. */
	send(intent: OutsideWriteIntent): Promise<Outcome<{ url?: string | null }>>;
}

export interface Gate {
	describe(intent: unknown): Promise<DescribedWrite>;
	write(intent: unknown, token: unknown): Promise<WriteResult>;
	/** Send a write that needs no confirmation (`UNCONFIRMED`); refuses every other. */
	act(intent: unknown): Promise<WriteResult>;
	recent(): OutsideWriteEntry[];
	onWrite(listener: (entry: OutsideWriteEntry) => void): () => void;
}

export function openGate(recordFile: string, adapters: GateAdapters, now: () => number = Date.now): Gate {
	const waiting = new Map<string, { key: string; description: WriteDescription; until: number }>();
	const listeners = new Set<(entry: OutsideWriteEntry) => void>();

	const record = (entry: OutsideWriteEntry) => {
		mkdirSync(dirname(recordFile), { recursive: true, mode: 0o700 });
		const fresh = !existsSync(recordFile);
		appendFileSync(recordFile, `${JSON.stringify({ ...entry, at: new Date(entry.at).toISOString() })}\n`, {
			mode: 0o600,
		});
		if (fresh) chmodSync(recordFile, 0o600);
		for (const listener of listeners) listener(entry);
	};

	/** Send a write as described, then record and announce it, sent or failed. */
	const send = async (intent: OutsideWriteIntent, description: WriteDescription): Promise<WriteResult> => {
		const sent = await adapters.send(intent);
		const { what, where, text } = description;
		const entry: OutsideWriteEntry = {
			at: now(),
			kind: intent.kind,
			what,
			where,
			text,
			url: (sent.ok ? sent.url : undefined) ?? description.url,
			ok: sent.ok,
			...(sent.ok ? {} : { reason: sent.reason }),
			line: writeLine(intent, description, sent.ok ? undefined : sent.reason),
		};
		record(entry);
		return sent.ok ? { ok: true, entry } : sent;
	};

	return {
		async describe(given) {
			const intent = checkIntent(given);
			if (typeof intent === "string") return { ok: false, reason: intent };
			const described = await adapters.describe(intent);
			if (!described.ok) return described;
			for (const [token, held] of waiting) if (held.until <= now()) waiting.delete(token);
			const token = randomUUID();
			waiting.set(token, { key: canonical(intent), description: described.description, until: now() + TOKEN_TTL_MS });
			return { ok: true, token, description: described.description };
		},

		async write(given, token) {
			const intent = checkIntent(given);
			if (typeof intent === "string") return { ok: false, reason: intent };
			const held = typeof token === "string" ? waiting.get(token) : undefined;
			if (!held || held.key !== canonical(intent) || held.until <= now())
				return { ok: false, reason: "That was not confirmed as shown, so nothing was sent." };
			waiting.delete(token as string);
			return send(intent, held.description);
		},

		async act(given) {
			const intent = checkIntent(given);
			if (typeof intent === "string") return { ok: false, reason: intent };
			if (!UNCONFIRMED.has(intent.kind))
				return { ok: false, reason: "That needs your confirmation, so nothing was sent." };
			const described = await adapters.describe(intent);
			if (!described.ok) return described;
			return send(intent, described.description);
		},

		recent() {
			if (!existsSync(recordFile)) return [];
			return readFileSync(recordFile, "utf8")
				.split("\n")
				.filter(Boolean)
				.slice(-RECENT_MAX)
				.flatMap((line) => {
					try {
						const entry = JSON.parse(line) as OutsideWriteEntry & { at: string | number };
						return [{ ...entry, at: typeof entry.at === "string" ? Date.parse(entry.at) : entry.at }];
					} catch {
						return [];
					}
				});
		},

		onWrite(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
