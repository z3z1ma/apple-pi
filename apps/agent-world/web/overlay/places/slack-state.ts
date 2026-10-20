// Slack as the world UI knows it (tickets 27 and 28): whether the operator is signed in and to which workspace, and
// the channels with unread messages, read through the backend's integrations API (`window.agentWorld`). The town
// square's townsfolk, the unread orb, the Slack tab, Settings, and the crier all read this one store, so they always
// agree. It also keeps the list of every channel (read when asked for) and the crier's last search, so they survive
// the crier closing for a channel and opening again. It never sees a token or a cookie: the backend keeps those and
// answers only with status and messages.
import type { CredentialStatus, SlackChannel, SlackHit } from "../../../src/integrations.js";
import type { AgentWorldApi } from "../../../src/world.js";

export type SlackApi = Partial<
	Pick<
		AgentWorldApi,
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
	/** `unknown` until the backend has said; a fixture backend without Slack stays `unavailable`. */
	status: "unknown" | "unavailable" | "signed-out" | "signed-in";
	account?: NonNullable<CredentialStatus["slack"]>;
	/** Channels with unread messages, most pressing first (mentions, then newest), as the backend lists them. */
	channels: SlackChannel[];
	/** The unread listing has been read at least once since signing in. */
	listed: boolean;
	/** Reading the unread listing now. */
	refreshing: boolean;
	/** Why the last listing failed, shown where Slack is shown; cleared by the next good one. */
	problem?: string;
	/** The sign-in window is open. */
	signingIn: boolean;
	/** Why the last sign-in or sign-out did not happen. */
	signInProblem?: string;
	/** Every channel, direct message, and group the operator belongs to: read when first shown, kept a while. */
	all: { channels?: SlackChannel[]; loading: boolean; problem?: string };
	/** The crier's search, as last asked (on Enter): what was asked, and what Slack found so far. */
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

/**
 * How often the unread listing is read again while signed in. Each listing costs Slack one `client.counts` and up to
 * `COUNTED_MAX` (30) `conversations.history` calls, which are Tier 3 (about 50 a minute); every two minutes keeps the
 * world well inside that and still fresh for a glance. Entering the square or signing in reads it at once.
 */
const REFRESH_MS = 120_000;
/** A listing asked for this soon after the last one is the same listing. */
const FRESH_MS = 15_000;
/** The list of every channel, once read, is shown again without asking Slack for this long. */
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
/** Counts searches, so an answer to an older one is dropped. */
let searches = 0;
let listedAt = -Infinity;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | undefined;
/** Channels marked read here, up to which message: a listing read before Slack heard of it does not bring them back. */
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

/** The total the unread orb shows: every counted message, and whether there are more than it says. */
export function unreadTotal(channels: SlackChannel[]): { count: number; more: boolean } {
	let count = 0;
	let more = false;
	for (const channel of channels) {
		count += channel.unread ?? 1;
		if (channel.more || channel.unread === null) more = true;
	}
	return { count, more };
}

/** A channel's unread count as a badge says it: `12`, `100+`, or a dot when Slack did not count it. */
export function unreadLabel(channel: Pick<SlackChannel, "unread" | "more">): string {
	if (channel.unread === null) return "\u2022";
	return channel.more ? `${channel.unread}+` : String(channel.unread);
}

/**
 * Every channel as a list shows it: the unread first, in the unread listing's order and with its counts, then the rest
 * as the backend sorted them; `filter` keeps those whose name has it (no call to Slack).
 */
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

/** A channel's name as Slack shows it: `#general` for a channel, the person's or group's name otherwise. */
export function channelTitle(channel: Pick<SlackChannel, "name" | "kind">): string {
	return channel.kind === "channel" || channel.kind === "private" ? `#${channel.name}` : channel.name;
}

export const slack = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	/** The backend's API (`window.agentWorld`): read the sign-in, then keep the unread listing fresh. */
	connect(next: SlackApi) {
		api = next;
		if (timer) clearInterval(timer);
		timer = setInterval(() => {
			if (state.status === "signed-in" && document.visibilityState !== "hidden") void slack.refresh(true);
		}, REFRESH_MS);
		void readStatus();
	},
	api: () => api,

	/** Read the unread listing again (at once with `force`, else only when the last one is not fresh). */
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

	/** Read the list of every channel (at once with `force`, else only when the last one is not fresh). */
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

	/** Search Slack as its own search bar does: one call, for the first page. Only the crier calls it, on Enter. */
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

	/** The next page of the last search's messages, added under those shown. */
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

	/** Forget the last search: the crier shows the channels again. */
	clearSearch() {
		searches++;
		if (state.search) update({ search: undefined });
	},

	/** Open Slack's sign-in window (the backend captures the session); resolves once it closed. */
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

	/** Sign out: the backend deletes the captured session; the square empties at once. */
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

	/**
	 * Mark a channel read in Slack up to `ts` (its newest message), or with `threadTs` one thread up to its newest
	 * reply, as the operator. The backend sends it at once (the button is the choice), records it, and announces it to
	 * the chatbox. A channel marked read leaves the unread listing at once, so its townsperson leaves the square.
	 */
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

	/** A Slack refusal that says the session ended: the world shows itself signed out. */
	refused(refusal: { signIn?: string; reason: string }) {
		if (refusal.signIn === "slack") signedOut(refusal.reason);
	},
};
