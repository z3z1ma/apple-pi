/** One Responses API output item returned by `/responses/compact`, replayed verbatim. */
export type ResponsesCompactionItem = Record<string, unknown> & { type: string };

/** Anthropic's signed compaction block: readable summary text plus a signature. Replayed verbatim. */
export type AnthropicCompactionBlock = Record<string, unknown> & {
	type: "compaction";
	content: string;
	signature: string;
};

type ServerCompactionBase = {
	provider: string;
	/** True when the compaction entry's text summary is only a copy of this result and may be left out on replay. */
	replacesSummary?: boolean;
};

export type ServerCompaction =
	| (ServerCompactionBase & { api: "openai-responses" | "openai-codex-responses"; items: ResponsesCompactionItem[] })
	| (ServerCompactionBase & { api: "anthropic-messages"; block: AnthropicCompactionBlock });

export interface ServerCompactionDetails {
	serverCompaction?: ServerCompaction;
	tokensBefore?: number;
	[key: string]: unknown;
}
