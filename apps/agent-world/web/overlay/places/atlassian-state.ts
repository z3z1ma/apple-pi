// The quest office's and the library's shared state (tickets 24-26): whether the operator is signed in to Atlassian
// (never the token: the backend keeps it and answers only site and email), the issues assigned to him (the quest
// board's notices), the pages read lately (the library's shelf), and which of their panels is open. The world's notices
// and the panels both read it, so a write or a sign-in shows everywhere at once. `main.tsx` connects the backend API.
import type { CredentialStatus, JiraIssue, Outcome, RecentPage } from "../../../src/integrations.js";
import type { AgentWorldApi } from "../../../src/world.js";
import type { ViewStore } from "../../view-state.js";

export type AtlassianApi = Partial<
	Pick<
		AgentWorldApi,
		| "credentialStatus"
		| "signInAtlassian"
		| "signOutAtlassian"
		| "jiraAssigned"
		| "jiraSearch"
		| "jiraIssue"
		| "jiraTransitions"
		| "confluenceSearch"
		| "confluencePage"
		| "libraryRecent"
		| "describeWrite"
		| "confirmWrite"
		| "delegate"
		| "onReceipt"
		| "openLink"
	>
>;

/** Something read from Atlassian: not asked yet, on its way, read, refused (with why), or waiting for a sign-in. */
export type Reading<T> =
	| { state: "idle" }
	| { state: "loading"; items?: T }
	| { state: "ready"; items: T; at: number }
	| { state: "failed"; reason: string; items?: T }
	| { state: "signed-out" };

/** Which panel is open: a host's list (the clerk's board, the librarian's catalogue), or one issue or page. */
export type AtlassianPanel =
	| { kind: "clerk" }
	| { kind: "issue"; key: string; from: "board" | "clerk" }
	| { kind: "librarian" }
	| { kind: "page"; id: string; title?: string; from?: "librarian" };

export interface AtlassianState {
	/** The signed-in site and email; null when signed out; undefined until asked. */
	signedIn?: CredentialStatus["atlassian"];
	assigned: Reading<JiraIssue[]>;
	recent: Reading<RecentPage[]>;
	panel?: AtlassianPanel;
	/** Counts each opening, so a panel opened again starts afresh. */
	opening: number;
	/** Counts each request to show the sign-in in Settings, which focuses its first field. */
	signInAsked: number;
	api?: AtlassianApi;
	view?: ViewStore;
}

let state: AtlassianState = { assigned: { state: "idle" }, recent: { state: "idle" }, opening: 0, signInAsked: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<AtlassianState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};
const failure = (error: unknown) => String((error as Error)?.message ?? error);

/** An outcome from the backend as a reading: refused for want of a sign-in is `signed-out`. */
function reading<T>(outcome: Outcome<Record<string, unknown>>, items: (ok: Record<string, unknown>) => T): Reading<T> {
	if (outcome.ok) return { state: "ready", items: items(outcome), at: Date.now() };
	if (outcome.signIn === "atlassian") return { state: "signed-out" };
	return { state: "failed", reason: outcome.reason };
}

/** The issues assigned to the operator: open ones first by how pressing they are, as the board pins them. */
const PRIORITY = ["highest", "blocker", "critical", "high", "medium", "low", "lowest", "trivial"];
export function urgent(issue: JiraIssue): boolean {
	const priority = (issue.priority ?? "").toLowerCase();
	return priority === "highest" || priority === "blocker" || priority === "critical" || priority === "high";
}
function byPressing(a: JiraIssue, b: JiraIssue) {
	const rank = (issue: JiraIssue) => {
		const at = PRIORITY.indexOf((issue.priority ?? "").toLowerCase());
		return at < 0 ? PRIORITY.indexOf("medium") : at;
	};
	return rank(a) - rank(b) || (b.updated ?? "").localeCompare(a.updated ?? "");
}

/** Which notice an issue is pinned as: done, in progress, urgent (by priority), or simply open. */
export type NoticeKind = "done" | "progress" | "urgent" | "open";
export function noticeOf(issue: JiraIssue): NoticeKind {
	if (issue.statusCategory === "done") return "done";
	if (issue.statusCategory === "indeterminate") return "progress";
	return urgent(issue) ? "urgent" : "open";
}

/** Layers over a panel (a confirmation) that Escape or the close button dismiss before the panel itself. */
const layers: (() => void)[] = [];

let loadingAssigned: Promise<void> | undefined;
let loadingRecent: Promise<void> | undefined;

export const atlassian = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: AtlassianApi, view: ViewStore) {
		update({ api, view });
	},

	/** Ask the backend who is signed in (site and email only). */
	async refreshStatus() {
		const api = state.api;
		if (!api?.credentialStatus) return;
		try {
			const status = await api.credentialStatus();
			update({ signedIn: status.atlassian });
		} catch {}
	},

	/** Check the email and token against the site, and keep them in the backend: the token is never seen again here. */
	async signIn(site: string, email: string, token: string): Promise<Outcome<{ name: string | null }>> {
		const api = state.api;
		if (!api?.signInAtlassian) return { ok: false, reason: "Agent World is not connected." };
		try {
			const result = await api.signInAtlassian(site, email, token);
			if (result.ok) {
				await atlassian.refreshStatus();
				// What the places showed before sign-in is stale: read them again.
				update({ assigned: { state: "idle" }, recent: { state: "idle" } });
				if (state.panel) void atlassian.loadAssigned();
			}
			return result;
		} catch (error) {
			return { ok: false, reason: failure(error) };
		}
	},

	async signOut(): Promise<Outcome<object>> {
		const api = state.api;
		if (!api?.signOutAtlassian) return { ok: false, reason: "Agent World is not connected." };
		try {
			const result = await api.signOutAtlassian();
			if (result.ok) update({ signedIn: null, assigned: { state: "signed-out" }, recent: { state: "signed-out" } });
			return result;
		} catch (error) {
			return { ok: false, reason: failure(error) };
		}
	},

	/** Read the issues assigned to the operator again (the board and the clerk's list); one read at a time. */
	loadAssigned(): Promise<void> {
		loadingAssigned ??= (async () => {
			const api = state.api;
			if (!api?.jiraAssigned) return;
			const before = state.assigned;
			const kept = "items" in before ? before.items : undefined;
			update({ assigned: { state: "loading", items: kept } });
			try {
				const next = reading((await api.jiraAssigned()) as Outcome<Record<string, unknown>>, (ok) =>
					[...(ok.issues as JiraIssue[])].sort(byPressing),
				);
				update({ assigned: next.state === "failed" ? { ...next, items: kept } : next });
				if (next.state === "signed-out" && state.signedIn) update({ signedIn: null });
			} catch (error) {
				update({ assigned: { state: "failed", reason: failure(error), items: kept } });
			}
		})().finally(() => {
			loadingAssigned = undefined;
		});
		return loadingAssigned;
	},

	/** The pages opened in the library lately, newest first. */
	loadRecent(): Promise<void> {
		loadingRecent ??= (async () => {
			const api = state.api;
			if (!api?.libraryRecent) return;
			try {
				const pages = await api.libraryRecent();
				update({ recent: { state: "ready", items: pages, at: Date.now() } });
			} catch (error) {
				update({ recent: { state: "failed", reason: failure(error) } });
			}
		})().finally(() => {
			loadingRecent = undefined;
		});
		return loadingRecent;
	},

	open(panel: AtlassianPanel) {
		update({ panel, opening: state.opening + 1 });
		void atlassian.refreshStatus();
	},
	/** Go from one view to another inside the open panel (the list to an issue and back), without opening it anew. */
	show(panel: AtlassianPanel) {
		update({ panel });
	},
	close() {
		layers.length = 0;
		if (state.panel) update({ panel: undefined });
	},
	/** Escape, the close button, or a click on the world: the top layer goes first, then the panel. */
	dismiss() {
		const top = layers.at(-1);
		if (top) top();
		else atlassian.close();
	},
	/** A layer over the panel: `dismiss` calls `cancel` first. Returns its removal. */
	layer(cancel: () => void): () => void {
		layers.push(cancel);
		return () => {
			const at = layers.lastIndexOf(cancel);
			if (at >= 0) layers.splice(at, 1);
		};
	},

	/** Settings, with the Atlassian sign-in ready to fill in (from a place that needs it). */
	askSignIn() {
		update({ panel: undefined, signInAsked: state.signInAsked + 1 });
		state.view?.intend({ kind: "open-tab", tab: "settings" });
	},

	/** Open a link in the system browser; says why on screen when it cannot. */
	async openLink(url: string) {
		const { api, view } = state;
		if (!api?.openLink) return view?.notify("This window cannot open links.");
		try {
			const result = await api.openLink(url);
			if (!result.ok) view?.notify(result.reason);
		} catch (error) {
			view?.notify(failure(error));
		}
	},
};
