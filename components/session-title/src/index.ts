/** Human names for root TUI sessions, drawn without a model. Explicit task assignments own what people work on. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { livePeers } from "../../session-state/src/peers.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { pickName } from "./names.js";

export const SESSION_TITLE_ENTRY = "session-title";

/** Earlier topic-title stages are replaced by a human name on the next start. */
type Stage = "name" | "provisional" | "refined" | "ledger";
export type SessionTitleEntry = { title: string; stage: Stage } | { stopped: true };

function liveNames(self: string): string[] {
	try {
		return livePeers(self).flatMap((peer) => (peer.name ? [peer.name] : []));
	} catch {
		return [];
	}
}

interface SessionState {
	id: string;
	lastAuto: string | undefined;
	lastStage: Stage | undefined;
	stopped: boolean;
}

function loadState(ctx: ExtensionContext): SessionState {
	const state: SessionState = {
		id: ctx.sessionManager.getSessionId(),
		lastAuto: undefined,
		lastStage: undefined,
		stopped: false,
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
	const stateOf = (ctx: ExtensionContext): SessionState => {
		const id = ctx.sessionManager.getSessionId();
		if (current?.id !== id) current = loadState(ctx);
		return current;
	};
	const noticeRename = (state: SessionState) => {
		if (state.stopped || (pi.getSessionName() ?? "") === (state.lastAuto ?? "")) return;
		state.stopped = true;
		pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { stopped: true });
	};

	pi.on("session_start", (_event, ctx) => {
		current = undefined;
		if (ctx.mode !== "tui") return;
		const state = stateOf(ctx);
		noticeRename(state);
		if (state.stopped || state.lastStage === "name") return;
		const name = pickName(liveNames(state.id));
		state.lastAuto = name;
		state.lastStage = "name";
		pi.setSessionName(name);
		pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { title: name, stage: "name" });
	});
	pi.on("session_info_changed", (_event, ctx) => {
		if (ctx.mode === "tui") noticeRename(stateOf(ctx));
	});
}
