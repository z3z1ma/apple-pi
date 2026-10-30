import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text, TruncatedText } from "@earendil-works/pi-tui";
import { renderInline } from "../../shared/src/compact-custom-message.js";
import { liveSession, trackLiveSessions } from "../../shared/src/forked-continuation.js";
import { sendCommand } from "./client.js";
import { installCommunicationTools } from "./communication-tools.js";
import type { MessageReference } from "./communication-types.js";
import { type ThreadKind, type ThreadPost, withThreads } from "./threads.js";

/** The custom type preserves delivery identity and rendering for existing transcripts. */
export const MAIL_CUSTOM_TYPE = "apple-pi.mailbox-message";

/** One delivered message; id is its durable delivery command ID. */
export interface Mail {
	id: string;
	from: string;
	ts: string;
	body: string;
	thread?: string;
	subject?: string;
	fromName?: string;
	threadKind?: ThreadKind;
	reference?: MessageReference;
}

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

export function mailText(mail: Mail): string {
	const from = mail.fromName ? `${mail.fromName} (${mail.from})` : mail.from;
	const thread = mail.thread ? ` thread="${attribute(mail.thread)}" subject="${attribute(mail.subject ?? "")}"` : "";
	const kind = mail.threadKind ? ` kind="${attribute(mail.threadKind)}"` : "";
	const reference = mail.reference ? ` seq="${mail.reference.seq}" message="${attribute(mail.reference.id)}"` : "";
	return `<mail${thread}${kind}${reference} from="${attribute(from)}" ts="${mail.ts}">\n${mail.body}\n</mail>`;
}

/** Startup delivery rides the first host turn; live delivery can start a turn itself. */
export function deliverMail(pi: ExtensionAPI, mail: Mail, startingUp: boolean): void {
	pi.sendMessage<Mail>(
		{ customType: MAIL_CUSTOM_TYPE, content: mailText(mail), display: true, details: mail },
		startingUp ? { deliverAs: "nextTurn" } : { deliverAs: "steer", triggerTurn: true },
	);
}

/** The pair's staged second-opinion request uses this internal writer, not a native tool invocation. */
export async function sendThreadMessage(
	self: string,
	post: ThreadPost,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	if (withThreads(() => true) === undefined)
		throw new Error("The session-state runtime predates threads; ask the operator to update it.");
	const receipt = await sendCommand(self, { kind: "thread_post", ...post }, { signal });
	if (receipt.stage === "failed") throw new Error(`Not sent: ${receipt.reason}`);
	return receipt.reason;
}

/** Rendering and transcript delivery remain independent from communication queries and mutations. */
export function installMail(pi: ExtensionAPI): void {
	trackLiveSessions();
	let session: ReturnType<typeof liveSession>;
	pi.on("session_start", (_event, ctx) => {
		session = liveSession(ctx);
	});
	pi.on("session_shutdown", () => {
		session = undefined;
	});
	pi.on("before_agent_start", (_event, ctx) => {
		const session = liveSession(ctx);
		if (session) session.agent.steeringMode = "all";
	});
	renderInline(MAIL_CUSTOM_TYPE);
	pi.registerMessageRenderer<Mail>(MAIL_CUSTOM_TYPE, (message, _options, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const from = details.fromName ?? details.from;
		const about = details.subject ? `${from} \u00b7 ${details.subject}` : from;
		const label = `${theme.fg("mdLink", "\u2709")} ${theme.bold(theme.fg("mdLink", "Mail"))}`;
		return {
			invalidate() {},
			render(width) {
				if (!session || session.settingsManager.getHideThinkingBlock()) {
					const preview = details.body.replace(/\s+/g, " ").trim();
					return new TruncatedText(`${label}(${about}: ${theme.fg("muted", preview)})`, 0, 0).render(width);
				}
				const body = details.body
					.split("\n")
					.map((line) => `  ${theme.fg("muted", line)}`)
					.join("\n");
				return new Text(`${label}(${about}) ${theme.fg("dim", details.ts)}\n${body}`, 0, 0).render(width);
			},
		};
	});
	installCommunicationTools(pi);
}
