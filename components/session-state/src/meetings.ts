import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveAddresses } from "./addresses.js";
import { sendThreadMessage } from "./mail.js";

/** Registered for roots, with activation owned by the manager tools' lifecycle reconciliation. */
export function installMeetings(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "meet",
			label: "meet",
			description:
				"Bring people together in a meeting thread. Everyone receives the agenda and each reply as mail. Invite the perspectives the decision needs, use reply for the discussion, then end_meeting with the conclusion when you judge it settled. The organizer decides when to stop; there is no round limit.",
			promptSnippet: "Convene a meeting; the organizer closes it with a summary.",
			parameters: Type.Object(
				{
					people: Type.Array(Type.String({ minLength: 1 }), {
						minItems: 1,
						description: "Names, ids, my-team, my-manager, or operator.",
					}),
					agenda: Type.String({
						minLength: 1,
						description: "The question to settle and context the participants need.",
					}),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const to = resolveAddresses(self, params.people);
				if (!to.length) throw new Error("Invite at least one other person.");
				const thread = `t-${randomUUID()}`;
				const note = await sendThreadMessage(
					self,
					{ thread, threadKind: "meeting", subject: "Meeting", body: params.agenda, to },
					signal,
				);
				return {
					content: [
						{
							type: "text",
							text: `Meeting ${thread} opened. Reply in that thread; end_meeting closes it with your summary.${note ? ` ${note}.` : ""}`,
						},
					],
					details: { thread, people: to },
				};
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "end_meeting",
			label: "end_meeting",
			description:
				"Send your meeting's conclusion to everyone and close the thread. Only its organizer can end it; further replies are refused. Say what was decided, what was verified, and what remains a belief.",
			parameters: Type.Object(
				{
					thread: Type.String({ minLength: 1, description: "The meeting thread id." }),
					summary: Type.String({ minLength: 1, description: "The conclusion to send to everyone." }),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				await sendThreadMessage(
					ctx.sessionManager.getSessionId(),
					{ thread: params.thread, body: `Meeting ended.\n\n${params.summary}`, closeMeeting: true },
					signal,
				);
				return {
					content: [{ type: "text", text: `Meeting ${params.thread} ended. Its summary was sent to everyone.` }],
					details: { thread: params.thread },
				};
			},
		}),
	);
}
