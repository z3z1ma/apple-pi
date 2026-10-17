import { fileURLToPath } from "node:url";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isPublished } from "../../tmux-sessions/src/state.js";
import { appendMailboxMessage } from "./mailbox.js";
import { type MailboxMessage, type MailboxSendParameters, mailboxSendParameters } from "./types.js";

const SEND_SCRIPT = fileURLToPath(new URL("../scripts/pi-send.mjs", import.meta.url));

export function createMailboxSendTool() {
	return defineTool<typeof mailboxSendParameters, MailboxMessage>({
		name: "mailbox_send",
		label: "mailbox_send",
		description:
			"Send a message to another Pi session's mailbox by its session id. The target receives it as a <mailbox-message> steer: at its next safe boundary while running, as a new turn while idle, or when it next opens. Delivery is at least once; the message id identifies a repeat.",
		promptSnippet: "Send a message to another Pi session by session id.",
		promptGuidelines: [
			"Messages from other sessions arrive as <mailbox-message> with the sender's session id in from; answer one with mailbox_send to that id.",
			`Processes outside this session (shell scripts, headless pi -p runs, child agents) send with: node ${SEND_SCRIPT} <session-id> [--from <name>] <message>`,
		],
		parameters: mailboxSendParameters,
		async execute(_toolCallId, params: MailboxSendParameters, _signal, _onUpdate, ctx) {
			const message = appendMailboxMessage(params.session_id, ctx.sessionManager.getSessionId(), params.message);
			const sent = `Sent ${message.id} to ${params.session_id}.`;
			const text = (await isPublished(params.session_id))
				? sent
				: `${sent} No running Pi session in tmux has this id, so the message waits in its mailbox until the session opens.`;
			return {
				content: [{ type: "text", text }],
				details: message,
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(`mailbox_send ${args.session_id ?? "..."}`)), 0, 0);
		},
	});
}
