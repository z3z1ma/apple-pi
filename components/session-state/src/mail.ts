import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { sendCommand } from "./client.js";

/** The custom message type of delivered mail; earlier transcripts use it too, so their mail renders and counts as delivered. */
export const MAIL_CUSTOM_TYPE = "apple-pi.mailbox-message";
const SEND_SCRIPT = fileURLToPath(new URL("../scripts/pi-send.mjs", import.meta.url));

/** One delivered mail: the `details` of the message that carries it. `id` is the mail command's id. */
export interface Mail {
	id: string;
	from: string;
	ts: string;
	body: string;
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

/**
 * Hand mail to Pi as a steer, which starts a turn when the session is idle. While the process is starting up, the
 * host may submit its own prompt right after `session_start`, and a turn started here would make Pi reject it, so
 * mail then rides the next turn instead.
 */
export function deliverMail(pi: ExtensionAPI, mail: Mail, startingUp: boolean): void {
	pi.sendMessage<Mail>(
		{
			customType: MAIL_CUSTOM_TYPE,
			content: `<mailbox-message id="${mail.id}" from="${mail.from}" ts="${mail.ts}">\n${mail.body}\n</mailbox-message>`,
			display: true,
			details: mail,
		},
		startingUp ? { deliverAs: "nextTurn" } : { deliverAs: "steer", triggerTurn: true },
	);
}

const mailboxSendParameters = Type.Object(
	{
		session_id: Type.String({ minLength: 1, description: "Session id of the receiving Pi session." }),
		message: Type.String({ minLength: 1, description: "Message text the receiving session reads." }),
	},
	{ additionalProperties: false },
);

function createMailboxSendTool() {
	return defineTool({
		name: "mailbox_send",
		label: "mailbox_send",
		description:
			"Send a message to a peer session (another top-level Pi session; list_peer_sessions finds the live ones) by its session id. The target receives it as a <mailbox-message> steer: at its next safe boundary while running, as a new turn while idle, or when it next opens. Delivery is at least once; the message id identifies a repeat. To redirect your own subagents, use steer_subagent instead.",
		promptSnippet: "Send a message to another Pi session by session id.",
		promptGuidelines: [
			"Messages from other sessions arrive as <mailbox-message> with the sender's session id in from; answer one with mailbox_send to that id.",
			`Processes outside this session (shell scripts, headless pi -p runs, child agents) send with: node ${SEND_SCRIPT} <session-id> [--from <name>] <message>`,
		],
		parameters: mailboxSendParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const from = ctx.sessionManager.getSessionId();
			const receipt = await sendCommand(
				params.session_id,
				{ kind: "mail", from, body: params.message, sentAt: new Date().toISOString() },
				{ signal, stored: true },
			);
			if (receipt.stage === "failed") throw new Error(`Mail to ${params.session_id} failed: ${receipt.reason}`);
			const sent = `Sent ${receipt.commandId} to ${params.session_id}.`;
			return {
				content: [{ type: "text", text: receipt.reason ? `${sent} The session is ${receipt.reason}.` : sent }],
				details: { id: receipt.commandId, from, to: params.session_id },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(`mailbox_send ${args.session_id ?? "..."}`)), 0, 0);
		},
	});
}

/** Show delivered mail; root sessions also get `mailbox_send`. */
export function installMail(pi: ExtensionAPI, withTool: boolean): void {
	pi.registerMessageRenderer<Mail>(MAIL_CUSTOM_TYPE, (message, _options, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const header = `${theme.fg("accent", "\u2709")} ${theme.bold(`Message from ${details.from}`)} ${theme.fg("dim", details.ts)}`;
		const body = details.body
			.split("\n")
			.map((line) => `  ${theme.fg("muted", line)}`)
			.join("\n");
		return new Text(`${header}\n${body}`, 0, 0);
	});
	if (withTool) pi.registerTool(createMailboxSendTool());
}
