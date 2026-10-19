// The forge's state (tickets 21-23): the open pull requests the backend lists through `gh`, each one's review page
// (its diff), the operator's review drafts, and the requests he delegated. The world draws the list on the benches
// and the panel shows it; both read it here. The list is read when the operator enters the forge, again every
// `REFRESH_MS` while he is there, and when its panel opens on a list older than `FRESH_MS`. Each change replaces the
// state object, as useSyncExternalStore needs.
import type { Delegation, PullRequest, PullRequestDetail, Refusal } from "../../../src/integrations.js";
import type { AgentWorldApi, ReceiptStage } from "../../../src/world.js";
import { chatLines } from "../interface/chat-lines.js";

export type ForgeApi = Partial<
	Pick<
		AgentWorldApi,
		"pullRequests" | "pullRequest" | "describeWrite" | "confirmWrite" | "delegate" | "onReceipt" | "openLink"
	>
>;

/** How often the list is read again while the operator is in the forge. */
export const REFRESH_MS = 60_000;
/** A list read this recently is not read again when the panel opens. */
const FRESH_MS = 20_000;

export type PullRef = Pick<PullRequest, "repo" | "number">;
export const prKey = ({ repo, number }: PullRef) => `${repo}#${number}`;

export interface ForgeList {
	state: "idle" | "loading" | "ready" | "failed";
	pullRequests: PullRequest[];
	/** When it was last read (ms), and why the last read failed. */
	at?: number;
	reason?: string;
	signIn?: Refusal["signIn"];
}

export interface ForgeDetail {
	state: "loading" | "ready" | "failed";
	detail?: PullRequestDetail;
	reason?: string;
}

/** A request delegated from a pull request: to whom, as which command, and the receipt stages it reached. */
export interface ForgeDelegation {
	ask: "address-review" | "get-reviewed";
	to: string;
	toName: string;
	command?: "talk" | "follow_up";
	commandId?: string;
	stages: ReceiptStage[];
	reason?: string;
}

export interface ForgeState {
	/** The panel: the smith's list, one pull request's card, or its review page. */
	page?: "list" | "card" | "review";
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
	selected?: PullRef;
	list: ForgeList;
	details: Record<string, ForgeDetail>;
	/** What the operator has written for each pull request's review, kept until it is sent. */
	drafts: Record<string, string>;
	delegations: Record<string, ForgeDelegation>;
	api?: ForgeApi;
}

let state: ForgeState = {
	opening: 0,
	list: { state: "idle", pullRequests: [] },
	details: {},
	drafts: {},
	delegations: {},
};
const listeners = new Set<() => void>();
const update = (change: Partial<ForgeState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};
const failure = (error: unknown) => String((error as Error)?.message ?? error);

let reading: Promise<void> | undefined;
/** What Escape (or a click on the world) does first while a confirmation shows over the panel. */
let guarded: (() => void) | undefined;
let visiting: ReturnType<typeof setInterval> | undefined;
let stopReceipts: (() => void) | undefined;
let commands = 0;

/** Record a receipt stage for the delegation sent as `commandId`, once and in order. */
function reached(commandId: string, stage: ReceiptStage, reason?: string) {
	const entry = Object.entries(state.delegations).find(([, sent]) => sent.commandId === commandId);
	if (!entry) return;
	const [key, sent] = entry;
	if (sent.stages.includes(stage) || sent.stages.includes("failed") || sent.stages.includes("applied")) return;
	update({
		delegations: {
			...state.delegations,
			[key]: { ...sent, stages: [...sent.stages, stage], ...(reason ? { reason } : {}) },
		},
	});
}

export const forge = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: ForgeApi) {
		stopReceipts?.();
		stopReceipts = api.onReceipt?.((receipt) => reached(receipt.commandId, receipt.stage, receipt.reason));
		update({ api });
	},

	/** Read the list again (once at a time); `ifOlder` skips it when the last read is that recent. */
	refresh(ifOlder = 0): Promise<void> {
		const { api, list } = state;
		if (!api?.pullRequests) return Promise.resolve();
		if (reading) return reading;
		if (ifOlder && list.at && Date.now() - list.at < ifOlder && list.state === "ready") return Promise.resolve();
		update({ list: { ...list, state: "loading" } });
		const read = api.pullRequests;
		reading = (async () => {
			try {
				const answer = await read();
				if (answer.ok) update({ list: { state: "ready", pullRequests: answer.pullRequests, at: Date.now() } });
				else
					update({
						list: {
							state: "failed",
							pullRequests: state.list.pullRequests,
							at: Date.now(),
							reason: answer.reason,
							signIn: answer.signIn,
						},
					});
			} catch (error) {
				update({
					list: { state: "failed", pullRequests: state.list.pullRequests, at: Date.now(), reason: failure(error) },
				});
			} finally {
				reading = undefined;
			}
		})();
		return reading;
	},

	/** The operator walked into the forge: read the list now, then every `REFRESH_MS` until he leaves. */
	enter() {
		void forge.refresh(FRESH_MS / 2);
		clearInterval(visiting);
		// Tests may read it more often (`window.agentWorldForgeRefreshMs`).
		const every = (globalThis as { agentWorldForgeRefreshMs?: number }).agentWorldForgeRefreshMs ?? REFRESH_MS;
		visiting = setInterval(() => void forge.refresh(), every);
	},
	leave() {
		clearInterval(visiting);
		visiting = undefined;
	},

	/** The smith's list. */
	open() {
		update({ page: "list", selected: undefined, opening: state.opening + 1 });
		void forge.refresh(FRESH_MS);
	},
	/** One pull request's card; its diff is read as it opens, so the review page is ready. */
	openCard(pr: PullRef) {
		const fresh = !state.page;
		update({ page: "card", selected: { repo: pr.repo, number: pr.number }, opening: state.opening + (fresh ? 1 : 0) });
		void forge.loadDetail(pr);
		if (fresh) void forge.refresh(FRESH_MS);
	},
	openReview(pr: PullRef) {
		const fresh = !state.page;
		update({
			page: "review",
			selected: { repo: pr.repo, number: pr.number },
			opening: state.opening + (fresh ? 1 : 0),
		});
		void forge.loadDetail(pr);
	},
	/** Back one page: from the review page to the card, from the card to the list. */
	back() {
		if (state.page === "review") update({ page: "card" });
		else if (state.page === "card") update({ page: "list", selected: undefined });
	},
	close() {
		guarded = undefined;
		if (state.page) update({ page: undefined });
	},
	/** Escape, the close button, or the world: decline a confirmation showing, else close the panel. */
	escape() {
		if (guarded) guarded();
		else forge.close();
	},
	guard(then: (() => void) | undefined) {
		guarded = then;
	},

	/** The pull request as last listed, or as its review page read it. */
	find(pr: PullRef | undefined): PullRequest | undefined {
		if (!pr) return undefined;
		const key = prKey(pr);
		return (
			state.list.pullRequests.find((one) => prKey(one) === key) ?? state.details[key]?.detail?.pullRequest ?? undefined
		);
	},

	/** Read a pull request's diff for its review page (again with `again`, as after a review was sent). */
	async loadDetail(pr: PullRef, again = false) {
		const { api } = state;
		const key = prKey(pr);
		const had = state.details[key];
		if (!api?.pullRequest || (had && !again && had.state !== "failed")) return;
		update({ details: { ...state.details, [key]: { ...had, state: had?.detail ? "ready" : "loading" } } });
		try {
			const answer = await api.pullRequest(pr.repo, pr.number);
			update({
				details: {
					...state.details,
					[key]: answer.ok
						? { state: "ready", detail: answer.detail }
						: { state: had?.detail ? "ready" : "failed", detail: had?.detail, reason: answer.reason },
				},
			});
		} catch (error) {
			update({ details: { ...state.details, [key]: { state: "failed", reason: failure(error) } } });
		}
	},

	setDraft(pr: PullRef, text: string) {
		update({ drafts: { ...state.drafts, [prKey(pr)]: text } });
	},

	/** A review was sent: its draft is spent, and the list and the page are read again to show what changed. */
	reviewed(pr: PullRef) {
		const drafts = { ...state.drafts };
		delete drafts[prKey(pr)];
		update({ drafts });
		void forge.refresh();
		void forge.loadDetail(pr, true);
	},

	/** Open the pull request on GitHub, in the browser. */
	async openInGitHub(pr: Pick<PullRequest, "url" | "repo" | "number">) {
		const result = await state.api?.openLink?.(pr.url);
		if (result && !result.ok) chatLines.add(result.reason);
	},

	/**
	 * Ask the agent who built it to address the review (`to` its id), or the coordinator to get it reviewed: an
	 * ordinary instruction (`talk` when idle, `follow_up` when busy). It never writes to GitHub.
	 */
	async delegate(
		pr: PullRequest,
		ask: ForgeDelegation["ask"],
		to: { id: string; name: string },
		note?: string,
		near?: string,
	) {
		const { api } = state;
		const key = prKey(pr);
		if (!api?.delegate) return;
		if (state.delegations[key] && !state.delegations[key].stages.some((s) => s === "failed" || s === "applied")) return;
		const commandId = `forge-${Date.now().toString(36)}-${++commands}`;
		update({
			delegations: { ...state.delegations, [key]: { ask, to: to.id, toName: to.name, commandId, stages: [] } },
		});
		const delegation: Delegation = {
			to: to.id,
			...(near ? { near } : {}),
			item: { kind: "pull-request", repo: pr.repo, number: pr.number, title: pr.title, url: pr.url },
			ask,
			...(note?.trim() ? { note: note.trim() } : {}),
		};
		const ref = `${pr.repo}#${pr.number}`;
		try {
			const result = await api.delegate(commandId, delegation);
			const sent = state.delegations[key];
			if (result.ok) {
				const who = to.name;
				chatLines.add(
					ask === "address-review"
						? `You asked ${who} to address the review on ${ref}.`
						: `You asked ${who} to get ${ref} reviewed.`,
					"commands",
				);
				update({
					delegations: {
						...state.delegations,
						[key]: {
							...sent,
							command: result.command,
							stages: sent.stages.includes("applied") ? sent.stages : [...sent.stages, "applied"],
						},
					},
				});
			} else {
				chatLines.add(`Asking ${to.name} about ${ref} failed: ${result.reason}`, "commands");
				update({
					delegations: {
						...state.delegations,
						[key]: { ...sent, stages: [...sent.stages, "failed"], reason: result.reason },
					},
				});
			}
		} catch (error) {
			const sent = state.delegations[key];
			update({
				delegations: {
					...state.delegations,
					[key]: { ...sent, stages: [...sent.stages, "failed"], reason: failure(error) },
				},
			});
		}
	},

	/** Ask again after a delegation finished or failed. */
	clearDelegation(pr: PullRef) {
		const delegations = { ...state.delegations };
		delete delegations[prKey(pr)];
		update({ delegations });
	},
};
