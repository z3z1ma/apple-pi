let electron = require("electron");
//#region apps/agent-world/src/electron/preload.ts
var api = {
	snapshot: () => electron.ipcRenderer.invoke("world:snapshot"),
	onUpdate(listener) {
		const forward = (_event, update) => listener(update);
		electron.ipcRenderer.on("world:update", forward);
		return () => electron.ipcRenderer.removeListener("world:update", forward);
	},
	feed: () => electron.ipcRenderer.invoke("world:feed"),
	onFeed(listener) {
		const forward = (_event, lines) => listener(lines);
		electron.ipcRenderer.on("world:feed", forward);
		return () => electron.ipcRenderer.removeListener("world:feed", forward);
	},
	goToTerminal: (characterId) => electron.ipcRenderer.invoke("world:terminal", characterId),
	conversation: (characterId, before) => electron.ipcRenderer.invoke("world:conversation", characterId, before),
	markSeen: (characterId) => electron.ipcRenderer.invoke("world:mark-seen", characterId),
	setAvatarLook: (look) => electron.ipcRenderer.invoke("world:avatar-look", look),
	themes: () => electron.ipcRenderer.invoke("world:themes"),
	setTheme: (id) => electron.ipcRenderer.invoke("world:set-theme", id),
	instruct: (characterId, commandId, instruction) => electron.ipcRenderer.invoke("world:instruct", characterId, commandId, instruction),
	onReceipt(listener) {
		const forward = (_event, receipt) => listener(receipt);
		electron.ipcRenderer.on("world:receipt", forward);
		return () => electron.ipcRenderer.removeListener("world:receipt", forward);
	},
	watchReplies: (characterIds) => electron.ipcRenderer.invoke("world:watch-replies", characterIds),
	onReply(listener) {
		const forward = (_event, event) => listener(event);
		electron.ipcRenderer.on("world:reply", forward);
		return () => electron.ipcRenderer.removeListener("world:reply", forward);
	},
	wake: (characterId) => electron.ipcRenderer.invoke("world:wake", characterId),
	endSession: (characterId, confirmed) => electron.ipcRenderer.invoke("world:end-session", characterId, confirmed),
	sendMail: (characterId, body) => electron.ipcRenderer.invoke("world:send-mail", characterId, body),
	recruit: (request) => electron.ipcRenderer.invoke("world:recruit", request),
	rename: (characterId, name) => electron.ipcRenderer.invoke("world:rename", characterId, name),
	openNotepad: (coordinatorId) => electron.ipcRenderer.invoke("world:open-notepad", coordinatorId),
	saveNotepad: (coordinatorId, text, base) => electron.ipcRenderer.invoke("world:save-notepad", coordinatorId, text, base),
	closeNotepad: () => electron.ipcRenderer.invoke("world:close-notepad"),
	onNotepad(listener) {
		const forward = (_event, change) => listener(change);
		electron.ipcRenderer.on("world:notepad", forward);
		return () => electron.ipcRenderer.removeListener("world:notepad", forward);
	},
	openLink: (url) => electron.ipcRenderer.invoke("world:open-link", url),
	...places()
};
/** The function places' calls: each `places:<name>` channel, typed by `IntegrationsApi`. */
function places() {
	const call = (channel) => (...args) => electron.ipcRenderer.invoke(`places:${channel}`, ...args);
	return {
		credentialStatus: call("credential-status"),
		signInAtlassian: call("sign-in-atlassian"),
		signOutAtlassian: call("sign-out-atlassian"),
		signInSlack: call("sign-in-slack"),
		signOutSlack: call("sign-out-slack"),
		pullRequests: call("pull-requests"),
		pullRequest: call("pull-request"),
		jiraAssigned: call("jira-assigned"),
		jiraSearch: call("jira-search"),
		jiraIssue: call("jira-issue"),
		jiraTransitions: call("jira-transitions"),
		confluenceSearch: call("confluence-search"),
		confluencePage: call("confluence-page"),
		libraryRecent: call("library-recent"),
		slackUnread: call("slack-unread"),
		slackSearch: call("slack-search"),
		slackConversations: call("slack-conversations"),
		slackChannel: call("slack-channel"),
		slackThread: call("slack-thread"),
		slackMarkRead: call("slack-mark-read"),
		describeWrite: call("describe-write"),
		confirmWrite: call("confirm-write"),
		outsideWrites: call("outside-writes"),
		onOutsideWrite(listener) {
			const forward = (_event, entry) => listener(entry);
			electron.ipcRenderer.on("places:outside-write", forward);
			return () => electron.ipcRenderer.removeListener("places:outside-write", forward);
		},
		delegate: call("delegate")
	};
}
electron.contextBridge.exposeInMainWorld("agentWorld", api);
//#endregion
