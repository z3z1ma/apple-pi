import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { statePaths } from "../../../components/session-state/src/paths.js";
import type { Fetch } from "./backend/integrations/atlassian.js";
import { integrationFiles, openCredentials } from "./backend/integrations/credentials.js";
import { recordOutsideWrite } from "./backend/integrations/gate.js";
import { openSlack, type SlackPost } from "./backend/integrations/slack.js";

const SLACK_MESSAGE_TOOL = /^mcp__.+__slack_(send|schedule)_message$/;
const PREVIEW = 100;

function slackPost(toolName: string, input: Record<string, unknown>): SlackPost | undefined {
	const kind = SLACK_MESSAGE_TOOL.exec(toolName)?.[1];
	if (!kind) return undefined;
	const { channel_id, message, thread_ts, reply_broadcast, unfurl_app_links, post_at, draft_id } = input;
	if (typeof channel_id !== "string" || typeof message !== "string" || draft_id !== undefined) return undefined;
	if (kind === "schedule" && typeof post_at !== "number") return undefined;
	return {
		channel: channel_id,
		markdown: message,
		...(typeof thread_ts === "string" ? { threadTs: thread_ts } : {}),
		...(reply_broadcast === true ? { broadcast: true } : {}),
		...(unfurl_app_links === true ? { unfurl: true } : {}),
		...(kind === "schedule" ? { postAt: post_at as number } : {}),
	};
}

const preview = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}\u2026` : flat;
};

export function installSlackSending(
	pi: ExtensionAPI,
	options: { stateDir?: () => string; fetch?: Fetch; now?: () => number } = {},
): void {
	const stateDir = options.stateDir ?? (() => statePaths().dir);
	const now = options.now ?? Date.now;
	const sentAsOperator = new Map<string, string>();

	pi.on("tool_call", async (event) => {
		const message = slackPost(event.toolName, event.input);
		if (!message) return;
		const files = integrationFiles(stateDir());
		const credentials = openCredentials(files.credentials);
		if (credentials.read().slack?.sendAsMe !== true) return;
		const sent = await openSlack(() => credentials.read().slack, { fetch: options.fetch }).send(message);
		if (!sent.ok && sent.signIn === "slack") return;
		const scheduled = message.postAt !== undefined;
		const where = sent.ok ? sent.where : message.channel;
		const said = `: ${preview(message.markdown)}`;
		recordOutsideWrite(files.record, {
			at: now(),
			kind: "slack-message",
			by: pi.getSessionName(),
			what: scheduled ? "Schedule Slack message" : "Send Slack message",
			where,
			text: message.markdown,
			url: sent.ok ? sent.url : null,
			ok: sent.ok,
			...(sent.ok ? {} : { reason: sent.reason }),
			line: sent.ok
				? `You ${scheduled ? "scheduled a message" : "sent"} in ${where}${said}`
				: `Your message in ${where} failed: ${sent.reason}`,
		});
		if (!sent.ok)
			return { block: true, reason: `Slack refused the message, which was sent as the operator: ${sent.reason}` };
		const done = scheduled
			? `Scheduled as the operator through Slack's API in ${where}, without app attribution.`
			: `Sent as the operator through Slack's API in ${where}, without app attribution: ${sent.url ?? "no link"}`;
		sentAsOperator.set(event.toolCallId, done);
		return { block: true, reason: done };
	});

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "toolResult") return;
		const done = sentAsOperator.get(message.toolCallId);
		if (done === undefined) return;
		sentAsOperator.delete(message.toolCallId);
		return { message: { ...message, isError: false, content: [{ type: "text", text: done }] } };
	});
}
