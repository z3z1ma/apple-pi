// The only way the world UI reaches the backend: a narrow typed API on `window.agentWorld`. Sandboxed preloads run
// as CommonJS with only a few Electron modules, so this is built to dist/electron/preload.cjs.
import { contextBridge, ipcRenderer } from "electron";
import type { IntegrationsApi, OutsideWriteEntry } from "../integrations.js";
import type { OrgMoveResult, OrgStartProgress } from "../org.js";
import type { TerminalEvent } from "../terminal.js";
import type {
	AgentWorldApi,
	CommandReceipt,
	CommandResult,
	ConversationPage,
	FeedLine,
	NotepadChange,
	NotepadRead,
	NotepadSave,
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

const api: AgentWorldApi = {
	terminal: {
		create: (request) =>
			ipcRenderer.invoke("terminal:create", request) as ReturnType<AgentWorldApi["terminal"]["create"]>,
		write: (request) => ipcRenderer.invoke("terminal:write", request) as ReturnType<AgentWorldApi["terminal"]["write"]>,
		resize: (request) =>
			ipcRenderer.invoke("terminal:resize", request) as ReturnType<AgentWorldApi["terminal"]["resize"]>,
		close: (request) => ipcRenderer.invoke("terminal:close", request) as ReturnType<AgentWorldApi["terminal"]["close"]>,
		onEvent(listener) {
			const forward = (_event: unknown, event: TerminalEvent) => listener(event);
			ipcRenderer.on("terminal:event", forward);
			return () => ipcRenderer.removeListener("terminal:event", forward);
		},
	},
	workspace: {
		repositories: () =>
			ipcRenderer.invoke("workspace:repositories") as ReturnType<AgentWorldApi["workspace"]["repositories"]>,
		files: (request) =>
			ipcRenderer.invoke("workspace:files", request) as ReturnType<AgentWorldApi["workspace"]["files"]>,
		worktrees: (request) =>
			ipcRenderer.invoke("workspace:worktrees", request) as ReturnType<AgentWorldApi["workspace"]["worktrees"]>,
		resolvePaths: (request) =>
			ipcRenderer.invoke("workspace:resolve-paths", request) as ReturnType<AgentWorldApi["workspace"]["resolvePaths"]>,
		tree: (request) => ipcRenderer.invoke("workspace:tree", request) as ReturnType<AgentWorldApi["workspace"]["tree"]>,
		readFile: (request) =>
			ipcRenderer.invoke("workspace:read-file", request) as ReturnType<AgentWorldApi["workspace"]["readFile"]>,
		saveFile: (request) =>
			ipcRenderer.invoke("workspace:save-file", request) as ReturnType<AgentWorldApi["workspace"]["saveFile"]>,
		gitStatus: (request) =>
			ipcRenderer.invoke("workspace:git-status", request) as ReturnType<AgentWorldApi["workspace"]["gitStatus"]>,
		gitDiff: (request) =>
			ipcRenderer.invoke("workspace:git-diff", request) as ReturnType<AgentWorldApi["workspace"]["gitDiff"]>,
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
	conversation: (characterId, before) =>
		ipcRenderer.invoke("world:conversation", characterId, before) as Promise<ConversationPage>,
	markSeen: (characterId) => ipcRenderer.invoke("world:mark-seen", characterId) as Promise<CommandResult>,
	setAvatarLook: (look) => ipcRenderer.invoke("world:avatar-look", look) as Promise<CommandResult>,
	themes: () => ipcRenderer.invoke("world:themes") as Promise<ThemeChoice[]>,
	setTheme: (id) => ipcRenderer.invoke("world:set-theme", id) as Promise<CommandResult>,
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
	callIn: (request) => ipcRenderer.invoke("world:call-in", request) as ReturnType<AgentWorldApi["callIn"]>,
	endSession: (characterId, confirmed) =>
		ipcRenderer.invoke("world:end-session", characterId, confirmed) as Promise<CommandReceipt>,
	sendMail: (characterId, body) => ipcRenderer.invoke("world:send-mail", characterId, body) as Promise<CommandReceipt>,
	readThread: (thread) => ipcRenderer.invoke("world:read-thread", thread) as Promise<ThreadRead>,
	replyThread: (thread, body) => ipcRenderer.invoke("world:reply-thread", thread, body) as Promise<CommandReceipt>,
	readTask: (task) => ipcRenderer.invoke("world:read-task", task) as Promise<TaskRead>,
	assignTask: (person, task) => ipcRenderer.invoke("world:assign-task", person, task) as Promise<CommandReceipt>,
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
	retire: (characterId, reason) => ipcRenderer.invoke("world:retire", characterId, reason) as Promise<CommandReceipt>,
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

/** The function places' calls: each `places:<name>` channel, typed by `IntegrationsApi`. */
function places(): IntegrationsApi {
	const call =
		<K extends keyof IntegrationsApi>(channel: string) =>
		(...args: unknown[]) =>
			ipcRenderer.invoke(`places:${channel}`, ...args) as ReturnType<
				Extract<IntegrationsApi[K], (...a: never[]) => unknown>
			>;
	return {
		credentialStatus: call<"credentialStatus">("credential-status"),
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

contextBridge.exposeInMainWorld("agentWorld", api);
