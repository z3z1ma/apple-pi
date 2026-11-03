import type { CredentialStatus, JiraIssue, Outcome, RecentPage } from "../../../src/integrations.js";
import type { AgentWorkplaceApi } from "../../../src/world.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";

export type AtlassianApi = Partial<
	Pick<
		AgentWorkplaceApi,
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

export type Reading<T> =
	| { state: "idle" }
	| { state: "loading"; items?: T }
	| { state: "ready"; items: T; at: number }
	| { state: "failed"; reason: string; items?: T }
	| { state: "signed-out" };

export type AtlassianPanel =
	| { kind: "clerk" }
	| { kind: "issue"; key: string; from: "board" | "clerk" }
	| { kind: "librarian" }
	| { kind: "page"; id: string; title?: string; from?: "librarian" };

export interface AtlassianState {
	signedIn?: CredentialStatus["atlassian"];
	assigned: Reading<JiraIssue[]>;
	recent: Reading<RecentPage[]>;
	panel?: AtlassianPanel;

	opening: number;

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

function reading<T>(outcome: Outcome<Record<string, unknown>>, items: (ok: Record<string, unknown>) => T): Reading<T> {
	if (outcome.ok) return { state: "ready", items: items(outcome), at: Date.now() };
	if (outcome.signIn === "atlassian") return { state: "signed-out" };
	return { state: "failed", reason: outcome.reason };
}

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

export type NoticeKind = "done" | "progress" | "urgent" | "open";
export function noticeOf(issue: JiraIssue): NoticeKind {
	if (issue.statusCategory === "done") return "done";
	if (issue.statusCategory === "indeterminate") return "progress";
	return urgent(issue) ? "urgent" : "open";
}

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

	async refreshStatus() {
		const api = state.api;
		if (!api?.credentialStatus) return;
		try {
			const status = await api.credentialStatus();
			update({ signedIn: status.atlassian });
		} catch {}
	},

	async signIn(site: string, email: string, token: string): Promise<Outcome<{ name: string | null }>> {
		const api = state.api;
		if (!api?.signInAtlassian) return { ok: false, reason: "Agent Workplace is not connected." };
		try {
			const result = await api.signInAtlassian(site, email, token);
			if (result.ok) {
				await atlassian.refreshStatus();

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
		if (!api?.signOutAtlassian) return { ok: false, reason: "Agent Workplace is not connected." };
		try {
			const result = await api.signOutAtlassian();
			if (result.ok) update({ signedIn: null, assigned: { state: "signed-out" }, recent: { state: "signed-out" } });
			return result;
		} catch (error) {
			return { ok: false, reason: failure(error) };
		}
	},

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
		onePanel.opening("atlassian");
		update({ panel, opening: state.opening + 1 });
		void atlassian.refreshStatus();
	},

	show(panel: AtlassianPanel) {
		update({ panel });
	},
	close() {
		if (state.panel) update({ panel: undefined });
	},

	askSignIn() {
		update({ panel: undefined, signInAsked: state.signInAsked + 1 });
		state.view?.intend({ kind: "open-tab", tab: "settings" });
	},

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
onePanel.closes("atlassian", () => atlassian.close());
