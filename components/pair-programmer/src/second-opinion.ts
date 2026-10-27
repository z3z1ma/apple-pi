import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { managerAddress, resolveAddresses } from "../../session-state/src/addresses.js";
import { sendThreadMessage } from "../../session-state/src/mail.js";
import {
	directoryDescription,
	directoryParameters,
	directoryView,
	readDirectory,
} from "../../session-state/src/peers.js";
import { OPERATOR } from "../../session-state/src/threads.js";

export type SecondOpinionRequest = { thread: string; to: string; question: string };

export function createSecondOpinionTools(self: string, stage: (request: SecondOpinionRequest) => boolean) {
	const ask = defineTool({
		name: "ask_for_second_opinion",
		label: "Ask for a second opinion",
		description:
			"Ask a person in your partner's organization for an independent opinion. Name the person with to, or leave it out to ask your partner's manager. This stages mail in your partner's name, marked as from its pair; a successful review sends it. The reply reaches your partner in the same thread and you see it in the shared trajectory. With no manager, name someone explicitly. The operator is contacted only when you name operator.",
		parameters: Type.Object(
			{
				question: Type.String({
					minLength: 1,
					description: "The question and enough context for the colleague to investigate independently.",
				}),
				to: Type.Optional(
					Type.String({
						minLength: 1,
						description:
							"One person's name or session id; operator only when you deliberately want the human. Defaults to your partner's manager.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_id, params) {
			const question = params.question.trim();
			if (!question) throw new Error("Give the colleague a question.");
			const named = params.to?.trim();
			if (params.to !== undefined && !named)
				throw new Error("Name someone with to, or omit it to ask your partner's manager.");
			const address = named ?? managerAddress(self);
			if (!named && address === OPERATOR) {
				const others = readDirectory(self).members.filter((member) => member.id !== self && member.id !== OPERATOR);
				throw new Error(
					others.length
						? "Your partner has no manager. Use directory and name someone with to; name operator only when you want the human."
						: "There is nobody else in your partner's organization to ask. Name operator explicitly if you want the human.",
				);
			}
			const recipients = resolveAddresses(self, [address]);
			if (recipients.length !== 1) throw new Error("Name one other person for the second opinion.");
			const request = { thread: `t-${randomUUID().slice(0, 8)}`, to: recipients[0], question };
			if (!stage(request)) throw new Error("This pair review is no longer current; no mail was sent.");
			return {
				content: [
					{
						type: "text",
						text: `Queued for this review's successful completion (thread ${request.thread}, to ${request.to}). Delivery status will be appended here. Your partner receives the reply.`,
					},
				],
				details: { thread: request.thread, to: request.to },
			};
		},
	});
	const directory = defineTool({
		name: "directory",
		label: "Directory",
		description: directoryDescription,
		parameters: directoryParameters,
		execute: async (_id, params) => directoryView(self, params),
	});
	return { ask, directory };
}

export async function sendSecondOpinion(
	self: string,
	request: SecondOpinionRequest,
	signal: AbortSignal,
): Promise<string> {
	const note = await sendThreadMessage(
		self,
		{
			thread: request.thread,
			subject: "Second opinion",
			to: [request.to],
			body: `From the pair programmer following this session:\n\n${request.question}\n\nReply in this thread; the main session is a participant.`,
		},
		signal,
	);
	return `Sent second-opinion request in thread ${request.thread}.${note ? ` ${note}` : ""}`;
}
