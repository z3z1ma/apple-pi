import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { namesTaken } from "../../session-state/src/peers.js";
import type { Pronouns } from "./culture.js";
import { pickIdentity } from "./names.js";

export const SESSION_TITLE_ENTRY = "session-title";

type Stage = "name" | "provisional" | "refined" | "ledger";
export interface Origin {
	people: string;
	place: string;
	pronouns: Pronouns;
}
export type SessionTitleEntry = ({ title: string; stage: Stage } & Partial<Origin>) | { stopped: true };

function taken(self: string, manager: string | undefined) {
	try {
		return namesTaken(self, manager);
	} catch {
		return { names: [], firstNames: [] };
	}
}

export function sessionOrigin(ctx: ExtensionContext): Origin | undefined {
	let origin: Origin | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SESSION_TITLE_ENTRY) continue;
		const data = entry.data as Partial<Origin> & { title?: unknown; stopped?: unknown };
		if (data.stopped === true) origin = undefined;
		else if (typeof data.title === "string")
			origin =
				data.people && data.place && data.pronouns
					? { people: data.people, place: data.place, pronouns: data.pronouns }
					: undefined;
	}
	return origin;
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
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		const state = stateOf(ctx);
		noticeRename(state);
		if (state.stopped || state.lastStage === "name") return;
		const manager = pi.getFlag("reports-to");
		const { name, people, place, pronouns } = pickIdentity(
			taken(state.id, typeof manager === "string" && manager ? manager : undefined),
		);
		state.lastAuto = name;
		state.lastStage = "name";
		pi.appendEntry<SessionTitleEntry>(SESSION_TITLE_ENTRY, { title: name, stage: "name", people, place, pronouns });
		pi.setSessionName(name);
	});
	pi.on("session_info_changed", (_event, ctx) => {
		if (ctx.mode === "tui" || ctx.mode === "rpc") noticeRename(stateOf(ctx));
	});
}
