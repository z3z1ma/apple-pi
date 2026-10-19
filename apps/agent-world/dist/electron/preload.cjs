let electron = require("electron");
//#region apps/agent-world/src/electron/preload.ts
electron.contextBridge.exposeInMainWorld("agentWorld", {
	snapshot: () => electron.ipcRenderer.invoke("world:snapshot"),
	onUpdate(listener) {
		const forward = (_event, snapshot) => listener(snapshot);
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
	openLink: (url) => electron.ipcRenderer.invoke("world:open-link", url)
});
//#endregion
