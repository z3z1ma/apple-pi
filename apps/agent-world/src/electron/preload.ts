// The only way the world UI reaches the backend: a narrow typed API on `window.agentWorld`. Sandboxed preloads run
// as CommonJS with only a few Electron modules, so this is built to dist/electron/preload.cjs.
import { contextBridge, ipcRenderer } from "electron";
import type { IntegrationsApi, OutsideWriteEntry } from "../integrations.js";
import type {
	AgentWorldApi,
	CommandReceipt,
	CommandResult,
	ConversationPage,
	FeedLine,
	NotepadChange,
	NotepadRead,
	NotepadSave,
	Receipt,
	RecruitReceipt,
	ReplyStreamEvent,
	TerminalResult,
	ThemeChoice,
	WorldSnapshot,
	WorldUpdate,
} from "../world.js";

const api: AgentWorldApi = {
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
	endSession: (characterId, confirmed) =>
		ipcRenderer.invoke("world:end-session", characterId, confirmed) as Promise<CommandReceipt>,
	sendMail: (characterId, body) => ipcRenderer.invoke("world:send-mail", characterId, body) as Promise<CommandReceipt>,
	recruit: (request) => ipcRenderer.invoke("world:recruit", request) as Promise<RecruitReceipt>,
	rename: (characterId, name) => ipcRenderer.invoke("world:rename", characterId, name) as Promise<CommandReceipt>,
	openNotepad: (coordinatorId) => ipcRenderer.invoke("world:open-notepad", coordinatorId) as Promise<NotepadRead>,
	saveNotepad: (coordinatorId, text, base) =>
		ipcRenderer.invoke("world:save-notepad", coordinatorId, text, base) as Promise<NotepadSave>,
	closeNotepad: () => ipcRenderer.invoke("world:close-notepad") as Promise<void>,
	onNotepad(listener) {
		const forward = (_event: unknown, change: NotepadChange) => listener(change);
		ipcRenderer.on("world:notepad", forward);
		return () => ipcRenderer.removeListener("world:notepad", forward);
	},
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
