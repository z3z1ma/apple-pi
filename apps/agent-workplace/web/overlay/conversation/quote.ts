export interface QuotedMessage {
	author: string;
	at: number;
	text: string;
	where?: string;
}

export function quote(message: QuotedMessage): string {
	const when = message.at
		? new Date(message.at).toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			})
		: "";
	const head = [`**${message.author}**`, message.where, when].filter(Boolean).join(" \u00b7 ");
	return [head, "", ...message.text.trim().split("\n")].map((line) => (line ? `> ${line}` : ">")).join("\n");
}

export const plainLine = (text: string) =>
	text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:[-*+]|\d+\.|#+|>)\s+/gm, "")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();

export const withQuote = (words: string, replyTo: QuotedMessage | undefined) =>
	replyTo ? `${quote(replyTo)}\n\n${words}` : words;
