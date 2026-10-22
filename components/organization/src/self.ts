/**
 * A person's self: one Markdown document about itself and the people it works with, written by the person with
 * `update_self`, recorded as a custom entry in its own transcript (the latest on the branch wins), shown as the
 * `<self>` system prompt section at every run, and reported to the session-state runtime for the views. It is never
 * distilled or capped; the pair programmer's notebook maintenance does not touch it.
 */

import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";

export const SELF_ENTRY = "organization-self";
export const SELF_SYSTEM_PROMPT_TAG = "self";
/** The `pi.events` channel on which a changed self is announced; the session-state bridge reports it as a fact. */
export const SELF_CHANNEL = "organization:self";

export interface SelfChange {
	sessionId: string;
	self: string;
}

export const SELF_SEED = `# The people I work with
What I think of each: what they are good at, what to check, how to work with them.

# Who has done what
Work I have seen land, by whom, and how it went.

# Standing agreements
What I have agreed with others and what they expect of me.

# What I am working on now

# What I have learned about this organization
`;

const selves = new Map<string, string | undefined>();

/** The self of the session `ctx` runs, or undefined when it has never written one. */
export function sessionSelf(ctx: ExtensionContext): string | undefined {
	return selves.get(ctx.sessionManager.getSessionId());
}

function storedSelf(ctx: ExtensionContext): string | undefined {
	let self: string | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SELF_ENTRY) continue;
		const data = entry.data as { self?: unknown } | undefined;
		if (typeof data?.self === "string") self = data.self;
	}
	return self;
}

export function installSelf(pi: ExtensionAPI): void {
	// Pi restores the active tool set from the transcript, which lacks this tool in sessions older than it.
	const activate = () => {
		const active = pi.getActiveTools();
		if (!active.includes("update_self")) pi.setActiveTools([...active, "update_self"]);
	};
	pi.on("session_start", (_event, ctx) => {
		selves.set(ctx.sessionManager.getSessionId(), storedSelf(ctx));
		activate();
	});
	pi.on("before_agent_start", (event, ctx) => {
		activate();
		const self = sessionSelf(ctx);
		setSystemPromptSection(
			event.systemPromptOptions,
			SELF_SYSTEM_PROMPT_TAG,
			self ??
				`You have not written your self yet. Replace this with \`update_self\` once you know something worth keeping; these headings are a suggestion.\n\n${SELF_SEED}`,
		);
	});
	pi.registerTool(
		defineTool({
			name: "update_self",
			label: "update_self",
			description:
				"Replace your self: the one document about you that you read at every start and that survives restarts and compaction. Keep here what you think of the people you work with, who has done what, standing agreements, what you are on, and what you have learned about this organization. Write the whole document each time; there is no cap.",
			promptSnippet:
				"Replace your self: what you know about your teammates, agreements, and your own work, kept across restarts.",
			parameters: Type.Object(
				{ text: Type.String({ minLength: 1, description: "The whole self, as Markdown." }) },
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const sessionId = ctx.sessionManager.getSessionId();
				pi.appendEntry(SELF_ENTRY, { self: params.text });
				selves.set(sessionId, params.text);
				pi.events.emit(SELF_CHANNEL, { sessionId, self: params.text } satisfies SelfChange);
				return { content: [{ type: "text", text: `Self updated (${params.text.length} characters).` }], details: {} };
			},
		}),
	);
}
