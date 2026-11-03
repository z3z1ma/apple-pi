import { contextBridge, ipcRenderer } from "electron";
import type { RetirePeopleProgress } from "../departures.js";
import type { IntegrationsApi, OutsideWriteEntry } from "../integrations.js";
import type { OrgMoveResult, OrgStartProgress } from "../org.js";
import type { TerminalEvent } from "../terminal.js";
import type {
	AgentWorkplaceApi,
	CanvasList,
	CanvasRead,
	CanvasSaved,
	CommandReceipt,
	CommandResult,
	ConversationPage,
	ConversationSearch,
	FeedLine,
	NotepadChange,
	NotepadRead,
	NotepadSave,
	NotesRead,
	OutsideRead,
	ProfileRead,
	Receipt,
	RecruitReceipt,
	ReplyStreamEvent,
	RoleChoice,
	TaskRead,
	TerminalResult,
	ThemeChoice,
	ThreadRead,
	WorldSnapshot,
	WorldUpdate,
} from "../world.js";

const api: AgentWorkplaceApi = {
	reviews: {
		queue: (request) =>
			ipcRenderer.invoke("reviews:queue", request) as ReturnType<AgentWorkplaceApi["reviews"]["queue"]>,
		analytics: (request) =>
			ipcRenderer.invoke("reviews:analytics", request) as ReturnType<AgentWorkplaceApi["reviews"]["analytics"]>,
		read: (request) => ipcRenderer.invoke("reviews:read", request) as ReturnType<AgentWorkplaceApi["reviews"]["read"]>,
		source: (request) =>
			ipcRenderer.invoke("reviews:source", request) as ReturnType<AgentWorkplaceApi["reviews"]["source"]>,
		freshness: (request) =>
			ipcRenderer.invoke("reviews:freshness", request) as ReturnType<AgentWorkplaceApi["reviews"]["freshness"]>,
		preview: (request) =>
			ipcRenderer.invoke("reviews:preview", request) as ReturnType<AgentWorkplaceApi["reviews"]["preview"]>,
		enqueue: (request) =>
			ipcRenderer.invoke("reviews:enqueue", request) as ReturnType<AgentWorkplaceApi["reviews"]["enqueue"]>,
		manage: (request) =>
			ipcRenderer.invoke("reviews:manage", request) as ReturnType<AgentWorkplaceApi["reviews"]["manage"]>,
		signOff: (request) =>
			ipcRenderer.invoke("reviews:signOff", request) as ReturnType<AgentWorkplaceApi["reviews"]["signOff"]>,
	},
	communications: {
		sendMail: (request) =>
			ipcRenderer.invoke("communications:sendMail", request) as ReturnType<
				AgentWorkplaceApi["communications"]["sendMail"]
			>,
		findChannels: (request) =>
			ipcRenderer.invoke("communications:findChannels", request) as ReturnType<
				AgentWorkplaceApi["communications"]["findChannels"]
			>,
		createChannel: (request) =>
			ipcRenderer.invoke("communications:createChannel", request) as ReturnType<
				AgentWorkplaceApi["communications"]["createChannel"]
			>,
		readThread: (request) =>
			ipcRenderer.invoke("communications:readThread", request) as ReturnType<
				AgentWorkplaceApi["communications"]["readThread"]
			>,
		searchMessages: (request) =>
			ipcRenderer.invoke("communications:searchMessages", request) as ReturnType<
				AgentWorkplaceApi["communications"]["searchMessages"]
			>,
		post: (request) =>
			ipcRenderer.invoke("communications:post", request) as ReturnType<AgentWorkplaceApi["communications"]["post"]>,
		join: (request) =>
			ipcRenderer.invoke("communications:join", request) as ReturnType<AgentWorkplaceApi["communications"]["join"]>,
		leave: (request) =>
			ipcRenderer.invoke("communications:leave", request) as ReturnType<AgentWorkplaceApi["communications"]["leave"]>,
		invite: (request) =>
			ipcRenderer.invoke("communications:invite", request) as ReturnType<AgentWorkplaceApi["communications"]["invite"]>,
		removeInvitations: (request) =>
			ipcRenderer.invoke("communications:removeInvitations", request) as ReturnType<
				AgentWorkplaceApi["communications"]["removeInvitations"]
			>,
		pin: (request) =>
			ipcRenderer.invoke("communications:pin", request) as ReturnType<AgentWorkplaceApi["communications"]["pin"]>,
		react: (request) =>
			ipcRenderer.invoke("communications:react", request) as ReturnType<AgentWorkplaceApi["communications"]["react"]>,
		markRead: (request) =>
			ipcRenderer.invoke("communications:markRead", request) as ReturnType<
				AgentWorkplaceApi["communications"]["markRead"]
			>,
		archive: (request) =>
			ipcRenderer.invoke("communications:archive", request) as ReturnType<
				AgentWorkplaceApi["communications"]["archive"]
			>,
		reopen: (request) =>
			ipcRenderer.invoke("communications:reopen", request) as ReturnType<AgentWorkplaceApi["communications"]["reopen"]>,
		status: (request) =>
			ipcRenderer.invoke("communications:status", request) as ReturnType<AgentWorkplaceApi["communications"]["status"]>,
	},
	terminal: {
		create: (request) =>
			ipcRenderer.invoke("terminal:create", request) as ReturnType<AgentWorkplaceApi["terminal"]["create"]>,
		write: (request) =>
			ipcRenderer.invoke("terminal:write", request) as ReturnType<AgentWorkplaceApi["terminal"]["write"]>,
		resize: (request) =>
			ipcRenderer.invoke("terminal:resize", request) as ReturnType<AgentWorkplaceApi["terminal"]["resize"]>,
		close: (request) =>
			ipcRenderer.invoke("terminal:close", request) as ReturnType<AgentWorkplaceApi["terminal"]["close"]>,
		onEvent(listener) {
			const forward = (_event: unknown, event: TerminalEvent) => listener(event);
			ipcRenderer.on("terminal:event", forward);
			return () => ipcRenderer.removeListener("terminal:event", forward);
		},
	},
	workspace: {
		repositories: () =>
			ipcRenderer.invoke("workspace:repositories") as ReturnType<AgentWorkplaceApi["workspace"]["repositories"]>,
		files: (request) =>
			ipcRenderer.invoke("workspace:files", request) as ReturnType<AgentWorkplaceApi["workspace"]["files"]>,
		worktrees: (request) =>
			ipcRenderer.invoke("workspace:worktrees", request) as ReturnType<AgentWorkplaceApi["workspace"]["worktrees"]>,
		resolvePaths: (request) =>
			ipcRenderer.invoke("workspace:resolve-paths", request) as ReturnType<
				AgentWorkplaceApi["workspace"]["resolvePaths"]
			>,
		tree: (request) =>
			ipcRenderer.invoke("workspace:tree", request) as ReturnType<AgentWorkplaceApi["workspace"]["tree"]>,
		readFile: (request) =>
			ipcRenderer.invoke("workspace:read-file", request) as ReturnType<AgentWorkplaceApi["workspace"]["readFile"]>,
		saveFile: (request) =>
			ipcRenderer.invoke("workspace:save-file", request) as ReturnType<AgentWorkplaceApi["workspace"]["saveFile"]>,
		gitStatus: (request) =>
			ipcRenderer.invoke("workspace:git-status", request) as ReturnType<AgentWorkplaceApi["workspace"]["gitStatus"]>,
		gitDiff: (request) =>
			ipcRenderer.invoke("workspace:git-diff", request) as ReturnType<AgentWorkplaceApi["workspace"]["gitDiff"]>,
	},
	snapshot: () => ipcRenderer.invoke("world:snapshot") as Promise<WorldSnapshot>,
	onUpdate(listener) {
		const forward = (_event: unknown, update: WorldUpdate) => listener(update);
		ipcRenderer.on("world:update", forward);
		return () => ipcRenderer.removeListener("world:update", forward);
	},
	feed: () => ipcRenderer.invoke("world:feed") as Promise<FeedLine[]>,
	onFeed(listener) {
		const forward = (_event: unknown, lines: FeedLine[]) => listener(lines);
		ipcRenderer.on("world:feed", forward);
		return () => ipcRenderer.removeListener("world:feed", forward);
	},
	goToTerminal: (characterId) => ipcRenderer.invoke("world:terminal", characterId) as Promise<TerminalResult>,
	profile: (characterId) => ipcRenderer.invoke("world:profile", characterId) as Promise<ProfileRead>,
	conversation: (characterId, before, textOnly) =>
		ipcRenderer.invoke("world:conversation", characterId, before, textOnly) as Promise<ConversationPage>,
	searchConversations: (query) =>
		ipcRenderer.invoke("world:search-conversations", query) as Promise<ConversationSearch>,
	markSeen: (characterId) => ipcRenderer.invoke("world:mark-seen", characterId) as Promise<CommandResult>,
	setAvatarLook: (look) => ipcRenderer.invoke("world:avatar-look", look) as Promise<CommandResult>,
	themes: () => ipcRenderer.invoke("world:themes") as Promise<ThemeChoice[]>,
	setTheme: (id) => ipcRenderer.invoke("world:set-theme", id) as Promise<CommandResult>,
	setDesk: (desk) => ipcRenderer.invoke("world:set-desk", desk) as Promise<CommandResult>,
	instruct: (characterId, commandId, instruction) =>
		ipcRenderer.invoke("world:instruct", characterId, commandId, instruction) as Promise<CommandResult>,
	onReceipt(listener) {
		const forward = (_event: unknown, receipt: Receipt) => listener(receipt);
		ipcRenderer.on("world:receipt", forward);
		return () => ipcRenderer.removeListener("world:receipt", forward);
	},
	watchReplies: (characterIds) => ipcRenderer.invoke("world:watch-replies", characterIds) as Promise<void>,
	onReply(listener) {
		const forward = (_event: unknown, event: ReplyStreamEvent) => listener(event);
		ipcRenderer.on("world:reply", forward);
		return () => ipcRenderer.removeListener("world:reply", forward);
	},
	wake: (characterId) => ipcRenderer.invoke("world:wake", characterId) as Promise<CommandReceipt>,
	callIn: (request) => ipcRenderer.invoke("world:call-in", request) as ReturnType<AgentWorkplaceApi["callIn"]>,
	endSession: (characterId, confirmed) =>
		ipcRenderer.invoke("world:end-session", characterId, confirmed) as Promise<CommandReceipt>,
	sendMail: (characterId, body) => ipcRenderer.invoke("world:send-mail", characterId, body) as Promise<CommandReceipt>,
	readThread: (thread) => ipcRenderer.invoke("world:read-thread", thread) as Promise<ThreadRead>,
	replyThread: (thread, body) => ipcRenderer.invoke("world:reply-thread", thread, body) as Promise<CommandReceipt>,
	readTask: (task) => ipcRenderer.invoke("world:read-task", task) as Promise<TaskRead>,
	assignTask: (person, task) => ipcRenderer.invoke("world:assign-task", person, task) as Promise<CommandReceipt>,
	unassignTask: (person, task) => ipcRenderer.invoke("world:unassign-task", person, task) as Promise<CommandReceipt>,
	closeTask: (task, status) => ipcRenderer.invoke("world:close-task", task, status) as Promise<CommandReceipt>,
	readOutside: (request) => ipcRenderer.invoke("world:read-outside", request) as Promise<OutsideRead>,
	setOutsideModes: (modes) => ipcRenderer.invoke("world:outside-modes", modes) as Promise<CommandReceipt>,
	setOutsideRule: (request) => ipcRenderer.invoke("world:outside-rule", request) as Promise<CommandReceipt>,
	readNotes: (request) => ipcRenderer.invoke("world:read-notes", request) as Promise<NotesRead>,
	listCanvases: (request) => ipcRenderer.invoke("world:list-canvases", request) as Promise<CanvasList>,
	readCanvas: (id) => ipcRenderer.invoke("world:read-canvas", id) as Promise<CanvasRead>,
	writeCanvas: (write) => ipcRenderer.invoke("world:write-canvas", write) as Promise<CanvasSaved>,
	readWorkplaceThread: (thread) => ipcRenderer.invoke("world:workplace-thread", thread) as Promise<ThreadRead>,
	setChannelMembership: (thread, joined) =>
		ipcRenderer.invoke("world:channel-membership", thread, joined) as Promise<CommandReceipt>,
	recruit: (request) => ipcRenderer.invoke("world:recruit", request) as Promise<RecruitReceipt>,
	rename: (characterId, name) => ipcRenderer.invoke("world:rename", characterId, name) as Promise<CommandReceipt>,
	roles: () => ipcRenderer.invoke("world:roles") as Promise<RoleChoice[]>,
	orgMove: (request) => ipcRenderer.invoke("world:org-move", request) as Promise<OrgMoveResult>,
	orgStart: (request) => ipcRenderer.invoke("world:org-start", request) as Promise<OrgStartProgress>,
	onOrgStart(listener) {
		const forward = (_event: unknown, progress: OrgStartProgress) => listener(progress);
		ipcRenderer.on("world:org-progress", forward);
		return () => ipcRenderer.removeListener("world:org-progress", forward);
	},
	retirePeople: (request) =>
		ipcRenderer.invoke("world:retire-people", request) as ReturnType<AgentWorkplaceApi["retirePeople"]>,
	onRetirePeople(listener) {
		const forward = (_event: unknown, progress: RetirePeopleProgress) => listener(progress);
		ipcRenderer.on("world:departures", forward);
		return () => ipcRenderer.removeListener("world:departures", forward);
	},
	retire: (characterId, reason, handoff) =>
		ipcRenderer.invoke("world:retire", characterId, reason, handoff) as Promise<CommandReceipt>,
	openNotepad: (coordinatorId) => ipcRenderer.invoke("world:open-notepad", coordinatorId) as Promise<NotepadRead>,
	saveNotepad: (coordinatorId, text, base) =>
		ipcRenderer.invoke("world:save-notepad", coordinatorId, text, base) as Promise<NotepadSave>,
	closeNotepad: () => ipcRenderer.invoke("world:close-notepad") as Promise<void>,
	onNotepad(listener) {
		const forward = (_event: unknown, change: NotepadChange) => listener(change);
		ipcRenderer.on("world:notepad", forward);
		return () => ipcRenderer.removeListener("world:notepad", forward);
	},
	openFile: (href, base) => ipcRenderer.invoke("world:open-file", href, base) as Promise<CommandResult>,
	openLink: (url) => ipcRenderer.invoke("world:open-link", url) as Promise<CommandResult>,
	...places(),
};

function places(): IntegrationsApi {
	const call =
		<K extends keyof IntegrationsApi>(channel: string) =>
		(...args: unknown[]) =>
			ipcRenderer.invoke(`places:${channel}`, ...args) as ReturnType<
				Extract<IntegrationsApi[K], (...a: never[]) => unknown>
			>;
	return {
		credentialStatus: call<"credentialStatus">("credential-status"),
		githubStatus: call<"githubStatus">("github-status"),
		googleStatus: call<"googleStatus">("google-status"),
		githubAssigned: call<"githubAssigned">("github-assigned"),
		githubSearch: call<"githubSearch">("github-search"),
		githubIssue: call<"githubIssue">("github-issue"),
		signInAtlassian: call<"signInAtlassian">("sign-in-atlassian"),
		signOutAtlassian: call<"signOutAtlassian">("sign-out-atlassian"),
		signInSlack: call<"signInSlack">("sign-in-slack"),
		signOutSlack: call<"signOutSlack">("sign-out-slack"),
		pullRequests: call<"pullRequests">("pull-requests"),
		pullRequest: call<"pullRequest">("pull-request"),
		jiraAssigned: call<"jiraAssigned">("jira-assigned"),
		jiraSearch: call<"jiraSearch">("jira-search"),
		jiraIssue: call<"jiraIssue">("jira-issue"),
		jiraTransitions: call<"jiraTransitions">("jira-transitions"),
		confluenceSearch: call<"confluenceSearch">("confluence-search"),
		confluencePage: call<"confluencePage">("confluence-page"),
		libraryRecent: call<"libraryRecent">("library-recent"),
		slackUnread: call<"slackUnread">("slack-unread"),
		slackSearch: call<"slackSearch">("slack-search"),
		slackConversations: call<"slackConversations">("slack-conversations"),
		slackChannel: call<"slackChannel">("slack-channel"),
		slackThread: call<"slackThread">("slack-thread"),
		slackMarkRead: call<"slackMarkRead">("slack-mark-read"),
		describeWrite: call<"describeWrite">("describe-write"),
		confirmWrite: call<"confirmWrite">("confirm-write"),
		outsideWrites: call<"outsideWrites">("outside-writes"),
		onOutsideWrite(listener) {
			const forward = (_event: unknown, entry: OutsideWriteEntry) => listener(entry);
			ipcRenderer.on("places:outside-write", forward);
			return () => ipcRenderer.removeListener("places:outside-write", forward);
		},
		delegate: call<"delegate">("delegate"),
	};
}

contextBridge.exposeInMainWorld("agentWorkplace", api);
