// What the function places (forge, quest office, library, town square) get from the backend: GitHub, Jira, Confluence,
// and Slack read through the backend's adapters, the outside-write gate, delegation, and sign-in status. Shared by the
// backend, the preload bridge, and the renderer; types only. Credentials never appear here: the renderer learns only
// whether it is signed in and as whom.

/** Why a read or write did not happen; `signIn` names the account that needs signing in (again) in Settings. */
export interface Refusal {
	ok: false;
	reason: string;
	signIn?: "atlassian" | "slack" | "github";
}

export type Outcome<T> = ({ ok: true } & T) | Refusal;

// Credentials

/** What Settings may know about the stored sign-ins: never a token, cookie, or password. */
export interface CredentialStatus {
	/** The Atlassian site (`https://acme.atlassian.net`) and the email signed in with, or null. */
	atlassian: { site: string; email: string } | null;
	/** The Slack workspace signed in to (its name and address), or null. */
	slack: { team: string | null; url: string | null; user: string | null } | null;
}

// GitHub (the forge)

/** A pull request's CI, rolled up from its checks: any failed is failing, else any unfinished is running. */
export type CiState = "passing" | "failing" | "running" | "none";

export interface PullRequest {
	/** `owner/name`. */
	repo: string;
	number: number;
	title: string;
	url: string;
	author: string | null;
	draft: boolean;
	/** The head branch. */
	branch: string | null;
	updatedAt: string | null;
	ci: CiState;
	checks: { passing: number; failing: number; running: number; total: number };
	/** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null. */
	reviewDecision: string | null;
	/** The awake agent whose repository and branch it comes from; null when none. */
	agent: { id: string; name: string } | null;
	/** Found by `gh search prs --involves @me` (authored, assigned, mentioned, or asked to review). */
	involvesYou: boolean;
}

export interface DiffLine {
	kind: "context" | "add" | "del";
	/** Line numbers in the old and new file; null on the side the line is not on. */
	old: number | null;
	new: number | null;
	text: string;
}

export interface DiffHunk {
	/** The `@@ -a,b +c,d @@ section` line. */
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	/** The path before a rename; equal to `path` otherwise. */
	oldPath: string;
	status: "added" | "deleted" | "modified" | "renamed";
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

/** What the review page shows: the pull request, its description and checks, and its diff by file. */
export interface PullRequestDetail {
	pullRequest: PullRequest;
	body: string;
	baseBranch: string | null;
	state: string;
	checks: { name: string; state: "passing" | "failing" | "running" | "skipped" }[];
	files: DiffFile[];
	/** True when the diff was longer than the review page shows (`DIFF_LINES_MAX` lines). */
	cut: boolean;
}

export const DIFF_LINES_MAX = 20_000;

// Jira (the quest office)

export interface JiraIssue {
	key: string;
	summary: string;
	status: string | null;
	/** `new`, `indeterminate`, or `done`. */
	statusCategory: string | null;
	type: string | null;
	priority: string | null;
	project: string | null;
	assignee: string | null;
	updated: string | null;
	url: string;
}

export interface JiraComment {
	id: string;
	author: string | null;
	created: string | null;
	/** Jira's rendered HTML (untrusted: sanitise before showing) and the same as plain text. */
	html: string | null;
	text: string;
}

export interface JiraIssueDetail {
	issue: JiraIssue;
	reporter: string | null;
	created: string | null;
	/** The description as Jira renders it (untrusted HTML), and as plain text. */
	descriptionHtml: string | null;
	descriptionText: string;
	comments: JiraComment[];
}

/** A move Jira allows for an issue now. */
export interface JiraTransition {
	id: string;
	name: string;
	to: string | null;
	toCategory: string | null;
}

// Confluence (the library)

export interface ConfluencePageRef {
	id: string;
	title: string;
	space: string | null;
	url: string;
	/** A plain-text excerpt around the match (search results only). */
	excerpt?: string;
	lastModified?: string | null;
}

export interface ConfluencePage {
	page: ConfluencePageRef;
	/** The page as Confluence renders it (`view` format; untrusted HTML: sanitise before showing). */
	html: string;
}

/** A page opened in the library, newest first. */
export interface RecentPage extends ConfluencePageRef {
	openedAt: number;
}

// Slack (the town square and the crier)

export interface SlackChannel {
	id: string;
	/** `general` for a channel, the person's name for a direct message. */
	name: string;
	kind: "channel" | "private" | "dm" | "group";
	/** Unread messages (as many as were counted, see `more`); null when not counted. */
	unread: number | null;
	/** True when there are more unread messages than `unread` counted. */
	more: boolean;
	mentions: number;
	/** The newest message's timestamp (`1712345678.000100`), or null. */
	latest: string | null;
	url: string | null;
}

export interface SlackMessage {
	ts: string;
	threadTs: string | null;
	user: string | null;
	name: string;
	text: string;
	replies: number;
	at: number;
}

export interface SlackThread {
	channel: { id: string; name: string };
	messages: SlackMessage[];
	url: string | null;
}

// The outside-write gate

/** A write outside as the operator, exactly as he asked for it. */
export type OutsideWriteIntent =
	| {
			kind: "github-review";
			repo: string;
			number: number;
			event: "comment" | "approve" | "request-changes";
			body: string;
	  }
	| { kind: "jira-comment"; key: string; body: string }
	| { kind: "jira-transition"; key: string; transition: string }
	| { kind: "slack-reply"; channel: string; threadTs: string; text: string };

/** What the confirmation shows: what is done, where, and the exact text sent. */
export interface WriteDescription {
	what: string;
	where: string;
	text: string;
	/** Where it can be seen once sent. */
	url: string | null;
}

/** A described write waiting for the operator: pass `token` back with the same intent to send it. */
export type DescribedWrite = Outcome<{ token: string; description: WriteDescription }>;

/** One outside write the operator confirmed, as the local record keeps it and the chatbox shows it. */
export interface OutsideWriteEntry {
	at: number;
	kind: OutsideWriteIntent["kind"];
	what: string;
	where: string;
	text: string;
	url: string | null;
	ok: boolean;
	reason?: string;
	/** The chatbox line. */
	line: string;
}

export type WriteResult = Outcome<{ entry: OutsideWriteEntry }>;

// Delegation

/** The outside item a delegation names. */
export type DelegationItem =
	| { kind: "pull-request"; repo: string; number: number; title: string; url: string }
	| { kind: "issue"; key: string; summary: string; url: string }
	| { kind: "page"; id: string; title: string; url: string }
	| { kind: "thread"; channel: string; channelName: string; ts: string; url: string | null; preview?: string };

/** What the agent is asked to do with it. */
export type DelegationAsk = "address-review" | "get-reviewed" | "start-work" | "summarise" | "update" | "look-into";

export interface Delegation {
	/** A character's id, or `coordinator`: the coordinator `near` reports to, else the first awake one. */
	to: string;
	near?: string;
	item: DelegationItem;
	ask: DelegationAsk;
	/** The operator's own words, added to the instruction. */
	note?: string;
}

/** The function places' part of `window.agentWorld`. */
export interface IntegrationsApi {
	/** Which accounts are signed in; never their secrets. */
	credentialStatus(): Promise<CredentialStatus>;
	/** Check the Atlassian email and API token against the site, then keep them in the backend's private file. */
	signInAtlassian(site: string, email: string, token: string): Promise<Outcome<{ name: string | null }>>;
	signOutAtlassian(): Promise<Outcome<object>>;
	/** Open Slack's sign-in window; resolves once the session is captured and kept, or the window was closed. */
	signInSlack(): Promise<Outcome<{ team: string | null }>>;
	signOutSlack(): Promise<Outcome<object>>;

	/** The forge: open pull requests involving the operator or his awake agents' branches. */
	pullRequests(): Promise<Outcome<{ pullRequests: PullRequest[] }>>;
	/** The review page: a pull request with its diff. */
	pullRequest(repo: string, number: number): Promise<Outcome<{ detail: PullRequestDetail }>>;

	/** The quest office: issues assigned to the operator and not done. */
	jiraAssigned(): Promise<Outcome<{ issues: JiraIssue[] }>>;
	/** Text search across every issue (an issue key finds that issue). */
	jiraSearch(text: string): Promise<Outcome<{ issues: JiraIssue[] }>>;
	jiraIssue(key: string): Promise<Outcome<{ detail: JiraIssueDetail }>>;
	jiraTransitions(key: string): Promise<Outcome<{ transitions: JiraTransition[] }>>;

	/** The library: text search across all of Confluence. */
	confluenceSearch(text: string): Promise<Outcome<{ pages: ConfluencePageRef[] }>>;
	/** Read a page; it joins the recent list. */
	confluencePage(id: string): Promise<Outcome<{ page: ConfluencePage }>>;
	libraryRecent(): Promise<RecentPage[]>;

	/** The town square: channels with unread messages, most pressing first (mentions, then newest). */
	slackUnread(): Promise<Outcome<{ channels: SlackChannel[] }>>;
	/** The crier: any channel by name, read or unread. */
	slackFindChannels(text: string): Promise<Outcome<{ channels: SlackChannel[] }>>;
	/** A channel's latest messages, newest last. */
	slackChannel(channelId: string): Promise<Outcome<{ thread: SlackThread }>>;
	/** A thread's messages, the parent first. */
	slackThread(channelId: string, threadTs: string): Promise<Outcome<{ thread: SlackThread }>>;

	/** Describe a write outside for the operator to confirm; nothing is sent. */
	describeWrite(intent: OutsideWriteIntent): Promise<DescribedWrite>;
	/** Send a described write: only with the token `describeWrite` gave for this same intent, once. */
	confirmWrite(intent: OutsideWriteIntent, token: string): Promise<WriteResult>;
	/** The latest confirmed writes, oldest first. */
	outsideWrites(): Promise<OutsideWriteEntry[]>;
	/** Called with each confirmed write as it is sent (for the chatbox); returns a function that stops the calls. */
	onOutsideWrite(listener: (entry: OutsideWriteEntry) => void): () => void;

	/**
	 * Ask an agent to work on an outside item: a `talk` when it is idle, a `follow_up` when busy, under the id the UI
	 * chose (its receipts reach `onReceipt`). It never writes outside.
	 */
	delegate(commandId: string, delegation: Delegation): Promise<Outcome<{ to: string; command: "talk" | "follow_up" }>>;
}
