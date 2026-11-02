/** A message as another conversation sees it: who wrote it, when, where, and its words. */
export interface QuotedMessage {
	author: string;
	at: number;
	text: string;
	where?: string;
}

/** The message as a Markdown quote, headed by its author, place and time. */
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
	return [head, ...message.text.trim().split("\n")].map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/** Markdown read as one line of plain words, for a one-line excerpt. */
export const plainLine = (text: string) =>
	text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:[-*+]|\d+\.|#+|>)\s+/gm, "")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** Words with the message they answer quoted above them. */
export const withQuote = (words: string, replyTo: QuotedMessage | undefined) =>
	replyTo ? `${quote(replyTo)}\n\n${words}` : words;
