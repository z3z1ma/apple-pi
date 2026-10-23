/**
 * A person's self: four fields, each one kind of claim about itself and the people it works with, held to its own
 * standard of evidence. The person rewrites it only in reflection: a headless fork of its own conversation the harness
 * starts after it finishes a task and before its context is compacted. The self is recorded as a custom entry in the
 * person's own transcript (the latest on the branch wins) and reported to the session-state runtime for the views.
 *
 * The `<self>` system prompt section shows the self as it stood at the session's start or its last compaction. A
 * reflection's new self reaches the conversation as an appended message instead, so the cached prompt prefix holds
 * until the next compaction rebuilds it anyway.
 */

import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import { registerForkedContinuation } from "../../shared/src/forked-continuation.js";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";

export const SELF_ENTRY = "organization-self";
export const SELF_SYSTEM_PROMPT_TAG = "self";
export const SELF_REFLECTION_MESSAGE_TYPE = "organization-self-reflection";
/** The `pi.events` channel on which a changed self is announced; the session-state bridge reports it as a fact. */
export const SELF_CHANNEL = "organization:self";

export interface SelfChange {
	sessionId: string;
	self: string;
}

const FIELDS = {
	story: {
		heading: "My story",
		description:
			"Who you are, told as your story: your reading of your soul, if you have one, and of what has happened to you. The soul is fixed; what it means is yours, and you may read it differently than before.",
	},
	practice: {
		heading: "How I work",
		description:
			"How you actually work, as seen from outside. Name the source of each claim: a correction, a review finding, an outcome, a colleague's words. Your own impression of yourself is weak evidence. Remove a claim the evidence has overturned; keep a contradiction you have not resolved, marked open.",
	},
	commitments: {
		heading: "What I hold myself to",
		description:
			"What you hold yourself to from now on. A choice, not a claim, so it needs no evidence. It shapes what you choose; it never widens what you may do.",
	},
	colleagues: {
		heading: "The people I work with",
		description:
			"How each colleague reasons, what they notice and what they miss, and how you work best with them, from what they did and said. Your view is yours and need not match theirs. Revise it when they surprise you.",
	},
} as const;

type Field = keyof typeof FIELDS;
export type Self = Partial<Record<Field, string>>;

const FIELD_NAMES = Object.keys(FIELDS) as Field[];

function isSelf(value: unknown): value is Self {
	const data = value as Record<string, unknown> | undefined;
	return FIELD_NAMES.some((field) => typeof data?.[field] === "string");
}

export function renderSelf(self: Self): string {
	return FIELD_NAMES.flatMap((field) => (self[field] ? [`## ${FIELDS[field].heading}\n${self[field]}`] : [])).join(
		"\n\n",
	);
}

const NO_SELF =
	"You have not written your self yet. The harness asks you to reflect on yourself when you finish a task and before your context is compacted.";

const REFUSED =
	"Your self is rewritten only in reflection, which the harness starts when you finish a task and before your context is compacted. Carry on with your work.";

const JUNCTURES = {
	task: "You have finished a task.",
	compaction:
		"Your context is about to be compacted. After it you will know what your self says, not why: the detail behind your recent work will be gone.",
};

type Juncture = keyof typeof JUNCTURES;

export function reflectionPrompt(juncture: Juncture, firstSelf: boolean): string {
	return [
		JUNCTURES[juncture],
		firstSelf
			? "You have not written your self yet; this is its first version. If a soul is under your role, your story starts from your reading of it."
			: "",
		"Reflect on yourself and the people you work with, then rewrite your self with `update_self`. Your self is the one account of you that outlives this context window. Each field holds one kind of claim, to its own standard, as its description says; omit a field to keep it as it stands.",
		"Keep task status, receipts, and plans out of it; tasks and the ledger hold those. If nothing changed what you think of yourself or your colleagues, do not call `update_self`, and say so.",
	]
		.filter(Boolean)
		.join("\n\n");
}

/** The self latest written, and the self the system prompt shows, by session id. */
const latest = new Map<string, Self | undefined>();
const shown = new Map<string, Self | undefined>();

/** The self of the session `ctx` runs, as Markdown, or undefined when it has never written one. */
export function sessionSelf(ctx: ExtensionContext): string | undefined {
	const self = latest.get(ctx.sessionManager.getSessionId());
	return self && renderSelf(self);
}

function storedSelf(ctx: ExtensionContext): Self | undefined {
	let self: Self | undefined;
	for (const entry of ctx.sessionManager.getEntries())
		if (entry.type === "custom" && entry.customType === SELF_ENTRY && isSelf(entry.data)) self = entry.data;
	return self;
}

/** `reflects` is false for a person with no future to carry a self into, such as a program's temporary peer. */
export function installSelf(pi: ExtensionAPI, { reflects }: { reflects: boolean }): void {
	let reflecting = false;
	let rewritten = false;

	// Pi restores the active tool set from the transcript, which lacks this tool in sessions older than it.
	const activate = () => {
		const active = pi.getActiveTools();
		if (!active.includes("update_self")) pi.setActiveTools([...active, "update_self"]);
	};
	pi.on("session_start", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		latest.set(sessionId, storedSelf(ctx));
		shown.set(sessionId, latest.get(sessionId));
		activate();
	});
	pi.on("session_compact", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		shown.set(sessionId, latest.get(sessionId));
	});
	pi.on("before_agent_start", (event, ctx) => {
		activate();
		const self = shown.get(ctx.sessionManager.getSessionId());
		setSystemPromptSection(event.systemPromptOptions, SELF_SYSTEM_PROMPT_TAG, self ? renderSelf(self) : NO_SELF);
	});

	const fields = Object.fromEntries(
		FIELD_NAMES.map((field) => [
			field,
			Type.Optional(Type.String({ minLength: 1, description: FIELDS[field].description })),
		]),
	) as Record<Field, ReturnType<typeof Type.Optional<ReturnType<typeof Type.String>>>>;
	pi.registerTool(
		defineTool({
			name: "update_self",
			label: "update_self",
			description:
				"Rewrite your self: your story, how you work, what you hold yourself to, and how the people you work with think. Each field replaces its part whole; an omitted field stays as it is. The harness accepts it only in reflection, which it starts when you finish a task and before your context is compacted.",
			promptSnippet: "Rewrite your self in reflection: your story, practice, commitments, and colleagues.",
			parameters: Type.Object(fields, { additionalProperties: false, minProperties: 1 }),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const sessionId = ctx.sessionManager.getSessionId();
				if (!reflecting || !inForkedContinuation(sessionId))
					return { content: [{ type: "text", text: REFUSED }], details: {}, isError: true };
				const self: Self = { ...latest.get(sessionId), ...params };
				pi.appendEntry(SELF_ENTRY, self);
				latest.set(sessionId, self);
				rewritten = true;
				pi.events.emit(SELF_CHANNEL, { sessionId, self: renderSelf(self) } satisfies SelfChange);
				return {
					content: [{ type: "text", text: `Self rewritten: ${Object.keys(params).join(", ")}.` }],
					details: {},
				};
			},
		}),
	);
	if (!reflects) return;

	let reflectingSession = "";
	const reflect = registerForkedContinuation(pi, SELF_REFLECTION_MESSAGE_TYPE, "Self", (reply) => {
		const self = latest.get(reflectingSession);
		if (!rewritten || !self) return undefined;
		return `Self: ${reply}\n\nYour self now reads as follows, and replaces the <self> section of your system prompt.\n\n${renderSelf(self)}`;
	});
	const start = (ctx: ExtensionContext, juncture: Juncture) => {
		if (reflecting) return;
		const sessionId = ctx.sessionManager.getSessionId();
		reflectingSession = sessionId;
		reflecting = true;
		rewritten = false;
		void reflect(ctx, reflectionPrompt(juncture, latest.get(sessionId) === undefined)).finally(() => {
			reflecting = false;
		});
	};

	let finishedTask = false;
	let completed = false;
	pi.on("session_start", () => {
		finishedTask = false;
	});
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName === "finish_task" && !event.isError && !inForkedContinuation(ctx.sessionManager.getSessionId()))
			finishedTask = true;
	});
	pi.on("agent_before_settle", (event) => {
		completed = event.outcome === "completed";
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!completed || !finishedTask) return;
		finishedTask = false;
		start(ctx, "task");
	});
	// The fork copies the conversation as it stands, before the compaction removes the detail it reflects on.
	pi.on("session_before_compact", (_event, ctx) => {
		start(ctx, "compaction");
	});
}
