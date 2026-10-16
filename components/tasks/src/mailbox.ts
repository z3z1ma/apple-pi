import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, type FSWatcher, mkdirSync, readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { MAILBOX_MESSAGE_CUSTOM_TYPE, type MailboxMessage } from "./types.js";

function mailboxDir(): string {
	return (
		process.env.PI_MAILBOX_DIR ||
		join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "state", "mailbox")
	);
}

function mailboxPath(sessionId: string): string {
	return join(mailboxDir(), `${sessionId}.jsonl`);
}

/** Pi's own rule for session ids (`assertValidSessionId`), which also keeps ids inside the mailbox directory. */
const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** One `appendFileSync` per message, so concurrent senders never interleave or need a lock. */
export function appendMailboxMessage(sessionId: string, from: string, body: string): MailboxMessage {
	if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid session id: ${sessionId}`);
	const message = { id: randomUUID(), from, ts: new Date().toISOString(), body };
	mkdirSync(mailboxDir(), { recursive: true });
	appendFileSync(mailboxPath(sessionId), `${JSON.stringify(message)}\n`);
	return message;
}

function isMailboxMessage(value: unknown): value is MailboxMessage {
	if (typeof value !== "object" || value === null) return false;
	const { id, from, ts, body } = value as Record<string, unknown>;
	return typeof id === "string" && typeof from === "string" && typeof ts === "string" && typeof body === "string";
}

/** Complete, well-formed lines only: a sender may be mid-append on the last one. */
function readMailbox(sessionId: string): MailboxMessage[] {
	const path = mailboxPath(sessionId);
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8").split("\n").slice(0, -1);
	return lines.flatMap((line) => {
		try {
			const value: unknown = JSON.parse(line);
			return isMailboxMessage(value) ? [value] : [];
		} catch {
			return [];
		}
	});
}

function formatMailboxMessage({ id, from, ts, body }: MailboxMessage): string {
	return `<mailbox-message id="${id}" from="${from}" ts="${ts}">\n${body}\n</mailbox-message>`;
}

/**
 * Ids sent as steers that Pi has not yet recorded, per session id. They live on `globalThis`
 * because Pi's queue survives an extension reload, and a fresh module copy must not resend
 * what that queue still holds.
 */
const RESERVATIONS_KEY = Symbol.for("apple-pi.mailbox.reservations");

function reserved(sessionId: string): Set<string> {
	const global = globalThis as Record<symbol, Map<string, Set<string>> | undefined>;
	const all = global[RESERVATIONS_KEY] ?? new Map<string, Set<string>>();
	global[RESERVATIONS_KEY] = all;
	let ids = all.get(sessionId);
	if (!ids) {
		ids = new Set();
		all.set(sessionId, ids);
	}
	return ids;
}

export function installMailbox(pi: ExtensionAPI): void {
	/**
	 * At process startup the host may submit its own prompt right after `session_start`, and a turn
	 * started here would make Pi reject it. So waiting mail rides the next run instead.
	 */
	const deliver = (ctx: ExtensionContext, atStartup = false) => {
		const sessionManager = ctx.sessionManager;
		const sessionId = sessionManager.getSessionId();
		const delivered = new Set(
			sessionManager
				.getEntries()
				.flatMap((entry) =>
					entry.type === "custom_message" && entry.customType === MAILBOX_MESSAGE_CUSTOM_TYPE
						? [(entry.details as MailboxMessage | undefined)?.id]
						: [],
				),
		);
		const queued = reserved(sessionId);
		for (const message of readMailbox(sessionId)) {
			if (delivered.has(message.id) || queued.has(message.id)) continue;
			queued.add(message.id);
			pi.sendMessage<MailboxMessage>(
				{
					customType: MAILBOX_MESSAGE_CUSTOM_TYPE,
					content: formatMailboxMessage(message),
					display: true,
					details: message,
				},
				atStartup ? { deliverAs: "nextTurn" } : { deliverAs: "steer", triggerTurn: true },
			);
		}
	};

	const report = (ctx: ExtensionContext, text: string) => {
		if (ctx.hasUI) ctx.ui.notify(text, "error");
		else console.error(text);
	};

	// The watcher only wakes the reader: notifications can coalesce or drop, and `deliver` always
	// compares the whole mailbox with the session's entries.
	let watcher: FSWatcher | undefined;
	let active: ExtensionContext | undefined;
	const closeWatcher = () => {
		watcher?.close();
		watcher = undefined;
	};
	const stop = () => {
		closeWatcher();
		active = undefined;
	};

	pi.on("session_start", (event, ctx) => {
		stop();
		active = ctx;
		const sessionId = ctx.sessionManager.getSessionId();
		// Any other start means a new agent session, whose queue holds none of the reserved steers.
		if (event.reason !== "reload") reserved(sessionId).clear();
		const file = `${sessionId}.jsonl`;
		const dir = mailboxDir();
		mkdirSync(dir, { recursive: true });
		watcher = watch(dir, (_type, name) => {
			if (active !== ctx || (name !== null && name !== file)) return;
			try {
				deliver(ctx);
			} catch (error) {
				report(ctx, `Mailbox read failed; retrying on the next change: ${(error as Error).message}`);
			}
		});
		watcher.on("error", (error) => {
			closeWatcher();
			report(ctx, `Mailbox watcher stopped; messages now arrive after each run: ${error.message}`);
		});
		deliver(ctx, event.reason === "startup");
	});
	// A completed run has recorded every steer it was given: Pi keeps running while its queue holds
	// messages. That also picks up a dropped watch notification. An aborted run may have discarded its
	// queue (Escape) or kept it (RPC abort), so its reservations wait for the next completed run.
	pi.on("agent_settled", (event, ctx) => {
		if (event.aborted || active === undefined) return;
		reserved(ctx.sessionManager.getSessionId()).clear();
		deliver(ctx);
	});
	pi.on("session_shutdown", stop);

	pi.registerMessageRenderer<MailboxMessage>(MAILBOX_MESSAGE_CUSTOM_TYPE, (message, _options, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const header = `${theme.fg("accent", "\u2709")} ${theme.bold(`Message from ${details.from}`)} ${theme.fg("dim", details.ts)}`;
		const body = details.body
			.split("\n")
			.map((line) => `  ${theme.fg("muted", line)}`)
			.join("\n");
		return new Text(`${header}\n${body}`, 0, 0);
	});
}
