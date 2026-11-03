export interface Refusal {
	ok: false;
	reason: string;
	signIn?: "atlassian" | "slack" | "github";
}

export type Outcome<T> = ({ ok: true } & T) | Refusal;

export interface CredentialStatus {
	atlassian: { site: string; email: string } | null;
	slack: { team: string | null; url: string | null; user: string | null } | null;
}

export type CliStatus = Outcome<{ account: string | null }>;

export type CiState = "passing" | "failing" | "running" | "none";

export interface PullRequest {
	repo: string;
	number: number;
	title: string;
	url: string;
	author: string | null;
	draft: boolean;
	branch: string | null;
	updatedAt: string | null;
	ci: CiState;
	checks: { passing: number; failing: number; running: number; total: number };
	reviewDecision: string | null;
	agent: { id: string; name: string } | null;
	involvesYou: boolean;
}

export interface DiffLine {
	kind: "context" | "add" | "del";
	old: number | null;
	new: number | null;
	text: string;
}

export interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath: string;
	status: "added" | "deleted" | "modified" | "renamed";
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

export interface PullRequestDetail {
	pullRequest: PullRequest;
	body: string;
	baseBranch: string | null;
	state: string;
	checks: { name: string; state: "passing" | "failing" | "running" | "skipped" }[];
	files: DiffFile[];
	cut: boolean;
}

export const DIFF_LINES_MAX = 20_000;

export interface IssueSummary {
	key: string;
	summary: string;
	status: string | null;
	statusCategory: string | null;
	type: string | null;
	priority: string | null;
	project: string | null;
	assignee: string | null;
	updated: string | null;
	url: string;
}

export type JiraIssue = IssueSummary;

export interface JiraComment {
	id: string;
	author: string | null;
	created: string | null;
	html: string | null;
	text: string;
}

export interface IssueDetail {
	issue: IssueSummary;
	reporter: string | null;
	created: string | null;
	descriptionHtml: string | null;
	descriptionText: string;
	comments: JiraComment[];
}

export type JiraIssueDetail = IssueDetail;

export interface JiraTransition {
	id: string;
	name: string;
	to: string | null;
	toCategory: string | null;
}

export interface ConfluencePageRef {
	id: string;
	title: string;
	space: string | null;
	url: string;
	excerpt?: string;
	lastModified?: string | null;
}

export interface ConfluencePage {
	page: ConfluencePageRef;
	html: string;
}

export interface RecentPage extends ConfluencePageRef {
	openedAt: number;
}

export interface SlackChannel {
	id: string;
	name: string;
	kind: "channel" | "private" | "dm" | "group";
	unread: number | null;
	more: boolean;
	mentions: number;
	latest: string | null;
	url: string | null;
	unreads?: boolean;
}

export interface SlackHit {
	channel: Pick<SlackChannel, "id" | "name" | "kind">;
	ts: string;
	threadTs: string | null;
	name: string;
	at: number;
	excerpt: { text: string; match: boolean }[];
	url: string | null;
}

export interface SlackSearch {
	channels: SlackChannel[];
	hits: SlackHit[];
	page: number;
	pages: number;
	total: number;
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
	lastRead: string | null;
	newer?: boolean;
}

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
	| { kind: "slack-reply"; channel: string; threadTs: string; text: string }
	| { kind: "slack-mark-read"; channel: string; ts: string; threadTs?: string };

export interface WriteDescription {
	what: string;
	where: string;
	text: string;
	url: string | null;
}

export type DescribedWrite = Outcome<{ token: string; description: WriteDescription }>;

export interface OutsideWriteEntry {
	at: number;
	kind: OutsideWriteIntent["kind"];
	what: string;
	where: string;
	text: string;
	url: string | null;
	ok: boolean;
	reason?: string;
	line: string;
}

export type WriteResult = Outcome<{ entry: OutsideWriteEntry }>;

export type DelegationItem =
	| { kind: "pull-request"; repo: string; number: number; title: string; url: string }
	| { kind: "issue"; key: string; summary: string; url: string }
	| { kind: "page"; id: string; title: string; url: string }
	| { kind: "thread"; channel: string; channelName: string; ts: string; url: string | null; preview?: string };

export type DelegationAsk = "address-review" | "get-reviewed" | "start-work" | "summarise" | "update" | "look-into";

export interface Delegation {
	to: string;
	near?: string;
	item: DelegationItem;
	ask: DelegationAsk;
	note?: string;
}

export interface IntegrationsApi {
	credentialStatus(): Promise<CredentialStatus>;
	signInAtlassian(site: string, email: string, token: string): Promise<Outcome<{ name: string | null }>>;
	signOutAtlassian(): Promise<Outcome<object>>;
	githubStatus(): Promise<CliStatus>;
	googleStatus(): Promise<CliStatus>;
	githubAssigned(): Promise<Outcome<{ issues: IssueSummary[] }>>;
	githubSearch(text: string): Promise<Outcome<{ issues: IssueSummary[] }>>;
	githubIssue(key: string): Promise<Outcome<{ detail: IssueDetail }>>;
	signInSlack(): Promise<Outcome<{ team: string | null }>>;
	signOutSlack(): Promise<Outcome<object>>;

	pullRequests(): Promise<Outcome<{ pullRequests: PullRequest[] }>>;
	pullRequest(repo: string, number: number): Promise<Outcome<{ detail: PullRequestDetail }>>;

	jiraAssigned(): Promise<Outcome<{ issues: JiraIssue[] }>>;
	jiraSearch(text: string): Promise<Outcome<{ issues: JiraIssue[] }>>;
	jiraIssue(key: string): Promise<Outcome<{ detail: JiraIssueDetail }>>;
	jiraTransitions(key: string): Promise<Outcome<{ transitions: JiraTransition[] }>>;

	confluenceSearch(text: string): Promise<Outcome<{ pages: ConfluencePageRef[] }>>;
	confluencePage(id: string): Promise<Outcome<{ page: ConfluencePage }>>;
	libraryRecent(): Promise<RecentPage[]>;

	slackUnread(): Promise<Outcome<{ channels: SlackChannel[] }>>;
	slackSearch(text: string, page?: number): Promise<Outcome<SlackSearch>>;
	slackConversations(): Promise<Outcome<{ channels: SlackChannel[] }>>;
	slackChannel(channelId: string, at?: string): Promise<Outcome<{ thread: SlackThread }>>;
	slackThread(channelId: string, threadTs: string): Promise<Outcome<{ thread: SlackThread }>>;
	slackMarkRead(channelId: string, ts: string, threadTs?: string): Promise<WriteResult>;

	describeWrite(intent: OutsideWriteIntent): Promise<DescribedWrite>;
	confirmWrite(intent: OutsideWriteIntent, token: string): Promise<WriteResult>;
	outsideWrites(): Promise<OutsideWriteEntry[]>;
	onOutsideWrite(listener: (entry: OutsideWriteEntry) => void): () => void;

	delegate(commandId: string, delegation: Delegation): Promise<Outcome<{ to: string; command: "talk" | "follow_up" }>>;
}
