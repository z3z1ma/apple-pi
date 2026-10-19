// The function places' backend: GitHub, Jira, Confluence, and Slack adapters behind one object, with the stored
// sign-ins, the outside-write gate, and delegation. A plain Node module with no Electron import: Electron's main
// process wires it to IPC (`src/electron/main.ts`), tests call it directly with fakes at the edges.
import type {
	CredentialStatus,
	Outcome,
	OutsideWriteEntry,
	OutsideWriteIntent,
	RecentPage,
	WriteDescription,
} from "../../integrations.js";
import type { Receipt, WorldSnapshot } from "../../world.js";
import type { Commands } from "../commands.js";
import { atlassianSite, type Fetch, NOT_SIGNED_IN as NO_ATLASSIAN } from "./atlassian.js";
import { type Confluence, openConfluence } from "./confluence.js";
import { integrationFiles, openCredentials } from "./credentials.js";
import { delegate } from "./delegation.js";
import { type Gate, openGate } from "./gate.js";
import { type GitHub, openGitHub, validPullRequest } from "./github.js";
import { issueKey, type Jira, openJira } from "./jira.js";
import { openSlack, type Slack } from "./slack.js";

export interface IntegrationOptions {
	/** The session-state directory (`statePaths().dir`); the private files live beside the runtime's. */
	stateDir: string;
	snapshot: () => WorldSnapshot;
	commands: Commands;
	/** The environment `gh` runs with (tests put a fake first on PATH). */
	env?: NodeJS.ProcessEnv;
	fetch?: Fetch;
	/** The Slack Web API's address, instead of the workspace's own (tests). */
	slackApi?: string;
	now?: () => number;
}

const PREVIEW = 80;
const preview = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}\u2026` : flat;
};

export function openIntegrations(options: IntegrationOptions) {
	const files = integrationFiles(options.stateDir);
	const credentials = openCredentials(files.credentials);
	const atlassian = () => credentials.read().atlassian;
	const github: GitHub = openGitHub(options.env);
	const jira: Jira = openJira(atlassian, options.fetch);
	const confluence: Confluence = openConfluence(atlassian, files.recentPages, options.fetch, options.now);
	const slack: Slack = openSlack(() => credentials.read().slack, {
		api: options.slackApi,
		fetch: options.fetch,
		now: options.now,
	});
	const characters = () => options.snapshot().characters;

	/** Mark read, described for the record: the channel, or the thread by who started it. */
	const describeMarkRead = async (
		intent: Extract<OutsideWriteIntent, { kind: "slack-mark-read" }>,
	): Promise<Outcome<{ description: WriteDescription }>> => {
		const ts = /^\d+\.\d+$/;
		if (
			!/^[A-Z0-9]+$/.test(intent.channel) ||
			!ts.test(intent.ts) ||
			(intent.threadTs !== undefined && !ts.test(intent.threadTs))
		)
			return { ok: false, reason: "That is not a Slack channel." };
		if (!credentials.read().slack) return { ok: false, reason: "Sign in to Slack in Settings first.", signIn: "slack" };
		const channel = await slack.channelName(intent.channel);
		const place = /^[CG]/.test(intent.channel) ? `#${channel}` : channel;
		let where = place;
		if (intent.threadTs) {
			const parent = await slack.thread(intent.channel, intent.threadTs);
			if (!parent.ok) return parent;
			const first = parent.thread.messages[0];
			where = `${place}, in ${first ? `${first.name}'s` : "a"} thread`;
		}
		return { ok: true, description: { what: "Mark read in Slack", where, text: "", url: null } };
	};

	const gate: Gate = openGate(
		files.record,
		{
			async describe(intent: OutsideWriteIntent) {
				switch (intent.kind) {
					case "github-review": {
						if (!validPullRequest(intent.repo, intent.number))
							return { ok: false, reason: "That is not a pull request." };
						const what = {
							approve: "Approve pull request",
							comment: "Comment on pull request",
							"request-changes": "Request changes on pull request",
						}[intent.event];
						return {
							ok: true,
							description: {
								what,
								where: `${intent.repo}#${intent.number} on GitHub`,
								text: intent.body,
								url: `https://github.com/${intent.repo}/pull/${intent.number}`,
							},
						};
					}
					case "jira-comment":
					case "jira-transition": {
						const signedIn = atlassian();
						if (!signedIn) return NO_ATLASSIAN;
						const key = issueKey(intent.key);
						if (!key) return { ok: false, reason: "That is not a Jira issue key." };
						const where = `${key} on ${new URL(signedIn.site).hostname}`;
						const url = `${signedIn.site}/browse/${key}`;
						if (intent.kind === "jira-comment")
							return { ok: true, description: { what: "Comment on Jira issue", where, text: intent.body, url } };
						// Only a move Jira offers for the issue now.
						const allowed = await jira.transitions(key);
						if (!allowed.ok) return allowed;
						const move = allowed.transitions.find((transition) => transition.id === intent.transition);
						if (!move) return { ok: false, reason: `Jira does not offer that move for ${key} now.` };
						const text = move.to && move.to !== move.name ? `${move.name} (to ${move.to})` : move.name;
						return { ok: true, description: { what: "Move Jira issue", where, text, url } };
					}
					case "slack-reply": {
						const signedIn = credentials.read().slack;
						if (!signedIn) return { ok: false, reason: "Sign in to Slack in Settings first.", signIn: "slack" };
						// Name the thread by who started it and how it starts, so the operator sees where it goes.
						const parent = await slack.thread(intent.channel, intent.threadTs);
						if (!parent.ok) return parent;
						const first = parent.thread.messages[0];
						const channel = await slack.channelName(intent.channel);
						const place = /^[CG]/.test(intent.channel) ? `#${channel}` : channel;
						return {
							ok: true,
							description: {
								what: "Reply in a Slack thread",
								where: first ? `${place}, in ${first.name}'s thread: ${preview(first.text)}` : place,
								text: intent.text,
								url: parent.thread.url,
							},
						};
					}
					case "slack-mark-read":
						return describeMarkRead(intent);
				}
			},
			async send(intent: OutsideWriteIntent) {
				switch (intent.kind) {
					case "github-review":
						return github.review(intent.repo, intent.number, intent.event, intent.body);
					case "jira-comment":
						return jira.comment(intent.key, intent.body);
					case "jira-transition":
						return jira.transition(intent.key, intent.transition);
					case "slack-reply":
						return slack.reply(intent.channel, intent.threadTs, intent.text);
					case "slack-mark-read":
						return slack.markRead(intent.channel, intent.ts, intent.threadTs);
				}
			},
		},
		options.now,
	);

	return {
		credentialStatus: (): CredentialStatus => credentials.status(),

		async signInAtlassian(site: unknown, email: unknown, token: unknown): Promise<Outcome<{ name: string | null }>> {
			const origin = typeof site === "string" ? atlassianSite(site) : undefined;
			if (!origin) return { ok: false, reason: "That is not an Atlassian site address." };
			if (typeof email !== "string" || !email.includes("@"))
				return { ok: false, reason: "That is not an email address." };
			if (typeof token !== "string" || !token.trim()) return { ok: false, reason: "Paste the API token first." };
			const trying = { site: origin, email: email.trim(), token: token.trim() };
			// Kept only once the site accepts it, so a typo never sits in the file.
			const me = await openJira(() => trying, options.fetch).myself();
			if (!me.ok) return me;
			credentials.set("atlassian", trying);
			return { ok: true, name: me.name };
		},
		async signOutAtlassian(): Promise<Outcome<object>> {
			credentials.set("atlassian", undefined);
			return { ok: true };
		},
		/** Keep a Slack session captured from the sign-in window, once `auth.test` accepts it. */
		async storeSlackSession(session: { token: string; cookie: string }): Promise<Outcome<{ team: string | null }>> {
			if (!session.token.startsWith("xoxc-") || !session.cookie)
				return { ok: false, reason: "Slack's sign-in did not finish." };
			const checked = await slack.check(session);
			if (!checked.ok) return { ok: false, reason: "Slack did not accept the captured session." };
			credentials.set("slack", {
				token: session.token,
				cookie: session.cookie,
				team: checked.team,
				url: checked.url,
				user: checked.user,
			});
			return { ok: true, team: checked.team };
		},
		async signOutSlack(): Promise<Outcome<object>> {
			credentials.set("slack", undefined);
			return { ok: true };
		},

		pullRequests: () => github.pullRequests(characters()),
		pullRequest: (repo: unknown, number: unknown) =>
			validPullRequest(repo, number)
				? github.pullRequest(repo as string, number as number, characters())
				: Promise.resolve({ ok: false as const, reason: "That is not a pull request." }),

		jiraAssigned: () => jira.assigned(),
		jiraSearch: (text: unknown) => jira.search(typeof text === "string" ? text : ""),
		jiraIssue: (key: unknown) => jira.issue(String(key ?? "")),
		jiraTransitions: (key: unknown) => jira.transitions(String(key ?? "")),

		confluenceSearch: (text: unknown) => confluence.search(typeof text === "string" ? text : ""),
		confluencePage: (id: unknown) => confluence.page(String(id ?? "")),
		libraryRecent: (): RecentPage[] => confluence.recent(),

		slackUnread: () => slack.unread(),
		slackFindChannels: (text: unknown) => slack.find(typeof text === "string" ? text : ""),
		slackChannel: (id: unknown) => slack.channel(String(id ?? "")),
		slackThread: (id: unknown, ts: unknown) => slack.thread(String(id ?? ""), String(ts ?? "")),
		/** Mark read: the button is the operator's choice, so the gate sends it unconfirmed but records it. */
		slackMarkRead: (id: unknown, ts: unknown, threadTs?: unknown) =>
			gate.act({ kind: "slack-mark-read", channel: id, ts, ...(threadTs == null ? {} : { threadTs }) }),

		describeWrite: (intent: unknown) => gate.describe(intent),
		confirmWrite: (intent: unknown, token: unknown) => gate.write(intent, token),
		outsideWrites: async (): Promise<OutsideWriteEntry[]> => gate.recent(),
		onOutsideWrite: (listener: (entry: OutsideWriteEntry) => void) => gate.onWrite(listener),

		/** Delegate an item to an agent; each receipt stage reaches `onReceipt`. */
		delegate: (commandId: unknown, delegation: unknown, onReceipt: (receipt: Receipt) => void = () => {}) =>
			typeof commandId === "string" && commandId
				? delegate(options.commands, options.snapshot(), commandId, delegation, (characterId, stage, reason) =>
						onReceipt({ commandId, characterId, stage, ...(reason ? { reason } : {}) }),
					)
				: Promise.resolve({ ok: false as const, reason: "No command id was given." }),

		close() {},
	};
}

export type Integrations = ReturnType<typeof openIntegrations>;
