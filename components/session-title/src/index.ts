/**
 * Names an unnamed root TUI session like a person, and keeps a short sentence of what it works on now.
 *
 * - Name: as the session starts, a first name and a family name from the curated lists in `names.ts`, different from
 *   every live session's name in the session-state database (or just picked when that cannot be read). No model is
 *   asked. A session that still carries a topic title from the earlier title stages gets a name the same way.
 * - Intent: after each settled user turn, one `quick` profile request writes one present-tense sentence of what the
 *   session is doing now, or answers KEEP when the previous sentence still holds. Each new sentence is announced on
 *   `SESSION_INTENT_CHANNEL`; the session-state bridge reports it, and views show it when the session has no ledger
 *   task. The intent lives in memory only: after a reload or resume the next settled turn writes a fresh one.
 *
 * The extension only replaces a name it set itself. Each name it sets is recorded as a `session-title` custom entry.
 * When the name changes to anything other than the last recorded one, the operator has named the session: a
 * `{ stopped: true }` entry records that, and the extension never names that session again, including after a
 * resume and even if the operator later restores the old name. Intent requests run one at a time; session switch or
 * shutdown aborts them. A failed intent request warns once per session and is not retried until the next turn.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { livePeers } from "../../session-state/src/peers.js";
import { profileRequest } from "../../shared/src/model-profiles.js";
import { SESSION_INTENT_CHANNEL, type SessionIntent } from "../../shared/src/session-intent-events.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { pickName } from "./names.js";

const PROFILE = "quick";
export const SESSION_TITLE_ENTRY = "session-title";

/** `name` is a human name; the other stages are topic titles earlier versions wrote, replaced on the next start. */
type Stage = "name" | "provisional" | "refined" | "ledger";

export type SessionTitleEntry = { title: string; stage: Stage } | { stopped: true };

type Content = string | readonly { type: string; text?: string }[];

function textOf(content: Content): string {
	if (typeof content === "string") return content.trim();
	return content
		.flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
		.join("\n")
		.trim();
}

/** The latest user prompt with text and the last assistant text reply after it, on the current branch. */
function latestExchange(branch: SessionEntry[]): { user: string; assistant: string } {
	let assistant = "";
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant" && !assistant) assistant = textOf(message.content);
		if (message.role !== "user") continue;
		const user = textOf(message.content);
		if (user) return { user, assistant };
	}
	return { user: "", assistant };
}

/** Each part of the intent prompt keeps its start and end; the middle of a long prompt or reply says least. */
const MAX_PART = 2000;
function clip(text: string): string {
	if (text.length <= MAX_PART) return text;
	return `${text.slice(0, MAX_PART / 2)}\n...\n${text.slice(-MAX_PART / 2)}`;
}

const KEEP = "KEEP";
const INSTRUCTION = `Say in one short present-tense sentence (at most 12 words) what this coding-agent session is working on now, as a colleague would, for example "Fixing the CSV parser crash on quoted commas".
If <previous> still describes the work, reply ${KEEP} and nothing else.
Reply with the sentence only.`;

function intentPrompt(parts: [tag: string, text: string][]): string {
	const sections = parts.filter(([, text]) => text).map(([tag, text]) => `<${tag}>\n${clip(text)}\n</${tag}>`);
	return [INSTRUCTION, "", ...sections].join("\n");
}

/** The first non-empty line, without surrounding quotes or trailing punctuation. */
function cleanLine(text: string): string {
	const line =
		text
			.split("\n")
			.map((part) => part.trim())
			.find(Boolean) ?? "";
	return line
		.replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, "")
		.replace(/[.,;:!?]+$/u, "")
		.trim();
}

/** Names of the other live sessions, or none when the state database cannot be read. */
function liveNames(self: string): string[] {
	try {
		return livePeers(self).flatMap((peer) => (peer.name ? [peer.name] : []));
	} catch {
		return [];
	}
}

/** Name and intent state for one session id; the name part is recovered from its `session-title` entries. */
interface SessionState {
	id: string;
	/** The last name this extension set, or undefined when it has set none. */
	lastAuto: string | undefined;
	/** The stage of `lastAuto`. */
	lastStage: Stage | undefined;
	/** The operator named the session; it is never named again. */
	stopped: boolean;
	intent: string | undefined;
	/** A user turn ran since the last intent request. */
	userTurn: boolean;
	/** An intent request failed and warned; later failures are quiet. */
	warned: boolean;
}

function loadState(ctx: ExtensionContext): SessionState {
	const state: SessionState = {
		id: ctx.sessionManager.getSessionId(),
		lastAuto: undefined,
		lastStage: undefined,
		stopped: false,
		intent: undefined,
		userTurn: false,
		warned: false,
	};
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SESSION_TITLE_ENTRY) continue;
		const data = entry.data as { title?: unknown; stage?: unknown; stopped?: unknown } | undefined;
		if (data?.stopped === true) state.stopped = true;
		if (typeof data?.title !== "string") continue;
		state.lastAuto = data.title;
		state.lastStage = data.stage as Stage;
	}
	return state;
}

export default function registerSessionTitle(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	let current: SessionState | undefined;
	let controller = new AbortController();
	let queue: Promise<void> = Promise.resolve();
	const cancel = () => {
		controller.abort();
		controller = new AbortController();
		queue = Promise.resolve();
	};

	const stateOf = (ctx: ExtensionContext): SessionState => {
		const id = ctx.sessionManager.getSessionId();
		if (current?.id !== id) current = loadState(ctx);
		return current;
	};
	/** True while the current name is still the extension's own (or absent before any name). */
	const owns = (state: SessionState) => (pi.getSessionName() ?? "") === (state.lastAuto ?? "");
	/** The operator named the session: stop for good, persisted so a resume also stops. */
	const stop = (state: SessionState) => {
		if (state.stopped) return;
		state.stopped = true;
		pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { stopped: true });
	};
	/** Any name change other than the extension's own is the operator's, even one later reverted. */
	const noticeRename = (state: SessionState) => {
		if (!state.stopped && !owns(state)) stop(state);
	};

	pi.on("session_start", (_event, ctx) => {
		cancel();
		current = undefined;
		if (ctx.mode !== "tui") return;
		const state = stateOf(ctx);
		noticeRename(state);
		if (state.stopped || state.lastStage === "name") return;
		const name = pickName(liveNames(state.id));
		// Recorded first, so the session_info_changed this rename fires is recognized as our own.
		state.lastAuto = name;
		state.lastStage = "name";
		pi.setSessionName(name);
		pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { title: name, stage: "name" });
	});
	pi.on("session_shutdown", cancel);

	pi.on("session_info_changed", (_event, ctx) => {
		if (ctx.mode === "tui") noticeRename(stateOf(ctx));
	});

	const request = async (ctx: ExtensionContext, state: SessionState, prompt: string, signal: AbortSignal) => {
		if (signal.aborted) return;
		try {
			const { text } = await profileRequest(ctx.modelRegistry)(PROFILE, prompt, signal);
			// After a session switch or shutdown, this request no longer applies.
			if (signal.aborted || current !== state) return;
			const intent = cleanLine(text).slice(0, 160);
			if (!intent || intent.toUpperCase() === KEEP || intent === state.intent) return;
			state.intent = intent;
			pi.events.emit(SESSION_INTENT_CHANNEL, { sessionId: state.id, intent } satisfies SessionIntent);
		} catch (error) {
			if (signal.aborted || state.warned) return;
			state.warned = true;
			const reason = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Session intent (${PROFILE} profile) failed: ${reason}`, "warning");
		}
	};

	pi.on("before_agent_start", (event, ctx) => {
		if (event.messageType === "user" && ctx.mode === "tui") stateOf(ctx).userTurn = true;
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle() || ctx.mode !== "tui") return;
		const state = stateOf(ctx);
		if (!state.userTurn) return;
		state.userTurn = false;
		const { user, assistant } = latestExchange(ctx.sessionManager.getBranch());
		if (!user) return;
		const prompt = intentPrompt([
			["previous", state.intent ?? ""],
			["user", user],
			["assistant", assistant],
		]);
		const { signal } = controller;
		queue = queue.then(() => request(ctx, state, prompt, signal));
	});
}
