import type { CredentialStatus, SlackChannel, SlackHit } from "../../../src/integrations.js";
import type { AgentWorkplaceApi } from "../../../src/world.js";

export type SlackApi = Partial<
	Pick<
		AgentWorkplaceApi,
		| "credentialStatus"
		| "signInSlack"
		| "signOutSlack"
		| "slackUnread"
		| "slackSearch"
		| "slackConversations"
		| "slackChannel"
		| "slackThread"
		| "slackMarkRead"
		| "describeWrite"
		| "confirmWrite"
		| "delegate"
		| "onReceipt"
		| "openLink"
	>
>;

export interface SlackState {
	status: "unknown" | "unavailable" | "signed-out" | "signed-in";
	account?: NonNullable<CredentialStatus["slack"]>;

	channels: SlackChannel[];

	listed: boolean;

	refreshing: boolean;

	problem?: string;

	signingIn: boolean;

	signInProblem?: string;

	all: { channels?: SlackChannel[]; loading: boolean; problem?: string };

	search?: SlackSearchState;
}

export interface SlackSearchState {
	text: string;
	loading: boolean;
	problem?: string;
	channels?: SlackChannel[];
	hits?: SlackHit[];
	page: number;
	pages: number;
	total: number;
}

const REFRESH_MS = 120_000;

const FRESH_MS = 15_000;

const ALL_FRESH_MS = 60_000;

let api: SlackApi = {};
let state: SlackState = {
	status: "unknown",
	channels: [],
	listed: false,
	refreshing: false,
	signingIn: false,
	all: { loading: false },
};
let allAt = -Infinity;

let searches = 0;
let listedAt = -Infinity;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | undefined;

const markedRead = new Map<string, number>();
const listeners = new Set<() => void>();

const update = (change: Partial<SlackState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};
const failure = (error: unknown) => String((error as Error)?.message ?? error);

function signedOut(problem?: string) {
	allAt = -Infinity;
	searches++;
	update({
		status: "signed-out",
		account: undefined,
		channels: [],
		listed: false,
		problem,
		all: { loading: false },
		search: undefined,
	});
}

async function readStatus() {
	if (typeof api.credentialStatus !== "function") return update({ status: "unavailable" });
	try {
		const account = (await api.credentialStatus()).slack;
		if (account) {
			update({ status: "signed-in", account });
			await slack.refresh(true);
		} else signedOut();
	} catch (error) {
		update({ status: "unavailable", problem: failure(error) });
	}
}

export function unreadTotal(channels: SlackChannel[]): { count: number; more: boolean } {
	let count = 0;
	let more = false;
	for (const channel of channels) {
		count += channel.unread ?? 1;
		if (channel.more || channel.unread === null) more = true;
	}
	return { count, more };
}

export function unreadLabel(channel: Pick<SlackChannel, "unread" | "more">): string {
	if (channel.unread === null) return "\u2022";
	return channel.more ? `${channel.unread}+` : String(channel.unread);
}

export function everyChannel(all: SlackChannel[], unread: SlackChannel[], filter = ""): SlackChannel[] {
	const listed = new Map(unread.map((channel) => [channel.id, channel]));
	const known = new Set(all.map((channel) => channel.id));
	const first = unread.filter((channel) => known.has(channel.id));
	const rest = all
		.filter((channel) => !listed.has(channel.id))
		.sort((a, b) => Number(b.unreads === true) - Number(a.unreads === true));
	const wanted = filter.trim().replace(/^[#@]/, "").toLowerCase();
	const every = [...first, ...rest];
	return wanted ? every.filter((channel) => channel.name.toLowerCase().includes(wanted)) : every;
}

export function channelTitle(channel: Pick<SlackChannel, "name" | "kind">): string {
	return channel.kind === "channel" || channel.kind === "private" ? `#${channel.name}` : channel.name;
}

export const slack = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},

	connect(next: SlackApi) {
		api = next;
		if (timer) clearInterval(timer);
		timer = setInterval(() => {
			if (state.status === "signed-in" && document.visibilityState !== "hidden") void slack.refresh(true);
		}, REFRESH_MS);
		void readStatus();
	},
	api: () => api,

	refresh(force = false): Promise<void> {
		if (state.status !== "signed-in" || typeof api.slackUnread !== "function") return Promise.resolve();
		if (inFlight) return inFlight;
		if (!force && performance.now() - listedAt < FRESH_MS) return Promise.resolve();
		const unread = api.slackUnread;
		update({ refreshing: true });
		inFlight = (async () => {
			try {
				const answer = await unread();
				listedAt = performance.now();
				if (answer.ok) {
					const channels = answer.channels.filter(
						(channel) => !(Number(channel.latest ?? 0) <= (markedRead.get(channel.id) ?? Number.NEGATIVE_INFINITY)),
					);
					update({ channels, listed: true, problem: undefined });
				} else if (answer.signIn === "slack") signedOut(answer.reason);
				else update({ problem: answer.reason });
			} catch (error) {
				update({ problem: failure(error) });
			} finally {
				inFlight = undefined;
				update({ refreshing: false });
			}
		})();
		return inFlight;
	},

	async loadAll(force = false): Promise<void> {
		const list = api.slackConversations;
		if (state.status !== "signed-in" || typeof list !== "function" || state.all.loading) return;
		if (!force && state.all.channels && performance.now() - allAt < ALL_FRESH_MS) return;
		update({ all: { ...state.all, loading: true } });
		try {
			const answer = await list();
			if (answer.ok) {
				allAt = performance.now();
				update({ all: { channels: answer.channels, loading: false } });
			} else {
				slack.refused(answer);
				update({ all: { ...state.all, loading: false, problem: answer.reason } });
			}
		} catch (error) {
			update({ all: { ...state.all, loading: false, problem: failure(error) } });
		}
	},

	async search(text: string): Promise<void> {
		const find = api.slackSearch;
		const asked = text.trim();
		if (!asked || state.status !== "signed-in" || typeof find !== "function") return;
		const turn = ++searches;
		update({ search: { text: asked, loading: true, page: 0, pages: 0, total: 0 } });
		try {
			const answer = await find(asked, 1);
			if (turn !== searches) return;
			if (answer.ok) {
				const { channels, hits, page, pages, total } = answer;
				update({ search: { text: asked, loading: false, channels, hits, page, pages, total } });
			} else {
				slack.refused(answer);
				update({ search: { text: asked, loading: false, problem: answer.reason, page: 0, pages: 0, total: 0 } });
			}
		} catch (error) {
			if (turn === searches)
				update({ search: { text: asked, loading: false, problem: failure(error), page: 0, pages: 0, total: 0 } });
		}
	},

	async more(): Promise<void> {
		const find = api.slackSearch;
		const now = state.search;
		if (!now || now.loading || now.page >= now.pages || typeof find !== "function") return;
		const turn = searches;
		update({ search: { ...now, loading: true, problem: undefined } });
		try {
			const answer = await find(now.text, now.page + 1);
			if (turn !== searches) return;
			if (answer.ok)
				update({
					search: {
						...now,
						loading: false,
						hits: [...(now.hits ?? []), ...answer.hits],
						page: answer.page,
						pages: answer.pages,
						total: answer.total,
					},
				});
			else {
				slack.refused(answer);
				update({ search: { ...now, loading: false, problem: answer.reason } });
			}
		} catch (error) {
			if (turn === searches) update({ search: { ...now, loading: false, problem: failure(error) } });
		}
	},

	clearSearch() {
		searches++;
		if (state.search) update({ search: undefined });
	},

	async signIn() {
		if (state.signingIn || typeof api.signInSlack !== "function") return;
		update({ signingIn: true, signInProblem: undefined });
		try {
			const answer = await api.signInSlack();
			if (!answer.ok) update({ signInProblem: answer.reason });
			else await readStatus();
		} catch (error) {
			update({ signInProblem: failure(error) });
		} finally {
			update({ signingIn: false });
		}
	},

	async signOut() {
		if (typeof api.signOutSlack !== "function") return;
		try {
			const answer = await api.signOutSlack();
			if (answer.ok) signedOut();
			else update({ signInProblem: answer.reason });
		} catch (error) {
			update({ signInProblem: failure(error) });
		}
	},

	async markRead(
		channelId: string,
		ts: string,
		threadTs?: string,
	): Promise<{ ok: true } | { ok: false; reason: string }> {
		const mark = api.slackMarkRead;
		if (typeof mark !== "function") return { ok: false, reason: "This window cannot mark Slack read." };
		try {
			const answer = threadTs ? await mark(channelId, ts, threadTs) : await mark(channelId, ts);
			if (!answer.ok) {
				slack.refused(answer);
				return { ok: false, reason: answer.reason };
			}
			if (!threadTs) {
				markedRead.set(channelId, Number(ts));
				update({ channels: state.channels.filter((channel) => channel.id !== channelId) });
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, reason: failure(error) };
		}
	},

	refused(refusal: { signIn?: string; reason: string }) {
		if (refusal.signIn === "slack") signedOut(refusal.reason);
	},
};
