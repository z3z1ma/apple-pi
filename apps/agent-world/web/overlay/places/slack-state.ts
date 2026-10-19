// Slack as the world UI knows it (tickets 27 and 28): whether the operator is signed in and to which workspace, and
// the channels with unread messages, read through the backend's integrations API (`window.agentWorld`). The town
// square's townsfolk, the unread orb, the Slack tab, Settings, and the crier all read this one store, so they always
// agree. It never sees a token or a cookie: the backend keeps those and answers only with status and messages.
import type { CredentialStatus, SlackChannel } from "../../../src/integrations.js";
import type { AgentWorldApi } from "../../../src/world.js";

export type SlackApi = Partial<
	Pick<
		AgentWorldApi,
		| "credentialStatus"
		| "signInSlack"
		| "signOutSlack"
		| "slackUnread"
		| "slackFindChannels"
		| "slackChannel"
		| "slackThread"
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
}

/**
 * How often the unread listing is read again while signed in. Each listing costs Slack one `client.counts` and up to
 * `COUNTED_MAX` (30) `conversations.history` calls, which are Tier 3 (about 50 a minute); every two minutes keeps the
 * world well inside that and still fresh for a glance. Entering the square or signing in reads it at once.
 */
const REFRESH_MS = 120_000;
/** A listing asked for this soon after the last one is the same listing. */
const FRESH_MS = 15_000;

let api: SlackApi = {};
let state: SlackState = { status: "unknown", channels: [], listed: false, refreshing: false, signingIn: false };
let listedAt = -Infinity;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | undefined;
const listeners = new Set<() => void>();

const update = (change: Partial<SlackState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};
const failure = (error: unknown) => String((error as Error)?.message ?? error);

function signedOut(problem?: string) {
	update({ status: "signed-out", account: undefined, channels: [], listed: false, problem });
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
				if (answer.ok) update({ channels: answer.channels, listed: true, problem: undefined });
				else if (answer.signIn === "slack") signedOut(answer.reason);
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

	/** A Slack refusal that says the session ended: the world shows itself signed out. */
	refused(refusal: { signIn?: string; reason: string }) {
		if (refusal.signIn === "slack") signedOut(refusal.reason);
	},
};
