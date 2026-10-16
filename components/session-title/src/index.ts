/**
 * Titles an unnamed root TUI session automatically, so sessions in the same repository are
 * distinguishable in `/resume` and the tmux sidebar. Every stage is one `quick` profile request:
 *
 * 1. provisional: when the first turn starts, from the first user prompt;
 * 2. refined: after the first settled turn, from the first prompt and the first assistant reply;
 * 3. ledger: when the session adds a ledger task or moves one to `in-progress`, from the task title
 *    and the latest user prompt.
 *
 * The extension only replaces a name it set itself. Each title it sets is recorded as a
 * `session-title` custom entry. When the name changes to anything other than the last recorded
 * title, the operator has named the session: a `{ stopped: true }` entry records that, and
 * auto-titling stops for that session for good, including after a resume and even if the operator
 * later restores the old title. Requests run one at a time in stage order, so a fast first turn still shows
 * its provisional title before the refined one; session switch or shutdown aborts every queued request. A failed stage warns once and is not retried while the session stays
 * open; only successful titles are persisted, so a reopened session may try a failed stage again.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { profileRequest } from "../../shared/src/model-profiles.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";

const PROFILE = "quick";
export const SESSION_TITLE_ENTRY = "session-title";

type Stage = "provisional" | "refined" | "ledger";

export type SessionTitleEntry = { title: string; stage: Stage } | { stopped: true };

type Content = string | readonly { type: string; text?: string }[];

function textOf(content: Content): string {
	if (typeof content === "string") return content.trim();
	return content
		.flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
		.join("\n")
		.trim();
}

/**
 * The first user prompt's text and the first assistant text reply after it, on the current branch.
 * Undefined when the first user prompt has no text (say, images only): later prompts never stand in for it.
 */
function firstExchange(branch: SessionEntry[]): { user: string; assistant: string } | undefined {
	let user: string | undefined;
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (user === undefined) {
			if (message.role !== "user") continue;
			user = textOf(message.content);
			if (!user) return undefined;
			continue;
		}
		if (message.role === "assistant") {
			const assistant = textOf(message.content);
			if (assistant) return { user, assistant };
		}
	}
	return user === undefined ? undefined : { user, assistant: "" };
}

function latestUserText(branch: SessionEntry[]): string {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type === "message" && entry.message.role === "user") {
			const text = textOf(entry.message.content);
			if (text) return text;
		}
	}
	return "";
}

const INSTRUCTION =
	"Write a 3-6 word title for this coding-agent session that tells it apart from other sessions in the same repository.\nReply with the title only.";

function titlePrompt(parts: [tag: string, text: string][]): string {
	const sections = parts.filter(([, text]) => text).map(([tag, text]) => `<${tag}>\n${text}\n</${tag}>`);
	return [INSTRUCTION, "", ...sections].join("\n");
}

/** The first non-empty line, without surrounding quotes or trailing punctuation. */
function cleanTitle(text: string): string {
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

/** The H1 of a ledger task file, or undefined when it cannot be read. */
function taskTitle(cwd: string, taskPath: unknown): string | undefined {
	if (typeof taskPath !== "string") return undefined;
	try {
		return /^# (.+)$/mu.exec(readFileSync(join(cwd, taskPath), "utf8"))?.[1]?.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** Auto-title state for one session id, recovered from its `session-title` entries. */
interface SessionState {
	id: string;
	/** The last title this extension set, or undefined when it has set none. */
	lastAuto: string | undefined;
	/** Stages already attempted (or superseded); provisional and refined run at most once. */
	done: Set<Stage>;
	/** The operator named the session; nothing more is titled. */
	stopped: boolean;
}

function loadState(ctx: ExtensionContext): SessionState {
	const state: SessionState = {
		id: ctx.sessionManager.getSessionId(),
		lastAuto: undefined,
		done: new Set(),
		stopped: false,
	};
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SESSION_TITLE_ENTRY) continue;
		const data = entry.data as { title?: unknown; stage?: unknown; stopped?: unknown } | undefined;
		if (data?.stopped === true) state.stopped = true;
		if (typeof data?.title !== "string") continue;
		state.lastAuto = data.title;
		state.done.add("provisional");
		if (data.stage !== "provisional") state.done.add("refined");
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
	pi.on("session_start", () => {
		cancel();
		current = undefined;
	});
	pi.on("session_shutdown", cancel);

	const stateOf = (ctx: ExtensionContext): SessionState => {
		const id = ctx.sessionManager.getSessionId();
		if (current?.id !== id) current = loadState(ctx);
		return current;
	};
	/** True while the current name is still the extension's own (or absent before any auto title). */
	const owns = (state: SessionState) => (pi.getSessionName() ?? "") === (state.lastAuto ?? "");
	/** The operator named the session: stop for good, persisted so a resume also stops. */
	const stop = (state: SessionState) => {
		if (state.stopped) return;
		state.stopped = true;
		cancel();
		pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { stopped: true });
	};
	/** This session's state when the extension may still title it; otherwise undefined. */
	const active = (ctx: ExtensionContext): SessionState | undefined => {
		if (ctx.mode !== "tui") return undefined;
		const state = stateOf(ctx);
		if (!state.stopped && !owns(state)) stop(state);
		return state.stopped ? undefined : state;
	};

	// Any name change other than the extension's own is the operator's, even one later reverted.
	pi.on("session_info_changed", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const state = stateOf(ctx);
		if (!state.stopped && !owns(state)) stop(state);
	});

	const start = (ctx: ExtensionContext, state: SessionState, stage: Stage, prompt: string) => {
		state.done.add(stage);
		const { signal } = controller;
		queue = queue.then(() => request(ctx, state, stage, prompt, signal));
	};

	const request = async (
		ctx: ExtensionContext,
		state: SessionState,
		stage: Stage,
		prompt: string,
		signal: AbortSignal,
	) => {
		if (signal.aborted) return;
		try {
			const { text } = await profileRequest(ctx.modelRegistry)(PROFILE, prompt, signal);
			// After a session switch, shutdown, or the operator naming the session, this request no longer applies.
			if (signal.aborted) return;
			const title = cleanTitle(text);
			if (!title || current !== state || ctx.sessionManager.getSessionId() !== state.id) return;
			if (state.stopped || !owns(state)) return stop(state);
			// Recorded first, so the session_info_changed this rename fires is recognized as our own.
			state.lastAuto = title;
			pi.setSessionName(title);
			pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { title, stage });
		} catch (error) {
			if (signal.aborted) return;
			const reason = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Session title (${stage}, ${PROFILE} profile) failed: ${reason}`, "warning");
		}
	};

	pi.on("before_agent_start", (event, ctx) => {
		if (event.messageType !== "user") return;
		const state = active(ctx);
		if (!state || state.done.has("provisional")) return;
		// The prompt starting this run is not on the branch yet; it is the first prompt only on an empty branch.
		const branch = ctx.sessionManager.getBranch();
		const prompted = branch.some((entry) => entry.type === "message" && entry.message.role === "user");
		const user = prompted ? firstExchange(branch)?.user : event.prompt.trim();
		if (!user) return;
		start(ctx, state, "provisional", titlePrompt([["user", user]]));
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle()) return;
		const state = active(ctx);
		if (!state || state.done.has("refined")) return;
		const exchange = firstExchange(ctx.sessionManager.getBranch());
		if (!exchange) return;
		start(
			ctx,
			state,
			"refined",
			titlePrompt([
				["user", exchange.user],
				["assistant", exchange.assistant],
			]),
		);
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		const details = event.details as { taskPath?: unknown; status?: unknown } | undefined;
		let task: string | undefined;
		if (event.toolName === "ledger_add")
			task = typeof event.input.title === "string" ? event.input.title : taskTitle(ctx.cwd, details?.taskPath);
		else if (event.toolName === "ledger_status" && details?.status === "in-progress")
			task = taskTitle(ctx.cwd, details.taskPath);
		else return;
		if (!task) return;
		const state = active(ctx);
		if (!state) return;
		// A ledger title is more specific than the first-turn titles, which must not replace it.
		state.done.add("provisional");
		state.done.add("refined");
		start(
			ctx,
			state,
			"ledger",
			titlePrompt([
				["task", task],
				["user", latestUserText(ctx.sessionManager.getBranch())],
			]),
		);
	});
}
