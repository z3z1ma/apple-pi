import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveAddresses } from "./addresses.js";
import { sendCommand } from "./client.js";
import { messagesOf, threadOf, threadsOf, withThreads } from "./threads.js";

/** The custom message type of delivered mail; earlier transcripts use it too, so their mail renders and counts as delivered. */
export const MAIL_CUSTOM_TYPE = "apple-pi.mailbox-message";
const SEND_SCRIPT = fileURLToPath(new URL("../scripts/pi-send.mjs", import.meta.url));

/** One delivered mail: the `details` of the message that carries it. `id` is the mail command's id. */
export interface Mail {
	id: string;
	from: string;
	ts: string;
	body: string;
	/** A thread message: its thread, subject, and the sender's name. Mail from outside processes may lack them. */
	thread?: string;
	subject?: string;
	fromName?: string;
}

/** Ids of the mail a transcript already holds. */
export function mailRecordedIn(entries: SessionEntry[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom_message" || entry.customType !== MAIL_CUSTOM_TYPE) continue;
		const id = (entry.details as Mail | undefined)?.id;
		if (id) ids.add(id);
	}
	return ids;
}

const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The text the model reads for one mail. */
export function mailText(mail: Mail): string {
	const from = mail.fromName ? `${mail.fromName} (${mail.from})` : mail.from;
	const thread = mail.thread ? ` thread="${attribute(mail.thread)}" subject="${attribute(mail.subject ?? "")}"` : "";
	return `<mail${thread} from="${attribute(from)}" ts="${mail.ts}">\n${mail.body}\n</mail>`;
}

/**
 * Hand mail to Pi as a steer, which starts a turn when the session is idle. While the process is starting up, the
 * host may submit its own prompt right after `session_start`, and a turn started here would make Pi reject it, so
 * mail then rides the next turn instead.
 */
export function deliverMail(pi: ExtensionAPI, mail: Mail, startingUp: boolean): void {
	pi.sendMessage<Mail>(
		{ customType: MAIL_CUSTOM_TYPE, content: mailText(mail), display: true, details: mail },
		startingUp ? { deliverAs: "nextTurn" } : { deliverAs: "steer", triggerTurn: true },
	);
}

const THREADS_MISSING =
	"The session-state runtime predates threads; it migrates when it restarts (kill the pid in ~/.pi/agent/state/apple-pi-runtime.pid).";

async function post(
	self: string,
	post: { thread: string; body: string; subject?: string; to?: string[]; cc?: string[] },
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	if (withThreads(() => true) === undefined) throw new Error(THREADS_MISSING);
	const receipt = await sendCommand(self, { kind: "thread_post", ...post }, { signal });
	if (receipt.stage === "failed") throw new Error(`Not sent: ${receipt.reason}`);
	return receipt.reason;
}

const newThreadId = () => `t-${randomUUID().slice(0, 8)}`;

const sentence = (note: string | undefined) => (note ? ` ${note[0].toUpperCase()}${note.slice(1)}.` : "");

const addressList = (description: string) =>
	Type.Array(Type.String({ minLength: 1 }), {
		description: `${description} A name, a session id, my-team, or my-manager.`,
	});

function createSendMailTool() {
	return defineTool({
		name: "send_mail",
		label: "send_mail",
		description:
			"Write to people in your organization, the way you would email a colleague: one or several people, with copies. It starts a thread; every participant receives each message in it as mail (a new turn when idle, at the next safe point while working, or when they next wake). Address people by name, by session id, or with my-team and my-manager.",
		promptSnippet: "Write to people in your organization; starts a thread.",
		promptGuidelines: [
			"Mail from others arrives as <mail thread=... subject=... from=...>; answer it with reply on that thread, so everyone in it hears the answer.",
			"Use send_mail to start a new conversation and reply to continue one.",
			`Processes outside a session (shell scripts, headless pi -p runs) send with: node ${SEND_SCRIPT} <session-id> [--from <name>] <message>`,
		],
		parameters: Type.Object(
			{
				to: addressList("Who the mail is for."),
				cc: Type.Optional(addressList("Who is copied.")),
				subject: Type.String({ minLength: 1, description: "What the thread is about, in a few words." }),
				body: Type.String({ minLength: 1, description: "The message." }),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const self = ctx.sessionManager.getSessionId();
			const to = resolveAddresses(self, params.to);
			const cc = resolveAddresses(self, params.cc ?? []).filter((id) => !to.includes(id));
			if (!to.length) throw new Error("Nobody to write to (you cannot mail only yourself).");
			const thread = newThreadId();
			const note = await post(self, { thread, subject: params.subject, body: params.body, to, cc }, signal);
			return {
				content: [{ type: "text", text: `Sent (thread ${thread}).${sentence(note)}` }],
				details: { thread, to, cc },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(`send_mail ${args.subject ?? "..."}`)), 0, 0);
		},
	});
}

function createReplyTool() {
	return defineTool({
		name: "reply",
		label: "reply",
		description:
			"Answer in a thread you are in. Everyone in the thread receives the reply, as with reply-all in email.",
		promptSnippet: "Answer everyone in a thread.",
		parameters: Type.Object(
			{
				thread: Type.String({ minLength: 1, description: "The thread id, from the mail you answer or from inbox." }),
				body: Type.String({ minLength: 1, description: "The reply." }),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const self = ctx.sessionManager.getSessionId();
			const note = await post(self, { thread: params.thread, body: params.body }, signal);
			return {
				content: [{ type: "text", text: `Replied in ${params.thread}.${sentence(note)}` }],
				details: { thread: params.thread },
			};
		},
	});
}

const clip = (text: string, max: number) => {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
};

function createInboxTool() {
	return defineTool({
		name: "inbox",
		label: "inbox",
		description:
			"The threads you are in that have messages you have not read (or every thread you are in, with all: true): subject, participants, how many are new, and the latest message. Read one in full with read_thread.",
		promptSnippet: "List your threads with what is new.",
		parameters: Type.Object(
			{ all: Type.Optional(Type.Boolean({ description: "List every thread you are in, read or not." })) },
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const self = ctx.sessionManager.getSessionId();
			const threads = withThreads((db) => threadsOf(db, self, params.all !== true));
			if (threads === undefined) throw new Error(THREADS_MISSING);
			const lines = threads.map((thread) => {
				const people = thread.participants
					.filter((p) => p.id !== self)
					.map((p) => p.name)
					.join(", ");
				const last = thread.last ? ` Latest from ${thread.last.from}: ${clip(thread.last.body, 160)}` : "";
				return `- ${thread.id} [${thread.kind}${thread.closed ? ", closed" : ""}] "${thread.subject}" with ${people}; ${thread.unread} new.${last}`;
			});
			const text = lines.length
				? lines.join("\n")
				: params.all
					? "You are in no threads."
					: "Nothing new. (inbox with all: true lists every thread you are in.)";
			return { content: [{ type: "text", text }], details: { threads } };
		},
	});
}

function createReadThreadTool() {
	return defineTool({
		name: "read_thread",
		label: "read_thread",
		description: "Read a thread you are in, every message in order, and mark it read.",
		promptSnippet: "Read a thread in full.",
		parameters: Type.Object(
			{ thread: Type.String({ minLength: 1, description: "The thread id." }) },
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const self = ctx.sessionManager.getSessionId();
			const read = withThreads((db) => {
				const thread = threadOf(db, params.thread);
				if (!thread) return "missing" as const;
				const member = db
					.prepare("select 1 from thread_participants where thread_id = ? and participant = ?")
					.get(params.thread, self);
				return member ? { thread, messages: messagesOf(db, params.thread) } : ("outside" as const);
			});
			if (read === undefined) throw new Error(THREADS_MISSING);
			if (read === "missing") throw new Error(`No thread ${params.thread}.`);
			if (read === "outside") throw new Error(`You are not in thread ${params.thread}.`);
			const last = read.messages.at(-1);
			if (last) await sendCommand(self, { kind: "thread_read", thread: params.thread, seq: last.seq }, { signal });
			const text = [
				`"${read.thread.subject}" (${read.thread.kind}${read.thread.closed ? ", closed" : ""})`,
				...read.messages.map(
					(message) =>
						`\n${message.fromName} (${message.from}), ${new Date(message.at).toISOString()}:\n${message.body}`,
				),
			].join("\n");
			return { content: [{ type: "text", text }], details: read };
		},
	});
}

/** Show delivered mail; root sessions also get the mail tools. */
export function installMail(pi: ExtensionAPI, withTools: boolean): void {
	pi.registerMessageRenderer<Mail>(MAIL_CUSTOM_TYPE, (message, _options, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const from = details.fromName ?? details.from;
		const subject = details.subject ? ` ${theme.fg("dim", `\u00b7 ${details.subject}`)}` : "";
		const header = `${theme.fg("accent", "\u2709")} ${theme.bold(from)}${subject} ${theme.fg("dim", details.ts)}`;
		const body = details.body
			.split("\n")
			.map((line) => `  ${theme.fg("muted", line)}`)
			.join("\n");
		return new Text(`${header}\n${body}`, 0, 0);
	});
	if (!withTools) return;
	pi.registerTool(createSendMailTool());
	pi.registerTool(createReplyTool());
	pi.registerTool(createInboxTool());
	pi.registerTool(createReadThreadTool());
}
